import {
  defaultWhiteboardShortcuts,
  validateWhiteboardShortcut,
  parseWhiteboardShortcuts,
  isWhiteboardShortcuts,
} from "../packages/whiteboard/src/model/shortcuts.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  handleGlobalCanvasKeyDown,
  createCanvasHeldShortcuts,
  type CanvasHeldShortcutState,
  type GlobalCanvasKeyboardActions,
} from "../packages/whiteboard/src/whiteboard/keyboard.ts";

test("canvas keyboard owns undo and preserves native editing shortcuts", () => {
  const window = new Window();
  const calls: string[] = [];
  const actions: GlobalCanvasKeyboardActions = {
    endFrameDrag() {},
    cancelDraw() {},
    dismissTransientUi() {},
    setActiveTool() {},
    deleteSelection: () => calls.push("delete"),
    nudgeSelected: () => {
      calls.push("nudge");
      return true;
    },
    undo: () => calls.push("undo"),
    redo: () => calls.push("redo"),
    fitView: () => calls.push("all"),
    fitSelection: () => calls.push("selection"),
  };
  const state = {
    annotationBrowserOpen: false,
    editing: false,
    drawing: false,
    selectedNodeIds: ["note"],
    selectedEdgeIds: [],
  };
  window.addEventListener("keydown", (event) =>
    handleGlobalCanvasKeyDown(event, state, actions),
  );
  const dispatch = (
    target: typeof window.document.body,
    init: Record<string, unknown>,
  ) => {
    const event = new window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    assert.equal(
      dispatch(window.document.body, { key: "z", ctrlKey: true }),
      true,
    );
    assert.deepEqual(calls, ["undo"]);
    dispatch(window.document.body, { key: "z", metaKey: true, shiftKey: true });
    assert.deepEqual(calls, ["undo", "redo"]);

    for (const tag of ["textarea", "input", "select", "div"]) {
      const input = window.document.createElement(tag);
      if (tag === "div") input.contentEditable = "true";
      window.document.body.append(input);
      assert.equal(dispatch(input, { key: "z", ctrlKey: true }), false, tag);
      assert.equal(dispatch(input, { key: "y", ctrlKey: true }), false, tag);
      assert.equal(
        dispatch(input, { key: "@", code: "Digit2", shiftKey: true }),
        false,
        tag,
      );
    }
    for (const role of ["menu", "dialog"]) {
      const surface = window.document.createElement("div");
      surface.setAttribute("role", role);
      const button = window.document.createElement("button");
      surface.append(button);
      window.document.body.append(surface);
      assert.equal(dispatch(button, { key: "ArrowDown" }), false);
      assert.equal(dispatch(button, { key: "z", ctrlKey: true }), false);
    }
    for (const className of [
      "zmd-board-properties",
      "zmd-board-style-bar is-edge",
    ]) {
      const properties = window.document.createElement("aside");
      properties.className = className;
      const action = window.document.createElement("button");
      properties.append(action);
      window.document.body.append(properties);
      for (const key of ["Delete", "Backspace", "ArrowRight"]) {
        assert.equal(dispatch(action, { key }), false);
      }
    }
    assert.deepEqual(calls, ["undo", "redo"]);
    assert.equal(
      dispatch(window.document.body, {
        key: "z",
        ctrlKey: true,
        isComposing: true,
      }),
      false,
    );
    assert.equal(
      dispatch(window.document.body, { key: "z", ctrlKey: true, altKey: true }),
      false,
    );
    assert.equal(
      dispatch(window.document.body, {
        key: "!",
        code: "Digit1",
        shiftKey: true,
      }),
      true,
    );
    assert.equal(
      dispatch(window.document.body, {
        key: "@",
        code: "Digit2",
        shiftKey: true,
      }),
      true,
    );
    assert.deepEqual(calls, ["undo", "redo", "all", "selection"]);
  } finally {
    window.close();
  }
});

