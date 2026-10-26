import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import { createMarkdownEditor } from "../src/modules/markdown/editor.ts";
import { searchDocumentLinks } from "../src/modules/markdown/document-links.ts";
import {
  clearNoteLibraries,
  downloadNoteAttachment,
  updateIndexedNote,
} from "../src/modules/markdown/note-library.ts";
import {
  mountBacklinksSidebar,
  mountNoteBacklinks,
} from "../src/modules/markdown/backlinks.ts";
import {
  isEditorProtocolMessage,
  EDITOR_MESSAGE_SOURCE,
} from "../src/modules/markdown/editor-protocol.ts";
import { ensureDOMGlobals } from "../src/utils/dom.ts";

function fixtures(t: TestContext, extraAttachments = 0) {
  const fake = createFakeZotero({
    items: [
      {
        id: 1,
        key: "PARENT01",
        itemType: "journalArticle",
        fields: { title: "Parent" },
      },
      {
        id: 2,
        parentID: 1,
        key: "MDNOTE01",
        itemType: "attachment",
        fields: { title: "Research" },
        attachmentContentType: "text/markdown",
      },
      {
        id: 3,
        parentID: 1,
        key: "MDNOTE02",
        itemType: "attachment",
        fields: { title: "Research" },
        attachmentContentType: "text/markdown",
      },
      ...Array.from({ length: extraAttachments }, (_, index) => ({
        id: 20 + index,
        parentID: 1,
        key: `WAIT${String(index).padStart(4, "0")}`,
        itemType: "attachment",
        fields: { title: `Waiting ${index}` },
        attachmentContentType: "text/markdown",
      })),
    ],
  });
  const files = new Map([
    ["MDNOTE01", "# Findings\n\n[[Research--MDNOTE02|Other note]]"],
    ["MDNOTE02", "# Second note\n"],
  ]);
  for (const id of [
    2,
    3,
    ...Array.from({ length: extraAttachments }, (_, index) => 20 + index),
  ]) {
    const item = fake.Zotero.Items.get(id)!;
    Object.assign(item, {
      attachmentFilename: "zmd-Research.md",
      attachmentLinkMode: 0,
      getFilePathAsync: async () => item.key,
      isTrashed: () => false,
    });
  }
  Object.assign(fake.Zotero, {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    File: { getContentsAsync: async (path: string) => files.get(path) },
  });
  clearNoteLibraries();
  const restore = fake.install();
  t.after(() => {
    clearNoteLibraries();
    restore();
  });
  return {
    fake,
    files,
    item: (id: number) => fake.Zotero.Items.get(id) as unknown as Zotero.Item,
  };
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), "expected editor/UI response");
}

test("portable completion payload keeps the attachment key and rejects mismatched targets", () => {
  const candidate = {
    key: "MDNOTE01",
    libraryID: 1,
    title: "Research",
    kind: "markdown",
    filename: "zmd-Research.md",
    href: "Research--MDNOTE01.md",
  };
  const accepts = (changes: object) =>
    isEditorProtocolMessage({
      source: EDITOR_MESSAGE_SOURCE,
      type: "linkSearchResults",
      payload: {
        requestId: 1,
        query: "",
        results: [{ ...candidate, ...changes }],
      },
    });
  assert.equal(accepts({}), true);
  assert.equal(accepts({ href: "Research--PARENT01.md" }), false);
  assert.equal(accepts({ href: "../Research--MDNOTE01.md" }), false);
  assert.equal(accepts({ filename: { malicious: true } }), false);
});

