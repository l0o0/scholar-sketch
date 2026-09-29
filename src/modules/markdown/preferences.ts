export type AppearanceTheme = "system" | "light" | "dark";
export type FontFamilyID = "system" | "serif" | "mono";

export const FONT_FAMILY_CSS: Record<FontFamilyID, string> = {
  system:
    'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Noto Serif SC", "Songti SC", serif',
  mono: 'ui-monospace, "Sarasa Mono SC", "Noto Sans Mono CJK SC", Menlo, Monaco, Consolas, monospace',
};

export function normalizeAppearanceTheme(value: unknown): AppearanceTheme {
  return value === "light" || value === "dark" ? value : "system";
}

export const normalizeTheme = normalizeAppearanceTheme;

export function normalizeFontFamily(value: unknown): FontFamilyID {
  return value === "serif" || value === "mono" ? value : "system";
}

export function normalizeColor(value: unknown, fallback = ""): string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}

export const normalizeBackgroundColor = normalizeColor;

export function appearanceFontFamily(value: unknown): string {
  return FONT_FAMILY_CSS[normalizeFontFamily(value)];
}
