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
import { WhiteboardSidebarLayout } from "../src/modules/whiteboard/sidebar-layout.ts";
import { WhiteboardSidebar } from "../src/modules/whiteboard/sidebar.ts";
import {
  whiteboardRegistry,
  WhiteboardSessionRegistry,
} from "../src/modules/whiteboard/session-registry.ts";

test("sidebar initializes lazily for the current Canvas and respects read-only libraries", async (t) => {
  const win = new Window();
  const body = win.document.createElement("div");
  win.document.body.append(body);
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
      Prefs: { get: () => undefined, set: () => {} },
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      Items: { get: (id: number) => (id === 2 ? attachment : pdf) },
      getMainWindows: () => [win],
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
  const sidebar = new WhiteboardSidebar(win as never);
  assert.equal(body.children.length, 0);
  sidebar.render(body as never, attachment as never, false, (value) => {
    summary = value;
  });
  await tick();
  assert.equal(body.querySelector("select"), null);
  assert.equal(summary, "");
  assert.equal(
    body.querySelector<HTMLElement>(".scholar-sketch-whiteboard-host")?.style
      .height,
    "321px",
  );
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
  sidebar.render(body as never, attachment as never, true, () => {});
  await tick();
  assert.equal(body.querySelector("button")?.disabled, false);
  assert.equal(body.querySelector("iframe"), null);
  assert.equal(whiteboardRegistry.findByItem(2)?.tabID, "other-tab");
  sidebar.render(body as never, parent as never, true, () => {});
  await tick();
  assert.equal(body.querySelector("iframe"), null);
  assert.equal(body.querySelector("button")?.disabled, true);
  await sidebar.destroy();
  assert.equal(whiteboardRegistry.findByItem(2)?.tabID, "other-tab");
  whiteboardRegistry.unregister("other-tab");
  win.close();
});

test("sidebar follows selected canvases and locks preserved drafts when saving fails", async (t) => {
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
  const previousZotero = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    writable: true,
    value: { Prefs: { get: () => undefined, set: () => {} } },
  });
  t.after(() =>
    previousZotero
      ? Object.defineProperty(globalThis, "Zotero", previousZotero)
      : Reflect.deleteProperty(globalThis, "Zotero"),
  );
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
  const openedItems: number[] = [];
  let allowClose = true;
  const closed: string[] = [];
  const Sidebar = runInNewContext(`${code}\nWhiteboardSidebar;`, {
    whiteboardRegistry: registry,
    getString: (key: string) => key,
    WhiteboardSidebarLayout,
    isWhiteboardAttachment: (item: typeof attachment) =>
      item.attachmentFilename?.endsWith(".canvas") ?? false,
    Zotero: { Items: { get: (id: number) => ({ ...attachment, id }) } },
    ztoolkit: { log: () => {} },
    openWhiteboardSidebar: async (
      item: typeof attachment,
      _win: unknown,
      host: typeof body,
    ) => {
      openCalls += 1;
      openedItems.push(item.id);
      if (registry.findByItem(item.id)) return null;
      host.replaceChildren(win.document.createElement("iframe"));
      registry.register({
        ...session("restored-sidebar", item.id),
        surface: "sidebar",
      });
      return "restored-sidebar";
    },
    closeWhiteboardSession: async (tabID: string) => {
      closed.push(tabID);
      if (!allowClose) return false;
      registry.unregister(tabID);
      return true;
    },
  }) as new (win: unknown) => {
    render: WhiteboardSidebar["render"];
    destroy: WhiteboardSidebar["destroy"];
    setActive: WhiteboardSidebar["setActive"];
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
  sidebar.render(body as never, attachment as never, true, () => {});
  await settle();
  assert.equal(openCalls, 1);
  assert.equal(body.children[0].textContent, "whiteboard-sidebar-open");
  assert.equal(body.querySelector("iframe"), null);

  registry.register(session("unrelated-window", 99));
  registry.unregister("unrelated-window");
  await settle();
  assert.equal(
    openCalls,
    1,
    "Other attachments must not refresh this controller",
  );

  sidebar.setActive(false);
  registry.unregister("native-window");
  await settle();
  assert.equal(
    openCalls,
    1,
    "Hidden views must not reopen editors after a registry event",
  );
  sidebar.setActive(true);
  sidebar.render(body as never, attachment as never, true, () => {});
  await settle();
  assert.equal(openCalls, 2);
  assert.equal(registry.findByItem(42)?.tabID, "restored-sidebar");
  assert.ok(body.querySelector("iframe"));
  assert.equal((body.children[0] as typeof body).hidden, true);

  const draftFrame = body.querySelector("iframe");
  const host = body.querySelector<HTMLElement>(
    ".scholar-sketch-whiteboard-host",
  )!;
  const retry = () =>
    body.querySelector<HTMLButtonElement>('[data-action="retry-save"]')!;
  allowClose = false;
  sidebar.render(
    body as never,
    { ...attachment, id: 43 } as never,
    true,
    () => {},
  );
  assert.equal(
    host.style.display,
    "none",
    "selection changes must immediately hide the old editor",
  );
  assert.equal(host.inert, true);
  await settle();
  assert.equal(
    openCalls,
    2,
    "a failed save must not mount a different document",
  );
  assert.equal(registry.findByItem(42)?.tabID, "restored-sidebar");
  assert.equal(
    body.querySelector("iframe"),
    draftFrame,
    "the hidden draft remains mounted",
  );
  assert.equal(host.style.display, "none");
  assert.equal(body.children[0].textContent, "whiteboard-sidebar-save-blocked");
  assert.equal(retry().hidden, false);
  assert.equal(retry().disabled, false);

  sidebar.render(body as never, attachment as never, true, () => {});
  await settle();
  assert.equal(body.querySelector("iframe"), draftFrame);
  assert.equal(host.style.display, "flex");
  assert.equal(host.inert, false);
  assert.equal(retry().hidden, true);
  assert.equal((body.children[0] as typeof body).hidden, true);
  assert.equal(openCalls, 2, "returning to the draft must not reload it");

  sidebar.render(body as never, attachment as never, false, () => {});
  assert.equal(
    host.style.display,
    "none",
    "read-only changes must immediately stop editing",
  );
  assert.equal(host.inert, true);
  await settle();
  assert.equal(registry.findByItem(42)?.tabID, "restored-sidebar");
  assert.equal(body.querySelector("iframe"), draftFrame);
  assert.equal(host.style.display, "none");
  assert.equal(retry().hidden, false);

  sidebar.render(
    body as never,
    { ...attachment, id: 43 } as never,
    true,
    () => {},
  );
  await settle();
  allowClose = true;
  retry().click();
  await settle();
  assert.equal(
    openedItems.at(-1),
    43,
    "retry must open the selected item, not revert to the old draft",
  );
  assert.equal(openCalls, 3);
  assert.equal(registry.findByItem(42), undefined);
  assert.equal(registry.findByItem(43)?.tabID, "restored-sidebar");
  assert.notEqual(body.querySelector("iframe"), draftFrame);
  assert.equal(host.style.display, "flex");
  assert.equal(host.inert, false);
  assert.equal(retry().hidden, true);

  await sidebar.destroy();
  await settle();
  assert.equal(closed.length, 5);
  assert.equal(registry.findByItem(43), undefined);
  assert.equal(registry.findByItem(42), undefined);
  registry.register(session("after-destroy", 42));
  registry.unregister("after-destroy");
  await settle();
  assert.equal(openCalls, 3, "Destroyed controllers must not recreate editors");
});

