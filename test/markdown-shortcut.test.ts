import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NEW_MARKDOWN_SHORTCUT,
  isShortcutModifierKey,
  DEFAULT_MARKDOWN_INSERT_SHORTCUTS,
  MARKDOWN_INSERT_COMMANDS,
  markdownShortcutLabel,
  markdownInsertKeyBinding,
  markdownInsertShortcutFromKeyboardEvent,
  validateMarkdownInsertShortcut,
  markdownRedoShortcutLabel,
  resolveConfiguredShortcut,
  shortcutFromKeyboardEvent,
  shortcutKeycaps,
} from "../src/modules/markdown/shortcut.ts";

test("describes image import and native redo keys for each platform", () => {
  assert.equal(
    markdownShortcutLabel(DEFAULT_MARKDOWN_INSERT_SHORTCUTS.image, "MacIntel"),
    "Cmd + Option + I",
  );
  assert.equal(
    markdownShortcutLabel(DEFAULT_MARKDOWN_INSERT_SHORTCUTS.image, "Win32"),
    "Ctrl + Alt + I",
  );
  assert.equal(markdownRedoShortcutLabel("MacIntel"), "Cmd + Shift + Z");
  assert.equal(markdownRedoShortcutLabel("Win32"), "Ctrl + Y");
  assert.equal(markdownRedoShortcutLabel("Linux x86_64"), "Ctrl + Y");
});

test("formats the default shortcut as native macOS keycaps", () => {
  assert.equal(DEFAULT_NEW_MARKDOWN_SHORTCUT, "accel,shift,M");
  assert.deepEqual(shortcutKeycaps("accel,shift,M", "MacIntel"), [
    "⌘",
    "⇧",
    "M",
  ]);
});

test("formats accelerator keycaps for Windows and Linux", () => {
  assert.deepEqual(shortcutKeycaps("accel,shift,M", "Win32"), [
    "Ctrl",
    "Shift",
    "M",
  ]);
  assert.deepEqual(shortcutKeycaps("", "Linux x86_64"), []);
});

test("serializes a non-macOS accelerator shortcut", () => {
  assert.equal(
    shortcutFromKeyboardEvent(
      {
        key: "n",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      },
      "Win32",
    ),
    "accel,shift,N",
  );
});

test("serializes a macOS command shortcut", () => {
  assert.equal(
    shortcutFromKeyboardEvent(
      {
        key: "m",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
      },
      "MacIntel",
    ),
    "accel,shift,M",
  );
});

test("ignores modifier-only shortcut events", () => {
  assert.equal(isShortcutModifierKey("Shift"), true);
  assert.equal(isShortcutModifierKey("m"), false);
  assert.equal(
    shortcutFromKeyboardEvent(
      {
        key: "Shift",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      },
      "MacIntel",
    ),
    null,
  );
});

test("requires a modifier for a global shortcut", () => {
  assert.equal(
    shortcutFromKeyboardEvent(
      {
        key: "m",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      },
      "MacIntel",
    ),
    null,
  );
});

test("preserves an explicitly cleared shortcut", () => {
  assert.equal(resolveConfiguredShortcut(""), "");
  assert.equal(
    resolveConfiguredShortcut(undefined),
    DEFAULT_NEW_MARKDOWN_SHORTCUT,
  );
  assert.equal(resolveConfiguredShortcut(null), DEFAULT_NEW_MARKDOWN_SHORTCUT);
});

test("insertion shortcuts keep defaults, native labels and disabled bindings consistent", () => {
  for (const command of MARKDOWN_INSERT_COMMANDS) {
    const raw = DEFAULT_MARKDOWN_INSERT_SHORTCUTS[command];
    assert.equal(
      validateMarkdownInsertShortcut(
        command,
        raw,
        DEFAULT_MARKDOWN_INSERT_SHORTCUTS,
        DEFAULT_NEW_MARKDOWN_SHORTCUT,
      ),
      null,
    );
    assert.ok(markdownInsertKeyBinding(raw));
  }
  assert.equal(markdownInsertKeyBinding(""), null);
  assert.equal(markdownShortcutLabel("", "MacIntel"), "");
  assert.equal(
    markdownShortcutLabel(DEFAULT_MARKDOWN_INSERT_SHORTCUTS.table, "MacIntel"),
    "Cmd + Option + Shift + T",
  );
  assert.equal(
    markdownInsertKeyBinding(DEFAULT_MARKDOWN_INSERT_SHORTCUTS.table, "Win32"),
    "Mod-Alt-Shift-T",
  );
  assert.equal(markdownInsertKeyBinding("accel,shift,`"), "Mod-Shift-`");
});

test("custom insertion bindings reject duplicate, reserved and plain typing keys", () => {
  const defaults = { ...DEFAULT_MARKDOWN_INSERT_SHORTCUTS };
  assert.deepEqual(
    validateMarkdownInsertShortcut(
      "task",
      "accel,alt,A",
      defaults,
      DEFAULT_NEW_MARKDOWN_SHORTCUT,
    ),
    { kind: "duplicate", command: "annotation" },
  );
  assert.deepEqual(
    validateMarkdownInsertShortcut(
      "task",
      "accel,shift,M",
      defaults,
      DEFAULT_NEW_MARKDOWN_SHORTCUT,
    ),
    { kind: "duplicate", command: "new-note" },
  );
  assert.deepEqual(
    validateMarkdownInsertShortcut(
      "task",
      "accel,B",
      defaults,
      DEFAULT_NEW_MARKDOWN_SHORTCUT,
    ),
    { kind: "reserved" },
  );
  assert.deepEqual(
    validateMarkdownInsertShortcut(
      "task",
      "accel,9",
      defaults,
      DEFAULT_NEW_MARKDOWN_SHORTCUT,
    ),
    { kind: "reserved" },
  );
  assert.deepEqual(
    validateMarkdownInsertShortcut(
      "task",
      "alt,X",
      defaults,
      DEFAULT_NEW_MARKDOWN_SHORTCUT,
    ),
    { kind: "invalid" },
  );
  assert.equal(
    validateMarkdownInsertShortcut(
      "task",
      "accel,alt,shift,J",
      defaults,
      DEFAULT_NEW_MARKDOWN_SHORTCUT,
    ),
    null,
  );
  assert.equal(
    validateMarkdownInsertShortcut(
      "task",
      "",
      defaults,
      DEFAULT_NEW_MARKDOWN_SHORTCUT,
    ),
    null,
  );
});

test("recording insertion bindings names Option letters while preserving AltGr and composition", () => {
  const event = {
    key: "å",
    code: "KeyA",
    keyCode: 65,
    metaKey: true,
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    repeat: false,
    isComposing: false,
  };
  assert.equal(
    markdownInsertShortcutFromKeyboardEvent(event, "MacIntel"),
    "accel,alt,A",
  );
  assert.equal(
    markdownInsertShortcutFromKeyboardEvent(
      {
        ...event,
        metaKey: false,
        ctrlKey: true,
        key: "ą",
        getModifierState: () => true,
      },
      "Win32",
    ),
    null,
  );
  assert.equal(
    markdownInsertShortcutFromKeyboardEvent(
      { ...event, isComposing: true },
      "MacIntel",
    ),
    null,
  );
  assert.equal(
    markdownInsertShortcutFromKeyboardEvent(
      { ...event, repeat: true },
      "MacIntel",
    ),
    null,
  );
  assert.equal(
    markdownInsertShortcutFromKeyboardEvent(
      { ...event, metaKey: false },
      "MacIntel",
    ),
    null,
  );
});
