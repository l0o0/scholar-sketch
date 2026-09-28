import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
  renderMarkdownCore,
} from "../src/modules/markdown/preview-render-core.ts";

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
