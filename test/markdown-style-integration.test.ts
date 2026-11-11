import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import { EDITOR_MESSAGE_SOURCE } from "../src/modules/markdown/editor-protocol.ts";
import {
  cloneMarkdownStyle,
  DEFAULT_MARKDOWN_STYLE,
  type MarkdownStyle,
} from "../src/modules/markdown/style-presets.ts";

test("style changes preserve the active editor and its editing state", async (t) => {
  const browser = new Window({
    url: "https://editor.test/?channel=style-presets",
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
          channel: "style-presets",
          type,
          payload,
        },
      }),
    );
  t.after(async () => {
    send("destroy");
    await browser.happyDOM.close();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  await import("../src/editor/bootstrap.ts");
  browser.document.dispatchEvent(new browser.Event("DOMContentLoaded"));

  const appearance = (style: MarkdownStyle) => ({
    fontFamily: style.fontFamily,
    backgroundColor: "",
    style,
  });
  const currentView = () =>
    EditorView.findFromDOM(
      browser.document.querySelector(".cm-editor") as unknown as HTMLElement,
    )!;
  const init = (doc: string) => {
    send("init", {
      doc,
      readOnly: false,
      fontSize: DEFAULT_MARKDOWN_STYLE.fontSize,
      appearance: appearance(cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE)),
      theme: "light",
      mode: "live",
    });
    const view = currentView();
    assert.ok(view);
    return view;
  };

  await t.test(
    "applies styles without changing text, selection, or undo",
    () => {
      const original = "# Heading\n\nBody";
      const view = init(original);
      view.focus();
      view.dispatch({ selection: { anchor: original.length } });
      send("insertText", { text: " draft" });
      const edited = view.state.doc.toString();
      const selection = view.state.selection;
      const custom = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
      custom.fontSize = 20;
      custom.lineHeight = 1.9;
      custom.light.background = "#fff4dc";
      custom.dark.background = "#202329";
      messages.length = 0;

      send("setAppearance", appearance(custom));
      assert.equal(currentView(), view, "keeps the existing EditorView");
      assert.equal(browser.getComputedStyle(view.dom as any).fontSize, "20px");
      assert.equal(
        browser.getComputedStyle(view.dom as any).backgroundColor,
        "#fff4dc",
      );
      assert.equal(view.state.doc.toString(), edited);
      assert.ok(view.state.selection.eq(selection));
      assert.equal(
        messages.some((message) => message.type === "change"),
        false,
      );

      send("setTheme", { theme: "dark" });
      assert.equal(
        browser.getComputedStyle(view.dom as any).backgroundColor,
        "#202329",
      );
      send("setMode", { mode: "source" });
      assert.equal(currentView(), view);
      assert.equal(view.state.doc.toString(), edited);
      assert.ok(view.state.selection.eq(selection));
      assert.equal(
        messages.some((message) => message.type === "change"),
        false,
      );

      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), original);
      send("command", { command: "redo" });
      assert.equal(view.state.doc.toString(), edited);
    },
  );

  await t.test(
    "keeps an in-progress composition available to commit",
    async () => {
      const view = init("# ");
      view.focus();
      view.dispatch({ selection: { anchor: 2 } });
      const composition = (type: string) =>
        view.contentDOM.dispatchEvent(
          new browser.CompositionEvent(type, { bubbles: true }),
        );
      composition("compositionstart");
      view.dispatch({
        changes: { from: 2, insert: "zhong" },
        selection: { anchor: 7 },
        userEvent: "input.type.compose",
      });
      const selection = view.state.selection;
      const custom = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
      custom.fontSize = 18;
      messages.length = 0;

      send("setAppearance", appearance(custom));
      assert.equal(currentView(), view);
      assert.equal(view.contentDOM.isConnected, true);
      assert.equal(view.state.doc.toString(), "# zhong");
      assert.ok(view.state.selection.eq(selection));
      assert.equal(
        messages.some((message) => message.type === "change"),
        false,
      );
      assert.equal(
        messages.some(
          (message) =>
            message.type === "composition" && message.payload.active === false,
        ),
        false,
      );

      // Synthetic DOM events exercise our lifecycle, not a platform IME.
      view.dispatch({
        changes: { from: 2, to: 7, insert: "中" },
        selection: { anchor: 3 },
        userEvent: "input.type.compose",
      });
      composition("compositionend");
      const settled = () =>
        messages.some(
          (message) =>
            message.type === "composition" && message.payload.active === false,
        );
      const deadline = Date.now() + 1500;
      while (!settled() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(settled(), "the editor publishes composition completion");
      assert.equal(currentView(), view);
      assert.equal(view.state.doc.toString(), "# 中");
      assert.equal(view.state.selection.main.anchor, 3);
      assert.ok(messages.some((message) => message.type === "change"));
      send("requestSnapshot", { requestId: "after-style" });
      assert.equal(
        messages.findLast((message) => message.type === "snapshot")?.payload
          .value,
        "# 中",
      );
    },
  );
});
