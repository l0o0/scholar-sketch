import assert from "node:assert/strict";
import test from "node:test";
import {
  createZoteroSourceGateway,
  noteHtmlToText,
  SourceGatewayError,
  type SourceGatewayDependencies,
} from "../src/modules/whiteboard/source-gateway.ts";
import {
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
  isParentToWhiteboardMessageForChannel,
} from "../src/modules/whiteboard/protocol.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import { canvasDocumentToFlow } from "../packages/whiteboard/src/whiteboard/document.ts";
import { applyConfirmedNoteRefresh } from "../packages/whiteboard/src/whiteboard/noteRefresh.ts";
import { applyResolvedAcquisition } from "../packages/whiteboard/src/whiteboard/sourceState.ts";

type Kind = "regular" | "note" | "annotation" | "attachment" | "other";

interface ItemFixture {
  id: number;
  key: string;
  libraryID: number;
  parentItem?: ItemFixture;
  attachmentContentType?: string;
  annotationType?: string;
  annotationText?: string;
  annotationComment?: string;
  annotationPosition?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string;
  getField(field: string): string;
  getNote(): string;
  getNoteTitle(): string;
  getAttachments(): number[];
  getAnnotations(): ItemFixture[];
  getTags(): { tag: string }[];
  isRegularItem(): boolean;
  isNote(): boolean;
  isAnnotation(): boolean;
  isAttachment(): boolean;
  isFileAttachment(): boolean;
}

function item(
  kind: Kind,
  values: Partial<
    Omit<
      ItemFixture,
      | "getField"
      | "getNote"
      | "getNoteTitle"
      | "getAttachments"
      | "getAnnotations"
      | "getTags"
      | "isRegularItem"
      | "isNote"
      | "isAnnotation"
      | "isAttachment"
      | "isFileAttachment"
    >
  > & {
    fields?: Record<string, string>;
    note?: string;
    title?: string;
    attachments?: number[];
    annotations?: ItemFixture[];
    tags?: string[];
    linkedURL?: boolean;
  } = {},
): ItemFixture {
  const {
    fields = {},
    note = "",
    title = "",
    attachments = [],
    annotations = [],
    tags = [],
    linkedURL = false,
    ...rest
  } = values;
  return {
    id: rest.id ?? 1,
    key: rest.key ?? "ITEMKEY",
    libraryID: rest.libraryID ?? 1,
    ...rest,
    getField: (field) => fields[field] ?? "",
    getNote: () => note,
    getNoteTitle: () => title,
    getAttachments: () => attachments,
    getAnnotations: () => annotations,
    getTags: () => tags.map((tag) => ({ tag })),
    isRegularItem: () => kind === "regular",
    isNote: () => kind === "note",
    isAnnotation: () => kind === "annotation",
    isAttachment: () => kind === "attachment",
    isFileAttachment: () => kind === "attachment" && !linkedURL,
  };
}

function dependencies(items: ItemFixture[] = []) {
  const opened: string[] = [];
  const pages: Array<{ key: string; pageIndex?: number }> = [];
  const byLibraryAndKey = new Map(
    items.map((value) => [`${value.libraryID}:${value.key}`, value]),
  );
  const deps: SourceGatewayDependencies = {
    userLibraryID: 1,
    getLibrary: (libraryID) =>
      libraryID === 1
        ? { libraryType: "user" }
        : libraryID === 2
          ? { libraryType: "group", groupID: 42 }
          : libraryID === 3
            ? { libraryType: "feed" }
            : null,
    groupLibraryID: (groupID) => (groupID === 42 ? 2 : null),
    getByLibraryAndKey: (libraryID, key) =>
      (byLibraryAndKey.get(`${libraryID}:${key}`) as Zotero.Item | undefined) ??
      null,
    cleanTags: (html) =>
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]*>/g, ""),
    unescapeHTML: (html) => html.replace(/&nbsp;/g, " "),
    openItem: async (value) => void opened.push(`item:${value.key}`),
    openNote: async (value) => void opened.push(`note:${value.key}`),
    readAnnotationImage: async () => undefined,
    openAnnotation: async () => false,
    openAttachmentPage: async (attachment, pageIndex) =>
      void pages.push({ key: attachment.key, pageIndex }),
  };
  return { deps, opened, pages, byLibraryAndKey };
}

async function withProductionQuoteZotero(
  options: {
    annotationPosition?: string;
    reader?: { open?: (...args: unknown[]) => Promise<void> };
  },
  run: (fixture: {
    attachment: ItemFixture;
    annotation: ItemFixture;
    fileHandlerCalls: unknown[][];
  }) => Promise<void>,
): Promise<void> {
  const regular = item("regular", { id: 10, key: "ITEM" });
  const attachment = item("attachment", {
    id: 11,
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    id: 12,
    key: "ANNOTATION",
    parentItem: attachment,
    annotationPosition: options.annotationPosition,
    annotationType: "highlight",
    annotationText: "Text",
  });
  const byKey = new Map(
    [regular, attachment, annotation].map((value) => [value.key, value]),
  );
  const fileHandlerCalls: unknown[][] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Libraries: { userLibraryID: 1, get: () => ({ libraryType: "user" }) },
      Groups: { get: () => null },
      Items: {
        getByLibraryAndKey: (_libraryID: number, key: string) =>
          byKey.get(key) ?? null,
        get: () => null,
      },
      Utilities: {
        cleanTags: (html: string) => html,
        unescapeHTML: (html: string) => html,
      },
      ...(options.reader ? { Reader: options.reader } : {}),
      FileHandlers: {
        open: async (...args: unknown[]) => {
          fileHandlerCalls.push(args);
          return true;
        },
      },
      getMainWindow: () => ({ ZoteroPane: {} }),
    },
  });
  try {
    await run({ attachment, annotation, fileHandlerCalls });
  } finally {
    if (previous) Object.defineProperty(globalThis, "Zotero", previous);
    else Reflect.deleteProperty(globalThis, "Zotero");
  }
}

