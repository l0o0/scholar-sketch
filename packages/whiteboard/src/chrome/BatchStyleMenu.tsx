import { useRef, useState } from "react";
import type { CanvasNodeStyle } from "../model/core";
import type { ColorSchemeID } from "../model/colorSchemes";
import type { WhiteboardLabels } from "../model/protocol";
import { IconMore, IconStrokePreview } from "../whiteboard/icons";
import { StyleMenu } from "./StyleMenu";
import { useFloatingStyleBar } from "./FloatingStyleBar";
import { colorPalette } from "./color";
import { ColorPicker } from "./ColorPicker";

export interface BatchEdgeStyle {
  color?: string;
  dashed?: boolean;
  arrow?: boolean;
  startArrow?: boolean;
}

/** Explicit target values make mixed selections converge instead of toggling independently. */
export function BatchStyleMenu(props: {
  left: number;
  top: number;
  nodeCount: number;
  edgeCount: number;
  stroke: string;
  fill: string;
  edgeColor: string;
  colorScheme?: ColorSchemeID;
  labels: WhiteboardLabels;
  onNodes: (patch: Partial<CanvasNodeStyle>, recordHistory?: boolean) => void;
  onEdges: (patch: BatchEdgeStyle, recordHistory?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const { barRef, position } = useFloatingStyleBar(props);
  const { labels } = props;
  return (
    <div
      ref={barRef}
      className="zmd-board-style-bar zmd-board-batch-style nodrag nopan"
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <StyleMenu
        kind="batch"
        label={labels.batchStyle ?? labels.style}
        icon={<IconMore />}
        open={open}
        onOpenChange={setOpen}
      >
        {props.nodeCount > 0 && (
          <fieldset>
            <legend>
              {labels.selection} · {props.nodeCount}
            </legend>
            <BatchColor
              label={labels.stroke}
              color={props.stroke}
              labels={labels}
              colorScheme={props.colorScheme}
              onChange={(stroke, recordHistory) =>
                props.onNodes({ stroke }, recordHistory)
              }
            />
            <BatchColor
              label={labels.background}
              color={props.fill}
              labels={labels}
              colorScheme={props.colorScheme}
              onChange={(fill, recordHistory) =>
                props.onNodes({ fill, fillStyle: "solid" }, recordHistory)
              }
            />
            <div className="zmd-board-batch-options">
              <button
                type="button"
                title={labels.solid}
                aria-label={labels.solid}
                onClick={() =>
                  props.onNodes({ dashed: false, strokeStyle: "solid" })
                }
              >
                <IconStrokePreview dashed={false} />
              </button>
              <button
                type="button"
                title={labels.dashed}
                aria-label={labels.dashed}
                onClick={() =>
                  props.onNodes({ dashed: true, strokeStyle: "dashed" })
                }
              >
                <IconStrokePreview dashed={true} />
              </button>
            </div>
          </fieldset>
        )}
        {props.edgeCount > 0 && (
          <fieldset>
            <legend>
              {labels.edgeSelection} · {props.edgeCount}
            </legend>
            <BatchColor
              label={labels.edgeColor}
              color={props.edgeColor}
              labels={labels}
              colorScheme={props.colorScheme}
              onChange={(color, recordHistory) =>
                props.onEdges({ color }, recordHistory)
              }
            />
            <div className="zmd-board-batch-options">
              <button
                type="button"
                title={labels.solid}
                aria-label={labels.solid}
                onClick={() => props.onEdges({ dashed: false })}
              >
                <IconStrokePreview dashed={false} />
              </button>
              <button
                type="button"
                title={labels.dashed}
                aria-label={labels.dashed}
                onClick={() => props.onEdges({ dashed: true })}
              >
                <IconStrokePreview dashed={true} />
              </button>
            </div>
            <div className="zmd-board-batch-options">
              {(
                [
                  [labels.arrowNone, false, false],
                  [labels.arrowForward, true, false],
                  [labels.arrowReverse, false, true],
                  [labels.arrowBoth, true, true],
                ] as const
              ).map(([label, arrow, startArrow]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => props.onEdges({ arrow, startArrow })}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        )}
      </StyleMenu>
    </div>
  );
}

function BatchColor(props: {
  label: string;
  color: string;
  labels: WhiteboardLabels;
  colorScheme?: ColorSchemeID;
  onChange: (color: string, recordHistory: boolean) => void;
}) {
  const changingRef = useRef(false);
  return (
    <div
      className="zmd-board-batch-color"
      onPointerUp={() => {
        changingRef.current = false;
      }}
      onBlur={() => {
        changingRef.current = false;
      }}
      onKeyUp={() => {
        changingRef.current = false;
      }}
    >
      <span className="zmd-board-batch-color-label">{props.label}</span>
      <ColorPicker
        compact
        title={props.label}
        labels={props.labels}
        color={props.color}
        defaultColor={props.color}
        presets={colorPalette(true, props.colorScheme)}
        showReset={false}
        onReset={() => {}}
        onChangeEnd={() => {
          changingRef.current = false;
        }}
        onChange={(next) => {
          const recordHistory = !changingRef.current;
          changingRef.current = true;
          props.onChange(next, recordHistory);
        }}
      />
    </div>
  );
}
