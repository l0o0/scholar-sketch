import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasDocumentToFile,
  canvasFileToDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import {
  MAX_ATTACHMENT_BYTES,
  inferAttachmentContentType,
  isSafeImagePreview,
} from "../packages/whiteboard/src/model/file-attachment.ts";
import { parseCanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import {
  buildCanvasMarkdown,
  buildCanvasSvg,
} from "../packages/whiteboard/src/whiteboard/export.ts";

const PDF_DATA = "data:application/pdf;base64,JVBERi0=";

test("embedded attachment bytes survive a JSON Canvas round trip", () => {
  const document = {
    version: 2 as const,
    nodes: [
      {
        id: "attachment",
        kind: "attachment" as const,
        position: { x: 0, y: 0 },
        width: 240,
        height: 160,
        data: {
          title: "paper.pdf",
          contentType: "application/pdf",
          fileData: PDF_DATA,
          size: 5,
          pageCount: 4,
        },
      },
    ],
    connections: [],
  };
  const parsed = canvasFileToDocument(canvasDocumentToFile(document));
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.document.nodes[0]?.kind, "attachment");
  assert.equal(
    parsed.document.nodes[0]?.kind === "attachment"
      ? parsed.document.nodes[0].data.fileData
      : undefined,
    PDF_DATA,
  );
});

test("attachment fields reject unsafe or out of bounds values", () => {
  const base = {
    id: "attachment",
    kind: "attachment",
    position: { x: 0, y: 0 },
    width: 240,
    height: 160,
  } as const;
  for (const data of [
    { title: "bad", fileData: "data:text/plain;base64,%%%" },
    { title: "large", size: MAX_ATTACHMENT_BYTES + 1 },
    {
      title: "active",
      image: "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=",
    },
  ]) {
    const result = parseCanvasDocument({
      version: 2,
      nodes: [{ ...base, data }],
      connections: [],
    });
    assert.equal(result.document.nodes.length, 0);
    assert.equal(result.issues[0]?.code, "malformed-node");
  }
});

test("legacy PDF image fields remain readable and unsafe URLs are not exported", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      {
        id: "legacy-pdf",
        kind: "pdf",
        position: { x: 0, y: 0 },
        width: 240,
        height: 160,
        data: { title: "Figure", image: "https://example.invalid/figure.png" },
      },
    ],
    connections: [],
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.document.nodes[0]?.kind, "pdf");
  assert.match(buildCanvasSvg(result.document), /Figure/);
  assert.doesNotMatch(buildCanvasSvg(result.document), /example\.invalid/);
  assert.match(buildCanvasMarkdown(result.document), /Figure/);
  assert.equal(
    inferAttachmentContentType("paper.pdf", "application/octet-stream"),
    "application/pdf",
  );
  assert.equal(isSafeImagePreview("https://example.invalid/figure.png"), false);
});
