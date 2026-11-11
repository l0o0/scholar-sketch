import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { editorThemeExtension } from "../src/editor/theme.ts";
import { THEME_TOKENS } from "../src/modules/markdown/theme-tokens.ts";
import { compileMarkdownStyleCss } from "../src/modules/markdown/style-css.ts";
import { GFM } from "@lezer/markdown";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  applyPreviewStyle,
  buildStandaloneDocument,
  previewDocumentCss,
  renderMarkdown,
} from "../src/modules/markdown/preview.ts";
import {
  cloneMarkdownStyle,
  DEFAULT_MARKDOWN_STYLE,
} from "../src/modules/markdown/style-presets.ts";

const source =
  "# A heading\n\nA paragraph with [a link](https://example.org).\n\n> A quote\n\n```js\nconst a = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |";

test("preview presets update the existing article without styling surrounding controls", async (t) => {
  const browser = new Window();
  t.after(() => browser.happyDOM.close());
  browser.document.head.innerHTML = `<style>${previewDocumentCss()}</style>`;
  browser.document.body.innerHTML = `<button>Outside</button><section><div class="zotero-markdown-preview-page"><article class="zotero-markdown-preview-inner">${renderMarkdown(source)}</article></div></section>`;
  const host = browser.document.querySelector("section")!;
  const article = host.querySelector("article")!;
  const heading = article.querySelector("h1")!;
  const button = browser.document.querySelector("button")!;
  const buttonColor = browser.getComputedStyle(button).color;
  const style = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
  style.fontSize = 20;
  style.contentWidth = 620;
  style.lineHeight = 2;
  style.headings[0].size = 2.2;
  style.dark.heading = "#aabbcc";
  style.dark.link = "#bbeeaa";
  style.dark.quoteBackground = "#222222";
  style.dark.codeBackground = "#242424";
  style.dark.tableHeader = "#252525";
  applyPreviewStyle(host as unknown as HTMLElement, style, "dark");
  assert.equal(browser.getComputedStyle(article).fontSize, "20px");
  assert.equal(browser.getComputedStyle(article).maxWidth, "620px");
  assert.equal(browser.getComputedStyle(article).lineHeight, "2");
  assert.equal(browser.getComputedStyle(heading).fontSize, "44px");
  assert.equal(browser.getComputedStyle(heading).color, "#aabbcc");
  assert.equal(
    browser.getComputedStyle(article.querySelector("a")!).color,
    "#bbeeaa",
  );
  assert.equal(
    browser.getComputedStyle(article.querySelector("blockquote")!)
      .backgroundColor,
    "#222222",
  );
  assert.equal(
    browser.getComputedStyle(article.querySelector("pre")!).backgroundColor,
    "#242424",
  );
  assert.equal(
    browser.getComputedStyle(article.querySelector("th")!).backgroundColor,
    "#252525",
  );
  applyPreviewStyle(host as unknown as HTMLElement, style, "light");
  assert.equal(host.querySelector("article"), article);
  assert.equal(article.querySelector("h1"), heading);
  assert.equal(browser.getComputedStyle(heading).color, style.light.heading);
  assert.equal(browser.getComputedStyle(button).color, buttonColor);
});

