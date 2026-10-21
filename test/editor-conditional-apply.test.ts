import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import { createMarkdownEditor } from "../src/modules/markdown/editor.ts";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  isEditorProtocolMessage,
} from "../src/modules/markdown/editor-protocol.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("conditional editor updates preserve edits across the asynchronous iframe bridge", async (t) => {
  const globals = globalThis as any;
  const previous = new Map(
    Object.getOwnPropertyNames(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key)!,
    ]),
  );
  const fake = createFakeZotero();
  const restoreZotero = fake.install(globals);
  globals.ztoolkit = { log() {} };
  const browser = new Window({ url: "https://host.example/" });
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const changes: string[] = [];
  const original = "![remote](https://example.com/photo.png)";
  const replacement = "![remote](assets/photo.png)";
  const editor = createMarkdownEditor(container, {
    win: browser as unknown as Window,
    channel: "conditional-apply-test",
    doc: original,
    pageURL: "https://host.example/editor.html",
    onChange: (value) => changes.push(value),
  });
  const frame = container.querySelector("iframe")!.contentWindow!;
  frame.document.body.innerHTML = '<div id="editor-root"></div>';
  let holdRequests = false;
  const held: any[] = [];
  const replies: any[] = [];
  const deliverToFrame = (message: unknown) =>
    frame.dispatchEvent(
      new frame.MessageEvent("message", { data: message, source: browser }),
    );
  (frame as any).postMessage = (message: any) => {
    if (holdRequests && message.type === "applyIfUnchanged") held.push(message);
    else queueMicrotask(() => deliverToFrame(message));
  };
  (browser as any).postMessage = (message: any) => {
    replies.push(message);
    queueMicrotask(() =>
      browser.dispatchEvent(
        new browser.MessageEvent("message", { data: message, source: frame }),
      ),
    );
  };
  t.after(async () => {
    editor.destroy();
    await browser.happyDOM.close();
    restoreZotero();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  assert.equal(await editor.applyIfUnchanged(original, replacement), false);
  ensureDOMGlobals(frame as unknown as Window);
  globals.Window = frame.Window;
  await import("../src/editor/bootstrap.ts");
  frame.document.dispatchEvent(new frame.Event("DOMContentLoaded"));
  await editor.ready;
  await tick();
  const view = EditorView.findFromDOM(
    frame.document.querySelector(".cm-editor") as HTMLElement,
  )!;
  assert.ok(view);

  await t.test(
    "accepted replacements use normal change/save semantics and are undoable",
    async () => {
      const pending = editor.applyIfUnchanged(original, replacement);
      assert.equal(
        editor.getValue(),
        original,
        "the host mirror must not change speculatively",
      );
      assert.equal(await pending, true);
      assert.equal(editor.getValue(), replacement);
      assert.equal(view.state.doc.toString(), replacement);
      assert.deepEqual(changes, [replacement]);
      const acknowledgment = replies.findIndex(
        (message) => message.type === "applyResult",
      );
      assert.ok(
        replies.findIndex((message) => message.type === "change") <
          acknowledgment,
      );
      editor.command("undo");
      await tick();
      assert.equal(editor.getValue(), original);
    },
  );

  await t.test(
    "typing between the host check and iframe handling cannot be overwritten",
    async () => {
      const pending = editor.applyIfUnchanged(original, replacement);
      view.dispatch({
        changes: { from: view.state.doc.length, insert: " typed" },
      });
      assert.equal(await pending, false);
      assert.equal(view.state.doc.toString(), original + " typed");
      assert.equal(editor.getValue(), original + " typed");
      assert.equal(await editor.applyIfUnchanged(original, replacement), false);
      editor.setValue(original);
      await tick();
    },
  );

  await t.test(
    "native composition blocks replacement before the parent learns it has begun",
    async () => {
      view.contentDOM.dispatchEvent(
        new frame.CompositionEvent("compositionstart", { bubbles: true }),
      );
      assert.equal(
        editor.isComposing(),
        false,
        "composition echo is still queued",
      );
      assert.equal(await editor.applyIfUnchanged(original, replacement), false);
      assert.equal(view.state.doc.toString(), original);
      view.contentDOM.dispatchEvent(
        new frame.CompositionEvent("compositionend", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(editor.isComposing(), false);
    },
  );

  await t.test(
    "read-only content rejects the update in both host and iframe",
    async () => {
      editor.setReadOnly(true);
      await tick();
      assert.equal(await editor.applyIfUnchanged(original, replacement), false);
      deliverToFrame({
        source: EDITOR_MESSAGE_SOURCE,
        channel: "conditional-apply-test",
        type: "applyIfUnchanged",
        payload: {
          requestId: 999,
          expected: original,
          value: replacement,
          expiresAt: Date.now() + 1000,
        },
      });
      assert.equal(
        replies.findLast((message) => message.type === "applyResult").payload
          .applied,
        false,
      );
      assert.equal(view.state.doc.toString(), original);
      editor.setReadOnly(false);
      await tick();
    },
  );

  await t.test("a timed-out request cannot apply later", async () => {
    holdRequests = true;
    assert.equal(await editor.applyIfUnchanged(original, replacement), false);
    const message = held.shift();
    assert.ok(message);
    deliverToFrame(message);
    await tick();
    assert.equal(
      replies.findLast((reply) => reply.type === "applyResult").payload.applied,
      false,
    );
    assert.equal(editor.getValue(), original);
    assert.equal(view.state.doc.toString(), original);
    holdRequests = false;
  });

  await t.test(
    "closing the editor settles pending requests and ignores later acknowledgments",
    async () => {
      holdRequests = true;
      const pending = editor.applyIfUnchanged(original, replacement);
      editor.destroy();
      assert.equal(await pending, false);
      assert.equal(await editor.applyIfUnchanged(original, replacement), false);
      assert.equal(editor.getValue(), original);
    },
  );
});

test("conditional edit messages reject malformed payloads", () => {
  const request = {
    source: EDITOR_MESSAGE_SOURCE,
    type: "applyIfUnchanged",
    payload: {
      requestId: 1,
      expected: "a",
      value: "b",
      expiresAt: Date.now() + 1500,
    },
  };
  assert.equal(isEditorProtocolMessage(request), true);
  for (const payload of [
    null,
    { ...request.payload, requestId: -1 },
    { ...request.payload, expected: null },
    { ...request.payload, value: 1 },
    { ...request.payload, expiresAt: Infinity },
  ]) {
    assert.equal(isEditorProtocolMessage({ ...request, payload }), false);
  }
  assert.equal(
    isEditorProtocolMessage({
      source: EDITOR_MESSAGE_SOURCE,
      type: "applyResult",
      payload: { requestId: 1, applied: true },
    }),
    true,
  );
  assert.equal(
    isEditorProtocolMessage({
      source: EDITOR_MESSAGE_SOURCE,
      type: "applyResult",
      payload: { requestId: 1, applied: "true" },
    }),
    false,
  );
});
