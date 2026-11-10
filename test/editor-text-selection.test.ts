import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { selectCharRight } from "@codemirror/commands";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import { createMarkdownEditor } from "../src/modules/markdown/editor.ts";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  type EditorTextSelection,
} from "../src/modules/markdown/editor-protocol.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("settled CodeMirror text selections cross bootstrap and the host bridge in Live and Source", async (t) => {
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
  const received: (EditorTextSelection | null)[] = [];
  const outbound: (EditorTextSelection | null)[] = [];
  let revision = 0;
  const source = "this is test\n\nAnother sentence.";
  const editor = createMarkdownEditor(container, {
    win: browser as unknown as globalThis.Window,
    channel: "selection-editor",
    doc: source,
    pageURL: "https://host.example/editor.html",
    onTextSelection: (selection) => received.push(selection),
  });
  const iframe = container.querySelector("iframe")!;
  const frame = iframe.contentWindow!;
  frame.document.body.innerHTML = '<div id="editor-root"></div>';
  (frame as any).postMessage = (data: unknown) =>
    queueMicrotask(() =>
      frame.dispatchEvent(
        new frame.MessageEvent("message", { data, source: browser }),
      ),
    );
  (browser as any).postMessage = (data: any) =>
    queueMicrotask(() => {
      if (data.type === "textSelection") outbound.push(data.payload);
      if (data.type === "change") revision = data.payload.rev;
      browser.dispatchEvent(
        new browser.MessageEvent("message", { data, source: frame }),
      );
    });
  const destroy = () =>
    frame.dispatchEvent(
      new frame.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "selection-editor",
          type: "destroy",
        },
      }),
    );
  t.after(async () => {
    destroy();
    editor.destroy();
    await tick();
    await browser.happyDOM.close();
    restoreZotero();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  ensureDOMGlobals(frame as unknown as globalThis.Window);
  globals.Window = frame.Window;
  await import("../src/editor/bootstrap.ts");
  frame.document.dispatchEvent(new frame.Event("DOMContentLoaded"));
  await editor.ready;
  await tick();
  const view = EditorView.findFromDOM(
    frame.document.querySelector(".cm-editor") as HTMLElement,
  )!;
  assert.ok(view);
  Object.defineProperty(iframe, "getBoundingClientRect", {
    value: () => ({ left: 200, top: 100 }),
  });
  let head = { left: 80, top: 20, right: 80, bottom: 42 };
  // CodeMirror owns the selection. Only browser layout is substituted.
  t.mock.method(view, "coordsAtPos", () => head as DOMRect);
  t.mock.method(view, "posAtCoords", () => 10);
  t.mock.method(
    view.scrollDOM,
    "getBoundingClientRect",
    () =>
      ({
        left: 0,
        top: 0,
        right: 500,
        bottom: 500,
        width: 500,
        height: 500,
      }) as DOMRect,
  );
  const measured = async () => {
    await new Promise<void>((resolve) =>
      view.requestMeasure({ read() {}, write: () => resolve() }),
    );
    await tick();
  };
  const mouse = (type: string, buttons = 0) =>
    view.contentDOM.dispatchEvent(
      new frame.MouseEvent(type, { bubbles: true, button: 0, buttons }),
    );
  const keyboard = (type: string, key: string, shiftKey = false) =>
    view.contentDOM.dispatchEvent(
      new frame.KeyboardEvent(type, {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  const select = async (from = 0, to = 12) => {
    mouse("mousedown", 1);
    view.dispatch({ selection: { anchor: from, head: to } });
    mouse("mouseup");
    await measured();
  };

  for (const mode of ["live", "source"] as const) {
    await t.test(
      `${mode} publishes selected canonical text only after the drag ends`,
      async () => {
        editor.setMode(mode);
        await tick();
        const before = outbound.filter(Boolean).length;
        mouse("mousedown", 1);
        view.dispatch({ selection: { anchor: 0, head: 12 } });
        await measured();
        assert.equal(outbound.filter(Boolean).length, before);
        mouse("mouseup");
        await measured();
        assert.deepEqual(outbound.at(-1), {
          rev: revision,
          from: 0,
          to: 12,
          text: "this is test",
          rect: head,
        });
        assert.deepEqual(received.at(-1), {
          rev: revision,
          from: 0,
          to: 12,
          text: "this is test",
          rect: { left: 280, top: 120, right: 280, bottom: 142 },
        });
        assert.equal(editor.getValue(), source);
      },
    );
  }
  await t.test(
    "a final pointer selection after mouseup publishes the settled range",
    async () => {
      mouse("mousedown", 1);
      view.dispatch({
        selection: { anchor: 0, head: 4 },
        userEvent: "select.pointer",
      });
      mouse("mouseup");
      // Native mouseup can flush CodeMirror's final selection after the
      // capture listener has already requested its first measurement.
      view.dispatch({
        selection: { anchor: 0, head: 7 },
        userEvent: "select.pointer",
      });
      await measured();
      assert.equal(outbound.at(-1)?.text, "this is");
      assert.equal(received.at(-1)?.text, "this is");
    },
  );
  await t.test(
    "double-click and keyboard selection use the same measured canonical range",
    async () => {
      view.dispatch({ selection: { anchor: 8, head: 12 } });
      mouse("dblclick");
      await measured();
      assert.equal(outbound.at(-1)?.text, "test");
      keyboard("keydown", "ArrowRight", true);
      view.dispatch({
        selection: { anchor: 0, head: 7 },
        userEvent: "select.keyboard",
      });
      keyboard("keyup", "ArrowRight", true);
      await measured();
      assert.equal(outbound.at(-1)?.text, "this is");
    },
  );
  await t.test(
    "ordinary keyboard selection commands publish while programmatic reveals stay silent",
    async () => {
      const count = outbound.filter(Boolean).length;
      view.dispatch({ selection: { anchor: 0, head: 4 } });
      await measured();
      assert.equal(outbound.filter(Boolean).length, count);
      view.dispatch({ selection: { anchor: 0 } });
      assert.equal(selectCharRight(view), true);
      await measured();
      assert.equal(outbound.at(-1)?.text, "t");
    },
  );
  await t.test(
    "typing clears immediately and a later explicit selection has the changed revision",
    async () => {
      keyboard("keydown", "x");
      view.dispatch({
        changes: { from: 0, insert: "x" },
        selection: { anchor: 1, head: 13 },
        userEvent: "input.type",
      });
      keyboard("keyup", "x");
      await measured();
      assert.equal(outbound.at(-1), null);
      assert.ok(revision > 0);
      await select(1, 13);
      assert.equal(outbound.at(-1)?.rev, revision);
      assert.equal(outbound.at(-1)?.text, "this is test");
    },
  );
  await t.test(
    "collapse, composition and Escape cancel active or queued selections",
    async () => {
      view.dispatch({ selection: { anchor: 2 } });
      await tick();
      assert.equal(outbound.at(-1), null);
      const settled = outbound.filter(Boolean).length;
      view.dispatch({ selection: { anchor: 1, head: 13 } });
      mouse("mouseup");
      view.dispatch({ selection: { anchor: 2 } });
      await measured();
      assert.equal(
        outbound.filter(Boolean).length,
        settled,
        "a collapsed selection cannot publish a pending measurement",
      );
      await select(1, 13);
      view.contentDOM.dispatchEvent(
        new frame.CompositionEvent("compositionstart", { bubbles: true }),
      );
      await measured();
      assert.equal(outbound.at(-1), null);
      mouse("mouseup");
      await measured();
      assert.equal(outbound.at(-1), null);
      view.contentDOM.dispatchEvent(
        new frame.CompositionEvent("compositionend", { bubbles: true }),
      );
      await tick();
      await select(1, 13);
      mouse("mouseup");
      const event = new frame.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      await measured();
      assert.equal(outbound.at(-1), null);
      assert.equal(
        view.state.selection.main.empty,
        true,
        "CodeMirror still handles its ordinary Escape selection command",
      );
      assert.equal(view.state.doc.toString(), "x" + source);
    },
  );
  await t.test(
    "scroll and resize remeasure the active head and clear when it leaves the viewport",
    async () => {
      await select(1, 13);
      head = { ...head, top: 80, bottom: 102 };
      view.scrollDOM.dispatchEvent(new frame.Event("scroll"));
      await measured();
      assert.equal(outbound.at(-1)?.rect.top, 80);
      head = { ...head, top: 120, bottom: 142 };
      frame.dispatchEvent(new frame.Event("resize"));
      await measured();
      assert.equal(outbound.at(-1)?.rect.top, 120);
      head = { ...head, top: 600, bottom: 622 };
      view.scrollDOM.dispatchEvent(new frame.Event("scroll"));
      await measured();
      assert.equal(outbound.at(-1), null);
    },
  );
  await t.test(
    "host replacement rejects an in-flight same-revision selection and accepts canonical CRLF text",
    async () => {
      head = { ...head, top: 20, bottom: 42 };
      try {
        editor.setValue("old text");
        await tick();
        await select(0, 3);
        const old = outbound.at(-1)!;
        assert.equal(old.text, "old");
        editor.setValue("new text");
        browser.dispatchEvent(
          new browser.MessageEvent("message", {
            source: frame,
            data: {
              source: EDITOR_MESSAGE_SOURCE,
              channel: "selection-editor",
              type: "textSelection",
              payload: old,
            },
          }),
        );
        assert.equal(received.at(-1), null);
        await tick();
        editor.setValue("line\r\nthis is test");
        await tick();
        await select(5, 17);
        assert.equal(received.at(-1)?.text, "this is test");
      } finally {
        editor.setValue("x" + source);
        await tick();
      }
    },
  );
  await t.test(
    "destroy releases an active selection and its listeners",
    async () => {
      head = { ...head, top: 20, bottom: 42 };
      await select(1, 13);
      destroy();
      await tick();
      assert.equal(outbound.at(-1), null);
      const count = outbound.length;
      frame.dispatchEvent(new frame.MouseEvent("mouseup"));
      frame.dispatchEvent(new frame.Event("resize"));
      await tick();
      assert.equal(outbound.length, count);
    },
  );
});
