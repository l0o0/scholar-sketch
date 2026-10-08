import {
  markAttachmentForUpload,
  withAttachmentWrite,
} from "../attachment-sync";
import {
  normalizeMarkdownFilename,
  storedMarkdownFilename,
} from "./storage-filename";

/** Rename the primary file and its item metadata as one attachment mutation. */
export async function renameMarkdownAttachment(
  item: Zotero.Item,
  filename: string,
) {
  const title = normalizeMarkdownFilename(filename);
  return withAttachmentWrite(item, async () => {
    const previousFilename = item.attachmentFilename;
    const result = await item.renameAttachmentFile(
      storedMarkdownFilename(title),
      false,
    );
    if (result === false || result === -1 || result === -2) return result;

    if (item.getField("title") !== title) {
      item.setField("title", title);
      await item.saveTx({ skipSelect: true });
    }
    // WebDAV hashes only the primary file. A rename also changes the ZIP's
    // entry name, even though the Markdown bytes and their hash are unchanged.
    if (item.attachmentFilename !== previousFilename) {
      await markAttachmentForUpload(item, { packageChanged: true });
    }
    return result;
  });
}
