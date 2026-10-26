import { isPdfDocumentLink, parseDocumentLink } from "./document-link-shared";
import { GFM, parser as markdownParser } from "@lezer/markdown";
import MarkdownIt from "markdown-it";

export interface PortableNote {
  libraryID: number;
  key: string;
  filename: string;
  title: string;
  groupID?: number;
}

export interface NoteDocument extends PortableNote {
  content: string;
  path?: string;
  readError?: string;
  fileModified?: number;
  fileSize?: number;
  links?: ExtractedNoteLink[];
}

export interface ParsedNoteLink {
  target: string;
  heading?: string;
  label?: string;
  syntax: "wiki" | "markdown";
}

export interface ExtractedNoteLink {
  from: number;
  to: number;
  href: string;
  label: string;
  syntax: "wiki" | "markdown";
}

export interface NoteIgnoredRange {
  from: number;
  to: number;
}

const MARKDOWN_EXT = /\.(?:md|markdown|mdown|mkd|mkdn)$/i;
const PARSER = markdownParser.configure(GFM);
const INLINE_MARKDOWN = new MarkdownIt();

/** Return a stable, vault-safe name for a Zotero Markdown attachment. */
export function portableNoteFilename(
  note: Pick<PortableNote, "filename" | "key">,
): string {
  let stem =
    String(note.filename || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "Note";
  stem = stem.replace(/^(?:zmd-)+/i, "").replace(MARKDOWN_EXT, "");
  // Attachment filenames can come from linked files. Keep export names as one
  // path component and use the same conservative characters as Zotero's
  // Markdown import path helper.
  stem = stem
    .replace(/[\0/:*?"<>|#^[\]%]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${stem || "Note"}--${String(note.key || "note")}.md`;
}

function encodeRFC3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(value: string): string {
  return encodeRFC3986(value);
}

function encodeHeading(value: string): string {
  return encodeRFC3986(value.trim());
}

function fallbackLabel(note: PortableNote): string {
  const title = note.title.trim();
  if (title) return title;
  return portableNoteFilename(note).replace(/--[^-]+\.md$/i, "");
}

export function formatNoteLink(
  note: PortableNote,
  options: {
    format?: "wiki" | "markdown";
    heading?: string;
    label?: string;
  } = {},
): string {
  const format = options.format ?? "wiki";
  const filename = portableNoteFilename(note);
  const wikiFilename = filename.replace(/\.md$/i, "");
  const heading = options.heading?.trim();
  const wikiHeading = heading?.replace(/[%#|[\]\\\r\n]/g, encodeRFC3986);
  const target =
    format === "markdown"
      ? `${encodePath(filename)}${heading ? `#${encodeHeading(heading)}` : ""}`
      : `${wikiFilename}${wikiHeading ? `#${wikiHeading}` : ""}`;
  if (format === "markdown") {
    const label = (options.label ?? fallbackLabel(note))
      .replace(/[\r\n]+/g, " ")
      .replace(/([\\[\]])/g, "\\$1");
    return `[${label}](${target})`;
  }
  const label = (options.label ?? fallbackLabel(note))
    .replace(/[\r\n]+/g, " ")
    .trim();
  const safeLabel = label.replace(/([\\\]|])/g, "\\$1");
  return `[[${target}${safeLabel ? `|${safeLabel}` : ""}]]`;
}

function hasScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function unsafeRelative(value: string): boolean {
  return (
    !value ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith("//") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    hasScheme(value)
  );
}

function decodeURIValue(value: string): string | null {
  try {
    // A Markdown destination is URI encoded, including reserved characters
    // such as `%23` in a filename. decodeURI intentionally leaves those
    // escapes alone, so decode the individual destination component fully.
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function splitTarget(
  value: string,
): { target: string; heading?: string } | null {
  const hash = value.indexOf("#");
  const target = hash < 0 ? value : value.slice(0, hash);
  const heading = hash < 0 ? undefined : value.slice(hash + 1);
  if ((!target && !heading) || heading?.startsWith("^") || target.includes("^"))
    return null;
  return { target, ...(heading ? { heading } : {}) };
}

function unescapeWiki(value: string): string {
  return value.replace(/\\([\\|\]])/g, "$1");
}

function firstUnescaped(value: string, character: string): number {
  for (let i = 0; i < value.length; i++) {
    if (value[i] === character && !escapedAt(value, i)) return i;
  }
  return -1;
}

/** Parse an Obsidian wikilink or a relative Markdown link destination. */
export function parseNoteLink(href: string): ParsedNoteLink | null {
  if (typeof href !== "string" || !href || href.startsWith("!")) return null;
  if (href.startsWith("[[") && href.endsWith("]]")) {
    const raw = href.slice(2, -2);
    if (!raw || raw.includes("\n") || raw.startsWith("!")) return null;
    const separator = firstUnescaped(raw, "|");
    const destination = separator < 0 ? raw : raw.slice(0, separator);
    const label =
      separator < 0 ? undefined : unescapeWiki(raw.slice(separator + 1).trim());
    if (!destination.trim() || (separator >= 0 && !label)) return null;
    const split = splitTarget(destination.trim());
    if (!split || (split.target && unsafeRelative(split.target.trim())))
      return null;
    // Hand-written Wikilinks contain heading text, so a literal trailing `%`
    // is valid even though it is not a valid URL escape.
    const heading = split.heading
      ? (decodeURIValue(split.heading) ?? split.heading)
      : undefined;
    if (split.heading && (heading == null || heading.startsWith("^")))
      return null;
    return {
      target: unescapeWiki(split.target.trim()),
      ...(heading ? { heading } : {}),
      ...(label ? { label } : {}),
      syntax: "wiki",
    };
  }
  if (href.includes("\n") || href.startsWith("[") || href.startsWith("!"))
    return null;
  const value = href.trim();
  if (value.startsWith("<") && value.endsWith(">")) {
    return parseNoteLink(value.slice(1, -1));
  }
  const split = splitTarget(value);
  if (!split) return null;
  const target = decodeURIValue(split.target);
  const heading = split.heading ? decodeURIValue(split.heading) : undefined;
  if (
    target === null ||
    (split.heading && (heading == null || heading.startsWith("^"))) ||
    (target !== "" && unsafeRelative(target))
  ) {
    return null;
  }
  return {
    target,
    ...(heading ? { heading } : {}),
    syntax: "markdown",
  };
}

function canonicalPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function logicalFilename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const path = normalized
    .split("/")
    .map((part) => part.replace(/^(?:zmd-)+/i, ""))
    .join("/");
  return path.replace(MARKDOWN_EXT, "");
}

function noteMatchesTarget(note: PortableNote, target: string): boolean {
  const wanted = canonicalPath(target);
  const actual = canonicalPath(note.filename);
  const logical = logicalFilename(note.filename);
  const portable = canonicalPath(portableNoteFilename(note));
  const wantedLogical = logicalFilename(target);
  const title = canonicalPath(note.title.trim());
  const titleLogical = logicalFilename(note.title.trim());
  const fold = (value: string) => value.toLocaleLowerCase();
  const basename = wanted.split("/").at(-1) || wanted;
  const stableKey = !wanted.includes("/")
    ? /--([A-Za-z0-9]{8})(?:\.md)?$/i.exec(basename)?.[1]
    : undefined;
  if (stableKey && stableKey === note.key) return true;
  if (
    fold(wanted) === fold(portable) ||
    fold(wanted) === fold(actual) ||
    fold(wantedLogical) === fold(logical) ||
    fold(wanted) === fold(title) ||
    fold(wantedLogical) === fold(titleLogical)
  )
    return true;
  // Obsidian commonly omits the extension and resolves a vault-relative bare
  // filename. A basename fallback is safe only when the caller later checks
  // uniqueness.
  if (!wanted.includes("/")) {
    return (
      fold(actual.split("/").at(-1) || "") === fold(wanted) ||
      fold(logical.split("/").at(-1) || "") === fold(wantedLogical) ||
      fold(portable.split("/").at(-1) || "") === fold(wanted)
    );
  }
  return false;
}

function unsupportedHref(href: string): boolean {
  const value = typeof href === "string" ? href.trim() : "";
  const hash = value.indexOf("#");
  let block = /#\^/.test(value);
  if (!block && hash >= 0) {
    try {
      block = decodeURIComponent(value.slice(hash + 1)).startsWith("^");
    } catch {
      // A malformed escape is handled as an unresolved destination below.
    }
  }
  return (
    value.startsWith("!") ||
    block ||
    (hasScheme(value) && !parseDocumentLink(value.split("#", 1)[0])) ||
    /^\s*(?:\/|\\|\/\/|[A-Za-z]:[\\/])/.test(value)
  );
}

export function resolveNoteLink(
  href: string,
  current: PortableNote,
  notes: readonly PortableNote[],
):
  | { status: "resolved"; note: PortableNote; heading?: string }
  | { status: "ambiguous"; notes: PortableNote[] }
  | { status: "unresolved" }
  | { status: "unsupported" } {
  const raw = typeof href === "string" ? href.trim() : "";
  if (unsupportedHref(raw)) return { status: "unsupported" };

  const parsed: ParsedNoteLink | null = parseNoteLink(raw);
  const oldReference = parseDocumentLink(raw.split("#", 1)[0]);
  let heading: string | undefined;
  if (oldReference) {
    const hash = raw.indexOf("#");
    heading =
      hash < 0 ? undefined : (decodeURIValue(raw.slice(hash + 1)) ?? undefined);
  } else {
    if (!parsed) return { status: "unresolved" };
    heading = parsed.heading;
  }

  const sameLibrary = notes.filter((note) => {
    if (note.libraryID !== current.libraryID) return false;
    if (oldReference?.scope === "group") {
      return (
        note.groupID === oldReference.groupID && note.key === oldReference.key
      );
    }
    if (oldReference?.scope === "library") {
      return !note.groupID && note.key === oldReference.key;
    }
    return true;
  });
  const matches = oldReference
    ? sameLibrary
    : parsed!.target === ""
      ? [current]
      : sameLibrary.filter((note) => noteMatchesTarget(note, parsed!.target));
  if (matches.length === 1) {
    return {
      status: "resolved",
      note: matches[0],
      ...(heading ? { heading } : {}),
    };
  }
  if (matches.length > 1) return { status: "ambiguous", notes: [...matches] };
  return { status: "unresolved" };
}

interface Line {
  start: number;
  end: number;
  text: string;
}

function linesOf(content: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const full = match[0];
    if (!full) break;
    const text = full.replace(/\r?\n$|\r$/, "");
    lines.push({ start, end: start + text.length, text });
    start += full.length;
  }
  return lines;
}

function frontmatterLineRange(
  lines: readonly Line[],
): { from: number; to: number } | null {
  if (!lines.length || !/^\uFEFF?---[ \t]*$/.test(lines[0].text)) return null;
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i].text)) {
      return { from: lines[0].start, to: lines[i].end };
    }
  }
  return { from: lines[0].start, to: lines.at(-1)!.end };
}

