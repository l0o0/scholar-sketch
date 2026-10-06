import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSmartSnap,
  type GuideRect,
} from "../packages/whiteboard/src/whiteboard/smartGuides.ts";

const rect = (
  id: string,
  x: number,
  y: number,
  width = 120,
  height = 80,
): GuideRect => ({ id, x, y, width, height });
const snap = (moving: GuideRect[], stationary: GuideRect[], zoom = 1) =>
  computeSmartSnap({ moving, stationary, zoom });

test("nearest edges and centers snap with finite guides for unequal card sizes", () => {
  const result = snap(
    [rect("moving", 104, 301, 80, 60)],
    [rect("ref", 100, 500, 120, 100)],
  );
  assert.equal(result.delta.x, -4);
  assert.deepEqual(
    result.guides.filter((guide) => guide.axis === "x"),
    [
      {
        axis: "x",
        position: 100,
        start: 304,
        end: 600,
        anchors: [304, 364, 500, 600],
      },
    ],
  );
  const centered = snap(
    [rect("moving", 117, 0, 80)],
    [rect("ref", 100, 500, 120)],
  );
  assert.equal(centered.delta.x, 3);
  assert.equal(
    centered.guides.find((guide) => guide.axis === "x")?.position,
    160,
  );
});

test("intelligent alignment wins over a nearer grid coordinate", () => {
  const result = snap([rect("moving", 31, 0)], [rect("ref", 34, 500)]);
  assert.equal(result.delta.x, 3);
  assert.ok(result.guides.some((guide) => guide.axis === "x"));
});

test("matching edges take precedence over equivalent centers to keep guides off card text", () => {
  const result = snap([rect("moving", 300, 103)], [rect("ref", 0, 100)]);
  assert.equal(result.delta.y, -3);
  assert.equal(
    result.guides.find((guide) => guide.axis === "y")?.position,
    100,
  );
});

test("the six-pixel snap threshold follows zoom and excludes distant anchors", () => {
  assert.equal(
    snap([rect("moving", 106, 0)], [rect("ref", 100, 500)]).delta.x,
    -6,
  );
  const zoomed = snap([rect("moving", 106, 0)], [rect("ref", 100, 500)], 2);
  assert.equal(zoomed.delta.x, 6);
  assert.equal(zoomed.guides.filter((guide) => guide.axis === "x").length, 0);
  assert.equal(
    snap([rect("moving", 111, 0)], [rect("ref", 100, 500)], 0.5).delta.x,
    -11,
  );
  const far = snap([rect("moving", 0, 0)], [rect("ref", 1000, 1000)]);
  assert.deepEqual(far, { delta: { x: 0, y: 0 }, guides: [], gaps: [] });
});

test("multi-selection snaps its union and uses the primary card for grid fallback", () => {
  const moving = [rect("a", 101, 0, 80, 60), rect("b", 301, 100, 40, 60)];
  const result = computeSmartSnap({
    moving,
    stationary: [rect("ref", 100, 500, 240, 100)],
    primaryId: "b",
    zoom: 1,
  });
  assert.deepEqual(result.delta, { x: -1, y: -4 });
  assert.equal(
    moving[1].x + result.delta.x - moving[0].x - result.delta.x,
    200,
  );
  assert.deepEqual(
    computeSmartSnap({ moving, stationary: [], primaryId: "b", zoom: 1 }).delta,
    { x: 3, y: -4 },
  );
});

test("Alt disables both grid and smart snapping", () => {
  assert.deepEqual(
    computeSmartSnap({
      moving: [rect("m", 31, 19)],
      stationary: [rect("ref", 34, 20)],
      zoom: 1,
      disabled: true,
    }),
    { delta: { x: 0, y: 0 }, guides: [], gaps: [] },
  );
});

test("without candidates the grid handles negative coordinates and missing primary", () => {
  assert.deepEqual(
    computeSmartSnap({
      moving: [rect("m", 19, -19)],
      stationary: [],
      primaryId: "missing",
      zoom: 1,
    }),
    { delta: { x: -3, y: 3 }, guides: [], gaps: [] },
  );
  assert.deepEqual(snap([], [rect("ref", 0, 0)]), {
    delta: { x: 0, y: 0 },
    guides: [],
    gaps: [],
  });
});

