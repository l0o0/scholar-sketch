import { useState } from "react";
import { ColorPicker } from "./ColorPicker";
import { colorPalette } from "./color";
import { useFloatingStyleBar } from "./FloatingStyleBar";
import type { WhiteboardLabels, WhiteboardTheme } from "../model/protocol";
import type { ColorSchemeID } from "../model/colorSchemes";
import type { CanvasFlowEdge } from "../whiteboard/document";
import { StyleMenu, StyleOption } from "./StyleMenu";
import { IconEdit, IconStrokePreview } from "../whiteboard/icons";

const DEFAULT_EDGE_COLOR = "#9ca3af";

type ArrowValue = "none" | "forward" | "reverse" | "both";
function arrowValue(edge: CanvasFlowEdge): ArrowValue {
  const end = Boolean(edge.markerEnd);
  const start = Boolean(edge.markerStart);
  if (start && end) return "both";
  if (start) return "reverse";
  if (end) return "forward";
  return "none";
}

export function EdgeStyleBar(props: {
  edge: CanvasFlowEdge;
  labels: WhiteboardLabels;
  theme: WhiteboardTheme;
  colorScheme?: ColorSchemeID;
  anchor: { x: number; y: number; width: number; height: number };
  onChange: (patch: {
    color?: string;
    dashed?: boolean;
    arrow?: boolean;
    startArrow?: boolean;
  }) => void;
  onEdit: () => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const { barRef, position } = useFloatingStyleBar({
    left: 0,
    top: 0,
    anchor: props.anchor,
  });
  const color =
    typeof props.edge.style?.stroke === "string"
      ? props.edge.style.stroke
      : (props.edge.data?.connection.color ?? DEFAULT_EDGE_COLOR);
  const dashed = Boolean(props.edge.style?.strokeDasharray);
  const arrows = arrowValue(props.edge);

  return (
    <div
      ref={barRef}
      className="zmd-board-style-bar is-edge"
      role="toolbar"
      aria-label={props.labels.edgeSelection}
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zmd-board-selection-edit"
        title={props.labels.edgeLabel}
        aria-label={props.labels.edgeLabel}
        onClick={() => {
          setMenu(null);
          props.onEdit();
        }}
      >
        <IconEdit />
      </button>
      <div className="zmd-board-style-controls">
        <StyleMenu
          label={props.labels.edgeColor}
          kind="color"
          colorTarget="color"
          icon={
            <span
              className="zmd-board-color-swatch is-edge-color"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
          }
          open={menu === "color"}
          onOpenChange={(open) => setMenu(open ? "color" : null)}
        >
          <ColorPicker
            compact
            title={props.labels.edgeColor}
            labels={props.labels}
            color={color}
            presets={colorPalette(props.theme === "dark", props.colorScheme)}
            defaultColor={DEFAULT_EDGE_COLOR}
            onReset={() => props.onChange({ color: DEFAULT_EDGE_COLOR })}
            onChange={(next) => props.onChange({ color: next })}
          />
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
              onClick={() => props.onChange({ dashed: value })}
            >
              <IconStrokePreview dashed={value} />
            </StyleOption>
          ))}
        </StyleMenu>
        <StyleMenu
          label={props.labels.edgeArrows}
          open={menu === "arrows"}
          onOpenChange={(open) => setMenu(open ? "arrows" : null)}
          icon={
            <IconStrokePreview
              start={arrows === "reverse" || arrows === "both"}
              end={arrows === "forward" || arrows === "both"}
            />
          }
        >
          {(
            [
              ["none", props.labels.arrowNone],
              ["forward", props.labels.arrowForward],
              ["reverse", props.labels.arrowReverse],
              ["both", props.labels.arrowBoth],
            ] as const
          ).map(([value, label]) => (
            <StyleOption
              key={value}
              label={label}
              selected={arrows === value}
              onClick={() =>
                props.onChange({
                  arrow: value === "forward" || value === "both",
                  startArrow: value === "reverse" || value === "both",
                })
              }
            >
              <IconStrokePreview
                start={value === "reverse" || value === "both"}
                end={value === "forward" || value === "both"}
              />
            </StyleOption>
          ))}
        </StyleMenu>
      </div>
    </div>
  );
}
