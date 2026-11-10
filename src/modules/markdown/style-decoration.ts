import type { MarkdownStyle, MarkdownStyleColors } from "./style-presets";

export const MARKDOWN_DECORATION_TARGETS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "a",
  "code",
  "pre",
  "th",
  "td",
] as const;
export type MarkdownDecorationTarget =
  (typeof MARKDOWN_DECORATION_TARGETS)[number];
export const MARKDOWN_DECORATION_PROPERTIES = [
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
  "border-radius",
  "border-color",
] as const;
export type MarkdownDecorationProperty =
  (typeof MARKDOWN_DECORATION_PROPERTIES)[number];
export type MarkdownDecorationDeclarations = Partial<
  Record<MarkdownDecorationProperty, string>
>;
export interface MarkdownStyleDecoration {
  theme: "all" | "light" | "dark";
  target: MarkdownDecorationTarget;
  declarations: MarkdownDecorationDeclarations;
}

export const STYLE_COLOR_VARIABLES: Record<string, keyof MarkdownStyleColors> =
  {
    "--zmd-style-background": "background",
    "--zmd-style-text": "text",
    "--zmd-style-heading": "heading",
    "--zmd-style-link": "link",
    "--zmd-style-accent": "accent",
    "--zmd-style-quote-background": "quoteBackground",
    "--zmd-style-quote-border": "quoteBorder",
    "--zmd-style-code-background": "codeBackground",
    "--zmd-style-code-border": "codeBorder",
    "--zmd-style-table-header": "tableHeader",
    "--zmd-style-table-border": "tableBorder",
  };

export function decorationPropertyAllowed(
  target: MarkdownDecorationTarget,
  property: string,
): property is MarkdownDecorationProperty {
  if (
    !MARKDOWN_DECORATION_PROPERTIES.includes(
      property as MarkdownDecorationProperty,
    )
  )
    return false;
  if (property === "border-color")
    return ["blockquote", "pre", "th", "td"].includes(target);
  if (property === "text-align" || property === "border-radius")
    return target !== "a" && target !== "code";
  return true;
}

export function normalizeStyleColor(value: string): string | null {
  if (/^#[a-f\d]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[a-f\d]{3}$/i.test(value))
    return `#${[...value.slice(1)]
      .map((part) => part + part)
      .join("")
      .toLowerCase()}`;
  return null;
}

export function normalizeDecorationValue(
  property: MarkdownDecorationProperty,
  value: string,
): string | null {
  if (
    property === "color" ||
    property === "background-color" ||
    property === "border-color"
  ) {
    const color = normalizeStyleColor(value);
    if (color) return color;
    if (/^(transparent|currentcolor)$/i.test(value)) return value.toLowerCase();
    const variable = /^var\(\s*(--[a-z-]+)\s*\)$/.exec(value);
    return variable && Object.hasOwn(STYLE_COLOR_VARIABLES, variable[1])
      ? `var(${variable[1]})`
      : null;
  }
  if (property === "font-weight") {
    if (/^(normal|bold)$/.test(value)) return value;
    return /^\d{3}$/.test(value) && Number(value) >= 100 && Number(value) <= 900
      ? value
      : null;
  }
  if (property === "font-style")
    return /^(normal|italic|oblique)$/.test(value) ? value : null;
  if (property === "text-decoration")
    return /^(none|underline|line-through|overline)$/.test(value)
      ? value
      : null;
  if (property === "text-align")
    return /^(left|right|center|justify|start|end)$/.test(value) ? value : null;
  const radius = /^(\d+(?:\.\d+)?|\.\d+)(px|em)$/.exec(value);
  if (!radius) return value === "0" ? "0px" : null;
  const limit = radius[2] === "px" ? 32 : 2;
  return Number(radius[1]) <= limit ? `${Number(radius[1])}${radius[2]}` : null;
}

export function isMarkdownStyleDecorations(
  value: unknown,
): value is MarkdownStyleDecoration[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every((rule) => {
      if (
        !rule ||
        typeof rule !== "object" ||
        !["all", "light", "dark"].includes(rule.theme) ||
        !MARKDOWN_DECORATION_TARGETS.includes(rule.target) ||
        !rule.declarations ||
        typeof rule.declarations !== "object" ||
        Array.isArray(rule.declarations)
      )
        return false;
      return Object.entries(rule.declarations).every(
        ([property, entry]) =>
          decorationPropertyAllowed(rule.target, property) &&
          typeof entry === "string" &&
          normalizeDecorationValue(property, entry) !== null,
      );
    })
  );
}

/** Theme-qualified selectors outrank general ones, then source order wins. */
export function resolvedMarkdownDecorations(
  style: MarkdownStyle,
  theme: "light" | "dark",
) {
  const result: Partial<
    Record<MarkdownDecorationTarget, MarkdownDecorationDeclarations>
  > = {};
  for (const scope of ["all", theme]) {
    for (const rule of style.decorations ?? []) {
      if (rule.theme !== scope) continue;
      const declarations = (result[rule.target] ??= {});
      for (const [property, value] of Object.entries(rule.declarations)) {
        const normalized = normalizeDecorationValue(
          property as MarkdownDecorationProperty,
          value,
        )!;
        const variable = /^var\((--[a-z-]+)\)$/.exec(normalized);
        declarations[property as MarkdownDecorationProperty] = variable
          ? style[theme][STYLE_COLOR_VARIABLES[variable[1]]]
          : normalized;
      }
    }
  }
  return result;
}
