import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationListSourceIdentity,
  annotationSourceMatches,
  isAnnotatableAttachmentContentType,
  nativeAnnotationIdentity,
  parseAnnotationListSource,
  quoteAttachmentIdentity,
  quoteSourceIdentity,
  createAcademicConnection,
  createAcademicNode,
  createBasicNode,
  type LiteratureNode,
  type QuoteNode,
  type QuoteSource,
} from "../packages/whiteboard/src/model/index.ts";

const user = { type: "user" } as const;

test("creates the editable academic object kinds with explicit defaults", () => {
  const note = createAcademicNode("note", { x: 10, y: 20 }, "note-1");
  const frame = createAcademicNode("frame", { x: 0, y: 0 }, "frame-1");

  assert.equal(note.kind, "note");
  assert.equal(note.content, "");
  assert.equal(frame.kind, "frame");
  assert.equal(frame.title, "");
});

test("creates one Note kind with optional content and badge", () => {
  const note = createAcademicNode("note", { x: 10, y: 20 }, "note-1", {
    badge: "问题",
    content: "Why?",
  });

  assert.equal(note.kind, "note");
  assert.equal(note.badge, "问题");
  assert.equal(note.content, "Why?");
});

test("literature and quote factories require native Zotero keys and snapshots", () => {
  const literature: LiteratureNode = createAcademicNode(
    "literature",
    { x: 0, y: 0 },
    "lit-1",
    {
      source: { library: user, itemKey: "ABCD1234" },
      snapshot: { title: "A paper", creators: "Smith", year: "2026" },
    },
  );
  const quote: QuoteNode = createAcademicNode(
    "quote",
    { x: 280, y: 0 },
    "quote-1",
    {
      source: {
        library: user,
        itemKey: "ABCD1234",
        attachmentKey: "PDFD1234",
        annotationKey: "ANNO1234",
      },
      snapshot: { text: "Evidence", pageLabel: "12", color: "#ffd400" },
    },
  );

  assert.equal(literature.source.itemKey, "ABCD1234");
  assert.equal(quote.source.annotationKey, "ANNO1234");
});

test("academic relationships allow arbitrary existing endpoint kinds", () => {
  const edge = createAcademicConnection(
    "edge-1",
    "rect-1",
    "note-1",
    "contradicts",
  );
  assert.deepEqual(edge, {
    id: "edge-1",
    kind: "academic",
    source: "rect-1",
    target: "note-1",
    relation: "contradicts",
  });
});

test("basic factory defaults are isolated from returned node mutation", () => {
  const first = createBasicNode("rect", { x: 0, y: 0 }, "rect-1");
  first.data.title = "Changed";
  first.style!.stroke = "#ff0000";

  const second = createBasicNode("rect", { x: 10, y: 20 }, "rect-2");

  assert.equal(second.data.title, "");
  assert.equal(second.style!.stroke, "#1f2937");
});

test("annotation identity keeps legacy keys and separates source kind and library", () => {
  const quote: QuoteSource = {
    library: user,
    itemKey: "ITEM1234",
    attachmentKey: "ATTACH12",
    annotationKey: "ANNO1234",
  };
  assert.equal(
    quoteSourceIdentity(quote),
    '["quote","user",null,"ITEM1234","ATTACH12","ANNO1234"]',
  );
  assert.equal(
    quoteAttachmentIdentity(quote),
    '["quote-attachment","user",null,"ITEM1234","ATTACH12"]',
  );
  const standalone: QuoteSource = {
    library: user,
    attachmentKey: "ATTACH12",
    annotationKey: "ANNO1234",
  };
  assert.equal(
    quoteSourceIdentity(standalone),
    '["quote","user",null,null,"ATTACH12","ANNO1234"]',
  );
  assert.equal(
    quoteAttachmentIdentity(standalone),
    '["quote-attachment","user",null,null,"ATTACH12"]',
  );
  const sources = [
    { library: user, itemKey: "SHARED12" },
    { library: user, attachmentKey: "SHARED12" },
    {
      library: { type: "group", groupID: 7 } as const,
      attachmentKey: "SHARED12",
    },
    {
      library: { type: "group", groupID: 8 } as const,
      attachmentKey: "SHARED12",
    },
  ];
  assert.equal(
    new Set(sources.map(annotationListSourceIdentity)).size,
    sources.length,
  );
});

