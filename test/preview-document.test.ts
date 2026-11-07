import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import {
  activePreviewOutlineID,
  applyAssetsToHtml,
  buildStandaloneDocument,
  documentTitle,
  previewOutlineAnchors,
  renderMarkdown,
} from "../src/modules/markdown/preview.ts";
import {
  documentTitleCore,
  parseHtmlTableBlocksCore,
  renderMarkdownCore,
} from "../src/modules/markdown/preview-render-core.ts";
import { parseInlineHtmlRanges } from "../src/modules/markdown/inline-html.ts";
import { parseHtmlTable } from "../src/modules/markdown/html-table.ts";

test("the worker-safe render core preserves preview behavior", () => {
  const source = "---\ntitle: Worker title\n---\n\n```ts\nconst n = 1;\n```";
  assert.equal(documentTitleCore(source), "Worker title");
  assert.equal(renderMarkdownCore(source), renderMarkdown(source));
  assert.match(renderMarkdownCore(source), /hljs-keyword/);
  assert.doesNotMatch(renderMarkdownCore("[x](javascript:alert(1))"), /<a /);
});

test("strips frontmatter and renders a read-only document body", () => {
  const html = renderMarkdown(
    "---\ntitle: Hello\n---\n\n# Hello\n\nA paragraph.",
  );
  assert.match(html, /<h1.*>Hello<\/h1>/);
  assert.match(html, /<p>A paragraph\.<\/p>/);
  assert.doesNotMatch(html, /title: Hello/);
});

test("picks the document title from frontmatter then H1", () => {
  assert.equal(
    documentTitle("---\ntitle: From YAML\n---\n\n# Heading"),
    "From YAML",
  );
  assert.equal(documentTitle("# Only heading"), "Only heading");
});

test("builds a standalone HTML document for export and print", () => {
  const doc = buildStandaloneDocument({
    source: "# Export me\n\nHello",
    assets: { "assets/a.png": { dataUrl: "data:image/png;base64,xx" } },
  });
  assert.equal(doc.title, "Export me");
  assert.match(doc.standaloneHtml, /<!DOCTYPE html>/);
  assert.match(doc.standaloneHtml, /<title>Export me<\/title>/);
  assert.match(doc.standaloneHtml, /class="zotero-markdown-preview-inner"/);
  assert.match(doc.bodyHtml, /Export me/);
});

test("rewrites local image sources to cached data URLs", () => {
  const html = applyAssetsToHtml('<p><img src="assets/a.png" alt="pic"></p>', {
    "assets/a.png": { dataUrl: "data:image/png;base64,abc" },
  });
  assert.match(html, /src="data:image\/png;base64,abc"/);
});

test("rejects unsafe link schemes, including obfuscated ones", () => {
  // Plain javascript:/data:/vbscript: stay blocked (markdown-it default).
  assert.doesNotMatch(renderMarkdown("[c](javascript:alert(1))"), /<a /);
  assert.doesNotMatch(renderMarkdown("[c](data:text/html,<x>)"), /<a /);
  assert.doesNotMatch(renderMarkdown("[c](vbscript:msgbox)"), /<a /);
  // Percent-encoded scheme obfuscation is now rejected too.
  assert.doesNotMatch(renderMarkdown("[c](%6aavascript:alert(1))"), /<a /);
  // http(s) / mailto links still render.
  assert.match(
    renderMarkdown("[c](https://example.com)"),
    /<a href="https:\/\/example\.com"/,
  );
  assert.match(
    renderMarkdown("[c](mailto:a@b.co)"),
    /<a href="mailto:a@b\.co"/,
  );
});

test("renders bounded raster data URLs only in Markdown image syntax", () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const image = renderMarkdown(`![tiny](${png})`);
  assert.match(image, /<img src="data:image\/png;base64,/);
  assert.match(image, /alt="tiny"/);
  assert.doesNotMatch(renderMarkdown(`[download](${png})`), /<a /);
  assert.doesNotMatch(
    renderMarkdown("![html](data:text/html;base64,PGh0bWw+)"),
    /<img /,
  );
  assert.doesNotMatch(
    renderMarkdown(
      "![svg](data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=)",
    ),
    /<img /,
  );
});

