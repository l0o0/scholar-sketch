import type { WhiteboardLabels } from "../model/protocol";

export interface ShortcutHelp {
  keys: string;
  label: string;
}

export function keyboardShortcuts(labels: WhiteboardLabels): ShortcutHelp[] {
  return [
    { keys: "V", label: labels.shortcutSelect },
    { keys: "H", label: labels.shortcutHand },
    { keys: "Space + drag", label: labels.shortcutHand },
    {
      keys: "Alt + drag",
      label:
        labels.shortcutFreeMove ?? "Move freely (temporarily disable snapping)",
    },
    {
      keys: "↑ ↓ ← →",
      label: labels.shortcutNudge ?? "Nudge selection by 1 unit",
    },
    {
      keys: "Shift + ↑ ↓ ← →",
      label: labels.shortcutNudgeLarge ?? "Nudge selection by 16 units",
    },
    { keys: "Shift + 1", label: labels.fitView },
    { keys: "Shift + 2", label: labels.fitSelection },
    { keys: "R", label: labels.shortcutRect },
    { keys: "O", label: labels.shortcutEllipse },
    { keys: "A", label: labels.shortcutArrow },
    { keys: "L", label: labels.shortcutLine },
    { keys: "T", label: labels.shortcutText },
    { keys: "Q", label: labels.shortcutQuestion },
    { keys: "C", label: labels.shortcutClaim },
    { keys: "F", label: labels.shortcutFrame },
    { keys: "E", label: labels.shortcutEraser },
    { keys: "Shift", label: labels.shortcutConstrain },
    { keys: "Esc", label: labels.shortcutCancel },
    { keys: "Delete", label: labels.shortcutDelete },
    { keys: "Ctrl/Meta + Z", label: labels.shortcutUndo },
    { keys: "Ctrl/Meta + Shift + Z", label: labels.shortcutRedo },
  ];
}
