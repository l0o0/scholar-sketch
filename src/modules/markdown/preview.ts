import { DEFAULT_MARKDOWN_STYLE, type MarkdownStyle } from "./style-presets";
import { appearanceFontFamily } from "./preferences";
import { CODE_FONT_FAMILY } from "../../ui/theme";
import {
  assetReferenceCandidates,
  decodeImageAttribute,
  imageAssetFromMap,
} from "./images/model";
import { getString } from "../../utils/locale";
import type { EditorOutlineItem, ImageAssetMap } from "./editor-protocol";
import { THEME_TOKENS, themeTokenCss } from "./theme-tokens";
import { documentTitleCore, renderMarkdownCore } from "./preview-render-core";
import { showImageViewer } from "./image-viewer";
import { mermaidStyles, mountMermaidBlock } from "./mermaid-view";

export interface ReadOnlyDocument {
  title: string;
  bodyHtml: string;
  standaloneHtml: string;
}

export function previewOutlineAnchors(
  items: readonly EditorOutlineItem[],
  headingCount: number,
): Array<string | null> {
  return Array.from(
    { length: headingCount },
    (_, index) => items[index]?.id ?? null,
  );
}

export function activePreviewOutlineID(
  headings: readonly { id: string; top: number }[],
  baselineTop: number,
): string | null {
  if (!headings.length || !Number.isFinite(baselineTop)) return null;
  let active = headings[0].id;
  for (const heading of headings) {
    if (heading.top > baselineTop) break;
    active = heading.id;
  }
  return active;
}

/**
 * Render markdown source to an HTML fragment (html input disabled).
 * YAML frontmatter is stripped so it does not pollute the preview.
 */
export function renderMarkdown(source: string): string {
  return renderMarkdownCore(source);
}

export function documentTitle(source: string, fallback = "Markdown"): string {
  return documentTitleCore(source, fallback);
}

export function applyAssetsToHtml(html: string, assets: ImageAssetMap): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
    (full, prefix: string, src: string, suffix: string) => {
      const dataUrl = imageAssetFromMap(
        decodeImageAttribute(src),
        assets,
      )?.dataUrl;
      return dataUrl ? `${prefix}${dataUrl}${suffix}` : full;
    },
  );
}

function previewStyleVariables(style: MarkdownStyle, theme: "light" | "dark") {
  const colors = style[theme];
  const values: Record<string, string> = {
    "--zmd-style-font": appearanceFontFamily(style.fontFamily),
    "--zmd-style-size": `${style.fontSize}px`,
    "--zmd-style-line-height": String(style.lineHeight),
    "--zmd-style-paragraph-spacing": `${style.paragraphSpacing}em`,
    "--zmd-style-width": `${style.contentWidth}px`,
  };
  for (const name of Object.keys(DEFAULT_MARKDOWN_STYLE.light) as Array<
    keyof MarkdownStyle["light"]
  >) {
    values[
      `--zmd-style-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
    ] = colors[name];
  }
  style.headings.forEach((heading, index) => {
    const prefix = `--zmd-style-h${index + 1}`;
    values[`${prefix}-size`] = `${heading.size * style.fontSize}px`;
    values[`${prefix}-weight`] = String(heading.weight);
    values[`${prefix}-before`] = `${heading.before}em`;
    values[`${prefix}-after`] = `${heading.after}em`;
  });
  const rgb = [1, 3, 5].map((offset) =>
    parseInt(colors.codeBackground.slice(offset, offset + 2), 16),
  );
  const syntaxTheme =
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 140
      ? "dark"
      : "light";
  values["--zmd-style-code-text"] = THEME_TOKENS[syntaxTheme].text;
  for (const [key, value] of Object.entries(THEME_TOKENS[syntaxTheme])) {
    if (key.startsWith("code")) {
      const name = key.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`,
      );
      values[`--zmd-${name}`] = value;
    }
  }
  return values;
}

