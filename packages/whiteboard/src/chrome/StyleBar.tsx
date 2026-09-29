import { useState, type Ref } from "react";
import { ColorPicker } from "./ColorPicker";
import { colorPalette } from "./color";
import type { ColorSchemeID } from "../model/colorSchemes";
import { useFloatingStyleBar } from "./FloatingStyleBar";
import type { CanvasNodeStyle } from "../model/core";
import {
  canvasNodeUiSurfaceDefaults,
  getNoteType,
  type CanvasNodeKind,
} from "../model/academic";
import type { WhiteboardLabels } from "../model/protocol";
import type { WhiteboardTheme } from "../model/protocol";
import type { CanvasFlowNode } from "../nodes";
import {
  IconCorners,
  IconEdit,
  IconMore,
  IconProperties,
  IconStrokePreview,
  IconStrokeWeight,
} from "../whiteboard/icons";

import { StyleMenu, StyleOption } from "./StyleMenu";

const WIDTHS = [1, 2, 4];
const RADII = [0, 8, 16, 32];

export function supportsFillStyle(kind: CanvasNodeKind): boolean {
  return kind !== "line" && kind !== "arrow";
}

export function supportsRadiusStyle(kind: CanvasNodeKind): boolean {
  return kind !== "ellipse" && kind !== "line" && kind !== "arrow";
}

