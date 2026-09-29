import type { CSSProperties, ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  canvasNodeSurfaceDefaults,
  canvasNodeUiSurfaceDefaults,
  type NoteType,
  type CanvasNodeKind,
} from "../model/academic";
import type { CanvasNodeStyle } from "../model/core";
import { IconItem, NoteTypeIcon, IconQuote } from "../whiteboard/icons";

export function NodeHandles() {
  return (
    <>
      {[Position.Right, Position.Left, Position.Top, Position.Bottom].map(
        (side) => (
          <Handle key={side} id={side} type="source" position={side} />
        ),
      )}
    </>
  );
}

export function nodeSurfaceFill(
  kind: CanvasNodeKind,
  style: Partial<CanvasNodeStyle>,
): string | undefined {
  if (style.fillStyle === "none" || style.fill === "transparent") {
    return "transparent";
  }
  const defaultFill = canvasNodeSurfaceDefaults(kind).fill;
  if (defaultFill === "transparent" && style.fill === undefined) {
    return style.fillStyle === "hatch" ? "transparent" : undefined;
  }
  if (style.fillStyle === "hatch") {
    const fill = style.fill || `var(--zmd-board-surface, ${defaultFill})`;
    return `repeating-linear-gradient(135deg, ${fill} 0, ${fill} 6px, rgba(148, 163, 184, 0.25) 6px, rgba(148, 163, 184, 0.25) 8px)`;
  }
  return style.fill;
}

export function nodeSurfaceStroke(
  kind: CanvasNodeKind,
  style: Partial<CanvasNodeStyle>,
): string | undefined {
  if (style.strokeOpacity === undefined) return style.stroke;
  const opacity = Math.max(0, Math.min(1, style.strokeOpacity));
  const defaultStroke = canvasNodeSurfaceDefaults(kind).stroke;
  const fallback =
    kind === "line" || kind === "arrow"
      ? `var(--zmd-board-edge, ${defaultStroke})`
      : kind === "rect" || kind === "ellipse"
        ? `var(--zmd-board-text, ${defaultStroke})`
        : `var(--zmd-board-border, ${defaultStroke})`;
  return `color-mix(in srgb, ${style.stroke || fallback} ${opacity * 100}%, transparent)`;
}

export function nodeSurfaceStyle(
  kind: CanvasNodeKind,
  style: Partial<CanvasNodeStyle>,
): CSSProperties {
  const stroke = nodeSurfaceStroke(kind, style);
  const fill = nodeSurfaceFill(kind, style);
  const strokeStyle =
    style.strokeStyle ??
    (style.dashed === undefined
      ? undefined
      : style.dashed
        ? "dashed"
        : "solid");
  return {
    ...(stroke !== undefined ? { "--zmd-board-node-stroke": stroke } : {}),
    ...(fill !== undefined ? { "--zmd-board-node-fill": fill } : {}),
    ...(style.strokeWidth !== undefined
      ? { "--zmd-board-node-stroke-width": `${style.strokeWidth}px` }
      : {}),
    ...(strokeStyle !== undefined
      ? { "--zmd-board-node-stroke-style": strokeStyle }
      : {}),
    ...(style.radius !== undefined
      ? { "--zmd-board-node-radius": `${style.radius}px` }
      : {}),
  } as CSSProperties;
}

export function nodeContentAlignmentStyle(
  style: Partial<CanvasNodeStyle>,
): CSSProperties {
  if (style.verticalAlign === undefined) return {};
  return {
    justifyContent:
      style.verticalAlign === "top"
        ? "flex-start"
        : style.verticalAlign === "bottom"
          ? "safe flex-end"
          : "safe center",
  };
}

export function CardShell(props: {
  kind: CanvasNodeKind;
  kindLabel: string;
  kindIcon?: ReactNode;
  showKindLabel?: boolean;
  badge?: string;
  noteType?: NoteType;
  selected?: boolean;
  nodeStyle?: Partial<CanvasNodeStyle>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const nodeStyle = props.nodeStyle ?? {};
  const light =
    props.noteType && props.noteType !== "note"
      ? canvasNodeUiSurfaceDefaults("note", "light", props.noteType)
      : undefined;
  const dark =
    props.noteType && props.noteType !== "note"
      ? canvasNodeUiSurfaceDefaults("note", "dark", props.noteType)
      : undefined;
  const surfaceStyle = light
    ? {
        ...light,
        fill: "var(--zmd-note-type-fill)",
        stroke: "var(--zmd-note-type-stroke)",
        ...nodeStyle,
        strokeStyle:
          nodeStyle.strokeStyle ??
          (nodeStyle.dashed === undefined
            ? light.strokeStyle
            : nodeStyle.dashed
              ? "dashed"
              : "solid"),
      }
    : nodeStyle;
  const kindIcon =
    props.kindIcon ??
    (props.kind === "literature" ? (
      <IconItem />
    ) : props.kind === "quote" ? (
      <IconQuote />
    ) : props.kind === "note" ? (
      <NoteTypeIcon type={props.noteType ?? "note"} />
    ) : null);
  return (
    <article
      className={`zmd-board-card is-${props.kind}${props.selected ? " is-selected" : ""}`}
      data-note-type={props.noteType}
      style={
        {
          ...(light && dark
            ? {
                "--zmd-note-fill-light": light.fill,
                "--zmd-note-fill-dark": dark.fill,
                "--zmd-note-stroke-light": light.stroke,
                "--zmd-note-stroke-dark": dark.stroke,
              }
            : {}),
          ...nodeSurfaceStyle(props.kind, surfaceStyle),
          ...(nodeStyle.textColor
            ? {
                color: nodeStyle.textColor,
                "--zmd-card-emphasis": nodeStyle.textColor,
              }
            : {}),
        } as CSSProperties
      }
    >
      <NodeHandles />
      <header
        className="zmd-board-card-header"
        title={props.kindLabel}
        aria-label={props.kindLabel}
      >
        {kindIcon ? (
          props.showKindLabel === false ? (
            <span
              className="zmd-board-card-kind-icon"
              role="img"
              aria-label={props.kindLabel}
            >
              {kindIcon}
            </span>
          ) : (
            kindIcon
          )
        ) : null}
        {props.showKindLabel === false ? null : (
          <span className="zmd-board-card-kind">{props.kindLabel}</span>
        )}
        {props.badge ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="zmd-board-note-badge">{props.badge}</span>
          </>
        ) : null}
      </header>
      <div
        className="zmd-board-card-body nowheel"
        style={nodeContentAlignmentStyle(nodeStyle)}
      >
        {props.children}
      </div>
      {props.footer ? (
        <div className="zmd-board-card-footer">{props.footer}</div>
      ) : null}
    </article>
  );
}
