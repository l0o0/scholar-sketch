import type { CanvasNode, CanvasNodeKind } from "./academic";
import type { CanvasNodeStyle } from "./core";

const SURFACE_FIELDS = [
  "stroke",
  "fill",
  "strokeWidth",
  "dashed",
  "strokeOpacity",
  "fillStyle",
  "strokeStyle",
] as const satisfies readonly (keyof CanvasNodeStyle)[];

const TEXT_FIELDS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "textAlign",
  "verticalAlign",
  "textColor",
  "textOpacity",
] as const satisfies readonly (keyof CanvasNodeStyle)[];

type TransferStyleField =
  (typeof SURFACE_FIELDS)[number] | (typeof TEXT_FIELDS)[number] | "radius";

export interface CopiedNodeStyle {
  readonly kind: CanvasNodeKind;
  readonly supportsRadius: boolean;
  /** Raw overrides only: missing values restore the target's own defaults. */
  readonly style: Readonly<Pick<CanvasNodeStyle, TransferStyleField>>;
}

export function supportsNodeStyleTransfer(node: CanvasNode): boolean {
  return node.kind !== "line" && node.kind !== "arrow";
}

function supportsRadius(node: CanvasNode): boolean {
  return (
    supportsNodeStyleTransfer(node) &&
    node.kind !== "ellipse" &&
    !(node.kind === "rect" && node.style?.shape === "diamond")
  );
}

function isAreaShape(kind: CanvasNodeKind): boolean {
  return kind === "rect" || kind === "ellipse";
}

function copyField<K extends TransferStyleField>(
  destination: CanvasNodeStyle,
  source: Readonly<CanvasNodeStyle>,
  field: K,
): boolean {
  const value = source[field];
  // An own `undefined` can still override semantic defaults during object
  // spreads in renderers. Restoring defaults must remove the property itself.
  if (value === undefined) {
    if (!Object.hasOwn(destination, field)) return false;
    delete destination[field];
    return true;
  }
  if (destination[field] === value) return false;
  destination[field] = value;
  return true;
}

export function copyNodeStyle(node: CanvasNode): CopiedNodeStyle | null {
  if (!supportsNodeStyleTransfer(node)) return null;
  const style: CanvasNodeStyle = {};
  const source = node.style ?? {};
  for (const field of [...SURFACE_FIELDS, ...TEXT_FIELDS]) {
    copyField(style, source, field);
  }
  const hasRadius = supportsRadius(node);
  if (hasRadius) copyField(style, source, "radius");
  return { kind: node.kind, supportsRadius: hasRadius, style };
}

export function applyNodeStyle(
  target: CanvasNode,
  copied: CopiedNodeStyle,
): CanvasNode {
  if (
    !supportsNodeStyleTransfer(target) ||
    copied.kind === "line" ||
    copied.kind === "arrow"
  ) {
    return target;
  }
  const style = { ...target.style };
  let changed = false;
  const applyField = (field: TransferStyleField) => {
    if (copyField(style, copied.style, field)) changed = true;
  };
  SURFACE_FIELDS.forEach(applyField);
  if (copied.supportsRadius && supportsRadius(target)) applyField("radius");
  if (
    target.kind === copied.kind ||
    (isAreaShape(target.kind) && isAreaShape(copied.kind))
  ) {
    TEXT_FIELDS.forEach(applyField);
  }
  if (!changed) return target;
  const result: CanvasNode = { ...target, style };
  if (Object.keys(style).length === 0) delete result.style;
  return result;
}
