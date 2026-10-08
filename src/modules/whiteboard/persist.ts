import {
  markAttachmentForUpload,
  withAttachmentWrite,
} from "../attachment-sync";
import { preserveFileDraft, type FileRevision } from "../file-safety";
import { serializeCanvasDocument } from "../../../packages/whiteboard/src/model/canvas-file";
import { writeCanvasFile, type AtomicWriteUTF8 } from "./file-io";
import type { CanvasDocument } from "./snapshot";

/** Shared write path for Canvas editors and the closed-document API. */
export async function persistCanvasAttachment(
  item: Zotero.Item,
  document: CanvasDocument,
  options: { revision: FileRevision; writeUTF8?: AtomicWriteUTF8 },
): Promise<string> {
  const preserveDraft = () =>
    preserveFileDraft(item, serializeCanvasDocument(document));
  try {
    return await withAttachmentWrite(
      item,
      async () => {
        // Sync or a native rename may have changed the path while we waited.
        const path = await item.getFilePathAsync();
        if (!path) throw new Error("Canvas file is unavailable");
        const target = await writeCanvasFile(path, document, {
          ...options,
          item,
        });
        await markAttachmentForUpload(item);
        return target;
      },
      preserveDraft,
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "ATTACHMENT_SYNC_CONFLICT") {
      await preserveDraft();
    }
    throw error;
  }
}
