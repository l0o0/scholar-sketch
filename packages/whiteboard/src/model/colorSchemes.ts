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
