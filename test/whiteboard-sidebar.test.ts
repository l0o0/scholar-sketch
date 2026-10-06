import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import {
  createSourceFile,
  isClassDeclaration,
  ModuleKind,
  ScriptTarget,
  transpileModule,
} from "typescript";
import {
  registerWhiteboardSidebar,
  unregisterWhiteboardSidebar,
  type WhiteboardSidebar,
} from "../src/modules/whiteboard/sidebar.ts";
import {
  whiteboardRegistry,
  WhiteboardSessionRegistry,
} from "../src/modules/whiteboard/session-registry.ts";

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

test("closing another surface restores the same-item sidebar without a Zotero render event", async (t) => {
  const win = new Window();
  const body = win.document.createElement("div");
  win.document.body.append(body);
  const registry = new WhiteboardSessionRegistry();
  const attachment = {
    id: 42,
    isAttachment: () => true,
    attachmentFilename: "stored.canvas",
    getDisplayTitle: () => "Research map",
    getField: () => "Research map",
  };
  const parent = {
    id: 41,
    isRegularItem: () => true,
    getAttachments: () => [42],
  };
  const session = (tabID: string, itemID: number) => ({
    tabID,
    canvasId: tabID,
    itemID,
    win: win as never,
    path: "/test.canvas",
    title: "Research map",
  });
  registry.register({ ...session("native-window", 42), surface: "window" });

  // Run the real controller against the real registry, supplying only its
  // native editor mount/close boundary. No Zotero onRender runs after close.
  const source = createSourceFile(
    "sidebar.ts",
    readFileSync(
      new URL("../src/modules/whiteboard/sidebar.ts", import.meta.url),
      "utf8",
    ),
    ScriptTarget.ES2022,
    true,
  );
  const declaration = source.statements.find(
    (node) =>
      isClassDeclaration(node) && node.name?.text === "WhiteboardSidebar",
  );
  assert.ok(declaration);
  const { outputText: code } = transpileModule(
    declaration.getText(source).replace(/^export\s+/, ""),
    {
      compilerOptions: {
        target: ScriptTarget.ES2022,
        module: ModuleKind.ESNext,
      },
    },
  );
  let openCalls = 0;
  const closed: string[] = [];
  const Sidebar = runInNewContext(`${code}\nWhiteboardSidebar;`, {
    whiteboardRegistry: registry,
    getString: (key: string) => key,
    childAttachmentIDs: () => [42],
    isWhiteboardAttachment: (item: typeof attachment) =>
      item.attachmentFilename?.endsWith(".canvas") ?? false,
    Zotero: { Items: { get: () => attachment } },
    ztoolkit: { log: () => {} },
    openWhiteboardSidebar: async (
      item: typeof attachment,
      _win: unknown,
      host: typeof body,
    ) => {
      openCalls += 1;
      if (registry.findByItem(item.id)) return null;
      host.replaceChildren(win.document.createElement("iframe"));
      registry.register({
        ...session("restored-sidebar", 42),
        surface: "sidebar",
      });
      return "restored-sidebar";
    },
    closeWhiteboardSession: async (tabID: string) => {
      closed.push(tabID);
      registry.unregister(tabID);
      return true;
    },
  }) as new (win: unknown) => {
    render: WhiteboardSidebar["render"];
    destroy: WhiteboardSidebar["destroy"];
    pending: Promise<void>;
  };
  const sidebar = new Sidebar(win);
  t.after(async () => {
    await sidebar.destroy();
    win.close();
  });
  const settle = async () => {
    for (let attempts = 0; attempts < 8; attempts++) {
      const pending = sidebar.pending;
      await pending;
      if (pending === sidebar.pending) return;
    }
    assert.fail("Sidebar kept remounting after its own registration");
  };
  sidebar.render(body as never, parent as never, true, () => {});
  await settle();
  assert.equal(openCalls, 1);
  assert.equal(body.children[1].textContent, "whiteboard-sidebar-open");
  assert.equal(body.querySelector("iframe"), null);

  registry.register(session("unrelated-window", 99));
  registry.unregister("unrelated-window");
  await settle();
  assert.equal(
    openCalls,
    1,
    "Other attachments must not refresh this controller",
  );

  registry.unregister("native-window");
  await settle();
  assert.equal(openCalls, 2);
  assert.equal(registry.findByItem(42)?.tabID, "restored-sidebar");
  assert.ok(body.querySelector("iframe"));
  assert.equal((body.children[1] as typeof body).hidden, true);

  await sidebar.destroy();
  await settle();
  assert.deepEqual(closed, ["restored-sidebar"]);
  assert.equal(registry.findByItem(42), undefined);
  registry.register(session("after-destroy", 42));
  registry.unregister("after-destroy");
  await settle();
  assert.equal(openCalls, 2, "Destroyed controllers must not recreate editors");
});