interface ParsedMarkdownRanges {
  ignored: NoteIgnoredRange[];
  images: NoteIgnoredRange[];
  headings: Array<{ from: number; to: number; level: number }>;
  links: Array<{ from: number; to: number; href: string; label: string }>;
}

function syntaxRanges(content: string): ParsedMarkdownRanges {
  const tree = PARSER.parse(content);
  const ignored: NoteIgnoredRange[] = [];
  const images: NoteIgnoredRange[] = [];
  const headings: Array<{ from: number; to: number; level: number }> = [];
  const links: Array<{
    from: number;
    to: number;
    href: string;
    label: string;
  }> = [];
  const cursor = tree.cursor();
  const visit = (): void => {
    const { name } = cursor.type;
    if (
      name === "FencedCode" ||
      name === "CodeBlock" ||
      name === "InlineCode" ||
      name === "CommentBlock"
    ) {
      ignored.push({ from: cursor.from, to: cursor.to });
    } else if (name === "Image") {
      images.push({ from: cursor.from, to: cursor.to });
    } else if (name === "Link") {
      let url: { from: number; to: number } | undefined;
      let child = cursor.node.firstChild;
      while (child) {
        if (child.name === "URL") {
          url = { from: child.from, to: child.to };
          break;
        }
        child = child.nextSibling;
      }
      if (url) {
        const rawURL = content.slice(url.from, url.to);
        const href =
          rawURL.startsWith("<") && rawURL.endsWith(">")
            ? rawURL.slice(1, -1)
            : rawURL;
        const close = content.lastIndexOf("]", url.from - 1);
        links.push({
          from: cursor.from,
          to: cursor.to,
          href,
          label:
            close > cursor.from ? content.slice(cursor.from + 1, close) : "",
        });
      }
    }
    const atx = /^ATXHeading([1-6])$/.exec(name);
    const setext = /^SetextHeading([12])$/.exec(name);
    if (atx || setext) {
      headings.push({
        from: cursor.from,
        to: cursor.to,
        level: Number((atx || setext)![1]),
      });
    }
    if (cursor.firstChild()) {
      do visit();
      while (cursor.nextSibling());
      cursor.parent();
    }
  };
  visit();
  const frontmatter = frontmatterLineRange(linesOf(content));
  if (frontmatter) ignored.push(frontmatter);
  ignored.sort((a, b) => a.from - b.from || a.to - b.to);
  images.sort((a, b) => a.from - b.from || a.to - b.to);
  headings.sort((a, b) => a.from - b.from);
  links.sort((a, b) => a.from - b.from);
  return { ignored, images, headings, links };
}

