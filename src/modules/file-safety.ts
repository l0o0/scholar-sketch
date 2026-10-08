import { getString } from "../utils/locale";

export interface FileRevision {
  content: string;
}
export interface HistoryItem {
  libraryID: number;
  key: string;
}
export interface FileVersion {
  id: string;
  created: string;
  kind: "saved" | "conflict" | "draft";
  content: string;
}

const queues = new Map<string, Promise<unknown>>();
const HISTORY_LIMIT = 50;
let lastVersionTime = 0;

function historyDirectory(item: HistoryItem): string {
  if (!Number.isInteger(item.libraryID) || !/^[A-Za-z0-9_-]+$/.test(item.key))
    throw new Error("Invalid history identity");
  return PathUtils.join(
    Zotero.DataDirectory.dir,
    "scholar-canvas",
    "history",
    String(item.libraryID),
    item.key,
  );
}

export async function readFileVersions(
  item: HistoryItem,
): Promise<FileVersion[]> {
  const directory = historyDirectory(item);
  if (!(await IOUtils.exists(directory))) return [];
  const versions: FileVersion[] = [];
  for (const path of await IOUtils.getChildren(directory)) {
    if (!path.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(await IOUtils.readUTF8(path));
      if (
        typeof entry.content === "string" &&
        typeof entry.created === "string" &&
        typeof entry.id === "string" &&
        /^[\w-]+$/.test(entry.id) &&
        (entry.kind === "saved" ||
          entry.kind === "conflict" ||
          entry.kind === "draft")
      )
        versions.push(entry);
    } catch (error) {
      ztoolkit.log("Unreadable file history entry", path, error);
    }
  }
  return versions.sort((a, b) => b.id.localeCompare(a.id));
}

async function archive(
  item: HistoryItem,
  content: string,
  kind: FileVersion["kind"],
): Promise<void> {
  const directory = historyDirectory(item);
  const entries = (await IOUtils.exists(directory))
    ? (await IOUtils.getChildren(directory))
        .filter((path) => path.endsWith(`-${kind}.json`))
        .sort()
        .reverse()
    : [];
  // Autosave reads only the newest checkpoint; the preview loads full history on demand.
  if (entries[0]) {
    try {
      if (JSON.parse(await IOUtils.readUTF8(entries[0])).content === content)
        return;
    } catch (error) {
      ztoolkit.log("Unreadable latest history entry", error);
    }
  }
  await IOUtils.makeDirectory(directory, {
    ignoreExisting: true,
    createAncestors: true,
  });
  lastVersionTime = Math.max(Date.now(), lastVersionTime + 1);
  const id = `${lastVersionTime}-${Math.random().toString(36).slice(2)}-${kind}`;
  const target = PathUtils.join(directory, `${id}.json`);
  await IOUtils.writeUTF8(
    target,
    JSON.stringify({ id, created: new Date().toISOString(), kind, content }),
    { tmpPath: `${target}.tmp`, flush: true },
  );
  // Keep recovery drafts separately from ordinary save history so repeated saves
  // cannot immediately evict a conflicting draft.
  const obsolete = entries.slice(HISTORY_LIMIT - 1);
  for (const entry of obsolete) {
    try {
      await IOUtils.remove(entry);
    } catch (error) {
      ztoolkit.log("History pruning failed", error);
    }
  }
}

export class FileConflictError extends Error {
  readonly code = "WRITE_CONFLICT";
  constructor() {
    super(getString("file-conflict"));
    this.name = "FileConflictError";
  }
}

/** Preserve text outside attachment storage while a sync blocks publication. */
export async function preserveFileDraft(item: HistoryItem, content: string) {
  await archive(item, content, "draft");
}

/** Serialize plugin writers; compare exact content, not unreliable mtime/size. */
export async function writeProtectedFile(
  path: string,
  content: string,
  revision: FileRevision,
  item: HistoryItem,
  write: (value: string) => Promise<unknown>,
): Promise<void> {
  const previous = queues.get(path) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      let current: string;
      try {
        current = String(await Zotero.File.getContentsAsync(path));
      } catch (error) {
        await archive(item, content, "conflict");
        throw error;
      }
      if (current !== revision.content && current !== content) {
        await archive(item, content, "conflict");
        throw new FileConflictError();
      }
      if (current !== content) {
        await archive(item, current, "saved");
        // Recheck after history I/O, which can take time on slow disks.
        if (String(await Zotero.File.getContentsAsync(path)) !== current) {
          await archive(item, content, "conflict");
          throw new FileConflictError();
        }
        try {
          await write(content);
        } catch (error) {
          try {
            await archive(item, content, "conflict");
          } catch (backupError) {
            ztoolkit.log("Failed to preserve unsaved draft", backupError);
          }
          throw error;
        }
      }
      revision.content = content;
    });
  queues.set(path, operation);
  try {
    await operation;
  } finally {
    if (queues.get(path) === operation) queues.delete(path);
  }
}