test("acquires regular items with native group keys and a normalized snapshot", () => {
  const regular = item("regular", {
    key: "ITEMKEY",
    libraryID: 2,
    fields: {
      title: "Paper title",
      date: "2026-04-23",
      publicationTitle: "Journal",
      creators: "Ada Lovelace",
    },
  });
  const { deps } = dependencies([regular]);
  const gateway = createZoteroSourceGateway(deps);

  const literature = gateway.acquireItem(regular as Zotero.Item);

  assert.deepEqual(literature.source, {
    library: { type: "group", groupID: 42 },
    itemKey: "ITEMKEY",
  });
  assert.equal(literature.kind, "literature");
  assert.equal(literature.snapshot.title, "Paper title");
  assert.equal("annotationCount" in literature.snapshot, false);
  assert.deepEqual(literature.snapshot, {
    title: "Paper title",
    creators: "Ada Lovelace",
    year: "2026",
    publicationTitle: "Journal",
  });
});

test("classifies notes, annotations, and file attachments while rejecting other kinds", () => {
  const parent = item("regular", { key: "PARENT" });
  const note = item("note", {
    key: "NOTE",
    parentItem: parent,
    note: "<p>Body</p>",
    title: "A note",
  });
  const attachment = item("attachment", {
    key: "PDF",
    parentItem: parent,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    key: "ANNOTATION",
    parentItem: attachment,
    annotationType: "highlight",
    annotationText: "Evidence",
  });
  const other = item("other");
  const feedRegular = item("regular", { key: "FEED", libraryID: 3 });
  const { deps } = dependencies([parent, note, attachment, annotation, other]);
  const gateway = createZoteroSourceGateway(deps);

  assert.deepEqual(gateway.acquireItem(note as Zotero.Item), {
    kind: "note",
    source: { library: { type: "user" }, noteKey: "NOTE", itemKey: "PARENT" },
    sourceSnapshot: { title: "A note" },
    content: "Body",
  });
  assert.deepEqual(gateway.acquireItem(annotation as Zotero.Item), {
    kind: "quote",
    source: {
      library: { type: "user" },
      itemKey: "PARENT",
      attachmentKey: "PDF",
      annotationKey: "ANNOTATION",
    },
    snapshot: {
      text: "Evidence",
      attachmentTitle: "PDF",
      annotationType: "highlight",
    },
  });
  assert.deepEqual(gateway.acquireItem(attachment as Zotero.Item), {
    kind: "attachment",
    source: { library: { type: "user" }, attachmentKey: "PDF" },
    snapshot: {
      filename: "PDF",
      contentType: "application/pdf",
      availability: "available",
    },
  });
  assert.throws(
    () => gateway.acquireItem(other as Zotero.Item),
    /unsupported/i,
  );
  assert.throws(
    () => gateway.acquireItem(feedRegular as Zotero.Item),
    /unsupported/i,
  );
});

test("resolves only exact keys and reports a wrong resolved kind", async () => {
  const wrong = item("note", { key: "ITEMKEY" });
  const { deps, byLibraryAndKey } = dependencies([wrong]);
  const gateway = createZoteroSourceGateway(deps);

  const result = await gateway.resolve("node-1", 3, {
    kind: "literature",
    source: { library: { type: "user" }, itemKey: "ITEMKEY" },
  });

  assert.deepEqual(result, {
    nodeId: "node-1",
    generation: 3,
    status: "unavailable",
    code: "wrong-kind",
    message: "The Zotero item has a different kind.",
  });
  assert.equal(byLibraryAndKey.has("1:ITEMKEY"), true);
});

test("reports unavailable libraries and validates note parent keys", async () => {
  const wrongParent = item("regular", { key: "OTHER" });
  const note = item("note", { key: "NOTE", parentItem: wrongParent });
  const { deps } = dependencies([note, wrongParent]);
  const gateway = createZoteroSourceGateway(deps);

  assert.deepEqual(
    await gateway.resolve("node-1", 0, {
      kind: "literature",
      source: { library: { type: "group", groupID: 99 }, itemKey: "ITEM" },
    }),
    {
      nodeId: "node-1",
      generation: 0,
      status: "unavailable",
      code: "library-missing",
      message: "The Zotero library is unavailable.",
    },
  );
  assert.deepEqual(
    await gateway.resolve("node-2", 1, {
      kind: "note",
      source: { library: { type: "user" }, noteKey: "NOTE", itemKey: "PARENT" },
    }),
    {
      nodeId: "node-2",
      generation: 1,
      status: "unavailable",
      code: "parent-mismatch",
      message: "The Zotero item's parent has changed.",
    },
  );
});

test("a formerly standalone Note keeps its requested identity through resolve and refresh", async () => {
  const currentParent = item("regular", { key: "CURRENT-PARENT" });
  const note = item("note", {
    key: "NOTE",
    parentItem: currentParent,
    note: "<p>Current body</p>",
    title: "Current title",
  });
  const { deps } = dependencies([note, currentParent]);
  const gateway = createZoteroSourceGateway(deps);
  const requestedSource = {
    library: { type: "user" as const },
    noteKey: "NOTE",
  };
  const document: CanvasDocument = {
    version: 2,
    nodes: [
      {
        id: "note-1",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        source: requestedSource,
        sourceSnapshot: { title: "Persisted title" },
        content: "Local body",
      },
    ],
    connections: [],
  };

  const result = await gateway.resolve("note-1", 4, {
    kind: "note",
    source: requestedSource,
  });
  assert.equal(result.status, "resolved");
  if (result.status !== "resolved" || result.acquisition.kind !== "note") {
    assert.fail("expected a resolved Note");
  }
  assert.deepEqual(result.acquisition.source, requestedSource);
  const background = applyResolvedAcquisition(
    canvasDocumentToFlow(document).nodes[0],
    result.acquisition,
  );
  assert.equal(
    background.data.model.kind === "note" && background.data.model.content,
    "Local body",
  );
  assert.deepEqual(
    background.data.model.kind === "note" &&
      background.data.model.sourceSnapshot,
    { title: "Current title" },
  );

  const refreshed = await gateway.refreshNote(requestedSource);
  assert.deepEqual(refreshed.source, requestedSource);
  const applied = applyConfirmedNoteRefresh(document, "note-1", refreshed);
  assert.equal(
    applied?.nodes[0].kind === "note" && applied.nodes[0].content,
    "Current body",
  );
});

