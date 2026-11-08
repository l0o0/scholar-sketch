import MarkdownIt from "markdown-it";
import { configureMath } from "./math";
import { footnote } from "@mdit/plugin-footnote";
import {
  extractFirstHeadingTitle,
  parseFrontmatter,
  stripFrontmatter,
} from "./frontmatter";
import { highlightFencedCode } from "./code-highlight";
import { parseDocumentLink, isPdfDocumentLink } from "./document-link-shared";
import { parseNoteLink, noteHeadingPosition } from "./note-links";
import { parseHtmlImage } from "./images/html";
import { parseWikiImage } from "./images/reference";
import { configureInlineHtml } from "./inline-html";
import { parseHtmlTable, type HtmlTable } from "./html-table";
import {
  isSafeAttachmentDataUrl,
  MAX_ATTACHMENT_BYTES,
} from "../../../packages/whiteboard/src/model/file-attachment";

const MarkdownItCtor: typeof MarkdownIt =
  typeof MarkdownIt === "function"
    ? MarkdownIt
    : (MarkdownIt as unknown as { default: typeof MarkdownIt }).default;

function isSafeLinkUrl(url: string): boolean {
  // Zotero links are persisted in one exact canonical form. Do not trim here,
  // otherwise renderer and navigation would disagree about malformed URIs.
  if (parseDocumentLink(url) || isPdfDocumentLink(url)) return true;
  const value = url.trim();
  if (/^(https?:|mailto:)/i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(decodeURIComponent(value))) return false;
  } catch {
    // The raw scheme check already rejects explicit unsafe schemes.
  }
  return true;
}

const md = new MarkdownItCtor({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(source, info) {
    return highlightFencedCode(source, info) || "";
  },
});

md.use(footnote);
configureMath(md);
configureInlineHtml(md);

md.block.ruler.before(
  "html_block",
  "zmd_html_table",
  (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const from = state.bMarks[startLine] + state.tShift[startLine];
    let table = parseHtmlTable(state.src, from);
    const limit =
      endLine < state.lineMax ? state.bMarks[endLine] : state.src.length;
    if (!table || table.to > limit) return false;
    if (silent) return true;
    let lastLine = startLine;
    let cursor = from;
    while (table) {
      const token = state.push("zmd_html_table", "table", 0);
      token.block = true;
      token.meta = { table, source: state.src };
      cursor = table.to;
      while (lastLine + 1 < endLine && state.bMarks[lastLine + 1] < cursor)
        lastLine++;
      token.map = [startLine, lastLine + 1];
      while (cursor < state.eMarks[lastLine] && /[ \t]/.test(state.src[cursor]))
        cursor++;
      table =
        cursor < state.eMarks[lastLine]
          ? parseHtmlTable(state.src, cursor)
          : null;
      if (table && table.to > limit) table = null;
    }
    // A closing tag can be followed by text on the same source line. Keep that
    // text in the normal inline pipeline instead of consuming it with the table.
    const tail = state.src.slice(cursor, state.eMarks[lastLine]).trim();
    if (tail) {
      state.push("paragraph_open", "p", 1);
      const token = state.push("inline", "", 0);
      token.content = tail;
      token.map = [lastLine, lastLine + 1];
      token.children = [];
      state.push("paragraph_close", "p", -1);
    }
    state.line = lastLine + 1;
    return true;
  },
  { alt: ["paragraph", "reference"] },
);

md.renderer.rules.zmd_html_table = (tokens, index, _options, env) => {
  const { table, source } = tokens[index].meta as {
    table: HtmlTable;
    source: string;
  };
  return `${renderHtmlTableCore(table, source, env)}\n`;
};

// Keep unsupported HTML comment source intact so a table within it cannot
// interrupt the paragraph and become an active table block.
md.block.ruler.before(
  "zmd_html_table",
  "zmd_html_comment",
  (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const from = state.bMarks[startLine] + state.tShift[startLine];
    if (!state.src.startsWith("<!--", from)) return false;
    if (silent) return true;
    const limit =
      endLine < state.lineMax ? state.bMarks[endLine] : state.src.length;
    const close = state.src.indexOf("-->", from + 4);
    const to = close < 0 ? limit : Math.min(close + 3, limit);
    let lastLine = startLine;
    while (lastLine + 1 < endLine && state.bMarks[lastLine + 1] < to)
      lastLine++;
    const token = state.push("zmd_html_comment", "p", 0);
    token.block = true;
    token.map = [startLine, lastLine + 1];
    // The closing line's suffix remains visible source, including any table.
    token.content = state.src.slice(from, state.eMarks[lastLine]);
    state.line = lastLine + 1;
    return true;
  },
  { alt: ["paragraph", "reference"] },
);
md.renderer.rules.zmd_html_comment = (tokens, index) =>
  `<p>${escapeHtml(tokens[index].content).replace(/\n/g, "<br>\n")}</p>\n`;

