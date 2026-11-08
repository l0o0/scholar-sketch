import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  createLinkPreviewContentLoader,
  type LinkPreviewContent,
} from "../src/modules/markdown/link-preview-content.ts";
import {
  renderMarkdownCore,
  markdownPreviewFragment,
} from "../src/modules/markdown/preview-render-core.ts";
import { clearNoteLibraries } from "../src/modules/markdown/note-library.ts";
import { sessionRegistry } from "../src/modules/markdown/session-registry.ts";
import type { OpenSession } from "../src/modules/markdown/session-registry.ts";
import type { PreviewWorkerRequest } from "../src/modules/markdown/preview-worker-protocol.ts";

function item(
  id: number,
  kind = "item",
  fields: Record<string, string> = {},
  libraryID = 1,
): any {
  const record: any = {
    id,
    key: `KEY${String(id).padStart(5, "0")}`,
    libraryID,
    deleted: false,
    attachmentFilename:
      kind === "markdown"
        ? `zmd-${fields.title || "Research"}.md`
        : "paper.pdf",
    attachmentLinkMode: 0,
    isAttachment: () => ["markdown", "pdf", "attachment"].includes(kind),
    isPDFAttachment: () => kind === "pdf",
    isRegularItem: () => kind === "item",
    isNote: () => kind === "note",
    getField: (name: string) => fields[name] || "",
    getDisplayTitle: () => fields.title || record.key,
    getNoteTitle: () => fields.title || "Note",
    getNote: () => fields.note || "",
    loadDataType: async () => {},
    getCreators: () => [
      { creatorTypeID: 1, firstName: "Ada", lastName: "Lovelace" },
    ],
    getFilePathAsync: async () => `/notes/${record.key}.md`,
    fileExists: async () => true,
  };
  return record;
}

function install(
  t: TestContext,
  items: any[],
  bodies: Record<string, string> = {},
) {
  const globals = globalThis as any;
  const previous = globals.Zotero;
  const fileReads: string[] = [];
  const errors: Error[] = [];
  let searches = 0;
  const byID = (id: number) => items.find((item) => item.id === id);
  globals.Zotero = {
    logError: (error: Error) => errors.push(error),
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Libraries: {
      userLibraryID: 1,
      get: (id: number) =>
        id === 7 ? { libraryType: "group", groupID: 42 } : undefined,
    },
    Groups: { get: (id: number) => (id === 42 ? { libraryID: 7 } : undefined) },
    CreatorTypes: { getID: () => 1 },
    Items: {
      get: byID,
      getAsync: async (ids: number | number[]) =>
        Array.isArray(ids) ? ids.map(byID).filter(Boolean) : byID(ids),
      getIDFromLibraryAndKey: (libraryID: number, key: string) =>
        items.find((item) => item.libraryID === libraryID && item.key === key)
          ?.id,
      loadDataTypes: async () => {},
      getAll: () => {
        throw new Error("hover must not scan the note body library");
      },
    },
    Search: class {
      conditions: string[][] = [];
      libraryID: number;
      constructor(options: { libraryID: number }) {
        this.libraryID = options.libraryID;
      }
      addCondition(...condition: string[]) {
        this.conditions.push(condition);
      }
      async search() {
        searches++;
        return items
          .filter(
            (item) =>
              item.libraryID === this.libraryID &&
              this.conditions.every(([field, operator, value]) =>
                field === "itemType"
                  ? value === "note"
                    ? item.isNote()
                    : item.isAttachment()
                  : field === "title"
                    ? operator === "is"
                      ? item.getField("title").toLowerCase() ===
                        value.toLowerCase()
                      : item
                          .getField("title")
                          .toLowerCase()
                          .includes(value.toLowerCase())
                    : true,
              ),
          )
          .map((item) => item.id);
      }
    },
    File: {
      getContentsAsync: async (path: string) => {
        fileReads.push(path);
        if (!(path in bodies)) throw new Error("missing file");
        return bodies[path];
      },
    },
    Utilities: {
      cleanTags: (html: string) => html.replace(/<[^>]*>/g, ""),
      unescapeHTML: (text: string) => text.replace(/&amp;/g, "&"),
    },
  };
  t.after(() => {
    clearNoteLibraries();
    globals.Zotero = previous;
  });
  return { fileReads, errors, searches: () => searches };
}

