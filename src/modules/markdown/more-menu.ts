import { getString } from "../../utils/locale";
import type { FluentMessageId } from "../../../typings/i10n";

export type MoreMenuAction =
  | "save"
  | "redo"
  | "open-window"
  | "search-library"
  | "history"
  | "document-info"
  | "rename"
  | "show-in-folder"
  | "find"
  | "export"
  | "export-pdf"
  | "export-html"
  | "export-docx"
  | "insert-citation"
  | "export-obsidian"
  | "export-markdown"
  | "shortcuts"
  | "settings"
  | "import-external-images"
  | "repair-images"
  | "cleanup-images";

export interface MoreMenuItem {
  action: MoreMenuAction;
  shortcut?: string;
  submenu?: boolean;
}

export const EDITOR_MODE_OPTIONS = [
  { mode: "live" },
  { mode: "source" },
  { mode: "preview" },
] as const;

export function findShortcutLabel(platform?: string): string {
  const value = platform ?? globalThis.navigator?.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(value) ? "⌘F" : "Ctrl+F";
}

export const MORE_MENU_SECTIONS: readonly (readonly MoreMenuItem[])[] = [
  [
    { action: "document-info" },
    { action: "history" },
    { action: "rename" },
    { action: "show-in-folder" },
    { action: "open-window" },
  ],
  [
    { action: "insert-citation" },
    { action: "search-library" },
    { action: "find", shortcut: findShortcutLabel() },
  ],
  [{ action: "export", submenu: true }],
  [
    { action: "import-external-images" },
    { action: "repair-images" },
    { action: "cleanup-images" },
    { action: "shortcuts" },
    { action: "settings" },
  ],
];

/** Fluent key for a kebab-menu action label. */
export function moreMenuLabelKey(action: MoreMenuAction): FluentMessageId {
  if (action === "save") return "tab-save";
  if (action === "redo") return "tab-redo";
  return `more-${action}` as FluentMessageId;
}

export function moreMenuLabel(action: MoreMenuAction): string {
  return getString(moreMenuLabelKey(action));
}

/** Fluent key for an editor mode label. */
export function modeLabelKey(
  mode: "live" | "source" | "preview",
): FluentMessageId {
  return `tab-mode-${mode}` as FluentMessageId;
}

export function modeLabel(mode: "live" | "source" | "preview"): string {
  return getString(modeLabelKey(mode));
}

/** Only direct entries participate in a menu's roving keyboard focus. */
export function menuButtons(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.children).filter((element) => {
    if (element.tagName.toLowerCase() !== "button") return false;
    const button = element as HTMLButtonElement;
    const style = menu.ownerDocument.defaultView?.getComputedStyle(button);
    return (
      !button.disabled &&
      !button.hidden &&
      style?.display !== "none" &&
      style?.visibility !== "hidden"
    );
  }) as HTMLButtonElement[];
}

export function focusMenuEntry(menu: HTMLElement, entry?: HTMLButtonElement) {
  const buttons = menuButtons(menu);
  const target = entry && buttons.includes(entry) ? entry : buttons[0];
  for (const button of menu.querySelectorAll<HTMLButtonElement>("button"))
    button.tabIndex = button === target ? 0 : -1;
  target?.focus();
}

export const EXPORT_OPTIONS = [
  { action: "export-pdf", label: "PDF" },
  { action: "export-html", label: "HTML" },
  { action: "export-docx", label: "Word (.docx)…" },
  { action: "export-obsidian", label: "Obsidian…" },
  { action: "export-markdown", label: "Markdown…" },
] as const;

export function submenuPosition(
  anchor: { left: number; right: number; top: number },
  width: number,
  height: number,
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  const right = anchor.right + 4;
  return {
    left: Math.max(
      bounds.left + 4,
      Math.min(
        right + width <= bounds.right - 4 ? right : anchor.left - width - 4,
        bounds.right - width - 4,
      ),
    ),
    top: Math.max(
      bounds.top + 4,
      Math.min(anchor.top, bounds.bottom - height - 4),
    ),
  };
}