// Keep the worker renderer DOM-free. The host upgrades these inert, escaped
// sources to diagrams; failed/unsupported renders still show the original code.
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = token.info.trim().toLowerCase();
  if (language !== "mermaid") {
    return defaultFence(tokens, index, options, env, self);
  }
  return `<div class="zmd-mermaid-block" data-zmd-mermaid=""><pre class="zmd-mermaid-source"><code class="language-mermaid">${escapeHtml(token.content)}</code></pre></div>\n`;
};

// Sized images have one small HTML vocabulary. Keep general HTML disabled.
md.inline.ruler.before("html_inline", "zmd_sized_image", (state, silent) => {
  if (state.src[state.pos] !== "<") return false;
  const image = parseHtmlImage(state.src, state.pos);
  if (!image || !md.validateLink(image.source)) return false;
  if (!silent) {
    const token = state.push("zmd_sized_image", "img", 0);
    token.attrSet("src", image.source);
    token.attrSet("alt", image.alt);
    if (image.title) token.attrSet("title", image.title);
    if (image.width) token.attrSet("width", String(image.width));
    token.attrSet("referrerpolicy", "no-referrer");
  }
  state.pos = image.to;
  return true;
});
md.renderer.rules.zmd_sized_image = (tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options);

md.inline.ruler.before("link", "zmd_wiki_image", (state, silent) => {
  if (!state.src.startsWith("![[", state.pos)) return false;
  const image = parseWikiImage(state.src, state.pos);
  if (!image || !md.validateLink(image.source)) return false;
  if (!silent) {
    const token = state.push("zmd_wiki_image", "img", 0);
    token.attrSet("src", state.md.normalizeLink(image.source));
    token.attrSet("alt", image.alt);
    token.attrSet("referrerpolicy", "no-referrer");
    if (image.width) token.attrSet("width", String(image.width));
  }
  state.pos = image.to;
  return true;
});
md.renderer.rules.zmd_wiki_image = (tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options);

// Wiki links are rendered as inert spans first. The host resolves their title
// against the current Zotero library when clicked; keeping lookup out of this
// worker-safe renderer prevents stale/local item IDs from entering HTML.
md.inline.ruler.before("link", "zmd_wikilink", (state, silent) => {
  const start = state.pos;
  if (
    state.src.charCodeAt(start) !== 0x5b ||
    state.src.charCodeAt(start + 1) !== 0x5b ||
    (start > 0 && state.src.charCodeAt(start - 1) === 0x21)
  ) {
    return false;
  }
  const end = state.src.indexOf("]]", start + 2);
  if (end <= start + 2) return false;
  const raw = state.src.slice(start + 2, end);
  const parsed = parseNoteLink(`[[${raw}]]`);
  if (!parsed) return false;
  const pipe = raw.indexOf("|");
  const name = (pipe < 0 ? raw : raw.slice(0, pipe)).trim();
  const label = parsed.label ?? name;
  if (!name || !label || name.includes("\n") || label.includes("\n")) {
    return false;
  }
  if (!silent) {
    state.pushPending();
    const token = state.push("zmd_wikilink", "span", 0);
    token.content = label;
    token.attrSet("data-zmd-wikilink", name);
  }
  state.pos = end + 2;
  return true;
});

md.renderer.rules.zmd_wikilink = (tokens, index) => {
  const token = tokens[index];
  const name = String(token.attrGet("data-zmd-wikilink") || "");
  return `<span class="zmd-wikilink zmd-unresolved-link" role="link" tabindex="0" data-zmd-wikilink="${escapeHtml(name)}">${escapeHtml(token.content)}</span>`;
};

md.validateLink = isSafeLinkUrl;

// markdown-it validates image destinations with the same callback as links.
// Temporarily allow one validated raster data URL only while its image rule is
// parsing `![alt](...)`; ordinary links continue through isSafeLinkUrl.
const defaultImageRule = md.inline.ruler.__rules__.find(
  (rule) => rule.name === "image",
)?.fn;
if (!defaultImageRule) throw new Error("Markdown image rule is unavailable.");
md.inline.ruler.at("image", (state, silent) => {
  const safeDataUrl = safeRasterImageDestination(state);
  if (!safeDataUrl) return defaultImageRule(state, silent);
  const validateLink = state.md.validateLink;
  state.md.validateLink = (url) => url === safeDataUrl || validateLink(url);
  try {
    return defaultImageRule(state, silent);
  } finally {
    state.md.validateLink = validateLink;
  }
});

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrJoin("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const defaultImage =
  md.renderer.rules.image ||
  ((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options));
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("referrerpolicy", "no-referrer");
  return defaultImage(tokens, idx, options, env, self);
};