class Worker {
  listeners = new Map<string, Set<(event: any) => void>>();
  sources: string[] = [];
  terminated = false;
  respond = true;
  onPost?: () => void;
  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  terminate() {
    this.terminated = true;
  }
  postMessage(request: PreviewWorkerRequest) {
    this.sources.push(request.source);
    this.onPost?.();
    if (this.respond)
      queueMicrotask(() => {
        const selected = request.fragment
          ? markdownPreviewFragment(request.source, request.fragment)
          : { source: request.source };
        for (const listener of this.listeners.get("message") || [])
          listener({
            data: {
              version: 1,
              requestID: request.requestID,
              ok: true,
              title: request.title || "",
              bodyHtml:
                selected.headingFound === false
                  ? ""
                  : renderMarkdownCore(selected.source),
              ...(selected.headingFound !== undefined
                ? { headingFound: selected.headingFound }
                : {}),
            },
          });
      });
  }
}

const win = {} as Window;
const current = item(999, "markdown", { title: "Current" });
const context = { currentItem: current as Zotero.Item, win };
const href = (item: any) =>
  `zotero://select/${item.libraryID === 7 ? "groups/42" : "library"}/items/${item.key}`;
const resolved = (content: LinkPreviewContent) => {
  assert.equal(content.status, "resolved");
  if (content.status !== "resolved") throw new Error("expected a preview");
  return content;
};

test("previews item and native note text without reading attachment bodies", async (t) => {
  const paper = item(1, "item", {
    title: "Analytical engine",
    date: "1843",
    publicationTitle: "Scientific Memoirs",
    abstractNote: "A".repeat(5000),
  });
  const note = item(2, "note", {
    title: "Observations",
    note: "<p>First &amp; second</p><script>ignored text</script>",
  });
  const host = install(t, [paper, note]);
  const loader = createLinkPreviewContentLoader();
  t.after(() => loader.dispose());
  const result = resolved(await loader.load(href(paper), context));
  assert.equal(result.kind, "item");
  assert.equal(result.sourceItemID, paper.id);
  assert.equal(result.title, "Analytical engine");
  assert.equal(result.subtitle, "Ada Lovelace · 1843 · Scientific Memoirs");
  assert.equal(result.text?.length, 2400);
  const native = resolved(await loader.load(href(note), context));
  assert.equal(native.kind, "note");
  assert.equal(native.sourceItemID, note.id);
  assert.match(native.text!, /First & second/);
  assert.doesNotMatch(native.text!, /<p>|<script>/);
  assert.equal(native.bodyHtml, undefined);
  assert.deepEqual(host.fileReads, []);
});

test("returns host-only PDF input and preserves group, page and annotation", async (t) => {
  const pdf = item(3, "pdf", { title: "Group paper" }, 7);
  const annotation = item(30, "annotation", {}, 7);
  annotation.key = "ANNO0001";
  annotation.isAnnotation = () => true;
  annotation.parentID = pdf.id;
  annotation.annotationPosition = JSON.stringify({ pageIndex: 6 });
  install(t, [pdf, annotation]);
  const loader = createLinkPreviewContentLoader();
  t.after(() => loader.dispose());
  const result = resolved(
    await loader.load(
      `zotero://open-pdf/groups/42/items/${pdf.key}?page=7&annotation=ANNO0001`,
      context,
    ),
  );
  assert.equal(result.kind, "pdf");
  if (result.kind !== "pdf") throw new Error("expected a PDF");
  assert.equal(result.attachmentID, pdf.id);
  assert.equal(result.sourceItemID, pdf.id);
  assert.deepEqual(result.location, { pageIndex: 6, annotationID: "ANNO0001" });
  assert.equal(result.title, "Group paper");
  pdf.fileExists = async () => false;
  assert.equal((await loader.load(href(pdf), context)).status, "unavailable");
});

test("resolves PDF annotation pages from the verified native annotation, including annotation-only links", async (t) => {
  const pdf = item(15, "pdf", { title: "Annotated PDF" }, 7);
  const annotation = item(31, "annotation", {}, 7);
  annotation.key = "ANNO0002";
  annotation.isAnnotation = () => true;
  annotation.parentID = pdf.id;
  const loads: string[] = [];
  annotation.loadDataType = async (type: string) => {
    loads.push(type);
  };
  Object.defineProperty(annotation, "annotationPosition", {
    get() {
      assert.equal(loads.at(-1), "annotationDeferred");
      return JSON.stringify({ pageIndex: 1 });
    },
  });
  const wrongParent = item(32, "annotation", {}, 7);
  wrongParent.key = "ANNO0003";
  wrongParent.isAnnotation = () => true;
  wrongParent.parentID = pdf.id + 1;
  const wrongLibrary = item(33, "annotation", {}, 1);
  wrongLibrary.key = "ANNO0004";
  wrongLibrary.isAnnotation = () => true;
  wrongLibrary.parentID = pdf.id;
  const malformed = item(34, "annotation", {}, 7);
  malformed.key = "ANNO0005";
  malformed.isAnnotation = () => true;
  malformed.parentID = pdf.id;
  malformed.annotationPosition = JSON.stringify({ pageIndex: -1 });
  install(t, [pdf, annotation, wrongParent, wrongLibrary, malformed]);
  const loader = createLinkPreviewContentLoader();
  t.after(() => loader.dispose());
  const prefix = `zotero://open-pdf/groups/42/items/${pdf.key}?`;
  for (const query of ["annotation=ANNO0002", "page=7&annotation=ANNO0002"]) {
    const result = resolved(await loader.load(prefix + query, context));
    assert.equal(result.kind, "pdf");
    if (result.kind !== "pdf") throw new Error("expected a PDF");
    assert.deepEqual(result.location, {
      pageIndex: 1,
      annotationID: "ANNO0002",
    });
  }
  assert.deepEqual(loads, ["annotationDeferred", "annotationDeferred"]);
  for (const key of ["ANNO0003", "ANNO0004", "MISSING1"]) {
    assert.equal(
      (await loader.load(prefix + `annotation=${key}`, context)).status,
      "unresolved",
      key,
    );
  }
  assert.equal(
    (await loader.load(prefix + "annotation=ANNO0005", context)).status,
    "unavailable",
  );
});

