import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Window } from "happy-dom";
import {
  disposeItemPaneForWindow,
  registerItemPane,
  unregisterItemPane,
} from "../src/modules/item-pane.ts";
import { findSidebarSessions } from "../src/modules/markdown/sidebar.ts";
import { SaveCoordinator } from "../src/modules/markdown/save-coordinator.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  EDITOR_PROTOCOL_VERSION,
  type ParentToEditorMessage,
} from "../src/modules/markdown/editor-protocol.ts";

function fixture(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const win = new Window({
    url: "https://item-pane.test/",
    settings: { disableIframePageLoading: true },
  });
  const markdown = {
    id: 2,
    key: "MD000002",
    libraryID: 0,
    isAttachment: () => true,
    isRegularItem: () => false,
    isStoredFileAttachment: () => false,
    isEditable: () => true,
    attachmentFilename: "note.md",
    getDisplayTitle: () => "Note",
    getField: () => "Note",
    getFilePathAsync: async (): Promise<string | null> => null,
  };
  const canvas = {
    id: 3,
    isAttachment: () => true,
    isRegularItem: () => false,
    attachmentFilename: "map.canvas",
    getDisplayTitle: () => "Map",
    getField: () => "Map",
  };
  const parent = {
    id: 1,
    isAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => [2, 3],
  };
  const items = new Map([
    [2, markdown],
    [3, canvas],
  ] as const);
  const registrations: any[] = [];
  const removals: string[] = [];
  const launched: string[] = [];
  Object.assign(globalThis, {
    addon: { data: { config: { addonID: "test", addonRef: "bamboo" } } },
    ztoolkit: { log() {} },
    Zotero: {
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      Prefs: { get: () => undefined },
      Libraries: { userLibraryID: 0 },
      Search: class {
        addCondition() {}
        async search() {
          return [];
        }
      },
      launchURL: (url: string) => launched.push(url),
      Items: { get: (id: number) => items.get(id) },
      File: { getContentsAsync: async () => "# Original note" },
      getMainWindows: () => [win],
      getMainWindow: () => win,
      ItemPaneManager: {
        registerSection(options: any) {
          registrations.push(options);
          return `test-${options.paneID}`;
        },
        unregisterSection(key: string) {
          removals.push(key);
        },
      },
    },
  });
  registerItemPane();
  const hooks = registrations[0];
  function pane(host = "item-pane") {
    const root = win.document.createElement(host);
    root.innerHTML = `<div class="shell"><div class="sections"><item-pane-custom-section data-pane="test-scholar-sketch"><collapsible-section><div data-type="body"></div></collapsible-section></item-pane-custom-section></div></div><item-pane-sidenav><button class="btn" data-pane="test-scholar-sketch"></button></item-pane-sidenav>`;
    win.document.body.append(root);
    const body = root.querySelector('[data-type="body"]')!;
    let summary = "";
    const result = {
      root,
      body,
      summary: () => summary,
      render(item: unknown, editable = false) {
        hooks.onRender({
          body,
          item,
          editable,
          setSectionSummary: (value: string) => {
            summary = value;
          },
        });
      },
      select(kind: "markdown" | "whiteboard") {
        body
          .querySelector<HTMLButtonElement>(`button[data-view="${kind}"]`)!
          .click();
      },
      panel(kind: "markdown" | "whiteboard") {
        return body.querySelector<HTMLElement>(
          `.scholar-sketch-pane-view[data-view="${kind}"]`,
        );
      },
      destroy() {
        hooks.onDestroy({ doc: win.document, body });
      },
    };
    hooks.onInit({ doc: win.document, body });
    return result;
  }
  t.after(async () => {
    await unregisterItemPane();
    await win.happyDOM.close();
    const globals = globalThis as unknown as Record<string, unknown>;
    for (const key of Object.keys(globals)) {
      if (!Object.hasOwn(previous, key)) delete globals[key];
    }
    for (const [key, descriptor] of Object.entries(previous)) {
      if (Object.getOwnPropertyDescriptor(globalThis, key)?.configurable)
        Object.defineProperty(globalThis, key, descriptor);
    }
  });
  return {
    win,
    markdown,
    canvas,
    parent,
    pane,
    registrations,
    removals,
    launched,
  };
}

