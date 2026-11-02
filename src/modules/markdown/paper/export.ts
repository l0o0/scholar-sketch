import { chineseDocumentTerms } from "./translations";
import { parseMarkdownImages } from "../images/model";
import { noteIgnoredRanges } from "../note-links";

/** Portable citation identities: library/item IDs never enter the manuscript. */
export function citationKey(library: "user" | number, key: string): string {
  return `zotero-${library === "user" ? "user" : `group-${library}`}-${key}`;
}

export function parseCitationKey(value: string) {
  const match = /^zotero-(user|group-([1-9]\d*))-([A-Z0-9]{8})$/.exec(value);
  return match
    ? {
        library: match[1] === "user" ? ("user" as const) : Number(match[2]),
        key: match[3],
      }
    : null;
}

export type PaperErrorCode =
  "conversion" | "citation" | "image" | "conflict" | "unsupported";
export class PaperExportError extends Error {
  constructor(
    readonly code: PaperErrorCode,
    readonly detail = "",
    options?: ErrorOptions,
  ) {
    super(`${code}: ${detail}`, options);
    this.name = "PaperExportError";
  }
}

export interface PaperOptions {
  source: string;
  csl?: string;
  bibliographyTitle?: string;
  referenceDoc?: string;
  signal: AbortSignal;
}
export interface PaperPorts {
  /** Paths belong to a fresh, private workspace; the caller owns its cleanup. */
  path(...names: string[]): string;
  writeText(path: string, content: string): Promise<void>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  run(args: string[], signal: AbortSignal): Promise<void>;
  reference(id: string): Promise<Record<string, unknown> | null>;
  image(reference: string, signal: AbortSignal): Promise<string>;
  diagram(source: string, signal: AbortSignal): Promise<string>;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Normalize existing editor HTML/wiki image syntax without touching code examples. */
export function paperMarkdown(source: string): string {
  const ignored = noteIgnoredRanges(source);
  for (const image of parseMarkdownImages(source).reverse()) {
    const literal = source.slice(image.from, image.to);
    if (
      !/^<img\b|^!\[\[/i.test(literal) ||
      ignored.some((range) => image.from >= range.from && image.from < range.to)
    )
      continue;
    if ((source.slice(0, image.from).match(/\\+$/)?.[0].length || 0) % 2)
      continue;
    const alt = image.alt.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ");
    const destination = image.source.replace(/</g, "%3C").replace(/>/g, "%3E");
    const replacement = `![${alt}](<${destination}>)${image.width ? `{width=${image.width}px}` : ""}`;
    source = source.slice(0, image.from) + replacement + source.slice(image.to);
  }
  return source;
}

/** Pandoc is the Markdown parser, including citation locators, notes and math. */
export async function convertPaper(
  options: PaperOptions,
  ports: PaperPorts,
): Promise<Uint8Array> {
  const { signal } = options;
  signal.throwIfAborted();
  const input = ports.path("manuscript.md");
  const astPath = ports.path("manuscript.json");
  const bibliography = ports.path("references.json");
  const output = ports.path("paper.docx");
  await ports.writeText(input, paperMarkdown(options.source));
  await ports.writeText(
    ports.path("translations", "zh.yaml"),
    JSON.stringify(chineseDocumentTerms),
  );
  await ports.run(
    [
      "--from=markdown",
      "--to=json",
      "--standalone",
      "--output",
      astPath,
      input,
    ],
    signal,
  );
  const ast: unknown = JSON.parse(await ports.readText(astPath));
  if (
    !record(ast) ||
    !Array.isArray(ast.blocks) ||
    !record(ast.meta) ||
    !Array.isArray(ast["pandoc-api-version"])
  ) {
    throw new PaperExportError("conversion", "Invalid Pandoc document");
  }
  // Manuscript metadata describes the paper; it cannot select files, filters,
  // external bibliographies or resources for the host conversion process.
  const metadata = ast.meta;
  const paperMetadata = Object.fromEntries(
    [
      "title",
      "subtitle",
      "author",
      "date",
      "lang",
      "abstract",
      "keywords",
      "reference-section-title",
    ]
      .filter((key) => key in metadata)
      .map((key) => [key, metadata[key]]),
  );
  ast.meta = paperMetadata;
  if (
    options.bibliographyTitle &&
    !("reference-section-title" in paperMetadata)
  )
    paperMetadata["reference-section-title"] = {
      t: "MetaString",
      c: options.bibliographyTitle,
    };
  const references = new Map<string, Record<string, unknown>>();
  async function visit(value: unknown): Promise<unknown> {
    signal.throwIfAborted();
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const child of value) result.push(await visit(child));
      return result;
    }
    if (!record(value)) return value;
    if (
      value.t === "Cite" &&
      Array.isArray(value.c) &&
      Array.isArray(value.c[0])
    ) {
      for (const citation of value.c[0]) {
        if (!record(citation) || typeof citation.citationId !== "string")
          throw new PaperExportError("conversion");
        const id = citation.citationId;
        if (!references.has(id)) {
          const reference = await ports.reference(id);
          if (!reference) throw new PaperExportError("citation", id);
          references.set(id, { ...reference, id });
        }
      }
    }
    if (
      (value.t === "RawBlock" || value.t === "RawInline") &&
      Array.isArray(value.c)
    ) {
      const raw = String(value.c[1]).trim();
      if (value.c[0] === "html") {
        if (/^<br\b[^>]*>$/i.test(raw)) return { t: "LineBreak" };
        if (/^<hr\b[^>]*>$/i.test(raw)) return { t: "HorizontalRule" };
        // Paragraph wrappers and comments carry no visible content of their own.
        if (
          /^<\/?(?:p|div|span)\b[^>]*>$/i.test(raw) ||
          /^<!--[\s\S]*-->$/.test(raw)
        )
          return value.t === "RawInline"
            ? { t: "Str", c: "" }
            : { t: "Para", c: [] };
      }
      throw new PaperExportError("unsupported", String(value.c[0]));
    }
    if (value.t === "Image" && Array.isArray(value.c)) {
      const target = value.c[2];
      if (!Array.isArray(target) || typeof target[0] !== "string")
        throw new PaperExportError("conversion");
      const reference = target[0];
      try {
        target[0] = await ports.image(reference, signal);
      } catch (error) {
        signal.throwIfAborted();
        throw new PaperExportError("image", reference, { cause: error });
      }
    }
    if (
      value.t === "CodeBlock" &&
      Array.isArray(value.c) &&
      Array.isArray(value.c[0]) &&
      Array.isArray(value.c[0][1]) &&
      value.c[0][1].includes("mermaid")
    ) {
      const image = await ports.diagram(String(value.c[1]), signal);
      return {
        t: "Para",
        c: [{ t: "Image", c: [["", [], []], [], [image, ""]] }],
      };
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value))
      result[key] = await visit(child);
    return result;
  }
  const prepared = await visit(ast);
  signal.throwIfAborted();
  await ports.writeText(astPath, JSON.stringify(prepared));
  await ports.writeText(bibliography, JSON.stringify([...references.values()]));
  const args = [
    "--data-dir",
    ports.path("."),
    "--from=json",
    "--to=docx",
    "--standalone",
    "--fail-if-warnings",
    "--output",
    output,
  ];
  if (references.size) args.push("--citeproc", "--bibliography", bibliography);
  if (options.csl) args.push("--csl", options.csl);
  if (options.referenceDoc) args.push("--reference-doc", options.referenceDoc);
  args.push(astPath);
  await ports.run(args, signal);
  const bytes = await ports.readBytes(output);
  signal.throwIfAborted();
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new PaperExportError("conversion", "Missing DOCX output");
  return bytes;
}

/** Check the chosen destination again, immediately before atomic publication. */
export async function publishPaper(
  bytes: Uint8Array,
  baseline: Uint8Array | null,
  options: {
    read: () => Promise<Uint8Array | null>;
    write: (bytes: Uint8Array) => Promise<void>;
    assertCurrent: () => void;
  },
) {
  const current = await options.read();
  options.assertCurrent();
  if (
    (baseline === null) !== (current === null) ||
    (baseline &&
      current &&
      (baseline.length !== current.length ||
        baseline.some((byte, i) => byte !== current[i])))
  ) {
    throw new PaperExportError("conflict");
  }
  await options.write(bytes);
}