test("renders only the target saved Markdown through its worker with math and HTML", async (t) => {
  const note = item(4, "markdown", { title: "Research" });
  const host = install(t, [note], {
    [`/notes/${note.key}.md`]:
      "# First\n\nOld text\n\n## Results\n\n<table><tr><td>$g_1$</td><td><sup>9</sup></td></tr></table>\n",
  });
  const worker = new Worker();
  const loader = createLinkPreviewContentLoader({
    workerFactory: () => worker,
  });
  t.after(() => loader.dispose());
  const result = resolved(
    await loader.load(`Old-name--${note.key}.md#Results`, context),
  );
  assert.equal(result.kind, "markdown");
  assert.equal(result.sourceItemID, note.id);
  assert.match(result.bodyHtml!, /<table>/);
  assert.match(result.bodyHtml!, /katex/);
  assert.match(result.bodyHtml!, /<sup>9<\/sup>/);
  assert.doesNotMatch(result.bodyHtml!, /Old text/);
  assert.equal(
    host.searches(),
    0,
    "stable key resolution needs no library search",
  );
  assert.deepEqual(host.fileReads, [`/notes/${note.key}.md`]);
});

test("uses the owning window's unsaved snapshot and ignores a different window", async (t) => {
  const note = item(5, "markdown", { title: "Draft" });
  const host = install(t, [note], { [`/notes/${note.key}.md`]: "Saved body" });
  const worker = new Worker();
  const loader = createLinkPreviewContentLoader({
    workerFactory: () => worker,
  });
  const other = {} as Window;
  const register = (tabID: string, owner: Window, text: string) => {
    sessionRegistry.register({
      tabID,
      surface: "tab",
      itemID: note.id,
      win: owner,
      editor: { requestSnapshot: async () => text },
    } as OpenSession);
    t.after(() => sessionRegistry.unregister(tabID));
  };
  register("preview-other-window", other, "Wrong window");
  register("preview-own-window", win, "Unsaved own draft");
  t.after(() => loader.dispose());
  assert.match(
    resolved(await loader.load(href(note), context)).bodyHtml!,
    /Unsaved own draft/,
  );
  assert.deepEqual(host.fileReads, []);
  sessionRegistry.unregister("preview-own-window");
  assert.match(
    resolved(await loader.load(href(note), context)).bodyHtml!,
    /Saved body/,
  );
  assert.doesNotMatch(worker.sources.at(-1)!, /Wrong window/);
});

test("resolves cold title links from metadata and reports duplicate titles", async (t) => {
  const note = item(6, "markdown", { title: "Research" });
  const unrelated = item(7, "markdown", { title: "Unrelated" });
  const host = install(t, [note, unrelated], {
    [`/notes/${note.key}.md`]: "Chosen note",
  });
  const worker = new Worker();
  const loader = createLinkPreviewContentLoader({
    workerFactory: () => worker,
  });
  t.after(() => loader.dispose());
  assert.match(
    resolved(await loader.load("[[Research]]", context)).bodyHtml!,
    /Chosen note/,
  );
  assert.deepEqual(host.fileReads, [`/notes/${note.key}.md`]);
  const duplicate = item(8, "markdown", { title: "Research" });
  // The host metadata changes between separate hover requests.
  unrelated.getField = (field: string) => duplicate.getField(field);
  const ambiguous = await loader.load("[[Research]]", context);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(
    host.fileReads.length,
    1,
    "ambiguity never reads a candidate body",
  );
});

