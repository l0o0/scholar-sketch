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
import { cleanupUnusedImageAssets } from "./images/service";
import { updateIndexedNote } from "./note-library";

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
  const path = opts.path ?? ((await item.getFilePathAsync()) || null);
  if (!path) {
    throw new Error("Attachment has no file path");
  }

  if (opts.revision) {
    await writeProtectedFile(path, value, opts.revision, item, (content) =>
      IOUtils.writeUTF8(path, content, {
        // Zotero's ZIP writer skips dotfiles. A failed atomic write must not
        // leave a second visible document inside the synced attachment.
        tmpPath: PathUtils.join(
          PathUtils.parent(path)!,
          `.${path.split(/[\\/]/).pop()}.scholar-sketch.tmp`,
        ),
        flush: true,
      }),
    );
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
    await cleanupUnusedImageAssets(item, value);
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
