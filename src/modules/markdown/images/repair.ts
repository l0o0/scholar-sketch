import { parser as markdownParser } from "@lezer/markdown";
import MarkdownIt from "markdown-it";
import { getString } from "../../../utils/locale";
import { FileConflictError } from "../../file-safety";
import { stripFrontmatter } from "../frontmatter";
import {
  markAttachmentForUpload,
  withAttachmentWrite,
} from "../../attachment-sync";
import {
  MAX_IMAGE_BYTES,
  assetReferenceCandidates,
  mimeFromAssetPath,
  parseMarkdownImages,
  referencedAssets,
} from "./model";

export type ImageAssetRepairStatus =
  "healthy" | "repairable" | "repaired" | "missing" | "conflict" | "failed";

export interface ImageAssetRepairEntry {
  reference: string;
  status: ImageAssetRepairStatus;
  sourcePath?: string;
  targetPath?: string;
  reason?: string;
}

export interface ImageAssetRepairReport {
  checked: number;
  healthy: number;
  repairable: number;
  repaired: number;
  missing: number;
  conflicts: number;
  failed: number;
  retainedOriginals: number;
  canRepair: boolean;
  /** Unreferenced root-level assets-prefixed images are never guessed at. */
  skippedPaths: string[];
  entries: ImageAssetRepairEntry[];
}

interface Context {
  item: Zotero.Item;
  root: string;
  assets: string;
  path: string;
  markdown: string;
}

interface Plan {
  entry: ImageAssetRepairEntry;
  sources: string[];
  target: string;
}

function editable(item: Zotero.Item) {
  const library = Zotero.Libraries.get(item.libraryID);
  return Boolean(
    item.isEditable() && library && library.editable && library.filesEditable,
  );
}

function assertEditable(item: Zotero.Item) {
  if (!editable(item)) throw new Error(getString("error-read-only-image"));
  if (
    [1, 4, 5, "to_download", "force_download", "in_conflict"].includes(
      item.attachmentSyncState as number | string,
    )
  ) {
    const error = new Error(getString("attachment-sync-conflict"));
    Object.assign(error, { code: "ATTACHMENT_SYNC_CONFLICT" });
    throw error;
  }
}

/** IOUtils.stat follows symlinks, so inspect the nsIFile itself first. */
async function fileInfo(path: string, type: "regular" | "directory") {
  const file = Zotero.File.pathToFile(path);
  if (file.isSymlink()) throw new Error("Symbolic links cannot be repaired");
  const info = await IOUtils.stat(path);
  if (info.type !== type) throw new Error(`Expected a ${type} file`);
  return info;
}

async function assertDocument(context: Context) {
  await fileInfo(context.root, "directory");
  await fileInfo(context.path, "regular");
  if (
    String(await Zotero.File.getContentsAsync(context.path)) !==
    context.markdown
  )
    throw new FileConflictError();
}

