import { assetReferenceCandidates, referencedAssets } from "./model";

export interface DeletedImageAssets {
  record(sources: string[]): void;
  restore(markdown: string): Promise<boolean>;
  remove(markdown: string, canRemove: () => boolean): Promise<boolean>;
  release(keepForRecovery?: boolean): Promise<void>;
}

interface AttachmentAssets {
  owners: number;
  /** Resolve each source once so an encoded filename cannot change targets. */
  sources: Map<string, string | undefined>;
  backups: Map<string, string>;
  keepForRecovery?: boolean;
  directory?: string;
}

const attachments = new Map<number, AttachmentAssets>();

function assetPath(item: Zotero.Item, reference: string): string {
  return PathUtils.join(
    Zotero.Attachments.getStorageDirectory(item).path,
    "assets",
    reference.slice("assets/".length),
  );
}

/** The caller owns the attachment write gate and waits for saves before release. */
export function acquireDeletedImageAssets(
  item: Zotero.Item,
): DeletedImageAssets {
  let state = attachments.get(item.id);
  if (!state) {
    state = { owners: 0, sources: new Map(), backups: new Map() };
    attachments.set(item.id, state);
  }
  const assets = state;
  assets.owners++;
  let released = false;

  return {
    record(sources) {
      if (!item.isStoredFileAttachment() || !item.isEditable()) return;
      for (const source of sources) {
        if (
          assetReferenceCandidates(source).length &&
          !assets.sources.has(source)
        )
          assets.sources.set(source, undefined);
      }
    },

    async restore(markdown) {
      if (!assets.backups.size) return false;
      const references = new Set(referencedAssets(markdown));
      let restored = false;
      for (const [reference, backup] of assets.backups) {
        if (!references.has(reference)) continue;
        const target = assetPath(item, reference);
        if (await IOUtils.exists(target)) continue;
        await IOUtils.makeDirectory(PathUtils.parent(target)!, {
          ignoreExisting: true,
        });
        await IOUtils.copy(backup, target, { noOverwrite: true });
        restored = true;
      }
      if (
        [...assets.backups.keys()].every((reference) =>
          references.has(reference),
        )
      )
        assets.keepForRecovery = false;
      return restored;
    },

    async remove(markdown, canRemove) {
      if (!assets.sources.size || !canRemove()) return false;
      const references = new Set(referencedAssets(markdown));
      let removed = false;
      for (const [source, knownReference] of assets.sources) {
        let reference = knownReference;
        if (!reference) {
          for (const candidate of assetReferenceCandidates(source)) {
            if (
              assets.backups.has(candidate) ||
              (await IOUtils.exists(assetPath(item, candidate)))
            ) {
              reference = candidate;
              break;
            }
          }
          if (!reference) {
            assets.sources.delete(source);
            continue;
          }
          assets.sources.set(source, reference);
        }
        if (references.has(reference)) continue;
        const original = assetPath(item, reference);
        if (!(await IOUtils.exists(original))) continue;
        if ((await IOUtils.stat(original)).type !== "regular") continue;
        if (!canRemove()) return removed;

        assets.directory ??= await IOUtils.createUniqueDirectory(
          // Zotero removes its shared temp root on exit, including when a
          // second profile exits while this editor is still open.
          PathUtils.tempDir,
          `scholar-sketch-deleted-images-${item.id}-`,
        );
        const backup = PathUtils.join(
          assets.directory,
          reference.slice("assets/".length),
        );
        // Keep the source until its undo copy is complete. Copies live outside
        // attachment storage and therefore never enter Zotero's upload ZIP.
        await IOUtils.copy(original, backup);
        assets.backups.set(reference, backup);
        if (!canRemove()) return removed;
        await IOUtils.remove(original);
        removed = true;
      }
      return removed;
    },

    async release(keepForRecovery = false) {
      if (released) return;
      released = true;
      assets.keepForRecovery ||= keepForRecovery;
      if (--assets.owners) return;
      if (assets.keepForRecovery && assets.directory) {
        ztoolkit.log("Preserved deleted image assets after unsuccessful save", {
          itemID: item.id,
          directory: assets.directory,
        });
        return;
      }
      attachments.delete(item.id);
      if (assets.directory) {
        await IOUtils.remove(assets.directory, {
          recursive: true,
          ignoreAbsent: true,
        });
      }
    },
  };
}

/** Read-only preview fallback while a deleted image remains undoable. */
export function getDeletedImageAssetPath(
  item: Zotero.Item,
  normalizedReference: string,
): string | undefined {
  return attachments.get(item.id)?.backups.get(normalizedReference);
}
