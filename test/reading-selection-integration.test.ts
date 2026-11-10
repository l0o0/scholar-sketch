import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import {
  mountMarkdownEditorSurface,
  closeMarkdownSession,
} from "../src/modules/markdown/tab.ts";
import { clearNoteLibraries } from "../src/modules/markdown/note-library.ts";
import { sessionRegistry } from "../src/modules/markdown/session-registry.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  EDITOR_PROTOCOL_VERSION,
  computeStats,
} from "../src/modules/markdown/editor-protocol.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function uiElement(doc: Document, tag: string, options: any = {}): HTMLElement {
  const node = doc.createElement(tag);
  node.classList.add(...(options.classList || []));
  Object.assign(node.style, options.styles);
  Object.assign(node, options.properties);
  for (const [key, value] of Object.entries(options.attributes || {}))
    node.setAttribute(key, String(value));
  for (const child of options.children || [])
    node.append(uiElement(doc, child.tag, child));
  return node;
}

async function fixture(t: TestContext, surface: "tab" | "window") {
  const globals = globalThis as any;
  const previous = new Map(
    Reflect.ownKeys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key)!,
    ]),
  );
  const win = new Window({
    url: "https://reading.example/",
    settings: { disableIframePageLoading: true },
  });
  const source = "# Reading\n\nSelected reading sentence.";
  const item: any = {
    id: surface === "tab" ? 7101 : 7102,
    key: surface === "tab" ? "READ0001" : "READ0002",
    libraryID: 1,
    attachmentFilename: "Reading.md",
    attachmentContentType: "text/markdown",
    attachmentLinkMode: 2,
    isAttachment: () => true,
    isRegularItem: () => false,
    isNote: () => false,
    isEditable: () => true,
    isStoredFileAttachment: () => false,
    getField: (field: string) => (field === "title" ? "Reading" : ""),
    getFilePathAsync: async () => "/fixture/Reading.md",
  };
  const prefs = new Map<string, unknown>();
  const observers = new Map<number, { notify(...args: any[]): void }>();
  let nextObserver = 0;
  let active = true;
  const requests: {
    text: string;
    options: unknown;
    finish(value: unknown): void;
  }[] = [];
  Object.assign(globals, {
    __buildVersion__: "0.2.26",
    __buildTime__: "2026-11-10T00:00:00Z",
    addon: {
      data: { config: { addonRef: "bamboo", addonName: "Scholar Sketch" } },
    },
    ztoolkit: {
      log() {},
      UI: { createElement: uiElement },
      getGlobal: (key: string) => (win as any)[key],
    },
    Zotero: {
      locale: "en-US",
      debug() {},
      logError() {},
      getMainWindow: () => win,
      Prefs: {
        get: (key: string) =>
          key.endsWith("featureUpdatesSeenVersion")
            ? "0.2.26"
            : key.endsWith("markdownToolbarMode")
              ? "always"
              : prefs.get(key),
        set: (key: string, value: unknown) => prefs.set(key, value),
      },
      Libraries: { userLibraryID: 1 },
      Items: { get: () => item, getAll: async () => [item] },
      Attachments: { LINK_MODE_LINKED_FILE: 2, LINK_MODE_LINKED_URL: 3 },
      File: { getContentsAsync: async () => source },
      Notifier: {
        registerObserver: (observer: { notify(...args: any[]): void }) => {
          const id = ++nextObserver;
          observers.set(id, observer);
          return id;
        },
        unregisterObserver: (id: number) => observers.delete(id),
      },
      PDFTranslate: {
        api: {
          translate: (text: string, options: unknown) =>
            new Promise((finish) => {
              requests.push({ text, options, finish });
            }),
        },
      },
    },
  });
  const mounted: { session?: ReturnType<typeof mountMarkdownEditorSurface> } =
    {};
  t.after(async () => {
    if (mounted.session) await closeMarkdownSession(mounted.session.tabID);
    clearNoteLibraries();
    await win.happyDOM.close();
    for (const key of Reflect.ownKeys(globals)) {
      if (!previous.has(key)) Reflect.deleteProperty(globals, key);
    }
    for (const [key, descriptor] of previous)
      Object.defineProperty(globals, key, descriptor);
  });
  const host = win.document.createElement("main");
  win.document.body.append(host);
  const session = mountMarkdownEditorSurface({
    sessionID: `reading-${surface}`,
    surface,
    item,
    path: "/fixture/Reading.md",
    content: source,
    storageLabel: "linked",
    win: win as unknown as globalThis.Window,
    container: host as unknown as HTMLElement,
    isActive: () => active,
    updateTitle() {},
  });
  mounted.session = session;
  const frame = session.view!.editorHost.querySelector("iframe")!;
  // Happy DOM does not create a window for a chrome:// iframe. Supply that
  // browser boundary while retaining the production editor message bridge.
  const editorWindow = new Window();
  Object.defineProperties(frame, {
    contentWindow: { configurable: true, value: editorWindow },
    contentDocument: { configurable: true, value: editorWindow.document },
  });
  t.after(() => editorWindow.happyDOM.close());
  const message = (type: string, payload?: unknown) =>
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          v: EDITOR_PROTOCOL_VERSION,
          channel: `${session.tabID}:${item.id}`,
          type,
          ...(payload === undefined ? {} : { payload }),
        },
        source: frame.contentWindow as any,
      }),
    );
  t.mock.method(frame.contentWindow!, "postMessage", (command: any) => {
    if (command.type === "requestSnapshot")
      message("snapshot", {
        requestId: command.payload.requestId,
        rev: 0,
        value: source,
        stats: computeStats(source),
      });
  });
  message("ready");
  await session.editor!.ready;
  const mode = async (value: "live" | "source" | "preview") => {
    session
      .view!.root.querySelector<HTMLButtonElement>(
        ".zotero-markdown-mode-toggle",
      )!
      .click();
    session
      .view!.root.querySelector<HTMLButtonElement>(`[data-mode="${value}"]`)!
      .click();
    await flush();
  };
  const select = () => {
    const text = session.view!.previewEl.querySelector("p")!.firstChild!;
    const range = win.document.createRange();
    range.selectNodeContents(text as any);
    const rect = {
      left: 30,
      top: 60,
      right: 200,
      bottom: 82,
      width: 170,
      height: 22,
    };
    t.mock.method(range, "getBoundingClientRect", () => rect as any);
    t.mock.method(range, "getClientRects", () => [rect] as any);
    const selection = win.getSelection()!;
    selection.removeAllRanges();
    win.document.dispatchEvent(new win.Event("selectionchange"));
    selection.addRange(range);
    win.document.dispatchEvent(new win.Event("selectionchange"));
  };
  return {
    win,
    session,
    requests,
    mode,
    select,
    message,
    source,
    setActive: (value: boolean) => {
      active = value;
      for (const observer of observers.values())
        observer.notify("select", "tab", ["other-tab"]);
    },
  };
}

