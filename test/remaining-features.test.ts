import assert from "node:assert/strict";
import test from "node:test";
import {
  selectedDocument,
  cloneSelection,
  serializeSelection,
  parseSelection,
  layoutSelection,
  searchCanvas,
} from "../packages/whiteboard/src/whiteboard/selection.ts";
import { canvasDocumentToFlow } from "../packages/whiteboard/src/whiteboard/document.ts";
import { moveNodesInDocument } from "../packages/whiteboard/src/whiteboard/frame.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import { renderMarkdownCore } from "../src/modules/markdown/preview-render-core.ts";
import { searchNotes } from "../src/modules/markdown/search.ts";
import { annotationMarkdown } from "../src/modules/markdown/annotations.ts";
import { isPdfDocumentLink } from "../src/modules/markdown/document-link-shared.ts";
import {
  parseWorkspace,
  rememberDocument,
  documentWorkspace,
  forgetOpenDocument,
  retainWorkspaceOnShutdown,
  resumeWorkspaceTracking,
} from "../src/modules/workspace-state.ts";
import { validViewState } from "../src/modules/markdown/editor-view-state.ts";

const document: CanvasDocument = {
  version: 2,
  nodes: [
    {
      id: "frame",
      kind: "frame",
      title: "Research",
      position: { x: 10, y: 20 },
      width: 500,
      height: 400,
    },
    {
      id: "a",
      kind: "note",
      content: "Alpha **中文**",
      frameId: "frame",
      position: { x: 40, y: 70 },
      width: 200,
      height: 120,
    },
    {
      id: "b",
      kind: "note",
      content: "Beta",
      position: { x: 620, y: 100 },
      width: 200,
      height: 120,
    },
    {
      id: "outside",
      kind: "note",
      content: "Outside",
      position: { x: 20, y: 800 },
      width: 200,
      height: 120,
    },
  ],
  connections: [
    {
      id: "internal",
      kind: "basic",
      source: "a",
      target: "b",
      label: "Evidence",
    },
    { id: "external", kind: "basic", source: "a", target: "outside" },
  ],
};
test("selection clipboard includes frame members, internal links, and remaps all identities", () => {
  const selected = selectedDocument(document, ["frame", "b"]);
  assert.deepEqual(
    selected.nodes.map((n) => n.id),
    ["frame", "a", "b"],
  );
  assert.deepEqual(
    selected.connections.map((e) => e.id),
    ["internal"],
  );
  let id = 0;
  const copy = cloneSelection(
    parseSelection(serializeSelection(selected))!,
    () => `new-${++id}`,
  );
  assert.equal(
    copy.nodes[1].kind !== "frame" && copy.nodes[1].frameId,
    copy.nodes[0].id,
  );
  assert.equal(copy.connections[0].source, copy.nodes[1].id);
  assert.equal(copy.connections[0].target, copy.nodes[2].id);
  assert.equal(copy.connections[0].label, "Evidence");
  assert.deepEqual(copy.nodes[1].position, { x: 64, y: 94 });
  assert.equal(document.nodes[1].position.x, 40);
  assert.equal(selectedDocument(document, ["a"]).nodes[0].frameId, undefined);
  assert.equal(
    parseSelection('{"type":"scholar-canvas-selection","document":{}}'),
    null,
  );
  assert.equal(parseSelection("ordinary clipboard text"), null);
});
test("selection layout leaves unrelated nodes alone and moves frames with their children", () => {
  const flow = canvasDocumentToFlow(document);
  flow.nodes.forEach((n) => {
    n.selected = ["frame", "a", "b"].includes(n.id);
  });
  const layout = layoutSelection(flow.nodes);
  assert.deepEqual(layout.map((n) => n.id).sort(), ["b", "frame"]);
  const positions = layout.map((n) => ({ id: n.id, position: n.position }));
  const moved = moveNodesInDocument(document, positions);
  assert.deepEqual(
    moved.nodes.find((n) => n.id === "outside"),
    document.nodes[3],
  );
  assert.deepEqual(searchCanvas(document, "中文 alpha"), ["a"]);
  assert.deepEqual(searchCanvas(document, "research"), ["frame"]);
});
test("reading renders portable math and scoped footnotes without enabling unsafe HTML", () => {
  const source =
    "Inline $x^2$ and note[^a].\n\n$$\n\\frac{1}{2}\n$$\n\n[^a]: Footnote **body**.\n\n`$not_math$`\n\n<script>alert(1)</script>";
  const html = renderMarkdownCore(source, "card-a");
  assert.match(html, /<math/);
  assert.match(html, /<mfrac>/);
  assert.match(html, /footnote/);
  assert.match(html, /card-a/);
  assert.match(html, /<code>\$not_math\$<\/code>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(
    renderMarkdownCore("$\\href{javascript:alert(1)}{bad}$"),
    /href="javascript:/,
  );
  assert.notEqual(html, renderMarkdownCore(source, "card-b"));
});
test("full-text search uses literal terms and preserves unicode document offsets", () => {
  const note = {
    libraryID: 1,
    key: "NOTE0001",
    filename: "中文.md",
    title: "İstanbul",
    content: "Header\n😀 test [a+b] 中文",
  };
  const matches = searchNotes(
    [note, { ...note, key: "NOTE0002", readError: "unavailable" }],
    "[a+b] 中文",
  );
  assert.equal(matches.length, 1);
  assert.equal(
    note.content.slice(matches[0].position, matches[0].position + 5),
    "[a+b]",
  );
  assert.equal(searchNotes([note], "").length, 0);
  assert.equal(searchNotes([note], "missing").length, 0);
});
test("PDF annotation Markdown includes escaped text and valid personal/group source links", () => {
  const annotation = {
    key: "ANNO0001",
    attachmentKey: "PDF00001",
    attachmentTitle: "A [paper]",
    pageLabel: "iv",
    page: 4,
    text: "Quote\n<script>",
    comment: "my *comment*",
  };
  const md = annotationMarkdown("Reading notes", [annotation]);
  const href =
    "zotero://open-pdf/library/items/PDF00001?page=4&annotation=ANNO0001";
  assert.ok(md.includes(href));
  assert.ok(md.includes("> \\<script\\>"));
  assert.equal(isPdfDocumentLink(href), true);
  assert.match(renderMarkdownCore(md), /href="zotero:\/\/open-pdf/);
  assert.ok(
    annotationMarkdown("Group", [{ ...annotation, groupID: 123 }]).includes(
      "/groups/123/items/",
    ),
  );
  assert.equal(
    isPdfDocumentLink(
      "zotero://open-pdf/library/items/PDF00001?annotation=ANNO0001&evil=1",
    ),
    false,
  );
  assert.throws(() =>
    annotationMarkdown("Invalid", [{ ...annotation, attachmentKey: "../bad" }]),
  );
});
test("workspace validates disk state and distinguishes explicit close from shutdown", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  const prefs = new Map();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Prefs: {
        get: (key: string) => prefs.get(key),
        set: (key: string, value: unknown) => prefs.set(key, value),
      },
    },
  });
  try {
    resumeWorkspaceTracking();
    assert.deepEqual(parseWorkspace("bad"), []);
    assert.deepEqual(
      parseWorkspace([
        { itemID: -1, kind: "markdown", surface: "tab", open: true },
      ]),
      [],
    );
    assert.equal(validViewState({ anchor: -1, head: 0, scrollTop: 0 }), false);
    rememberDocument(7, {
      kind: "markdown",
      surface: "tab",
      open: true,
      mode: "source",
      view: { anchor: 3, head: 5, scrollTop: 50 },
    });
    assert.equal(documentWorkspace(7)?.view?.head, 5);
    forgetOpenDocument(7);
    assert.equal(documentWorkspace(7)?.open, false);
    rememberDocument(7, { open: true });
    retainWorkspaceOnShutdown();
    forgetOpenDocument(7);
    assert.equal(documentWorkspace(7)?.open, true);
    resumeWorkspaceTracking();
    forgetOpenDocument(7);
    assert.equal(documentWorkspace(7)?.open, false);
  } finally {
    resumeWorkspaceTracking();
    if (original) Object.defineProperty(globalThis, "Zotero", original);
    else Reflect.deleteProperty(globalThis, "Zotero");
  }
});

