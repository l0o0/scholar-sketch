/** Public in-process JSON Canvas API: Zotero.ScholarSketch.api.canvas. */
import {
  canvasFileToDocument,
  canvasDocumentToFile,
  type CanvasFile,
} from "../../../packages/whiteboard/src/model/canvas-file";
import {
  createAcademicNode,
  createBasicNode,
  emptyCanvasDocument,
} from "./snapshot";
import { createWhiteboardAttachment } from "./create";
import { isWhiteboardAttachment } from "./detect";
import { readCanvasFile, writeCanvasFile } from "./file-io";
import { whiteboardRegistry } from "./session-registry";
import { createZoteroSourceGateway } from "./source-gateway";

export type CanvasApiErrorCode =
  | "INVALID_ARGUMENT"
  | "ITEM_NOT_FOUND"
  | "NOT_CANVAS"
  | "CANVAS_OPEN"
  | "WRITE_CONFLICT"
  | "READ_ONLY"
  | "OPERATION_FAILED";
export class CanvasApiError extends Error {
  constructor(
    readonly code: CanvasApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CanvasApiError";
  }
}
function invalid(message: string): never {
  throw new CanvasApiError("INVALID_ARGUMENT", message);
}
function positiveID(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    invalid("Expected a positive integer ID");
}
function itemByID(id: number): Zotero.Item {
  positiveID(id);
  const item = Zotero.Items.get(id);
  if (!item || item.deleted)
    throw new CanvasApiError("ITEM_NOT_FOUND", `Item ${id} is unavailable`);
  return item;
}
function canvasItem(id: number) {
  const item = itemByID(id);
  if (!isWhiteboardAttachment(item))
    throw new CanvasApiError("NOT_CANVAS", "Expected a .canvas attachment");
  return item;
}
function requireClosed(id: number) {
  if (whiteboardRegistry.findByItem(id))
    throw new CanvasApiError(
      "CANVAS_OPEN",
      "Close the canvas before an external write",
    );
}
function requireEditable(libraryID: number) {
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable || !library.filesEditable)
    throw new CanvasApiError(
      "READ_ONLY",
      "Library does not allow attachment writes",
    );
}
function decode(value: unknown) {
  const parsed = canvasFileToDocument(
    typeof value === "string" ? JSON.parse(value) : value,
  );
  // The UI can recover malformed documents. API writes must not silently drop content.
  if (parsed.issues.length) invalid(JSON.stringify(parsed.issues));
  return parsed.document;
}
function info(item: Zotero.Item) {
  return {
    itemID: item.id,
    key: item.key,
    libraryID: item.libraryID,
    title: String(item.getField("title")),
    filename: item.attachmentFilename,
    parentItemID: item.parentItemID || null,
    open: !!whiteboardRegistry.findByItem(item.id),
  };
}
async function apiCall<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CanvasApiError) throw error;
    const code = (error as { code?: string })?.code;
    throw new CanvasApiError(
      code === "WRITE_CONFLICT" ? "WRITE_CONFLICT" : "OPERATION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}
function validated(value: unknown) {
  try {
    return decode(value);
  } catch (error) {
    invalid(error instanceof Error ? error.message : String(error));
  }
}

export const canvasApi = {
  version: 1,
  /** No disk writes; normalized file includes Scholar Sketch extensions. */
  validate(value: unknown) {
    return apiCall(() => canvasDocumentToFile(validated(value)));
  },
  list(options: { libraryID?: number; parentItemID?: number } = {}) {
    return apiCall(async () => {
      const libraryID = options.libraryID ?? Zotero.Libraries.userLibraryID;
      positiveID(libraryID);
      if (options.parentItemID !== undefined) positiveID(options.parentItemID);
      return (await Zotero.Items.getAll(libraryID))
        .filter(
          (item) =>
            !item.deleted &&
            isWhiteboardAttachment(item) &&
            (options.parentItemID === undefined ||
              item.parentItemID === options.parentItemID),
        )
        .map(info);
    });
  },
  /** Reads saved disk contents, not an open editor's unsaved state. */
  read(itemID: number) {
    return apiCall(async () => {
      const item = canvasItem(itemID);
      const path = await item.getFilePathAsync();
      if (!path) throw new Error("Canvas file is unavailable");
      const { document, source, issues } = await readCanvasFile(path);
      return {
        ...info(item),
        canvas: canvasDocumentToFile(document),
        revision: source,
        issues,
        dirty:
          whiteboardRegistry.findByItem(itemID)?.saveCoordinator?.dirty ??
          false,
      };
    });
  },
  create(
    options: {
      canvas?: unknown;
      parentItemID?: number;
      libraryID?: number;
      filename?: string;
    } = {},
  ) {
    return apiCall(async () => {
      const parent =
        options.parentItemID === undefined
          ? undefined
          : itemByID(options.parentItemID);
      if (parent && !parent.isRegularItem())
        invalid("parentItemID must identify a regular item");
      const libraryID =
        options.libraryID ??
        parent?.libraryID ??
        Zotero.Libraries.userLibraryID;
      positiveID(libraryID);
      if (parent && parent.libraryID !== libraryID)
        invalid("Parent belongs to another library");
      requireEditable(libraryID);
      const filename = options.filename ?? "Sketch.canvas";
      if (typeof filename !== "string" || !/^[^/\\]+\.canvas$/i.test(filename))
        invalid("filename must be a .canvas basename");
      const document =
        options.canvas === undefined
          ? emptyCanvasDocument()
          : validated(options.canvas);
      const item = await createWhiteboardAttachment(parent, {
        document,
        libraryID,
        collections: [],
        filename,
        select: false,
        reportError: false,
      });
      if (!item) throw new Error("Canvas creation failed");
      return info(item);
    });
  },
  /** Replace a closed canvas using the exact revision returned by read(). */
  update(
    itemID: number,
    canvas: unknown,
    options: { expectedRevision: string },
  ) {
    return apiCall(() =>
      whiteboardRegistry.withItemLock(itemID, async () => {
        const document = validated(canvas);
        if (!options || typeof options.expectedRevision !== "string")
          invalid("expectedRevision is required");
        const item = canvasItem(itemID);
        requireEditable(item.libraryID);
        requireClosed(itemID);
        const path = await item.getFilePathAsync();
        if (!path) throw new Error("Canvas file is unavailable");
        requireClosed(itemID);
        await writeCanvasFile(path, document, {
          item,
          revision: { content: options.expectedRevision },
          writeUTF8: (target, content, writeOptions) => {
            requireClosed(itemID);
            return IOUtils.writeUTF8(target, content, writeOptions);
          },
        });
        if (
          item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_FILE
        ) {
          item.attachmentSyncState = "to_upload";
          await item.saveTx({ skipSelect: true });
        }
        return info(item);
      }),
    );
  },
  open(itemID: number) {
    return apiCall(async () => {
      const item = canvasItem(itemID);
      const { openWhiteboardAttachment } = await import("./open");
      return { opened: await openWhiteboardAttachment(item) };
    });
  },
  getSelection() {
    return apiCall(() =>
      (Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [])
        .filter((item) => !item.deleted)
        .map((item) => ({
          itemID: item.id,
          key: item.key,
          libraryID: item.libraryID,
          itemType: item.itemType,
          title: String(item.getField("title")),
        })),
    );
  },
  /** Returns a standalone JSON Canvas for merging or passing to create(). */
  fromItems(itemIDs: number[]) {
    return apiCall(() => {
      if (!Array.isArray(itemIDs) || itemIDs.length > 500)
        invalid("itemIDs must be an array of at most 500 IDs");
      const document = emptyCanvasDocument();
      const gateway = createZoteroSourceGateway();
      document.nodes = [...new Set(itemIDs)].map((id, index) => {
        const acquired = gateway.acquireItem(itemByID(id));
        const nodeID = `zotero-${id}`;
        const position = {
          x: (index % 3) * 360,
          y: Math.floor(index / 3) * 280,
        };
        switch (acquired.kind) {
          case "literature":
            return createAcademicNode("literature", position, nodeID, acquired);
          case "quote":
            return createAcademicNode("quote", position, nodeID, acquired);
          case "note":
            return {
              ...createAcademicNode("note", position, nodeID, {
                content: acquired.content,
              }),
              source: acquired.source,
              ...(acquired.sourceSnapshot
                ? { sourceSnapshot: acquired.sourceSnapshot }
                : {}),
            };
          case "attachment":
            return {
              ...createBasicNode("attachment", position, nodeID),
              data: {
                title: acquired.snapshot.title || acquired.snapshot.filename,
                source: acquired.source,
                contentType: acquired.snapshot.contentType,
                availability: acquired.snapshot.availability,
              },
            };
        }
      });
      return canvasDocumentToFile(document);
    });
  },
  /** Resolve persistent keys from source cards/annotation candidates to runtime IDs. */
  resolveItem(reference: {
    library: { type: "user" } | { type: "group"; groupID: number };
    key: string;
  }) {
    return apiCall(() => {
      if (
        !reference ||
        typeof reference.key !== "string" ||
        !reference.key ||
        !reference.library
      )
        invalid("Expected library and key");
      const library = reference.library;
      if (library.type !== "user" && library.type !== "group")
        invalid("Unknown library type");
      if (library.type === "group") positiveID(library.groupID);
      const libraryID =
        library.type === "user"
          ? Zotero.Libraries.userLibraryID
          : Zotero.Groups.get(library.groupID)?.libraryID;
      if (!libraryID)
        throw new CanvasApiError("ITEM_NOT_FOUND", "Library unavailable");
      const item = Zotero.Items.getByLibraryAndKey(libraryID, reference.key);
      if (!item || item.deleted)
        throw new CanvasApiError("ITEM_NOT_FOUND", "Item unavailable");
      return { itemID: item.id, libraryID: item.libraryID, key: item.key };
    });
  },
  listAnnotations(itemID: number) {
    return apiCall(() => {
      const gateway = createZoteroSourceGateway();
      const acquisition = gateway.acquireItem(itemByID(itemID));
      if (acquisition.kind !== "literature")
        invalid("Expected a literature item");
      return gateway.listAnnotations(acquisition.source);
    });
  },
};
export type CanvasApi = typeof canvasApi;
export type { CanvasFile };
