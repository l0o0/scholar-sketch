import { isMarkdownAttachment } from "./markdown/detect";
import { isWhiteboardAttachment } from "./whiteboard/detect";

type UploadUtilities = {
  getItemFromRequest(request: unknown): Zotero.Item;
  createUploadFile(...args: unknown[]): Promise<boolean>;
};

type ZipEntry = {
  name: string;
  isDirectory: boolean;
  isSynthetic?: boolean;
};

type PlannedEntry = ZipEntry & { target: string };

let registration:
  | {
      utilities: UploadUtilities;
      original: UploadUtilities["createUploadFile"];
      wrapper: UploadUtilities["createUploadFile"];
      active: boolean;
    }
  | undefined;

/** Only normalize the known assets directory, never arbitrary backslashes. */
export function planZipAssetPathRepair(entries: ZipEntry[]): PlannedEntry[] {
  const plan = entries
    .filter((entry) => !entry.isSynthetic)
    .map((entry) => ({
      ...entry,
      target: entry.name.startsWith("assets\\")
        ? entry.name.replace(/\\/g, "/")
        : entry.name,
    }));
  if (!plan.some((entry) => entry.name !== entry.target)) return plan;

  const destinations = new Map<string, PlannedEntry>();
  for (const entry of plan) {
    const target = entry.isDirectory
      ? entry.target.replace(/\/$/, "")
      : entry.target;
    // A changed asset must remain a relative, portable descendant of assets.
    // Never let path cleanup silently change a filename or resolve traversal.
    if (
      entry.name !== entry.target &&
      target
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            [...part].some((char) => char.charCodeAt(0) < 0x20) ||
            /[<>:"|?*]/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
            /[. ]$/.test(part),
        )
    ) {
      throw new Error(`Unsafe attachment ZIP asset path: ${entry.name}`);
    }
    // Windows is case insensitive. A valid Mac archive must not lose files
    // when the normalized attachment is downloaded on Windows.
    const key = target.toLowerCase();
    if (destinations.has(key)) {
      throw new Error(`Conflicting attachment ZIP asset path: ${entry.target}`);
    }
    destinations.set(key, entry);
  }
  for (const [target, entry] of destinations) {
    const parts = target.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = destinations.get(parts.slice(0, i).join("/"));
      if (parent && !parent.isDirectory) {
        throw new Error(
          `Conflicting attachment ZIP asset path: ${entry.target}`,
        );
      }
    }
  }
  return plan;
}

function isSupportedAttachment(item: Zotero.Item): boolean {
  return (
    !!item &&
    !!item.isStoredFileAttachment?.() &&
    (isMarkdownAttachment(item) || isWhiteboardAttachment(item))
  );
}

function createReader(): nsIZipReader {
  return (Components.classes as typeof Cc)[
    "@mozilla.org/libjar/zip-reader;1"
  ].createInstance(Components.interfaces.nsIZipReader);
}

/**
 * Repair only Zotero's temporary upload ZIP, before WebDAV/ZFS reads it.
 * The original ZIP is kept until a complete replacement passes CRC checks.
 * No attachment file, source document, or remote object is modified here.
 */
