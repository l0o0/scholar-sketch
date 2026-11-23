import { getPref, setPref } from "../../utils/prefs";
import {
  DEFAULT_MARKDOWN_INSERT_SHORTCUTS,
  type MarkdownInsertShortcuts,
} from "./shortcut";

export function readMarkdownInsertShortcuts(): MarkdownInsertShortcuts {
  return {
    annotation:
      getPref("shortcutInsertAnnotation") ??
      DEFAULT_MARKDOWN_INSERT_SHORTCUTS.annotation,
    image:
      getPref("shortcutInsertImage") ?? DEFAULT_MARKDOWN_INSERT_SHORTCUTS.image,
    table:
      getPref("shortcutInsertTable") ?? DEFAULT_MARKDOWN_INSERT_SHORTCUTS.table,
    task:
      getPref("shortcutInsertTask") ?? DEFAULT_MARKDOWN_INSERT_SHORTCUTS.task,
    code:
      getPref("shortcutInsertCode") ?? DEFAULT_MARKDOWN_INSERT_SHORTCUTS.code,
  };
}

export function writeMarkdownInsertShortcuts(
  bindings: MarkdownInsertShortcuts,
): void {
  setPref("shortcutInsertAnnotation", bindings.annotation);
  setPref("shortcutInsertImage", bindings.image);
  setPref("shortcutInsertTable", bindings.table);
  setPref("shortcutInsertTask", bindings.task);
  setPref("shortcutInsertCode", bindings.code);
}
