import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasDocumentToFile,
  parseCanvasDocument,
  type NoteAttachment,
} from "../packages/whiteboard/src/model/index.ts";
import { canvasFileToDocument } from "../packages/whiteboard/src/model/canvas-file.ts";
import { buildCanvasMarkdown } from "../packages/whiteboard/src/whiteboard/export.ts";

const textAttachment: NoteAttachment = {
  id: "note-file-1",
  title: "paper.txt",
  contentType: "text/plain",
  size: 2,
  fileData: "data:text/plain;base64,SGk=",
  preview: "Hi",
};

function documentWith(attachments: unknown) {
  return parseCanvasDocument({
    version: 2,
    nodes: [
      {
        id: "note-1",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "A note",
        attachments,
      },
    ],
    connections: [],
  });
}

test("note attachments survive canvas serialization and markdown export", () => {
  const parsed = documentWith([textAttachment]);
  assert.deepEqual(parsed.document.nodes[0], {
    id: "note-1",
    kind: "note",
    position: { x: 0, y: 0 },
    width: 260,
    height: 152,
    content: "A note",
    attachments: [textAttachment],
  });
  assert.match(
    buildCanvasMarkdown(parsed.document),
    /- \[paper\.txt\]\(data:text\/plain;base64,SGk=\)/,
  );
  const roundTrip = canvasFileToDocument(canvasDocumentToFile(parsed.document));
  assert.deepEqual(roundTrip.document.nodes[0], parsed.document.nodes[0]);
});

test("malformed note attachments invalidate the note node", () => {
  const parsed = documentWith([
    { ...textAttachment, size: 15 * 1024 * 1024 + 1 },
  ]);
  assert.equal(parsed.document.nodes.length, 0);
  assert.equal(parsed.issues[0]?.code, "malformed-node");
});

test("active note files remain named in Markdown without becoming data links", () => {
  const parsed = documentWith([
    {
      ...textAttachment,
      title: "unsafe.html",
      contentType: "text/html",
      fileData: "data:text/html;base64,PGgxPkhlbGxvPC9oMT4=",
      size: 14,
    },
  ]);
  const markdown = buildCanvasMarkdown(parsed.document);
  assert.match(markdown, /- unsafe\.html \(text\/html\)/);
  assert.doesNotMatch(markdown, /data:text\/html/);
});

test("Zotero references round-trip and export portable library links without embedded files", () => {
  const base = documentWith([]).document;
  const node = base.nodes[0];
  if (node.kind !== "note") throw new Error("Expected note");
  node.references = [
    {
      id: "ref-1",
      kind: "literature",
      title: "Paper",
      creators: "Author",
      year: "2026",
      source: { library: { type: "user" }, itemKey: "ITEM1234" },
    },
    {
      id: "ref-2",
      kind: "attachment",
      title: "Full text",
      source: {
        library: { type: "group", groupID: 42 },
        attachmentKey: "FILE1234",
      },
    },
  ];
  const parsed = parseCanvasDocument(base).document;
  const restored = canvasFileToDocument(canvasDocumentToFile(parsed));
  assert.deepEqual(restored.document.nodes[0], parsed.nodes[0]);
  const markdown = buildCanvasMarkdown(parsed);
  assert.match(
    markdown,
    /\[Paper\]\(zotero:\/\/select\/library\/items\/ITEM1234\)/,
  );
  assert.match(
    markdown,
    /\[Full text\]\(zotero:\/\/select\/groups\/42\/items\/FILE1234\)/,
  );
  assert.doesNotMatch(markdown, /data:/);
  const malformed = structuredClone(base) as any;
  malformed.nodes[0].references[1].source.library.groupID = -1;
  assert.equal(parseCanvasDocument(malformed).document.nodes.length, 0);
});