/** Update document variables without replacing images, selection or scroll. */
export function applyPreviewStyle(
  host: HTMLElement,
  style: MarkdownStyle,
  theme: "light" | "dark",
): void {
  for (const [name, value] of Object.entries(
    previewStyleVariables(style, theme),
  )) {
    host.style.setProperty(name, value);
  }
}

function previewStyleCss(
  style: MarkdownStyle,
  theme: "light" | "dark",
): string {
  return Object.entries(previewStyleVariables(style, theme))
    .map(([name, value]) => `${name}: ${value};`)
    .join("\n");
}

/** Printable / exportable prose styles shared by the in-app preview. */
export function previewDocumentCss(): string {
  return `
${mermaidStyles()}
.katex-display { display:block; text-align:center; overflow-x:auto; margin:1em 0; }
.katex math { font-size:1.15em; }
.footnotes { font-size:.9em; }
.zotero-markdown-preview-page {
  margin: 0;
  background: var(--zmd-style-background, var(--zmd-bg));
  color: var(--zmd-text);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.7;
}
.zotero-markdown-preview-inner {
  box-sizing: border-box;
  user-select: text;
  max-width: var(--zmd-style-width, 760px);
  margin: 0 auto;
  padding: 28px 32px;
  background: var(--zmd-style-background, var(--zmd-surface));
  color: var(--zmd-style-text, var(--zmd-text));
  font-family: var(--zmd-style-font, inherit);
  font-size: var(--zmd-style-size, 15px);
  line-height: var(--zmd-style-line-height, 1.7);

}
.zotero-markdown-preview-empty {
  opacity: 0.55;
  text-align: center;
  padding: 3em 1em;
}
.zotero-markdown-preview-inner h1,
.zotero-markdown-preview-inner h2,
.zotero-markdown-preview-inner h3,
.zotero-markdown-preview-inner h4,
.zotero-markdown-preview-inner h5,
.zotero-markdown-preview-inner h6 {
  margin-top: 1.4em;
  margin-bottom: 0.45em;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--zmd-style-heading, var(--zmd-text));
}
.zotero-markdown-preview-inner h1 {
  font-size: 1.75em;
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--zmd-border);
}
.zotero-markdown-preview-inner h2 {
  font-size: 1.35em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--zmd-border);
}
.zotero-markdown-preview-inner h3 { font-size: 1.15em; }
${[1, 2, 3, 4, 5, 6]
  .map(
    (level) => `
.zotero-markdown-preview-inner h${level} {
  font-size: var(--zmd-style-h${level}-size, ${[1.75, 1.35, 1.15, 1.05, 1, 1][level - 1]}em);
  font-weight: var(--zmd-style-h${level}-weight, 700);
  margin-top: var(--zmd-style-h${level}-before, 1.4em);
  margin-bottom: var(--zmd-style-h${level}-after, 0.45em);
}
`,
  )
  .join("")}
.zotero-markdown-preview-inner p { margin: var(--zmd-style-paragraph-spacing, 0.75em) 0; }
.zotero-markdown-preview-inner a,
.zotero-markdown-preview-inner .zmd-wikilink {
  color: var(--zmd-style-link, var(--zmd-accent));
  text-decoration: none;
}
.zotero-markdown-preview-inner a:hover { text-decoration: underline; }
.zotero-markdown-preview-inner ul,
.zotero-markdown-preview-inner ol {
  padding-left: 1.4em;
  margin: 0.6em 0;
}
.zotero-markdown-preview-inner li { margin: 0.25em 0; }
.zotero-markdown-preview-inner pre {
  color: var(--zmd-style-code-text, inherit);
  background: var(--zmd-style-code-background, var(--zmd-surface-2));
  border: 1px solid var(--zmd-style-code-border, var(--zmd-border));
  padding: 16px 20px;
  border-radius: 6px;
  overflow: auto;
  font-size: max(13px, 0.9em);
  line-height: 1.65;
  tab-size: 4;
  font-variant-ligatures: none;
}
.zotero-markdown-preview-inner code {
  font-family: ${CODE_FONT_FAMILY};
  font-size: 0.9em;
}
.zotero-markdown-preview-inner pre > code {
  font-size: inherit;
}
.zotero-markdown-preview-inner :not(pre) > code {
  background: var(--zmd-style-code-background, var(--zmd-accent-soft));
  color: var(--zmd-style-code-text, var(--zmd-accent-hover));
  padding: 0.12em 0.4em;
  border-radius: 4px;
}
.zotero-markdown-preview-inner sup,
.zotero-markdown-preview-inner sub {
  font-size: 0.75em;
  line-height: 0;
}
.zotero-markdown-preview-inner mark {
  background: color-mix(in srgb, var(--zmd-style-accent, #facc15) 30%, transparent);
  color: inherit;
}
.zotero-markdown-preview-inner kbd {
  font-family: ${CODE_FONT_FAMILY};
  font-size: 0.85em;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0.05em 0.3em;
}
.zotero-markdown-preview-inner .hljs-comment,
.zotero-markdown-preview-inner .hljs-quote {
  color: var(--zmd-code-comment);
}
.zotero-markdown-preview-inner .hljs-keyword,
.zotero-markdown-preview-inner .hljs-selector-tag,
.zotero-markdown-preview-inner .hljs-operator {
  color: var(--zmd-code-keyword);
}
.zotero-markdown-preview-inner .hljs-string,
.zotero-markdown-preview-inner .hljs-regexp,
.zotero-markdown-preview-inner .hljs-addition {
  color: var(--zmd-code-string);
}
.zotero-markdown-preview-inner .hljs-number,
.zotero-markdown-preview-inner .hljs-literal {
  color: var(--zmd-code-number);
}
.zotero-markdown-preview-inner .hljs-title,
.zotero-markdown-preview-inner .hljs-section {
  color: var(--zmd-code-function);
}
.zotero-markdown-preview-inner .hljs-variable,
.zotero-markdown-preview-inner .hljs-property,
.zotero-markdown-preview-inner .hljs-attr {
  color: var(--zmd-code-variable);
}
.zotero-markdown-preview-inner .hljs-name,
.zotero-markdown-preview-inner .hljs-tag {
  color: var(--zmd-code-tag);
}
.zotero-markdown-preview-inner .hljs-punctuation {
  color: var(--zmd-code-punctuation);
}
.zotero-markdown-preview-inner .hljs-deletion {
  color: var(--zmd-code-invalid);
}
.zotero-markdown-preview-inner blockquote {
  margin: 1em 0;
  padding: 0.2em 0 0.2em 1em;
  border-left: 3px solid var(--zmd-style-quote-border, var(--zmd-accent));
  color: var(--zmd-style-text, var(--zmd-text-muted));
  background: var(--zmd-style-quote-background, var(--zmd-accent-soft));
  border-radius: 0 6px 6px 0;
}
.zotero-markdown-preview-inner hr {
  border: none;
  border-top: 1px solid var(--zmd-border);
  margin: 1.6em 0;
}
.zotero-markdown-preview-inner table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
  font-size: 0.95em;
}
.zotero-markdown-preview-inner th,
.zotero-markdown-preview-inner td {
  border: 1px solid var(--zmd-style-table-border, var(--zmd-border));
  padding: 8px 12px;
}
.zotero-markdown-preview-inner th {
  background: var(--zmd-style-table-header, var(--zmd-surface-2));
  font-weight: 600;
}
.zotero-markdown-preview-inner img {
  max-width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
}
@media print {
  .zotero-markdown-preview-page { background: var(--zmd-style-background, #fff); }
  .zotero-markdown-preview-inner {
    max-width: none;
    border: none;
    box-shadow: none;
    padding: 0;
  }
}
`.trim();
}