test("real editor completion writes a portable attachment Wiki link and preserves an entered alias", async (t) => {
  const { item } = fixtures(t);
  const globals = globalThis as any;
  const beforeToolkit = globals.ztoolkit;
  const beforeWindow = globals.Window;
  globals.ztoolkit = { log() {} };
  const browser = new Window({ url: "https://lab.example/" });
  const host = browser.document.createElement("div");
  browser.document.body.append(host);
  const opened: string[] = [];
  const editor = createMarkdownEditor(host as any, {
    win: browser as any,
    channel: "portable-completion",
    doc: "# Findings\n\n    [[Research--MDNOTE02|Indented]]\n\n",
    pageURL: "https://lab.example/editor.html",
    onOpenLink: (href) => {
      opened.push(href);
    },
    onLinkSearch: (query, filter) =>
      searchDocumentLinks(item(2), query, false, {
        filter,
        win: browser as any,
        currentContent: editor.getValue(),
      }),
  });
  t.after(() => {
    editor.destroy();
    browser.close();
    globals.ztoolkit = beforeToolkit;
    globals.Window = beforeWindow;
  });
  const frame = host.querySelector("iframe")!.contentWindow!;
  frame.document.body.innerHTML = '<div id="editor-root"></div>';
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
  ensureDOMGlobals(frame as any);
  globals.Window = frame.Window;
  await import("../src/editor/bootstrap.ts");
  frame.document.dispatchEvent(new frame.Event("DOMContentLoaded"));
  await until(() => !!frame.document.querySelector(".cm-content"));
  // Happy DOM cannot measure text ranges. Give the real popup a caret anchor
  // so its animation-frame positioning does not dismiss an otherwise valid query.
  const editorView = EditorView.findFromDOM(
    frame.document.querySelector(".cm-editor") as unknown as HTMLElement,
  );
  assert.ok(editorView);
  editorView.coordsAtPos = () => ({ left: 20, right: 20, top: 20, bottom: 40 });
  editor.revealPosition(editor.getValue().length);
  editor.insertText("[[Research|Chosen");
  await until(
    () => frame.document.querySelectorAll('[role="option"]').length === 2,
  );
  const candidate = [
    ...frame.document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((button) => button.title.includes("MDNOTE02"))!;
  candidate.click();
  await editor.requestSnapshot();
  assert.match(editor.getValue(), /\[\[Research--MDNOTE02\|Chosen\]\]/);
  assert.doesNotMatch(editor.getValue(), /zotero:\/\//);
  assert.deepEqual(opened, [], "completion inserts a link without opening it");
  editor.revealPosition(editor.getValue().length);
  editor.insertText("\n[[#Fi");
  await until(() =>
    [...frame.document.querySelectorAll('[role="option"]')].some((button) =>
      button.textContent.includes("Findings"),
    ),
  );
  (
    frame.document.querySelector('[role="option"]') as HTMLButtonElement
  ).click();
  await until(() => editor.getValue().includes("#Findings"));
  assert.match(editor.getValue(), /Research--MDNOTE01#Findings/);
  editor.revealPosition(0);
  await until(() =>
    [...frame.document.querySelectorAll("[data-zmd-link]")].some(
      (link) => link.textContent === "Chosen",
    ),
  );
  assert.deepEqual(opened, [], "selection changes do not open a link");
  const renderedLink = [
    ...frame.document.querySelectorAll("[data-zmd-link]"),
  ].find((link) => link.textContent === "Chosen")!;
  assert.equal(renderedLink.getAttribute("data-zmd-link"), "");
  const href = "[[Research--MDNOTE02|Chosen]]";
  assert.ok(editor.getValue().includes(href));
  const down = new frame.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    button: 0,
  });
  renderedLink.dispatchEvent(down);
  await until(() => opened.length === 1);
  assert.deepEqual(opened, [href]);
  assert.equal(down.defaultPrevented, true);
  const codeLine = [...frame.document.querySelectorAll(".cm-line")].find(
    (line) => line.textContent.includes("|Indented]]"),
  )!;
  assert.ok(codeLine, "the indented code remains visible as source");
  assert.equal(codeLine.querySelector("[data-zmd-link]"), null);
  const view = EditorView.findFromDOM(
    frame.document.querySelector(".cm-editor") as unknown as HTMLElement,
  );
  assert.ok(view);
  // Happy DOM has no layout hit-testing. Point the actual click handler at
  // the code label so the current-source resolver still handles the event.
  const posAtCoords = view.posAtCoords;
  view.posAtCoords = () => editor.getValue().indexOf("Indented");
  try {
    codeLine.dispatchEvent(
      new frame.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        button: 0,
      }),
    );
  } finally {
    view.posAtCoords = posAtCoords;
  }
  await editor.requestSnapshot();
  assert.deepEqual(opened, [href], "indented code is not a navigation link");
});