export function StyleBar(props: {
  node: CanvasFlowNode;
  left: number;
  top: number;
  anchor?: { x: number; y: number; width: number; height: number };
  labels: WhiteboardLabels;
  theme: WhiteboardTheme;
  colorScheme?: ColorSchemeID;
  onEdit?: () => void;
  onToggleDetails?: () => void;
  detailsOpen?: boolean;
  detailsButtonRef?: Ref<HTMLButtonElement>;
  onChange: (
    patch: Partial<CanvasNodeStyle> & {
      width?: number;
      height?: number;
      x?: number;
      y?: number;
    },
  ) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const { barRef, position } = useFloatingStyleBar(props);
  const { node } = props;
  const model = node.data.model;
  const style = model.style ?? {};
  const kind = model.kind;
  const defaults = canvasNodeUiSurfaceDefaults(
    kind,
    props.theme,
    model.kind === "note" ? getNoteType(model) : undefined,
  );
  const stroke = style.stroke || defaults.stroke;
  const fill =
    style.fillStyle === "none" ? "transparent" : style.fill || defaults.fill;
  const strokeWidth = style.strokeWidth ?? defaults.strokeWidth;
  const radius = style.radius ?? defaults.radius;
  const dashed =
    style.strokeStyle !== undefined
      ? style.strokeStyle !== "solid"
      : (style.dashed ?? defaults.strokeStyle !== "solid");
  const width = Math.round(node.width ?? 120);
  const height = Math.round(node.height ?? 80);
  const showFill = supportsFillStyle(kind);
  const showRadius = supportsRadiusStyle(kind);
  const editLabel =
    kind === "note" ? props.labels.editNoteBody : props.labels.editText;

  return (
    <div
      ref={barRef}
      className="zmd-board-style-bar is-selection"
      role="toolbar"
      aria-label={props.labels.selection}
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.onEdit ? (
        <button
          type="button"
          className="zmd-board-selection-edit"
          title={editLabel}
          aria-label={editLabel}
          onClick={() => {
            setMenu(null);
            props.onEdit?.();
          }}
        >
          <IconEdit />
        </button>
      ) : null}
      <div className="zmd-board-style-controls">
        {(["stroke", "fill"] as const)
          .filter((target) => target === "stroke" || showFill)
          .map((target) => {
            const color = target === "stroke" ? stroke : fill;
            const title =
              target === "stroke"
                ? props.labels.stroke
                : props.labels.background;
            return (
              <StyleMenu
                key={target}
                label={title}
                kind="color"
                colorTarget={target}
                open={menu === target}
                onOpenChange={(open) => setMenu(open ? target : null)}
                icon={
                  <span
                    className={`zmd-board-color-swatch is-${target}${color === "transparent" ? " is-transparent" : ""}`}
                    style={
                      target === "stroke"
                        ? { borderColor: color }
                        : { backgroundColor: color }
                    }
                    aria-hidden="true"
                  />
                }
              >
                <ColorPicker
                  compact
                  title={title}
                  labels={props.labels}
                  color={color}
                  presets={colorPalette(
                    target === "fill"
                      ? props.theme === "light"
                      : props.theme === "dark",
                    props.colorScheme,
                  )}
                  defaultColor={defaults[target]}
                  allowTransparent={target === "fill"}
                  onReset={() =>
                    props.onChange(
                      target === "stroke"
                        ? { stroke: undefined }
                        : { fill: undefined, fillStyle: undefined },
                    )
                  }
                  onChange={(next) =>
                    props.onChange(
                      target === "stroke"
                        ? { stroke: next }
                        : {
                            fill: next,
                            fillStyle:
                              next === "transparent"
                                ? "none"
                                : style.fillStyle === "hatch"
                                  ? "hatch"
                                  : "solid",
                          },
                    )
                  }
                />
              </StyleMenu>
            );
          })}
        <StyleMenu
          label={props.labels.strokeWidth}
          description={`${props.labels.strokeWidth}: ${strokeWidth} px`}
          open={menu === "width"}
          onOpenChange={(open) => setMenu(open ? "width" : null)}
          icon={<IconStrokeWeight />}
        >
          {Array.from(new Set([...WIDTHS, strokeWidth]))
            .sort((a, b) => a - b)
            .map((value) => (
              <StyleOption
                key={value}
                label={`${value} px`}
                selected={value === strokeWidth}
                onClick={() => props.onChange({ strokeWidth: value })}
              >
                <IconStrokePreview width={value} />
              </StyleOption>
            ))}
        </StyleMenu>
        <StyleMenu
          label={props.labels.edgeStyle}
          description={`${props.labels.edgeStyle}: ${dashed ? props.labels.dashed : props.labels.solid}`}
          open={menu === "line"}
          onOpenChange={(open) => setMenu(open ? "line" : null)}
          icon={<IconStrokePreview dashed={dashed} />}
        >
          {[false, true].map((value) => (
            <StyleOption
              key={String(value)}
              label={value ? props.labels.dashed : props.labels.solid}
              selected={value === dashed}
              onClick={() =>
                props.onChange({
                  dashed: value,
                  strokeStyle: value ? "dashed" : "solid",
                })
              }
            >
              <IconStrokePreview dashed={value} />
            </StyleOption>
          ))}
        </StyleMenu>
        {showRadius ? (
          <StyleMenu
            label={props.labels.corners}
            description={`${props.labels.corners}: ${radius}`}
            open={menu === "radius"}
            onOpenChange={(open) => setMenu(open ? "radius" : null)}
            icon={<IconCorners radius={radius} />}
          >
            {Array.from(new Set([...RADII, radius]))
              .sort((a, b) => a - b)
              .map((value) => (
                <StyleOption
                  key={value}
                  label={`${props.labels.corners}: ${value}`}
                  selected={value === radius}
                  onClick={() => props.onChange({ radius: value })}
                >
                  <IconCorners radius={value} />
                </StyleOption>
              ))}
          </StyleMenu>
        ) : null}
      </div>
      <StyleMenu
        label={props.labels.geometry}
        kind="geometry"
        icon={<IconMore />}
        open={menu === "geometry"}
        onOpenChange={(open) => setMenu(open ? "geometry" : null)}
      >
        {(
          [
            ["width", "W", props.labels.nodeWidth, width],
            ["height", "H", props.labels.nodeHeight, height],
            ["x", "X", props.labels.positionX, node.position.x],
            ["y", "Y", props.labels.positionY, node.position.y],
          ] as const
        ).map(([key, symbol, label, value]) => (
          <label className="zmd-board-geometry-field" key={key} title={label}>
            <span aria-hidden="true">{symbol}</span>
            <input
              key={`${node.id}-${key}-${value}`}
              type="number"
              step="any"
              aria-label={label}
              title={label}
              min={key === "width" || key === "height" ? 8 : undefined}
              defaultValue={value}
              onBlur={(event) => {
                const raw = event.currentTarget.value;
                const parsed = Number(raw);
                const next =
                  key === "width" || key === "height"
                    ? Math.max(8, parsed)
                    : parsed;
                if (raw.trim() && Number.isFinite(next) && next !== value)
                  props.onChange({ [key]: next });
                else event.currentTarget.value = String(value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        ))}
      </StyleMenu>
      {props.onToggleDetails ? (
        <button
          ref={props.detailsButtonRef}
          type="button"
          className={`zmd-board-selection-details${props.detailsOpen ? " is-active" : ""}`}
          title={props.labels.selectionDetails}
          aria-label={props.labels.selectionDetails}
          aria-expanded={!!props.detailsOpen}
          onClick={() => {
            setMenu(null);
            props.onToggleDetails?.();
          }}
        >
          <IconProperties />
        </button>
      ) : null}
    </div>
  );
}
