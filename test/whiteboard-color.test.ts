import assert from "node:assert/strict";
import test from "node:test";
import {
  colorPalette,
  normalizeColorScheme,
  normalizeHex,
} from "../packages/whiteboard/src/chrome/color.ts";

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
