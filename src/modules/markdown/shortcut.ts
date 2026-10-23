export const DEFAULT_NEW_MARKDOWN_SHORTCUT = "accel,shift,M";
export const MARKDOWN_IMAGE_SHORTCUT = "Mod-Alt-i";

export function markdownImageShortcutLabel(platform?: string): string {
  return MARKDOWN_IMAGE_SHORTCUT.split("-")
    .map((part) => {
      if (part === "Mod") return isMacPlatform(platform) ? "Cmd" : "Ctrl";
      if (part === "Alt") return isMacPlatform(platform) ? "Option" : "Alt";
      return part.toUpperCase();
    })
    .join(" + ");
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
