import type { FontFamilyID } from "./preferences";

export interface MarkdownHeadingStyle {
  size: number;
  weight: number;
  before: number;
  after: number;
}

export interface MarkdownStyleColors {
  background: string;
  text: string;
  heading: string;
  link: string;
  accent: string;
  quoteBackground: string;
  quoteBorder: string;
  codeBackground: string;
  codeBorder: string;
  tableHeader: string;
  tableBorder: string;
}

/** Typography is shared; palettes follow the host's current light/dark mode. */
export interface MarkdownStyle {
  fontFamily: FontFamilyID;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  contentWidth: number;
  headings: MarkdownHeadingStyle[];
  light: MarkdownStyleColors;
  dark: MarkdownStyleColors;
}

export interface MarkdownStylePreset {
  id: string;
  name: string;
  style: MarkdownStyle;
}

export interface MarkdownStyleSettings {
  version: 1;
  selectedId: string;
  presets: MarkdownStylePreset[];
}

export const DEFAULT_MARKDOWN_STYLE: MarkdownStyle = {
  fontFamily: "system",
  fontSize: 15,
  lineHeight: 1.75,
  paragraphSpacing: 0.75,
  contentWidth: 800,
  headings: [
    { size: 1.75, weight: 700, before: 0.65, after: 0.35 },
    { size: 1.4, weight: 650, before: 0.8, after: 0.35 },
    { size: 1.2, weight: 600, before: 0.65, after: 0.25 },
    { size: 1.05, weight: 600, before: 0.5, after: 0.2 },
    { size: 1.05, weight: 600, before: 0.5, after: 0.2 },
    { size: 1.05, weight: 600, before: 0.5, after: 0.2 },
  ],
  light: {
    background: "#ffffff",
    text: "#24272c",
    heading: "#24272c",
    link: "#2563eb",
    accent: "#2563eb",
    quoteBackground: "#f7f8fa",
    quoteBorder: "#d1d5db",
    codeBackground: "#f6f7f9",
    codeBorder: "#e6e8ec",
    tableHeader: "#f3f4f6",
    tableBorder: "#d1d5db",
  },
  dark: {
    background: "#1a1d24",
    text: "#e8eaed",
    heading: "#e8eaed",
    link: "#60a5fa",
    accent: "#60a5fa",
    quoteBackground: "#22262f",
    quoteBorder: "#3d4452",
    codeBackground: "#2a2d33",
    codeBorder: "#2e3440",
    tableHeader: "#292c32",
    tableBorder: "#3d4452",
  },
};

export function cloneMarkdownStyle(style: MarkdownStyle): MarkdownStyle {
  return {
    ...style,
    headings: style.headings.map((heading) => ({ ...heading })),
    light: { ...style.light },
    dark: { ...style.dark },
  };
}

const paper = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
paper.fontFamily = "serif";
paper.fontSize = 17;
paper.lineHeight = 1.9;
paper.contentWidth = 760;
paper.light = {
  background: "#faf7ef",
  text: "#38342e",
  heading: "#29251f",
  link: "#72532a",
  accent: "#8b652f",
  quoteBackground: "#f1ebdf",
  quoteBorder: "#c4b49a",
  codeBackground: "#f1ebdf",
  codeBorder: "#d8cdbb",
  tableHeader: "#eee6d7",
  tableBorder: "#d8cdbb",
};
paper.dark = {
  background: "#24221f",
  text: "#e9e3d7",
  heading: "#f3ecdf",
  link: "#d6b779",
  accent: "#d6b779",
  quoteBackground: "#2e2b25",
  quoteBorder: "#5d5445",
  codeBackground: "#302d27",
  codeBorder: "#504a40",
  tableHeader: "#353128",
  tableBorder: "#504a40",
};
const compact = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
compact.fontSize = 14;
compact.lineHeight = 1.5;
compact.paragraphSpacing = 0.4;
compact.contentWidth = 960;
compact.headings = compact.headings.map((heading) => ({
  ...heading,
  before: heading.before * 0.7,
  after: heading.after * 0.7,
}));