export function buildStandaloneDocument(options: {
  source: string;
  assets?: ImageAssetMap;
  title?: string;
  theme?: "light" | "dark";
  style?: MarkdownStyle;
}): ReadOnlyDocument {
  const title = options.title || documentTitle(options.source);
  return buildStandaloneDocumentFromRendered({
    title,
    bodyHtml: renderMarkdown(options.source),
    assets: options.assets,
    theme: options.theme,
    style: options.style,
  });
}

export function buildStandaloneDocumentFromRendered(options: {
  title: string;
  bodyHtml: string;
  assets?: ImageAssetMap;
  theme?: "light" | "dark";
  style?: MarkdownStyle;
}): ReadOnlyDocument {
  const title = options.title || "Markdown";
  const bodyHtml = applyAssetsToHtml(options.bodyHtml, options.assets || {});
  const tokens =
    options.theme === "dark" ? THEME_TOKENS.dark : THEME_TOKENS.light;
  const standaloneHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${themeTokenCss(":root", tokens)}
${previewDocumentCss()}
${options.style ? `.zotero-markdown-preview-page { ${previewStyleCss(options.style, options.theme ?? "light")} }` : ""}
${options.style ? `@media print { .zotero-markdown-preview-page { ${previewStyleCss(options.style, "light")} } }` : ""}
body { padding: 28px 32px 48px; }
</style>
</head>
<body class="zotero-markdown-preview-page">
<article class="zotero-markdown-preview-inner">${bodyHtml}</article>
</body>
</html>
`;
  return { title, bodyHtml, standaloneHtml };
}

/**
 * Mount a read-only document page. Editing stays in Live/Source;
 * this view is the HTML/PDF export surface.
 */
export function mountPreviewHtml(
  host: HTMLElement,
  rendered: { title: string; bodyHtml: string },
  outlineItems: readonly EditorOutlineItem[] = [],
  {
    mountDiagram = mountMermaidBlock,
  }: { mountDiagram?: typeof mountMermaidBlock } = {},
): void {
  const doc = host.ownerDocument || (globalThis as any).document;
  disposePreviewMermaid(host);
  host.replaceChildren();
  host.setAttribute("aria-readonly", "true");
  host.setAttribute("role", "document");
  host.contentEditable = "false";

  const page = doc.createElement("div");
  page.className = "zotero-markdown-preview-page";

  const bar = doc.createElement("header");
  bar.className = "zotero-markdown-preview-bar";
  const label = doc.createElement("div");
  label.className = "zotero-markdown-preview-bar-copy";
  const title = doc.createElement("strong");
  title.textContent = getString("preview-title");
  const hint = doc.createElement("span");
  hint.textContent = getString("preview-hint");
  label.append(title, hint);
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "zotero-markdown-preview-back";
  back.dataset.action = "preview-back";
  back.textContent = getString("preview-back");
  bar.append(label, back);

  const article = doc.createElement("article");
  article.className = "zotero-markdown-preview-inner";
  try {
    const view = doc.defaultView;
    if (view?.DOMParser) {
      const parsed = new view.DOMParser().parseFromString(
        `<div>${rendered.bodyHtml}</div>`,
        "text/html",
      );
      const inner = parsed.body.firstElementChild;
      if (inner) {
        for (const child of Array.from(inner.childNodes)) {
          article.appendChild(doc.importNode(child, true));
        }
      }
    } else {
      article.innerHTML = rendered.bodyHtml;
    }
  } catch (e) {
    ztoolkit.log("mountPreviewHtml fallback to innerHTML", e);
    article.innerHTML = rendered.bodyHtml;
  }

  const headings = Array.from(
    article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );
  const anchors = previewOutlineAnchors(outlineItems, headings.length);
  headings.forEach((heading, index) => {
    const outlineID = anchors[index];
    if (outlineID) heading.dataset.zmdOutlineId = outlineID;
  });

  page.append(bar, article);
  host.appendChild(page);
  mountPreviewMermaid(host, article, mountDiagram);
  for (const image of article.querySelectorAll("img")) {
    image.tabIndex = 0;
    image.title = getString("image-view-original");
    image.style.cursor = "zoom-in";
    const open = () =>
      showImageViewer(image, page, {
        original: getString("image-view-original"),
        auto: getString("image-size-auto"),
        close: getString("image-view-close"),
      });
    image.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      open();
    });
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        open();
      }
    });
  }
}

const previewMermaidDisposers = new WeakMap<HTMLElement, () => void>();

/** Release pending diagrams and theme observers when leaving/replacing preview. */
export function disposePreviewMermaid(host: HTMLElement): void {
  previewMermaidDisposers.get(host)?.();
  previewMermaidDisposers.delete(host);
}

function mountPreviewMermaid(
  host: HTMLElement,
  article: HTMLElement,
  mountDiagram: typeof mountMermaidBlock,
): void {
  const blocks = [
    ...article.querySelectorAll<HTMLElement>("[data-zmd-mermaid]"),
  ];
  if (!blocks.length) return;
  const sources = blocks.map(
    (block) => block.querySelector("code")?.textContent ?? "",
  );
  const root = host.closest(".zotero-markdown-root") ?? host;
  const resolveTheme = (): "light" | "dark" =>
    root.classList.contains("theme-dark") ? "dark" : "light";
  let theme = resolveTheme();
  let disposeBlocks: Array<() => void> = [];
  const render = () => {
    disposeBlocks.forEach((dispose) => dispose());
    disposeBlocks = blocks.map((block, index) =>
      mountDiagram(block, sources[index], {
        theme,
        labels: {
          loading: getString("mermaid-loading"),
          error: getString("mermaid-error"),
          edit: getString("mermaid-edit"),
        },
      }),
    );
  };
  render();
  const Observer = host.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer
    ? new Observer(() => {
        const next = resolveTheme();
        if (next === theme) return;
        theme = next;
        render();
      })
    : undefined;
  observer?.observe(root, { attributes: true, attributeFilter: ["class"] });
  previewMermaidDisposers.set(host, () => {
    observer?.disconnect();
    disposeBlocks.forEach((dispose) => dispose());
  });
}

export function scrollPreviewToOutline(
  host: HTMLElement,
  outlineID: string,
): boolean {
  const heading = Array.from(
    host.querySelectorAll<HTMLElement>("[data-zmd-outline-id]"),
  ).find((element) => element.dataset.zmdOutlineId === outlineID);
  if (!heading) return false;
  heading.scrollIntoView({ block: "start", behavior: "smooth" });
  return true;
}

export function hydratePreviewImages(
  host: HTMLElement,
  assets: ImageAssetMap,
): void {
  for (const image of host.querySelectorAll("img")) {
    // Diagrams are generated SVG data URLs, not attachment references.
    if (image.closest("[data-zmd-mermaid]")) continue;
    const source = image.getAttribute("src") || "";
    if (!assetReferenceCandidates(source).length) continue;
    const resolved = imageAssetFromMap(source, assets);
    if (resolved?.dataUrl) {
      image.setAttribute("src", resolved.dataUrl);
      continue;
    }
    const placeholder = host.ownerDocument.createElement("span");
    placeholder.className = "zotero-markdown-image-missing";
    placeholder.textContent =
      resolved?.error || getString("preview-image-missing");
    placeholder.setAttribute("role", "img");
    placeholder.setAttribute(
      "aria-label",
      image.getAttribute("alt") || getString("preview-image-missing"),
    );
    image.replaceWith(placeholder);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Footnotes use generated IDs, not document/heading links. Keep them in this preview. */
export function scrollPreviewToFragment(
  root: HTMLElement,
  href: string,
): boolean {
  if (!href.startsWith("#")) return false;
  let id: string;
  try {
    id = decodeURIComponent(href.slice(1));
  } catch {
    return false;
  }
  const target = [...root.querySelectorAll<HTMLElement>("[id]")].find(
    (element) => element.id === id,
  );
  if (!target) return false;
  target.scrollIntoView({ block: "nearest" });
  return true;
}
