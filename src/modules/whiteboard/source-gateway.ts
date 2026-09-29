import type {
  AnnotationCandidate,
  AnnotationListFailure,
  AnnotationListFailureCode,
  AnnotationListResult,
  AcademicAcquisition,
  AcademicSourceDescriptor,
  AttachmentSnapshot,
  LiteratureSource,
  NoteSource,
  SourceResolutionResult,
} from "../../../packages/whiteboard/src/model";

export interface SourceGatewayDependencies {
  userLibraryID: number;
  getLibrary(
    libraryID: number,
  ): { libraryType: string; groupID?: number } | null;
  groupLibraryID(groupID: number): number | null;
  getByLibraryAndKey(libraryID: number, key: string): Zotero.Item | null;
  cleanTags(html: string): string;
  unescapeHTML(html: string): string;
  openItem(item: Zotero.Item): Promise<void>;
  openNote(item: Zotero.Item): Promise<void>;
  openAnnotation(
    attachment: Zotero.Item,
    annotation: Zotero.Item,
  ): Promise<boolean>;
  openAttachmentPage(
    attachment: Zotero.Item,
    pageIndex?: number,
  ): Promise<void>;
  /** Opens a file attachment in Zotero Reader or the platform file handler. */
  openAttachment?(attachment: Zotero.Item): Promise<void>;
}

export interface ZoteroSourceGateway {
  acquireItem(item: Zotero.Item): AcademicAcquisition;
  resolve(
    nodeId: string,
    generation: number,
    descriptor: AcademicSourceDescriptor,
  ): Promise<SourceResolutionResult>;
  listAnnotations(source: LiteratureSource): Promise<AnnotationListResult>;
  refreshNote(
    source: NoteSource,
  ): Promise<Extract<AcademicAcquisition, { kind: "note" }>>;
  open(descriptor: AcademicSourceDescriptor): Promise<void>;
}

type NoteUtilities = Pick<
  SourceGatewayDependencies,
  "cleanTags" | "unescapeHTML"
>;
type LibraryRef = LiteratureSource["library"];
type ChildItemLookup = { getByID(itemID: number): Zotero.Item | null };
type GatewayDependencies = SourceGatewayDependencies & Partial<ChildItemLookup>;

const unavailableMessages = {
  "library-missing": "The Zotero library is unavailable.",
  "item-missing": "The Zotero item is unavailable.",
  "wrong-kind": "The Zotero item has a different kind.",
  "parent-mismatch": "The Zotero item's parent has changed.",
} as const;

export type SourceGatewayFailureCode =
  | Extract<
      AnnotationListFailureCode,
      | "library-missing"
      | "item-missing"
      | "wrong-kind"
      | "parent-mismatch"
      | "list-failed"
    >
  | "open-failed"
  | "note-refresh-failed";

export class SourceGatewayError extends Error {
  override readonly name = "SourceGatewayError";

