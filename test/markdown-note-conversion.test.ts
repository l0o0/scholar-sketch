import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  canConvertNote,
  convertNoteToMarkdown,
  convertSelectedNotes,
} from "../src/modules/markdown/convert-note.ts";
import { noteConversionFixture } from "./helpers/note-conversion.ts";

test("converts a standalone saved Note without altering it and preserves every collection", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const html = "<h1>Original note</h1><p>Original body</p>";
  const note = f.makeNote(1, html, { collections: [11, 10] });
  const result = await convertNoteToMarkdown(f.win, note);
  assert.ok(result);
  assert.equal(result.hasWarnings, false);
  assert.equal(note.getNote(), html);
  assert.equal(result.attachment.libraryID, 1);
  assert.deepEqual((result.attachment as any).collections, [10, 11]);
  assert.equal(result.attachment.attachmentLinkMode, 0);
  assert.equal(result.attachment.attachmentSyncState, 0);
  assert.match(await f.content(result.attachment), /Original body/);
  assert.deepEqual(await readdir(f.temp), []);
});

test("creates a sibling MD under a Note's parent in its group library", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  f.items.set(9, {
    id: 9,
    libraryID: 2,
    deleted: false,
    isRegularItem: () => true,
    isEditable: () => true,
  });
  const note = f.makeNote(1, "<p>Group child</p>", { libraryID: 2, parent: 9 });
  const result = await convertNoteToMarkdown(f.win, note);
  assert.ok(result);
  assert.equal(result.attachment.parentItemID, 9);
  assert.equal(result.attachment.libraryID, 2);
  assert.equal(f.imports[0].libraryID, undefined);
  assert.deepEqual((result.attachment as any).collections, []);
  assert.equal(note.parentItemID, 9);
});

test("copies embedded images as a complete assets package and keeps an image-only Note", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const html =
    '<div data-schema-version="9"><p><img data-attachment-key="IMAGE001" alt="figure"></p></div>';
  const note = f.makeNote(1, html);
  const source = await f.addImage(note);
  let seenHTML = "";
  f.setTranslate((prepared) => {
    seenHTML = prepared;
    const doc = new f.domWindow.DOMParser().parseFromString(
      prepared,
      "text/html",
    );
    assert.ok(
      doc.body.textContent?.trim(),
      "native translator must not skip an image-only Note",
    );
    return `![figure](${doc.querySelector("img")!.getAttribute("src")})${doc.body.textContent}`;
  });
  const result = await convertNoteToMarkdown(f.win, note);
  assert.ok(result);
  assert.doesNotMatch(seenHTML, /data-attachment-key/);
  const markdown = await f.content(result.attachment);
  assert.equal(markdown, "![figure](assets/note-image-1.png)");
  const file = (await result.attachment.getFilePathAsync()) as string;
  assert.deepEqual(
    await readFile(join(dirname(file), "assets", "note-image-1.png")),
    source.bytes,
  );
  assert.deepEqual(await readFile(source.path), source.bytes);
  assert.equal(note.getNote(), html);
});

test("copies data images, leaves remote image URLs and local document links untouched", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const bytes = Buffer.from([137, 80, 78, 71, 1]);
  const note = f.makeNote(
    1,
    `<p><img src="data:image/png;base64,${bytes.toString("base64")}"><img src="https://example.test/figure.png"></p><a href="file:///Users/example/paper.pdf">paper</a>`,
  );
  f.setTranslate((html) => {
    const doc = new f.domWindow.DOMParser().parseFromString(html, "text/html");
    return (
      [...doc.querySelectorAll("img")]
        .map((image) => `![](${image.getAttribute("src")})`)
        .join("\n\n") +
      doc.body.textContent +
      "\n\n[paper](file:///Users/example/paper.pdf)"
    );
  });
  const result = await convertNoteToMarkdown(f.win, note);
  assert.ok(result);
  const markdown = await f.content(result.attachment);
  assert.match(markdown, /assets\/note-image-1\.png/);
  assert.match(markdown, /https:\/\/example\.test\/figure.png/);
  assert.match(markdown, /file:\/\/\/Users\/example\/paper.pdf/);
  assert.deepEqual(
    await readFile(
      join(
        dirname((await result.attachment.getFilePathAsync()) as string),
        "assets",
        "note-image-1.png",
      ),
    ),
    bytes,
  );
});

test("missing, foreign and unsupported images fail before creating any MD", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const note = f.makeNote(1, '<p><img data-attachment-key="IMAGE001"></p>');
  await assert.rejects(
    convertNoteToMarkdown(f.win, note),
    /note-convert-image-unavailable/,
  );
  const source = await f.addImage(note);
  source.image.parentItemID = 999;
  await assert.rejects(
    convertNoteToMarkdown(f.win, note),
    /note-convert-image-unavailable/,
  );
  source.image.parentItemID = note.id;
  source.image.attachmentContentType = "image/svg+xml";
  await assert.rejects(
    convertNoteToMarkdown(f.win, note),
    /PNG|error-image-format/,
  );
  source.image.attachmentContentType = "image/png";
  await rm(source.path);
  await assert.rejects(convertNoteToMarkdown(f.win, note), /unavailable/);
  assert.equal(f.imports.length, 0);
  assert.deepEqual(await readdir(f.temp), []);
  assert.equal(f.items.get(note.id), note);
});

