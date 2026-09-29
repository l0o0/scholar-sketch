import { useEffect, useRef, useState } from "react";
import type { CanvasNodeStyle } from "../model/core";
import type { WhiteboardLabels } from "../model/protocol";
import { IconMore, IconStrokePreview } from "../whiteboard/icons";
import { StyleMenu } from "./StyleMenu";
import { useFloatingStyleBar } from "./FloatingStyleBar";
import { colorToHex } from "./color";

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
              onChange={(stroke, recordHistory) =>
                props.onNodes({ stroke }, recordHistory)
              }
            />
            <BatchColor
              label={labels.background}
              color={props.fill}
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
  onChange: (color: string, recordHistory: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const changingRef = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    const finish = () => {
      changingRef.current = false;
    };
    // React's onChange also fires for input events; the native change event
    // marks the end of the color picker's stream of live previews.
    input?.addEventListener("change", finish);
    return () => input?.removeEventListener("change", finish);
  }, []);
  return (
    <div className="zmd-board-batch-color">
      <label>
        {props.label}
        <input
          ref={inputRef}
          type="color"
          aria-label={props.label}
          value={colorToHex(props.color) ?? "#ffffff"}
          onInput={(event) => {
            const next = event.currentTarget.value;
            const recordHistory = !changingRef.current;
            changingRef.current = true;
            props.onChange(next, recordHistory);
          }}
          onBlur={() => {
            changingRef.current = false;
          }}
        />
      </label>
    </div>
  );
}