test("sidebar focus restores native geometry and the resized compact height", (t) => {
  const win = new Window();
  const root = win.document.createElement("item-pane");
  root.innerHTML = `<div class="shell"><div class="sections" style="--min-scroll-height: 720px"><item-pane-custom-section data-pane="test-scholar-sketch"><div class="body"><div class="host"></div></div></item-pane-custom-section><section data-pane="info"></section></div></div><item-pane-sidenav><button class="btn" data-pane="test-scholar-sketch"></button><button class="btn" data-pane="info"></button></item-pane-sidenav>`;
  win.document.body.append(root);
  const body = root.querySelector<HTMLElement>(".body")!;
  const host = root.querySelector<HTMLElement>(".host")!;
  const sections = root.querySelector<HTMLElement>(".sections")!;
  let height: number | undefined;
  const writes: number[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    writable: true,
    value: {
      Prefs: {
        get: () => height,
        set: (_key: string, value: number) => {
          height = value;
          writes.push(value);
        },
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Zotero", previous);
    else Reflect.deleteProperty(globalThis, "Zotero");
    win.close();
  });
  let resize!: () => void;
  let disconnected = 0;
  Object.defineProperty(win, "ResizeObserver", {
    value: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  });
  const focusChanges: boolean[] = [];
  const layout = new WhiteboardSidebarLayout(
    win as never,
    body,
    host,
    (focused) => focusChanges.push(focused),
  );
  assert.equal(host.style.height, "321px");
  host.style.height = "465px";
  resize();
  assert.deepEqual(writes, [465]);
  layout.setFocused(true);
  assert.equal(sections.classList.contains("zmd-sidebar-focus-mode"), true);
  assert.equal(
    root.querySelector(".shell")!.classList.contains("zmd-sidebar-focus-shell"),
    true,
  );
  assert.equal(sections.style.getPropertyValue("--min-scroll-height"), "");
  assert.equal(root.querySelector('[data-pane="info"]')!.className, "");
  resize();
  assert.deepEqual(
    writes,
    [465],
    "focus geometry must not replace the compact preference",
  );
  root
    .querySelector<HTMLButtonElement>(
      'button[data-pane="test-scholar-sketch"]',
    )!
    .click();
  assert.equal(layout.focused, true);
  root.querySelector<HTMLButtonElement>('button[data-pane="info"]')!.click();
  assert.equal(layout.focused, false);
  assert.equal(host.style.height, "465px");
  assert.equal(sections.style.getPropertyValue("--min-scroll-height"), "720px");
  assert.equal(root.querySelector(".zmd-sidebar-focus-section"), null);
  layout.setFocused(true);
  layout.destroy();
  assert.equal(root.querySelector(".zmd-sidebar-focus-mode"), null);
  assert.equal(root.querySelector(".zmd-sidebar-focus-shell"), null);
  assert.equal(sections.style.getPropertyValue("--min-scroll-height"), "720px");
  assert.equal(disconnected, 1);
  assert.deepEqual(focusChanges, [true, false, true, false]);
  const restored = new WhiteboardSidebarLayout(
    win as never,
    body,
    host,
    () => {},
  );
  assert.equal(host.style.height, "465px");
  restored.destroy();
});