async function getContext(
  item: Zotero.Item,
  markdown: string,
): Promise<Context> {
  if (!item.isStoredFileAttachment?.())
    throw new Error(getString("error-stored-image-only"));
  if (!item.attachmentContentType?.startsWith("text/"))
    throw new Error(getString("error-not-text-attachment"));
  const root = Zotero.Attachments.getStorageDirectory(item).path;
  const path = await item.getFilePathAsync();
  if (!path || PathUtils.parent(path) !== root)
    throw new Error("Markdown attachment is not in its storage directory");
  const context = {
    item,
    root,
    path,
    markdown,
    assets: PathUtils.join(root, "assets"),
  };
  await assertDocument(context);
  return context;
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function supportedImage(bytes: Uint8Array, reference: string) {
  const starts = (...prefix: number[]) =>
    prefix.every((byte, i) => bytes[i] === byte);
  switch (mimeFromAssetPath(reference)) {
    case "image/png":
      return starts(137, 80, 78, 71, 13, 10, 26, 10);
    case "image/jpeg":
      return starts(255, 216, 255);
    case "image/gif":
      return (
        starts(71, 73, 70, 56) && [55, 57].includes(bytes[4]) && bytes[5] === 97
      );
    case "image/webp":
      return (
        starts(82, 73, 70, 70) &&
        [87, 69, 66, 80].every((byte, i) => bytes[8 + i] === byte)
      );
    default:
      return false;
  }
}

async function readImage(path: string, reference: string) {
  const before = await fileInfo(path, "regular");
  if (!before.size || before.size > MAX_IMAGE_BYTES)
    throw new Error("Image is empty or exceeds the supported size");
  const bytes = await IOUtils.read(path, { maxBytes: MAX_IMAGE_BYTES + 1 });
  const after = await fileInfo(path, "regular");
  if (
    before.size !== after.size ||
    before.lastModified !== after.lastModified ||
    bytes.length !== after.size
  )
    throw new Error("Image changed during inspection");
  if (!supportedImage(bytes, reference))
    throw new Error("Unrecognized image contents");
  return bytes;
}

function references(markdown: string): string[][] {
  // The model's lightweight image parser also sees examples in code blocks.
  // Repair must only act on rendered references, unlike conservative cleanup.
  const code: Array<{ from: number; to: number }> = [];
  const bodyOffset = markdown.length - stripFrontmatter(markdown).body.length;
  if (bodyOffset) code.push({ from: 0, to: bodyOffset });
  for (const match of markdown.matchAll(/<!--[\s\S]*?(?:-->|$)/g))
    code.push({ from: match.index, to: match.index + match[0].length });
  markdownParser.parse(markdown).iterate({
    enter({ node }) {
      if (["FencedCode", "CodeBlock", "InlineCode"].includes(node.name)) {
        code.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  const allowed = new Set(referencedAssets(markdown));
  const groups = new Map<string, string[]>();
  for (const image of parseMarkdownImages(markdown)) {
    if (code.some(({ from, to }) => image.from >= from && image.to <= to))
      continue;
    const candidates = assetReferenceCandidates(image.source).filter(
      (reference) => allowed.has(reference) && mimeFromAssetPath(reference),
    );
    if (candidates.length) groups.set(candidates.join("\n"), candidates);
  }
  return [...groups.values()];
}

function summarize(
  entries: ImageAssetRepairEntry[],
  canRepair: boolean,
  skippedPaths: string[],
  retainedOriginals = 0,
): ImageAssetRepairReport {
  const count = (status: ImageAssetRepairStatus) =>
    entries.filter((entry) => entry.status === status).length;
  return {
    checked: entries.length,
    healthy: count("healthy"),
    repairable: count("repairable"),
    repaired: count("repaired"),
    missing: count("missing"),
    conflicts: count("conflict"),
    failed: count("failed"),
    retainedOriginals,
    canRepair,
    skippedPaths,
    entries,
  };
}

async function inspect(context: Context) {
  const children = await IOUtils.getChildren(context.root);
  const rootFiles = new Map(
    children.map((path) => [PathUtils.filename(path), path]),
  );
  const rawReferences = parseMarkdownImages(context.markdown).map(
    ({ source }) => source,
  );
  const unescape = new MarkdownIt().utils.unescapeAll;
  markdownParser.parse(context.markdown).iterate({
    enter({ node }) {
      if (node.name !== "URL") return;
      const value = context.markdown.slice(node.from, node.to);
      rawReferences.push(
        unescape(
          value.startsWith("<") && value.endsWith(">")
            ? value.slice(1, -1)
            : value,
        ),
      );
    },
  });
  for (const match of context.markdown.matchAll(
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  ))
    rawReferences.push(unescape(match[1] ?? match[2] ?? match[3]));
  const directReferences = new Set(
    rawReferences.flatMap((source) => {
      const values = [source];
      try {
        values.push(decodeURIComponent(source));
      } catch {
        /* literal percent */
      }
      return values.map((value) => value.replace(/^\.\//, ""));
    }),
  );
  const used = new Set<string>();
  const entries: ImageAssetRepairEntry[] = [];
  const plans: Plan[] = [];
  for (const candidates of references(context.markdown)) {
    const entry: ImageAssetRepairEntry = {
      reference: candidates[0],
      status: "missing",
    };
    entries.push(entry);
    try {
      if (await IOUtils.exists(context.assets))
        await fileInfo(context.assets, "directory");
      const matches: Array<{
        reference: string;
        target: string;
        sources: string[];
        targetBytes?: Uint8Array;
      }> = [];
      for (const reference of candidates) {
        const filename = reference.slice("assets/".length);
        const target = PathUtils.join(context.assets, filename);
        const sources = [`assets${filename}`, `assets\\${filename}`]
          .map((name) => rootFiles.get(name))
          .filter((path): path is string => Boolean(path));
        for (const source of sources) used.add(source);
        const targetBytes = (await IOUtils.exists(target))
          ? await readImage(target, reference)
          : undefined;
        if (sources.length || targetBytes)
          matches.push({ reference, target, sources, targetBytes });
      }
      // A percent-encoded literal filename and its decoded name may both exist.
      // Do not choose one and silently relocate the wrong original.
      if (matches.length > 1 && matches.some(({ sources }) => sources.length))
        throw new Error("Literal and decoded image paths are ambiguous");
      const match = matches[0];
      if (!match) continue;
      entry.targetPath = match.target;
      if (!match.sources.length) {
        entry.status = "healthy";
        continue;
      }
      entry.sourcePath = match.sources[0];
      if (
        match.sources.some((source) =>
          directReferences.has(PathUtils.filename(source)),
        )
      )
        throw new Error(
          "The old filename is also directly referenced; original retained",
        );
      const bytes = await readImage(match.sources[0], match.reference);
      for (const source of match.sources.slice(1)) {
        if (!equalBytes(bytes, await readImage(source, match.reference)))
          throw new Error("Multiple originals have different contents");
      }
      if (match.targetBytes && !equalBytes(bytes, match.targetBytes))
        throw new Error("Existing assets image has different contents");
      entry.status = "repairable";
      // Overlapping encoded and decoded references may refer to one image.
      const previous = plans.find((plan) => plan.target === match.target);
      if (previous) {
        entries.pop();
        continue;
      }
      plans.push({ entry, target: match.target, sources: match.sources });
    } catch (error) {
      entry.status = "conflict";
      entry.reason = error instanceof Error ? error.message : String(error);
    }
  }
  const skippedPaths = children.filter((path) => {
    const name = PathUtils.filename(path);
    return (
      name.startsWith("assets") &&
      /\.(?:png|jpe?g|gif|webp)$/i.test(name) &&
      !used.has(path)
    );
  });
  return { entries, plans, skippedPaths };
}

/** Read-only check against the current on-disk Markdown, not an unsaved draft. */
export async function inspectImageAssets(
  item: Zotero.Item,
  markdown: string,
): Promise<ImageAssetRepairReport> {
  const result = await inspect(await getContext(item, markdown));
  return summarize(result.entries, editable(item), result.skippedPaths);
}

/**
 * Repair only references with an exact, unambiguous flattened original.
 * Originals survive failed writes/metadata saves. Identical existing copies
 * remain repairable so retry can finish publishing and removing the old name.
 * This function owns the attachment write gate; callers must not hold it.
 */
export async function repairImageAssets(
  item: Zotero.Item,
  markdown: string,
  options: { waitForSync?: boolean; shouldProceed?: () => boolean } = {},
): Promise<ImageAssetRepairReport> {
  assertEditable(item);
  const assertCurrent = () => {
    if (options.shouldProceed?.() === false)
      throw new Error("Image repair deferred while the document is changing");
  };
  return withAttachmentWrite(
    item,
    async () => {
      assertCurrent();
      assertEditable(item);
      const context = await getContext(item, markdown);
      const { entries, plans, skippedPaths } = await inspect(context);
      let retainedOriginals = 0;
      for (const plan of plans) {
        let temporary: string | undefined;
        try {
          assertCurrent();
          assertEditable(item);
          await assertDocument(context);
          const bytes = await readImage(plan.sources[0], plan.entry.reference);
          for (const source of plan.sources.slice(1)) {
            if (
              !equalBytes(bytes, await readImage(source, plan.entry.reference))
            )
              throw new Error("Original image changed before repair");
          }
          await IOUtils.makeDirectory(context.assets, { ignoreExisting: true });
          await fileInfo(context.assets, "directory");
          if (await IOUtils.exists(plan.target)) {
            if (
              !equalBytes(
                bytes,
                await readImage(plan.target, plan.entry.reference),
              )
            )
              throw new Error("Existing assets image has different contents");
          } else {
            temporary = PathUtils.join(
              context.assets,
              `.scholar-image-repair-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
            );
            await IOUtils.write(temporary, bytes, {
              mode: "create",
              flush: true,
            });
            await fileInfo(context.assets, "directory");
            await IOUtils.move(temporary, plan.target, { noOverwrite: true });
            temporary = undefined;
          }
          const previousState = item.attachmentSyncState;
          try {
            assertCurrent();
            assertEditable(item);
            await assertDocument(context);
            await markAttachmentForUpload(item, { packageChanged: true });
          } catch (error) {
            // A failed saveTx leaves the setter's in-memory value behind. Restore
            // only that value, never erase a newer download/conflict state.
            if (
              [0, "to_upload"].includes(
                item.attachmentSyncState as number | string,
              ) &&
              ![0, "to_upload"].includes(previousState as number | string)
            )
              item.attachmentSyncState = previousState;
            throw error;
          }
          plan.entry.status = "repaired";
          for (const source of plan.sources) {
            try {
              assertCurrent();
              assertEditable(item);
              await assertDocument(context);
              await fileInfo(context.assets, "directory");
              if (
                !equalBytes(
                  bytes,
                  await readImage(source, plan.entry.reference),
                ) ||
                !equalBytes(
                  bytes,
                  await readImage(plan.target, plan.entry.reference),
                )
              )
                throw new Error(
                  "Image changed after repair; original retained",
                );
              await IOUtils.remove(source);
            } catch (error) {
              retainedOriginals++;
              plan.entry.reason =
                error instanceof Error ? error.message : String(error);
            }
          }
        } catch (error) {
          plan.entry.status = "failed";
          plan.entry.reason =
            error instanceof Error ? error.message : String(error);
          retainedOriginals += plan.sources.length;
        } finally {
          if (temporary)
            await IOUtils.remove(temporary, { ignoreAbsent: true }).catch(
              () => undefined,
            );
        }
      }
      return summarize(
        entries,
        editable(item),
        skippedPaths,
        retainedOriginals,
      );
    },
    undefined,
    { waitForSync: options.waitForSync },
  );
}
