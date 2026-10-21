import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import { EDITOR_MESSAGE_SOURCE } from "../src/modules/markdown/editor-protocol.ts";

const source = [
  "# Title",
  "",
  String.raw`Inline \(\alpha + \beta\) math.`,
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "- [ ] task with $x^2$",
  "",
  "End",
].join("\n");

test("re-adding live preview through a compartment rebuilds every live field", async (t) => {
  const win = new Window({ url: "https://editor.test/?channel=mode-switch" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    MutationObserver: win.MutationObserver,
    ResizeObserver: win.ResizeObserver,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const { livePreviewWhen } =
    await import("../src/editor/live-preview/index.ts");
  const parent = win.document.createElement("div");
  win.document.body.append(parent);
  const live = new Compartment();
  const errors: unknown[] = [];
  const state = EditorState.create({
    doc: source,
    selection: { anchor: source.length },
    extensions: [
      markdown({ extensions: GFM }),
      live.of(livePreviewWhen(true)),
      EditorView.exceptionSink.of((error) => errors.push(error)),
    ],
  });
  ensureSyntaxTree(state, source.length, 5000);
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: state.update({}).state,
  });
  t.after(async () => {
    view.destroy();
    await win.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const math = () => view.dom.querySelectorAll(".zmd-lp-math math").length;
  assert.equal(math(), 3);

  view.dispatch({ effects: live.reconfigure(livePreviewWhen(false)) });
  assert.equal(math(), 0);
  view.dispatch({ effects: live.reconfigure(livePreviewWhen(true)) });
  assert.equal(math(), 3);
  assert.ok(view.dom.querySelector(".zmd-lp-h1"));
  assert.ok(view.dom.querySelector(".zmd-lp-list"));

  // A transaction that re-adds the fields can also edit the document and
  // move the selection, which takes the incremental-update code paths.
  view.dispatch({ effects: live.reconfigure(livePreviewWhen(false)) });
  view.dispatch({
    changes: { from: view.state.doc.length, insert: " $y_1$" },
    selection: { anchor: 0 },
    effects: live.reconfigure(livePreviewWhen(true)),
  });
  assert.equal(math(), 4);
  view.dispatch({
    changes: { from: view.state.doc.length, insert: " again" },
  });
  assert.equal(math(), 4);

  // Source and back to Live in one view update keeps the view plugins alive,
  // but the edit's start state still has no live structure.
  const off = view.state.update({
    effects: live.reconfigure(livePreviewWhen(false)),
  });
  const on = off.state.update({
    changes: { from: off.state.doc.length, insert: " $w$" },
    effects: live.reconfigure(livePreviewWhen(true)),
  });
  view.dispatch([off, on]);
  assert.equal(math(), 5);
  assert.ok(view.dom.querySelector(".zmd-lp-h1"));
  assert.deepEqual(errors, []);
});

test("the real editor switches Live -> Source -> Live without errors", async (t) => {
  const browser = new Window({
    url: "https://editor.test/?channel=mode-switch-bootstrap",
  });
  const globals = globalThis as any;
  const previous = new Map(
    Object.getOwnPropertyNames(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key)!,
    ]),
  );
  globals.ztoolkit = { log() {} };
  ensureDOMGlobals(browser as any);
  globals.Window = browser.Window;
  browser.document.body.innerHTML = '<div id="editor-root"></div>';
  const messages: { type: string; payload?: any }[] = [];
  browser.postMessage = (message: any) => messages.push(message);
  const send = (type: string, payload?: unknown) =>
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "mode-switch-bootstrap",
          type,
          payload,
        },
      }),
    );
  await import("../src/editor/bootstrap.ts");
  browser.document.dispatchEvent(new browser.Event("DOMContentLoaded"));
  t.after(async () => {
    send("destroy");
    await browser.happyDOM.close();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  send("init", {
    doc: source,
    readOnly: false,
    fontSize: 14,
    theme: "light",
    mode: "live",
  });
  const view = EditorView.findFromDOM(
    browser.document.querySelector(".cm-editor") as unknown as HTMLElement,
  )!;
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  const math = () => view.dom.querySelectorAll(".zmd-lp-math math").length;
  const errors = () =>
    messages
      .filter((message) => message.type === "error")
      .map((message) => message.payload?.message);
  assert.equal(math(), 3);
  assert.ok(view.dom.classList.contains("zmd-mode-live"));

  for (let round = 0; round < 2; round++) {
    send("setMode", { mode: "source" });
    assert.deepEqual(errors(), []);
    assert.ok(view.dom.classList.contains("zmd-mode-source"));
    assert.equal(math(), 0);

    send("setMode", { mode: "live" });
    assert.deepEqual(errors(), []);
    assert.ok(view.dom.classList.contains("zmd-mode-live"));
    assert.equal(math(), 3);
  }

  // Editing after the round trip keeps the rebuilt decorations current.
  view.dispatch({
    changes: { from: view.state.doc.length, insert: " $z$" },
    selection: { anchor: 0 },
  });
  assert.equal(math(), 4);
  assert.deepEqual(errors(), []);
});
