import type { CanvasNodeStyle } from "./core";

export interface CanvasTextLayout {
  width: number;
  height: number;
  text?: string;
}

export function glyphWidth(character: string, fontSize: number): number {
  if (/\s/u.test(character)) return fontSize * 0.33;
  if (/[ilI1.,'`:;!|]/u.test(character)) return fontSize * 0.3;
  if (/[MW@%&#]/u.test(character)) return fontSize * 0.9;
  const codePoint = character.codePointAt(0) ?? 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  ) {
    return fontSize;
  }
  return fontSize * 0.6;
}

function wrapVisualLine(
  value: string | readonly string[],
  availableWidth: number,
  fontSize: number,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  const characters = typeof value === "string" ? Array.from(value) : value;
  if (!characters.length) return [""];
  const lines: string[] = [];
  let start = 0;
  while (start < characters.length && lines.length < maxLines) {
    while (start < characters.length && /\s/u.test(characters[start]!)) {
      start += 1;
    }
    if (start >= characters.length) break;
    let end = start;
    let width = 0;
    let lastBreak = -1;
    while (end < characters.length) {
      const nextWidth = width + glyphWidth(characters[end]!, fontSize);
      if (nextWidth > availableWidth && end > start) break;
      width = nextWidth;
      if (/\s/u.test(characters[end]!)) lastBreak = end;
      end += 1;
      if (width > availableWidth) break;
    }
    if (end >= characters.length) {
      lines.push(characters.slice(start).join("").trimEnd());
      break;
    }
    if (lastBreak >= start) {
      lines.push(characters.slice(start, lastBreak).join("").trimEnd());
      start = lastBreak + 1;
      continue;
    }
    lines.push(characters.slice(start, end).join(""));
    start = end;
  }
  return lines.length ? lines : [""];
}

export function wrappedTextLines(
  value: string,
  availableWidth: number,
  fontSize: number,
): string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => wrapVisualLine(line, availableWidth, fontSize));
}

/** Resolve only the automatic shape size; an explicit size is handled by the caller. */
export function automaticShapeFontSize(
  style: Partial<CanvasNodeStyle>,
  layout?: CanvasTextLayout,
): number {
  if (
    !layout ||
    !Number.isFinite(layout.width) ||
    !Number.isFinite(layout.height) ||
    layout.width <= 0 ||
    layout.height <= 0
  ) {
    return 16;
  }
  const target = Math.min(
    64,
    Math.max(
      16,
      Math.round(16 * Math.min(layout.width / 120, layout.height / 80)),
    ),
  );
  if (!layout.text?.trim()) return target;

  const width =
    style.shape === "diamond" ? layout.width * 0.54 : layout.width - 24;
  const height =
    style.shape === "diamond" ? layout.height * 0.58 : layout.height - 24;
  if (width <= 0 || height <= 0) return 14;

  // Prepare Unicode code points once. Each fit check stops as soon as another
  // line would overflow; the integer binary search takes at most six checks.
  const lines = layout.text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => Array.from(line));
  let widestGlyph = 0;
  for (const line of lines) {
    for (const character of line) {
      widestGlyph = Math.max(widestGlyph, glyphWidth(character, 1));
    }
  }
  const fits = (fontSize: number) => {
    const maxLines = Math.floor(height / (fontSize * 1.25));
    if (maxLines < 1 || widestGlyph * fontSize > width) return false;
    let count = 0;
    for (const line of lines) {
      count += wrapVisualLine(
        line,
        width,
        fontSize,
        maxLines - count + 1,
      ).length;
      if (count > maxLines) return false;
    }
    return true;
  };
  if (fits(target)) return target;
  let low = 14;
  let high = target - 1;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    if (fits(candidate)) low = candidate;
    else high = candidate - 1;
  }
  // Very small shapes or long text may still overflow at the readable floor.
  // Keep the text intact rather than making it unreadably small.
  return low;
}
