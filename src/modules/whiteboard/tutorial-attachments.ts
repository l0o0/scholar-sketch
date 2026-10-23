import {
  canvasDocumentToFile,
  parseStoredCanvas,
  serializeCanvasDocument,
} from "../../../packages/whiteboard/src/model/canvas-file";
import type { CanvasDocument } from "./snapshot";
import { parseCanvasDocument } from "../../../packages/whiteboard/src/model/document";
import { markdownApi } from "../markdown/api";
import { createMarkdownAttachment } from "../markdown/create";
import { canvasApi } from "./api";
import { createWhiteboardAttachment } from "./create";
import {
  findTutorialAttachment,
  markTutorialAttachment,
  resolveTutorialMarkdown,
  type TutorialKind,
} from "./tutorial-discovery";

export interface TutorialAttachmentDependencies {
  find(
    kind: TutorialKind,
    titles: readonly string[],
  ): Promise<Zotero.Item | null>;
  resolveMarkdown(key: string): Promise<Zotero.Item | null>;
  mark(item: Zotero.Item, kind: TutorialKind): Promise<void>;
  read(item: Zotero.Item): Promise<string | null>;
  fingerprint(content: string): string;
  baseline(item: Zotero.Item): unknown;
  remember(item: Zotero.Item, fingerprint: string): Promise<void>;
  createMarkdown(content: string, title: string): Promise<Zotero.Item | null>;
  createCanvas(
    document: CanvasDocument,
    title: string,
  ): Promise<Zotero.Item | null>;
  updateMarkdown(
    item: Zotero.Item,
    content: string,
    revision: string,
  ): Promise<void>;
  updateCanvas(
    item: Zotero.Item,
    document: CanvasDocument,
    revision: string,
  ): Promise<void>;
  log(message: string, error?: unknown): void;
}

const markdownTitles = ["开始写作.md", "Start writing.md"];
const canvasTitles = ["Scholar Sketch", "Scholar Canvas", "Bamboo"].flatMap(
  (brand) => [
    `${brand} 学术白板.canvas`,
    `${brand} Academic Whiteboard.canvas`,
  ],
);