test("backlinks panel uses saved fixture content, updates after save, and navigates to the source offset", async (t) => {
  const { item } = fixtures(t);
  const browser = new Window();
  const opened: unknown[] = [];
  const dispose = mountNoteBacklinks(
    browser.document.body as any,
    item(3),
    browser as any,
    {
      labels: {
        title: "Linked mentions",
        refresh: "Refresh",
        loading: "Loading",
        empty: "Empty",
        incomplete: "Incomplete",
        failed: "Failed",
      },
      onNavigateNote: (note, _heading, position) => {
        opened.push([note.key, position]);
        return true;
      },
    },
  );
  t.after(() => {
    dispose();
    browser.close();
  });
  await until(
    () =>
      browser.document.querySelector(".zmd-backlinks-count")?.textContent ===
      "(1)",
  );
  const refresh = browser.document.querySelector(
    "summary .zmd-backlinks-refresh",
  )!;
  const click = new browser.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  refresh.dispatchEvent(click);
  assert.equal(
    click.defaultPrevented,
    true,
    "refresh must not toggle the panel",
  );
  assert.equal(browser.document.querySelector("details")!.open, true);
  await until(() => !(refresh as HTMLButtonElement).disabled);
  (
    browser.document.querySelector("strong")!.parentElement as HTMLButtonElement
  ).click();
  await until(() => opened.length === 1);
  assert.deepEqual(opened, [["MDNOTE01", 12]]);
  updateIndexedNote(item(2), "# Findings\n\nNo outgoing link.");
  await until(
    () =>
      browser.document.querySelector(".zmd-backlinks-count")?.textContent ===
      "(0)",
  );
  assert.equal(
    browser.document.querySelector('[role="status"]')!.textContent,
    "Empty",
  );
});

test("backlinks exposes unavailable note titles in a collapsed list and only locates the item", async (t) => {
  const { fake, item } = fixtures(t);
  const browser = new Window();
  const source = item(2);
  Object.assign(source, {
    getFilePathAsync: async () => false,
    getFilePath: () =>
      "C:\\Users\\Private\\Zotero\\storage\\MDNOTE01\\Research.md",
    isStoredFileAttachment: () => true,
  });
  Object.defineProperty(source, "attachmentSyncState", { get: () => 1 });
  const selected: number[] = [];
  (browser as any).ZoteroPane = {
    selectItem: async (id: number) => selected.push(id),
  };
  let downloads = 0;
  Object.assign(fake.Zotero, {
    Sync: { Runner: { downloadFile: () => downloads++ } },
  });
  const dispose = mountNoteBacklinks(
    browser.document.body as any,
    item(3),
    browser as any,
    {
      labels: {
        title: "Linked mentions",
        refresh: "Refresh",
        loading: "Loading",
        empty: "Empty",
        incomplete: "Not indexed",
        failed: "Failed",
        failureSummary: "Unavailable notes",
        notDownloaded: "Not downloaded",
        unavailable: "Unavailable locally",
        readError: "Read error",
        indexError: "Index error",
        locateNote: "Locate note",
      },
    },
  );
  t.after(() => {
    dispose();
    browser.close();
  });
  await until(
    () =>
      browser.document.querySelector('[role="status"]')?.textContent ===
      "Not indexed (1)",
  );
  assert.equal(
    browser.document.querySelector(".zmd-backlinks-count")!.textContent,
    "(0)",
  );
  const failures = browser.document.querySelector<HTMLDetailsElement>(
    ".zmd-backlinks-failures",
  )!;
  assert.equal(failures.hidden, false);
  assert.equal(failures.open, false, "failure details start collapsed");
  assert.equal(
    failures.querySelector("summary")!.textContent,
    "Unavailable notes (1)",
  );
  const locate = failures.querySelector<HTMLButtonElement>(
    'button[data-note-key="MDNOTE01"]',
  )!;
  assert.ok(locate);
  assert.equal(locate.textContent, "Research");
  assert.match(failures.textContent, /Not downloaded/);
  assert.doesNotMatch(
    failures.textContent,
    /Users|Private|storage|path|readError/,
  );
  locate.click();
  await until(() => selected.length === 1);
  assert.deepEqual(selected, [source.id]);
  assert.equal(
    downloads,
    0,
    "locating an unavailable attachment must not download it",
  );
  dispose();
  locate.click();
  assert.deepEqual(
    selected,
    [source.id],
    "disposed diagnostic actions cannot select items",
  );
});