  constructor(
    readonly code: SourceGatewayFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export function createZoteroSourceGateway(
  deps?: SourceGatewayDependencies,
): ZoteroSourceGateway;
export function createZoteroSourceGateway(
  deps: GatewayDependencies = productionDependencies(),
): ZoteroSourceGateway {
  function libraryRef(libraryID: number): LibraryRef {
    if (libraryID === deps.userLibraryID) return { type: "user" };
    const library = deps.getLibrary(libraryID);
    if (
      library?.libraryType === "group" &&
      typeof library.groupID === "number"
    ) {
      return { type: "group", groupID: library.groupID };
    }
    throw new Error("Unsupported Zotero library type.");
  }

  function libraryID(library: LibraryRef): number | null {
    return library.type === "user"
      ? deps.userLibraryID
      : deps.groupLibraryID(library.groupID);
  }

  function acquisition(item: Zotero.Item): AcademicAcquisition {
    if (item.isRegularItem())
      return literatureAcquisition(item, libraryRef(item.libraryID));
    if (item.isNote())
      return noteAcquisition(item, libraryRef(item.libraryID), deps);
    if (item.isAnnotation())
      return quoteAcquisition(item, libraryRef(item.libraryID));
    if (item.isAttachment())
      return attachmentAcquisition(item, libraryRef(item.libraryID));
    throw new Error("Unsupported Zotero item.");
  }

  async function resolve(
    nodeId: string,
    generation: number,
    descriptor: AcademicSourceDescriptor,
  ): Promise<SourceResolutionResult> {
    const id = libraryID(descriptor.source.library);
    if (id == null) return unavailable(nodeId, generation, "library-missing");

    const item = deps.getByLibraryAndKey(id, keyFor(descriptor));
    if (!item) return unavailable(nodeId, generation, "item-missing");

    try {
      const resolved = await acquisitionForDescriptor(item, descriptor, deps);
      return { nodeId, generation, status: "resolved", acquisition: resolved };
    } catch (error) {
      const code =
        error instanceof SourceIntegrityError ? error.code : "wrong-kind";
      return unavailable(nodeId, generation, code);
    }
  }

  async function listAnnotations(
    source: LiteratureSource,
  ): Promise<AnnotationListResult> {
    const id = libraryID(source.library);
    if (id == null)
      throw new SourceGatewayError(
        "library-missing",
        unavailableMessages["library-missing"],
      );
    const literature = deps.getByLibraryAndKey(id, source.itemKey);
    if (!literature)
      throw new SourceGatewayError(
        "item-missing",
        unavailableMessages["item-missing"],
      );
    if (!literature.isRegularItem())
      throw new SourceGatewayError(
        "wrong-kind",
        unavailableMessages["wrong-kind"],
      );

    let attachmentIDs: ReturnType<Zotero.Item["getAttachments"]>;
    try {
      attachmentIDs = literature.getAttachments();
    } catch {
      throw new SourceGatewayError(
        "list-failed",
        "Zotero annotations could not be loaded.",
      );
    }
    const candidates: AnnotationCandidate[] = [];
    const failures: AnnotationListFailure[] = [];
    for (const child of attachmentIDs) {
      const attachment = childItem(child, deps);
      if (!attachment?.isAttachment()) {
        failures.push(attachmentFailure());
        continue;
      }
      if (attachment.attachmentContentType !== "application/pdf") {
        continue;
      }
      if (
        !attachment.parentItem?.isRegularItem() ||
        attachment.parentItem.key !== source.itemKey
      ) {
        failures.push(attachmentFailure(attachment.key));
        continue;
      }
      let annotations: ReturnType<Zotero.Item["getAnnotations"]>;
      try {
        annotations = attachment.getAnnotations();
      } catch {
        failures.push(attachmentFailure(attachment.key));
        continue;
      }
      for (const annotation of annotations) {
        try {
          if (!annotation.isAnnotation()) {
            throw new SourceIntegrityError("wrong-kind");
          }
          if (!isSupportedAnnotation(annotation)) continue;
          const acquisition = quoteAcquisition(annotation, source.library);
          if (
            acquisition.source.itemKey !== source.itemKey ||
            acquisition.source.attachmentKey !== attachment.key
          ) {
            throw new SourceIntegrityError("parent-mismatch");
          }
          candidates.push({
            acquisition,
            attachmentTitle: textField(attachment, "title") || attachment.key,
            sortIndex: annotation.annotationSortIndex || "",
          });
        } catch {
          failures.push(
            annotationFailure(
              attachment.key,
              typeof annotation.key === "string" && annotation.key
                ? annotation.key
                : undefined,
            ),
          );
        }
      }
    }
    return {
      candidates: candidates.sort(
        (left, right) =>
          left.attachmentTitle.localeCompare(right.attachmentTitle) ||
          left.acquisition.source.attachmentKey.localeCompare(
            right.acquisition.source.attachmentKey,
          ) ||
          left.sortIndex.localeCompare(right.sortIndex) ||
          left.acquisition.source.annotationKey.localeCompare(
            right.acquisition.source.annotationKey,
          ),
      ),
      failures,
    };
  }

  async function refreshNote(
    source: NoteSource,
  ): Promise<Extract<AcademicAcquisition, { kind: "note" }>> {
    const id = libraryID(source.library);
    if (id == null)
      throw new SourceGatewayError(
        "library-missing",
        unavailableMessages["library-missing"],
      );
    const note = deps.getByLibraryAndKey(id, source.noteKey);
    if (!note)
      throw new SourceGatewayError(
        "item-missing",
        unavailableMessages["item-missing"],
      );
    try {
      return noteForSource(note, source, deps);
    } catch (error) {
      if (error instanceof SourceIntegrityError) {
        throw new SourceGatewayError(
          error.code,
          unavailableMessages[error.code],
        );
      }
      throw new SourceGatewayError(
        "note-refresh-failed",
        error instanceof Error ? error.message : "Zotero Note refresh failed.",
      );
    }
  }

  async function open(descriptor: AcademicSourceDescriptor): Promise<void> {
    const id = libraryID(descriptor.source.library);
    if (id == null)
      throw new SourceGatewayError(
        "library-missing",
        unavailableMessages["library-missing"],
      );
    const item = deps.getByLibraryAndKey(id, keyFor(descriptor));
    if (!item)
      throw new SourceGatewayError(
        "item-missing",
        unavailableMessages["item-missing"],
      );

    try {
      if (descriptor.kind === "literature") {
        if (!item.isRegularItem()) throw new SourceIntegrityError("wrong-kind");
        await deps.openItem(item);
        return;
      }
      if (descriptor.kind === "note") {
        noteForSource(item, descriptor.source, deps);
        await deps.openNote(item);
        return;
      }

      if (descriptor.kind === "attachment") {
        if (!item.isAttachment()) throw new SourceIntegrityError("wrong-kind");
        if (deps.openAttachment) await deps.openAttachment(item);
        else await deps.openAttachmentPage(item);
        return;
      }

      const quote = quoteForSource(item, descriptor.source);
      const exact = await deps.openAnnotation(quote.attachment, item);
      if (!exact) {
        await deps.openAttachmentPage(
          quote.attachment,
          pageIndex(item.annotationPosition),
        );
      }
    } catch (error) {
      if (error instanceof SourceIntegrityError) {
        throw new SourceGatewayError(
          error.code,
          unavailableMessages[error.code],
        );
      }
      if (error instanceof SourceGatewayError) throw error;
      throw new SourceGatewayError(
        "open-failed",
        error instanceof Error ? error.message : "Zotero source open failed.",
      );
    }
  }

  return {
    acquireItem: acquisition,
    resolve,
    listAnnotations,
    refreshNote,
    open,
  };
}

export function noteHtmlToText(html: string, utilities: NoteUtilities): string {
  let text: string;
  try {
    text = utilities.unescapeHTML(utilities.cleanTags(html));
  } catch {
    text = htmlToTextFallback(html);
  }
  return normalizeNoteText(text);
}

function literatureAcquisition(
  item: Zotero.Item,
  library: LibraryRef,
): Extract<AcademicAcquisition, { kind: "literature" }> {
  return {
    kind: "literature",
    source: { library, itemKey: item.key },
    snapshot: omitEmpty({
      title: textField(item, "title"),
      creators: creatorsText(item),
      year: year(textField(item, "date")),
      publicationTitle: textField(item, "publicationTitle"),
      tags: tags(item),
    }),
  };
}

function attachmentAcquisition(
  item: Zotero.Item,
  library: LibraryRef,
  availability = attachmentAvailability(item),
): Extract<AcademicAcquisition, { kind: "attachment" }> {
  if (!item.isAttachment()) throw new SourceIntegrityError("wrong-kind");
  const filename = attachmentFilename(item);
  const contentType = attachmentContentType(item);
  const title =
    (typeof item.getDisplayTitle === "function"
      ? String(item.getDisplayTitle() || "").trim()
      : "") || textField(item, "title");
  const snapshot: AttachmentSnapshot = {
    filename,
    ...(title ? { title } : {}),
    ...(contentType ? { contentType } : {}),
    availability,
  };
  return {
    kind: "attachment",
    source: { library, attachmentKey: item.key },
    snapshot,
  };
}

function noteAcquisition(
  item: Zotero.Item,
  library: LibraryRef,
  utilities: NoteUtilities,
): Extract<AcademicAcquisition, { kind: "note" }> {
  const parent = item.parentItem;
  return {
    kind: "note",
    source: {
      library,
      noteKey: item.key,
      ...(parent?.isRegularItem() ? { itemKey: parent.key } : {}),
    },
    ...(item.getNoteTitle()
      ? { sourceSnapshot: { title: item.getNoteTitle() } }
      : {}),
    content: noteHtmlToText(item.getNote(), utilities),
  };
}

function quoteAcquisition(
  item: Zotero.Item,
  library: LibraryRef,
): Extract<AcademicAcquisition, { kind: "quote" }> {
  const { attachment, literature } = validatedQuote(item);
  return {
    kind: "quote",
    source: {
      library,
      itemKey: literature.key,
      attachmentKey: attachment.key,
      annotationKey: item.key,
    },
    snapshot: omitEmpty({
      text: item.annotationText?.trim() || "",
      comment: item.annotationComment?.trim(),
      pageLabel: item.annotationPageLabel?.trim(),
      color: item.annotationColor?.trim(),
    }),
  };
}

function acquisitionForDescriptor(
  item: Zotero.Item,
  descriptor: AcademicSourceDescriptor,
  utilities: NoteUtilities,
): Promise<AcademicAcquisition> {
  if (descriptor.kind === "literature") {
    if (!item.isRegularItem()) throw new SourceIntegrityError("wrong-kind");
    return Promise.resolve(
      literatureAcquisition(item, descriptor.source.library),
    );
  }
  if (descriptor.kind === "note")
    return Promise.resolve(noteForSource(item, descriptor.source, utilities));
  if (descriptor.kind === "attachment") {
    if (!item.isAttachment() || item.key !== descriptor.source.attachmentKey) {
      throw new SourceIntegrityError("wrong-kind");
    }
    return attachmentAcquisitionAsync(item, descriptor.source.library);
  }
  return Promise.resolve(quoteForSource(item, descriptor.source).acquisition);
}

async function attachmentAcquisitionAsync(
  item: Zotero.Item,
  library: LibraryRef,
): Promise<Extract<AcademicAcquisition, { kind: "attachment" }>> {
  return attachmentAcquisition(
    item,
    library,
    await attachmentAvailabilityAsync(item),
  );
}

function noteForSource(
  item: Zotero.Item,
  source: NoteSource,
  utilities: NoteUtilities,
): Extract<AcademicAcquisition, { kind: "note" }> {
  if (!item.isNote()) throw new SourceIntegrityError("wrong-kind");
  const parent = item.parentItem;
  if (
    source.itemKey &&
    (!parent?.isRegularItem() || parent.key !== source.itemKey)
  ) {
    throw new SourceIntegrityError("parent-mismatch");
  }
  if (!source.itemKey && parent && !parent.isRegularItem()) {
    throw new SourceIntegrityError("parent-mismatch");
  }
  const acquired = noteAcquisition(item, source.library, utilities);
  if (acquired.source.noteKey !== source.noteKey)
    throw new SourceIntegrityError("parent-mismatch");
  return { ...acquired, source };
}

function quoteForSource(
  item: Zotero.Item,
  source: Extract<AcademicSourceDescriptor, { kind: "quote" }>["source"],
) {
  if (!item.isAnnotation()) throw new SourceIntegrityError("wrong-kind");
  const { attachment, literature } = validatedQuote(item);
  if (
    item.key !== source.annotationKey ||
    attachment.key !== source.attachmentKey ||
    literature.key !== source.itemKey
  ) {
    throw new SourceIntegrityError("parent-mismatch");
  }
  return { attachment, acquisition: quoteAcquisition(item, source.library) };
}

function quoteChain(annotation: Zotero.Item): {
  attachment: Zotero.Item;
  literature: Zotero.Item;
} {
  const attachment = annotation.parentItem;
  const literature = attachment?.parentItem;
  if (!attachment?.isAttachment() || !literature?.isRegularItem()) {
    throw new SourceIntegrityError("parent-mismatch");
  }
  return { attachment, literature };
}

function validatedQuote(annotation: Zotero.Item): {
  attachment: Zotero.Item;
  literature: Zotero.Item;
} {
  if (!isSupportedAnnotation(annotation)) {
    throw new SourceIntegrityError("wrong-kind");
  }
  const chain = quoteChain(annotation);
  if (chain.attachment.attachmentContentType !== "application/pdf") {
    throw new SourceIntegrityError("wrong-kind");
  }
  return chain;
}

function isSupportedAnnotation(item: Zotero.Item): boolean {
  return (
    item.isAnnotation() &&
    (item.annotationType === "highlight" ||
      item.annotationType === "underline") &&
    Boolean(item.annotationText?.trim())
  );
}

function keyFor(descriptor: AcademicSourceDescriptor): string {
  if (descriptor.kind === "literature") return descriptor.source.itemKey;
  if (descriptor.kind === "note") return descriptor.source.noteKey;
  if (descriptor.kind === "attachment") return descriptor.source.attachmentKey;
  return descriptor.source.annotationKey;
}

function attachmentFilename(item: Zotero.Item): string {
  const candidate = (item as unknown as { attachmentFilename?: unknown })
    .attachmentFilename;
  if (typeof candidate === "string" && candidate.trim())
    return candidate.trim();
  const field = textField(item, "title");
  return field || item.key;
}

function attachmentContentType(item: Zotero.Item): string | undefined {
  const candidate = (item as unknown as { attachmentContentType?: unknown })
    .attachmentContentType;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim().toLowerCase();
  }
  return undefined;
}

function attachmentAvailability(
  item: Zotero.Item,
): "available" | "not-downloaded" {
  const candidate = item as unknown as {
    fileExists?: (() => boolean | Promise<boolean>) | boolean;
    isStoredFileAttachment?: () => boolean;
  };
  try {
    if (typeof candidate.fileExists === "function") {
      // Zotero's real API is async; resolve() performs the one awaited refresh.
      return "not-downloaded";
    }
    if (typeof candidate.fileExists === "boolean") {
      return candidate.fileExists ? "available" : "not-downloaded";
    }
    if (typeof candidate.isStoredFileAttachment === "function") {
      return candidate.isStoredFileAttachment()
        ? "available"
        : "not-downloaded";
    }
  } catch {
    return "not-downloaded";
  }
  // Older Zotero doubles do not expose a file-presence method; identity still resolves.
  return "available";
}

async function attachmentAvailabilityAsync(
  item: Zotero.Item,
): Promise<"available" | "not-downloaded"> {
  const candidate = item as unknown as {
    fileExists?: (() => boolean | Promise<boolean>) | boolean;
    getFilePath?: () => string | null | Promise<string | null>;
    isStoredFileAttachment?: () => boolean | Promise<boolean>;
  };
  try {
    if (typeof candidate.fileExists === "function") {
      return (await candidate.fileExists()) ? "available" : "not-downloaded";
    }
    if (typeof candidate.fileExists === "boolean") {
      return candidate.fileExists ? "available" : "not-downloaded";
    }
    if (typeof candidate.getFilePath === "function") {
      return (await candidate.getFilePath()) ? "available" : "not-downloaded";
    }
    if (typeof candidate.isStoredFileAttachment === "function") {
      return (await candidate.isStoredFileAttachment())
        ? "available"
        : "not-downloaded";
    }
  } catch {
    return "not-downloaded";
  }
  return "available";
}

function unavailable(
  nodeId: string,
  generation: number,
  code: keyof typeof unavailableMessages,
): SourceResolutionResult {
  return {
    nodeId,
    generation,
    status: "unavailable",
    code,
    message: unavailableMessages[code],
  };
}

function childItem(
  value: unknown,
  deps: GatewayDependencies,
): Zotero.Item | null {
  if (value && typeof value === "object") return value as Zotero.Item;
  return typeof value === "number" ? deps.getByID?.(value) || null : null;
}

function attachmentFailure(attachmentKey?: string): AnnotationListFailure {
  return {
    code: "attachment-unavailable",
    message: "Annotations from a PDF attachment could not be loaded.",
    ...(attachmentKey ? { attachmentKey } : {}),
  };
}

function annotationFailure(
  attachmentKey: string,
  annotationKey?: string,
): AnnotationListFailure {
  return {
    code: "annotation-unavailable",
    message: "A Zotero annotation could not be loaded.",
    attachmentKey,
    ...(annotationKey ? { annotationKey } : {}),
  };
}

function textField(item: Zotero.Item, field: string): string {
  try {
    return String(item.getField(field) || "").trim();
  } catch {
    return "";
  }
}

function creatorsText(item: Zotero.Item): string | undefined {
  const creator = String(
    (item as unknown as { firstCreator?: string }).firstCreator ||
      textField(item, "creators"),
  ).trim();
  return creator || undefined;
}

function year(date: string): string | undefined {
  return date.match(/\b\d{4}\b/)?.[0];
}

function tags(item: Zotero.Item): string[] | undefined {
  const itemWithTags = item as unknown as {
    getTags?: () => Array<{ tag: string }>;
  };
  const value = itemWithTags
    .getTags?.()
    .map(({ tag }) => tag.trim())
    .filter(Boolean);
  return value?.length ? value : undefined;
}

function omitEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) =>
      Array.isArray(entry) ? entry.length : entry !== undefined && entry !== "",
    ),
  ) as T;
}

