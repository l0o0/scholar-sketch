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
const PNG_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l18AAAAASUVORK5CYII=";

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

test("non-image MIME headers reject previews without decoding their payload", (t) => {
  const decode = t.mock.method(globalThis, "atob", () => {
    throw new Error("Non-image preview must not decode original bytes");
  });
  for (const mimeType of [
    "application/pdf",
    "application/octet-stream",
    "text/plain",
    "text/html",
    "audio/mpeg",
    "video/mp4",
    "image/unsupported",
    "image/png+xml",
  ]) {
    assert.equal(isSafeImagePreview(`data:${mimeType};base64,JVBERi0=`), false);
    assert.equal(
      isSafeImagePreview(`data:${mimeType};charset=utf-8;base64,JVBERi0=`),
      false,
    );
  }
  assert.equal(
    isSafeImagePreview("data:application/pdf;image/png;base64,JVBERi0="),
    false,
  );
  assert.equal(isSafeImagePreview(undefined), false);
  assert.equal(isSafeImagePreview("https://example.invalid/image.png"), false);
  assert.equal(decode.mock.callCount(), 0);
});

test("supported raster previews retain base64 validation and MIME parameters", (t) => {
  const originalDecode = globalThis.atob;
  const decode = t.mock.method(globalThis, "atob", originalDecode);
  assert.equal(isSafeImagePreview(PNG_DATA), true);
  assert.equal(
    isSafeImagePreview(
      PNG_DATA.replace("image/png;", "IMAGE/PNG;charset=utf-8;"),
    ),
    true,
  );
  assert.equal(decode.mock.callCount(), 2);
  for (const source of [
    "data:image/png;base64,A===",
    "data:image/png;base64,AQ=",
    "data:image/png;base64,%%%",
    "data:image/png;charset utf-8;base64,AQ==",
    "data:image/png;base64;charset=utf-8,AQ==",
    "data:image/png;application/pdf;base64,AQ==",
    "data:image/png,%89PNG",
  ]) {
    assert.equal(isSafeImagePreview(source), false, source);
  }
  assert.equal(
    decode.mock.callCount(),
    2,
    "malformed images never reach decoding",
  );
});

test("oversized raster and SVG payloads are rejected before decoding", (t) => {
  const decode = t.mock.method(globalThis, "atob", () => {
    throw new Error("Oversized preview must not decode");
  });
  const payload = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64");
  for (const mimeType of ["image/png", "image/svg+xml"]) {
    assert.equal(
      isSafeImagePreview(`data:${mimeType};base64,${payload}`),
      false,
    );
  }
  assert.equal(decode.mock.callCount(), 0);
});

test("SVG previews keep their inert-source checks in base64 and URI encodings", () => {
  const safe =
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0Z"/></svg>';
  const sources = [
    [safe, true],
    ["<svg><script>alert(1)</script></svg>", false],
    ['<svg onload="alert(1)"><path/></svg>', false],
    ["<svg><foreignObject><div>active</div></foreignObject></svg>", false],
    ['<svg><path href="https://example.invalid/payload"/></svg>', false],
    ['<svg><path fill="url(data:text/html,payload)"/></svg>', false],
    ['<svg><animate attributeName="x"/></svg>', false],
    ['<svg><path onclick="alert(1)"/></svg>', false],
    ["<svg", false],
  ] as const;
  for (const [source, expected] of sources) {
    assert.equal(
      isSafeImagePreview(`data:image/svg+xml;base64,${btoa(source)}`),
      expected,
      source,
    );
    assert.equal(
      isSafeImagePreview(`data:image/svg+xml,${encodeURIComponent(source)}`),
      expected,
      source,
    );
  }
  assert.equal(isSafeImagePreview("data:image/svg+xml,%ZZ"), false);
});

test("image decoder failure does not escape the preview safety check", (t) => {
  const decode = t.mock.method(globalThis, "atob", () => {
    throw new Error("Damaged data");
  });
  assert.equal(isSafeImagePreview(PNG_DATA), false);
  assert.equal(decode.mock.callCount(), 1);
});
