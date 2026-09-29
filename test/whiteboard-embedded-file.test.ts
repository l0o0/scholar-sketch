import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeEmbeddedFileData,
  embeddedFileNodeRaw,
  isPotentiallyActiveFile,
  requiresExplicitSave,
  safeEmbeddedFilename,
} from "../src/modules/whiteboard/embedded-file.ts";

test("embedded file decoding enforces the declared byte size and cap", () => {
  const fileData = "data:text/plain;base64,SGk=";
  assert.deepEqual(
    decodeEmbeddedFileData({
      title: "note.txt",
      contentType: "text/plain",
      size: 2,
      fileData,
    })?.bytes,
    new Uint8Array([72, 105]),
  );
  assert.equal(
    decodeEmbeddedFileData({
      title: "note.txt",
      contentType: "text/plain",
      size: 3,
      fileData,
    }),
    null,
  );
});

test("active and unknown files require an explicit save", () => {
  assert.equal(isPotentiallyActiveFile("text/html"), true);
  assert.equal(requiresExplicitSave("page.html", "text/html"), true);
  assert.equal(
    requiresExplicitSave("data.bin", "application/octet-stream"),
    true,
  );
  assert.equal(
    safeEmbeddedFilename("../paper.pdf", "application/pdf", { forOpen: true }),
    "paper.pdf",
  );
  assert.equal(
    safeEmbeddedFilename("page.html", "text/html", { forOpen: true }),
    "page.bin",
  );
  assert.equal(
    safeEmbeddedFilename("data.weird", "application/octet-stream"),
    "data.weird",
  );
  assert.ok(
    decodeEmbeddedFileData({
      title: "page.html",
      contentType: "text/html",
      size: 2,
      fileData: "data:text/html;base64,SGk=",
    }),
  );
});

test("note attachment opens resolve only the requested current note bytes", () => {
  const attachment = {
    id: "file-1",
    title: "notes.txt",
    contentType: "text/plain",
    size: 2,
    fileData: "data:text/plain;base64,SGk=",
  };
  const snapshot = {
    version: 2 as const,
    nodes: [
      {
        id: "note-1",
        kind: "note" as const,
        content: "Note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 160,
        attachments: [attachment],
      },
    ],
    connections: [],
  };
  const raw = embeddedFileNodeRaw(snapshot, "note-1", "file-1");
  assert.equal(raw, attachment);
  assert.deepEqual(
    decodeEmbeddedFileData(raw)?.bytes,
    new Uint8Array([72, 105]),
  );
  assert.equal(embeddedFileNodeRaw(snapshot, "note-1", "missing"), undefined);
  assert.equal(embeddedFileNodeRaw(snapshot, "missing", "file-1"), undefined);
  assert.equal(embeddedFileNodeRaw(snapshot, "note-1"), undefined);
});
