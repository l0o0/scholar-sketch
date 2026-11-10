import {
  BUILTIN_STYLE_PRESETS,
  createMarkdownStyleSettings as createLegacyStyleSettings,
  isMarkdownStyleSettings as isLegacyStyleSettings,
  type MarkdownStyleSettings as LegacyStyleSettings,
} from "./style-presets";
import {
  compileMarkdownStyleCss,
  serializeMarkdownStyleCss,
} from "./style-css";

export interface MarkdownCssPreset {
  id: string;
  name: string;
  css: string;
}

/** CSS is authoritative; the renderer model is derived when a preset is used. */
export interface MarkdownStyleSettings {
  version: 2;
  selectedId: string;
  presets: MarkdownCssPreset[];
}

export const BUILTIN_CSS_PRESETS: readonly MarkdownCssPreset[] =
  BUILTIN_STYLE_PRESETS.map(({ id, name, style }) => ({
    id,
    name,
    css: serializeMarkdownStyleCss(style),
  }));

function fromLegacy(settings: LegacyStyleSettings): MarkdownStyleSettings {
  return {
    version: 2,
    selectedId: settings.selectedId,
    presets: settings.presets.map(({ id, name, style }) => ({
      id,
      name,
      css: serializeMarkdownStyleCss(style),
    })),
  };
}

export function createMarkdownStyleSettings(
  legacy?: Parameters<typeof createLegacyStyleSettings>[0],
): MarkdownStyleSettings {
  return fromLegacy(createLegacyStyleSettings(legacy));
}

export function getSelectedStyleCss(settings: MarkdownStyleSettings): string {
  return (
    [...BUILTIN_CSS_PRESETS, ...settings.presets].find(
      (preset) => preset.id === settings.selectedId,
    )?.css ?? BUILTIN_CSS_PRESETS[0].css
  );
}

export function resolveSelectedStyle(settings: MarkdownStyleSettings) {
  const result = compileMarkdownStyleCss(getSelectedStyleCss(settings));
  if (!result.ok) throw new Error("Invalid Markdown style CSS");
  return result.style;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate configuration before CSS reaches the compiler and rendering bridge. */
export function isMarkdownStyleSettings(
  value: unknown,
): value is MarkdownStyleSettings {
  if (!record(value) || value.version !== 2 || !Array.isArray(value.presets))
    return false;
  const ids = new Set(BUILTIN_CSS_PRESETS.map(({ id }) => id));
  for (const preset of value.presets) {
    if (
      !record(preset) ||
      typeof preset.id !== "string" ||
      !preset.id.trim() ||
      ids.has(preset.id) ||
      typeof preset.name !== "string" ||
      !preset.name.trim() ||
      typeof preset.css !== "string" ||
      !compileMarkdownStyleCss(preset.css).ok
    )
      return false;
    ids.add(preset.id);
  }
  return typeof value.selectedId === "string" && ids.has(value.selectedId);
}

/** Upgrade in memory; only the settings Done action persists the new format. */
export function normalizeMarkdownStyleSettings(
  value: unknown,
): MarkdownStyleSettings {
  if (isLegacyStyleSettings(value)) return fromLegacy(value);
  if (isMarkdownStyleSettings(value)) return value;
  throw new Error("Invalid Markdown style settings");
}