test("unavailable diagnostics are bounded and remain static without a native selection pane", async (t) => {
  const { fake, item } = fixtures(t);
  const browser = new Window();
  const unavailable = Array.from({ length: 12 }, (_, index) => ({
    id: 20 + index,
    libraryID: item(3).libraryID,
    key: `FAIL${String(index).padStart(4, "0")}`,
    attachmentFilename: `Waiting-${index}.md`,
    attachmentContentType: "text/markdown",
    attachmentLinkMode: 0,
    isAttachment: () => true,
    getField: () => `Waiting ${index}`,
    getFilePathAsync: async () => false,
  }));
  Object.assign(fake.Zotero.Items, {
    getAll: async () => [item(3), ...unavailable],
  });
  Object.assign(fake.Zotero, { getActiveZoteroPane: () => undefined });
  const dispose = mountNoteBacklinks(
    browser.document.body as any,
    item(3),
    browser as any,
  );
  t.after(() => {
    dispose();
    browser.close();
  });
  await until(
    () =>
      browser.document.querySelectorAll(".zmd-backlinks-failures li").length ===
      11,
  );
  const failures = browser.document.querySelector(".zmd-backlinks-failures")!;
  assert.equal(
    failures.querySelectorAll("li").length,
    11,
    "ten titles plus the remaining count",
  );
  assert.equal(
    failures.querySelectorAll("button[data-note-key]").length,
    0,
    "no inactive locate controls",
  );
  assert.match(failures.querySelector("li:last-child")!.textContent, /\(2\)$/);
  assert.doesNotMatch(failures.textContent, /Waiting 10|Waiting 11/);
  assert.equal(
    browser.document.querySelector(".zmd-backlinks-count")!.textContent,
    "(0)",
  );
});

function downloadFixtures(t: TestContext, sourceCount = 1) {
  const fixture = fixtures(t, sourceCount - 1);
  const { fake, files, item } = fixture;
  const sources = [
    item(2),
    ...Array.from({ length: sourceCount - 1 }, (_, index) => item(20 + index)),
  ];
  for (const source of sources) {
    files.delete(source.key);
    Object.assign(source, {
      // Missing files can still be marked in_sync by the native downloader.
      attachmentSyncState: 2,
      isStoredFileAttachment: () => true,
      getFilePath: () => `/storage/${source.key}/Research.md`,
      getFilePathAsync: async () =>
        files.has(source.key) ? source.key : false,
    });
  }
  const downloaded: string[] = [];
  const body = "# Downloaded note\n\n[[Research--MDNOTE02|Target]]";
  const runner = {
    async downloadFile(source: Zotero.Item): Promise<unknown> {
      downloaded.push(source.key);
      files.set(source.key, body);
      return { localChanges: true };
    },
  };
  Object.assign(fake.Zotero, {
    Sync: {
      Runner: runner,
      Storage: { Local: { getEnabledForLibrary: () => true } },
    },
  });
  const browser = new Window();
  const disposers: (() => void)[] = [];
  t.after(() => {
    for (const dispose of disposers) dispose();
    browser.close();
  });
  const mount = () => {
    const parent = browser.document.createElement("section");
    browser.document.body.append(parent);
    const dispose = mountNoteBacklinks(parent as any, item(3), browser as any, {
      labels: {
        title: "Linked mentions",
        refresh: "Refresh",
        loading: "Loading",
        empty: "Empty",
        incomplete: "Not indexed",
        failed: "Failed",
        download: "Download",
        downloadAll: "Download all",
        downloading: "Downloading",
        downloadComplete: "Download complete",
        downloadFailed: "Download failed; check file sync and retry",
      },
    });
    disposers.push(dispose);
    return { parent, dispose };
  };
  return { ...fixture, sources, browser, downloaded, body, runner, mount };
}

test("a missing stored attachment downloads on request and restores its backlink", async (t) => {
  const { sources, files, downloaded, fake, mount } = downloadFixtures(t);
  const { parent } = mount();
  await until(() => !!parent.querySelector(".zmd-backlinks-download"));
  assert.equal(
    parent.querySelector(".zmd-backlinks-count")!.textContent,
    "(0)",
  );
  assert.deepEqual(downloaded, [], "reading the index never downloads files");
  parent.querySelector<HTMLButtonElement>(".zmd-backlinks-download")!.click();
  await until(
    () => parent.querySelector(".zmd-backlinks-count")!.textContent === "(1)",
  );
  assert.deepEqual(downloaded, [sources[0].key]);
  assert.match(files.get(sources[0].key)!, /Research--MDNOTE02/);
  assert.equal(
    parent.querySelector<HTMLDetailsElement>(".zmd-backlinks-failures")!.hidden,
    true,
  );
  assert.equal(
    fake.calls.some(
      (call) =>
        call.method === "FileHandlers.open" || call.method === "Reader.open",
    ),
    false,
    "downloading must not open the attachment",
  );
});

