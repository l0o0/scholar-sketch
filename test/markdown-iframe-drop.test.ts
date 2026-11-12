import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { attachMarkdownIframeDrop } from "../src/modules/markdown/iframe-drop.ts";

test("Markdown forwards outer-window text and image drops once, with frame-relative coordinates", () => {
  const win = new Window();
  // happy-dom exposes DragEvent as a generic Event; supply its browser fields.
  class DragEvent extends win.MouseEvent {
    dataTransfer: DataTransfer | null;
    constructor(type: string, init: DragEventInit = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
    }
  }
  win.DragEvent = DragEvent as never;
  const wrapper = win.document.createElement("div");
  const iframe = win.document.createElement("iframe");
  wrapper.append(iframe);
  win.document.body.append(wrapper);
  (iframe.contentWindow! as any).DragEvent = DragEvent;
  const doc = iframe.contentDocument!;
  const content = doc.createElement("div");
  content.className = "cm-content";
  doc.body.append(content);
  iframe.getBoundingClientRect = () => ({ left: 20, top: 40 }) as DOMRect;
  let editable = true;
  const detach = attachMarkdownIframeDrop(
    wrapper as never,
    iframe as never,
    () => editable,
  );
  const drops: any[] = [];
  content.addEventListener("drop", (event) => {
    drops.push(event);
    event.preventDefault();
  });
  const dispatch = (
    type: string,
    transfer: InstanceType<typeof win.DataTransfer>,
  ) => {
    const event = new win.DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: 120,
      clientY: 240,
    });
    iframe.dispatchEvent(event);
    return event;
  };
  const text = new win.DataTransfer();
  text.setData("text/plain", "Citation from Zotero");
  text.setData("zotero/item", "42");
  assert.equal(dispatch("dragenter", text).defaultPrevented, true);
  assert.equal(dispatch("dragover", text).defaultPrevented, true);
  assert.equal(text.dropEffect, "copy");
  assert.equal(dispatch("drop", text).defaultPrevented, true);
  assert.equal(drops.length, 1);
  assert.equal(
    drops[0].dataTransfer.getData("text/plain"),
    "Citation from Zotero",
  );
  assert.equal(drops[0].clientX, 100);
  assert.equal(drops[0].clientY, 200);
  const files = new win.DataTransfer();
  files.items.add(
    new win.File(["image"], "picture.png", { type: "image/png" }),
  );
  Object.defineProperty(files, "types", { value: ["Files"] });
  dispatch("drop", files);
  assert.equal(drops.length, 2);
  assert.equal(drops[1].dataTransfer.files[0].name, "picture.png");
  // Events inside the frame must not be forwarded a second time.
  content.dispatchEvent(
    new win.DragEvent("drop", { bubbles: true, dataTransfer: text }),
  );
  assert.equal(drops.length, 3);
  editable = false;
  dispatch("drop", files);
  assert.equal(drops.length, 3);
  editable = true;
  detach();
  dispatch("drop", text);
  assert.equal(drops.length, 3);
  win.close();
});

test("Markdown lets native iframe drops reach their document and forwards chrome drops once", () => {
  const win = new Window();
  class DragEvent extends win.MouseEvent {
    dataTransfer: DataTransfer | null;
    constructor(type: string, init: DragEventInit = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
      // Gecko chrome dispatch can retain trust when forwarding across frames.
      Object.defineProperty(this, "isTrusted", { value: true });
    }
  }
  win.DragEvent = DragEvent as never;
  const wrapper = win.document.createElement("div");
  const iframe = win.document.createElement("iframe");
  wrapper.append(iframe);
  win.document.body.append(wrapper);
  (iframe.contentWindow! as any).DragEvent = DragEvent;
  const doc = iframe.contentDocument!;
  const content = doc.createElement("div");
  content.className = "cm-content";
  doc.body.append(content);
  iframe.getBoundingClientRect = () => ({ left: 20, top: 40 }) as DOMRect;

  const ancestorCapture = new Map<string, (event: Event) => void>();
  const add = wrapper.addEventListener.bind(wrapper);
  wrapper.addEventListener = ((type, listener, options) => {
    ancestorCapture.set(type, listener as (event: Event) => void);
    add(type, listener, options);
  }) as typeof wrapper.addEventListener;
  const detach = attachMarkdownIframeDrop(
    wrapper as never,
    iframe as never,
    () => true,
  );
  wrapper.addEventListener = add;
  let propagated = 0;
  const propagateToChromeAncestor = (event: Event) => {
    // Happy DOM stops at iframe documents. Model Gecko's chrome ancestor
    // capture with the original event target/document, bounding a regression's
    // recursion so the assertion can report the duplicate deliveries.
    if (++propagated <= 8) ancestorCapture.get(event.type)?.(event);
  };
  doc.addEventListener("drop", propagateToChromeAncestor, true);
  const drops: DragEvent[] = [];
  content.addEventListener("drop", (event) => {
    drops.push(event as DragEvent);
    event.preventDefault();
  });
  const transfer = new win.DataTransfer();
  transfer.setData("text/plain", "PDF selection");
  transfer.setData("zotero/annotation", '[{"attachmentItemID":10}]');
  try {
    content.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer as never,
        clientX: 77,
        clientY: 90,
      }),
    );
    assert.deepEqual(
      drops.map((event) => [event.clientX, event.clientY]),
      [[77, 90]],
      "a native iframe drop keeps its original local coordinates",
    );
    drops.length = 0;
    propagated = 0;
    iframe.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer as never,
        clientX: 120,
        clientY: 240,
      }),
    );
    assert.deepEqual(
      drops.map((event) => [event.clientX, event.clientY]),
      [[100, 200]],
      "a chrome-document drop is translated into iframe coordinates once",
    );
    assert.equal(
      drops[0].dataTransfer?.getData("zotero/annotation"),
      transfer.getData("zotero/annotation"),
    );
  } finally {
    detach();
    doc.removeEventListener("drop", propagateToChromeAncestor, true);
    win.close();
  }
});