test("annotation matching isolates libraries and attachment listings", () => {
  const quote: QuoteSource = {
    library: { type: "group", groupID: 7 },
    itemKey: "ITEM1234",
    attachmentKey: "ATTACH12",
    annotationKey: "ANNO1234",
  };
  assert.equal(
    annotationSourceMatches(quote, {
      library: quote.library,
      itemKey: "ITEM1234",
    }),
    true,
  );
  assert.equal(
    annotationSourceMatches(quote, {
      library: quote.library,
      attachmentKey: "ATTACH12",
    }),
    true,
  );
  assert.equal(
    annotationSourceMatches(quote, {
      library: quote.library,
      attachmentKey: "ATTACH13",
    }),
    false,
  );
  assert.equal(
    annotationSourceMatches(quote, {
      library: quote.library,
      itemKey: "ITEM5678",
    }),
    false,
  );
  for (const library of [user, { type: "group", groupID: 8 } as const]) {
    assert.equal(
      annotationSourceMatches(quote, { library, attachmentKey: "ATTACH12" }),
      false,
    );
    assert.equal(
      annotationSourceMatches(quote, { library, itemKey: "ITEM1234" }),
      false,
    );
  }
  const standalone: QuoteSource = {
    library: quote.library,
    attachmentKey: quote.attachmentKey,
    annotationKey: quote.annotationKey,
  };
  assert.equal(
    annotationSourceMatches(standalone, {
      library: quote.library,
      itemKey: "ITEM1234",
    }),
    false,
  );
  assert.equal(
    annotationSourceMatches(standalone, {
      library: quote.library,
      attachmentKey: "ATTACH12",
    }),
    true,
  );
});

test("native annotation identity ignores parent changes but retains attachment and library boundaries", () => {
  const source: QuoteSource = {
    library: user,
    attachmentKey: "ATTACH12",
    annotationKey: "ANNOT123",
  };
  assert.equal(
    nativeAnnotationIdentity(source),
    nativeAnnotationIdentity({ ...source, itemKey: "PARENT1" }),
  );
  assert.equal(
    nativeAnnotationIdentity(source),
    nativeAnnotationIdentity({ ...source, itemKey: "PARENT2" }),
  );
  assert.notEqual(
    quoteSourceIdentity(source),
    quoteSourceIdentity({ ...source, itemKey: "PARENT1" }),
  );
  const identities = [
    source,
    { ...source, attachmentKey: "ATTACH13" },
    { ...source, annotationKey: "ANNOT456" },
    { ...source, library: { type: "group", groupID: 7 } as const },
    { ...source, library: { type: "group", groupID: 8 } as const },
  ].map(nativeAnnotationIdentity);
  assert.equal(new Set(identities).size, identities.length);
});

test("annotation listing parser accepts exactly one own source key", () => {
  for (const source of [
    { library: user, itemKey: "ITEM1234" },
    { library: user, attachmentKey: "ATTACH12" },
  ]) {
    assert.deepEqual(parseAnnotationListSource(source), source);
  }
  for (const source of [
    { library: user },
    { library: user, itemKey: "ITEM1234", attachmentKey: "ATTACH12" },
    { library: user, itemKey: "ITEM1234", attachmentKey: undefined },
    Object.defineProperty(
      { library: user, attachmentKey: "ATTACH12" },
      "itemKey",
      { value: "ITEM1234" },
    ),
    { library: user, itemKey: "ITEM1234", annotationKey: "ANNOT123" },
    { library: user, itemKey: "" },
    { library: user, attachmentKey: null },
    Object.assign(Object.create({ attachmentKey: "ATTACH12" }), {
      library: user,
    }),
    Object.assign(Object.create({ library: user }), {
      attachmentKey: "ATTACH12",
    }),
  ]) {
    assert.equal(parseAnnotationListSource(source), undefined);
  }
});

test("annotatable attachment types include PDF, EPUB and webpage snapshots", () => {
  for (const contentType of [
    "application/pdf",
    "application/epub+zip",
    "text/html",
    " Text/HTML; charset=utf-8 ",
  ]) {
    assert.equal(
      isAnnotatableAttachmentContentType(contentType),
      true,
      contentType,
    );
  }
  for (const contentType of [
    undefined,
    "",
    "text/markdown",
    "text/plain",
    "image/png",
    "application/octet-stream",
    "application/xhtml+xml",
  ]) {
    assert.equal(
      isAnnotatableAttachmentContentType(contentType),
      false,
      contentType,
    );
  }
});