export const BUILTIN_STYLE_PRESETS: readonly MarkdownStylePreset[] = [
  { id: "default", name: "Default", style: DEFAULT_MARKDOWN_STYLE },
  { id: "paper", name: "Paper", style: paper },
  { id: "compact", name: "Compact", style: compact },
];

export function resolveSelectedStyle(
  settings: MarkdownStyleSettings,
): MarkdownStyle {
  const preset = [...BUILTIN_STYLE_PRESETS, ...settings.presets].find(
    (candidate) => candidate.id === settings.selectedId,
  );
  // Settings are validated when loaded; this also handles deletion of an active draft.
  return preset?.style ?? DEFAULT_MARKDOWN_STYLE;
}

export function createMarkdownStyleSettings(legacy?: {
  fontSize?: unknown;
  fontFamily?: unknown;
  backgroundColor?: unknown;
  name?: string;
}): MarkdownStyleSettings {
  const style = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
  if (
    typeof legacy?.fontSize === "number" &&
    Number.isFinite(legacy.fontSize)
  ) {
    style.fontSize = Math.min(22, Math.max(11, legacy.fontSize));
  }
  if (legacy?.fontFamily === "serif" || legacy?.fontFamily === "mono") {
    style.fontFamily = legacy.fontFamily;
  }
  const background = legacy?.backgroundColor;
  if (typeof background === "string" && /^#[\da-f]{6}$/i.test(background)) {
    const [r, g, b] = [1, 3, 5].map((start) =>
      parseInt(background.slice(start, start + 2), 16),
    );
    const colors =
      0.2126 * r + 0.7152 * g + 0.0722 * b < 140 ? style.dark : style.light;
    // Old fixed backgrounds selected readable foreground colors regardless of host mode.
    style.light = { ...colors, background: background.toLowerCase() };
    style.dark = { ...colors, background: background.toLowerCase() };
  }
  if (JSON.stringify(style) === JSON.stringify(DEFAULT_MARKDOWN_STYLE)) {
    return { version: 1, selectedId: "default", presets: [] };
  }
  return {
    version: 1,
    selectedId: "previous-appearance",
    presets: [
      {
        id: "previous-appearance",
        name: legacy?.name || "Current appearance",
        style,
      },
    ],
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function within(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}
function validColors(value: unknown): value is MarkdownStyleColors {
  return (
    record(value) &&
    Object.keys(DEFAULT_MARKDOWN_STYLE.light).every(
      (key) =>
        typeof value[key] === "string" &&
        /^#[\da-f]{6}$/i.test(value[key] as string),
    )
  );
}

/** Validate preferences and iframe messages before values reach CSS. */
export function isMarkdownStyle(value: unknown): value is MarkdownStyle {
  if (!record(value)) return false;
  return (
    ["system", "serif", "mono"].includes(value.fontFamily as string) &&
    within(value.fontSize, 11, 32) &&
    within(value.lineHeight, 1.2, 2.4) &&
    within(value.paragraphSpacing, 0, 2) &&
    within(value.contentWidth, 360, 1200) &&
    Array.isArray(value.headings) &&
    value.headings.length === 6 &&
    value.headings.every(
      (heading) =>
        record(heading) &&
        within(heading.size, 0.8, 3) &&
        within(heading.weight, 400, 800) &&
        within(heading.before, 0, 3) &&
        within(heading.after, 0, 2),
    ) &&
    validColors(value.light) &&
    validColors(value.dark)
  );
}

export function isMarkdownStyleSettings(
  value: unknown,
): value is MarkdownStyleSettings {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.presets))
    return false;
  const ids = new Set(BUILTIN_STYLE_PRESETS.map(({ id }) => id));
  for (const preset of value.presets) {
    if (
      !record(preset) ||
      typeof preset.id !== "string" ||
      !preset.id.trim() ||
      ids.has(preset.id) ||
      typeof preset.name !== "string" ||
      !preset.name.trim() ||
      !isMarkdownStyle(preset.style)
    )
      return false;
    ids.add(preset.id);
  }
  return typeof value.selectedId === "string" && ids.has(value.selectedId);
}
