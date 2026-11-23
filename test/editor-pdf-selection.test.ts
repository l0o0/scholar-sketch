import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import { createMarkdownEditor } from "../src/modules/markdown/editor.ts";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  PDF_SELECTION_EVENT,
} from "../src/modules/markdown/editor-protocol.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("PDF selections cross the owning Markdown surface synchronously and preserve its edit lifecycle", async (t) => {
  const globals = globalThis as any;
  const previous = new Map(
    Object.getOwnPropertyNames(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key)!,
    ]),
  );
  const fake = createFakeZotero({
    items: [
      {
        id: 10,
        key: "PDF00001",
        itemType: "attachment",
        attachmentContentType: "application/pdf",
        fields: { title: "PDF source" },
      },
    ],
  });
  const restoreZotero = fake.install(globals);
  const failures: string[] = [];
  globals.addon = { data: { config: { addonName: "Scholar Sketch" } } };
  globals.ztoolkit = {
    log() {},
    ProgressWindow: class {
      createLine({ text }: { text: string }) {
        failures.push(text);
        return this;
      }
      show() {}
    },
  };
  const browser = new Window({ url: "https://host.example/" });
  const parent = browser.document.createElement("div");
  browser.document.body.append(parent);
  const changes: string[] = [];
  const editor = createMarkdownEditor(parent, {
    win: browser as unknown as Window,
    channel: "pdf-selection-test",
    doc: "Before",
    pageURL: "https://host.example/editor.html",
    onChange: (value) => changes.push(value),
  });
  const iframe = parent.querySelector("iframe")!;
  const frame = iframe.contentWindow!;
  frame.document.body.innerHTML = '<div id="editor-root"></div>';
  class DragEvent extends frame.MouseEvent {
    dataTransfer: DataTransfer | null;
    constructor(type: string, init: DragEventInit = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
    }
  }
  (frame as any).DragEvent = DragEvent;
  (browser as any).DragEvent = DragEvent;
  (frame as any).postMessage = (data: unknown) =>
    queueMicrotask(() =>
      frame.dispatchEvent(
        new frame.MessageEvent("message", { data, source: browser }),
      ),
    );
  (browser as any).postMessage = (data: unknown) =>
    queueMicrotask(() =>
      browser.dispatchEvent(
        new browser.MessageEvent("message", { data, source: frame }),
      ),
    );
  const destroyFrame = () =>
    frame.dispatchEvent(
      new frame.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "pdf-selection-test",
          type: "destroy",
        },
      }),
    );
  t.after(async () => {
    destroyFrame();
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
  const position = { pageIndex: 2, rects: [[10, 20, 150, 40]] };
  const href = `zotero://open-pdf/library/items/PDF00001?page=3&position=${encodeURIComponent(JSON.stringify(position))}`;
  const nativeTransfer = () => {
    const transfer = new frame.DataTransfer();
    transfer.setData(
      "zotero/annotation",
      JSON.stringify([
        {
          attachmentItemID: 10,
          type: "highlight",
          text: "Selection from the PDF",
          pageLabel: "153",
          position,
        },
      ]),
    );
    transfer.setData("text/plain", "Selection from the PDF");
    return transfer;
  };
  const paste = (transfer = nativeTransfer()) => {
    const event = new frame.ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer as never,
    });
    view.contentDOM.dispatchEvent(event);
    return event;
  };
  const reset = async (value: string) => {
    editor.setValue(value);
    await tick();
    changes.length = 0;
  };

  for (const mode of ["live", "source"] as const) {
    await t.test(
      `${mode} inserts one linked block and one undo restores the original`,
      async () => {
        editor.setMode(mode);
        await reset("Before after");
        view.dispatch({ selection: { anchor: 7 } });
        assert.equal(paste().defaultPrevented, true);
        const value = view.state.doc.toString();
        assert.ok(value.startsWith("Before \n\n> Selection from the PDF\n\n["));
        assert.ok(value.includes(`](${href})\n\nafter`));
        await tick();
        assert.equal(editor.getValue(), value);
        assert.deepEqual(changes, [value]);
        editor.command("undo");
        await tick();
        assert.equal(editor.getValue(), "Before after");
      },
    );
  }

  await t.test(
    "outer-frame annotation drops use their frame-relative drop point",
    async () => {
      await reset("Before after");
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      iframe.getBoundingClientRect = () => ({ left: 20, top: 40 }) as DOMRect;
      const originalPosition = view.posAtCoords;
      let dropPoint: { x: number; y: number } | undefined;
      view.posAtCoords = (point) => {
        dropPoint = point;
        return 7;
      };
      try {
        const transfer = nativeTransfer();
        const event = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer as never,
          clientX: 120,
          clientY: 240,
        });
        iframe.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(dropPoint, { x: 100, y: 200 });
        assert.ok(
          view.state.doc.toString().startsWith("Before \n\n> Selection"),
        );
        assert.ok(view.state.doc.toString().endsWith(`](${href})\n\nafter`));
        await tick();
        assert.equal(changes.length, 1);
      } finally {
        view.posAtCoords = originalPosition;
      }
    },
  );

  await t.test(
    "ordinary and malformed transfers retain normal text paste",
    async () => {
      for (const native of [undefined, "invalid-json"]) {
        await reset("");
        const transfer = new frame.DataTransfer();
        transfer.setData("text/plain", "Ordinary text");
        if (native !== undefined) transfer.setData("zotero/annotation", native);
        paste(transfer);
        assert.equal(view.state.doc.toString(), "Ordinary text");
      }
    },
  );

  await t.test(
    "read-only and native composition reject PDF insertion",
    async () => {
      await reset("Before");
      editor.setReadOnly(true);
      await tick();
      paste();
      assert.equal(view.state.doc.toString(), "Before");
      editor.setReadOnly(false);
      await tick();
      view.contentDOM.dispatchEvent(
        new frame.CompositionEvent("compositionstart", { bubbles: true }),
      );
      const input = new frame.CustomEvent(PDF_SELECTION_EVENT, {
        bubbles: true,
        cancelable: true,
        detail: JSON.stringify({ markdown: "Unexpected replacement" }),
      });
      view.contentDOM.dispatchEvent(input);
      assert.equal(input.defaultPrevented, false);
      assert.equal(view.state.doc.toString(), "Before");
      view.contentDOM.dispatchEvent(
        new frame.CompositionEvent("compositionend", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
    },
  );

  await t.test(
    "lookup failure reports the lost reference and keeps the pasted text",
    async () => {
      await reset("");
      const original = fake.Zotero.Items.get;
      fake.Zotero.Items.get = () => {
        throw new Error("Lookup failed");
      };
      try {
        paste();
        assert.equal(view.state.doc.toString(), "Selection from the PDF");
        assert.deepEqual(failures, ["bamboo-pdf-selection-failed"]);
      } finally {
        fake.Zotero.Items.get = original;
      }
    },
  );

  await t.test(
    "destroy detaches native transfer decoding from the released document",
    () => {
      const transfer = nativeTransfer();
      const original = transfer.getData.bind(transfer);
      let nativeReads = 0;
      transfer.getData = (type) => {
        if (type === "zotero/annotation") nativeReads += 1;
        return original(type);
      };
      destroyFrame();
      editor.destroy();
      paste(transfer);
      assert.equal(nativeReads, 0);
    },
  );
});
