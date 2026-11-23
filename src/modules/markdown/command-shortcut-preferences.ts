import { getPref, setPref } from "../../utils/prefs";
import {
  MARKDOWN_COMMAND_ACTIONS,
  defaultMarkdownCommandShortcuts,
  isMarkdownCommandShortcut,
  type MarkdownCommandShortcuts,
} from "./markdown-command-shortcuts";

/** A sparse persisted record keeps platform-specific defaults portable. */
export function readMarkdownCommandShortcuts(
  platform?: string,
): MarkdownCommandShortcuts {
  const defaults = defaultMarkdownCommandShortcuts(platform);
  let stored: unknown;
  try {
    stored = JSON.parse(getPref("markdownCommandShortcuts") || "{}");
  } catch {
    return defaults;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    return defaults;
  for (const action of MARKDOWN_COMMAND_ACTIONS) {
    const value = (stored as Record<string, unknown>)[action];
    if (typeof value === "string" && isMarkdownCommandShortcut(action, value))
      defaults[action] = value;
  }
  return defaults;
}
export function writeMarkdownCommandShortcuts(
  shortcuts: MarkdownCommandShortcuts,
  platform?: string,
): void {
  const defaults = defaultMarkdownCommandShortcuts(platform);
  const stored = Object.fromEntries(
    MARKDOWN_COMMAND_ACTIONS.filter(
      (action) => shortcuts[action] !== defaults[action],
    ).map((action) => [action, shortcuts[action]]),
  );
  setPref("markdownCommandShortcuts", JSON.stringify(stored));
}
