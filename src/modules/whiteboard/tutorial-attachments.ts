import {
  parseStoredCanvas,
  serializeCanvasDocument,
} from "../../../packages/whiteboard/src/model/canvas-file";
import type { CanvasDocument } from "./snapshot";
import { parseCanvasDocument } from "../../../packages/whiteboard/src/model/document";
import { getPref, setPref } from "../../utils/prefs";
import { createMarkdownAttachment } from "../markdown/create";
import { canvasApi } from "./api";
import { createWhiteboardAttachment } from "./create";
import {
  findTutorialAttachment,
  markTutorialAttachment,
  resolveTutorialAttachment,
  type TutorialKind,
} from "./tutorial-discovery";

/** Increment only when the bundled tutorial content changes, not every release. */
export const TUTORIAL_VERSION = 1;

export interface TutorialAttachmentRecord {
  key: string;
  version: number;
}
export type TutorialAttachmentState = Partial<
  Record<TutorialKind, TutorialAttachmentRecord>
>;
export type TutorialAttachmentResult =
  { canvas: Zotero.Item; created: boolean } | { deleted: true };

export interface TutorialAttachmentDependencies {
  find(
    kind: TutorialKind,
    titles: readonly string[],
  ): Promise<Zotero.Item | null>;
  resolve(kind: TutorialKind, key: string): Promise<Zotero.Item | null>;
  state(): TutorialAttachmentState;
  remember(state: TutorialAttachmentState): void;
  mark(item: Zotero.Item, kind: TutorialKind): Promise<void>;
  read(item: Zotero.Item): Promise<string | null>;
  createMarkdown(content: string, title: string): Promise<Zotero.Item | null>;
  createCanvas(
    document: CanvasDocument,
    title: string,
  ): Promise<Zotero.Item | null>;
  updateCanvas(
    item: Zotero.Item,
    document: CanvasDocument,
    revision: string,
  ): Promise<void>;
}

const markdownTitles = ["开始写作.md", "Start writing.md"];
const canvasTitles = ["Scholar Sketch", "Scholar Canvas", "Bamboo"].flatMap(
  (brand) => [
    `${brand} 学术白板.canvas`,
    `${brand} Academic Whiteboard.canvas`,
  ],
);

export function parseTutorialAttachmentState(
  value: unknown,
): TutorialAttachmentState {
  if (value === undefined || value === null || value === "") return {};
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid tutorial attachment configuration");
  const result: TutorialAttachmentState = {};
  for (const kind of ["markdown", "canvas"] as const) {
    const record = (parsed as Record<string, unknown>)[kind];
    if (record === undefined) continue;
    if (!record || typeof record !== "object" || Array.isArray(record))
      throw new Error("Invalid tutorial attachment record");
    const { key, version } = record as Record<string, unknown>;
    if (
      typeof key !== "string" ||
      !/^[A-Z0-9]{8}$/.test(key) ||
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 1
    )
      throw new Error("Invalid tutorial attachment key or version");
    result[kind] = { key, version };
  }
  return result;
}

function attachmentNode(document: CanvasDocument) {
  const node = document.nodes.find((node) => node.id === "tutorial-attachment");
  return node?.kind === "attachment" ? node : undefined;
}
function isTutorial(document: CanvasDocument): boolean {
  return (
    document.nodes.some((node) => node.id === "tutorial-welcome") &&
    document.nodes.some((node) => node.id === "tutorial-title")
  );
}

/** Missing saved items are user deletions; check existence before version. */
export async function tutorialStartupIsCurrent(
  completed: boolean,
  deps: TutorialAttachmentDependencies = productionDependencies(),
  version = TUTORIAL_VERSION,
): Promise<boolean> {
  const state = deps.state();
  if (state.canvas) {
    if (!(await deps.resolve("canvas", state.canvas.key))) return true;
    if (state.markdown && !(await deps.resolve("markdown", state.markdown.key)))
      return true;
    return (
      state.canvas.version >= version &&
      (!state.markdown || state.markdown.version >= version)
    );
  }
  // A partial first creation must finish even if the old completion marker was set.
  if (state.markdown) {
    return !(await deps.resolve("markdown", state.markdown.key));
  }
  // Older installations stored only a completion flag. Adopt a surviving tutorial,
  // but do not resurrect a guide the user already removed.
  return completed && !(await deps.find("canvas", canvasTitles));
}

