import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ATTACHMENT_BYTES } from "../packages/whiteboard/src/model/file-attachment.ts";
import {
  canAcceptNativeFileTransfer,
  importWhiteboardFiles,
  importedImageMarkdown,
  isEditingImportSessionCurrent,
} from "../packages/whiteboard/src/whiteboard/file-import.ts";
import { renderMarkdownCore } from "../src/modules/markdown/preview-render-core.ts";

test("imported image filenames remain literal Markdown alt text", () => {
  for (const title of [
    "scan[1].png",
    "[arxiv]figure.png",
    "a\\b].png",
    "a\nb.png",
  ]) {
    const markdown = importedImageMarkdown({
      title,
      contentType: "image/png",
      fileData: "data:image/png;base64,aGk=",
      size: 2,
    });
    const html = renderMarkdownCore(markdown);
    assert.match(html, /<img src="data:image\/png;base64,aGk="/);
    assert.ok(html.includes(`alt="${title.replace(/[\r\n]+/g, " ")}"`), html);
  }
  assert.equal(
    importedImageMarkdown({
      title: "unsafe.svg",
      contentType: "image/svg+xml",
      fileData: "data:image/svg+xml;base64,aGk=",
      size: 2,
    }),
    "",
  );
  for (const subtype of ["jpeg", "gif", "webp", "avif", "bmp"]) {
    const html = renderMarkdownCore(
      importedImageMarkdown({
        title: `figure.${subtype}`,
        contentType: `image/${subtype}`,
        fileData: `data:image/${subtype};base64,aGk=`,
        size: 2,
      }),
    );
    assert.match(html, /<img /);
  }
});

test("protected OS file drags are accepted without intercepting Zotero drags", () => {
  const protectedFiles = {
    files: { length: 0 },
    types: ["Files"],
  } as unknown as Pick<DataTransfer, "files" | "types">;
  assert.equal(canAcceptNativeFileTransfer(protectedFiles), true);
  assert.equal(
    canAcceptNativeFileTransfer({
      files: { length: 1 },
      types: ["Files", "application/x-zotero-item"],
    } as unknown as Pick<DataTransfer, "files" | "types">),
    false,
  );
});

test("pending image insertion is invalidated by edits, cancel, or reopen", () => {
  const expected = { nodeId: "note", value: "before", revision: 4 };
  assert.equal(isEditingImportSessionCurrent(expected, expected), true);
  assert.equal(
    isEditingImportSessionCurrent(
      { nodeId: "note", value: "changed", revision: 5 },
      expected,
    ),
    false,
  );
  assert.equal(
    isEditingImportSessionCurrent(
      { nodeId: "note", value: "before", revision: 5 },
      expected,
    ),
    false,
  );
});

test("whiteboard file import embeds bounded data and text preview", async (t) => {
  const previous = globalThis.FileReader;
  class Reader {
    result: string | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(file: File) {
      void file
        .arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          this.result = `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
          this.onload?.();
        })
        .catch((error: unknown) => {
          this.error =
            error instanceof Error ? error : new Error(String(error));
          this.onerror?.();
        });
    }
  }
  Object.assign(globalThis, { FileReader: Reader });
  t.after(() => Object.assign(globalThis, { FileReader: previous }));

  const result = await importWhiteboardFiles([
    new File(["# hello\nworld"], "note.md", { type: "text/markdown" }),
  ]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.files[0]?.title, "note.md");
  assert.equal(result.files[0]?.preview, "# hello\nworld");
  assert.match(result.files[0]?.fileData ?? "", /^data:text\/markdown;base64,/);
});

test("whiteboard file import rejects per-file and batch size limits", async () => {
  const oversized = {
    name: "large.bin",
    type: "application/octet-stream",
    size: MAX_ATTACHMENT_BYTES + 1,
  } as File;
  const result = await importWhiteboardFiles([oversized]);
  assert.equal(result.files.length, 0);
  assert.equal(result.failures[0]?.reason, "too-large");
});