for (const surface of ["tab", "window"] as const) {
  test(`${surface} Live and Source selections open the translator without changing editor content`, async (t) => {
    const app = await fixture(t, surface);
    const panel = app.win.document.querySelector<HTMLElement>(
      ".zmd-reading-selection-popup",
    )!;
    const button = panel.querySelector<HTMLButtonElement>(
      ".zmd-reading-selection-translate",
    )!;
    const text = "Selected reading sentence.";
    const from = app.source.indexOf(text);
    const selection = {
      rev: 0,
      from,
      to: from + text.length,
      text,
      rect: { left: 30, top: 60, right: 200, bottom: 82 },
    };
    for (const mode of ["live", "source"] as const) {
      await app.mode(mode);
      app.message("textSelection", selection);
      assert.equal(panel.style.display, "block", mode);
      const count = app.requests.length;
      button.click();
      assert.equal(app.requests.length, count + 1);
      assert.equal(app.requests[count].text, text);
      app.requests[count].finish({ status: "success", result: `译文 ${mode}` });
      await flush();
      assert.equal(
        panel.querySelector(".zmd-reading-selection-result")!.textContent,
        `译文 ${mode}`,
      );
      assert.equal(app.session.editor!.getValue(), app.source);
      assert.equal(app.session.save.dirty, false);
      app.message("textSelection", null);
      assert.equal(panel.style.display, "none");
    }
    app.message("textSelection", { ...selection, rev: 99 });
    assert.equal(
      panel.style.display,
      "none",
      "outdated revisions cannot open a popup",
    );
  });

  test(`${surface} reading selection reaches the configured translator and rejects mode/close responses`, async (t) => {
    const app = await fixture(t, surface);
    await app.mode("preview");
    assert.equal(app.session.mode, "preview");
    app.select();
    const button = app.win.document.querySelector<HTMLButtonElement>(
      ".zmd-reading-selection-translate",
    )!;
    assert.ok(button);
    assert.equal(
      app.requests.length,
      0,
      "selecting text alone never calls the provider",
    );
    button.click();
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].text, "Selected reading sentence.");
    assert.deepEqual(app.requests[0].options, {
      pluginID: "bamboo@@linxzh.com",
    });
    app.requests[0].finish({ status: "success", result: "译文" });
    await flush();
    assert.equal(
      app.win.document.querySelector(".zmd-reading-selection-result")!
        .textContent,
      "译文",
    );

    if (surface === "tab") {
      app.setActive(false);
      assert.equal(
        app.win.document.querySelector<HTMLElement>(
          ".zmd-reading-selection-popup",
        )!.style.display,
        "none",
      );
      app.setActive(true);
    }

    app.select();
    button.click();
    assert.equal(app.requests.length, 2);
    await app.mode("live");
    app.select();
    button.click();
    assert.equal(
      app.requests.length,
      2,
      "editor modes never invoke reading translation",
    );
    app.requests[1].finish({ status: "success", result: "Late mode result" });
    await flush();
    assert.doesNotMatch(app.win.document.body.textContent, /Late mode result/);
    await app.mode("preview");
    app.select();
    button.click();
    assert.equal(app.requests.length, 3);
    await closeMarkdownSession(app.session.tabID);
    app.requests[2].finish({ status: "success", result: "Late closed result" });
    await flush();
    assert.equal(
      app.win.document.querySelector(".zmd-reading-selection-popup"),
      null,
    );
    assert.equal(sessionRegistry.get(app.session.tabID), undefined);
    assert.doesNotMatch(
      app.win.document.body.textContent,
      /Late closed result/,
    );
  });
}

test("a failed standalone close hides stale results while retaining the translation surface", async (t) => {
  const app = await fixture(t, "window");
  await app.mode("preview");
  app.select();
  app.win.document
    .querySelector<HTMLButtonElement>(".zmd-reading-selection-translate")!
    .click();
  const request = t.mock.method(app.session.save, "request", async () => {
    throw new Error("Fixture save failed");
  });
  await assert.rejects(
    closeMarkdownSession(app.session.tabID, {
      flush: true,
      throwOnSaveError: true,
    }),
    /Fixture save failed/,
  );
  request.mock.restore();
  assert.equal(sessionRegistry.get(app.session.tabID), app.session);
  assert.equal(app.session.closing, false);
  const panel = app.win.document.querySelector<HTMLElement>(
    ".zmd-reading-selection-popup",
  )!;
  assert.ok(panel.isConnected);
  assert.equal(panel.style.display, "none");
  app.requests[0].finish({ status: "success", result: "Stale close result" });
  await flush();
  assert.doesNotMatch(panel.textContent, /Stale close result/);
  app.select();
  assert.equal(panel.style.display, "block");
});
