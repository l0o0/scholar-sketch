import {
  writeProtectedFile,
  type FileRevision,
  type HistoryItem,
} from "../file-safety";
import { getString } from "../../utils/locale";
import {
  parseStoredCanvas,
  serializeCanvasDocument,
  type ParsedCanvasFile,
} from "../../../packages/whiteboard/src/model/canvas-file";
import type { CanvasDocument } from "./snapshot";

const CANVAS_FILTER: [string, string] = [
  "Research Canvas (*.canvas)",
  "*.canvas",
];

export type AtomicWriteUTF8 = (
  path: string,
  value: string,
  options: { tmpPath: string; flush: boolean },
) => Promise<number | void>;

export type ReadUTF8 = (path: string) => Promise<string>;

export function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export function ensureCanvasExtension(path: string): string {
  return /\.canvas$/i.test(path) ? path : `${path}.canvas`;
}

export async function pickCanvasFile(
  mode: "open" | "save",
  win?: Window,
  suggestion = "whiteboard.canvas",
): Promise<string | null> {
  const title = getString(
    mode === "open" ? "whiteboard-open" : "whiteboard-save",
  );
  const picked = await new ztoolkit.FilePicker(
    title,
    mode,
    [CANVAS_FILTER],
    mode === "save" ? suggestion : undefined,
    win,
  ).open();
  return picked || null;
}

export async function readCanvasFile(
  path: string,
  options: { readUTF8?: ReadUTF8 } = {},
): Promise<ParsedCanvasFile & { source: string }> {
  if (!/\.canvas$/i.test(path)) {
    throw new Error("Canvas files must use the .canvas extension.");
  }
  const readUTF8: ReadUTF8 =
    options.readUTF8 ??
    (async (target) => String(await Zotero.File.getContentsAsync(target)));
  const source = await readUTF8(path);
  return { ...parseStoredCanvas(source), source };
}

export async function writeCanvasFile(
  path: string,
  document: CanvasDocument,
  options: {
    writeUTF8?: AtomicWriteUTF8;
    revision?: FileRevision;
    item?: HistoryItem;
  } = {},
): Promise<string> {
  const target = ensureCanvasExtension(path);
  const writeUTF8: AtomicWriteUTF8 =
    options.writeUTF8 ??
    ((targetPath, value, writeOptions) =>
      IOUtils.writeUTF8(targetPath, value, writeOptions));
  const write = (value: string) =>
    writeUTF8(target, value, {
      // Zotero excludes dotfiles from attachment ZIPs, including abandoned
      // temporary files from interrupted atomic writes.
      tmpPath: target.replace(/([^/\\]+)$/, ".$1.tmp"),
      flush: true,
    });
  const content = serializeCanvasDocument(document);
  if (options.revision && options.item) {
    await writeProtectedFile(
      target,
      content,
      options.revision,
      options.item,
      write,
    );
  } else await write(content);
  return target;
}
