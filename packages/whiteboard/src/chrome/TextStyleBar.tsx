import { IconZotero } from "../whiteboard/icons";
import { useState } from "react";
import {
  canvasThemePalette,
  effectiveCanvasNodeTextStyle,
} from "../model/academic";
import type { CanvasNodeStyle } from "../model/core";
import type { ColorSchemeID } from "../model/colorSchemes";
import type { WhiteboardLabels } from "../model/protocol";
import type { WhiteboardTheme } from "../model/protocol";
import type { CanvasFlowNode } from "../nodes";
import { StyleMenu } from "./StyleMenu";
import { ColorPicker } from "./ColorPicker";
import {
  useFloatingStyleBar,
  type FloatingStyleBarAnchor,
} from "./FloatingStyleBar";
import { colorPalette } from "./color";
import {
  IconAlignTextCenter,
  IconAlignTextLeft,
  IconAlignTextRight,
  IconBold,
  IconItalic,
  IconStrike,
  IconUnderline,
  IconValignBottom,
  IconValignMiddle,
  IconValignTop,
} from "../whiteboard/icons";

const FONTS = [
  { value: "system-ui, sans-serif", label: "fontSystem" },
  { value: "Georgia, serif", label: "fontGeorgia" },
  { value: '"Times New Roman", Times, serif', label: "fontTimes" },
  { value: "Inter, system-ui, sans-serif", label: "fontInter" },
  { value: "Menlo, monospace", label: "fontMenlo" },
  { value: '"Noto Serif SC", serif', label: "fontSerifSc" },
] as const;

const SIZES = [12, 13, 14, 16, 18, 24, 32, 48];

type TextMenu = "format" | "color" | "align" | null;

export function isEditableControl(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") {
    return false;
  }
  return Boolean(
    (target as Element).closest(
      'select, option, input, textarea, summary, [role="slider"]',
    ),
  );
}

