import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import { EDITOR_MESSAGE_SOURCE } from "../src/modules/markdown/editor-protocol.ts";
import {
  appearanceTheme,
  liveEditorGeometry,
  livePreviewGeometryStyles,
} from "../src/editor/theme.ts";
import { THEME_TOKENS } from "../src/modules/markdown/theme-tokens.ts";

test("live editor puts horizontal spacing on lines for aligned selections", () => {
  assert.deepEqual(liveEditorGeometry(), {
    contentPadding: "4px 0 8px",
    linePadding: "0 30px 0 34px",
    tableMargin: "0 30px 0 34px",
    tablePadding: "0",
    tableEdgeSize: "30px",
    tableCellMinHeight: "1.7em",
  });
});

test("sidebar live editor uses a narrower safe left inset", () => {
  assert.deepEqual(liveEditorGeometry("sidebar"), {
    contentPadding: "4px 0 8px",
    linePadding: "0 30px 0 20px",
    tableMargin: "0 30px 0 20px",
    tablePadding: "0",
    tableEdgeSize: "30px",
    tableCellMinHeight: "1.7em",
  });
  assert.deepEqual(livePreviewGeometryStyles("sidebar"), {
    tableMargin: "0 30px 0 20px",
    tablePadding: "0",
    tableEdgeSize: "30px",
    codeBlockBackgroundClip: "padding-box",
  });
});

test("shell and iframe share the same theme tokens", () => {
  assert.equal(THEME_TOKENS.light.text, "#24272c");
  assert.equal(THEME_TOKENS.dark.surface, "#1a1d24");
  assert.equal(THEME_TOKENS.light.accent, "#2563eb");
  assert.equal(THEME_TOKENS.dark.accent, "#60a5fa");
});

test("themes define distinct syntax tokens", () => {
  assert.equal(THEME_TOKENS.light.codeKeyword, "#7c3aed");
  assert.equal(THEME_TOKENS.dark.codeKeyword, "#c084fc");
  assert.equal(THEME_TOKENS.light.codeString, "#047857");
  assert.equal(THEME_TOKENS.dark.codeString, "#86efac");
  assert.notEqual(THEME_TOKENS.light.codeComment, THEME_TOKENS.light.text);
  assert.notEqual(THEME_TOKENS.dark.codeComment, THEME_TOKENS.dark.text);
});

test("custom editor backgrounds choose readable theme tokens", () => {
  assert.equal(appearanceTheme("dark", "#fff4dc"), "light");
  assert.equal(appearanceTheme("light", "#181818"), "dark");
  assert.equal(appearanceTheme("dark", ""), "dark");
  assert.equal(appearanceTheme("light", "invalid"), "light");
});

test("the real iframe keeps text and navigation clear of a floating toolbar", async (t) => {
  const browser = new Window({ url: "https://editor.test/?channel=viewport" });
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
  const messages: { type: string }[] = [];
  browser.postMessage = (message: any) => messages.push(message);
  const send = (type: string, payload?: unknown) =>
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "viewport",
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
  send("init", {
    doc: "# Heading\n\nBody",
    readOnly: false,
    fontSize: 14,
    theme: "light",
    mode: "live",
    topInset: 66,
  });
  const view = EditorView.findFromDOM(
    browser.document.querySelector(".cm-editor") as unknown as HTMLElement,
  )!;
  assert.ok(view);
  const style = () => browser.getComputedStyle(view.contentDOM as any);
  const topMargin = () =>
    Math.max(
      0,
      ...view.state
        .facet(EditorView.scrollMargins)
        .map((margin) => margin(view)?.top ?? 0),
    );
  assert.equal(style().paddingTop, "calc(4px + 66px)");
  assert.equal(topMargin(), 66);

  send("setMode", { mode: "source" });
  send("setTheme", { theme: "dark" });
  assert.equal(style().paddingTop, "calc(14px + 66px)");
  assert.equal(topMargin(), 66);
  send("insertText", { text: "Edited " });
  const edited = view.state.doc.toString();
  const selection = view.state.selection;
  messages.length = 0;
  send("setTopInset", { topInset: 0 });
  assert.equal(style().paddingTop, "calc(14px + 0px)");
  assert.equal(topMargin(), 0);
  assert.equal(view.state.doc.toString(), edited);
  assert.ok(view.state.selection.eq(selection));
  assert.equal(
    messages.some((message) => message.type === "change"),
    false,
  );

  send("setTopInset", { topInset: 54 });
  send("setMode", { mode: "live" });
  assert.equal(style().paddingTop, "calc(4px + 54px)");
  assert.equal(topMargin(), 54);
  send("command", { command: "undo" });
  assert.equal(view.state.doc.toString(), "# Heading\n\nBody");
  send("command", { command: "find" });
  assert.ok(browser.document.querySelector(".cm-panels-bottom .cm-search"));
  assert.equal(
    browser.document.querySelector(".cm-panels-top .cm-search"),
    null,
  );
});