test("a child Note whose parent identity changed is unavailable for resolve and refresh", async () => {
  const currentParent = item("regular", { key: "CURRENT-PARENT" });
  const note = item("note", { key: "NOTE", parentItem: currentParent });
  const { deps } = dependencies([note, currentParent]);
  const gateway = createZoteroSourceGateway(deps);
  const staleSource = {
    library: { type: "user" as const },
    noteKey: "NOTE",
    itemKey: "PREVIOUS-PARENT",
  };

  assert.deepEqual(
    await gateway.resolve("note-1", 5, {
      kind: "note",
      source: staleSource,
    }),
    {
      nodeId: "note-1",
      generation: 5,
      status: "unavailable",
      code: "parent-mismatch",
      message: "The Zotero item's parent has changed.",
    },
  );
  await assert.rejects(
    gateway.refreshNote(staleSource),
    (error: unknown) =>
      error instanceof SourceGatewayError && error.code === "parent-mismatch",
  );
});

test("validates the complete quote parent chain before resolving current fields", async () => {
  const regular = item("regular", { key: "ITEM" });
  const attachment = item("attachment", {
    key: "ATTACHMENT",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    key: "ANNOTATION",
    parentItem: attachment,
    annotationType: "underline",
    annotationText: "Current evidence",
    annotationComment: "Comment",
    annotationPageLabel: "12",
    annotationColor: "#ffd400",
  });
  const { deps } = dependencies([regular, attachment, annotation]);
  const gateway = createZoteroSourceGateway(deps);

  const result = await gateway.resolve("quote-1", 4, {
    kind: "quote",
    source: {
      library: { type: "user" },
      itemKey: "ITEM",
      attachmentKey: "ATTACHMENT",
      annotationKey: "ANNOTATION",
    },
  });

  assert.deepEqual(result, {
    nodeId: "quote-1",
    generation: 4,
    status: "resolved",
    acquisition: {
      kind: "quote",
      source: {
        library: { type: "user" },
        itemKey: "ITEM",
        attachmentKey: "ATTACHMENT",
        annotationKey: "ANNOTATION",
      },
      snapshot: {
        text: "Current evidence",
        attachmentTitle: "ATTACHMENT",
        annotationType: "underline",
        comment: "Comment",
        pageLabel: "12",
        color: "#ffd400",
      },
    },
  });
});

test("rejects unknown annotation kinds and non-Reader attachment sources", async () => {
  const regular = item("regular", { key: "ITEM" });
  const pdf = item("attachment", {
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const epub = item("attachment", {
    key: "EPUB",
    parentItem: regular,
    attachmentContentType: "text/plain",
  });
  const webpage = item("attachment", {
    key: "WEB",
    parentItem: regular,
    attachmentContentType: "image/png",
  });
  const image = item("annotation", {
    key: "IMAGE",
    parentItem: pdf,
    annotationType: "unknown",
    annotationText: "Image annotation",
  });
  const ink = item("annotation", {
    key: "INK",
    parentItem: pdf,
    annotationType: "unsupported",
    annotationText: "Ink annotation",
  });
  const empty = item("annotation", {
    key: "EMPTY",
    parentItem: pdf,
    annotationType: "future-kind",
    annotationText: "  ",
  });
  const epubHighlight = item("annotation", {
    key: "EPUB-HIGHLIGHT",
    parentItem: epub,
    annotationType: "highlight",
    annotationText: "EPUB text",
  });
  const webpageUnderline = item("annotation", {
    key: "WEB-UNDERLINE",
    parentItem: webpage,
    annotationType: "underline",
    annotationText: "Web text",
  });
  const { deps } = dependencies([
    regular,
    pdf,
    epub,
    webpage,
    image,
    ink,
    empty,
    epubHighlight,
    webpageUnderline,
  ]);
  const gateway = createZoteroSourceGateway(deps);

  for (const unsupported of [
    image,
    ink,
    empty,
    epubHighlight,
    webpageUnderline,
  ]) {
    assert.throws(
      () => gateway.acquireItem(unsupported as Zotero.Item),
      /unsupported|wrong-kind/i,
    );
  }
  assert.deepEqual(
    await gateway.resolve("quote-1", 0, {
      kind: "quote",
      source: {
        library: { type: "user" },
        itemKey: "ITEM",
        attachmentKey: "PDF",
        annotationKey: "IMAGE",
      },
    }),
    {
      nodeId: "quote-1",
      generation: 0,
      status: "unavailable",
      code: "wrong-kind",
      message: "The Zotero item has a different kind.",
    },
  );
  await assert.rejects(
    gateway.open({
      kind: "quote",
      source: {
        library: { type: "user" },
        itemKey: "ITEM",
        attachmentKey: "PDF",
        annotationKey: "EMPTY",
      },
    }),
    (error: unknown) =>
      error instanceof SourceGatewayError && error.code === "wrong-kind",
  );
});

test("lists PDF annotations including empty highlights in deterministic order", async () => {
  const regular = item("regular", { key: "ITEM" });
  const second = item("attachment", {
    key: "B",
    parentItem: regular,
    attachmentContentType: "application/pdf",
    fields: { title: "Second PDF" },
  });
  const first = item("attachment", {
    key: "A",
    parentItem: regular,
    attachmentContentType: "application/pdf",
    fields: { title: "First PDF" },
  });
  const later = item("annotation", {
    key: "LATER",
    parentItem: first,
    annotationType: "highlight",
    annotationText: "Later",
    annotationSortIndex: "00002",
  });
  const earlier = item("annotation", {
    key: "EARLIER",
    parentItem: first,
    annotationType: "underline",
    annotationText: "Earlier",
    annotationSortIndex: "",
  });
  const excluded = item("annotation", {
    key: "EMPTY",
    parentItem: second,
    annotationType: "highlight",
    annotationText: "  ",
    annotationSortIndex: "00000",
  });
  const supportedSecond = item("annotation", {
    key: "SECOND",
    parentItem: second,
    annotationType: "highlight",
    annotationText: "Second",
    annotationSortIndex: "00001",
  });
  const unrelatedLiterature = item("regular", { key: "UNRELATED" });
  const unrelatedAttachment = item("attachment", {
    key: "UNRELATED-PDF",
    parentItem: unrelatedLiterature,
    attachmentContentType: "application/pdf",
  });
  const unrelatedAnnotation = item("annotation", {
    key: "UNRELATED-ANNOTATION",
    parentItem: unrelatedAttachment,
    annotationType: "highlight",
    annotationText: "Unrelated",
    annotationSortIndex: "00000",
  });
  first.getAnnotations = () => [later, earlier];
  second.getAnnotations = () => [excluded, supportedSecond];
  unrelatedAttachment.getAnnotations = () => [unrelatedAnnotation];
  regular.getAttachments = () =>
    [second, first, unrelatedAttachment] as unknown as number[];
  const { deps } = dependencies([
    regular,
    first,
    second,
    later,
    earlier,
    excluded,
    supportedSecond,
    unrelatedLiterature,
    unrelatedAttachment,
    unrelatedAnnotation,
  ]);
  const gateway = createZoteroSourceGateway(deps);

  const result = await gateway.listAnnotations({
    library: { type: "user" },
    itemKey: "ITEM",
  });

  assert.deepEqual(
    result.candidates.map(
      (candidate) => candidate.acquisition.source.annotationKey,
    ),
    ["EARLIER", "LATER", "EMPTY", "SECOND"],
  );
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.attachmentTitle),
    ["First PDF", "First PDF", "Second PDF", "Second PDF"],
  );
  assert.equal(result.candidates[0].sortIndex, "");
  assert.equal(
    isParentToWhiteboardMessageForChannel(
      {
        source: WHITEBOARD_MESSAGE_SOURCE,
        channel: "tab:canvas",
        v: WHITEBOARD_PROTOCOL_VERSION,
        type: "annotationsListed",
        payload: {
          requestId: "annotations-empty-sort-index",
          source: { library: { type: "user" }, itemKey: "ITEM" },
          candidates: result.candidates,
          failures: result.failures,
        },
      },
      "tab:canvas",
    ),
    true,
    "gateway annotations may legitimately have an empty sort index",
  );
  assert.equal(JSON.stringify(result).includes('"id"'), false);
});

