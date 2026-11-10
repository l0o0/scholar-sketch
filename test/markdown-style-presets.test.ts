import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_STYLE_PRESETS,
  cloneMarkdownStyle,
  createMarkdownStyleSettings,
  DEFAULT_MARKDOWN_STYLE,
  isMarkdownStyleSettings,
  resolveSelectedStyle,
} from "../src/modules/markdown/style-presets.ts";
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
    version: 1,
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
  settings.presets.push({ id: "research", name: "论文阅读", style: copied });
  settings.selectedId = "research";
  writeMarkdownStyleSettings(settings);
  const reloaded = readMarkdownStyleSettings();
  assert.deepEqual(reloaded, settings);
  assert.equal(reloaded.presets.length, 2);
  assert.equal(resolveSelectedStyle(reloaded).headings[0].size, 2.5);
  assert.equal(reloaded.presets[0].style.fontSize, 18);
  reloaded.presets[1].style.fontSize = 26;
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
  for (const preset of BUILTIN_STYLE_PRESETS) {
    assert.ok(
      isMarkdownStyleSettings({
        version: 1,
        selectedId: preset.id,
        presets: [],
      }),
    );
  }
  const settings = createMarkdownStyleSettings({ fontSize: 18 });
  const appearance = {
    fontFamily: "system",
    backgroundColor: "",
    style: settings.presets[0].style,
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
    isMarkdownStyleSettings({ version: 1, selectedId: "missing", presets: [] }),
    false,
  );
  assert.equal(
    isMarkdownStyleSettings({
      ...settings,
      presets: [
        { id: "default", name: "override", style: DEFAULT_MARKDOWN_STYLE },
      ],
    }),
    false,
  );
});
