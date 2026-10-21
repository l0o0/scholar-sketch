import { mimeFromAssetPath, referencedAssets } from "./model";
import { repairImageAssets } from "./repair";

interface PendingRepair {
  markdown: string;
  promise: Promise<boolean>;
  guards: Set<(() => boolean) | undefined>;
}

const pending = new WeakMap<Zotero.Item, PendingRepair>();

function eligible(item: Zotero.Item): boolean {
  if (
    !item.isStoredFileAttachment?.() ||
    !item.attachmentContentType?.startsWith("text/") ||
    !item.isEditable?.() ||
    Zotero.Sync?.Runner?.syncInProgress ||
    [1, 4, 5, "to_download", "force_download", "in_conflict"].includes(
      item.attachmentSyncState as number | string,
    )
  )
    return false;
  const library = Zotero.Libraries.get(item.libraryID);
  return Boolean(library && library.editable && library.filesEditable);
}

async function attempt(
  item: Zotero.Item,
  markdown: string,
  shouldProceed?: () => boolean,
): Promise<boolean> {
  const canProceed = () => eligible(item) && shouldProceed?.() !== false;
  if (!canProceed()) return false;
  const references = referencedAssets(markdown).filter(mimeFromAssetPath);
  if (!references.length) return false;

  // The common case reads directory names only. Full image inspection and the
  // attachment write gate are reserved for exact legacy filename candidates.
  const names = new Set(
    references.flatMap((reference) => {
      const filename = reference.slice("assets/".length);
      return [`assets${filename}`, `assets\\${filename}`];
    }),
  );
  const root = Zotero.Attachments.getStorageDirectory(item).path;
  const children = await IOUtils.getChildren(root);
  if (!children.some((path) => names.has(PathUtils.filename(path))))
    return false;
  if (!canProceed()) return false;

  // repairImageAssets rechecks the saved Markdown under the write gate. A
  // draft never causes an implicit save or a repair based on stale contents.
  const report = await repairImageAssets(item, markdown, {
    waitForSync: false,
    shouldProceed: canProceed,
  });
  // A metadata-save failure can occur after a target was safely copied. Let
  // callers reread those images too; a later attempt will finish publication.
  return report.repaired > 0 || report.failed > 0;
}

/**
 * Opportunistic repair for rendered Markdown. Never prompts, saves the draft,
 * or waits for synchronization; unambiguous image originals alone are moved.
 * This function owns no write gate and must be called outside persistence.
 */
export function autoRepairImageAssets(
  item: Zotero.Item,
  markdown: string,
  shouldProceed?: () => boolean,
): Promise<boolean> {
  const previous = pending.get(item);
  if (previous) {
    if (previous.markdown === markdown) {
      previous.guards.add(shouldProceed);
      return previous.promise;
    }
    // Different views can request different snapshots concurrently. Recheck
    // the later snapshot after the earlier attempt instead of losing it.
    return previous.promise.then(() =>
      autoRepairImageAssets(item, markdown, shouldProceed),
    );
  }

  const guards = new Set([shouldProceed]);
  const anyCurrentView = () =>
    [...guards].some((guard) => {
      try {
        return guard?.() !== false;
      } catch {
        return false;
      }
    });
  const operation = Promise.resolve()
    .then(() => attempt(item, markdown, anyCurrentView))
    .catch(() => false)
    .finally(() => {
      if (pending.get(item)?.promise === operation) pending.delete(item);
    });
  pending.set(item, { markdown, promise: operation, guards });
  return operation;
}
