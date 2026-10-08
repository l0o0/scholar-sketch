import { getString } from "../utils/locale";

// Zotero accepts names in the setter but returns these numeric states.
const TO_UPLOAD = 0;
const TO_DOWNLOAD = 1;
const IN_SYNC = 2;
const FORCE_UPLOAD = 3;
const FORCE_DOWNLOAD = 4;
const IN_CONFLICT = 5;

const writers = new Map<string, Promise<unknown>>();

function isStored(item: Zotero.Item): boolean {
  return (
    item.isStoredFileAttachment?.() ??
    (typeof item.attachmentLinkMode === "number" &&
      item.attachmentLinkMode === Zotero.Attachments?.LINK_MODE_IMPORTED_FILE)
  );
}

function syncState(item: Zotero.Item): number | undefined {
  const state = item.attachmentSyncState as number | string;
  if (typeof state === "number") return state;
  // Also support lightweight host adapters that retain the setter's name.
  return {
    to_upload: TO_UPLOAD,
    to_download: TO_DOWNLOAD,
    in_sync: IN_SYNC,
    force_upload: FORCE_UPLOAD,
    force_download: FORCE_DOWNLOAD,
    in_conflict: IN_CONFLICT,
  }[state];
}

function assertWritableSyncState(item: Zotero.Item): void {
  if (!isStored(item)) return;
  const state = syncState(item);
  if ([TO_DOWNLOAD, FORCE_DOWNLOAD, IN_CONFLICT].includes(state as number)) {
    const error = new Error(getString("attachment-sync-conflict"));
    Object.assign(error, { code: "ATTACHMENT_SYNC_CONFLICT" });
    throw error;
  }
}

/**
 * Keep a stored attachment directory stable during Zotero's sync run.
 * WebDAV reads the main file before ZIP creation and again after upload.
 * Acquire the runner's delay synchronously with the idle check, then release
 * it even on failure. Do not nest this gate: a sync may already be waiting on
 * the outer delay. On-demand downloads still require exact revision checks.
 */
export async function withAttachmentWrite<T>(
  item: Zotero.Item,
  write: () => Promise<T>,
  onWait?: () => Promise<void>,
): Promise<T> {
  const key = `${item.libraryID}/${item.key ?? item.id}`;
  const previous = writers.get(key) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const runner = isStored(item) ? Zotero.Sync?.Runner : undefined;
      let preserved = false;
      while (runner?.syncInProgress) {
        if (!preserved && onWait) {
          await onWait();
          preserved = true;
        }
        await Zotero.Promise.delay(100);
      }
      // There must be no await between checking syncInProgress and this call.
      const release = runner?.delayIndefinite?.();
      try {
        assertWritableSyncState(item);
        return await write();
      } finally {
        release?.();
      }
    });
  writers.set(key, operation);
  try {
    return await operation;
  } finally {
    if (writers.get(key) === operation) writers.delete(key);
  }
}

/** Call within withAttachmentWrite, after changing the file/package. */
export async function markAttachmentForUpload(
  item: Zotero.Item,
  options: { packageChanged?: boolean } = {},
): Promise<void> {
  if (!isStored(item)) return;
  assertWritableSyncState(item);
  if (options.packageChanged) {
    const path = await item.getFilePathAsync();
    if (!path) throw new Error("Attachment has no file path");
    const { lastModified } = await IOUtils.stat(path);
    if (!Number.isFinite(lastModified)) {
      throw new Error("Attachment modification time is unavailable");
    }
    // A rename or sidecar deletion leaves the main file hash unchanged.
    // Advance beyond Zotero's one-second mtime tolerance so WebDAV actually
    // uploads a new ZIP. Never rewrite the last-synced baseline to do this.
    const syncedMtime = item.attachmentSyncedModificationTime || 0;
    let mtime = Math.max(Date.now(), lastModified! + 2000, syncedMtime + 2000);
    // Zotero also treats an exact one-hour difference in floored seconds as
    // unchanged. Avoid that tolerance for both possible comparison baselines.
    while (
      [lastModified!, syncedMtime].some(
        (previous) =>
          Math.abs(Math.floor(mtime / 1000) - Math.floor(previous / 1000)) ===
          3600,
      )
    ) {
      mtime += 2000;
    }
    await IOUtils.setModificationTime(path, mtime);
  }
  const state = syncState(item);
  if (state === TO_UPLOAD || state === FORCE_UPLOAD) return;
  item.attachmentSyncState = "to_upload";
  await item.saveTx({ skipSelect: true });
}
