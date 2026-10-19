import type { WhiteboardLabels } from "../model/protocol";
import { IconFormatPaint } from "../whiteboard/icons";

export function FormatPaintButton(props: {
  labels: WhiteboardLabels;
  mode?: "single" | "continuous";
  onStart: (continuous: boolean) => void;
  className?: string;
}) {
  const label = props.labels.formatPainter ?? "Format painter";
  const tooltip =
    props.labels.formatPainterTooltip ??
    "Click to apply once; double-click to keep applying";
  return (
    <button
      type="button"
      className={`zmd-board-format-paint${props.mode ? " is-active" : ""}${props.className ? ` ${props.className}` : ""}`}
      title={`${label} · ${tooltip}`}
      aria-label={label}
      aria-pressed={!!props.mode}
      data-format-paint-mode={props.mode}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail < 2) props.onStart(false);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onStart(true);
      }}
    >
      <IconFormatPaint />
    </button>
  );
}
