import assert from "node:assert/strict";
import test from "node:test";
import {
  createAcademicConnection,
  createAcademicNode,
  createBasicNode,
  type LiteratureNode,
  type QuoteNode,
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