test("standalone HTML contains the selected typography and both screen and print palettes", async (t) => {
  const browser = new Window();
  t.after(() => browser.happyDOM.close());
  const style = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
  style.fontSize = 19;
  style.light.background = "#fff9ed";
  style.dark.background = "#102030";
  style.decorations = [
    { theme: "dark", target: "h1", declarations: { color: "#abcdef" } },
  ];
  Object.assign(style.dark, {
    unknown: "</style><script>unexpected()</script>",
  });
  const document = buildStandaloneDocument({ source, style, theme: "dark" });
  browser.document.write(document.standaloneHtml);
  assert.equal(browser.document.querySelector("script"), null);
  assert.doesNotMatch(document.standaloneHtml, /unexpected/);
  const article = browser.document.querySelector("article")!;
  assert.equal(article.querySelector("h1")!.textContent, "A heading");
  assert.equal(browser.getComputedStyle(article).fontSize, "19px");
  assert.equal(
    browser.getComputedStyle(article.querySelector("h1")!).color,
    "#abcdef",
  );
  const printBrowser = new Window({
    settings: { device: { mediaType: "print" } },
  });
  t.after(() => printBrowser.happyDOM.close());
  printBrowser.document.write(document.standaloneHtml);
  assert.equal(
    printBrowser.getComputedStyle(printBrowser.document.querySelector("h1")!)
      .color,
    style.light.heading,
    "dark-only decorations must not override the light print palette",
  );
  // The exported stylesheet is self-contained; printing chooses the preset's
  // light palette rather than white paper with the dark palette's pale text.
  const css = browser.document.querySelector("style")!.textContent!;
  assert.match(css, /--zmd-style-background: #102030/);
  assert.match(
    css,
    /@media print \{ \.zotero-markdown-preview-page \{[^}]*--zmd-style-background: #fff9ed/s,
  );
});

test("live paragraph spacing marks paragraph starts, not soft wraps or list continuations", async (t) => {
  const browser = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  t.after(async () => {
    await browser.happyDOM.close();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const { livePreviewPlugin, livePreviewBlockDecorations } =
    await import("../src/editor/live-preview/plugin.ts");
  let state = EditorState.create({
    doc: "First line\nsoft wrap\n\nSecond paragraph\n\n- list item\n  continuation\n\n> quote\n\n```\ncode\n```",
    extensions: [markdown(), livePreviewPlugin()],
  });
  assert.ok(ensureSyntaxTree(state, state.doc.length, 5000));
  state = state.update({}).state;
  const starts = (current: EditorState) => {
    const lines: number[] = [];
    current
      .field(livePreviewBlockDecorations)
      .between(0, current.doc.length, (from, _to, decoration) => {
        if (decoration.spec.class === "zmd-lp-paragraph-start")
          lines.push(current.doc.lineAt(from).number);
      });
    return lines;
  };
  assert.deepEqual(starts(state), [1, 4]);
  const blank = state.doc.line(3);
  state = state.update({
    changes: { from: blank.from, to: blank.to + 1, insert: "" },
  }).state;
  assert.deepEqual(starts(state), [1]);
});

test("code remains readable when its background differs from the surrounding document", async (t) => {
  const browser = new Window();
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    Node: browser.Node,
    Element: browser.Element,
    HTMLElement: browser.HTMLElement,
    MutationObserver: browser.MutationObserver,
    ResizeObserver: browser.ResizeObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const { livePreviewPlugin } =
    await import("../src/editor/live-preview/plugin.ts");
  const style = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
  style.dark.codeBackground = "#ffffff";
  style.dark.text = "#fafafa";
  const doc = "Body `inline`\n\n```\nplain code\n```";
  browser.document.head.innerHTML = `<style>${previewDocumentCss()}</style>`;
  const preview = browser.document.createElement("section");
  preview.innerHTML = `<article class="zotero-markdown-preview-inner">${renderMarkdown(doc)}</article>`;
  browser.document.body.append(preview);
  applyPreviewStyle(preview as unknown as HTMLElement, style, "dark");
  const parent = browser.document.createElement("div");
  browser.document.body.append(parent);
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        markdown(),
        livePreviewPlugin(),
        editorThemeExtension("dark", style.fontSize, "live", "default", {
          fontFamily: style.fontFamily,
          backgroundColor: "",
          style,
        }),
      ],
    }),
  });
  t.after(async () => {
    view.destroy();
    await browser.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  assert.equal(
    browser.getComputedStyle(preview.querySelector("p")!).color,
    "#fafafa",
  );
  assert.equal(browser.getComputedStyle(view.dom as any).color, "#fafafa");
  for (const element of [
    preview.querySelector("pre > code"),
    preview.querySelector("p > code"),
    parent.querySelector(".zmd-lp-code-block"),
    parent.querySelector(".zmd-lp-code"),
  ]) {
    assert.ok(element);
    assert.equal(
      browser.getComputedStyle(element!).color,
      THEME_TOKENS.light.text,
    );
  }
});

test("compiled decoration CSS reaches Live and Reading without hiding table selection", async (t) => {
  const browser = new Window();
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    Node: browser.Node,
    Element: browser.Element,
    HTMLElement: browser.HTMLElement,
    MutationObserver: browser.MutationObserver,
    ResizeObserver: browser.ResizeObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const api = await import("../src/editor/live-preview/plugin.ts");
  const result = compileMarkdownStyleCss(`
.markdown[data-theme="dark"] h1 { color: #abcdef; }
.markdown h1 { color: #123456; text-align: center; font-style: italic; }
.markdown code { color: #bbccdd; }
.markdown pre { color: #ff0000; border-radius: 12px; }
.markdown td { background-color: #334455; font-style: italic; }
`);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const style = result.style;
  const doc =
    "# Heading\n\nBody `inline`\n\n```\nplain code\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd";
  browser.document.head.innerHTML = `<style>${previewDocumentCss()}</style>`;
  const preview = browser.document.createElement("section");
  preview.innerHTML = `<article class="zotero-markdown-preview-inner">${renderMarkdown(doc)}</article>`;
  browser.document.body.append(preview);
  applyPreviewStyle(preview as unknown as HTMLElement, style, "dark");
  const parent = browser.document.createElement("div");
  browser.document.body.append(parent);
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        markdown({ extensions: GFM }),
        api.livePreviewPlugin(),
        editorThemeExtension("dark", style.fontSize, "live", "default", {
          fontFamily: style.fontFamily,
          backgroundColor: "",
          style,
        }),
      ],
    }),
  });
  t.after(async () => {
    view.destroy();
    await browser.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  for (const heading of [
    preview.querySelector("h1")!,
    parent.querySelector(".zmd-lp-h1")!,
  ]) {
    const computed = browser.getComputedStyle(heading);
    assert.equal(computed.color, "#abcdef");
    assert.equal(computed.textAlign, "center");
    assert.equal(computed.fontStyle, "italic");
  }
  for (const code of [
    preview.querySelector("pre code")!,
    preview.querySelector("p code")!,
    parent.querySelector(".zmd-lp-code-block")!,
    parent.querySelector(".zmd-lp-code")!,
  ]) {
    assert.equal(browser.getComputedStyle(code).color, "#bbccdd");
  }
  assert.equal(
    browser.getComputedStyle(preview.querySelector("pre")!).borderRadius,
    "12px",
  );
  assert.equal(
    browser.getComputedStyle(parent.querySelector(".zmd-lp-code-fence-open")!)
      .borderTopLeftRadius,
    "12px",
  );
  const idleCell = parent.querySelector(
    ".zmd-lp-table-cell:not(.zmd-lp-table-header-cell)",
  )!;
  assert.equal(browser.getComputedStyle(idleCell).backgroundColor, "#334455");
  view.dispatch({
    effects: api.setLiveTableSelection.of({
      kind: "row",
      tableFrom: doc.indexOf("| A"),
      rowIndex: 1,
    }),
  });
  const selectedCell = parent.querySelector(".zmd-lp-table-cell-selected")!;
  assert.ok(selectedCell);
  assert.equal(
    browser.getComputedStyle(selectedCell).backgroundColor,
    `${style.dark.accent}26`,
  );
  assert.equal(browser.getComputedStyle(selectedCell).fontStyle, "italic");
  const heading = preview.querySelector("h1");
  applyPreviewStyle(preview as unknown as HTMLElement, style, "light");
  assert.equal(preview.querySelector("h1"), heading);
  assert.equal(browser.getComputedStyle(heading!).color, "#123456");
  applyPreviewStyle(
    preview as unknown as HTMLElement,
    DEFAULT_MARKDOWN_STYLE,
    "light",
  );
  assert.equal(preview.querySelector("style[data-zmd-style-decoration]"), null);
  assert.equal(
    browser.getComputedStyle(heading!).color,
    DEFAULT_MARKDOWN_STYLE.light.heading,
  );
});