function safeRasterImageDestination(
  state: Parameters<NonNullable<typeof defaultImageRule>>[0],
): string | undefined {
  if (
    state.src.charCodeAt(state.pos) !== 33 ||
    state.src.charCodeAt(state.pos + 1) !== 91
  ) {
    return undefined;
  }
  const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos + 1, false);
  if (labelEnd < 0 || state.src.charCodeAt(labelEnd + 1) !== 40) {
    return undefined;
  }
  let pos = labelEnd + 2;
  while (pos < state.posMax && /\s/u.test(state.src[pos]!)) pos += 1;
  const result = state.md.helpers.parseLinkDestination(
    state.src,
    pos,
    state.posMax,
  );
  if (!result.ok) return undefined;
  const href = state.md.normalizeLink(result.str);
  if (
    !/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;[^,]*)?;base64,/iu.test(
      href,
    ) ||
    !isSafeAttachmentDataUrl(href, MAX_ATTACHMENT_BYTES)
  ) {
    return undefined;
  }
  return href;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The Live widget and reading/export renderer share safe cell rendering. */
export function renderHtmlTableCore(
  table: HtmlTable,
  source: string,
  env: Record<string, unknown> = {},
): string {
  let html = "<table>";
  if (table.caption) {
    html += `<caption>${renderTableContent(source.slice(table.caption.contentFrom, table.caption.contentTo), env)}</caption>`;
  }
  let section: string | null = null;
  for (const row of table.rows) {
    if (section !== row.section) {
      if (section) html += `</${section}>`;
      section = row.section;
      if (section) html += `<${section}>`;
    }
    html += "<tr>";
    for (const cell of row.cells) {
      const tag = cell.header ? "th" : "td";
      const spans = `${cell.colspan ? ` colspan="${cell.colspan}"` : ""}${cell.rowspan ? ` rowspan="${cell.rowspan}"` : ""}`;
      html += `<${tag}${spans}>${renderTableContent(source.slice(cell.contentFrom, cell.contentTo), env)}</${tag}>`;
    }
    html += "</tr>";
  }
  if (section) html += `</${section}>`;
  return `${html}</table>`;
}

function renderTableContent(
  source: string,
  env: Record<string, unknown>,
): string {
  const tokens = md.parse(source.trim(), env);
  const inlineParagraph =
    tokens.length === 3 &&
    tokens[0].type === "paragraph_open" &&
    tokens[1].type === "inline" &&
    tokens[2].type === "paragraph_close";
  return md.renderer.render(
    inlineParagraph ? [tokens[1]] : tokens,
    md.options,
    env,
  );
}

/** Root table blocks use the same Markdown context in Live and reading views. */
export function parseHtmlTableBlocksCore(source: string): HtmlTable[] {
  if (!/<table(?=[\s>])/i.test(source)) return [];
  return md
    .parse(source, {})
    .filter((token) => token.type === "zmd_html_table" && token.level === 0)
    .map((token) => (token.meta as { table: HtmlTable }).table);
}

/** Bounded hover output; heading lookup runs in the rendering worker. */
export function markdownPreviewFragment(
  source: string,
  { maxChars, heading }: { maxChars: number; heading?: string },
): { source: string; headingFound?: boolean } {
  const position = heading ? noteHeadingPosition(source, heading) : 0;
  if (position === null) return { source: "", headingFound: false };
  const selected = source.slice(position, position + maxChars);
  const line = selected.lastIndexOf("\n");
  return {
    source:
      selected.length === maxChars && line > 0
        ? selected.slice(0, line)
        : selected,
    ...(heading ? { headingFound: true } : {}),
  };
}

export function renderMarkdownCore(source: string, docId?: string): string {
  try {
    const { body } = stripFrontmatter(source || "");
    const html = md.render(body, {
      docId: docId ? encodeURIComponent(docId) : undefined,
    });
    if (!html || !html.trim()) {
      return `<p class="zotero-markdown-preview-empty"><em>(empty)</em></p>`;
    }
    return html;
  } catch (error) {
    return `<pre class="zotero-markdown-preview-error">${escapeHtml(
      String(error),
    )}\n\n${escapeHtml(source)}</pre>`;
  }
}

export function documentTitleCore(
  source: string,
  fallback = "Markdown",
): string {
  const { data } = parseFrontmatter(source || "");
  if (typeof data.title === "string" && data.title.trim()) {
    return data.title.trim();
  }
  return extractFirstHeadingTitle(source || "") || fallback;
}