test("hardens rendered links and remote images", () => {
  const html = renderMarkdown(
    "[x](https://example.com) ![img](https://example.com/a.png)",
  );
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /referrerpolicy="no-referrer"/);
  // Local asset references survive for data-URL hydration.
  const local = renderMarkdown("![a](assets/a.png)");
  assert.match(local, /src="assets\/a\.png"/);
  assert.match(local, /referrerpolicy="no-referrer"/);
});

test("renders wiki links as inert, resolvable spans outside code", () => {
  const html = renderMarkdown(
    "[[Document|Alias]] `[[code]]`\n\n```\n[[fence]]\n```",
  );
  assert.match(html, /class="zmd-wikilink zmd-unresolved-link"/);
  assert.match(html, /data-zmd-wikilink="Document"/);
  assert.match(html, />Alias<\/span>/);
  assert.doesNotMatch(html, /data-zmd-wikilink="code"/);
  assert.doesNotMatch(html, /data-zmd-wikilink="fence"/);
});

test("renders only exact Zotero select links as anchors", () => {
  assert.match(
    renderMarkdown("[Document](zotero://select/library/items/AB12CD34)"),
    /<a href="zotero:\/\/select\/library\/items\/AB12CD34"/,
  );
  assert.doesNotMatch(
    renderMarkdown("[bad](zotero://select/library/items/AB12CD34/extra)"),
    /<a /,
  );
});

test("highlights supported fenced code in preview and export", () => {
  const source = "```js\nconst answer = 42;\n```";
  const html = renderMarkdown(source);
  assert.match(html, /class="language-js"/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /hljs-number/);
  assert.match(buildStandaloneDocument({ source }).bodyHtml, /hljs-keyword/);
});

test("falls back to escaped code for unknown languages", () => {
  const html = renderMarkdown("```brainfuck\n<x>& y\n```");
  assert.match(html, /&lt;x&gt;&amp; y/);
  assert.doesNotMatch(html, /hljs-/);
});

test("accepts aliases and ignores fence metadata", () => {
  const html = renderMarkdown('```TS title="demo"\nconst n: number = 1;\n```');
  assert.match(html, /hljs-keyword/);
  assert.doesNotMatch(html, /title=&quot;demo&quot;/);
});

test("exports semantic Highlight.js styles", () => {
  const doc = buildStandaloneDocument({
    source: "```js\nconst value = 'text';\n```",
    theme: "dark",
  });
  assert.match(doc.standaloneHtml, /--zmd-code-keyword: #c084fc/);
  assert.match(doc.standaloneHtml, /\.hljs-keyword/);
  assert.match(doc.standaloneHtml, /var\(--zmd-code-keyword\)/);
});

test("maps rendered headings to outline anchors by order", () => {
  const items = [
    { id: "h1:0", level: 1 as const, text: "One", from: 0 },
    { id: "h2:12", level: 2 as const, text: "Two", from: 12 },
  ];

  assert.deepEqual(previewOutlineAnchors(items, 3), ["h1:0", "h2:12", null]);
  assert.deepEqual(previewOutlineAnchors(items, 1), ["h1:0"]);
});

test("maps preview heading geometry to the top visible section", () => {
  const headings = [
    { id: "one", top: 40 },
    { id: "two", top: 140 },
    { id: "three", top: 240 },
  ];

  assert.equal(activePreviewOutlineID(headings, 0), "one");
  assert.equal(activePreviewOutlineID(headings, 139), "one");
  assert.equal(activePreviewOutlineID(headings, 140), "two");
  assert.equal(activePreviewOutlineID(headings, 999), "three");
  assert.equal(activePreviewOutlineID([], 0), null);
});

test("the shared surface tracks and cleans up preview scrolling", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/tab.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /bindPreviewOutlineTracking/);
  assert.match(source, /addEventListener\("scroll"/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /activePreviewOutlineID/);
  assert.match(source, /rect\.top \+ rect\.height \* 0\.5/);
  assert.match(source, /unbindPreviewOutline/);
  assert.match(source, /cancelAnimationFrame/);
});

test("sized image previews and exports share dimensions and embedded assets", () => {
  const source =
    '<img src="assets/a &amp; b.png" alt="A &quot;quote&quot;" width="480">';
  const result = buildStandaloneDocument({
    source,
    assets: { "assets/a & b.png": { dataUrl: "data:image/png;base64,abc" } },
  });
  assert.match(result.bodyHtml, /width="480"/);
  assert.match(result.bodyHtml, /src="data:image\/png;base64,abc"/);
  assert.match(result.bodyHtml, /alt="A &quot;quote&quot;"/);
  assert.match(result.standaloneHtml, /height: auto/);
});

