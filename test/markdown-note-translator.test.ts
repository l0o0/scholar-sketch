import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { createContext, runInContext } from "node:vm";
import { convertNoteToMarkdown } from "../src/modules/markdown/convert-note.ts";
import { noteConversionFixture } from "./helpers/note-conversion.ts";

const translatorPath = process.env.ZOTERO_NOTE_MARKDOWN_TRANSLATOR;
const nativeTranslatorOptions = {
  skip: translatorPath
    ? false
    : "Set ZOTERO_NOTE_MARKDOWN_TRANSLATOR to an installed official Note Markdown.js to run native translator integration",
};

async function nativeFixture(t: TestContext) {
  assert.ok(translatorPath);
  const source = await readFile(translatorPath, "utf8");
  const header = /^\{[\s\S]*?\n\}/.exec(source)?.[0];
  assert.ok(header, "the official translator must include its metadata header");
  const metadata = JSON.parse(header);
  assert.equal(metadata.translatorID, "1412e9e2-51e1-42ec-aa35-e036a895534b");
  const script = source.slice(header.length);
  const fixture = noteConversionFixture(t);
  await fixture.setup();
  // The production converter and importer run unchanged. Only Zotero's
  // translator sandbox is replaced; its installed conversion code runs here.
  fixture.setTranslate((html) => {
    let nextItem: { itemType: string; note: string } | undefined = {
      itemType: "note",
      note: html,
    };
    let output = "";
    const context = createContext({
      window: fixture.domWindow,
      document: fixture.domWindow.document,
      DOMParser: fixture.domWindow.DOMParser,
      Zotero: {
        getOption: (name: string) => {
          assert.equal(name, "includeAppLinks");
          return true;
        },
        setCharacterSet: (charset: string) => assert.equal(charset, "utf-8"),
        nextItem: () => {
          const item = nextItem;
          nextItem = undefined;
          return item;
        },
        write: (content: string) => {
          output += content;
        },
      },
    });
    runInContext(script, context, { filename: translatorPath });
    runInContext("doExport()", context);
    return output;
  });
  return fixture;
}

const encoded = (value: unknown) => encodeURIComponent(JSON.stringify(value));
const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yRZsAAAAASUVORK5CYII=",
  "base64",
);

test(
  "native Note Markdown conversion preserves structure, formulas, citations and collections",
  nativeTranslatorOptions,
  async (t) => {
    const f = await nativeFixture(t);
    const citation = {
      citationItems: [
        { uris: ["http://zotero.org/users/123/items/ABCD2345"] },
        { uris: ["http://zotero.org/groups/42/items/EFGH6789"] },
      ],
      properties: {},
    };
    const html = `<div data-schema-version="10">
<h1>Research note</h1>
<p><strong>Bold</strong> and <em>italic</em></p>
<ul><li>First</li><li>Second</li></ul>
<blockquote><p>Quoted paragraph</p></blockquote>
<pre>const x = 1;</pre>
<p>Result: <span class="math">$a_i^2 \\times x$</span></p>
<pre class="math">$$\\sum_{i=1}^{n} a_i^2$$</pre>
<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>
<p><span class="citation" data-citation="${encoded(citation)}">(<span class="citation-item">Alice, 2020</span>; <span class="citation-item">Bob, 2021</span>)</span></p>
</div>`;
    const note = f.makeNote(1, html, { collections: [11, 10] });
    const result = await convertNoteToMarkdown(f.win, note);
    assert.ok(result);
    const markdown = await f.content(result.attachment);
    for (const expected of [
      "# Research note",
      "**Bold** and *italic*",
      "- First\n- Second",
      "> Quoted paragraph",
      "```\nconst x = 1;\n```",
      "$a_i^2 \\times x$",
      "$$\\sum_{i=1}^{n} a_i^2$$",
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
      "[Alice, 2020](zotero://select/library/items/ABCD2345)",
      "[Bob, 2021](zotero://select/groups/42/items/EFGH6789)",
    ]) {
      assert.ok(markdown.includes(expected), `missing ${expected}`);
    }
    assert.equal(result.hasWarnings, false);
    assert.equal(note.getNote(), html);
    assert.deepEqual(note.getCollections(), [11, 10]);
    assert.deepEqual(f.items.get(result.attachment.id).collections, [10, 11]);
    assert.equal(f.imports.length, 1);
    assert.doesNotMatch(markdown, /SCHOLARIMAGE/);
  },
);

