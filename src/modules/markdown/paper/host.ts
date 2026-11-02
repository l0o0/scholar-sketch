import { citationKey, parseCitationKey, PaperExportError } from "./export";

/** Host-only access to Zotero's CSL converter, which is absent from zotero-types. */
type CitationUtilities = {
  itemToCSLJSON(
    item: Zotero.Item,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
};
export async function resolvePaperReference(id: string) {
  const source = parseCitationKey(id);
  if (!source) return null;
  const libraryID =
    source.library === "user"
      ? Zotero.Libraries.userLibraryID
      : Zotero.Groups.getLibraryIDFromGroupID(source.library);
  if (!libraryID) return null;
  const item = await Zotero.Items.getByLibraryAndKeyAsync(
    libraryID,
    source.key,
  );
  if (!item || item.deleted || !item.isRegularItem()) return null;
  const converter = Zotero.Utilities.Item as unknown as CitationUtilities;
  return { ...(await converter.itemToCSLJSON(item)), id };
}

export function paperCitationForItem(item: Zotero.Item): string {
  if (!item.isRegularItem() || item.deleted)
    throw new PaperExportError("citation", item.key);
  const library =
    item.libraryID === Zotero.Libraries.userLibraryID
      ? "user"
      : Zotero.Groups.getGroupIDFromLibraryID(item.libraryID);
  if (!library) throw new PaperExportError("citation", item.key);
  return citationKey(library, item.key);
}

type Process = {
  stdin: { close(): void };
  stdout: { readString(): Promise<string> };
  kill(): void;
  wait(): Promise<{ exitCode: number }>;
};
interface SubprocessAPI {
  call(options: {
    command: string;
    arguments: string[];
    workdir: string;
    stderr: "stdout";
  }): Promise<Process>;
}

/** Argument vectors only: manuscript text and file paths never pass through a shell. */
export async function runPandoc(
  command: string,
  args: string[],
  workdir: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  ) as { Subprocess: SubprocessAPI };
  const process = await Subprocess.call({
    command,
    arguments: args,
    workdir,
    stderr: "stdout",
  }).catch((cause: unknown) => {
    throw new PaperExportError(
      "conversion",
      cause instanceof Error ? cause.message : String(cause),
      { cause },
    );
  });
  const abort = () => process.kill();
  signal.addEventListener("abort", abort, { once: true });
  let diagnostic = "";
  let reaped = false;
  try {
    process.stdin.close();
    if (signal.aborted) process.kill();
    let chunk: string;
    while ((chunk = await process.stdout.readString()))
      diagnostic = (diagnostic + chunk).slice(-8000);
    const { exitCode } = await process.wait();
    reaped = true;
    signal.throwIfAborted();
    if (exitCode !== 0)
      throw new PaperExportError("conversion", diagnostic.trim());
  } finally {
    signal.removeEventListener("abort", abort);
    // Also reap the process when pipe communication fails.
    if (!reaped) {
      process.kill();
      await process.wait();
    }
  }
}

/** Rasterize diagram/SVG assets so Word needs no external SVG converter. */
export function rasterizePaperImage(
  document: Document,
  source: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (!/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i.test(source))
    throw new PaperExportError("image");
  if (/^data:image\/(?:png|jpeg|gif);base64,/i.test(source))
    return Promise.resolve(source);
  const image = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "img",
  ) as HTMLImageElement;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      image.removeAttribute("src");
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    image.onerror = () => {
      cleanup();
      reject(new PaperExportError("image"));
    };
    image.onload = () => {
      try {
        signal.throwIfAborted();
        const width = image.naturalWidth,
          height = image.naturalHeight;
        // Bound allocation for a user-provided image while preserving aspect ratio.
        const scale = Math.min(1, 4096 / Math.max(width, height));
        const canvas = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "canvas",
        ) as HTMLCanvasElement;
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new PaperExportError("image");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    };
    image.src = source;
  });
}
