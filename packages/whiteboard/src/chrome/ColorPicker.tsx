import { IconUndo, IconPalette } from "../whiteboard/icons";
import { useId, useMemo, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { colorToHex } from "./color";
import type { WhiteboardLabels } from "../model/protocol";

export function ColorPicker(props: {
  title: string;
  compact?: boolean;
  labels: Pick<
    WhiteboardLabels,
    "commonColors" | "transparent" | "resetColor" | "customColor" | "opacity"
  >;
  color: string;
  defaultColor: string;
  presets: string[];
  allowTransparent?: boolean;
  opacity?: number;
  showReset?: boolean;
  onChange: (color: string) => void;
  onChangeEnd?: () => void;
  onReset: () => void;
  onOpacityChange?: (opacity: number) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const customId = useId();
  const color = useMemo(
    () => colorToHex(props.color) || "#1f2937",
    [props.color],
  );
  const transparent = props.color === "transparent";
  const opacity = props.opacity ?? 1;

  return (
    <div
      className={`zmd-board-color-picker${props.compact ? " is-compact" : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation();
      }}
    >
      {!props.compact ? (
        <header>
          <strong>{props.title}</strong>
        </header>
      ) : null}
      <div
        className="zmd-board-swatches is-palette"
        role="group"
        aria-label={props.labels.commonColors}
      >
        {props.presets.map((item) => (
          <button
            key={item}
            type="button"
            className={!transparent && color === item ? "is-active" : ""}
            aria-pressed={!transparent && color === item}
            aria-label={item}
            title={item}
            style={{ backgroundColor: item }}
            onClick={() => {
              props.onChange(item);
              props.onChangeEnd?.();
            }}
          />
        ))}
      </div>
      <div className="zmd-board-color-actions">
        {props.allowTransparent ? (
          <button
            type="button"
            title={props.labels.transparent}
            aria-label={props.labels.transparent}
            aria-pressed={transparent}
            className={transparent ? "is-active" : ""}
            onClick={() => {
              props.onChange("transparent");
              props.onChangeEnd?.();
            }}
          >
            <span
              className="zmd-board-color-swatch is-transparent"
              aria-hidden="true"
            />
            {!props.compact ? props.labels.transparent : null}
          </button>
        ) : null}
        {props.showReset !== false ? (
          <button
            type="button"
            title={props.labels.resetColor}
            aria-label={props.labels.resetColor}
            onClick={props.onReset}
          >
            <span
              className={`zmd-board-color-swatch${props.defaultColor === "transparent" ? " is-transparent" : ""}`}
              style={{ backgroundColor: props.defaultColor }}
              aria-hidden="true"
            />
            {props.compact ? <IconUndo /> : props.labels.resetColor}
          </button>
        ) : null}
        <button
          type="button"
          className="zmd-board-custom-color-toggle"
          title={props.labels.customColor}
          aria-label={props.labels.customColor}
          aria-expanded={customOpen}
          aria-controls={customId}
          onClick={() => setCustomOpen((open) => !open)}
        >
          {props.compact ? <IconPalette /> : props.labels.customColor}
        </button>
      </div>
      <div
        id={customId}
        className="zmd-board-custom-color-body"
        hidden={!customOpen}
      >
        <HexColorPicker
          color={color}
          onChange={props.onChange}
          onChangeEnd={props.onChangeEnd}
        />
        <label className="zmd-board-color-hex">
          <span>Hex</span>
          <HexColorInput
            color={transparent ? "" : color}
            prefixed
            aria-label={`${props.title} (Hex)`}
            onChange={props.onChange}
            spellCheck={false}
          />
        </label>
        {props.onOpacityChange ? (
          <label className="zmd-board-color-opacity">
            <span>{props.labels.opacity}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(event) =>
                props.onOpacityChange?.(Number(event.target.value) / 100)
              }
            />
            <output>{Math.round(opacity * 100)}%</output>
          </label>
        ) : null}
      </div>
    </div>
  );
}
