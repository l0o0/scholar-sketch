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