test(
  "native conversion keeps PDF and webpage annotation links and packages embedded images",
  nativeTranslatorOptions,
  async (t) => {
    const f = await nativeFixture(t);
    const pdf = {
      attachmentURI: "http://zotero.org/users/local/LOCAL/items/PDFKEY12",
      annotationKey: "ANNOTATE",
      position: { pageIndex: 1 },
    };
    const snapshot = {
      ...pdf,
      position: { type: "CssSelector", value: "body > p:nth-child(2)" },
    };
    const html = `<div data-schema-version="10"><p><span class="highlight" data-annotation="${encoded(pdf)}">Quoted passage</span></p><p><span class="underline" data-annotation="${encoded(snapshot)}">Website passage</span></p><p><img data-attachment-key="IMAGE001" data-annotation="${encoded(pdf)}" alt="Annotated diagram"></p></div>`;
    const note = f.makeNote(1, html);
    const image = await f.addImage(note, "IMAGE001", imageBytes);
    const result = await convertNoteToMarkdown(f.win, note);
    assert.ok(result);
    const markdown = await f.content(result.attachment);
    assert.match(
      markdown,
      /Quoted passage \(\[pdf\]\(zotero:\/\/open-pdf\/library\/items\/PDFKEY12\?page=2&annotation=ANNOTATE\)\)/,
    );
    assert.ok(
      markdown.includes(
        "[snapshot](zotero://open-pdf/library/items/PDFKEY12?sel=body%20%3E%20p%3Anth-child(2)&annotation=ANNOTATE)",
      ),
    );
    assert.ok(
      markdown.includes(
        "![Annotated diagram](assets/note-image-1.png) ([pdf](zotero://open-pdf/library/items/PDFKEY12?page=2&annotation=ANNOTATE))",
      ),
    );
    const file = await result.attachment.getFilePathAsync();
    assert.ok(file);
    assert.deepEqual(
      await readFile(join(dirname(file), "assets", "note-image-1.png")),
      image.bytes,
    );
    assert.deepEqual(await readFile(image.path), image.bytes);
    assert.equal(note.getNote(), html);
    assert.equal(result.hasWarnings, false);
    assert.doesNotMatch(markdown, /\[image\]|SCHOLARIMAGE/);
  },
);

test(
  "native conversion imports an image-only Note instead of silently producing an empty file",
  nativeTranslatorOptions,
  async (t) => {
    const f = await nativeFixture(t);
    const html =
      '<div data-schema-version="9"><p><img data-attachment-key="IMAGE001"></p></div>';
    const note = f.makeNote(1, html);
    const image = await f.addImage(note, "IMAGE001", imageBytes);
    const result = await convertNoteToMarkdown(f.win, note);
    assert.ok(result);
    assert.equal(
      (await f.content(result.attachment)).trim(),
      "![](assets/note-image-1.png)",
    );
    const file = await result.attachment.getFilePathAsync();
    assert.ok(file);
    assert.deepEqual(
      await readFile(join(dirname(file), "assets", "note-image-1.png")),
      image.bytes,
    );
    assert.equal(note.getNote(), html);
    assert.equal(result.hasWarnings, false);
  },
);

test(
  "native conversion preserves unsupported scientific markup and reports reduced fidelity",
  nativeTranslatorOptions,
  async (t) => {
    const f = await nativeFixture(t);
    const invalidCitation = { citationItems: [{ uris: [] }], properties: {} };
    const table =
      '<table><tbody><tr><th colspan="2">Both</th></tr><tr><td>$&amp;</td><td>$\' $`</td></tr></tbody></table>';
    const html = `<div data-schema-version="9"><p>H<sub>2</sub>O x<sup>2</sup></p>${table}<p><span class="citation" data-citation="${encoded(invalidCitation)}">(<span class="citation-item">Alice, 2020</span>)</span></p></div>`;
    const note = f.makeNote(1, html);
    const result = await convertNoteToMarkdown(f.win, note);
    assert.ok(result);
    const markdown = await f.content(result.attachment);
    assert.ok(markdown.includes("H<sub>2</sub>O x<sup>2</sup>"));
    assert.ok(markdown.includes(table));
    assert.ok(markdown.includes("(Alice, 2020)"));
    assert.doesNotMatch(markdown, /\]\(undefined\)|SCHOLARIMAGE/);
    assert.equal(result.hasWarnings, true);
    assert.equal(note.getNote(), html);
  },
);

test(
  "native conversion does not apply Markdown escaping inside scientific formulas",
  nativeTranslatorOptions,
  async (t) => {
    const f = await nativeFixture(t);
    const inline = "$a * b$";
    const display =
      "$$\n\\begin{aligned}\na * b &= c\\\\\nd &= e\n\\end{aligned}\n$$";
    const html = `<div data-schema-version="9"><p>Result: <span class="math">${inline}</span></p><pre class="math">${display.replaceAll("&", "&amp;")}</pre></div>`;
    const note = f.makeNote(1, html);
    const result = await convertNoteToMarkdown(f.win, note);
    assert.ok(result);
    const markdown = await f.content(result.attachment);
    assert.ok(markdown.includes(inline));
    assert.ok(markdown.includes(display));
    assert.doesNotMatch(markdown, /\\\*/);
    assert.equal(result.hasWarnings, false);
    assert.equal(note.getNote(), html);
  },
);

test(
  "native conversion supports legacy citation HTML and direct checkbox tasks",
  nativeTranslatorOptions,
  async (t) => {
    const f = await nativeFixture(t);
    const citation = {
      citationItems: [
        { uris: ["http://zotero.org/users/local/LOCAL/items/ABCD2345"] },
      ],
      properties: {},
    };
    const html = `<div class="zotero-note znv1"><p><span class="citation" data-citation="${encoded(citation)}">(Legacy Author, 2005, p. 14)</span></p><ul><li><input type="checkbox" checked>Done</li><li><input type="checkbox">Todo</li></ul></div>`;
    const note = f.makeNote(1, html);
    const result = await convertNoteToMarkdown(f.win, note);
    assert.ok(result);
    const markdown = await f.content(result.attachment);
    assert.ok(
      markdown.includes(
        "([Legacy Author, 2005, p. 14](zotero://select/library/items/ABCD2345))",
      ),
    );
    assert.ok(markdown.includes("- [x] Done\n- [ ] Todo"));
    assert.equal(result.hasWarnings, false);
    assert.equal(note.getNote(), html);
  },
);