/** Reuse current tutorials; newer content creates a separate pair without overwriting edits. */
export async function ensureTutorialAttachments(
  document: CanvasDocument,
  filename: string,
  deps: TutorialAttachmentDependencies = productionDependencies(),
  version = TUTORIAL_VERSION,
  mode: "startup" | "manual" = "startup",
): Promise<TutorialAttachmentResult> {
  const desired = parseCanvasDocument(document).document;
  const demo = attachmentNode(desired);
  if (!demo || typeof demo.data.preview !== "string")
    throw new Error("Missing tutorial Markdown content");
  const state = deps.state();
  const foundCanvas = state.canvas
    ? await deps.resolve("canvas", state.canvas.key)
    : // An MD-only record belongs to a pair whose Canvas creation has not finished.
      state.markdown
      ? null
      : await deps.find("canvas", [...canvasTitles, filename]);
  let markdown = state.markdown
    ? await deps.resolve("markdown", state.markdown.key)
    : await deps.find("markdown", [...markdownTitles, demo.data.title]);
  // Recheck after onboarding's sample selection: a user may delete a tutorial
  // while those asynchronous reads are in progress.
  if (
    mode === "startup" &&
    ((state.canvas && !foundCanvas) || (state.markdown && !markdown))
  ) {
    return { deleted: true };
  }

  let canvasSource: string | null = null;
  let missingLinkedKey: string | undefined;
  if (foundCanvas && (!state.canvas || !state.markdown)) {
    canvasSource = await deps.read(foundCanvas);
    if (canvasSource === null && !markdown) {
      throw new Error(
        "Download the existing tutorial canvas before resolving its Markdown partner",
      );
    }
    if (canvasSource !== null) {
      const parsed = parseStoredCanvas(canvasSource);
      if (!parsed.issues.length && isTutorial(parsed.document)) {
        const source = attachmentNode(parsed.document)?.data.source;
        if (source?.library.type === "user") {
          markdown = await deps.resolve("markdown", source.attachmentKey);
          if (!markdown) missingLinkedKey = source.attachmentKey;
        }
      } else if (!markdown) {
        throw new Error(
          "Cannot resolve the Markdown partner of a malformed tutorial canvas",
        );
      }
    }
  }
  // Legacy records cannot tell whether a missing local-ID target was deliberately
  // deleted. Adopt the surviving Canvas and let Help explicitly restore a pair.
  if (foundCanvas && !markdown && mode === "startup") {
    deps.remember({
      canvas: { key: foundCanvas.key, version },
      ...(missingLinkedKey
        ? { markdown: { key: missingLinkedKey, version } }
        : {}),
    });
    return { canvas: foundCanvas, created: false };
  }

  const upgrading = Boolean(
    foundCanvas && state.canvas && state.canvas.version < version,
  );
  let existingCanvas = upgrading || !markdown ? null : foundCanvas;
  if (
    (upgrading && (!state.markdown || state.markdown.version < version)) ||
    (markdown && state.markdown && state.markdown.version < version)
  ) {
    markdown = null;
    existingCanvas = null;
  }
  if (existingCanvas && markdown) {
    await deps.mark(markdown, "markdown");
    await deps.mark(existingCanvas, "canvas");
    // Complete compatibility repair before recording adoption. A failed write
    // leaves discovery eligible for retry, with both original files preserved.
    if (canvasSource !== null)
      await repairLegacyLink(
        existingCanvas,
        markdown,
        desired,
        canvasSource,
        deps,
      );
    deps.remember({
      markdown: {
        key: markdown.key,
        version:
          state.markdown?.key === markdown.key
            ? state.markdown.version
            : version,
      },
      canvas: {
        key: existingCanvas.key,
        version:
          state.canvas?.key === existingCanvas.key
            ? state.canvas.version
            : version,
      },
    });
    return { canvas: existingCanvas, created: false };
  }

  markdown ??= await deps.createMarkdown(demo.data.preview, demo.data.title);
  if (!markdown) throw new Error("Could not create tutorial Markdown");
  const markdownRecord = {
    key: markdown.key,
    version:
      state.markdown?.key === markdown.key
        ? Math.max(version, state.markdown.version)
        : version,
  };
  // Replace the old pair atomically with its new MD identity. If Canvas creation
  // fails, the MD-only record resumes this pair instead of reusing the old Canvas.
  deps.remember({ markdown: markdownRecord });
  await deps.mark(markdown, "markdown");
  demo.data.source = { library: { type: "user" }, attachmentKey: markdown.key };
  delete demo.data.attachmentID;
  const canvas = await deps.createCanvas(desired, filename);
  if (!canvas) throw new Error("Could not create tutorial whiteboard");
  deps.remember({
    markdown: markdownRecord,
    canvas: { key: canvas.key, version },
  });
  await deps.mark(canvas, "canvas");
  return { canvas, created: true };
}

async function repairLegacyLink(
  item: Zotero.Item,
  markdown: Zotero.Item,
  desired: CanvasDocument,
  current: string,
  deps: TutorialAttachmentDependencies,
) {
  const parsed = parseStoredCanvas(current);
  if (parsed.issues.length || !isTutorial(parsed.document)) return;
  const oldDemo = attachmentNode(parsed.document);
  const newDemo = attachmentNode(desired)!;
  if (
    oldDemo &&
    !oldDemo.data.source &&
    [...markdownTitles, newDemo.data.title].includes(oldDemo.data.title)
  ) {
    oldDemo.data.source = {
      library: { type: "user" },
      attachmentKey: markdown.key,
    };
    delete oldDemo.data.attachmentID;
    await deps.updateCanvas(item, parsed.document, current);
  }
}

function productionDependencies(): TutorialAttachmentDependencies {
  const libraryID = Zotero.Libraries.userLibraryID;
  const state = () =>
    parseTutorialAttachmentState(getPref("tutorialAttachments"));
  return {
    find: findTutorialAttachment,
    resolve: resolveTutorialAttachment,
    state,
    remember: (next) => {
      const serialized = JSON.stringify(next);
      if (JSON.stringify(state()) !== serialized)
        setPref("tutorialAttachments", serialized);
    },
    mark: markTutorialAttachment,
    read: async (item) => {
      const path = await item.getFilePathAsync();
      if (!path) return null;
      try {
        return String(await Zotero.File.getContentsAsync(path));
      } catch (error) {
        ztoolkit.log(
          "Tutorial file unavailable; keeping existing attachment",
          item.key,
          error,
        );
        return null;
      }
    },
    createMarkdown: (content, title) =>
      createMarkdownAttachment(null, {
        open: false,
        silent: true,
        libraryID,
        collectionID: null,
        initialContent: content,
        title,
      }),
    createCanvas: (document, filename) =>
      createWhiteboardAttachment(null, {
        document,
        libraryID,
        collections: [],
        filename,
        select: false,
        reportError: false,
      }),
    updateCanvas: async (item, document, expectedRevision) => {
      await canvasApi.update(item.id, serializeCanvasDocument(document), {
        expectedRevision,
      });
    },
  };
}
