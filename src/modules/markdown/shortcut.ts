export const DEFAULT_NEW_MARKDOWN_SHORTCUT = "accel,shift,M";
export const MARKDOWN_INSERT_COMMANDS = [
  "annotation",
  "image",
  "table",
  "task",
  "code",
] as const;
export type MarkdownInsertCommand = (typeof MARKDOWN_INSERT_COMMANDS)[number];
export type MarkdownInsertShortcuts = Record<MarkdownInsertCommand, string>;

export const DEFAULT_MARKDOWN_INSERT_SHORTCUTS: Readonly<MarkdownInsertShortcuts> =
  {
    annotation: "accel,alt,A",
    image: "accel,alt,I",
    // Ctrl+Alt+T belongs to the terminal on common Linux desktops.
    table: "accel,alt,shift,T",
    task: "accel,alt,X",
    code: "accel,alt,C",
  };

const SHORTCUT_MODIFIERS = [
  "accel",
  "control",
  "meta",
  "alt",
  "shift",
] as const;
const NAMED_KEYS: Record<string, string> = {
  Space: " ",
  Comma: ",",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

// CodeMirror's keyCode fallback uses these base/Shift punctuation pairs.
const SHIFTED_SYMBOLS: Record<string, string> = {
  "`": "~",
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "(",
  "0": ")",
  "-": "_",
  "=": "+",
  "[": "{",
  "]": "}",
  "\\": "|",
  ";": ":",
  "'": '"',
  ",": "<",
  ".": ">",
  "/": "?",
};
const SYMBOL_CODES: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

function canonicalInsertKey(key: string, shift: boolean): string {
  const literal = NAMED_KEYS[key] ?? key;
  const base = shift
    ? (Object.entries(SHIFTED_SYMBOLS).find(
        ([, value]) => value === literal,
      )?.[0] ?? literal)
    : literal;
  if (base === ",") return "Comma";
  if (base === " ") return "Space";
  return base.length === 1 ? base.toUpperCase() : base;
}

function parsedInsertShortcut(
  raw: string,
): { modifiers: string[]; key: string; normalized: string } | null {
  const parts = raw.split(",").map((part) => part.trim());
  const key = parts.pop() || "";
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  if (
    !modifiers.has("accel") ||
    modifiers.size !== parts.length ||
    [...modifiers].some(
      (part) =>
        !SHORTCUT_MODIFIERS.includes(
          part as (typeof SHORTCUT_MODIFIERS)[number],
        ),
    ) ||
    !(
      Object.hasOwn(NAMED_KEYS, key) ||
      /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key) ||
      /^[!-~]$/.test(key)
    )
  )
    return null;
  const ordered = SHORTCUT_MODIFIERS.filter((modifier) =>
    modifiers.has(modifier),
  );
  const normalizedKey = canonicalInsertKey(key, modifiers.has("shift"));
  return {
    modifiers: ordered,
    key: normalizedKey,
    normalized: [...ordered, normalizedKey].join(","),
  };
}

/** Preferences retain the existing comma-separated format; the iframe consumes CM bindings. */
export function markdownInsertKeyBinding(
  raw: string,
  platform?: string,
): string | null {
  if (!raw) return null;
  const parsed = parsedInsertShortcut(raw);
  if (!parsed) return null;
  const modifiers: Record<string, string> = {
    accel: "Mod",
    control: "Ctrl",
    meta: "Meta",
    alt: "Alt",
    shift: "Shift",
  };
  let key =
    NAMED_KEYS[parsed.key] ??
    (parsed.key.length === 1 ? parsed.key.toLowerCase() : parsed.key);
  // Windows Ctrl+Alt avoids keyCode fallbacks to preserve AltGr characters.
  if (
    /Win/i.test(platform || "") &&
    parsed.modifiers.includes("alt") &&
    parsed.modifiers.includes("shift")
  )
    key = /^[a-z]$/i.test(key)
      ? key.toUpperCase()
      : (SHIFTED_SYMBOLS[key] ?? key);
  return [...parsed.modifiers.map((value) => modifiers[value]), key].join("-");
}

export function markdownShortcutLabel(raw: string, platform?: string): string {
  const parsed = parsedInsertShortcut(raw);
  if (!parsed) return "";
  const mac = isMacPlatform(platform);
  const modifiers: Record<string, string> = {
    accel: mac ? "Cmd" : "Ctrl",
    control: "Ctrl",
    meta: mac ? "Cmd" : "Meta",
    alt: mac ? "Option" : "Alt",
    shift: "Shift",
  };
  return [
    ...parsed.modifiers.map((value) => modifiers[value]),
    parsed.key === "Comma" ? "," : parsed.key,
  ].join(" + ");
}

// Fixed editing commands and native Zotero commands that cannot be reassigned here.
const RESERVED_INSERT_SHORTCUTS = new Set([
  ...[
    "S",
    "F",
    "G",
    "B",
    "I",
    "K",
    "Z",
    "Y",
    "A",
    "C",
    "X",
    "V",
    "W",
    "Q",
    "P",
    "O",
  ].map((key) => `accel,${key}`),
  ...["G", "Z", "I", "T"].map((key) => `accel,shift,${key}`),
  ...Array.from({ length: 9 }, (_, index) => `accel,${index + 1}`),
  ...[1, 2, 3].map((level) => `accel,alt,${level}`),
]);

