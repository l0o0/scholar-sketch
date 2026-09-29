import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import {
  closeWhiteboardSession,
  openWhiteboardTab,
  openWhiteboardWindow,
  openWhiteboardSidebar,
} from "../src/modules/whiteboard/tab.ts";
import {
  whiteboardRegistry,
  type WhiteboardSession,
} from "../src/modules/whiteboard/session-registry.ts";

function setup(t: TestContext) {
  const win = new Window();
  const root = win.document.createElement("div");
  win.document.body.append(root);
  const calls: string[] = [];
  const item = {
    id: 501,
    isAttachment: () => true,
    attachmentFilename: "test.canvas",
    getFilePathAsync: async () => "/tmp/test.canvas",
  } as unknown as Zotero.Item;
  class ProgressWindow {
    createLine() {
      return this;
    }
    show() {
      calls.push("error");
      return this;
    }
  }
  const globals = {
    addon: {
      data: { config: { addonName: "Scholar Sketch", addonRef: "bamboo" } },
    },
    ztoolkit: { log: () => {}, ProgressWindow },
    Zotero: {
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      getMainWindow: () => ({ openDialog: () => null }),
      File: {
        getContentsAsync: async () =>
          JSON.stringify({ version: 2, nodes: [], connections: [] }),
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const session = {
    tabID: "test-window",
    canvasId: "test",
    itemID: item.id,
    win: win as unknown as globalThis.Window,
    path: "/tmp/test.canvas",
    title: "Canvas",
    surface: "window",
    view: { root, host: root },
    editor: {
      destroy: () => calls.push("destroy"),
      focus: () => calls.push("focus"),
    },
    saveCoordinator: {
      request: async () => {
        calls.push("save");
      },
      flush: async () => {},
    },
    closeHost: () => calls.push("close"),
  } as unknown as WhiteboardSession;
  whiteboardRegistry.register(session);
  t.after(() => {
    whiteboardRegistry.unregister(session.tabID);
    win.close();
  });
  return { win, root, calls, item, session };
}

test("window close waits for the final save and coalesces repeated close requests", async (t) => {
  const { session, calls, root } = setup(t);
  let finish!: () => void;
  session.saveCoordinator!.request = () =>
    new Promise<void>((resolve) => {
      calls.push("save");
      finish = resolve;
    });
  const first = closeWhiteboardSession(session.tabID);
  assert.equal(closeWhiteboardSession(session.tabID), first);
  assert.deepEqual(calls, ["save"]);
  assert.equal(root.inert, true);
  assert.equal(whiteboardRegistry.findByItem(session.itemID), session);
  finish();
  assert.equal(await first, true);
  assert.deepEqual(calls, ["save", "destroy", "close"]);
  assert.equal(whiteboardRegistry.findByItem(session.itemID), undefined);
});

test("failed close preserves a usable window and can be retried", async (t) => {
  const { session, calls, root } = setup(t);
  session.saveCoordinator!.request = async () => {
    throw new Error("Disk full");
  };
  assert.equal(await closeWhiteboardSession(session.tabID), false);
  assert.deepEqual(calls, ["error"]);
  assert.equal(whiteboardRegistry.findByItem(session.itemID), session);
  assert.equal(root.inert, false);
  assert.equal(session.closing, undefined);
  session.saveCoordinator!.request = async () => {
    calls.push("save");
  };
  assert.equal(await closeWhiteboardSession(session.tabID), true);
  assert.deepEqual(calls, ["error", "save", "destroy", "close"]);
});

test("reopening a Canvas focuses its standalone window without requiring Zotero tabs", async (t) => {
  const { session, item, calls } = setup(t);
  const ids = await Promise.all([
    openWhiteboardWindow(item),
    openWhiteboardWindow(item),
    openWhiteboardTab(item),
  ]);
  assert.deepEqual(ids, [session.tabID, session.tabID, session.tabID]);
  assert.deepEqual(calls, ["focus", "focus", "focus"]);
  assert.equal(whiteboardRegistry.all().length, 1);
});

test("failed transfer retains the source editor and releases its input lock", async (t) => {
  const { session, item, root, calls } = setup(t);
  session.surface = "tab";
  await assert.rejects(openWhiteboardWindow(item));
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
  assert.deepEqual(calls, ["save"]);
  assert.equal(session.transitioning, false);
  assert.equal(root.inert, false);
  session.saveCoordinator!.request = async () => {
    throw new Error("Disk full");
  };
  await assert.rejects(openWhiteboardWindow(item), /Disk full/);
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
  assert.equal(root.inert, false);
});

test("sidebar close saves even before dirty notification and never closes its host window", async (t) => {
  const { session, calls } = setup(t);
  session.surface = "sidebar";
  assert.equal(await closeWhiteboardSession(session.tabID), true);
  assert.deepEqual(calls, ["save", "destroy"]);
});

test("sidebar rendering does not steal an existing editor", async (t) => {
  const { session, item, win, root, calls } = setup(t);
  assert.equal(
    await openWhiteboardSidebar(item, win as never, root as never),
    null,
  );
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
  assert.deepEqual(calls, []);
});

test("failed sidebar save retains the editor and opening in a tab does not focus a nonexistent Zotero tab", async (t) => {
  const { session, item, root } = setup(t);
  session.surface = "sidebar";
  session.saveCoordinator!.request = async () => {
    throw new Error("Disk full");
  };
  assert.equal(await closeWhiteboardSession(session.tabID), false);
  await assert.rejects(openWhiteboardTab(item), /Disk full/);
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
  assert.equal(root.inert, false);
});