test("one native Scholar Sketch entry routes attachments and lazily switches parent views", async (t) => {
  const f = fixture(t);
  registerItemPane();
  assert.equal(f.registrations.length, 1);
  assert.equal(f.registrations[0].paneID, "scholar-sketch");
  assert.match(f.registrations[0].sidenav.icon, /scholar-sketch-toolbar\.svg$/);
  assert.equal(f.registrations[0].header.icon, f.registrations[0].sidenav.icon);
  const main = f.pane();
  const reader = f.pane("context-pane");
  assert.equal(main.body.children.length, 0, "onInit must not create UI");
  main.render(f.parent);
  await nextTurn();
  assert.ok(main.panel("markdown"));
  assert.equal(main.panel("whiteboard"), null);
  main.select("whiteboard");
  await nextTurn();
  assert.equal(main.panel("markdown")!.hidden, true);
  assert.equal(main.panel("whiteboard")!.hidden, false);
  assert.equal(main.panel("whiteboard")!.querySelectorAll("option").length, 1);
  assert.equal(
    main.body.querySelector("iframe"),
    null,
    "read-only canvas must not mount an editor",
  );
  reader.render(f.markdown);
  assert.ok(reader.root.querySelector(".zmd-sidebar-focus-section"));
  assert.equal(main.panel("whiteboard")!.hidden, false);
  reader.render(f.canvas);
  await nextTurn();
  assert.equal(reader.root.querySelector(".zmd-sidebar-focus-section"), null);
  assert.equal(reader.panel("whiteboard")!.hidden, false);
  assert.equal(
    reader.body.querySelector<HTMLElement>("[role=tablist]")!.hidden,
    true,
  );
  // A hidden Markdown controller must not reclaim the shared native pane.
  reader.root
    .querySelector<HTMLButtonElement>("item-pane-sidenav button")!
    .click();
  assert.equal(reader.root.querySelector(".zmd-sidebar-focus-section"), null);
  main.body
    .querySelector<HTMLButtonElement>('button[data-view="whiteboard"]')!
    .dispatchEvent(
      new f.win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
  assert.equal(main.panel("markdown")!.hidden, false);
  assert.equal(reader.panel("whiteboard")!.hidden, false);
  await unregisterItemPane();
  assert.deepEqual(f.removals, ["test-scholar-sketch"]);
});

test("switching away cancels a pending Markdown mount without borrowing another body", async (t) => {
  const f = fixture(t);
  let finish!: (path: string) => void;
  f.markdown.getFilePathAsync = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const main = f.pane();
  main.render(f.markdown);
  main.render(f.canvas);
  finish("/note.md");
  await nextTurn();
  assert.equal(main.body.querySelector("iframe"), null);
  assert.deepEqual(findSidebarSessions(2), []);
  assert.equal(main.panel("whiteboard")!.hidden, false);

  const detached = f.pane("context-pane");
  detached.root.remove();
  detached.render(f.markdown);
  assert.equal(main.panel("markdown")!.children.length, 1);
  assert.equal(detached.panel("markdown")!.children.length, 0);
  detached.destroy();
  await disposeItemPaneForWindow(f.win as never);
});

test("switching views keeps the Markdown draft and native destruction remains awaitable", async (t) => {
  const f = fixture(t);
  f.markdown.getFilePathAsync = async () => "/note.md";
  const main = f.pane();
  main.render(f.markdown, true);
  await nextTurn();
  const session = findSidebarSessions(2)[0];
  assert.ok(session, "production Markdown controller registered a live editor");
  const iframe = main.body.querySelector("iframe");
  assert.ok(iframe);
  session.editor.setValue("# Unsaved draft");
  session.save.markChanged();
  // Persistence itself has dedicated tests; hold its existing coordinator
  // boundary to verify ownership and waiting in the native pane lifecycle.
  let finishSave!: () => void;
  const saved: string[] = [];
  let holdSave = false;
  const saveGate = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  t.mock.method(
    SaveCoordinator.prototype,
    "request",
    async function (this: SaveCoordinator) {
      saved.push(session.editor.getValue());
      if (holdSave) await saveGate;
      this.adoptPersistedSnapshot();
    },
  );
  main.render(f.canvas, false);
  await nextTurn();
  const canvasSummary = main.summary();
  session.save.markChanged();
  assert.equal(
    main.summary(),
    canvasSummary,
    "hidden drafts must not overwrite the active summary",
  );
  assert.equal(findSidebarSessions(2)[0].editor, session.editor);
  assert.equal(session.save.dirty, true);
  assert.equal(
    saved.length,
    0,
    "type switches retain the draft without destroying it",
  );
  main.render(f.markdown, true);
  assert.equal(main.body.querySelector("iframe"), iframe);
  assert.equal(findSidebarSessions(2)[0].editor.getValue(), "# Unsaved draft");
  main.render(f.parent, true);
  const frame = new Window({ url: "https://item-pane.test/frame" });
  t.after(() => frame.happyDOM.close());
  Object.defineProperty(iframe, "contentWindow", { value: frame });
  const messages: ParentToEditorMessage[] = [];
  frame.postMessage = ((message: ParentToEditorMessage) =>
    messages.push(message)) as typeof frame.postMessage;
  const send = (type: string, payload?: unknown) =>
    f.win.dispatchEvent(
      new f.win.MessageEvent("message", {
        source: frame,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          v: EDITOR_PROTOCOL_VERSION,
          channel: "pane-2",
          type,
          payload,
        },
      }),
    );
  send("ready");
  send("linkSearch", { requestId: 1, query: "Note", filter: "all" });
  send("openLink", { href: "https://example.com/reference" });
  await nextTurn();
  const results = messages.find(
    (message) => message.type === "linkSearchResults",
  );
  assert.equal(
    results?.type === "linkSearchResults" && results.payload.results[0]?.key,
    f.markdown.key,
    "the reused editor still searches references beneath its parent item",
  );
  assert.deepEqual(f.launched, ["https://example.com/reference"]);
  holdSave = true;
  main.destroy();
  let closed = false;
  const closing = disposeItemPaneForWindow(f.win as never).then(() => {
    closed = true;
  });
  await nextTurn();
  assert.equal(
    closed,
    false,
    "native onDestroy must not lose its pending save",
  );
  finishSave();
  await closing;
  assert.deepEqual(saved, ["# Unsaved draft"]);
  assert.deepEqual(findSidebarSessions(2), []);
});
