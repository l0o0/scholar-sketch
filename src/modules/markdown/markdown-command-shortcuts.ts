import {
  MARKDOWN_INSERT_COMMANDS,
  isMacPlatform,
  keyboardShortcutFromKeyboardEvent,
  keyboardShortcutIdentity,
  normalizeKeyboardShortcut,
  type MarkdownInsertCommand,
  type MarkdownInsertShortcuts,
} from "./shortcut";

export const MARKDOWN_COMMAND_ACTIONS = [
  "save",
  "find",
  "findNext",
  "findPrevious",
  "bold",
  "italic",
  "link",
  "h1",
  "h2",
  "h3",
  "undo",
  "redo",
  "indent",
  "unindent",
  "tableNext",
  "tablePrevious",
] as const;
export type MarkdownCommandAction = (typeof MARKDOWN_COMMAND_ACTIONS)[number];
export type MarkdownCommandShortcuts = Record<MarkdownCommandAction, string>;
export type MarkdownShortcutAction =
  MarkdownCommandAction | MarkdownInsertCommand | "new-note";

export const MARKDOWN_COMMAND_LABELS = {
  save: "whiteboard-save",
  find: "more-find",
  findNext: "settings-shortcut-find-next",
  findPrevious: "settings-shortcut-find-previous",
  bold: "sidebar-bold",
  italic: "sidebar-italic",
  link: "sidebar-link",
  h1: "tab-h1",
  h2: "tab-h2",
  h3: "tab-h3",
  undo: "whiteboard-undo",
  redo: "whiteboard-redo",
  indent: "settings-shortcut-indent",
  unindent: "settings-shortcut-unindent",
  tableNext: "settings-shortcut-table-next",
  tablePrevious: "settings-shortcut-table-previous",
} as const;

export function defaultMarkdownCommandShortcuts(
  platform?: string,
): MarkdownCommandShortcuts {
  return {
    save: "accel,S",
    find: "accel,F",
    findNext: "accel,G",
    findPrevious: "accel,shift,G",
    bold: "accel,B",
    italic: "accel,I",
    link: "accel,K",
    h1: "accel,alt,1",
    h2: "accel,alt,2",
    h3: "accel,alt,3",
    undo: "accel,Z",
    redo: isMacPlatform(platform) ? "accel,shift,Z" : "accel,Y",
    indent: "Tab",
    unindent: "shift,Tab",
    tableNext: "Tab",
    tablePrevious: "shift,Tab",
  };
}

const contextActions = new Set<MarkdownCommandAction>([
  "indent",
  "unindent",
  "tableNext",
  "tablePrevious",
]);
export function markdownCommandAllowsUnmodified(
  action: MarkdownCommandAction,
): boolean {
  return contextActions.has(action);
}

function isContextBinding(raw: string): boolean {
  const normalized = normalizeKeyboardShortcut(raw);
  if (!normalized) return false;
  const parts = normalized.split(",");
  const key = parts.pop()!;
  return (
    parts.some(
      (part) => part === "accel" || part === "control" || part === "meta",
    ) ||
    /^(Tab|Enter|Escape|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(
      key,
    )
  );
}

export function isMarkdownCommandShortcut(
  action: MarkdownCommandAction,
  raw: string,
): boolean {
  return (
    raw === "" ||
    (normalizeKeyboardShortcut(raw, {
      requireAccel: !markdownCommandAllowsUnmodified(action),
    }) !== null &&
      (!markdownCommandAllowsUnmodified(action) || isContextBinding(raw)))
  );
}

/** Legacy aliases belong to their command only while its default binding is retained. */
export function markdownCommandBindings(
  action: MarkdownCommandAction,
  shortcuts: MarkdownCommandShortcuts,
  platform?: string,
): string[] {
  const value = shortcuts[action];
  if (!value) return [];
  if (value !== defaultMarkdownCommandShortcuts(platform)[action])
    return [value];
  const aliases: Partial<Record<MarkdownCommandAction, string[]>> = {
    findNext: ["F3"],
    findPrevious: ["shift,F3"],
    indent: ["accel,]"],
    unindent: ["accel,["],
    ...(/Linux/i.test(platform ?? globalThis.navigator?.platform ?? "")
      ? { redo: ["accel,shift,Z"] }
      : {}),
  };
  return [value, ...(aliases[action] ?? [])];
}

const RESERVED = [
  "accel,alt,shift,I",
  ...["A", "C", "X", "V", "W", "Q", "P", "O"].map((key) => `accel,${key}`),
  ...["I", "T"].map((key) => `accel,shift,${key}`),
  ...Array.from({ length: 9 }, (_, i) => `accel,${i + 1}`),
];
export type MarkdownShortcutProblem =
  | { kind: "invalid" }
  | { kind: "reserved" }
  | { kind: "duplicate"; command: MarkdownShortcutAction };

function differentContexts(
  a: MarkdownShortcutAction,
  b: MarkdownShortcutAction,
): boolean {
  return (
    ((a === "indent" || a === "unindent") &&
      (b === "tableNext" || b === "tablePrevious")) ||
    ((b === "indent" || b === "unindent") &&
      (a === "tableNext" || a === "tablePrevious"))
  );
}

export function validateMarkdownShortcutAssignment(
  action: MarkdownShortcutAction,
  raw: string,
  commands: MarkdownCommandShortcuts,
  inserts: MarkdownInsertShortcuts,
  newNote: string,
  platform?: string,
): MarkdownShortcutProblem | null {
  if (!raw) return null;
  const isContext = contextActions.has(action as MarkdownCommandAction);
  if (action === "new-note" && !raw.includes(",")) return { kind: "invalid" };
  if (
    !normalizeKeyboardShortcut(raw, {
      requireAccel: !isContext && action !== "new-note",
    })
  )
    return { kind: "invalid" };
  // Unmodified text keys would consume normal document input.
  if (isContext && !isContextBinding(raw)) return { kind: "invalid" };
  const identity = keyboardShortcutIdentity(raw, platform);
  if (
    RESERVED.some(
      (value) => keyboardShortcutIdentity(value, platform) === identity,
    )
  )
    return { kind: "reserved" };
  for (const other of MARKDOWN_COMMAND_ACTIONS) {
    if (action === other || differentContexts(action, other)) continue;
    if (
      markdownCommandBindings(other, commands, platform).some(
        (value) => keyboardShortcutIdentity(value, platform) === identity,
      )
    )
      return { kind: "duplicate", command: other };
  }
  for (const other of MARKDOWN_INSERT_COMMANDS) {
    if (
      action !== other &&
      keyboardShortcutIdentity(inserts[other], platform) === identity
    )
      return { kind: "duplicate", command: other };
  }
  if (
    action !== "new-note" &&
    keyboardShortcutIdentity(newNote, platform) === identity
  )
    return { kind: "duplicate", command: "new-note" };
  return null;
}
export const validateMarkdownCommandShortcut =
  validateMarkdownShortcutAssignment;

export function markdownCommandShortcutFromKeyboardEvent(
  action: MarkdownCommandAction,
  event: Parameters<typeof keyboardShortcutFromKeyboardEvent>[0],
  platform?: string,
): string | null {
  const value = keyboardShortcutFromKeyboardEvent(event, platform, {
    requireAccel: !markdownCommandAllowsUnmodified(action),
  });
  if (!value) return null;
  if (markdownCommandAllowsUnmodified(action) && !isContextBinding(value))
    return null;
  return value;
}
