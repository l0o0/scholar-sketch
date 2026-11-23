import type { WhiteboardLabels } from "../model/protocol";
import {
  defaultWhiteboardShortcuts,
  WHITEBOARD_SHORTCUT_ACTIONS,
  WHITEBOARD_SHORTCUT_LABELS,
  whiteboardShortcutLabel,
} from "../model/shortcuts";

export interface ShortcutHelp {
  action: string;
  keys: string;
  label: string;
}

export function keyboardShortcuts(
  labels: WhiteboardLabels,
  shortcuts = defaultWhiteboardShortcuts(),
  platform?: string,
): ShortcutHelp[] {
  return WHITEBOARD_SHORTCUT_ACTIONS.filter(
    (action) => shortcuts[action] !== "",
  ).map((action) => ({
    action,
    keys: whiteboardShortcutLabel(shortcuts[action], platform),
    label:
      labels[WHITEBOARD_SHORTCUT_LABELS[action]] ??
      (action === "pan"
        ? labels.shortcutHand
        : action === "freeMove"
          ? "Move freely (temporarily disable snapping)"
          : action.startsWith("nudge")
            ? `${action.includes("Large") ? (labels.shortcutNudgeLarge ?? "Nudge selection by 16 units") : (labels.shortcutNudge ?? "Nudge selection by 1 unit")}`
            : undefined) ??
      action,
  }));
}
