import {
  isMacPlatform,
  keyboardShortcutIdentity,
  keyboardShortcutMatches,
  normalizeKeyboardShortcut,
  shortcutKeycaps,
} from "../../../../src/modules/markdown/shortcut";
import type { WhiteboardLabels } from "./protocol";

export const WHITEBOARD_SHORTCUT_ACTIONS = [
  "save",
  "find",
  "select",
  "hand",
  "pan",
  "freeMove",
  "nudgeUp",
  "nudgeDown",
  "nudgeLeft",
  "nudgeRight",
  "nudgeUpLarge",
  "nudgeDownLarge",
  "nudgeLeftLarge",
  "nudgeRightLarge",
  "fitView",
  "fitSelection",
  "rect",
  "ellipse",
  "arrow",
  "line",
  "text",
  "question",
  "claim",
  "frame",
  "eraser",
  "constrain",
  "cancel",
  "delete",
  "undo",
  "redo",
] as const;
export type WhiteboardShortcutAction =
  (typeof WHITEBOARD_SHORTCUT_ACTIONS)[number];
export type WhiteboardShortcuts = Record<WhiteboardShortcutAction, string>;
export const WHITEBOARD_HOLD_SHORTCUT_ACTIONS = [
  "pan",
  "freeMove",
  "constrain",
] as const;
export type WhiteboardHoldShortcutAction =
  (typeof WHITEBOARD_HOLD_SHORTCUT_ACTIONS)[number];

export const WHITEBOARD_SHORTCUT_LABELS = {
  save: "save",
  find: "searchCanvas",
  select: "shortcutSelect",
  hand: "shortcutHand",
  pan: "shortcutPan",
  freeMove: "shortcutFreeMove",
  nudgeUp: "shortcutNudgeUp",
  nudgeDown: "shortcutNudgeDown",
  nudgeLeft: "shortcutNudgeLeft",
  nudgeRight: "shortcutNudgeRight",
  nudgeUpLarge: "shortcutNudgeUpLarge",
  nudgeDownLarge: "shortcutNudgeDownLarge",
  nudgeLeftLarge: "shortcutNudgeLeftLarge",
  nudgeRightLarge: "shortcutNudgeRightLarge",
  fitView: "fitView",
  fitSelection: "fitSelection",
  rect: "shortcutRect",
  ellipse: "shortcutEllipse",
  arrow: "shortcutArrow",
  line: "shortcutLine",
  text: "shortcutText",
  question: "shortcutQuestion",
  claim: "shortcutClaim",
  frame: "shortcutFrame",
  eraser: "shortcutEraser",
  constrain: "shortcutConstrain",
  cancel: "shortcutCancel",
  delete: "shortcutDelete",
  undo: "shortcutUndo",
  redo: "shortcutRedo",
} as const satisfies Record<WhiteboardShortcutAction, keyof WhiteboardLabels>;

export function defaultWhiteboardShortcuts(
  platform?: string,
): WhiteboardShortcuts {
  return {
    save: "accel,S",
    find: "accel,F",
    select: "V",
    hand: "H",
    pan: "Space",
    freeMove: "alt",
    nudgeUp: "ArrowUp",
    nudgeDown: "ArrowDown",
    nudgeLeft: "ArrowLeft",
    nudgeRight: "ArrowRight",
    nudgeUpLarge: "shift,ArrowUp",
    nudgeDownLarge: "shift,ArrowDown",
    nudgeLeftLarge: "shift,ArrowLeft",
    nudgeRightLarge: "shift,ArrowRight",
    fitView: "shift,1",
    fitSelection: "shift,2",
    rect: "R",
    ellipse: "O",
    arrow: "A",
    line: "L",
    text: "T",
    question: "Q",
    claim: "C",
    frame: "F",
    eraser: "E",
    constrain: "shift",
    cancel: "Escape",
    delete: "Delete",
    undo: "accel,Z",
    redo: isMacPlatform(platform) ? "accel,shift,Z" : "accel,Y",
  };
}

export function isWhiteboardShortcuts(
  value: unknown,
): value is WhiteboardShortcuts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === WHITEBOARD_SHORTCUT_ACTIONS.length &&
    WHITEBOARD_SHORTCUT_ACTIONS.every(
      (action) =>
        Object.hasOwn(candidate, action) &&
        typeof candidate[action] === "string" &&
        (candidate[action] === "" ||
          normalizeKeyboardShortcut(candidate[action], {
            allowModifierOnly: WHITEBOARD_HOLD_SHORTCUT_ACTIONS.includes(
              action as WhiteboardHoldShortcutAction,
            ),
          }) !== null),
    )
  );
}