test("navigation leaves modal, editing, and already handled keyboard actions intact", () => {
  const calls: string[] = [];
  const actions: GlobalCanvasKeyboardActions = {
    endFrameDrag() {},
    cancelDraw() {},
    dismissTransientUi() {},
    setActiveTool() {},
    deleteSelection() {},
    nudgeSelected: () => false,
    fitSelection: () => calls.push("selection"),
    undo: () => calls.push("undo"),
  };
  const event = {
    key: "@",
    code: "Digit2",
    shiftKey: true,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    preventDefault() {},
    stopPropagation() {},
  };
  const state = {
    annotationBrowserOpen: false,
    editing: false,
    drawing: false,
    selectedNodeIds: ["note"],
    selectedEdgeIds: [],
  };
  assert.equal(
    handleGlobalCanvasKeyDown(
      event,
      { ...state, annotationBrowserOpen: true },
      actions,
    ),
    false,
  );
  assert.equal(
    handleGlobalCanvasKeyDown(event, { ...state, editing: true }, actions),
    false,
  );
  assert.equal(
    handleGlobalCanvasKeyDown(
      { ...event, defaultPrevented: true },
      state,
      actions,
    ),
    false,
  );
  assert.equal(
    handleGlobalCanvasKeyDown(event, { ...state, drawing: true }, actions),
    false,
  );
  const undoEvent = { ...event, key: "z", shiftKey: false, ctrlKey: true };
  assert.equal(
    handleGlobalCanvasKeyDown(undoEvent, { ...state, drawing: true }, actions),
    false,
  );
  assert.equal(
    handleGlobalCanvasKeyDown(
      undoEvent,
      { ...state, annotationBrowserOpen: true },
      actions,
    ),
    false,
  );
  assert.deepEqual(calls, []);
});

test("configured canvas commands replace defaults, including legacy aliases", () => {
  const shortcuts = {
    ...defaultWhiteboardShortcuts("Win32"),
    save: "ArrowUp",
    rect: "P",
    question: "F7",
    delete: "F8",
    redo: "F9",
    nudgeRight: "",
    nudgeLeft: "shift,J",
  };
  const calls: string[] = [];
  const actions: GlobalCanvasKeyboardActions = {
    endFrameDrag() {},
    cancelDraw() {},
    dismissTransientUi() {},
    setActiveTool: (tool) => calls.push(tool),
    setNoteTemplate: (type) => calls.push(type),
    deleteSelection: () => calls.push("delete"),
    nudgeSelected: (key, large) => {
      calls.push(`${key}:${large}`);
      return true;
    },
    save: () => calls.push("save"),
    redo: () => calls.push("redo"),
  };
  const state = {
    annotationBrowserOpen: false,
    editing: false,
    drawing: false,
    selectedNodeIds: ["note"],
    selectedEdgeIds: [],
  };
  const press = (
    key: string,
    options: Partial<KeyboardEvent> = {},
    nextState = state,
  ) => {
    let prevented = false;
    const event = {
      key,
      target: null,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...options,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
    };
    const handled = handleGlobalCanvasKeyDown(
      event,
      nextState,
      actions,
      shortcuts,
      "Win32",
    );
    return { handled, prevented };
  };
  for (const key of ["r", "q", "Delete", "Backspace"])
    assert.equal(press(key).handled, false, key);
  for (const key of ["y", "z"])
    assert.equal(
      press(key, { ctrlKey: true, shiftKey: key === "z" }).handled,
      false,
      key,
    );
  assert.equal(press("s", { ctrlKey: true }).handled, false);
  for (const key of ["ArrowUp", "p", "F7", "F8", "F9"])
    assert.equal(press(key).handled, true, key);
  assert.deepEqual(calls, [
    "save",
    "rect",
    "question",
    "note",
    "delete",
    "redo",
  ]);
  assert.equal(
    press("ArrowRight").prevented,
    true,
    "cleared nudge still suppresses React Flow's built-in movement",
  );
  assert.equal(press("J", { shiftKey: true, repeat: true }).handled, true);
  assert.deepEqual(calls.at(-1), "ArrowLeft:false");
  assert.equal(
    press("ArrowUp", {}, { ...state, editing: true }).handled,
    false,
    "unmodified canvas shortcuts preserve text navigation in drafts",
  );
});

