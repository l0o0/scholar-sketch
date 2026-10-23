import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NEW_MARKDOWN_SHORTCUT,
  isShortcutModifierKey,
  markdownImageShortcutLabel,
  markdownRedoShortcutLabel,
  resolveConfiguredShortcut,
  shortcutFromKeyboardEvent,
  shortcutKeycaps,
} from "../src/modules/markdown/shortcut.ts";

test("describes image import and native redo keys for each platform", () => {
  assert.equal(markdownImageShortcutLabel("MacIntel"), "Cmd + Option + I");
  assert.equal(markdownImageShortcutLabel("Win32"), "Ctrl + Alt + I");
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