export async function normalizeAttachmentUploadZip(
  item: Zotero.Item,
): Promise<boolean> {
  if (!isSupportedAttachment(item)) return false;
  // The host names upload ZIPs with the item key, not an attachment filename.
  // Validate before appending so even a malformed adapter cannot escape tmp.
  if (!/^[A-Z0-9]{8}$/.test(item.key)) {
    throw new Error("Invalid attachment key for ZIP normalization");
  }
  const zipFile = Zotero.getTempDirectory().clone();
  zipFile.append(`${item.key}.zip`);
  const reader = createReader();
  let readerOpen = false;
  let staging: nsIFile | undefined;
  try {
    reader.open(zipFile);
    readerOpen = true;
    const names = reader.findEntries(null as unknown as string);
    const entries: ZipEntry[] = [];
    while (names.hasMore()) {
      const name = names.getNext();
      const entry = reader.getEntry(name);
      entries.push({
        name,
        isDirectory: entry.isDirectory,
        isSynthetic: entry.isSynthetic,
      });
    }
    const plan = planZipAssetPathRepair(entries);
    if (!plan.some((entry) => entry.name !== entry.target)) return false;

    staging = Zotero.getTempDirectory().clone();
    staging.append(`${item.key}.scholar-assets.zip`);
    staging.createUnique(
      Components.interfaces.nsIFile.NORMAL_FILE_TYPE ?? 0,
      0o600,
    );
    const writer = (Components.classes as typeof Cc)[
      "@mozilla.org/zipwriter;1"
    ].createInstance(Components.interfaces.nsIZipWriter);
    writer.open(staging, 0x04 | 0x08 | 0x20);
    const streams: nsIInputStream[] = [];
    try {
      for (const entry of plan) {
        const original = reader.getEntry(entry.name);
        if (entry.isDirectory) {
          writer.addEntryDirectory(
            entry.target,
            original.lastModifiedTime,
            true,
          );
        } else {
          // Copy bytes from the already-created archive. Re-reading source
          // files here could capture a different revision during an edit.
          const stream = reader.getInputStream(entry.name);
          streams.push(stream);
          writer.addEntryStream(
            entry.target,
            original.lastModifiedTime,
            Components.interfaces.nsIZipWriter.COMPRESSION_DEFAULT ?? 6,
            stream,
            true,
          );
        }
      }
      await new Promise<void>((resolve, reject) => {
        writer.processQueue(
          {
            onStartRequest() {},
            onStopRequest(
              _request: nsIRequest,
              statusOrContext: number | nsISupports,
              legacyStatus?: number,
            ) {
              // Older Gecko observers supplied (request, context, status).
              // Current Gecko supplies (request, status).
              const status = legacyStatus ?? statusOrContext;
              if (
                typeof status === "number" &&
                Components.isSuccessCode(status)
              )
                resolve();
              else
                reject(
                  new Error(`Attachment ZIP normalization failed: ${status}`),
                );
            },
          },
          null as unknown as nsISupports,
        );
      });
    } finally {
      try {
        writer.close();
      } finally {
        for (const stream of streams) stream.close();
      }
    }

    const verified = createReader();
    verified.open(staging);
    try {
      verified.test(null as unknown as string);
      for (const entry of plan) {
        const original = reader.getEntry(entry.name);
        const replacement = verified.getEntry(entry.target);
        if (
          original.isDirectory !== replacement.isDirectory ||
          original.realSize !== replacement.realSize ||
          original.CRC32 !== replacement.CRC32
        ) {
          throw new Error(
            `Attachment ZIP verification failed: ${entry.target}`,
          );
        }
      }
    } finally {
      verified.close();
    }
    // Windows cannot replace an archive while nsIZipReader still holds it.
    reader.close();
    readerOpen = false;
    await IOUtils.move(staging.path, zipFile.path, { noOverwrite: false });
    return true;
  } finally {
    if (readerOpen) reader.close();
    if (staging) {
      await IOUtils.remove(staging.path, { ignoreAbsent: true });
    }
  }
}

/** Keep the host packer and other plugins intact; only wrap its completion. */
export function registerAttachmentZipCompatibility(): void {
  if (registration?.active) return;
  const utilities = Zotero.Sync?.Storage?.Utilities as unknown as
    UploadUtilities | undefined;
  if (
    typeof utilities?.createUploadFile !== "function" ||
    typeof utilities?.getItemFromRequest !== "function"
  ) {
    Zotero.logError(
      new Error("Attachment upload ZIP compatibility unavailable"),
    );
    return;
  }
  const original = utilities.createUploadFile;
  const installed = {
    utilities,
    original,
    wrapper: undefined as unknown as UploadUtilities["createUploadFile"],
    active: true,
  };
  installed.wrapper = async function (this: UploadUtilities, ...args) {
    const result = await original.apply(this, args);
    if (result && installed.active) {
      await normalizeAttachmentUploadZip(utilities.getItemFromRequest(args[0]));
    }
    return result;
  };
  utilities.createUploadFile = installed.wrapper;
  registration = installed;
}

export function unregisterAttachmentZipCompatibility(): void {
  const installed = registration;
  if (!installed) return;
  installed.active = false;
  // A later plugin may wrap ours. Leave its method in place; our retained
  // wrapper becomes a pass-through instead of undoing somebody else's patch.
  if (installed.utilities.createUploadFile === installed.wrapper) {
    installed.utilities.createUploadFile = installed.original;
  }
  registration = undefined;
}