test("cold file links share filename matching with navigation beyond the completion cap", async (t) => {
  const note = item(14, "markdown", { title: "Published title" });
  note.attachmentFilename = "zmd-Research.md";
  const crowded = Array.from({ length: 30 }, (_, offset) =>
    item(100 + offset, offset % 2 ? "item" : "note", { title: "Research" }),
  );
  const unrelated = Array.from({ length: 60 }, (_, offset) =>
    item(200 + offset, "markdown", { title: `Archive ${offset}` }),
  );
  const host = install(t, [...crowded, ...unrelated, note], {
    [`/notes/${note.key}.md`]: "Chosen filename target",
  });
  const worker = new Worker();
  const loader = createLinkPreviewContentLoader({
    workerFactory: () => worker,
  });
  t.after(() => loader.dispose());
  for (const link of [
    "Research.md",
    "[[Research.md]]",
    "[[Research]]",
    "[[zmd-zmd-Research.markdown]]",
  ]) {
    const result = resolved(await loader.load(link, context));
    assert.equal(result.sourceItemID, note.id, link);
    assert.match(result.bodyHtml!, /Chosen filename target/);
  }
  assert.deepEqual(host.fileReads, Array(4).fill(`/notes/${note.key}.md`));
  for (const link of ["folder/Research.md", `folder/Old--${note.key}.md`]) {
    assert.equal((await loader.load(link, context)).status, "unresolved", link);
  }
});

test("bounds Markdown work and degrades worker failures to bounded text", async (t) => {
  const note = item(9, "markdown", { title: "Long note" });
  const host = install(t, [note], {
    [`/notes/${note.key}.md`]:
      "Start\n" +
      "Text line\n".repeat(20000) +
      "Tail must stay outside preview",
  });
  const worker = new Worker();
  const loader = createLinkPreviewContentLoader({
    workerFactory: () => worker,
  });
  t.after(() => loader.dispose());
  const result = resolved(await loader.load(href(note), context));
  assert.ok(worker.sources[0].length <= 12 * 1024);
  assert.doesNotMatch(result.bodyHtml!, /Tail must/);
  const unavailable = createLinkPreviewContentLoader({
    workerFactory: () => null,
  });
  t.after(() => unavailable.dispose());
  const fallback = resolved(await unavailable.load(href(note), context));
  assert.equal(fallback.kind, "markdown");
  assert.equal(fallback.bodyHtml, undefined);
  assert.equal(fallback.text?.length, 2400);
  assert.equal(host.errors.length, 1);
});

test("finds later headings in the worker and never substitutes the opening for a missing heading", async (t) => {
  const note = item(13, "markdown", { title: "Long heading note" });
  install(t, [note], {
    [`/notes/${note.key}.md`]:
      "Opening must stay hidden\n\n" +
      "Paragraph\n\n".repeat(10000) +
      "## Later result\n\nTarget content",
  });
  const worker = new Worker();
  const loader = createLinkPreviewContentLoader({
    workerFactory: () => worker,
  });
  t.after(() => loader.dispose());
  const result = resolved(
    await loader.load(`${href(note)}#later-result`, context),
  );
  assert.match(result.bodyHtml!, /Target content/);
  assert.doesNotMatch(result.bodyHtml!, /Opening must stay hidden/);
  assert.ok(worker.sources[0].length > 64 * 1024);
  assert.equal(
    (await loader.load(`${href(note)}#Missing`, context)).status,
    "unavailable",
  );
});

test("missing, trashed and malformed targets preserve navigation without false empty previews", async (t) => {
  const note = item(10, "markdown", { title: "Missing file" });
  const trashed = item(11, "item", { title: "Trashed" });
  trashed.deleted = true;
  install(t, [note, trashed]);
  const loader = createLinkPreviewContentLoader();
  t.after(() => loader.dispose());
  assert.equal((await loader.load(href(note), context)).status, "unavailable");
  for (const link of [
    href(trashed),
    "https://example.com",
    "javascript:alert(1)",
    "../outside.md",
    "zotero://open-pdf/library/items/KEY00003?page=0",
  ]) {
    assert.equal((await loader.load(link, context)).status, "unresolved", link);
  }
});

test("disposing rejects pending worker results and prevents new reads", async (t) => {
  const note = item(12, "markdown", { title: "Pending" });
  const host = install(t, [note], {
    [`/notes/${note.key}.md`]: "Pending content",
  });
  const worker = new Worker();
  worker.respond = false;
  const loader = createLinkPreviewContentLoader({
    workerFactory: () => worker,
  });
  t.after(() => loader.dispose());
  const posted = new Promise<void>((resolve) => {
    worker.onPost = resolve;
  });
  const pending = loader.load(href(note), context);
  await posted;
  loader.dispose();
  assert.equal((await pending).status, "unavailable");
  assert.equal(worker.terminated, true);
  const before = host.fileReads.length;
  assert.equal((await loader.load(href(note), context)).status, "unavailable");
  assert.equal(host.fileReads.length, before);
});
