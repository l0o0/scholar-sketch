import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  registerWhiteboardSidebar,
  unregisterWhiteboardSidebar,
} from "../src/modules/whiteboard/sidebar.ts";
import { whiteboardRegistry } from "../src/modules/whiteboard/session-registry.ts";

test("sidebar initializes lazily, lists only Canvas attachments, and respects read-only libraries", async (t) => {
  const win = new Window();
  const body = win.document.createElement("div");
  win.document.body.append(body);
  let hooks: any;
  const attachment = {
    id: 2,
    isAttachment: () => true,
    attachmentFilename: "stored.canvas",
    getDisplayTitle: () => "Research map",
    getField: () => "Research map",
  };
  const pdf = {
    id: 3,
    isAttachment: () => true,
    attachmentFilename: "paper.pdf",
  };
  const parent = {
    id: 1,
    isAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => [2, 3],
  };
  const globals = {
    addon: { data: { config: { addonRef: "bamboo", addonID: "test" } } },
    ztoolkit: { log: () => {} },
    Zotero: {
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      Items: { get: (id: number) => (id === 2 ? attachment : pdf) },
      getMainWindows: () => [win],
      ItemPaneManager: {
        registerSection: (options: any) => {
          hooks = options;
          return "test-sidebar";
        },
        unregisterSection: () => {},
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  let summary = "";
  registerWhiteboardSidebar();
  hooks.onInit({ doc: win.document, body });
  assert.equal(body.children.length, 0);
  hooks.onRender({
    body,
    item: parent,
    editable: false,
    setSectionSummary: (value: string) => {
      summary = value;
    },
  });
  await tick();
  assert.equal(body.querySelectorAll("option").length, 1);
  assert.equal(body.querySelector("option")?.textContent, "Research map");
  assert.equal(summary, "1");
  assert.equal(body.querySelector("button")?.disabled, true);
  assert.equal(body.querySelector("iframe"), null);
  whiteboardRegistry.register({
    tabID: "other-tab",
    canvasId: "test",
    itemID: 2,
    win: win as never,
    path: "/test.canvas",
    title: "Research map",
    surface: "tab",
  });
  hooks.onRender({
    body,
    item: parent,
    editable: true,
    setSectionSummary: () => {},
  });
  await tick();
  assert.equal(body.querySelector("button")?.disabled, false);
  assert.equal(body.querySelector("iframe"), null);
  assert.equal(whiteboardRegistry.findByItem(2)?.tabID, "other-tab");
  await unregisterWhiteboardSidebar();
  assert.equal(whiteboardRegistry.findByItem(2)?.tabID, "other-tab");
  whiteboardRegistry.unregister("other-tab");
  win.close();
});
