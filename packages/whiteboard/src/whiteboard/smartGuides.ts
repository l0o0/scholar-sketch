/** Geometry stays in canvas coordinates; the snap distance stays constant on screen. */
export interface GuideRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlignmentGuide {
  axis: "x" | "y";
  position: number;
  start: number;
  end: number;
  anchors: number[];
}

export interface GapGuide {
  axis: "x" | "y";
  start: number;
  end: number;
  cross: number;
  gap: number;
}

export interface SmartSnapInput {
  moving: readonly GuideRect[];
  stationary: readonly GuideRect[];
  primaryId?: string;
  zoom: number;
  disabled?: boolean;
}

export interface SmartSnapResult {
  delta: { x: number; y: number };
  guides: AlignmentGuide[];
  gaps: GapGuide[];
}

type Axis = "x" | "y";
interface AlignmentCandidate {
  delta: number;
  position: number;
  movingAnchor: number;
  reference: GuideRect;
  priority: number;
}
interface GapCandidate {
  delta: number;
  gaps: GapGuide[];
}

const SNAP_SCREEN_DISTANCE = 6;
const GRID_SIZE = 16;
const EPSILON = 1e-7;
const otherAxis = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
const size = (rect: GuideRect, axis: Axis) =>
  axis === "x" ? rect.width : rect.height;
const end = (rect: GuideRect, axis: Axis) => rect[axis] + size(rect, axis);
const center = (rect: GuideRect, axis: Axis) =>
  rect[axis] + size(rect, axis) / 2;
const anchors = (rect: GuideRect, axis: Axis) => [
  rect[axis],
  center(rect, axis),
  end(rect, axis),
];
const within = (delta: number, threshold: number) =>
  Math.abs(delta) <= threshold + EPSILON;
const cleanZero = (value: number) => (Math.abs(value) < EPSILON ? 0 : value);

function isValidRect(rect: GuideRect): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

function bounds(rects: readonly GuideRect[]): GuideRect {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    id: "moving-bounds",
    x,
    y,
    width: Math.max(...rects.map((rect) => end(rect, "x"))) - x,
    height: Math.max(...rects.map((rect) => end(rect, "y"))) - y,
  };
}