test("only safe image attributes render while arbitrary HTML and code remain inert", () => {
  const html = renderMarkdown(
    '<img src="https://example.com/a.png" width="320" onerror="alert(1)" style="position:fixed" alt="safe">\n\n<script>alert(2)</script>\n\n`<img src="assets/code.png" width="100">`',
  );
  assert.match(
    html,
    /<img src="https:\/\/example.com\/a.png" alt="safe" width="320" referrerpolicy="no-referrer">/,
  );
  assert.doesNotMatch(html, /<img[^>]*(?:onerror|style)=/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src="assets\/code.png"/);
  for (const src of [
    "javascript:alert(1)",
    "jav&#97;script:alert(1)",
    "%6aavascript:alert(1)",
    "data:text/html,x",
    "file:///tmp/a.png",
  ]) {
    assert.doesNotMatch(
      renderMarkdown(`<img src="${src}" width="320">`),
      /<img /,
    );
  }
  assert.doesNotMatch(
    renderMarkdown('<img src="assets/a.png" width="-20">'),
    /width=/,
  );
});

test("renders paired inline HTML formatting with Markdown and table content", () => {
  const source = [
    "正文<SUP>9</SUP> H<sub>2</sub>O <u>underlined</u>",
    "",
    "<mark>**important** <kbd>Ctrl</kbd> <small>detail</small></mark><br/>next",
    "",
    "<b>bold</b> <strong>strong</strong> <i>italic</i> <em>emphasis</em> <s>old</s> <del>deleted</del> <code>key</code>",
    "",
    "| Formula | Meaning |",
    "| --- | --- |",
    "| H<sub>2</sub>O | x<sup>2</sup> |",
  ].join("\n");
  const { bodyHtml, standaloneHtml } = buildStandaloneDocument({ source });
  for (const html of [bodyHtml, standaloneHtml]) {
    assert.match(html, /正文<sup>9<\/sup> H<sub>2<\/sub>O <u>underlined<\/u>/);
    assert.match(
      html,
      /<mark><strong>important<\/strong> <kbd>Ctrl<\/kbd> <small>detail<\/small><\/mark><br>next/,
    );
    assert.match(html, /<td>H<sub>2<\/sub>O<\/td>/);
    assert.match(html, /<td>x<sup>2<\/sup><\/td>/);
    for (const tag of ["b", "strong", "i", "em", "s", "del", "code"]) {
      assert.match(html, new RegExp(`<${tag}>[^<]+<\\/${tag}>`));
    }
  }
});

test("inline HTML preserves code, escapes, unsupported tags and attributes as text", () => {
  const html = renderMarkdown(
    [
      "`<sup>9</sup>` \\<sub>2</sub>",
      "",
      "```html",
      "<sup>9</sup>",
      "```",
      "",
      '<sup onclick="alert(1)">9</sup> <mark style="color:red">text</mark>',
      "",
      "<script>alert(1)</script> <iframe>frame</iframe> <span>span</span>",
      "",
      "<sup>unclosed <sub>2</sup>",
    ].join("\n"),
  );
  assert.match(html, /<code>&lt;sup&gt;9&lt;\/sup&gt;<\/code>/);
  assert.match(html, /&lt;sub&gt;2&lt;\/sub&gt;/);
  assert.match(html, /&lt;sup onclick=[^\n]*?&gt;9&lt;\/sup&gt;/);
  assert.doesNotMatch(html, /<(?:sup|sub|mark|script|iframe)(?:\s|>)/);
  assert.match(html, /&lt;span&gt;span&lt;\/span&gt;/);
  assert.match(html, /&lt;sup&gt;unclosed &lt;sub&gt;2&lt;\/sup&gt;/);
});