test("lists numeric child attachment IDs through injected lookup", async () => {
  const regular = item("regular", { key: "ITEM" });
  const attachment = item("attachment", {
    id: 20,
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
    fields: { title: "PDF" },
  });
  const annotation = item("annotation", {
    key: "ANNOTATION",
    parentItem: attachment,
    annotationType: "highlight",
    annotationText: "Evidence",
    annotationSortIndex: "00001",
  });
  attachment.getAnnotations = () => [annotation];
  regular.getAttachments = () => [attachment.id];
  const { deps } = dependencies([regular, attachment, annotation]);
  const gateway = createZoteroSourceGateway(
    Object.assign(deps, {
      getByID: (id: number) => (id === attachment.id ? attachment : null),
    }),
  );

  const result = await gateway.listAnnotations({
    library: { type: "user" },
    itemKey: "ITEM",
  });

  assert.deepEqual(
    result.candidates.map(
      (candidate) => candidate.acquisition.source.annotationKey,
    ),
    ["ANNOTATION"],
  );
});

test("returns valid annotation candidates together with typed partial failures", async () => {
  const regular = item("regular", { key: "ITEM" });
  const validAttachment = item("attachment", {
    key: "PDF-VALID",
    parentItem: regular,
    attachmentContentType: "application/pdf",
    fields: { title: "Same title.pdf" },
  });
  const failingAttachment = item("attachment", {
    key: "PDF-FAIL",
    parentItem: regular,
    attachmentContentType: "application/pdf",
    fields: { title: "Same title.pdf" },
  });
  const otherAttachment = item("attachment", {
    key: "PDF-OTHER",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const valid = item("annotation", {
    key: "ANN-VALID",
    parentItem: validAttachment,
    annotationType: "highlight",
    annotationText: "Usable evidence",
    annotationSortIndex: "00001",
  });
  const mismatched = item("annotation", {
    key: "ANN-MISMATCH",
    parentItem: otherAttachment,
    annotationType: "underline",
    annotationText: "Wrong attachment",
    annotationSortIndex: "00002",
  });
  const excluded = item("annotation", {
    key: "ANN-IMAGE",
    parentItem: validAttachment,
    annotationType: "unsupported",
    annotationText: "Unsupported by design",
  });
  const invalid = item("regular", { key: "ANN-BROKEN" });
  validAttachment.getAnnotations = () => [valid, mismatched, excluded, invalid];
  failingAttachment.getAnnotations = () => {
    throw new Error("annotation storage failed");
  };
  regular.getAttachments = () =>
    [validAttachment, failingAttachment] as unknown as number[];
  const { deps } = dependencies([
    regular,
    validAttachment,
    failingAttachment,
    otherAttachment,
    valid,
    mismatched,
    excluded,
    invalid,
  ]);

  const result = await createZoteroSourceGateway(deps).listAnnotations({
    library: { type: "user" },
    itemKey: "ITEM",
  });

  assert.deepEqual(
    result.candidates.map(
      (candidate) => candidate.acquisition.source.annotationKey,
    ),
    ["ANN-VALID"],
  );
  assert.deepEqual(result.failures, [
    {
      code: "annotation-unavailable",
      message: "A Zotero annotation could not be loaded.",
      attachmentKey: "PDF-VALID",
      annotationKey: "ANN-MISMATCH",
    },
    {
      code: "annotation-unavailable",
      message: "A Zotero annotation could not be loaded.",
      attachmentKey: "PDF-VALID",
      annotationKey: "ANN-BROKEN",
    },
    {
      code: "attachment-unavailable",
      message: "Annotations from an attachment could not be loaded.",
      attachmentKey: "PDF-FAIL",
    },
  ]);
  assert.equal(
    result.failures.some((failure) => failure.annotationKey === "ANN-IMAGE"),
    false,
    "unsupported annotation kinds are intentional exclusions, not failures",
  );
  assert.equal(JSON.stringify(result).includes('"itemID"'), false);
  assert.equal(JSON.stringify(result).includes('"attachmentID"'), false);
});

test("terminal annotation list failures carry codes without message parsing", async () => {
  const { deps } = dependencies();
  await assert.rejects(
    createZoteroSourceGateway(deps).listAnnotations({
      library: { type: "group", groupID: 99 },
      itemKey: "ITEM",
    }),
    (error: unknown) =>
      error instanceof SourceGatewayError &&
      error.code === "library-missing" &&
      error.message === "The Zotero library is unavailable.",
  );
});

test("open and Note refresh failures retain finite gateway diagnostic codes", async () => {
  const { deps } = dependencies();
  await assert.rejects(
    createZoteroSourceGateway(deps).open({
      kind: "literature",
      source: { library: { type: "group", groupID: 99 }, itemKey: "ITEM" },
    }),
    (error: unknown) =>
      error instanceof SourceGatewayError && error.code === "library-missing",
  );
  await assert.rejects(
    createZoteroSourceGateway(deps).refreshNote({
      library: { type: "user" },
      noteKey: "MISSING",
    }),
    (error: unknown) =>
      error instanceof SourceGatewayError && error.code === "item-missing",
  );
});

test("converts Zotero note HTML and falls back to DOM text content only after utility failure", () => {
  const utilities = {
    cleanTags: (html: string) =>
      html
        .replace(/<br>/g, "\n")
        .replace(/<\/p>/g, "\n\n")
        .replace(/<[^>]+>/g, ""),
    unescapeHTML: (html: string) => html.replace(/&nbsp;/g, " "),
  };
  assert.equal(
    noteHtmlToText("<p>First&nbsp;line</p><p>Second<br>line</p>", utilities),
    "First line\n\nSecond\nline",
  );
  assert.equal(
    noteHtmlToText("<p>Fallback&nbsp;text</p>", {
      cleanTags: () => {
        throw new Error("unavailable");
      },
      unescapeHTML: utilities.unescapeHTML,
    }),
    "Fallback text",
  );
});

test("opens a Quote by exact annotation before considering a page fallback", async () => {
  const regular = item("regular", { key: "ITEM" });
  const attachment = item("attachment", {
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    key: "ANNOTATION",
    parentItem: attachment,
    annotationPosition: '{"pageIndex":7}',
    annotationType: "highlight",
    annotationText: "Text",
  });
  const { deps, pages } = dependencies([regular, attachment, annotation]);
  const exact: Array<{ attachmentKey: string; annotationKey: string }> = [];
  deps.openAnnotation = async (resolvedAttachment, resolvedAnnotation) => {
    exact.push({
      attachmentKey: resolvedAttachment.key,
      annotationKey: resolvedAnnotation.key,
    });
    return true;
  };
  const gateway = createZoteroSourceGateway(deps);

  await gateway.open({
    kind: "quote",
    source: {
      library: { type: "user" },
      itemKey: "ITEM",
      attachmentKey: "PDF",
      annotationKey: "ANNOTATION",
    },
  });

  assert.deepEqual(exact, [
    { attachmentKey: "PDF", annotationKey: "ANNOTATION" },
  ]);
  assert.deepEqual(pages, []);
});

test("uses the resolved annotation page only when exact navigation is unavailable", async () => {
  const regular = item("regular", { key: "ITEM" });
  const attachment = item("attachment", {
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    key: "ANNOTATION",
    parentItem: attachment,
    annotationPosition: '{"pageIndex":7}',
    annotationPageLabel: "99",
    annotationType: "highlight",
    annotationText: "Text",
  });
  const { deps, pages } = dependencies([regular, attachment, annotation]);
  const gateway = createZoteroSourceGateway(deps);

  await gateway.open({
    kind: "quote",
    source: {
      library: { type: "user" },
      itemKey: "ITEM",
      attachmentKey: "PDF",
      annotationKey: "ANNOTATION",
    },
  });

  assert.deepEqual(pages, [{ key: "PDF", pageIndex: 7 }]);
});

test("opens the attachment without a claimed page when no exact page exists", async () => {
  const regular = item("regular", { key: "ITEM" });
  const attachment = item("attachment", {
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    key: "ANNOTATION",
    parentItem: attachment,
    annotationPosition: "not-json",
    annotationPageLabel: "27",
    annotationType: "highlight",
    annotationText: "Text",
  });
  const { deps, pages } = dependencies([regular, attachment, annotation]);

  await createZoteroSourceGateway(deps).open({
    kind: "quote",
    source: {
      library: { type: "user" },
      itemKey: "ITEM",
      attachmentKey: "PDF",
      annotationKey: "ANNOTATION",
    },
  });

  assert.deepEqual(pages, [{ key: "PDF", pageIndex: undefined }]);
});

test("an exact Reader failure propagates without an arbitrary page retry", async () => {
  const regular = item("regular", { key: "ITEM" });
  const attachment = item("attachment", {
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    key: "ANNOTATION",
    parentItem: attachment,
    annotationPosition: '{"pageIndex":7}',
    annotationType: "highlight",
    annotationText: "Text",
  });
  const { deps, pages } = dependencies([regular, attachment, annotation]);
  deps.openAnnotation = async () => {
    throw new Error("Reader failed after accepting exact navigation");
  };

  await assert.rejects(
    createZoteroSourceGateway(deps).open({
      kind: "quote",
      source: {
        library: { type: "user" },
        itemKey: "ITEM",
        attachmentKey: "PDF",
        annotationKey: "ANNOTATION",
      },
    }),
    /Reader failed after accepting exact navigation/,
  );
  assert.deepEqual(pages, []);
});

test("opening a Quote rejects a lookup result with the wrong annotation key", async () => {
  const regular = item("regular", { key: "ITEM" });
  const attachment = item("attachment", {
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const wrongAnnotation = item("annotation", {
    key: "OTHER-ANNOTATION",
    parentItem: attachment,
    annotationType: "highlight",
    annotationText: "Wrong annotation",
  });
  const { deps, pages } = dependencies();
  let exactAttempts = 0;
  deps.getByLibraryAndKey = () => wrongAnnotation as Zotero.Item;
  deps.openAnnotation = async () => {
    exactAttempts += 1;
    return true;
  };

  await assert.rejects(
    createZoteroSourceGateway(deps).open({
      kind: "quote",
      source: {
        library: { type: "user" },
        itemKey: "ITEM",
        attachmentKey: "PDF",
        annotationKey: "EXPECTED-ANNOTATION",
      },
    }),
    (error: unknown) =>
      error instanceof SourceGatewayError && error.code === "parent-mismatch",
  );
  assert.equal(exactAttempts, 0);
  assert.deepEqual(pages, []);
});

test("production dependencies use Zotero Reader's supported annotation location", async (t) => {
  const regular = item("regular", { id: 10, key: "ITEM" });
  const attachment = item("attachment", {
    id: 11,
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    id: 12,
    key: "ANNOTATION",
    parentItem: attachment,
    annotationPosition: '{"pageIndex":7}',
    annotationType: "highlight",
    annotationText: "Text",
  });
  const byKey = new Map(
    [regular, attachment, annotation].map((value) => [value.key, value]),
  );
  const calls: unknown[][] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Libraries: { userLibraryID: 1, get: () => ({ libraryType: "user" }) },
      Groups: { get: () => null },
      Items: {
        getByLibraryAndKey: (_libraryID: number, key: string) =>
          byKey.get(key) ?? null,
        get: () => null,
      },
      Utilities: {
        cleanTags: (html: string) => html,
        unescapeHTML: (html: string) => html,
      },
      Reader: {
        open: async (...args: unknown[]) => {
          calls.push(args);
        },
      },
      getMainWindow: () => ({ ZoteroPane: {} }),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Zotero", previous);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });

  await createZoteroSourceGateway().open({
    kind: "quote",
    source: {
      library: { type: "user" },
      itemKey: "ITEM",
      attachmentKey: "PDF",
      annotationKey: "ANNOTATION",
    },
  });

  assert.deepEqual(calls, [[11, { annotationID: "ANNOTATION" }]]);
});

test("production dependencies use FileHandlers page location when Reader is absent", async () => {
  await withProductionQuoteZotero(
    { annotationPosition: '{"pageIndex":7}' },
    async ({ attachment, fileHandlerCalls }) => {
      await createZoteroSourceGateway().open({
        kind: "quote",
        source: {
          library: { type: "user" },
          itemKey: "ITEM",
          attachmentKey: "PDF",
          annotationKey: "ANNOTATION",
        },
      });

      assert.deepEqual(fileHandlerCalls, [
        [attachment, { location: { pageIndex: 7 } }],
      ]);
    },
  );
});

test("production dependencies open the attachment without location when no page can be derived", async () => {
  for (const fixture of [
    { annotationPosition: undefined, reader: {} },
    { annotationPosition: "not-json", reader: undefined },
  ]) {
    await withProductionQuoteZotero(
      fixture,
      async ({ attachment, fileHandlerCalls }) => {
        await createZoteroSourceGateway().open({
          kind: "quote",
          source: {
            library: { type: "user" },
            itemKey: "ITEM",
            attachmentKey: "PDF",
            annotationKey: "ANNOTATION",
          },
        });

        assert.deepEqual(fileHandlerCalls, [[attachment]]);
      },
    );
  }
});

test("production exact Reader failures are not converted into page fallback", async (t) => {
  const regular = item("regular", { id: 10, key: "ITEM" });
  const attachment = item("attachment", {
    id: 11,
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    id: 12,
    key: "ANNOTATION",
    parentItem: attachment,
    annotationPosition: '{"pageIndex":7}',
    annotationType: "highlight",
    annotationText: "Text",
  });
  const calls: unknown[][] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Libraries: { userLibraryID: 1, get: () => ({ libraryType: "user" }) },
      Groups: { get: () => null },
      Items: {
        getByLibraryAndKey: (_libraryID: number, key: string) =>
          key === "ANNOTATION" ? annotation : null,
        get: () => null,
      },
      Utilities: {
        cleanTags: (html: string) => html,
        unescapeHTML: (html: string) => html,
      },
      Reader: {
        open: async (...args: unknown[]) => {
          calls.push(args);
          throw new Error("Reader rejected navigation");
        },
      },
      getMainWindow: () => ({ ZoteroPane: {} }),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Zotero", previous);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });

  await assert.rejects(
    createZoteroSourceGateway().open({
      kind: "quote",
      source: {
        library: { type: "user" },
        itemKey: "ITEM",
        attachmentKey: "PDF",
        annotationKey: "ANNOTATION",
      },
    }),
    /Reader rejected navigation/,
  );
  assert.deepEqual(calls, [[11, { annotationID: "ANNOTATION" }]]);
});

test("lists all six annotation types from standalone PDF, HTML, and EPUB attachments", async () => {
  for (const contentType of [
    "application/pdf",
    "text/html",
    "application/epub+zip",
  ]) {
    const attachment = item("attachment", {
      key: "ATTACHMENT",
      libraryID: 2,
      attachmentContentType: contentType,
      fields: { title: "Reading source" },
    });
    const annotations = [
      "highlight",
      "underline",
      "note",
      "text",
      "image",
      "ink",
    ].map((annotationType, index) =>
      item("annotation", {
        key: `ANNOTATION${index}`,
        libraryID: 2,
        parentItem: attachment,
        annotationType,
        annotationText: index < 2 ? "  Evidence  " : "",
        annotationComment: index < 4 ? "  A comment  " : "",
        annotationColor: "#ffd400",
        tags: ["method", " review "],
        annotationSortIndex: String(index),
      }),
    );
    attachment.getAnnotations = () => annotations;
    const { deps } = dependencies([attachment, ...annotations]);
    const gateway = createZoteroSourceGateway(deps);
    const source = {
      library: { type: "group" as const, groupID: 42 },
      attachmentKey: attachment.key,
    };
    const result = await gateway.listAnnotations(source);
    assert.equal(result.candidates.length, 6);
    assert.deepEqual(result.failures, []);
    for (const [index, candidate] of result.candidates.entries()) {
      assert.deepEqual(candidate.acquisition.source, {
        ...source,
        annotationKey: `ANNOTATION${index}`,
      });
      assert.deepEqual(candidate.acquisition.snapshot, {
        text: index < 2 ? "Evidence" : "",
        attachmentTitle: "Reading source",
        ...(index < 4 ? { comment: "A comment" } : {}),
        annotationType: annotations[index].annotationType,
        color: "#ffd400",
        tags: ["method", "review"],
      });
      assert.deepEqual(
        gateway.acquireItem(annotations[index] as Zotero.Item),
        candidate.acquisition,
      );
      const resolved = await gateway.resolve(`quote${index}`, 3, {
        kind: "quote",
        source: candidate.acquisition.source,
      });
      assert.equal(resolved.status, "resolved");
    }
  }
});

test("literature aggregates all Reader attachments while attachment listing stays scoped", async () => {
  const regular = item("regular", { key: "PARENT" });
  const attachments = [
    "application/pdf",
    "application/epub+zip",
    "text/html",
  ].map((attachmentContentType, index) =>
    item("attachment", {
      key: `ATT${index}`,
      parentItem: regular,
      attachmentContentType,
    }),
  );
  const annotations = attachments.map((attachment, index) =>
    item("annotation", {
      key: `ANN${index}`,
      parentItem: attachment,
      annotationType: "note",
      annotationComment: `Comment ${index}`,
    }),
  );
  for (const [index, attachment] of attachments.entries())
    attachment.getAnnotations = () => [annotations[index]];
  const linkedURL = item("attachment", {
    key: "URL",
    parentItem: regular,
    attachmentContentType: "text/html",
    linkedURL: true,
  });
  linkedURL.getAnnotations = () => {
    throw new Error(
      "getAnnotations must not be called for a URL-only attachment",
    );
  };
  regular.getAttachments = () =>
    [...attachments, linkedURL] as unknown as number[];
  const { deps } = dependencies([
    regular,
    ...attachments,
    ...annotations,
    linkedURL,
  ]);
  const gateway = createZoteroSourceGateway(deps);
  const aggregate = await gateway.listAnnotations({
    library: { type: "user" },
    itemKey: regular.key,
  });
  assert.deepEqual(
    aggregate.candidates.map(
      (candidate) => candidate.acquisition.source.annotationKey,
    ),
    ["ANN0", "ANN1", "ANN2"],
  );
  assert.deepEqual(aggregate.failures, []);
  const scoped = await gateway.listAnnotations({
    library: { type: "user" },
    attachmentKey: "ATT1",
  });
  assert.deepEqual(
    scoped.candidates.map(
      (candidate) => candidate.acquisition.source.annotationKey,
    ),
    ["ANN1"],
  );
  await assert.rejects(
    gateway.listAnnotations({
      library: { type: "user" },
      attachmentKey: "URL",
    }),
    { code: "wrong-kind" },
  );
});

test("standalone annotation source remains stable after attaching its file to a regular item", async () => {
  const attachment = item("attachment", {
    key: "FILE",
    attachmentContentType: "text/html",
  });
  const annotation = item("annotation", {
    key: "ANN",
    parentItem: attachment,
    annotationType: "note",
    annotationComment: "Comment",
  });
  const parent = item("regular", { key: "PARENT" });
  const { deps } = dependencies([attachment, annotation, parent]);
  const gateway = createZoteroSourceGateway(deps);
  const acquired = gateway.acquireItem(annotation as Zotero.Item);
  assert.equal(acquired.kind, "quote");
  if (acquired.kind !== "quote") assert.fail("expected quote");
  attachment.parentItem = parent;
  const resolved = await gateway.resolve("quote", 0, {
    kind: "quote",
    source: acquired.source,
  });
  assert.equal(resolved.status, "resolved");
  if (resolved.status !== "resolved") assert.fail("expected resolution");
  assert.deepEqual(resolved.acquisition.source, acquired.source);
  await gateway.open({ kind: "quote", source: acquired.source });
  await assert.rejects(
    gateway.open({
      kind: "quote",
      source: { ...acquired.source, itemKey: "OLD-PARENT" },
    }),
    { code: "parent-mismatch" },
  );
});

test("annotation listing and resolution reject cross-library or wrong-parent chains", async () => {
  const regular = item("regular", { key: "PARENT" });
  const attachment = item("attachment", {
    key: "FILE",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    key: "ANN",
    parentItem: attachment,
    annotationType: "note",
    annotationComment: "Comment",
  });
  attachment.getAnnotations = () => [annotation];
  regular.getAttachments = () => [attachment] as unknown as number[];
  const { deps } = dependencies([regular, attachment, annotation]);
  const gateway = createZoteroSourceGateway(deps);
  const source = {
    library: { type: "user" as const },
    attachmentKey: "FILE",
    annotationKey: "ANN",
    itemKey: "PARENT",
  };
  for (const value of [regular, attachment, annotation]) {
    value.libraryID = 2;
    const resolved = await gateway.resolve("quote", 0, {
      kind: "quote",
      source,
    });
    assert.equal(resolved.status, "unavailable");
    await assert.rejects(gateway.open({ kind: "quote", source }), {
      code: "parent-mismatch",
    });
    const listing = gateway.listAnnotations({
      library: { type: "user" },
      attachmentKey: "FILE",
    });
    if (value === attachment) {
      await assert.rejects(listing, { code: "parent-mismatch" });
    } else {
      const result = await listing;
      assert.equal(result.candidates.length, 0);
      assert.equal(result.failures.length, 1);
    }
    value.libraryID = 1;
  }
  const other = item("regular", { key: "OTHER" });
  attachment.parentItem = other;
  const aggregate = await gateway.listAnnotations({
    library: { type: "user" },
    itemKey: "PARENT",
  });
  assert.equal(aggregate.candidates.length, 0);
  assert.equal(aggregate.failures[0].code, "attachment-unavailable");
});

test("attachment annotation loading preserves typed failure without pretending the list is empty", async () => {
  const attachment = item("attachment", {
    key: "FILE",
    attachmentContentType: "text/html",
  });
  attachment.getAnnotations = () => {
    throw new Error("child data unavailable");
  };
  const { deps } = dependencies([attachment]);
  const gateway = createZoteroSourceGateway(deps);
  assert.deepEqual(
    await gateway.listAnnotations({
      library: { type: "user" },
      attachmentKey: "FILE",
    }),
    {
      candidates: [],
      failures: [
        {
          code: "attachment-unavailable",
          message: "Annotations from an attachment could not be loaded.",
          attachmentKey: "FILE",
        },
      ],
    },
  );
  await assert.rejects(
    gateway.listAnnotations({
      library: { type: "user" },
      attachmentKey: "MISSING",
    }),
    { code: "item-missing" },
  );
});

test("HTML and EPUB annotations navigate exactly or open their file without a PDF page fallback", async () => {
  for (const attachmentContentType of ["text/html", "application/epub+zip"]) {
    const attachment = item("attachment", {
      key: "FILE",
      attachmentContentType,
    });
    const annotation = item("annotation", {
      key: "ANN",
      parentItem: attachment,
      annotationType: "text",
      annotationComment: "Text box",
      annotationPosition: '{"pageIndex":7}',
    });
    const { deps, pages } = dependencies([attachment, annotation]);
    const gateway = createZoteroSourceGateway(deps);
    const descriptor = {
      kind: "quote" as const,
      source: {
        library: { type: "user" as const },
        attachmentKey: "FILE",
        annotationKey: "ANN",
      },
    };
    await gateway.open(descriptor);
    assert.deepEqual(pages, [{ key: "FILE", pageIndex: undefined }]);
    pages.length = 0;
    const opened: string[] = [];
    deps.openAnnotation = async (file, annotation) => {
      opened.push(`${file.key}:${annotation.key}`);
      return true;
    };
    await gateway.open(descriptor);
    assert.deepEqual(opened, ["FILE:ANN"]);
    assert.deepEqual(pages, []);
  }
});

test("image and ink previews travel through listing and resolution after source validation", async () => {
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const attachment = item("attachment", {
    key: "PDF",
    attachmentContentType: "application/pdf",
  });
  const annotations = ["ink", "image", "highlight"].map((annotationType, i) =>
    item("annotation", {
      key: `ANN${i}`,
      parentItem: attachment,
      annotationType,
      annotationText: "",
      annotationComment: "Comment",
    }),
  );
  attachment.getAnnotations = () => annotations;
  const { deps } = dependencies([attachment, ...annotations]);
  const reads: string[] = [];
  deps.readAnnotationImage = async (annotation) => {
    reads.push(annotation.key);
    return image;
  };
  const gateway = createZoteroSourceGateway(deps);
  const result = await gateway.listAnnotations({
    library: { type: "user" },
    attachmentKey: "PDF",
  });
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(reads.sort(), ["ANN0", "ANN1"]);
  for (const candidate of result.candidates) {
    const expected =
      candidate.acquisition.snapshot.annotationType === "highlight"
        ? undefined
        : image;
    assert.equal(candidate.acquisition.snapshot.image, expected);
    const resolved = await gateway.resolve("quote", 1, {
      kind: "quote",
      source: candidate.acquisition.source,
    });
    assert.equal(resolved.status, "resolved");
    if (resolved.status === "resolved" && resolved.acquisition.kind === "quote")
      assert.equal(resolved.acquisition.snapshot.image, expected);
  }
  deps.readAnnotationImage = async () => "https://example.com/tracking.png";
  const withoutImage = await gateway.listAnnotations({
    library: { type: "user" },
    attachmentKey: "PDF",
  });
  assert.equal(withoutImage.failures.length, 0);
  assert.ok(
    withoutImage.candidates.every(
      (c) =>
        !c.acquisition.snapshot.image &&
        c.acquisition.snapshot.comment === "Comment",
    ),
  );
});

test("a parent change during an annotation cache read cannot return a resolved preview", async () => {
  const attachment = item("attachment", {
    key: "PDF",
    attachmentContentType: "application/pdf",
  });
  const annotation = item("annotation", {
    key: "ANN",
    parentItem: attachment,
    annotationType: "ink",
  });
  const { deps } = dependencies([attachment, annotation]);
  const started = Promise.withResolvers<void>();
  const image = Promise.withResolvers<string | undefined>();
  deps.readAnnotationImage = () => {
    started.resolve();
    return image.promise;
  };
  const gateway = createZoteroSourceGateway(deps);
  const pending = gateway.resolve("quote", 1, {
    kind: "quote",
    source: {
      library: { type: "user" },
      attachmentKey: "PDF",
      annotationKey: "ANN",
    },
  });
  await started.promise;
  annotation.parentItem = item("attachment", {
    key: "OTHER",
    attachmentContentType: "application/pdf",
  });
  image.resolve(undefined);
  assert.equal((await pending).status, "unavailable");
});

test("production cache reads preserve metadata when the cache is missing or unreadable", async () => {
  await withProductionQuoteZotero({}, async ({ annotation }) => {
    annotation.annotationType = "ink";
    const image = "data:image/png;base64,aGVsbG8=";
    const errors: unknown[] = [];
    const reads: unknown[][] = [];
    let cached = true;
    let fail = false;
    Object.assign(Zotero, {
      Annotations: {
        hasCacheImage: async () => cached,
        getCacheImagePath: () => "/cache/annotation.png",
      },
      File: {
        generateDataURI: async (...args: unknown[]) => {
          reads.push(args);
          if (fail) throw new Error("Cache unreadable");
          return image;
        },
      },
      logError: (error: unknown) => errors.push(error),
    });
    const gateway = createZoteroSourceGateway();
    const resolve = () =>
      gateway.resolve("quote", 1, {
        kind: "quote",
        source: {
          library: { type: "user" },
          itemKey: "ITEM",
          attachmentKey: "PDF",
          annotationKey: "ANNOTATION",
        },
      });
    const first = await resolve();
    assert.equal(first.status, "resolved");
    if (first.status === "resolved" && first.acquisition.kind === "quote")
      assert.equal(first.acquisition.snapshot.image, image);
    assert.deepEqual(reads, [["/cache/annotation.png", "image/png"]]);
    cached = false;
    assert.equal((await resolve()).status, "resolved");
    assert.equal(reads.length, 1);
    cached = true;
    fail = true;
    assert.equal((await resolve()).status, "resolved");
    assert.equal(errors.length, 1);
  });
});