/** Normalize viewing state, timestamps, and equivalent editor defaults. */
function canvasContent(document: CanvasDocument): string {
  return JSON.stringify(
    canvasDocumentToFile(
      {
        ...document,
        viewport: { x: 0, y: 0, zoom: 1 },
        metadata: { ...document.metadata, createdAt: "" },
        connections: document.connections.map((connection) => ({
          ...connection,
          sourceHandle: connection.sourceHandle ?? "right",
          targetHandle: connection.targetHandle ?? "left",
          dashed: connection.dashed ?? false,
        })),
      },
      { now: "" },
    ),
  );
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

/** Reconcile both assets before opening; a partial creation is reused on retry. */
export async function ensureTutorialAttachments(
  document: CanvasDocument,
  filename: string,
  deps: TutorialAttachmentDependencies = productionDependencies(),
): Promise<Zotero.Item> {
  const desired = parseCanvasDocument(document).document;
  const demo = attachmentNode(desired);
  if (!demo || typeof demo.data.preview !== "string")
    throw new Error("Missing tutorial Markdown content");

  // Search errors must abort, not turn into an apparent empty library.
  const [markdownCandidate, existingCanvas] = await Promise.all([
    deps.find("markdown", [...markdownTitles, demo.data.title]),
    deps.find("canvas", [...canvasTitles, filename]),
  ]);
  let existingMarkdown = markdownCandidate;
  const canvasSource = existingCanvas ? await deps.read(existingCanvas) : null;
  if (existingCanvas && canvasSource === null && !existingMarkdown) {
    throw new Error(
      "Download the existing tutorial canvas before resolving its Markdown partner",
    );
  }
  if (canvasSource !== null) {
    const parsed = parseStoredCanvas(canvasSource);
    if (!parsed.issues.length && isTutorial(parsed.document)) {
      const source = attachmentNode(parsed.document)?.data.source;
      if (source?.library.type === "user") {
        // A linked starter may have been renamed before it acquired a role tag.
        existingMarkdown =
          (await deps.resolveMarkdown(source.attachmentKey)) ??
          existingMarkdown;
      }
    } else if (!existingMarkdown) {
      throw new Error(
        "Cannot resolve the Markdown partner of a malformed tutorial canvas",
      );
    }
  }
  const markdown =
    existingMarkdown ??
    (await deps.createMarkdown(demo.data.preview, demo.data.title));
  if (!markdown) throw new Error("Could not create tutorial Markdown");
  await deps.mark(markdown, "markdown");
  if (existingMarkdown) {
    await refreshMarkdown(markdown, demo.data.preview, demo.data.title, deps);
  } else {
    await deps.remember(markdown, deps.fingerprint(demo.data.preview));
  }

  // Runtime item IDs belong to one database. The user-library key survives sync.
  demo.data.source = { library: { type: "user" }, attachmentKey: markdown.key };
  delete demo.data.attachmentID;
  const canvas = existingCanvas ?? (await deps.createCanvas(desired, filename));
  if (!canvas) throw new Error("Could not create tutorial whiteboard");
  await deps.mark(canvas, "canvas");
  if (existingCanvas) {
    await refreshCanvas(canvas, desired, canvasSource, deps);
  } else {
    await deps.remember(canvas, deps.fingerprint(canvasContent(desired)));
  }
  return canvas;
}

async function refreshMarkdown(
  item: Zotero.Item,
  desired: string,
  title: string,
  deps: TutorialAttachmentDependencies,
) {
  const generatedTitles = [...markdownTitles, title].flatMap((value) => [
    value,
    value.replace(/\.md$/i, ""),
  ]);
  // The editor save path syncs the title from H1. A rename is user customization
  // too; leave that note alone rather than restoring a template heading/title.
  if (!generatedTitles.includes(String(item.getField("title")))) return;
  const current = await deps.read(item);
  if (current === null) return; // Synced metadata can precede file download.
  const fingerprint = deps.fingerprint(current);
  // An unmarked legacy document is only a safe baseline if it matches our template.
  if (current !== desired && fingerprint !== deps.baseline(item)) return;
  if (current !== desired) {
    await deps.updateMarkdown(item, desired, current);
  }
  await deps.remember(item, deps.fingerprint(desired));
}

async function refreshCanvas(
  item: Zotero.Item,
  desired: CanvasDocument,
  current: string | null,
  deps: TutorialAttachmentDependencies,
) {
  if (current === null) return;
  const parsed = parseStoredCanvas(current);
  if (parsed.issues.length) {
    deps.log("Tutorial canvas has parse issues; preserving existing content");
    return;
  }
  const currentContent = canvasContent(parsed.document);
  const desiredContent = canvasContent(desired);
  const managed = deps.fingerprint(currentContent) === deps.baseline(item);
  if (currentContent === desiredContent || managed) {
    if (currentContent !== desiredContent) {
      await deps.updateCanvas(
        item,
        {
          ...desired,
          viewport: parsed.document.viewport,
          metadata: {
            ...desired.metadata,
            createdAt: parsed.document.metadata?.createdAt,
          },
        },
        current,
      );
    }
    await deps.remember(item, deps.fingerprint(desiredContent));
    return;
  }

  // Legacy tutorials have no baseline. Keep every card/edit, repairing only the
  // original demo's machine-local link. An explicit portable link is user-owned.
  const oldDemo = attachmentNode(parsed.document);
  const newDemo = attachmentNode(desired)!;
  if (
    oldDemo &&
    !oldDemo.data.source &&
    [...markdownTitles, newDemo.data.title].includes(oldDemo.data.title) &&
    isTutorial(parsed.document)
  ) {
    oldDemo.data.source = newDemo.data.source;
    delete oldDemo.data.attachmentID;
    await deps.updateCanvas(item, parsed.document, current);
    // Do not bless a previously edited tutorial as a pristine generated baseline.
  }
}

function productionDependencies(): TutorialAttachmentDependencies {
  const libraryID = Zotero.Libraries.userLibraryID;
  const settings = (
    Zotero as typeof Zotero & {
      SyncedSettings: {
        get(libraryID: number, name: string): unknown;
        set(libraryID: number, name: string, value: string): Promise<unknown>;
      };
    }
  ).SyncedSettings;
  const setting = (item: Zotero.Item) => `bamboo.tutorialBaseline.${item.key}`;
  return {
    find: findTutorialAttachment,
    resolveMarkdown: resolveTutorialMarkdown,
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
    fingerprint: (content) => Zotero.Utilities.Internal.md5(content),
    baseline: (item) => settings.get(libraryID, setting(item)),
    remember: async (item, value) => {
      await settings.set(libraryID, setting(item), value);
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
    updateMarkdown: async (item, content, expectedRevision) => {
      await markdownApi.update(item.id, {
        content,
        expectedRevision,
        cleanupImages: false,
      });
    },
    updateCanvas: async (item, document, expectedRevision) => {
      await canvasApi.update(item.id, serializeCanvasDocument(document), {
        expectedRevision,
      });
    },
    log: (message, error) => ztoolkit.log(message, error),
  };
}