export type MarkdownInsertShortcutProblem =
  | { kind: "invalid" }
  | { kind: "reserved" }
  | { kind: "duplicate"; command: MarkdownInsertCommand | "new-note" };

export function validateMarkdownInsertShortcut(
  command: MarkdownInsertCommand,
  raw: string,
  bindings: MarkdownInsertShortcuts,
  newStandaloneRaw: string,
): MarkdownInsertShortcutProblem | null {
  if (!raw) return null;
  const parsed = parsedInsertShortcut(raw);
  if (!parsed) return { kind: "invalid" };
  if (RESERVED_INSERT_SHORTCUTS.has(parsed.normalized))
    return { kind: "reserved" };
  for (const other of MARKDOWN_INSERT_COMMANDS) {
    if (
      other !== command &&
      parsedInsertShortcut(bindings[other])?.normalized === parsed.normalized
    )
      return { kind: "duplicate", command: other };
  }
  if (parsedInsertShortcut(newStandaloneRaw)?.normalized === parsed.normalized)
    return { kind: "duplicate", command: "new-note" };
  return null;
}

/** Option-generated characters name the base shortcut key; AltGr text remains text. */
export function markdownInsertShortcutFromKeyboardEvent(
  event: ShortcutKeyboardEvent & {
    code?: string;
    keyCode?: number;
    isComposing?: boolean;
    repeat?: boolean;
    getModifierState?: (key: string) => boolean;
  },
  platform?: string,
): string | null {
  const mac = isMacPlatform(platform);
  if (
    !(mac ? event.metaKey : event.ctrlKey) ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    isShortcutModifierKey(event.key)
  )
    return null;
  let key = event.key;
  let base: string | undefined;
  if (event.keyCode && event.keyCode >= 65 && event.keyCode <= 90)
    base = String.fromCharCode(event.keyCode);
  else if (/^Key[A-Z]$/.test(event.code || "")) base = event.code!.slice(3);
  else if (/^Digit[0-9]$/.test(event.code || "")) base = event.code!.slice(5);
  else base = SYMBOL_CODES[event.code || ""];
  if (
    !mac &&
    event.getModifierState?.("AltGraph") &&
    base &&
    canonicalInsertKey(key, event.shiftKey) !== canonicalInsertKey(base, false)
  )
    return null;
  if (mac && event.altKey && !/^[!-~]$/.test(key) && base) key = base;
  if (key === ",") key = "Comma";
  if (key === " ") key = "Space";
  const recorded = shortcutFromKeyboardEvent(
    {
      ...event,
      key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    },
    platform,
  );
  return recorded ? (parsedInsertShortcut(recorded)?.normalized ?? null) : null;
}

// Zotero captures Mod-1…9 for tab navigation before the editor receives them.
// Keep the heading bindings and their help labels together.
export const MARKDOWN_HEADING_SHORTCUTS = [
  { key: "Mod-Alt-1", level: 1 },
  { key: "Mod-Alt-2", level: 2 },
  { key: "Mod-Alt-3", level: 3 },
] as const;

export function markdownHeadingShortcutLabel(
  level: number,
  platform?: string,
): string {
  return isMacPlatform(platform)
    ? `Cmd + Option + ${level}`
    : `Ctrl + Alt + ${level}`;
}

export function markdownRedoShortcutLabel(platform?: string): string {
  return isMacPlatform(platform) ? "Cmd + Shift + Z" : "Ctrl + Y";
}

export interface ShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "OS",
  "Shift",
]);

function isMacPlatform(platform?: string): boolean {
  const value = platform ?? globalThis.navigator?.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(value);
}

export function isShortcutModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

export function resolveConfiguredShortcut(
  value: string | null | undefined,
): string {
  return value ?? DEFAULT_NEW_MARKDOWN_SHORTCUT;
}

export function shortcutKeycaps(raw: string, platform?: string): string[] {
  const mac = isMacPlatform(platform);
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      switch (token.toLowerCase()) {
        case "accel":
          return mac ? "⌘" : "Ctrl";
        case "control":
        case "ctrl":
          return mac ? "⌃" : "Ctrl";
        case "alt":
          return mac ? "⌥" : "Alt";
        case "shift":
          return mac ? "⇧" : "Shift";
        case "meta":
          return mac ? "⌘" : "Meta";
        default:
          return token.length === 1 ? token.toUpperCase() : token;
      }
    });
}

export function shortcutFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
  platform?: string,
): string | null {
  if (!event.key || isShortcutModifierKey(event.key)) return null;
  const mac = isMacPlatform(platform);
  const tokens: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) tokens.push("accel");
  if (mac && event.ctrlKey) tokens.push("control");
  if (!mac && event.metaKey) tokens.push("meta");
  if (event.altKey) tokens.push("alt");
  if (event.shiftKey) tokens.push("shift");
  if (!tokens.length) return null;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  tokens.push(key);
  return tokens.join(",");
}
