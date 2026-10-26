import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import { EDITOR_MESSAGE_SOURCE } from "../src/modules/markdown/editor-protocol.ts";

test("live table cells wrap without changing logical activation, editing or selection", async (t) => {
  const browser = new Window({
    url: "https://editor.test/?channel=table-layout",
  });
  const previous = new Map(
    Object.getOwnPropertyNames(globalThis).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)!,
    ]),
  );
  Object.defineProperty(globalThis, "ztoolkit", {
    configurable: true,
    value: { log() {} },
  });
  ensureDOMGlobals(browser as never);
  Object.defineProperty(globalThis, "Window", {
    configurable: true,
    value: browser.Window,
  });
  browser.document.write(
    '<!doctype html><html><body><div id="editor-root"></div></body></html>',
  );
  const messages: { type: string; payload?: unknown }[] = [];
  browser.postMessage = (message: { type: string; payload?: unknown }) => {
    messages.push(message);
  };
  const send = (type: string, payload?: unknown) =>
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "table-layout",
          type,
          payload,
        },
      }),
    );
  t.after(async () => {
    send("destroy");
    await browser.happyDOM.close();
    for (const key of Object.getOwnPropertyNames(globalThis)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await import("../src/editor/bootstrap.ts");
  const { setLiveTableSelection } =
    await import("../src/editor/live-preview/index.ts");
  browser.document.dispatchEvent(new browser.Event("DOMContentLoaded"));
  const longText =
    "可完整阅读的长段文字，包含 **重点** 和 research_reference_without_spaces。";
  const source = [
    "| 说明 | 数值 |",
    "| --- | ---: |",
    `| ${longText} | 12.34 |`,
    "| 另一行 | 8 |",
    "",
    "After the table",
  ].join("\n");
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
  assert.ok(view);
  assert.ok(ensureSyntaxTree(view.state, source.length, 5000));
  view.dispatch({ selection: { anchor: source.length } });
  const cell = (row: number, column: number) => {
    const found = browser.document.querySelector<HTMLElement>(
      `.zmd-lp-table-cell[data-zmd-table-cell-row="${row}"][data-zmd-table-cell-column="${column}"]`,
    );
    assert.ok(found, `Expected table cell ${row}:${column}`);
    return found;
  };
  const style = browser.getComputedStyle(cell(1, 0));
  assert.equal(style.whiteSpace, "pre-wrap");
  assert.equal(style.overflowWrap, "anywhere");
  assert.notEqual(style.textOverflow, "ellipsis");
  assert.equal(cell(1, 0).textContent, longText.replaceAll("**", ""));
  assert.equal(cell(1, 1).textContent, "12.34");
  assert.equal(
    browser.getComputedStyle(cell(1, 1)).fontVariantNumeric,
    "tabular-nums",
  );
  assert.equal(
    view.state.doc.toString(),
    source,
    "Wrapping never rewrites Markdown",
  );
  send("setTheme", { theme: "dark" });
  assert.equal(browser.getComputedStyle(cell(1, 0)).whiteSpace, "pre-wrap");
  assert.equal(browser.getComputedStyle(cell(1, 0)).overflowWrap, "anywhere");

  cell(1, 0).dispatchEvent(
    new browser.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  assert.equal(cell(1, 0).getAttribute("role"), "textbox");
  assert.equal(cell(1, 0).contentEditable, "true");
  assert.equal(cell(1, 0).textContent, longText);
  const edited = `${longText} Updated`;
  cell(1, 0).textContent = edited;
  cell(1, 0).dispatchEvent(new browser.Event("input", { bubbles: true }));
  assert.equal(view.state.doc.toString(), source.replace(longText, edited));
  assert.equal(cell(1, 1).textContent, "12.34");

  cell(1, 0).dispatchEvent(
    new browser.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(cell(1, 1).getAttribute("role"), "textbox");
  assert.equal(cell(1, 0).contentEditable, "false");
  cell(1, 1).dispatchEvent(
    new browser.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(cell(1, 0).getAttribute("role"), "textbox");
  cell(1, 0).dispatchEvent(
    new browser.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(cell(1, 0).contentEditable, "false");
  view.dispatch({
    effects: setLiveTableSelection.of({
      tableFrom: 0,
      kind: "column",
      columnIndex: 0,
    }),
  });
  assert.equal(
    view.dom.querySelectorAll(".zmd-lp-table-cell-selected").length,
    3,
  );
  assert.ok(cell(0, 0).classList.contains("zmd-lp-table-cell-selected"));
  assert.ok(cell(1, 0).classList.contains("zmd-lp-table-cell-selected"));
  assert.ok(cell(2, 0).classList.contains("zmd-lp-table-cell-selected"));
  assert.ok(!cell(1, 1).classList.contains("zmd-lp-table-cell-selected"));
  assert.equal(cell(1, 0).textContent, edited.replaceAll("**", ""));
  assert.equal(view.state.doc.toString(), source.replace(longText, edited));
  assert.deepEqual(
    messages.filter((message) => message.type === "error"),
    [],
  );
});
