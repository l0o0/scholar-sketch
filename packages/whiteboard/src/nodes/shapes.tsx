import type { NodeProps } from "@xyflow/react";
import { useWhiteboardLabels } from "../chrome/labels";
import { canvasNodeSurfaceDefaults } from "../model/academic";
import { labelTextStyle, verticalAlignmentStyle } from "../whiteboard/document";
import { IconText } from "../whiteboard/icons";
import {
  CardShell,
  NodeHandles,
  nodeSurfaceFill,
  nodeSurfaceStroke,
} from "./CardShell";
import type { CanvasFlowNode } from "./types";

function resolvedStrokeStyle(style: CanvasFlowNode["data"]["model"]["style"]) {
  return style?.strokeStyle ?? (style?.dashed ? "dashed" : "solid");
}

function strokeDasharray(style: CanvasFlowNode["data"]["model"]["style"]) {
  const strokeStyle = resolvedStrokeStyle(style);
  return strokeStyle === "dotted"
    ? "2 6"
    : strokeStyle === "dashed"
      ? "8 6"
      : undefined;
}

export function TextNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const labels = useWhiteboardLabels();
  const model = data.model;
  if (model.kind !== "text") return null;
  const style = model.style ?? {};
  return (
    <CardShell
      kind="text"
      kindLabel={labels.addText}
      kindIcon={<IconText />}
      showKindLabel={false}
      selected={selected}
      nodeStyle={model.style}
    >
      <div
        className="zmd-board-card-label-layout"
        style={verticalAlignmentStyle(style)}
      >
        <p className="zmd-board-card-title" style={labelTextStyle(style)}>
          {model.data.title || labels.addText}
        </p>
      </div>
    </CardShell>
  );
}

function shapeStyle(
  kind: "rect" | "ellipse",
  style: CanvasFlowNode["data"]["model"]["style"],
) {
  const value = style ?? {};
  const defaults = canvasNodeSurfaceDefaults(kind);
  const stroke =
    nodeSurfaceStroke(kind, value) ??
    `var(--zmd-board-text, ${defaults.stroke})`;
  return {
    borderColor: stroke,
    background:
      value.shape === "diamond"
        ? "transparent"
        : (nodeSurfaceFill(kind, value) ??
          `var(--zmd-board-surface, ${defaults.fill})`),
    borderWidth:
      value.shape === "diamond"
        ? 0
        : (value.strokeWidth ?? defaults.strokeWidth),
    borderStyle: resolvedStrokeStyle(value),
    borderRadius:
      kind === "ellipse"
        ? 999
        : value.shape === "diamond"
          ? 0
          : (value.radius ?? defaults.radius),
    ...verticalAlignmentStyle(value),
  } as const;
}

function DiamondSurface({
  model,
}: {
  model: Extract<CanvasFlowNode["data"]["model"], { kind: "rect" }>;
}) {
  const style = model.style ?? {};
  const defaults = canvasNodeSurfaceDefaults("rect");
  const stroke =
    nodeSurfaceStroke("rect", style) ??
    `var(--zmd-board-text, ${defaults.stroke})`;
  const fill =
    style.fillStyle === "hatch"
      ? (style.fill ?? defaults.fill)
      : (nodeSurfaceFill("rect", style) ??
        `var(--zmd-board-surface, ${defaults.fill})`);
  const patternId = `zmd-board-diamond-hatch-${model.id}`;
  return (
    <>
      <svg
        className="zmd-board-diamond"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {style.fillStyle === "hatch" ? (
          <defs>
            <pattern
              id={patternId}
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
            >
              <rect width="8" height="8" fill={fill} />
              <path
                d="M-2 2L2-2M0 8L8 0M6 10L10 6"
                stroke={stroke}
                strokeWidth="1"
                opacity="0.25"
              />
            </pattern>
          </defs>
        ) : null}
        <polygon
          points="50,1 99,50 50,99 1,50"
          fill={style.fillStyle === "hatch" ? `url(#${patternId})` : fill}
          stroke={stroke}
          strokeWidth={style.strokeWidth ?? defaults.strokeWidth}
          strokeDasharray={strokeDasharray(style)}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      {model.data.title ? (
        <span
          className="zmd-board-shape-label"
          style={{
            ...labelTextStyle(style),
            display: "block",
            width: "54%",
            maxHeight: "58%",
          }}
        >
          {model.data.title}
        </span>
      ) : null}
    </>
  );
}

export function RectNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const model = data.model;
  if (model.kind !== "rect") return null;
  const diamond = model.style?.shape === "diamond";
  return (
    <div
      className={`zmd-board-shape ${diamond ? "is-diamond" : "is-rect"}${selected ? " is-selected" : ""}`}
      style={shapeStyle("rect", model.style)}
    >
      <NodeHandles />
      {diamond ? <DiamondSurface model={model} /> : null}
      {!diamond && model.data.title ? (
        <span style={labelTextStyle(model.style ?? {})}>
          {model.data.title}
        </span>
      ) : null}
    </div>
  );
}

export function EllipseNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const model = data.model;
  if (model.kind !== "ellipse") return null;
  return (
    <div
      className={`zmd-board-shape is-ellipse${selected ? " is-selected" : ""}`}
      style={shapeStyle("ellipse", model.style)}
    >
      <NodeHandles />
      {model.data.title ? (
        <span style={labelTextStyle(model.style ?? {})}>
          {model.data.title}
        </span>
      ) : null}
    </div>
  );
}

function StrokeShape({
  id,
  data,
  selected,
  width,
  height,
  arrow,
}: NodeProps<CanvasFlowNode> & { arrow?: boolean }) {
  const model = data.model;
  if (model.kind !== "line" && model.kind !== "arrow") return null;
  const style = model.style ?? {};
  const boxW = Math.max(width ?? 8, 8);
  const boxH = Math.max(height ?? 8, 8);
  const start = model.data.from ?? { x: 0, y: boxH / 2 };
  const end = model.data.to ?? { x: boxW, y: boxH / 2 };
  const markerId = `zmd-board-arrow-${id}`;
  const stroke =
    nodeSurfaceStroke(model.kind, style) ??
    `var(--zmd-board-edge, ${canvasNodeSurfaceDefaults(model.kind).stroke})`;
  return (
    <div
      className={`zmd-board-shape is-stroke${selected ? " is-selected" : ""}`}
    >
      <NodeHandles />
      <svg
        className="zmd-board-stroke"
        style={{ color: stroke }}
        viewBox={`0 0 ${boxW} ${boxH}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          {arrow ? (
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          ) : null}
        </defs>
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="currentColor"
          strokeWidth={style.strokeWidth ?? 2}
          strokeDasharray={strokeDasharray(style)}
          markerEnd={arrow ? `url(#${markerId})` : undefined}
        />
      </svg>
      {model.data.title ? (
        <span
          className="zmd-board-stroke-label"
          style={{
            left: (start.x + end.x) / 2,
            top: (start.y + end.y) / 2,
          }}
        >
          <span
            className="zmd-board-stroke-label-text"
            style={labelTextStyle(style)}
          >
            {model.data.title}
          </span>
        </span>
      ) : null}
    </div>
  );
}

export function LineNode(props: NodeProps<CanvasFlowNode>) {
  return <StrokeShape {...props} />;
}

export function ArrowNode(props: NodeProps<CanvasFlowNode>) {
  return <StrokeShape {...props} arrow />;
}