test("download all includes hidden diagnostic rows and excludes linked files and read failures", async (t) => {
  const { sources, downloaded, files, mount } = downloadFixtures(t, 14);
  Object.assign(sources[12], { isStoredFileAttachment: () => false });
  Object.assign(sources[13], { getFilePathAsync: async () => sources[13].key });
  const { parent } = mount();
  await until(
    () =>
      parent
        .querySelector<HTMLButtonElement>(".zmd-backlinks-download-all")
        ?.textContent?.includes("(12)") === true,
  );
  assert.equal(
    parent.querySelectorAll(".zmd-backlinks-download").length,
    10,
    "the visible diagnostic list remains bounded",
  );
  parent
    .querySelector<HTMLButtonElement>(".zmd-backlinks-download-all")!
    .click();
  await until(
    () => parent.querySelector(".zmd-backlinks-count")!.textContent === "(12)",
  );
  await until(() =>
    parent
      .querySelector(".zmd-backlinks-download-status")!
      .textContent!.includes("Download complete"),
  );
  assert.deepEqual(
    downloaded,
    sources.slice(0, 12).map((source) => source.key),
  );
  assert.equal(files.has(sources[12].key), false);
  assert.equal(files.has(sources[13].key), false);
  assert.match(
    parent.querySelector(".zmd-backlinks-failures")!.textContent!,
    /\(2\)/,
  );
  assert.equal(parent.querySelectorAll(".zmd-backlinks-download").length, 0);
});

test("missing remote files and network errors stay failed and can be retried", async (t) => {
  const { runner, sources, files, body, mount } = downloadFixtures(t);
  let attempts = 0;
  runner.downloadFile = async () => {
    attempts++;
    if (attempts === 2) throw new Error("Network request failed");
    if (attempts === 3) files.set(sources[0].key, body);
    return { localChanges: false };
  };
  const { parent } = mount();
  await until(() => !!parent.querySelector(".zmd-backlinks-download"));
  parent.querySelector<HTMLButtonElement>(".zmd-backlinks-download")!.click();
  await until(() =>
    parent
      .querySelector(".zmd-backlinks-download-status")!
      .textContent!.includes("Download failed"),
  );
  assert.equal(
    parent.querySelector(".zmd-backlinks-count")!.textContent,
    "(0)",
  );
  const retry = parent.querySelector<HTMLButtonElement>(
    ".zmd-backlinks-download",
  )!;
  assert.equal(retry.disabled, false);
  retry.click();
  await until(
    () =>
      attempts === 2 &&
      parent
        .querySelector(".zmd-backlinks-download-status")!
        .textContent!.includes("Download failed"),
  );
  parent.querySelector<HTMLButtonElement>(".zmd-backlinks-download")!.click();
  await until(
    () => parent.querySelector(".zmd-backlinks-count")!.textContent === "(1)",
  );
  assert.equal(attempts, 3);
});

test("a library with file sync disabled does not start a native download", async (t) => {
  const { fake, sources, downloaded, files } = downloadFixtures(t);
  (fake.Zotero as any).Sync.Storage.Local.getEnabledForLibrary = () => false;
  assert.equal(
    await downloadNoteAttachment(sources[0].libraryID, sources[0].key),
    false,
  );
  assert.deepEqual(downloaded, []);
  assert.equal(files.has(sources[0].key), false);
});