function closestAlignment(
  moving: GuideRect,
  stationary: readonly GuideRect[],
  axis: Axis,
  threshold: number,
): AlignmentCandidate | undefined {
  let best: AlignmentCandidate | undefined;
  const movingAnchors = anchors(moving, axis);
  for (const reference of stationary) {
    const referenceAnchors = anchors(reference, axis);
    for (const [movingIndex, movingAnchor] of movingAnchors.entries()) {
      for (const [referenceIndex, position] of referenceAnchors.entries()) {
        const delta = position - movingAnchor;
        if (!within(delta, threshold)) continue;
        // Prefer matching centers/edges when multiple targets are equally close.
        const priority =
          movingIndex === referenceIndex ? (movingIndex === 1 ? 1 : 0) : 2;
        const candidate = {
          delta,
          position,
          movingAnchor,
          reference,
          priority,
        };
        if (
          !best ||
          Math.abs(delta) < Math.abs(best.delta) - EPSILON ||
          (Math.abs(Math.abs(delta) - Math.abs(best.delta)) <= EPSILON &&
            (priority < best.priority ||
              (priority === best.priority &&
                (position < best.position ||
                  (position === best.position &&
                    reference.id.localeCompare(best.reference.id) < 0)))))
        ) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

/** Same row/column means a matching leading edge, center, or trailing edge. */
function sharesLane(
  a: GuideRect,
  b: GuideRect,
  cross: Axis,
  threshold: number,
) {
  return anchors(a, cross).some((value, index) =>
    within(value - anchors(b, cross)[index], threshold),
  );
}

function closestGap(
  moving: GuideRect,
  stationary: readonly GuideRect[],
  axis: Axis,
  threshold: number,
  zoom: number,
): GapCandidate | undefined {
  const crossAxis = otherAxis(axis);
  // Inspect only the two nearest neighbors in this row/column, not every pair.
  const neighbors = stationary
    .filter((rect) => sharesLane(moving, rect, crossAxis, threshold))
    .sort(
      (a, b) =>
        Math.abs(center(a, axis) - center(moving, axis)) -
          Math.abs(center(b, axis) - center(moving, axis)) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 2)
    .sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
  if (neighbors.length < 2) return;
  const [first, last] = neighbors;
  if (!sharesLane(first, last, crossAxis, threshold)) return;
  const referenceGap = last[axis] - end(first, axis);
  if (referenceGap <= EPSILON) return;

  let delta: number;
  let gap: number;
  let segments: Array<[number, number]>;
  if (center(moving, axis) < center(first, axis)) {
    gap = referenceGap;
    delta = first[axis] - gap - end(moving, axis);
    segments = [
      [end(moving, axis) + delta, first[axis]],
      [end(first, axis), last[axis]],
    ];
  } else if (center(moving, axis) > center(last, axis)) {
    gap = referenceGap;
    delta = end(last, axis) + gap - moving[axis];
    segments = [
      [end(first, axis), last[axis]],
      [end(last, axis), moving[axis] + delta],
    ];
  } else {
    gap = (referenceGap - size(moving, axis)) / 2;
    if (gap <= EPSILON) return;
    delta = end(first, axis) + gap - moving[axis];
    segments = [
      [end(first, axis), moving[axis] + delta],
      [end(moving, axis) + delta, last[axis]],
    ];
  }
  if (!within(delta, threshold)) return;
  // Measurements sit outside the cards, with a constant screen-space offset.
  const cross =
    Math.max(...[moving, first, last].map((rect) => end(rect, crossAxis))) +
    18 / zoom;
  return {
    delta,
    gaps: segments.map(([start, finish]) => ({
      axis,
      start,
      end: finish,
      cross,
      gap,
    })),
  };
}

export function computeSmartSnap(input: SmartSnapInput): SmartSnapResult {
  const empty = (): SmartSnapResult => ({
    delta: { x: 0, y: 0 },
    guides: [],
    gaps: [],
  });
  if (input.disabled) return empty();
  const moving = input.moving.filter(isValidRect);
  if (!moving.length) return empty();
  const movingIds = new Set(moving.map((rect) => rect.id));
  const stationary = input.stationary.filter(
    (rect) => isValidRect(rect) && !movingIds.has(rect.id),
  );
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  const threshold = SNAP_SCREEN_DISTANCE / zoom;
  const movingBounds = bounds(moving);
  const primary =
    moving.find((rect) => rect.id === input.primaryId) ?? moving[0];
  const alignments = {
    x: closestAlignment(movingBounds, stationary, "x", threshold),
    y: closestAlignment(movingBounds, stationary, "y", threshold),
  };
  const delta = {
    x:
      alignments.x?.delta ??
      Math.round(primary.x / GRID_SIZE) * GRID_SIZE - primary.x,
    y:
      alignments.y?.delta ??
      Math.round(primary.y / GRID_SIZE) * GRID_SIZE - primary.y,
  };
  const gaps: GapGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    if (alignments[axis]) continue;
    const crossAxis = otherAxis(axis);
    const candidate = closestGap(
      {
        ...movingBounds,
        [crossAxis]: movingBounds[crossAxis] + delta[crossAxis],
      },
      stationary,
      axis,
      threshold,
      zoom,
    );
    if (candidate) {
      delta[axis] = candidate.delta;
      gaps.push(...candidate.gaps);
    }
  }

  const guides: AlignmentGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    const alignment = alignments[axis];
    if (!alignment) continue;
    const crossAxis = otherAxis(axis);
    const moved = {
      ...movingBounds,
      x: movingBounds.x + delta.x,
      y: movingBounds.y + delta.y,
    };
    const points = [
      moved[crossAxis],
      end(moved, crossAxis),
      alignment.reference[crossAxis],
      end(alignment.reference, crossAxis),
    ];
    const unique = [...new Set(points)].sort((a, b) => a - b);
    guides.push({
      axis,
      position: alignment.position,
      start: unique[0],
      end: unique[unique.length - 1],
      anchors: unique,
    });
  }
  return {
    delta: { x: cleanZero(delta.x), y: cleanZero(delta.y) },
    guides,
    gaps,
  };
}
