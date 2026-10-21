import type { CanvasNodeStyle } from "./core";

export type ColorSchemeID = "traditional" | "classic";

export function normalizeColorScheme(value: unknown): ColorSchemeID {
  return value === "classic" ? "classic" : "traditional";
}

// The six middle values are named hues from zerosoul/chinese-colors (MIT);
// the light and dark companions are derived UI tints and are not authoritative
// named-color references. Source: https://github.com/zerosoul/chinese-colors.
const TRADITIONAL_FAMILIES = [
  ["#f8c8bd", "#ed5736", "#8f2f20"],
  ["#fbefc9", "#f2be45", "#8f671d"],
  ["#dcece3", "#519a73", "#2b5c43"],
  ["#d3e8f2", "#177cb0", "#0f4563"],
  ["#e7d2ef", "#801dae", "#4c1268"],
  ["#e1e7e9", "#50616d", "#2e3940"],
];

// Kept byte-for-byte compatible with the original canvas palette.
const CLASSIC_FAMILIES = [
  ["#f1f3f5", "#adb5bd", "#343a40"],
  ["#ffe3e3", "#e599a4", "#a34557"],
  ["#fff3bf", "#d9b45a", "#946b28"],
  ["#e3f0e4", "#8eb998", "#426d50"],
  ["#e3edf7", "#85a9ca", "#416888"],
  ["#eee6f5", "#b39aca", "#75558d"],
];

export function colorPalette(
  lightFirst: boolean,
  scheme: ColorSchemeID = "traditional",
): string[] {
  const families =
    scheme === "classic" ? CLASSIC_FAMILIES : TRADITIONAL_FAMILIES;
  return (lightFirst ? [0, 1, 2] : [2, 1, 0]).flatMap((shade) =>
    families.map((family) => family[shade]),
  );
}

export interface SurfaceInk {
  text: string;
  muted: string;
}

export function nodeFillInk(
  style: Partial<CanvasNodeStyle>,
): SurfaceInk | undefined {
  const fill = style.fillStyle === "none" ? undefined : style.fill;
  return fill ? surfaceInk(fill) : undefined;
}

type RGB = [number, number, number];

const DARK_INK: RGB = [0x11, 0x18, 0x27];
const LIGHT_INK: RGB = [0xe8, 0xea, 0xed];
const MIN_CONTRAST = 4.5;

// Text colours chosen from a solid fill rather than from the board theme.
// Secondary text keeps a tint of the fill but stays at or above 4.5:1.
export function surfaceInk(fill: string): SurfaceInk | undefined {
  const background = parseHexColor(fill);
  if (!background) return undefined;
  const dark =
    contrastRatio(background, [0, 0, 0]) >=
    contrastRatio(background, [255, 255, 255]);
  let text = dark ? DARK_INK : LIGHT_INK;
  if (contrastRatio(text, background) < MIN_CONTRAST) {
    text = dark ? [0, 0, 0] : [255, 255, 255];
  }
  let muted = text;
  for (let step = 10; step > 0; step -= 1) {
    const candidate = mixColor(text, background, step / 20);
    if (contrastRatio(candidate, background) >= MIN_CONTRAST) {
      muted = candidate;
      break;
    }
  }
  return { text: formatHexColor(text), muted: formatHexColor(muted) };
}

function contrastRatio(a: RGB, b: RGB): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHexColor(value: string): RGB | undefined {
  const raw = value.trim().replace(/^#/, "");
  const hex = /^[\da-f]{3}$/i.test(raw)
    ? raw.replace(/./g, (ch) => ch + ch)
    : raw;
  if (!/^[\da-f]{6}$/i.test(hex)) return undefined;
  return [0, 2, 4].map((index) =>
    parseInt(hex.slice(index, index + 2), 16),
  ) as RGB;
}

function luminance(color: RGB): number {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixColor(from: RGB, to: RGB, amount: number): RGB {
  return from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  ) as RGB;
}

function formatHexColor(color: RGB): string {
  return `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
