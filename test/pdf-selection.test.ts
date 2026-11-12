import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { pdfSelectionTransferMarkdown } from "../src/modules/pdf-selection.ts";
import { parsePdfTextPosition } from "../src/utils/pdf-position.ts";
import {
  isPdfDocumentLink,
  parsePdfDocumentLink,
} from "../src/modules/markdown/document-link-shared.ts";
import { openDocumentLink } from "../src/modules/markdown/document-links.ts";
import { renderMarkdownCore } from "../src/modules/markdown/preview-render-core.ts";

const position = {
  pageIndex: 2,
  rects: [
    [20, 30, 140, 45],
    [20, 10, 90, 25],
  ],
  nextPageRects: [[20, 700, 160, 715]],
};

function fixture(t: TestContext, group = false) {
  const globals = globalThis as any;
  const previous = { Zotero: globals.Zotero, addon: globals.addon };
  const window = new Window();
  t.after(async () => {
    Object.assign(globals, previous);
    await window.happyDOM.close();
  });
  const libraryID = group ? 7 : 1;
  const attachment = {
    id: 42,
    key: "PDFKEY01",
    libraryID,
    attachmentContentType: "application/pdf",
    deleted: false,
    isAttachment: () => true,
    parentItem: { getField: () => "Research [paper]" },
    getField: () => "paper.pdf",
  };
  const annotation = {
    key: "ANNOT001",
    parentID: 42,
    deleted: false,
    isAnnotation: () => true,
    annotationText: "Saved annotation text",
    annotationPosition: JSON.stringify(position),
    annotationPageLabel: "153",
  };
  const opens: unknown[][] = [];
  globals.Zotero = {
    Libraries: {
      userLibraryID: 1,
      get: () => ({ libraryType: group ? "group" : "user" }),
    },
    Groups: {
      get: (id: number) => (id === 99 ? { libraryID: 7 } : undefined),
      getGroupIDFromLibraryID: () => 99,
    },
    Items: {
      get: (id: number) => (id === 42 ? attachment : undefined),
      getByLibraryAndKey: (id: number, key: string) =>
        id !== libraryID
          ? undefined
          : key === attachment.key
            ? attachment
            : key === annotation.key
              ? annotation
              : undefined,
    },
    URI: {
      getURIItemLibraryKey: (uri: string) =>
        uri.endsWith(`/items/${attachment.key}`)
          ? { libraryID, key: attachment.key }
          : false,
    },
    Reader: {
      open: async (...args: unknown[]) => {
        opens.push(args);
      },
    },
    launchURL: () => {
      throw new Error("PDF location must stay in this process");
    },
  };
  globals.addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ args }]: any[]) => [
            {
              value: `${args.title}, p. ${args.page}`,
            },
          ],
        },
      },
    },
  };
  const transfer = (type: string, value: string) => ({
    types: [type],
    getData: (requested: string) => (requested === type ? value : ""),
  });
  const native = (override = {}) =>
    transfer(
      "zotero/annotation",
      JSON.stringify([
        {
          attachmentItemID: 42,
          text: "A *literal* passage.\nSecond line [text] $value$",
          type: "highlight",
          position,
          pageLabel: "153",
          ...override,
        },
      ]),
    );
  return {
    document: window.document as unknown as Document,
    native,
    transfer,
    attachment,
    annotation,
    opens,
  };
}

function sourceLink(markdown: string): string {
  const href = markdown.match(/\]\((zotero:\/\/open-pdf\/[^)]+)\)/)?.[1];
  assert.ok(href, markdown);
  return href;
}

test("a Reader text selection retains its exact rectangles in rendered Markdown and navigation", async (t) => {
  const { document, native, opens } = fixture(t);
  const markdown = pdfSelectionTransferMarkdown(native(), document)!;
  assert.ok(markdown);
  assert.match(markdown, /^> A \\\*literal\\\* passage\\\./);
  const href = sourceLink(markdown);
  assert.deepEqual(parsePdfDocumentLink(href)?.position, position);
  const html = renderMarkdownCore(markdown);
  assert.match(html, /<blockquote>/);
  assert.match(html, /A \*literal\* passage\./);
  assert.equal(html.includes("<em>literal</em>"), false);
  assert.match(html, /Research \[paper\], p\. 153/);
  assert.deepEqual(await openDocumentLink(href), { status: "dispatched" });
  assert.deepEqual(opens, [[42, { pageIndex: 2, position }]]);
});