test("inline HTML ranges retain source offsets and use Markdown code and escape rules", () => {
  const source =
    "前 <sup>`</sup>` <u>x</u>9</sup> <br> [<kbd>K</kbd>](https://example.com)";
  const ranges = parseInlineHtmlRanges(source);
  assert.deepEqual(
    ranges.map((range) => ({
      tag: range.tag,
      source: source.slice(range.from, range.to),
      content: source.slice(range.openTo, range.closeFrom),
    })),
    [
      {
        tag: "sup",
        source: "<sup>`</sup>` <u>x</u>9</sup>",
        content: "`</sup>` <u>x</u>9",
      },
      { tag: "u", source: "<u>x</u>", content: "x" },
      { tag: "br", source: "<br>", content: "" },
      { tag: "kbd", source: "<kbd>K</kbd>", content: "K" },
    ],
  );
  assert.match(
    renderMarkdown(source),
    /<sup><code>&lt;\/sup&gt;<\/code> <u>x<\/u>9<\/sup>/,
  );
  for (const inert of [
    "`<sup>9</sup>`",
    "\\<sup>9</sup>",
    "<sup>9\\</sup>",
    '<sup style="color:red">9</sup>',
    "![<sup>9</sup>](assets/a.png)",
    "[text](https://example.com/<sup>9</sup>)",
    "<sup>unclosed",
  ]) {
    assert.deepEqual(parseInlineHtmlRanges(inert), [], inert);
  }
});

test("renders the imported five-by-five HTML table with a formula in every cell", (t) => {
  const source =
    "<table>" +
    Array.from(
      { length: 5 },
      (_, row) =>
        "<tr>" +
        Array.from(
          { length: 5 },
          (_, column) =>
            `<td> $${row === column ? `g_${row + 1}` : `(g_${row + 1}, g_${column + 1})`}$ </td>`,
        ).join("") +
        "</tr>",
    ).join("") +
    "</table>";
  const document = buildStandaloneDocument({ source });
  const win = new Window();
  t.after(() => win.close());
  win.document.body.innerHTML = document.bodyHtml;
  const table = win.document.querySelector("table");
  assert.ok(table);
  assert.equal(table.querySelectorAll("tr").length, 5);
  assert.equal(table.querySelectorAll("td").length, 25);
  assert.equal(table.querySelectorAll("math").length, 25);
  assert.doesNotMatch(document.bodyHtml, /<p>\s*<table>/);
  assert.match(table.querySelector("annotation")?.textContent || "", /g_1/);
  assert.match(document.standaloneHtml, /<table>/);
});

test("HTML tables retain sections, spans, inline formatting and surrounding content", (t) => {
  const source = [
    "Before",
    '<table class="imported">',
    "<caption><b>Results</b></caption>",
    '<thead><tr><th colspan="2">$x^2$</th></tr></thead>',
    "",
    "<tbody>",
    "<tr><td rowspan='2'><mark>important</mark></td><td>**bold** H<sub>2</sub>O</td></tr>",
    "<tr><td><code>&lt;/td&gt;</code> $\\text{cell}$</td></tr>",
    "</tbody>",
    "<tfoot><tr><td colspan=2>Summary</td></tr></tfoot>",
    "</table>",
    "After",
  ].join("\r\n");
  const win = new Window();
  t.after(() => win.close());
  win.document.body.innerHTML = renderMarkdown(source);
  const table = win.document.querySelector("table");
  assert.ok(table);
  assert.equal(table.querySelector("caption b")?.textContent, "Results");
  assert.equal(table.querySelector("thead th")?.getAttribute("colspan"), "2");
  assert.equal(table.querySelector("tbody td")?.getAttribute("rowspan"), "2");
  assert.ok(table.querySelector("thead th math"));
  assert.equal(table.querySelector("mark")?.textContent, "important");
  assert.equal(table.querySelector("strong")?.textContent, "bold");
  assert.equal(table.querySelector("sub")?.textContent, "2");
  assert.equal(table.querySelector("code")?.textContent, "</td>");
  assert.equal(table.querySelectorAll("tbody td").length, 3);
  assert.equal(table.querySelector("tfoot td")?.textContent, "Summary");
  assert.equal(table.hasAttribute("class"), false);
  assert.match(win.document.body.textContent, /Before[\s\S]*After/);
});