test("changed source Note and reparented images are rejected after awaiting image IO", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const html = '<p><img data-attachment-key="IMAGE001"></p>';
  const note = f.makeNote(1, html);
  const source = await f.addImage(note);
  f.setAfterRead(() => {
    note.html = "<p>New content</p>";
  });
  await assert.rejects(
    convertNoteToMarkdown(f.win, note),
    /note-convert-changed/,
  );
  assert.equal(note.getNote(), "<p>New content</p>");
  note.html = html;
  f.setAfterRead(() => {
    source.image.parentItemID = 8;
  });
  await assert.rejects(
    convertNoteToMarkdown(f.win, note),
    /note-convert-changed/,
  );
  assert.equal(f.imports.length, 0);
});

test("unsupported HTML and malformed citations preserve visible content with a review warning", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const citation = encodeURIComponent(
    JSON.stringify({ citationItems: [{ uris: [] }] }),
  );
  const note = f.makeNote(
    1,
    `<p>H<sub>2</sub>O x<sup>2</sup><span class="citation" data-citation="${citation}">(Alice)</span></p><table><tr><th colspan="2">$&amp; $'</th></tr><tr><td>a</td><td>b</td></tr></table>`,
  );
  f.setTranslate((html) => {
    const doc = new f.domWindow.DOMParser().parseFromString(html, "text/html");
    assert.equal(doc.querySelector(".citation"), null);
    return doc.body.textContent || "";
  });
  const result = await convertNoteToMarkdown(f.win, note);
  assert.ok(result);
  assert.equal(result.hasWarnings, true);
  const markdown = await f.content(result.attachment);
  assert.match(markdown, /H<sub>2<\/sub>O x<sup>2<\/sup>\(Alice\)/);
  assert.match(markdown, /<th colspan="2">\$&amp; \$'<\/th>/);
  assert.doesNotMatch(markdown, /SCHOLARIMAGE|undefined/);
});

test("translator failure and cancelled requests preserve the source and clean staging", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const note = f.makeNote(1, "<p>Text</p>");
  f.setFailTranslation();
  await assert.rejects(
    convertNoteToMarkdown(f.win, note),
    /note-convert-translation-failed/,
  );
  f.setFailTranslation(false);
  let active = true;
  f.setTranslate(() => {
    active = false;
    return "Text";
  });
  assert.equal(
    await convertNoteToMarkdown(f.win, note, { shouldContinue: () => active }),
    null,
  );
  assert.equal(f.imports.length, 0);
  assert.equal(note.getNote(), "<p>Text</p>");
  assert.deepEqual(await readdir(f.temp), []);
});

test("cancellation or metadata failure after import removes only the new attachment and supports a clean retry", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const note = f.makeNote(1, "<p>Text</p>", { collections: [10] });
  f.setFailSave();
  await assert.rejects(
    convertNoteToMarkdown(f.win, note),
    /Metadata save failed/,
  );
  assert.deepEqual(f.erased, [101]);
  f.setFailSave(false);
  let active = true;
  f.setAfterImport(() => {
    active = false;
  });
  assert.equal(
    await convertNoteToMarkdown(f.win, note, { shouldContinue: () => active }),
    null,
  );
  assert.deepEqual(f.erased, [101, 102]);
  f.setAfterImport(undefined);
  const result = await convertNoteToMarkdown(f.win, note);
  assert.ok(result);
  assert.equal(f.items.get(note.id), note);
  assert.deepEqual(await readdir(f.storage), [String(result.attachment.id)]);
});

test("successful import is not reported as failed when temporary cleanup fails", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const note = f.makeNote(1, "<p>Text</p>");
  f.setAfterImport(() => {
    f.setFailRemove(f.staged[0]);
  });
  const result = await convertNoteToMarkdown(f.win, note);
  assert.ok(result);
  assert.equal(f.imports.length, 1);
  assert.equal(f.erased.length, 0);
  assert.ok(existsSync((await result.attachment.getFilePathAsync()) as string));
  assert.equal(f.logs.length, 1);
});

test("guards duplicate in-flight commands, clears the guard after failure and keeps batch successes", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const first = f.makeNote(1, "<p>One</p>");
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.setTranslate(async () => {
    await paused;
    return "One";
  });
  const pending = convertNoteToMarkdown(f.win, first);
  await assert.rejects(
    convertNoteToMarkdown(f.win, first),
    /note-convert-running/,
  );
  release();
  assert.ok(await pending);
  f.setTranslate(() => "Body");
  const invalid = f.makeNote(2, "<p>Two</p>");
  invalid.deleted = true;
  const third = f.makeNote(3, "<p>Three</p>");
  const result = await convertSelectedNotes(f.win, [invalid, third, third]);
  assert.equal(result.created.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].note, invalid);
  assert.equal(f.imports.length, 2);
});

test("read-only libraries and cross-library collections cannot receive conversions", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const note = f.makeNote(1, "<p>Text</p>", { collections: [20] });
  await assert.rejects(convertNoteToMarkdown(f.win, note), /collection/);
  f.library.filesEditable = false;
  assert.equal(canConvertNote(note), false);
  await assert.rejects(
    convertNoteToMarkdown(f.win, note),
    /note-convert-unavailable/,
  );
  assert.equal(f.imports.length, 0);
});

test("long CJK Note titles produce valid UTF-8 file names without truncating body content", async (t) => {
  const f = noteConversionFixture(t);
  await f.setup();
  const title = "长".repeat(120);
  const note = f.makeNote(1, `<p>${title}</p>`, { title });
  const result = await convertNoteToMarkdown(f.win, note);
  assert.ok(result);
  assert.ok(
    Buffer.byteLength(result.attachment.attachmentFilename, "utf8") <= 255,
  );
  assert.ok((await f.content(result.attachment)).includes(title));
});