test("native note HTML without an annotation key retains the citation and selection region", (t) => {
  const { document, transfer } = fixture(t);
  const data = encodeURIComponent(
    JSON.stringify({
      attachmentURI: "http://zotero.org/users/123/items/PDFKEY01",
      pageLabel: "153",
      position,
    }),
  );
  const html = `<p><span class="highlight" data-annotation="${data}">Quoted &amp; linked text</span> <span class="citation"><span class="citation-item">Author, 2023, p. 153</span></span></p>`;
  const markdown = pdfSelectionTransferMarkdown(
    transfer("text/html", html),
    document,
  )!;
  assert.match(markdown, /^> Quoted & linked text/);
  assert.match(renderMarkdownCore(markdown), /Author, 2023, p\. 153/);
  assert.deepEqual(
    parsePdfDocumentLink(sourceLink(markdown))?.position,
    position,
  );
  assert.equal(
    pdfSelectionTransferMarkdown(
      transfer("text/html", `<p>Before text</p>${html}<p>After text</p>`),
      document,
    ),
    null,
    "mixed native Note selections keep all prose through the ordinary paste path",
  );
  for (const image of [
    '<img src="data:image/png;base64,aGVsbG8=">',
    `<img data-annotation="${data}" src="data:image/png;base64,aGVsbG8=">`,
  ])
    assert.equal(
      pdfSelectionTransferMarkdown(
        transfer("text/html", html + image),
        document,
      ),
      null,
      "mixed image transfers retain their existing paste behavior",
    );
});

test("group selections persist portable group keys and reopen the same library", async (t) => {
  const { document, native, opens } = fixture(t, true);
  const markdown = pdfSelectionTransferMarkdown(native(), document)!;
  const href = sourceLink(markdown);
  assert.match(href, /^zotero:\/\/open-pdf\/groups\/99\/items\/PDFKEY01\?/);
  assert.deepEqual(await openDocumentLink(href), { status: "dispatched" });
  assert.equal(opens.length, 1);
});

test("saved annotation copies use native text and keep their annotation identity", (t) => {
  const { document, native, annotation } = fixture(t);
  const markdown = pdfSelectionTransferMarkdown(
    native({ id: annotation.key, text: "stale clipboard text" }),
    document,
  )!;
  assert.match(markdown, /^> Saved annotation text/);
  assert.equal(
    sourceLink(markdown),
    "zotero://open-pdf/library/items/PDFKEY01?page=3&annotation=ANNOT001",
  );
});

test("ordinary and malformed transfers retain the native text path without partial import", (t) => {
  const { document, transfer, native, attachment, annotation } = fixture(t);
  for (const input of [
    transfer("text/plain", "ordinary text"),
    transfer("text/html", "<p>ordinary text</p>"),
    transfer("zotero/annotation", "{broken"),
    native({ position: { pageIndex: 2 } }),
    native({ attachmentItemID: 999 }),
    native({ id: "BADKEY" }),
    transfer(
      "zotero/annotation",
      JSON.stringify([
        { attachmentItemID: 42, text: "good", position },
        { attachmentItemID: 999, text: "bad", position },
      ]),
    ),
    transfer("text/html", '<span data-annotation="%ZZ">bad</span>'),
  ])
    assert.equal(pdfSelectionTransferMarkdown(input, document), null);
  attachment.deleted = true;
  assert.equal(pdfSelectionTransferMarkdown(native(), document), null);
  attachment.deleted = false;
  annotation.parentID = 999;
  assert.equal(
    pdfSelectionTransferMarkdown(native({ id: annotation.key }), document),
    null,
  );
});

test("PDF selection URL validation rejects malformed locations and extra commands", () => {
  const base = "zotero://open-pdf/library/items/PDFKEY01?page=3&position=";
  assert.deepEqual(parsePdfTextPosition(position), position);
  for (const invalid of [
    { ...position, pageIndex: -1 },
    { ...position, rects: [] },
    { ...position, rects: [[0, 0, Infinity, 2]] },
    { ...position, rects: [[2, 0, 1, 2]] },
    { ...position, nextPageRects: ["invalid"] },
  ])
    assert.equal(parsePdfTextPosition(invalid), null);
  for (const href of [
    `${base}%ZZ`,
    `${base}${encodeURIComponent("{bad")}`,
    `${base}${encodeURIComponent(JSON.stringify({ pageIndex: 2 }))}`,
    `${base}${encodeURIComponent(JSON.stringify(position))}&evil=1`,
    `${base}${encodeURIComponent(JSON.stringify({ ...position, pageIndex: 4 }))}`,
  ])
    assert.equal(isPdfDocumentLink(href), false, href);
});

test("a missing source or Reader failure reports failure and preserves the full location", async (t) => {
  const { document, native, attachment, opens } = fixture(t);
  const href = sourceLink(pdfSelectionTransferMarkdown(native(), document)!);
  attachment.deleted = true;
  assert.deepEqual(await openDocumentLink(href), { status: "unresolved" });
  assert.equal(opens.length, 0);
  attachment.deleted = false;
  (globalThis as any).Zotero.Reader.open = async () => {
    throw new Error("Reader failed");
  };
  assert.deepEqual(await openDocumentLink(href), { status: "unsupported" });
});
