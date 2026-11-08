import {
  describeDocumentLinkTargets,
  resolveMarkdownLinkMetadata,
  searchDocumentLinks,
  type DocumentLinkCandidate,
} from "./document-links";
import { isPdfDocumentLink, parseDocumentLink } from "./document-link-shared";
import { isMarkdownAttachment } from "./detect";
import {
  cachedNoteMetadata,
  noteMetadata,
  readSavedNote,
} from "./note-library";
import {
  parseNoteLink,
  resolveNoteLink,
  type PortableNote,
} from "./note-links";
import {
  PreviewWorkerClient,
  type WorkerFactory,
} from "./preview-worker-client";
import { sessionRegistry } from "./session-registry";
import { noteHtmlToText } from "../whiteboard/source-gateway";
import { MAX_WORKER_RENDER_BYTES, utf8ByteLength } from "./async-render";

export type LinkPreviewKind =
  "item" | "markdown" | "note" | "pdf" | "attachment";

interface ResolvedLinkPreview {
  status: "resolved";
  href: string;
  /** Host-only origin for relative links rendered inside this preview. */
  sourceItemID: number;
  title: string;
  subtitle?: string;
  text?: string;
  bodyHtml?: string;
}

export type LinkPreviewContent =
  | (ResolvedLinkPreview & { kind: Exclude<LinkPreviewKind, "pdf"> })
  | (ResolvedLinkPreview & {
      kind: "pdf";
      /** Host-only reader input; never forward this local ID to the iframe. */
      attachmentID: number;
      location?: { pageIndex?: number; annotationID?: string };
    })
  | { status: "unresolved" | "ambiguous" | "unavailable"; href: string };

export interface LinkPreviewContentOptions {
  currentItem: Zotero.Item;
  win: Window;
}

const MAX_SOURCE_CHARS = 64 * 1024;
const MAX_FRAGMENT_CHARS = 12 * 1024;
const MAX_TEXT_CHARS = 2400;

type Target = {
  candidate: DocumentLinkCandidate;
  heading?: string;
  location?: { pageIndex?: number; annotationID?: string };
};

function libraryFor(
  scope: "library" | "group",
  groupID?: number,
): number | null {
  const id =
    scope === "library"
      ? Zotero.Libraries.userLibraryID
      : Zotero.Groups.get(groupID!)?.libraryID;
  return Number.isSafeInteger(id) && id! > 0 ? id! : null;
}

async function directTarget(
  libraryID: number,
  key: string,
): Promise<Target | null> {
  const [candidate] = await describeDocumentLinkTargets([{ libraryID, key }]);
  return candidate ? { candidate } : null;
}

async function resolveTarget(
  href: string,
  { currentItem, win }: LinkPreviewContentOptions,
): Promise<Target | "unresolved" | "ambiguous"> {
  if (isPdfDocumentLink(href)) {
    const match =
      /^zotero:\/\/open-pdf\/(library|groups\/([1-9][0-9]*))\/items\/([A-Za-z0-9]{8})(?:\?(.*))?$/.exec(
        href,
      )!;
    const libraryID = libraryFor(
      match[1] === "library" ? "library" : "group",
      Number(match[2]),
    );
    if (libraryID === null) return "unresolved";
    const target = await directTarget(libraryID, match[3]);
    if (!target) return "unresolved";
    const params = new URLSearchParams(match[4] || "");
    const page = Number(params.get("page"));
    const annotationID = params.get("annotation");
    return {
      ...target,
      location: {
        ...(Number.isSafeInteger(page) && page > 0
          ? { pageIndex: page - 1 }
          : {}),
        ...(annotationID ? { annotationID } : {}),
      },
    };
  }
  const reference = parseDocumentLink(href.split("#", 1)[0]);
  if (reference) {
    const libraryID = libraryFor(
      reference.scope,
      reference.scope === "group" ? reference.groupID : undefined,
    );
    if (libraryID === null) return "unresolved";
    const target = await directTarget(libraryID, reference.key);
    if (!target) return "unresolved";
    const hash = href.indexOf("#");
    if (hash >= 0) target.heading = decodeURIComponent(href.slice(hash + 1));
    return target;
  }
  const parsed = parseNoteLink(href);
  if (!parsed || !currentItem) return "unresolved";
  const current: PortableNote = noteMetadata(currentItem) || {
    libraryID: currentItem.libraryID,
    key: currentItem.key,
    title: "",
    filename: "",
  };
  const notes = cachedNoteMetadata(currentItem.libraryID);
  const cached = resolveNoteLink(href, current, notes);
  if (cached.status === "ambiguous") return "ambiguous";
  if (cached.status === "unsupported") return "unresolved";
  if (cached.status === "resolved") {
    const target = await directTarget(cached.note.libraryID, cached.note.key);
    return target ? { ...target, heading: cached.heading } : "unresolved";
  }
  const stableKey = /--([A-Za-z0-9]{8})(?:\.md)?$/i.exec(parsed.target)?.[1];
  if (stableKey && !parsed.target.includes("/")) {
    const target = await directTarget(currentItem.libraryID, stableKey);
    if (target?.candidate.kind === "markdown")
      return { ...target, heading: parsed.heading };
  }
  const noteTarget = await resolveMarkdownLinkMetadata(currentItem, href);
  if (noteTarget.status === "ambiguous") return "ambiguous";
  if (noteTarget.status === "resolved")
    return { candidate: noteTarget.candidate, heading: parsed.heading };
  if (parsed.syntax !== "wiki") return "unresolved";
  // The filtered completion path reads item/filename metadata, not note bodies.
  const candidates = await searchDocumentLinks(
    currentItem,
    parsed.target,
    true,
    { filter: "all", win },
  );
  const matches = candidates.filter(
    (candidate) =>
      candidate.title.toLocaleLowerCase() === parsed.target.toLocaleLowerCase(),
  );
  if (matches.length > 1) return "ambiguous";
  return matches.length
    ? { candidate: matches[0], heading: parsed.heading }
    : "unresolved";
}

