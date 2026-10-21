import {
  validViewState,
  type DocumentViewState,
} from "./markdown/editor-view-state";
import { config } from "../../package.json";
import { suspendFeatureUpdates } from "./feature-updates";

export interface WorkspaceDocument {
  itemID: number;
  kind: "markdown" | "canvas";
  surface: "tab" | "window";
  open: boolean;
  mode?: "live" | "source" | "preview";
  view?: DocumentViewState;
  previewScroll?: number;
}
const KEY = `${config.prefsPrefix}.workspaceState`;
let retaining = false;

export function parseWorkspace(value: unknown): WorkspaceDocument[] {
  try {
    const records = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(records)) return [];
    return records
      .filter(
        (entry) =>
          entry &&
          Number.isSafeInteger(entry.itemID) &&
          entry.itemID > 0 &&
          ["markdown", "canvas"].includes(entry.kind) &&
          ["tab", "window"].includes(entry.surface) &&
          typeof entry.open === "boolean",
      )
      .slice(-100)
      .map((entry) => ({
        itemID: entry.itemID,
        kind: entry.kind,
        surface: entry.surface,
        open: entry.open,
        ...(["live", "source", "preview"].includes(entry.mode)
          ? { mode: entry.mode }
          : {}),
        ...(validViewState(entry.view) ? { view: entry.view } : {}),
        ...(Number.isFinite(entry.previewScroll) && entry.previewScroll >= 0
          ? { previewScroll: entry.previewScroll }
          : {}),
      }));
  } catch {
    return [];
  }
}
function readWorkspace(): WorkspaceDocument[] {
  try {
    return parseWorkspace(Zotero.Prefs.get(KEY, true));
  } catch {
    return [];
  }
}
export function documentWorkspace(
  itemID: number,
): WorkspaceDocument | undefined {
  return readWorkspace().find((entry) => entry.itemID === itemID);
}
export function rememberDocument(
  itemID: number,
  patch: Partial<WorkspaceDocument>,
): void {
  try {
    const records = readWorkspace();
    const previous = records.find((entry) => entry.itemID === itemID);
    const next = { ...previous, ...patch, itemID };
    Zotero.Prefs.set(
      KEY,
      JSON.stringify(
        parseWorkspace([
          ...records.filter((entry) => entry.itemID !== itemID),
          next,
        ]),
      ),
      true,
    );
  } catch (error) {
    if (typeof ztoolkit !== "undefined")
      ztoolkit.log("Could not save workspace state", error);
  }
}
export function forgetOpenDocument(itemID: number): void {
  if (!retaining) rememberDocument(itemID, { open: false });
}
export function resumeWorkspaceTracking(): void {
  retaining = false;
}
export function retainWorkspaceOnShutdown(): void {
  retaining = true;
}

export async function restoreWorkspace(
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  const resumeUpdates = suspendFeatureUpdates();
  try {
    await restoreDocuments(win);
  } finally {
    resumeUpdates();
  }
}

async function restoreDocuments(win: _ZoteroTypes.MainWindow): Promise<void> {
  retaining = false;
  // Snapshot before opening: opening editors may update the preference itself.
  const records = readWorkspace().filter((entry) => entry.open);
  for (const entry of records) {
    try {
      const item = Zotero.Items.get(entry.itemID);
      if (!item || item.deleted || !item.isAttachment()) {
        forgetOpenDocument(entry.itemID);
        continue;
      }
      if (entry.kind === "markdown") {
        const { isMarkdownAttachment } = await import("./markdown/detect");
        if (!isMarkdownAttachment(item)) continue;
        if (entry.surface === "window") {
          const { openMarkdownWindow } = await import("./markdown/window");
          await openMarkdownWindow(item, { opener: win });
        } else {
          const { openMarkdownTab } = await import("./markdown/tab");
          await openMarkdownTab(item, { win });
        }
      } else {
        const { isWhiteboardAttachment } = await import("./whiteboard/detect");
        if (!isWhiteboardAttachment(item)) continue;
        const { openWhiteboardTab, openWhiteboardWindow } =
          await import("./whiteboard/tab");
        if (entry.surface === "window")
          await openWhiteboardWindow(item, { win });
        else await openWhiteboardTab(item, { win });
      }
    } catch (error) {
      ztoolkit.log("Could not restore document", entry.itemID, error);
    }
  }
}
