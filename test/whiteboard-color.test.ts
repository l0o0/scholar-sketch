import assert from "node:assert/strict";
import test from "node:test";
import {
  colorPalette,
  normalizeColorScheme,
  normalizeHex,
} from "../packages/whiteboard/src/chrome/color.ts";
import {
  nodeFillInk,
  surfaceInk,
} from "../packages/whiteboard/src/model/colorSchemes.ts";

// WCAG 2 contrast, kept separate from the code under test.
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => {
      const value = parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

test("normalizes 3 and 6 digit hex colors", () => {
  assert.equal(normalizeHex("#fff"), "#ffffff");
  assert.equal(normalizeHex("1f2937"), "#1f2937");
  assert.equal(normalizeHex("not-a-color"), null);
});

test("fill and stroke palettes share matching color families in reversed shade order", () => {
  const light = colorPalette(true);
  const dark = colorPalette(false);
  assert.equal(new Set(light).size, 18);
  assert.deepEqual(light.slice(0, 6), dark.slice(12));
  assert.deepEqual(light.slice(6, 12), dark.slice(6, 12));
  assert.deepEqual(light.slice(12), dark.slice(0, 6));
});

test("color schemes normalize to traditional and preserve the classic palette", () => {
  assert.equal(normalizeColorScheme(undefined), "traditional");
  assert.equal(normalizeColorScheme("classic"), "classic");
  assert.equal(normalizeColorScheme("unknown"), "traditional");
  assert.equal(new Set(colorPalette(true)).size, 18);
  assert.equal(new Set(colorPalette(true, "classic")).size, 18);
  assert.deepEqual(colorPalette(true, "classic").slice(0, 6), [
    "#f1f3f5",
    "#ffe3e3",
    "#fff3bf",
    "#e3f0e4",
    "#e3edf7",
    "#eee6f5",
  ]);
  assert.notDeepEqual(colorPalette(true), colorPalette(true, "classic"));
});

test("text on every palette fill keeps at least 4.5:1 contrast", () => {
  for (const scheme of ["traditional", "classic"] as const) {
    for (const fill of colorPalette(true, scheme)) {
      const ink = surfaceInk(fill);
      assert.ok(ink, fill);
      assert.ok(contrast(ink.text, fill) >= 4.5, `${fill} text ${ink.text}`);
      assert.ok(contrast(ink.muted, fill) >= 4.5, `${fill} muted ${ink.muted}`);
    }
  }
  assert.equal(surfaceInk("var(--zmd-note-type-fill)"), undefined);
  assert.equal(surfaceInk("transparent"), undefined);
});

test("solid fills choose ink from the stored color without changing it", () => {
  for (const fill of ["#dcece3", "#2b5c43", "#123456", "#fdfefd"]) {
    for (const textColor of [undefined, "#fedcba"]) {
      const style = { fill, textColor };
      const before = { ...style };
      const ink = nodeFillInk(style);
      assert.ok(ink);
      assert.ok(contrast(ink.text, fill) >= 4.5, `${fill} text ${ink.text}`);
      assert.ok(contrast(ink.muted, fill) >= 4.5, `${fill} muted ${ink.muted}`);
      assert.deepEqual(style, before);
    }
  }
  assert.equal(surfaceInk("#fff")?.text, "#111827");
  assert.equal(surfaceInk("#000")?.text, "#e8eaed");
});

test("transparent, absent and CSS-resolved fills leave ink to the board theme", () => {
  for (const style of [
    {},
    { fill: "transparent" },
    { fill: "#2b5c43", fillStyle: "none" as const },
    { fill: "var(--zmd-note-type-fill)" },
  ]) {
    assert.equal(nodeFillInk(style), undefined);
  }
});
