import { getPref, setPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import {
  createMarkdownStyleSettings,
  isMarkdownStyleSettings,
  resolveSelectedStyle,
  type MarkdownStyleSettings,
} from "./style-presets";

export function readMarkdownStyleSettings(): MarkdownStyleSettings {
  const saved = getPref("markdownStyles");
  if (saved) {
    const value: unknown = JSON.parse(saved);
    if (!isMarkdownStyleSettings(value))
      throw new Error("Invalid Markdown style settings");
    return value;
  }
  return createMarkdownStyleSettings({
    fontSize: getPref("fontSize"),
    fontFamily: getPref("markdownFontFamily"),
    backgroundColor: getPref("markdownBackgroundColor"),
    name: getString("settings-style-current"),
  });
}

export function writeMarkdownStyleSettings(
  settings: MarkdownStyleSettings,
): void {
  setPref("markdownStyles", JSON.stringify(settings));
}

export function currentMarkdownStyle() {
  return resolveSelectedStyle(readMarkdownStyleSettings());
}
