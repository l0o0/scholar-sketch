import assert from "node:assert/strict";
import test from "node:test";
import { annotationInsertFragment } from "../src/modules/markdown/annotation-insert-fragment.ts";
import type { MarkdownAnnotation } from "../src/modules/markdown/annotations.ts";
import { parsePdfDocumentLink } from "../src/modules/markdown/document-link-shared.ts";

const entry = (changes: Partial<MarkdownAnnotation>): MarkdownAnnotation => ({
  key: "ANNO0001",
  attachmentKey: "PDF00001",
  attachmentTitle: "Full text",
  sourceKey: "PAPER001",
  sourceTitle: "Paper A",
  pageLabel: "1",
  page: 1,
  sortIndex: "00001|000001",
  text: "First passage",
  comment: "",
  ...changes,
});

test("mixed selections group by source and PDF reading order, retain links, and deduplicate", () => {
  const b = entry({
    key: "ANNO0003",
    attachmentKey: "PDF00002",
    sourceKey: "PAPER002",
    sourceTitle: "Paper B",
    text: "Other source",
  });
  const a2 = entry({
    key: "ANNO0002",
    pageLabel: "2",
    page: 2,
    sortIndex: "00002|000001",
    text: "Second passage",
  });
  const a1 = entry({});
  const supplement = entry({
    key: "ANNO0004",
    attachmentKey: "PDF00003",
    attachmentTitle: "Supplement",
    pageLabel: "S1",
    text: "Supplemental passage",
  });
  const markdown = annotationInsertFragment([b, a2, a1, supplement, a1]);
  assert.ok(markdown.startsWith("### Paper B\n\n> Other source"));
  assert.ok(markdown.indexOf("### Paper A") > markdown.indexOf("### Paper B"));
  assert.ok(
    markdown.indexOf("> First passage") < markdown.indexOf("> Second passage"),
  );
  assert.ok(markdown.includes("#### Full text"));
  assert.ok(markdown.includes("#### Supplement"));
  assert.equal(markdown.split("> First passage").length - 1, 1);
  const links = [
    ...markdown.matchAll(/\]\((zotero:\/\/open-pdf\/[^)]+)\)/g),
  ].map((match) => parsePdfDocumentLink(match[1]));
  assert.equal(links.length, 4);
  assert.ok(links.every(Boolean));
  assert.deepEqual(
    links.map((link) => link!.reference.key),
    ["PDF00002", "PDF00001", "PDF00001", "PDF00003"],
  );
});

test("single-source insertion keeps the existing fragment while mixed headings escape source titles", () => {
  assert.equal(
    annotationInsertFragment([entry({})]),
    "> First passage\n\n[1](zotero://open-pdf/library/items/PDF00001?page=1&annotation=ANNO0001)\n",
  );
  const markdown = annotationInsertFragment([
    entry({ sourceTitle: "Paper [A]\n# Heading", groupID: 42 }),
    entry({
      key: "ANNO0002",
      sourceKey: "PAPER002",
      attachmentKey: "PDF00002",
      sourceTitle: "Paper B",
      groupID: 42,
    }),
  ]);
  assert.ok(markdown.includes("### Paper \\[A\\] \\# Heading\n"));
  const links = [
    ...markdown.matchAll(/\]\((zotero:\/\/open-pdf\/[^)]+)\)/g),
  ].map((match) => parsePdfDocumentLink(match[1]));
  assert.ok(
    links.every(
      (link) =>
        link?.reference.scope === "group" && link.reference.groupID === 42,
    ),
  );
});