function normalizeNoteText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToTextFallback(html: string): string {
  const document = (globalThis as { document?: Document }).document;
  if (document) {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element.textContent || "";
  }
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ");
}

function pageIndex(position: string): number | undefined {
  try {
    const value = JSON.parse(position) as { pageIndex?: unknown };
    return typeof value.pageIndex === "number" &&
      Number.isInteger(value.pageIndex) &&
      value.pageIndex >= 0
      ? value.pageIndex
      : undefined;
  } catch {
    return undefined;
  }
}

class SourceIntegrityError extends Error {
  constructor(readonly code: "wrong-kind" | "parent-mismatch") {
    super(code);
  }
}

function productionDependencies(): GatewayDependencies {
  const zotero = (globalThis as unknown as { Zotero: any }).Zotero;
  return {
    userLibraryID: zotero.Libraries.userLibraryID,
    getLibrary: (libraryID) => zotero.Libraries.get(libraryID) || null,
    groupLibraryID: (groupID) => zotero.Groups.get(groupID)?.libraryID ?? null,
    getByLibraryAndKey: (libraryID, key) =>
      zotero.Items.getByLibraryAndKey(libraryID, key) || null,
    getByID: (itemID) => zotero.Items.get(itemID) || null,
    cleanTags: (html) => zotero.Utilities.cleanTags(html),
    unescapeHTML: (html) => zotero.Utilities.unescapeHTML(html),
    openItem: async (item) =>
      void (await zotero.getMainWindow().ZoteroPane.selectItem(item.id)),
    openNote: async (item) =>
      void (await zotero.getMainWindow().ZoteroPane.openNote(item.id)),
    openAnnotation: async (attachment, annotation) => {
      if (typeof zotero.Reader?.open !== "function") return false;
      await zotero.Reader.open(attachment.id, {
        annotationID: annotation.key,
      });
      return true;
    },
    openAttachment: async (attachment) => {
      const pane = zotero.getMainWindow?.()?.ZoteroPane;
      if (typeof pane?.viewAttachment === "function") {
        try {
          await pane.viewAttachment(attachment.id);
          return;
        } catch {
          // Fall through for older panes and non-file attachments.
        }
      }
      if (
        attachment.attachmentContentType === "application/pdf" &&
        typeof zotero.Reader?.open === "function"
      ) {
        await zotero.Reader.open(attachment.id);
        return;
      }
      await zotero.FileHandlers.open(attachment);
    },
    openAttachmentPage: async (attachment, pageIndex) => {
      if (pageIndex === undefined) {
        await zotero.FileHandlers.open(attachment);
        return;
      }
      await zotero.FileHandlers.open(attachment, {
        location: { pageIndex },
      });
    },
  };
}
