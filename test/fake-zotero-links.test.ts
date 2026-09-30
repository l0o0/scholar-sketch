import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import { createMarkdownEditor } from "../src/modules/markdown/editor.ts";
import { searchDocumentLinks } from "../src/modules/markdown/document-links.ts";
import {
  clearNoteLibraries,
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

function fixtures(t: TestContext) {
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
    ],
  });
  const files = new Map([
    ["MDNOTE01", "# Findings\n\n[[Research--MDNOTE02|Other note]]"],
    ["MDNOTE02", "# Second note\n"],
  ]);
  for (const id of [2, 3]) {
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
    onLinkSearch: (query) =>
      searchDocumentLinks(item(2), query, false, {
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
  editor.revealPosition(editor.getValue().length);
  editor.insertText("[[Research|Chosen");
  await until(
    () => frame.document.querySelectorAll('[role="option"]').length === 2,
  );
  const candidate = [
    ...frame.document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((button) => button.textContent.includes("MDNOTE02"))!;
  candidate.click();
  await editor.requestSnapshot();
  assert.match(editor.getValue(), /\[\[Research--MDNOTE02\|Chosen\]\]/);
  assert.doesNotMatch(editor.getValue(), /zotero:\/\//);
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
  await until(() => !!frame.document.querySelector("[data-zmd-link]"));
  const renderedLink = [
    ...frame.document.querySelectorAll("[data-zmd-link]"),
  ].find((link) => link.textContent !== "Indented")!;
  const href = renderedLink.getAttribute("data-zmd-link");
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
  const codeLink = [...frame.document.querySelectorAll("[data-zmd-link]")].find(
    (link) => link.textContent === "Indented",
  );
  codeLink?.dispatchEvent(
    new frame.MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      button: 0,
    }),
  );
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