test("canvas hold bindings track configured keys and release on focus, editor, or configuration changes", () => {
  const shortcuts = {
    ...defaultWhiteboardShortcuts("Win32"),
    pan: "P",
    freeMove: "control,F8",
    constrain: "X",
  };
  const updates: CanvasHeldShortcutState[] = [];
  const held = createCanvasHeldShortcuts(
    shortcuts,
    (state) => updates.push(state),
    "Win32",
  );
  const key = (key: string, extra: Partial<KeyboardEvent> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  });
  assert.equal(held.keyDown(key(" ")).pan, false);
  assert.equal(held.keyDown(key("p", { code: "KeyP" })).pan, true);
  assert.equal(held.keyUp(key("p", { code: "KeyP" })).pan, false);
  assert.equal(
    held.pointer(key("", { altKey: true, shiftKey: true })).freeMove,
    false,
  );
  assert.equal(
    held.current().constrain,
    false,
    "old Shift constraint is disabled",
  );
  held.keyDown(key("F8", { ctrlKey: true }));
  assert.equal(held.current().freeMove, true);
  assert.equal(held.pointer(key("", { ctrlKey: false })).freeMove, false);
  assert.equal(held.pointer(key("", { ctrlKey: true })).freeMove, true);
  held.keyDown(key("x", { code: "KeyX" }));
  assert.equal(held.pointer(key("")).constrain, true);
  held.clear();
  assert.deepEqual(held.current(), {
    pan: false,
    freeMove: false,
    constrain: false,
  });
  held.keyDown(key("p"), true);
  assert.equal(
    held.current().pan,
    false,
    "input/menu events cannot activate hold commands",
  );
  const defaults = createCanvasHeldShortcuts(
    defaultWhiteboardShortcuts("Win32"),
    () => {},
    "Win32",
  );
  assert.equal(defaults.pointer(key("", { altKey: true })).freeMove, true);
  defaults.keyUp(key("x", { altKey: true }), true);
  assert.equal(
    defaults.current().freeMove,
    false,
    "keyup inside editing cannot reactivate a held modifier",
  );
  assert.ok(updates.length > 0);
});

test("canvas shortcut validation covers aliases and persistence keeps empty disabled bindings", () => {
  const shortcuts = defaultWhiteboardShortcuts("MacIntel");
  assert.deepEqual(
    validateWhiteboardShortcut("rect", "Backspace", shortcuts, "", "MacIntel"),
    { kind: "duplicate", command: "delete" },
  );
  assert.deepEqual(
    validateWhiteboardShortcut("rect", "control,Y", shortcuts, "", "MacIntel"),
    { kind: "duplicate", command: "redo" },
  );
  assert.deepEqual(
    validateWhiteboardShortcut("rect", "accel,C", shortcuts, "", "MacIntel"),
    { kind: "reserved" },
  );
  assert.equal(
    validateWhiteboardShortcut(
      "pan",
      "shift",
      { ...shortcuts, constrain: "" },
      "",
      "MacIntel",
    ),
    null,
  );
  assert.deepEqual(
    validateWhiteboardShortcut("rect", "shift", shortcuts, "", "MacIntel"),
    { kind: "invalid" },
  );
  const restored = parseWhiteboardShortcuts(
    JSON.stringify({ pan: "", rect: "F6" }),
    "MacIntel",
  );
  assert.equal(restored.pan, "");
  assert.equal(restored.rect, "F6");
  assert.equal(restored.redo, "accel,shift,Z");
  assert.equal(isWhiteboardShortcuts(restored), true);
  assert.equal(
    isWhiteboardShortcuts({ ...restored, constrain: "not a key" }),
    false,
  );
});

test("whiteboard preference roundtrip stores overrides and restores platform defaults", async (t) => {
  const { readWhiteboardShortcuts, writeWhiteboardShortcuts } =
    await import("../src/modules/whiteboard/shortcut-preferences.ts");
  const original = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  const prefs = new Map<string, string>();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Prefs: {
        get: (key: string) => prefs.get(key),
        set: (key: string, value: string) => prefs.set(key, value),
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "Zotero", original);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  const changed = {
    ...defaultWhiteboardShortcuts("Win32"),
    rect: "F6",
    pan: "",
  };
  writeWhiteboardShortcuts(changed, "Win32");
  assert.deepEqual(readWhiteboardShortcuts("Win32"), changed);
  assert.equal(readWhiteboardShortcuts("MacIntel").redo, "accel,shift,Z");
  writeWhiteboardShortcuts(defaultWhiteboardShortcuts("Win32"), "Win32");
  assert.deepEqual([...prefs.values()], ["{}"]);
  assert.deepEqual(
    readWhiteboardShortcuts("Win32"),
    defaultWhiteboardShortcuts("Win32"),
  );
});