test("equal edge gaps extend a row with different card widths", () => {
  const references = [rect("a", 0, 0, 40, 60), rect("b", 100, 0, 60, 60)];
  const result = snap([rect("m", 217, 0, 80, 60)], references);
  assert.equal(result.delta.x, 3);
  assert.deepEqual(result.gaps, [
    { axis: "x", start: 40, end: 100, cross: 78, gap: 60 },
    { axis: "x", start: 160, end: 220, cross: 78, gap: 60 },
  ]);
  const preceding = snap([rect("m", -133, 0, 80, 60)], references);
  assert.equal(preceding.delta.x, 5); // Outside threshold: grid fallback.
  assert.equal(preceding.gaps.length, 0);
  const left = snap([rect("m", -137, 0, 80, 60)], references);
  assert.equal(left.delta.x, -3);
  assert.deepEqual(
    left.gaps.map((gap) => gap.gap),
    [60, 60],
  );
});

test("a card between neighbors gets equal empty space rather than equal centers", () => {
  const result = snap(
    [rect("m", 162, 0, 30, 60)],
    [rect("a", 0, 0, 50, 60), rect("b", 300, 0, 70, 60)],
  );
  assert.equal(result.delta.x, -2);
  assert.deepEqual(
    result.gaps.map(({ start, end, gap }) => ({ start, end, gap })),
    [
      { start: 50, end: 160, gap: 110 },
      { start: 190, end: 300, gap: 110 },
    ],
  );
});

test("vertical equal gaps and negative coordinates share the same rules", () => {
  const result = snap(
    [rect("m", 0, -83, 60, 50)],
    [rect("a", 0, -300, 60, 40), rect("b", 0, -200, 60, 60)],
  );
  assert.equal(result.delta.y, 3);
  assert.deepEqual(
    result.gaps.map(({ axis, start, end, gap }) => ({ axis, start, end, gap })),
    [
      { axis: "y", start: -260, end: -200, gap: 60 },
      { axis: "y", start: -140, end: -80, gap: 60 },
    ],
  );
});

test("spacing respects screen-space thresholds and preserves fractional gaps", () => {
  const references = [rect("a", 0, 0, 40, 60), rect("b", 100, 0, 60, 60)];
  const nearby = snap([rect("m", 217, 0, 80, 60)], references, 2);
  assert.equal(nearby.delta.x, 3);
  assert.equal(nearby.gaps[0].cross, 69);
  const outside = snap([rect("m", 217, 0, 80, 60)], references, 3);
  assert.equal(outside.delta.x, 7);
  assert.equal(outside.gaps.length, 0);

  const fractional = snap(
    [rect("m", 163, 0, 30, 60)],
    [rect("a", 0, 0, 51, 60), rect("b", 300, 0, 71, 60)],
  );
  assert.equal(fractional.delta.x, -2.5);
  assert.deepEqual(
    fractional.gaps.map((gap) => gap.gap),
    [109.5, 109.5],
  );
});

test("spacing ignores other rows and uses nearest neighbors", () => {
  const result = snap(
    [rect("m", 217, 0, 80, 60)],
    [
      rect("a", 0, 0, 40, 60),
      rect("b", 100, 0, 60, 60),
      rect("far", -1000, 0, 40, 60),
      rect("other-row", 1000, 800, 20, 60),
    ],
  );
  assert.equal(result.delta.x, 3);
  assert.deepEqual(
    result.gaps.map((gap) => gap.gap),
    [60, 60],
  );
  const unmatched = snap(
    [rect("m", 217, 0, 80, 60)],
    [rect("a", 0, 0, 40, 60), rect("b", 100, 300, 60, 60)],
  );
  assert.equal(unmatched.gaps.length, 0);
});

test("alignment takes precedence when an equal-gap target would conflict", () => {
  const result = snap(
    [rect("m", 217, 0, 80, 60)],
    [
      rect("a", 0, 0, 40, 60),
      rect("b", 100, 0, 60, 60),
      rect("aligned", 215, 500, 120, 60),
    ],
  );
  assert.equal(result.delta.x, -2);
  assert.equal(result.gaps.length, 0);
});

test("input order and invalid rectangles do not change the result or mutate input", () => {
  const moving = [rect("m", 31, 19)];
  const refs = [rect("z", 34, 500), rect("a", 28, 800)];
  const original = structuredClone({ moving, refs });
  assert.deepEqual(snap(moving, refs), snap(moving, [...refs].reverse()));
  assert.deepEqual({ moving, refs }, original);
  assert.deepEqual(
    snap(moving, [...refs, rect("bad", NaN, 0)]),
    snap(moving, refs),
  );
  assert.deepEqual(snap(moving, [moving[0]]), snap(moving, []));
});