/** Source ranges that must not be rewritten as Markdown links. */
export function noteIgnoredRanges(content: string): NoteIgnoredRange[] {
  return syntaxRanges(content).ignored;
}

function escapedAt(value: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

function inNoteRange(
  index: number,
  ranges: readonly NoteIgnoredRange[],
): boolean {
  return ranges.some((range) => index >= range.from && index < range.to);
}

function findWikiEnd(line: string, from: number): number {
  for (let i = from + 2; i < line.length - 1; i++) {
    if (line[i] === "]" && line[i + 1] === "]" && !escapedAt(line, i))
      return i + 2;
  }
  return -1;
}

export function extractNoteLinks(content: string): ExtractedNoteLink[] {
  if (!content) return [];
  const lines = linesOf(content);
  const parsed = syntaxRanges(content);
  const links: ExtractedNoteLink[] = [];
  lines.forEach((line) => {
    for (let i = 0; i < line.text.length; i++) {
      const absolute = line.start + i;
      if (
        inNoteRange(absolute, parsed.ignored) ||
        parsed.images.some(
          (image) => absolute >= image.from && absolute < image.to,
        ) ||
        escapedAt(line.text, i)
      )
        continue;
      if (line.text.startsWith("[[", i)) {
        if (i > 0 && line.text[i - 1] === "!") continue;
        const to = findWikiEnd(line.text, i);
        if (
          to < 0 ||
          inNoteRange(line.start + to - 1, parsed.ignored) ||
          parsed.images.some(
            (image) =>
              line.start + to - 1 >= image.from &&
              line.start + to - 1 < image.to,
          )
        )
          continue;
        const raw = line.text.slice(i, to);
        const inner = raw.slice(2, -2);
        const separator = firstUnescaped(inner, "|");
        const target = unescapeWiki(
          (separator < 0 ? inner : inner.slice(0, separator)).trim(),
        );
        const label =
          separator < 0
            ? target
            : unescapeWiki(inner.slice(separator + 1).trim());
        if (
          (!target && !target.includes("#")) ||
          !label ||
          inner.includes("\n")
        )
          continue;
        links.push({
          from: line.start + i,
          to: line.start + to,
          href: raw,
          label,
          syntax: "wiki",
        });
        i = to - 1;
        continue;
      }
    }
  });
  for (const link of parsed.links) {
    if (
      parsed.ignored.some(
        (range) => link.from < range.to && link.to > range.from,
      ) ||
      links.some(
        (existing) =>
          existing.syntax === "wiki" &&
          link.from >= existing.from &&
          link.to <= existing.to,
      ) ||
      links.some(
        (existing) => existing.from === link.from && existing.to === link.to,
      )
    )
      continue;
    links.push({ ...link, syntax: "markdown" });
  }
  return links.sort((a, b) => a.from - b.from);
}

function inlineText(value: string): string {
  const tokens = INLINE_MARKDOWN.parseInline(value, {});
  let text = "";
  for (const token of tokens[0]?.children || []) {
    if (
      token.type === "text" ||
      token.type === "code_inline" ||
      token.type === "image"
    ) {
      text += token.content;
    } else if (token.type === "softbreak" || token.type === "hardbreak") {
      text += " ";
    }
  }
  return text;
}

/** Display spelling only; raw Zotero URIs need a host-resolved title. */
export function noteLinkLabel(link: ExtractedNoteLink): string {
  const note = parseNoteLink(link.href);
  if (note?.syntax === "wiki" && note.label !== undefined)
    return inlineText(note.label).trim();
  if (link.syntax === "markdown" && link.label.trim()) {
    const label = inlineText(link.label).trim();
    return parseDocumentLink(label) || isPdfDocumentLink(label) ? "" : label;
  }
  if (note) {
    const target = (decodeURIValue(note.target) ?? note.target)
      .split(/[\\/]/)
      .at(-1)!
      .replace(/^(?:zmd-)+/i, "")
      .replace(MARKDOWN_EXT, "")
      .replace(/--[A-Za-z0-9]{8}$/, "");
    return [target, note.heading].filter(Boolean).join(" › ");
  }
  const label = inlineText(link.label).trim();
  return parseDocumentLink(label) || isPdfDocumentLink(label) ? "" : label;
}

/** Keep the actual mention visible without changing its source navigation offset. */
export function noteLinkExcerpt(
  content: string,
  link: ExtractedNoteLink,
  links: readonly ExtractedNoteLink[],
): string {
  const lineStart = content.lastIndexOf("\n", link.from - 1) + 1;
  const newline = content.indexOf("\n", link.to);
  const lineEnd = newline < 0 ? content.length : newline;
  let start = Math.max(lineStart, link.from - 120);
  let end = Math.min(lineEnd, link.to + 120);
  // Do not cut another link in half and expose its destination or storage key.
  const nearby = links.filter(
    (entry) => entry.from < lineEnd && entry.to > lineStart,
  );
  for (const entry of nearby) {
    if (entry.from < start && entry.to > start) start = entry.from;
    if (entry.from < end && entry.to > end) end = entry.to;
  }
  const displayRange = (from: number, to: number) => {
    const parts: string[] = [];
    let cursor = from;
    for (const entry of nearby) {
      if (entry.from < from || entry.to > to) continue;
      parts.push(content.slice(cursor, entry.from), noteLinkLabel(entry));
      cursor = entry.to;
    }
    parts.push(content.slice(cursor, to));
    return parts.join("");
  };
  const before = displayRange(start, link.from);
  const raw = before + noteLinkLabel(link) + displayRange(link.to, end);
  const text = Array.from(inlineText(raw).replace(/\s+/g, " "));
  const anchor = Array.from(inlineText(before).replace(/\s+/g, " ")).length;
  const from = Math.max(0, anchor - 80);
  const to = from + 238;
  const snippet = text.slice(from, to).join("").trim();
  return `${start > lineStart || from > 0 ? "…" : ""}${snippet}${
    end < lineEnd || to < text.length ? "…" : ""
  }`;
}

function headingText(raw: string, setext = false): string {
  let value = raw;
  if (setext) {
    const lines = value.split(/\r?\n/);
    const marker = lines
      .at(-1)
      ?.replace(/^ {0,3}>[ \t]?/, "")
      .trim();
    if (marker && /^(?:=+|-+)$/.test(marker)) lines.pop();
    value = lines
      .map((line) => line.replace(/^ {0,3}>[ \t]?/, "").trim())
      .filter(Boolean)
      .join(" ");
  }
  value = value
    .replace(/^ {0,3}#{1,6}[ \t]+/, "")
    .replace(/[ \t]+#+[ \t]*$/, "")
    .trim();
  return inlineText(value).trim();
}

export function noteHeadings(
  content: string,
): { text: string; from: number; level: number }[] {
  const parsed = syntaxRanges(content);
  return parsed.headings.flatMap(({ from, to, level }) => {
    if (parsed.ignored.some((range) => from < range.to && to > range.from))
      return [];
    const text = headingText(
      content.slice(from, to),
      level <= 2 && /\n/.test(content.slice(from, to)),
    );
    return text ? [{ text, from, level }] : [];
  });
}

function decodeHeading(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function headingSlug(value: string): string {
  return headingText(decodeHeading(value))
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

export function noteHeadingPosition(
  content: string,
  heading: string,
): number | null {
  const wantedText = headingText(decodeHeading(heading)).toLocaleLowerCase();
  const wantedSlug = headingSlug(heading);
  const headings = noteHeadings(content);
  const seen = new Map<string, number>();
  for (const item of headings) {
    const text = item.text.toLocaleLowerCase();
    const slug = headingSlug(item.text);
    const occurrence = seen.get(slug) ?? 0;
    seen.set(slug, occurrence + 1);
    if (
      text === wantedText ||
      slug === wantedSlug ||
      `${slug}-${occurrence}` === wantedSlug
    ) {
      return item.from;
    }
  }
  return null;
}
