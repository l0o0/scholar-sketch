import {
  preserveFileDraft,
  writeProtectedFile,
  type FileRevision,
} from "../file-safety";
import {
  markAttachmentForUpload,
  withAttachmentWrite,
} from "../attachment-sync";
import { extractFirstHeadingTitle } from "./frontmatter";
import { markdownAttachmentTitle } from "./detect";
import {
  assertImageCleanupCurrent,
  cleanupUnusedImageAssets,
} from "./images/service";
import { updateIndexedNote } from "./note-library";
import type { DeletedImageAssets } from "./images/deleted-assets";

/**
 * Single write path for Markdown attachment content.
 *
 * Both the editor (tab.ts `persistSession`) and the public API
 * (`api.ts` `markdown.update`) persist through here, so every write gets the
 * same treatment: file write, optional image-asset cleanup, optional item
 * title sync from the first H1, and optional Zotero file-sync marking.
 *
 */
export async function persistMarkdownContent(
  item: Zotero.Item,
  value: string,
  opts: {
    /** Known file path (skips `getFilePathAsync`). */
    path?: string;
    revision?: FileRevision;
    /** Remove embedded image assets that are no longer referenced. */
    cleanupImages?: boolean;
    /** Recheck live editors after waits and before each image deletion. */
    canCleanupImages?: () => boolean;
    /** Explicit image deletions owned by the open editors' undo history. */
    deletedImages?: DeletedImageAssets;
    canDeleteImages?: () => boolean;
    /** Sync the Zotero item title from the first H1 (editor behavior). */
    syncTitle?: boolean;
    /**
     * Mark stored attachments for Zotero file sync (`to_upload`) so external
     * writes propagate to other devices.
     */
    syncFile?: boolean;
  } = {},
): Promise<{ path: string; titleChanged: boolean }> {
  try {
    return await withAttachmentWrite(
      item,
      () => persistMarkdownContentNow(item, value, opts),
      () => preserveFileDraft(item, value),
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "ATTACHMENT_SYNC_CONFLICT") {
      await preserveFileDraft(item, value);
    }
    throw error;
  }
}

async function persistMarkdownContentNow(
  item: Zotero.Item,
  value: string,
  opts: NonNullable<Parameters<typeof persistMarkdownContent>[2]>,
): Promise<{ path: string; titleChanged: boolean }> {
  const checkCleanup = () => {
    if (opts.cleanupImages) assertImageCleanupCurrent(opts.canCleanupImages);
  };
  checkCleanup();
  const path = opts.path ?? ((await item.getFilePathAsync()) || null);
  if (!path) {
    throw new Error("Attachment has no file path");
  }

  checkCleanup();
  // Undo may reintroduce an image removed by an earlier automatic save.
  // Restore bytes before persisting its reference, under the same write gate.
  if (opts.deletedImages) {
    let packageChanged = true;
    try {
      packageChanged = await opts.deletedImages.restore(value);
    } finally {
      // A later text conflict, or a partial restore failure, must not leave
      // already restored sidecars invisible to Zotero file sync.
      if (packageChanged && opts.syncFile)
        await markAttachmentForUpload(item, { packageChanged: true });
    }
  }
  if (opts.revision) {
    await writeProtectedFile(path, value, opts.revision, item, (content) => {
      // History I/O and queued writes may have allowed another editor to change.
      checkCleanup();
      return IOUtils.writeUTF8(path, content, {
        // Zotero's ZIP writer skips dotfiles. A failed atomic write must not
        // leave a second visible document inside the synced attachment.
        tmpPath: PathUtils.join(
          PathUtils.parent(path)!,
          `.${path.split(/[\\/]/).pop()}.scholar-sketch.tmp`,
        ),
        flush: true,
      });
    });
  } else {
    await Zotero.File.putContentsAsync(path, value);
  }

  if (opts.syncFile) {
    // Mark before cleanup so even a partially failed removal is uploaded.
    // Explicit cleanup can change only sidecars while the text stays equal.
    await markAttachmentForUpload(item, {
      packageChanged: !!opts.cleanupImages,
    });
  }
  if (opts.cleanupImages) {
    await cleanupUnusedImageAssets(item, value, opts.canCleanupImages);
  }
  if (opts.deletedImages && opts.canDeleteImages) {
    let packageChanged = false;
    try {
      packageChanged = await opts.deletedImages.remove(
        value,
        opts.canDeleteImages,
      );
    } catch (error) {
      // A batch may have removed some images before the failure.
      packageChanged = true;
      throw error;
    } finally {
      if (packageChanged && opts.syncFile)
        await markAttachmentForUpload(item, { packageChanged: true });
    }
  }

  let titleChanged = false;
  if (opts.syncTitle) {
    const headingTitle = extractFirstHeadingTitle(value);
    const title = headingTitle ? markdownAttachmentTitle(headingTitle) : null;
    if (title && item.getField("title") !== title) {
      titleChanged = true;
      item.setField("title", title);
      await item.saveTx({ skipSelect: true });
    }
  }

  updateIndexedNote(item, value);
  return { path, titleChanged };
}
