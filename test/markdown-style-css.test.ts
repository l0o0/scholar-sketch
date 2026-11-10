import assert from "node:assert/strict";
import test from "node:test";
import {
  compileMarkdownStyleCss,
  serializeMarkdownStyleCss,
  getMarkdownStyleCssReference,
} from "../src/modules/markdown/style-css.ts";
import {
  BUILTIN_STYLE_PRESETS,
  cloneMarkdownStyle,
  DEFAULT_MARKDOWN_STYLE,
  isMarkdownStyle,
} from "../src/modules/markdown/style-presets.ts";
import { resolvedMarkdownDecorations } from "../src/modules/markdown/style-decoration.ts";

test("built-in and previous custom styles round-trip through editable CSS", () => {
  const custom = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
  custom.fontSize = 19;
  custom.light.background = "#fff9ef";
  custom.headings[0].before = 1.25;
  custom.decorations = [
    {
      theme: "all",
      target: "h1",
      declarations: { "text-align": "center", "font-style": "italic" },
    },
  ];
  for (const style of [
    ...BUILTIN_STYLE_PRESETS.map((preset) => preset.style),
    custom,
  ]) {
    const result = compileMarkdownStyleCss(serializeMarkdownStyleCss(style));
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.style, style);
  }
});

test("CSS uses shared metrics, theme specificity and actual element decoration rules", () => {
  const result = compileMarkdownStyleCss(`/* Common metrics */
.markdown { --zmd-style-size: 18px; --zmd-style-font: serif; --zmd-style-h2-size: 1.6em; }
.markdown[data-theme="dark"] { --zmd-style-link: #def; }
.markdown { --zmd-style-link: #123456; }
.markdown[data-theme='dark'] h1 { color: var( --zmd-style-link ); }
.markdown h1, .markdown h2 { color: #456; text-align: center; font-style: italic; }
.markdown pre { border-radius: 12px; border-color: #ABC; }
`);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.style.fontSize, 18);
  assert.equal(result.style.fontFamily, "serif");
  assert.equal(result.style.headings[1].size, 1.6);
  assert.equal(result.style.dark.link, "#ddeeff");
  assert.equal(result.style.light.link, "#123456");
  assert.equal(
    resolvedMarkdownDecorations(result.style, "dark").h1?.color,
    "#ddeeff",
  );
  assert.equal(
    resolvedMarkdownDecorations(result.style, "light").h1?.color,
    "#445566",
  );
  assert.equal(
    resolvedMarkdownDecorations(result.style, "dark").h2?.["text-align"],
    "center",
  );
  assert.equal(isMarkdownStyle(result.style), true);
});

test("invalid copied CSS reports the original line and rejects the whole result", () => {
  for (const [css, code, line] of [
    ["/* comment\n continued */\nbody { color: #000; }", "selector", 3],
    [".markdown {\n --zmd-style-size: 90px;\n}", "value", 2],
    ['.markdown[data-theme="dark"] { --zmd-style-size: 18px; }', "variable", 1],
    [".markdown { --made-up: 1; }", "variable", 1],
    [".markdown h1 { position: fixed; }", "property", 1],
    [".markdown a { text-align: center; }", "property", 1],
    ['@import "https://remote.test/style.css";', "at-rule", 1],
    [
      ".markdown pre { background-color: url(https://remote.test); }",
      "value",
      1,
    ],
    [".markdown h1 { color: #123 !important; }", "value", 1],
    [".markdown h1 { color: #123; } stray", "syntax", 1],
    [".markdown { --zmd-style-size: 18px", "syntax", 1],
    [".markdown h1 { color: var(--zmd-style-link; }", "syntax", 1],
    [".markdown { /* incomplete", "syntax", 1],
  ] as const) {
    const result = compileMarkdownStyleCss(css);
    assert.equal(result.ok, false, css);
    if (!result.ok) {
      assert.equal(result.issues[0].code, code, css);
      assert.equal(result.issues[0].line, line, css);
    }
  }
});

test("iframe decoration validation rejects structural properties and resource values", () => {
  const style = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
  assert.equal(
    isMarkdownStyle({
      ...style,
      decorations: [
        { theme: "all", target: "h1", declarations: { position: "absolute" } },
      ],
    }),
    false,
  );
  assert.equal(
    isMarkdownStyle({
      ...style,
      decorations: [
        {
          theme: "all",
          target: "a",
          declarations: { color: "url(https://remote.test)" },
        },
      ],
    }),
    false,
  );
  const css = serializeMarkdownStyleCss(style);
  assert.ok(compileMarkdownStyleCss(css).ok);
  assert.match(getMarkdownStyleCssReference(), /not arbitrary webpage CSS/);
  assert.match(getMarkdownStyleCssReference(), /border-radius/);
});