export function TextStyleBar(props: {
  node?: CanvasFlowNode;
  textStyle?: CanvasNodeStyle;
  left: number;
  top: number;
  anchor?: FloatingStyleBarAnchor;
  labels: WhiteboardLabels;
  theme: WhiteboardTheme;
  colorScheme?: ColorSchemeID;
  onAddItem?: () => void;
  onChange: (patch: Partial<CanvasNodeStyle>) => void;
  onHoldFocus?: () => void;
}) {
  const { barRef, position } = useFloatingStyleBar(props);
  const style = props.textStyle ?? props.node?.data.model.style ?? {};
  const effective = effectiveCanvasNodeTextStyle(
    props.node?.data.model.kind ?? "text",
    style,
  );
  const [menu, setMenu] = useState<TextMenu>(null);
  const bold = effective.fontWeight === "bold";
  const italic = effective.fontStyle === "italic";
  const underline = effective.textDecoration === "underline";
  const strike = effective.textDecoration === "line-through";
  const align = effective.textAlign;
  const valign = effective.verticalAlign;
  const fontSize = effective.fontSize;
  const fontFamily = style.fontFamily || "";
  const color = style.textColor || canvasThemePalette(props.theme).text;

  return (
    <div
      ref={barRef}
      className="zmd-board-style-bar is-text"
      style={position}
      onPointerDown={(event) => {
        props.onHoldFocus?.();
        event.stopPropagation();
        if (!isEditableControl(event.target)) event.preventDefault();
      }}
    >
      {props.onAddItem ? (
        <button
          type="button"
          title={props.labels.addItem}
          aria-label={props.labels.addItem}
          onClick={() => {
            setMenu(null);
            props.onAddItem?.();
          }}
        >
          <IconZotero />
        </button>
      ) : null}
      <StyleMenu
        preferAbove
        label={props.labels.format}
        icon={<IconBold />}
        open={menu === "format"}
        onOpenChange={(open) => setMenu(open ? "format" : null)}
      >
        <div className="zmd-board-text-options is-mini">
          <button
            type="button"
            title={props.labels.weightBold}
            aria-label={props.labels.weightBold}
            aria-pressed={bold}
            className={bold ? "is-active" : ""}
            onClick={() =>
              props.onChange({ fontWeight: bold ? "normal" : "bold" })
            }
          >
            <IconBold />
          </button>
          <button
            type="button"
            title={props.labels.textItalic}
            aria-label={props.labels.textItalic}
            aria-pressed={italic}
            className={italic ? "is-active" : ""}
            onClick={() =>
              props.onChange({
                fontStyle: italic ? "normal" : "italic",
              })
            }
          >
            <IconItalic />
          </button>
          <button
            type="button"
            title={props.labels.textUnderline}
            aria-label={props.labels.textUnderline}
            aria-pressed={underline}
            className={underline ? "is-active" : ""}
            onClick={() =>
              props.onChange({
                textDecoration: underline ? "none" : "underline",
              })
            }
          >
            <IconUnderline />
          </button>
          <button
            type="button"
            title={props.labels.textStrike}
            aria-label={props.labels.textStrike}
            aria-pressed={strike}
            className={strike ? "is-active" : ""}
            onClick={() =>
              props.onChange({
                textDecoration: strike ? "none" : "line-through",
              })
            }
          >
            <IconStrike />
          </button>
        </div>
      </StyleMenu>
      <StyleMenu
        preferAbove
        label={props.labels.color}
        icon={
          <span className="zmd-board-color-letter" style={{ color }}>
            A
          </span>
        }
        open={menu === "color"}
        onOpenChange={(open) => setMenu(open ? "color" : null)}
        kind="color"
      >
        <ColorPicker
          compact
          title={props.labels.color}
          labels={props.labels}
          color={color}
          defaultColor={canvasThemePalette(props.theme).text}
          presets={colorPalette(props.theme === "dark", props.colorScheme)}
          onReset={() =>
            props.onChange({ textColor: undefined, textOpacity: undefined })
          }
          opacity={effective.textOpacity}
          onChange={(next) => props.onChange({ textColor: next })}
          onOpacityChange={(next) => props.onChange({ textOpacity: next })}
        />
      </StyleMenu>
      <label className="zmd-board-style-group">
        <select
          title={props.labels.fontFamily}
          aria-label={props.labels.fontFamily}
          value={fontFamily}
          onChange={(event) =>
            props.onChange({ fontFamily: event.target.value })
          }
        >
          <option value="">{props.labels.fontDefault}</option>
          {FONTS.map((font) => (
            <option key={font.value} value={font.value}>
              {props.labels[font.label]}
            </option>
          ))}
        </select>
      </label>
      <label className="zmd-board-style-group">
        <select
          title={props.labels.size}
          aria-label={props.labels.size}
          value={fontSize}
          onChange={(event) =>
            props.onChange({ fontSize: Number(event.target.value) })
          }
        >
          {SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <StyleMenu
        preferAbove
        label={props.labels.alignment}
        icon={
          align === "left" ? (
            <IconAlignTextLeft />
          ) : align === "right" ? (
            <IconAlignTextRight />
          ) : (
            <IconAlignTextCenter />
          )
        }
        open={menu === "align"}
        onOpenChange={(open) => setMenu(open ? "align" : null)}
      >
        <div className="zmd-board-text-options is-align">
          <p>{props.labels.textAlignment}</p>
          <div className="zmd-board-align-row">
            <button
              type="button"
              title={props.labels.alignLeft}
              aria-label={props.labels.alignLeft}
              aria-pressed={align === "left"}
              className={align === "left" ? "is-active" : ""}
              onClick={() => props.onChange({ textAlign: "left" })}
            >
              <IconAlignTextLeft />
            </button>
            <button
              type="button"
              title={props.labels.alignHorizontal}
              aria-label={props.labels.alignHorizontal}
              aria-pressed={align === "center"}
              className={align === "center" ? "is-active" : ""}
              onClick={() => props.onChange({ textAlign: "center" })}
            >
              <IconAlignTextCenter />
            </button>
            <button
              type="button"
              title={props.labels.alignRight}
              aria-label={props.labels.alignRight}
              aria-pressed={align === "right"}
              className={align === "right" ? "is-active" : ""}
              onClick={() => props.onChange({ textAlign: "right" })}
            >
              <IconAlignTextRight />
            </button>
          </div>
          {props.node ? (
            <>
              <p>{props.labels.verticalAlignment}</p>
              <div className="zmd-board-align-row">
                <button
                  type="button"
                  title={props.labels.alignTop}
                  aria-label={props.labels.alignTop}
                  aria-pressed={valign === "top"}
                  className={valign === "top" ? "is-active" : ""}
                  onClick={() => props.onChange({ verticalAlign: "top" })}
                >
                  <IconValignTop />
                </button>
                <button
                  type="button"
                  title={props.labels.alignVertical}
                  aria-label={props.labels.alignVertical}
                  aria-pressed={valign === "middle"}
                  className={valign === "middle" ? "is-active" : ""}
                  onClick={() => props.onChange({ verticalAlign: "middle" })}
                >
                  <IconValignMiddle />
                </button>
                <button
                  type="button"
                  title={props.labels.alignBottom}
                  aria-label={props.labels.alignBottom}
                  aria-pressed={valign === "bottom"}
                  className={valign === "bottom" ? "is-active" : ""}
                  onClick={() => props.onChange({ verticalAlign: "bottom" })}
                >
                  <IconValignBottom />
                </button>
              </div>
            </>
          ) : null}
        </div>
      </StyleMenu>
    </div>
  );
}