export function parseWhiteboardShortcuts(
  raw: string,
  platform?: string,
): WhiteboardShortcuts {
  const defaults = defaultWhiteboardShortcuts(platform);
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    return defaults;
  const candidate = stored as Record<string, unknown>;
  for (const action of WHITEBOARD_SHORTCUT_ACTIONS) {
    const value = candidate[action];
    if (
      typeof value === "string" &&
      (value === "" ||
        normalizeKeyboardShortcut(value, {
          allowModifierOnly: WHITEBOARD_HOLD_SHORTCUT_ACTIONS.includes(
            action as WhiteboardHoldShortcutAction,
          ),
        }) !== null)
    )
      defaults[action] = value;
  }
  return defaults;
}

export type WhiteboardShortcutProblem =
  | { kind: "invalid" }
  | { kind: "reserved" }
  | { kind: "duplicate"; command: WhiteboardShortcutAction | "new-note" };

export function validateWhiteboardShortcut(
  action: WhiteboardShortcutAction,
  raw: string,
  bindings: WhiteboardShortcuts,
  newNoteRaw: string,
  platform?: string,
): WhiteboardShortcutProblem | null {
  if (!raw) return null;
  const normalized = normalizeKeyboardShortcut(raw, {
    allowModifierOnly: WHITEBOARD_HOLD_SHORTCUT_ACTIONS.includes(
      action as WhiteboardHoldShortcutAction,
    ),
  });
  if (!normalized) return { kind: "invalid" };
  const identity = keyboardShortcutIdentity(normalized, platform);
  if (
    [
      "accel,A",
      "accel,C",
      "accel,X",
      "accel,V",
      "accel,W",
      "accel,Q",
      "accel,P",
      "accel,O",
      "accel,shift,I",
      "accel,alt,shift,I",
      ...Array.from({ length: 9 }, (_, i) => `accel,${i + 1}`),
    ].some((raw) => keyboardShortcutIdentity(raw, platform) === identity)
  )
    return { kind: "reserved" };
  const proposed = { ...bindings, [action]: normalized };
  const own = whiteboardShortcutAliases(action, proposed, platform).map((raw) =>
    keyboardShortcutIdentity(raw, platform),
  );
  for (const other of WHITEBOARD_SHORTCUT_ACTIONS) {
    if (
      other !== action &&
      whiteboardShortcutAliases(other, proposed, platform).some((raw) =>
        own.includes(keyboardShortcutIdentity(raw, platform)),
      )
    )
      return { kind: "duplicate", command: other };
  }
  if (own.includes(keyboardShortcutIdentity(newNoteRaw, platform)))
    return { kind: "duplicate", command: "new-note" };
  return null;
}

export function whiteboardShortcutAliases(
  action: WhiteboardShortcutAction,
  bindings: WhiteboardShortcuts,
  platform?: string,
): string[] {
  const raw = bindings[action];
  if (!raw) return [];
  if (raw !== defaultWhiteboardShortcuts(platform)[action]) return [raw];
  if (action === "delete") return [raw, "Backspace"];
  if (["save", "find", "undo", "redo"].includes(action)) {
    const aliases =
      action === "redo"
        ? [raw, isMacPlatform(platform) ? "accel,Y" : "accel,shift,Z"]
        : [raw];
    const alternate = isMacPlatform(platform) ? "control" : "meta";
    return [
      ...aliases,
      ...aliases.map((binding) => binding.replace("accel", alternate)),
    ];
  }
  return [raw];
}

export function whiteboardShortcutMatches(
  event: Parameters<typeof keyboardShortcutMatches>[0],
  action: WhiteboardShortcutAction,
  bindings: WhiteboardShortcuts,
  platform?: string,
): boolean {
  return whiteboardShortcutAliases(action, bindings, platform).some((raw) =>
    keyboardShortcutMatches(event, raw, platform),
  );
}

export function whiteboardShortcutLabel(
  raw: string,
  platform?: string,
): string {
  return shortcutKeycaps(raw, platform)
    .map(
      (key) =>
        ({
          ArrowUp: "↑",
          ArrowDown: "↓",
          ArrowLeft: "←",
          ArrowRight: "→",
          Escape: "Esc",
        })[key] ?? key,
    )
    .join(" + ");
}