test("closing the panel stops the remaining batch without cancelling the native download", async (t) => {
  const { runner, sources, files, body, downloaded, mount } = downloadFixtures(
    t,
    3,
  );
  let finishDownload!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishDownload = resolve;
  });
  runner.downloadFile = async (source) => {
    downloaded.push(source.key);
    await gate;
    files.set(source.key, body);
    return { localChanges: true };
  };
  const { parent, dispose } = mount();
  await until(() => !!parent.querySelector(".zmd-backlinks-download"));
  parent
    .querySelector<HTMLButtonElement>(".zmd-backlinks-download-all")!
    .click();
  await until(() => downloaded.length === 1);
  const pending = downloadNoteAttachment(sources[0].libraryID, sources[0].key);
  const status = parent.querySelector(".zmd-backlinks-download-status")!;
  const previousStatus = status.textContent;
  dispose();
  finishDownload();
  assert.equal(await pending, true);
  assert.deepEqual(downloaded, [sources[0].key]);
  assert.equal(files.has(sources[0].key), true);
  assert.equal(parent.children.length, 0);
  assert.equal(
    status.textContent,
    previousStatus,
    "the detached UI cannot receive late results",
  );
});

test("two panels share a pending download and an already-local file is never downloaded again", async (t) => {
  const { runner, sources, files, body, downloaded, mount } =
    downloadFixtures(t);
  let finishDownload!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishDownload = resolve;
  });
  runner.downloadFile = async (source) => {
    downloaded.push(source.key);
    await gate;
    files.set(source.key, body);
    return { localChanges: true };
  };
  const first = mount().parent;
  const second = mount().parent;
  await until(
    () =>
      !!first.querySelector(".zmd-backlinks-download") &&
      !!second.querySelector(".zmd-backlinks-download"),
  );
  first.querySelector<HTMLButtonElement>(".zmd-backlinks-download")!.click();
  second.querySelector<HTMLButtonElement>(".zmd-backlinks-download")!.click();
  await until(() => downloaded.length === 1);
  assert.equal(
    first.querySelector<HTMLButtonElement>(".zmd-backlinks-download")!.disabled,
    true,
  );
  assert.equal(
    second.querySelector<HTMLButtonElement>(".zmd-backlinks-download")!
      .disabled,
    true,
  );
  finishDownload();
  await until(
    () =>
      first.querySelector(".zmd-backlinks-count")!.textContent === "(1)" &&
      second.querySelector(".zmd-backlinks-count")!.textContent === "(1)",
  );
  files.set(sources[0].key, "Local edits must be preserved.");
  assert.equal(
    await downloadNoteAttachment(sources[0].libraryID, sources[0].key),
    true,
  );
  assert.deepEqual(downloaded, [sources[0].key]);
  assert.equal(files.get(sources[0].key), "Local edits must be preserved.");
});