test("HTML table rendering keeps unsafe content inert and incomplete or code tables literal", (t) => {
  const complete =
    '<table onclick="alert(1)"><tr><td colspan="2" style="display:none" onmouseover="alert(1)"><script>alert(1)</script>[bad](javascript:alert(1))</td></tr></table>';
  const win = new Window();
  t.after(() => win.close());
  win.document.body.innerHTML = renderMarkdown(complete);
  assert.equal(win.document.querySelectorAll("table td").length, 1);
  assert.equal(
    win.document.querySelector("[onclick], [onmouseover], [style], script, a"),
    null,
  );
  assert.match(
    win.document.querySelector("td")?.textContent || "",
    /<script>alert\(1\)<\/script>/,
  );
  const simple = "<table><tr><td>$x$</td></tr></table>";
  for (const source of [
    `\`${simple}\``,
    `\`\`\`html\n${simple}\n\`\`\``,
    `    ${simple}`,
    `\\${simple}`,
    "<table><tr><td>$x$</td></tr>",
    "<table><tr><td>$x$</tr></table>",
    "<table-widget><tr><td>$x$</td></tr></table-widget>",
  ]) {
    assert.doesNotMatch(renderMarkdown(source), /<table>/, source);
  }
});

test("HTML table blocks preserve adjacent tables, trailing text and original source offsets", (t) => {
  const simple = "<table><tr><td>$x$</td></tr></table>";
  const win = new Window();
  t.after(() => win.close());
  win.document.body.innerHTML = renderMarkdown(
    `${simple}${simple} Tail\nAfter`,
  );
  assert.equal(win.document.querySelectorAll("table").length, 2);
  assert.equal(
    parseHtmlTableBlocksCore(`${simple}${simple} Tail\nAfter`).length,
    2,
  );
  assert.match(win.document.body.textContent, /Tail[\s\S]*After/);
  const source =
    "Before\r\n<table>\r\n<tr><td>x</td></tr>\r\n</table>\r\nAfter";
  const table = parseHtmlTable(source, source.indexOf("<table>"));
  assert.ok(table);
  const cell = table.rows[0].cells[0];
  assert.equal(source.slice(cell.contentFrom, cell.contentTo), "x");
  assert.equal(
    source.slice(table.from, table.to),
    "<table>\r\n<tr><td>x</td></tr>\r\n</table>",
  );
});

test("HTML table captions and cells render multiline display formulas with the shared math parser", (t) => {
  const source = [
    "<table>",
    "<caption>Matrix $A$</caption>",
    "<tr><td>",
    "$$",
    String.raw`\frac{1}{2}`,
    "$$",
    "</td><td>Ordinary **text**</td></tr>",
    "</table>",
  ].join("\n");
  const win = new Window();
  t.after(() => win.close());
  win.document.body.innerHTML = renderMarkdown(source);
  assert.ok(win.document.querySelector("caption math"));
  assert.ok(win.document.querySelector('td math[display="block"] mfrac'));
  assert.equal(
    win.document.querySelector("td + td strong")?.textContent,
    "text",
  );
  assert.equal(win.document.querySelector("td + td p"), null);
});

test("HTML cell boundaries isolate unclosed Markdown code and math delimiters", (t) => {
  const win = new Window();
  t.after(() => win.close());
  for (const [left, right] of [
    ["`open", "close`"],
    ["$a", "b$"],
  ]) {
    const source = `<table><tr><td>${left}</td><td>${right}</td></tr></table>`;
    const table = parseHtmlTable(source);
    assert.ok(table);
    assert.equal(table.rows[0].cells.length, 2);
    win.document.body.innerHTML = renderMarkdown(source);
    const cells = win.document.querySelectorAll("table td");
    assert.equal(cells.length, 2);
    assert.equal(cells[0].textContent, left);
    assert.equal(cells[1].textContent, right);
  }
});

test("HTML comments keep enclosed table source and the closing line suffix visible", (t) => {
  const table = "<table><tr><td>$x$</td></tr></table>";
  const win = new Window();
  t.after(() => win.close());
  for (const source of [
    `<!--\n${table}\n--> ${table} Tail`,
    `<!--\n${table}`,
  ]) {
    win.document.body.innerHTML = renderMarkdown(source);
    assert.equal(win.document.querySelector("table"), null);
    assert.ok(win.document.body.textContent?.includes(table));
    assert.deepEqual(parseHtmlTableBlocksCore(source), []);
  }
  win.document.body.innerHTML = renderMarkdown(
    `<!--\n${table}\n--> ${table} Tail`,
  );
  assert.match(win.document.body.textContent || "", /--> <table>[\s\S]*Tail/);
});