async function markdownContent(
  item: Zotero.Item,
  win: Window,
): Promise<string | null> {
  const session = sessionRegistry
    .sessionsForWindow(win)
    .find(
      (session) =>
        session.itemID === item.id && !session.closing && session.editor,
    );
  if (session?.editor) return session.editor.requestSnapshot();
  // Import lazily: sidebar mounts also create preview loaders.
  const { findSidebarSessions } = await import("./sidebar");
  const sidebar = findSidebarSessions(item.id).find(
    ({ editor }) => editor.view.contentDOM.ownerDocument.defaultView === win,
  );
  if (sidebar) return sidebar.editor.requestSnapshot();
  const saved = await readSavedNote(item, { includeLinks: false });
  return saved && !saved.readError ? saved.content : null;
}

function textField(item: Zotero.Item, field: string): string {
  return String(item.getField(field) || "").trim();
}

/** One mounted host view owns this worker and disposes it when that view closes. */
export function createLinkPreviewContentLoader(
  options: { workerFactory?: WorkerFactory } = {},
) {
  const worker = new PreviewWorkerClient(options.workerFactory);
  let disposed = false;
  return {
    async load(
      href: string,
      context: LinkPreviewContentOptions,
    ): Promise<LinkPreviewContent> {
      if (disposed) return { status: "unavailable", href };
      try {
        const target = await resolveTarget(href, context);
        if (typeof target === "string") return { status: target, href };
        const { candidate } = target;
        const item = candidate.itemID
          ? Zotero.Items.get(candidate.itemID)
          : null;
        if (!item || disposed) return { status: "unavailable", href };
        if (target.location && !item.isPDFAttachment())
          return { status: "unresolved", href };
        const base = {
          status: "resolved" as const,
          href,
          sourceItemID: item.id,
          title: candidate.title,
          ...(candidate.author ? { subtitle: candidate.author } : {}),
        };
        if (isMarkdownAttachment(item as Zotero.Item)) {
          const source = await markdownContent(item, context.win);
          if (source === null || disposed)
            return { status: "unavailable", href };
          // Only a heading lookup needs the whole source in the worker.
          const input = target.heading
            ? source
            : source.slice(0, MAX_FRAGMENT_CHARS);
          if (
            target.heading &&
            (input.length > MAX_WORKER_RENDER_BYTES ||
              utf8ByteLength(input) > MAX_WORKER_RENDER_BYTES)
          )
            return { status: "unavailable", href };
          try {
            const rendered = await worker.render(input, candidate.title, {
              maxChars: MAX_FRAGMENT_CHARS,
              ...(target.heading ? { heading: target.heading } : {}),
            });
            if (disposed || rendered.headingFound === false)
              return { status: "unavailable", href };
            return { ...base, kind: "markdown", bodyHtml: rendered.bodyHtml };
          } catch (error) {
            if (disposed) return { status: "unavailable", href };
            Zotero.logError(
              error instanceof Error ? error : new Error(String(error)),
            );
            // An unavailable worker cannot accurately locate a heading. Never
            // present an unrelated opening paragraph as its target preview.
            return target.heading
              ? { status: "unavailable", href }
              : {
                  ...base,
                  kind: "markdown",
                  text: source.slice(0, MAX_TEXT_CHARS),
                };
          }
        }
        if (item.isNote()) {
          await item.loadDataType("note");
          const utilities = Zotero.Utilities as typeof Zotero.Utilities & {
            unescapeHTML(html: string): string;
          };
          const text = noteHtmlToText(
            item.getNote().slice(0, MAX_SOURCE_CHARS),
            {
              cleanTags: (html) => utilities.cleanTags(html),
              unescapeHTML: (html) => utilities.unescapeHTML(html),
            },
          ).slice(0, MAX_TEXT_CHARS);
          return disposed
            ? { status: "unavailable", href }
            : { ...base, kind: "note", text };
        }
        if (item.isRegularItem()) {
          const subtitle = [
            candidate.author,
            textField(item, "date"),
            textField(item, "publicationTitle"),
          ]
            .filter(Boolean)
            .join(" · ");
          return {
            ...base,
            kind: "item",
            ...(subtitle ? { subtitle } : {}),
            text: textField(item, "abstractNote").slice(0, MAX_TEXT_CHARS),
          };
        }
        if (item.isAttachment()) {
          const pdf = item.isPDFAttachment();
          if (pdf && !(await item.fileExists()))
            return { status: "unavailable", href };
          if (disposed) return { status: "unavailable", href };
          return pdf
            ? {
                ...base,
                kind: "pdf",
                attachmentID: item.id,
                ...(target.location ? { location: target.location } : {}),
                text: item.attachmentFilename || "",
              }
            : {
                ...base,
                kind: "attachment",
                text: item.attachmentFilename || "",
              };
        }
        return { status: "unresolved", href };
      } catch (error) {
        // Hover failures stay local; navigation remains independently available.
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
        return { status: "unavailable", href };
      }
    },
    dispose() {
      disposed = true;
      worker.dispose();
    },
  };
}