test("right sidebar adapts to width, keeps the outline independent, and releases controls", () => {
  const browser = new Window();
  const doc = browser.document;
  doc.body.innerHTML =
    '<button id="toggle"></button><main><nav>Outline</nav><aside id="references"><button>Refresh</button></aside></main>';
  const root = doc.querySelector("main")!;
  const sidebar = doc.querySelector("aside")!;
  const toggle = doc.querySelector<HTMLButtonElement>("#toggle")!;
  let width = 1280;
  root.getBoundingClientRect = () => ({ width }) as any;
  let onResize = () => {};
  let disconnected = false;
  (browser as any).ResizeObserver = class {
    constructor(callback: () => void) {
      onResize = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  const dispose = mountBacklinksSidebar(
    root as any,
    sidebar as any,
    toggle as any,
  );
  try {
    assert.equal(sidebar.hidden, false);
    assert.equal(toggle.getAttribute("aria-controls"), "references");
    width = 900;
    onResize();
    assert.equal(sidebar.hidden, true);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    toggle.click();
    assert.equal(sidebar.hidden, false);
    assert.equal(sidebar.classList.contains("is-floating"), true);
    assert.equal(doc.querySelector("nav")!.hidden, false);
    sidebar.querySelector("button")!.focus();
    sidebar.dispatchEvent(
      new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(sidebar.hidden, true);
    assert.equal(doc.activeElement, toggle);
    width = 1280;
    onResize();
    assert.equal(sidebar.hidden, true, "keep the user's collapse choice");
    assert.equal(sidebar.classList.contains("is-floating"), false);
    dispose();
    toggle.click();
    assert.equal(sidebar.hidden, true);
    assert.equal(disconnected, true);
  } finally {
    dispose();
    browser.close();
  }
});

test("right sidebar measures only docked occupancy changes and does not replay resize animations", () => {
  const browser = new Window();
  const doc = browser.document;
  doc.body.innerHTML =
    '<button id="toggle"></button><main><aside><button>Refresh</button></aside></main>';
  const root = doc.querySelector("main")!;
  const sidebar = doc.querySelector("aside")!;
  const toggle = doc.querySelector<HTMLButtonElement>("#toggle")!;
  let width = 1280;
  root.getBoundingClientRect = () => ({ width }) as DOMRect;
  for (const [name, value] of Object.entries({
    offsetLeft: 1000,
    offsetTop: 0,
    offsetWidth: 260,
    offsetHeight: 600,
  }))
    Object.defineProperty(sidebar, name, { get: () => value });
  let resize = () => {};
  let disconnected = false;
  browser.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  } as unknown as typeof browser.ResizeObserver;
  const animations: {
    finished: Promise<void>;
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
    canceled: number;
    cancel(): void;
  }[] = [];
  sidebar.animate = (() => {
    let rejectFinished = (_error: Error) => {};
    const animation = {
      finished: new Promise<void>((_resolve, reject) => {
        rejectFinished = reject;
      }),
      onfinish: null as (() => void) | null,
      oncancel: null as (() => void) | null,
      canceled: 0,
      cancel() {
        this.canceled++;
        rejectFinished(
          new browser.DOMException("Animation cancelled", "AbortError"),
        );
        this.oncancel?.();
      },
    };
    animations.push(animation);
    return animation;
  }) as unknown as typeof sidebar.animate;
  let measures = 0;
  const dispose = mountBacklinksSidebar(
    root as unknown as HTMLElement,
    sidebar as unknown as HTMLElement,
    toggle as unknown as HTMLButtonElement,
    () => measures++,
  );
  try {
    assert.equal(measures, 1, "initial docked panel occupies editor width");
    resize();
    width = 1200;
    resize();
    assert.equal(measures, 1);
    width = 999;
    resize();
    assert.equal(sidebar.hidden, true);
    assert.equal(measures, 2, "auto-hide releases docked width once");
    assert.equal(
      animations.length,
      0,
      "responsive state changes do not animate",
    );

    toggle.click();
    assert.equal(sidebar.hidden, false);
    assert.equal(sidebar.classList.contains("is-floating"), true);
    assert.equal(
      measures,
      2,
      "opening a floating panel does not resize the editor",
    );
    assert.equal(animations.length, 1);
    resize();
    assert.equal(animations[0].canceled, 0);
    sidebar.querySelector("button")!.focus();
    toggle.click();
    const oldClose = animations[1].onfinish!;
    assert.equal(sidebar.getAttribute("aria-hidden"), "true");
    assert.equal(sidebar.inert, true);
    assert.equal(doc.activeElement, toggle);
    toggle.click();
    oldClose();
    assert.equal(
      sidebar.hidden,
      false,
      "old close completion cannot hide the reopened panel",
    );
    assert.equal(sidebar.inert, false);
    assert.equal(measures, 2);
    assert.equal(animations.length, 3);
    resize();
    assert.equal(animations[2].canceled, 0);

    width = 1000;
    resize();
    assert.equal(
      sidebar.hidden,
      false,
      "explicit expansion survives the breakpoint",
    );
    assert.equal(sidebar.classList.contains("is-floating"), false);
    assert.equal(measures, 3, "docking the open panel occupies width once");
    assert.equal(animations[2].canceled, 1);
    assert.equal(animations.length, 3);
    resize();
    assert.equal(measures, 3);
    width = 999;
    resize();
    assert.equal(sidebar.hidden, false);
    assert.equal(
      measures,
      4,
      "moving the expanded panel into an overlay releases width",
    );
    toggle.click();
    assert.equal(measures, 4);
    width = 1000;
    resize();
    assert.equal(
      sidebar.hidden,
      true,
      "manual collapse survives returning to desktop width",
    );
    assert.equal(measures, 4);
    toggle.click();
    assert.equal(measures, 5);
    const opening = animations.at(-1)!;
    dispose();
    assert.equal(disconnected, true);
    assert.equal(opening.canceled, 1);
    toggle.click();
    assert.equal(sidebar.hidden, false);
    assert.equal(
      measures,
      5,
      "destroyed controls do not request editor layout",
    );
  } finally {
    dispose();
    browser.close();
  }
});