test("annotation picker supports selection and prevents creating an empty note", async (t) => {
  const { Window } = await import("happy-dom");
  const { createFakeZotero } =
    await import("../packages/fake-zotero/dist/index.js");
  const { showAnnotationExport } =
    await import("../src/modules/markdown/annotations.ts");
  const fake = createFakeZotero({
    items: [
      {
        id: 1,
        key: "PAPER001",
        itemType: "journalArticle",
        fields: { title: "Paper" },
      },
      {
        id: 2,
        key: "PDF00001",
        itemType: "attachment",
        parentID: 1,
        attachmentContentType: "application/pdf",
        fields: { title: "PDF" },
      },
      {
        id: 3,
        key: "ANNO0001",
        itemType: "annotation",
        parentID: 2,
        annotationText: "<script>unsafe()</script>",
        annotationPageLabel: "4",
        annotationPosition: '{"pageIndex":3}',
      },
      {
        id: 4,
        key: "ANNO0002",
        itemType: "annotation",
        parentID: 2,
        annotationComment: "My comment",
      },
    ],
  });
  const restore = fake.install(globalThis);
  const win = new Window();
  t.after(() => {
    restore();
    win.close();
  });
  const item = Object.assign(fake.Zotero.Items.get(1)!, {
    isEditable: () => true,
  });
  await showAnnotationExport(win as unknown as globalThis.Window, item as any);
  const dialog = win.document.querySelector("dialog")!;
  assert.ok(dialog.open);
  assert.equal(dialog.querySelector("script"), null);
  assert.equal(
    dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    2,
  );
  const clear = dialog.querySelector<HTMLButtonElement>(
    '[data-action="clear-selection"]',
  )!;
  const submit = dialog.querySelector<HTMLButtonElement>(
    '[data-action="create"]',
  )!;
  const close = dialog.querySelector<HTMLButtonElement>(
    ".ss-annotation-close",
  )!;
  clear.click();
  assert.equal(submit.disabled, true);
  assert.equal(dialog.querySelectorAll("input:checked").length, 0);
  dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  assert.equal(submit.disabled, false);
  close.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(win.document.querySelector("dialog"), null);
  item.isEditable = () => false;
  await assert.rejects(
    showAnnotationExport(win as unknown as globalThis.Window, item as any),
    /read-only/,
  );
});

test("reading footnotes jump inside the preview and never become file navigation", async () => {
  const { Window } = await import("happy-dom");
  const { scrollPreviewToFragment } =
    await import("../src/modules/markdown/preview.ts");
  const win = new Window();
  try {
    const root = win.document.createElement("div");
    root.innerHTML = renderMarkdownCore("A[^a].\n\n[^a]: Footnote", "document");
    win.document.body.append(root);
    const link = root.querySelector('a[href^="#"]')!;
    const target = root.querySelector("li[id]")!;
    let scrolled = false;
    (target as any).scrollIntoView = () => {
      scrolled = true;
    };
    assert.equal(
      scrollPreviewToFragment(root as any, link.getAttribute("href")!),
      true,
    );
    assert.equal(scrolled, true);
    assert.equal(scrollPreviewToFragment(root as any, "#missing"), false);
    assert.equal(scrollPreviewToFragment(root as any, "Other.md"), false);
  } finally {
    win.close();
  }
});
