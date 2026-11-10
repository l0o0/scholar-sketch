import assert from "node:assert/strict";
import test from "node:test";
import {
  cloneMarkdownStyle,
  createMarkdownStyleSettings as createLegacyStyleSettings,
  DEFAULT_MARKDOWN_STYLE,
} from "../src/modules/markdown/style-presets.ts";
import {
  BUILTIN_CSS_PRESETS,
  createMarkdownStyleSettings,
  isMarkdownStyleSettings,
  normalizeMarkdownStyleSettings,
  resolveSelectedStyle,
} from "../src/modules/markdown/style-settings.ts";
import { serializeMarkdownStyleCss } from "../src/modules/markdown/style-css.ts";
import {
  isEditorProtocolMessage,
  EDITOR_MESSAGE_SOURCE,
} from "../src/modules/markdown/editor-protocol.ts";
import {
  readMarkdownStyleSettings,
  writeMarkdownStyleSettings,
} from "../src/modules/markdown/style-preferences.ts";

test("legacy appearance survives as an editable local preset without changing either palette's readability", () => {
  const settings = createMarkdownStyleSettings({
    fontSize: 18,
    fontFamily: "serif",
    backgroundColor: "#fff4dc",
    name: "当前外观",
  });
  const current = resolveSelectedStyle(settings);
  assert.equal(settings.presets[0].name, "当前外观");
  assert.equal(current.fontSize, 18);
  assert.equal(current.fontFamily, "serif");
  assert.equal(current.light.background, "#fff4dc");
  assert.deepEqual(current.light, current.dark);
  assert.equal(current.dark.text, DEFAULT_MARKDOWN_STYLE.light.text);
  const dark = resolveSelectedStyle(
    createMarkdownStyleSettings({ backgroundColor: "#181818" }),
  );
  assert.equal(dark.light.text, DEFAULT_MARKDOWN_STYLE.dark.text);
  assert.deepEqual(createMarkdownStyleSettings(), {
    version: 2,
    selectedId: "default",
    presets: [],
  });
});

test("saved selections and multiple independent presets reload from plugin preferences", (t) => {
  const values = new Map<string, unknown>([
    ["extensions.zotero.bamboo.fontSize", 18],
    ["extensions.zotero.bamboo.markdownFontFamily", "serif"],
  ]);
  const original = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Prefs: {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "Zotero", original);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  const settings = readMarkdownStyleSettings();
  const copied = cloneMarkdownStyle(resolveSelectedStyle(settings));
  copied.fontSize = 22;
  copied.headings[0].size = 2.5;
  copied.dark.link = "#ffcc88";
  settings.presets.push({
    id: "research",
    name: "论文阅读",
    css: "/* My reading style */\n" + serializeMarkdownStyleCss(copied),
  });
  settings.selectedId = "research";
  writeMarkdownStyleSettings(settings);
  const reloaded = readMarkdownStyleSettings();
  assert.deepEqual(reloaded, settings);
  assert.equal(reloaded.presets.length, 2);
  assert.equal(resolveSelectedStyle(reloaded).headings[0].size, 2.5);
  assert.equal(
    resolveSelectedStyle({ ...reloaded, selectedId: reloaded.presets[0].id })
      .fontSize,
    18,
  );
  const changedStyle = cloneMarkdownStyle(copied);
  changedStyle.fontSize = 26;
  reloaded.presets[1].css = serializeMarkdownStyleCss(changedStyle);
  assert.equal(
    resolveSelectedStyle(readMarkdownStyleSettings()).fontSize,
    22,
    "unsaved drafts do not mutate saved preferences",
  );
  values.set("extensions.zotero.bamboo.fontSize", 11);
  assert.equal(
    resolveSelectedStyle(readMarkdownStyleSettings()).fontSize,
    22,
    "old flat preferences are no longer authoritative",
  );
  reloaded.presets[1].name = "重命名";
  writeMarkdownStyleSettings(reloaded);
  assert.equal(readMarkdownStyleSettings().selectedId, "research");
  reloaded.presets.splice(1, 1);
  reloaded.selectedId = "default";
  writeMarkdownStyleSettings(reloaded);
  assert.equal(resolveSelectedStyle(readMarkdownStyleSettings()).fontSize, 15);
});

test("preset and iframe boundaries reject invalid CSS values and broken preset references", () => {
  for (const preset of BUILTIN_CSS_PRESETS) {
    assert.ok(
      isMarkdownStyleSettings({
        version: 2,
        selectedId: preset.id,
        presets: [],
      }),
    );
  }
  const settings = createMarkdownStyleSettings({ fontSize: 18 });
  const appearance = {
    fontFamily: "system",
    backgroundColor: "",
    style: resolveSelectedStyle(settings),
  };
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    type: "setAppearance",
    payload: appearance,
  };
  assert.ok(isEditorProtocolMessage(message));
  assert.ok(
    isEditorProtocolMessage({
      ...message,
      type: "init",
      payload: { appearance },
    }),
  );
  appearance.style.dark.background = "red;display:none";
  settings.presets[0].css += "\n.markdown { position: fixed; }";
  assert.equal(isMarkdownStyleSettings(settings), false);
  assert.equal(isEditorProtocolMessage(message), false);
  assert.equal(
    isEditorProtocolMessage({
      ...message,
      type: "init",
      payload: { appearance },
    }),
    false,
  );
  assert.equal(
    isMarkdownStyleSettings({ version: 2, selectedId: "missing", presets: [] }),
    false,
  );
  assert.equal(
    isMarkdownStyleSettings({
      ...settings,
      presets: [
        { id: "default", name: "override", css: BUILTIN_CSS_PRESETS[0].css },
      ],
    }),
    false,
  );
});

test("parameter presets upgrade to CSS in memory without losing names, selection or appearance", () => {
  const legacy = createLegacyStyleSettings({ fontSize: 19, name: "保留外观" });
  const secondStyle = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
  secondStyle.headings[2].before = 1.3;
  secondStyle.dark.quoteBorder = "#123abc";
  legacy.presets.push({ id: "second", name: "研究摘记", style: secondStyle });
  legacy.selectedId = "second";
  const original = JSON.stringify(legacy);
  const migrated = normalizeMarkdownStyleSettings(JSON.parse(original));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.selectedId, "second");
  assert.deepEqual(
    migrated.presets.map(({ name }) => name),
    ["保留外观", "研究摘记"],
  );
  assert.deepEqual(resolveSelectedStyle(migrated), secondStyle);
  assert.deepEqual(
    resolveSelectedStyle({ ...migrated, selectedId: migrated.presets[0].id }),
    legacy.presets[0].style,
  );
  assert.equal(JSON.stringify(legacy), original);
  assert.ok(
    migrated.presets.every(
      (preset) => typeof preset.css === "string" && !("style" in preset),
    ),
  );
});
