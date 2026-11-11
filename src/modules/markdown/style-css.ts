import {
  cloneMarkdownStyle,
  DEFAULT_MARKDOWN_STYLE,
  type MarkdownStyle,
} from "./style-presets";
import {
  MARKDOWN_DECORATION_TARGETS,
  MARKDOWN_DECORATION_PROPERTIES,
  STYLE_COLOR_VARIABLES,
  decorationPropertyAllowed,
  normalizeDecorationValue,
  normalizeStyleColor,
  type MarkdownDecorationTarget,
  type MarkdownStyleDecoration,
} from "./style-decoration";

export type MarkdownStyleCssIssueCode =
  | "syntax"
  | "selector"
  | "property"
  | "value"
  | "variable"
  | "at-rule"
  | "limit";
export interface MarkdownStyleCssIssue {
  line: number;
  code: MarkdownStyleCssIssueCode;
  detail?: string;
  message: string;
}
export type MarkdownStyleCssResult =
  | { ok: true; style: MarkdownStyle }
  | { ok: false; issues: MarkdownStyleCssIssue[] };

type NumericVariable = {
  min: number;
  max: number;
  unit: string;
  get(style: MarkdownStyle): number;
  set(style: MarkdownStyle, value: number): void;
};
const numericVariables: Record<string, NumericVariable> = {
  "--zmd-style-size": {
    min: 11,
    max: 32,
    unit: "px",
    get: (s) => s.fontSize,
    set: (s, v) => {
      s.fontSize = v;
    },
  },
  "--zmd-style-line-height": {
    min: 1.2,
    max: 2.4,
    unit: "",
    get: (s) => s.lineHeight,
    set: (s, v) => {
      s.lineHeight = v;
    },
  },
  "--zmd-style-paragraph-spacing": {
    min: 0,
    max: 2,
    unit: "em",
    get: (s) => s.paragraphSpacing,
    set: (s, v) => {
      s.paragraphSpacing = v;
    },
  },
  "--zmd-style-width": {
    min: 360,
    max: 1200,
    unit: "px",
    get: (s) => s.contentWidth,
    set: (s, v) => {
      s.contentWidth = v;
    },
  },
};
for (let index = 0; index < 6; index++) {
  for (const [field, min, max, unit] of [
    ["size", 0.8, 3, "em"],
    ["weight", 400, 800, ""],
    ["before", 0, 3, "em"],
    ["after", 0, 2, "em"],
  ] as const) {
    numericVariables[`--zmd-style-h${index + 1}-${field}`] = {
      min,
      max,
      unit,
      get: (s) => s.headings[index][field],
      set: (s, v) => {
        s.headings[index][field] = v;
      },
    };
  }
}

type Declaration = { property: string; value: string; line: number };
type Rule = {
  theme: "all" | "light" | "dark";
  target?: MarkdownDecorationTarget;
  declarations: Declaration[];
};

/** This grammar consumes the entire input; unsupported CSS is never silently dropped. */
function parseRules(css: string): Rule[] {
  let pos = 0;
  let line = 1;
  const rules: Rule[] = [];
  const fail = (
    code: MarkdownStyleCssIssueCode,
    detail: string,
    at = line,
  ): never => {
    throw {
      line: at,
      code,
      detail: detail.slice(0, 120),
      message: `${code}: ${detail}`,
    } satisfies MarkdownStyleCssIssue;
  };
  const advance = () => {
    if (css[pos++] === "\n") line++;
  };
  const trivia = () => {
    while (pos < css.length) {
      if (/\s/.test(css[pos])) {
        advance();
        continue;
      }
      if (css.slice(pos, pos + 2) !== "/*") break;
      const start = line;
      advance();
      advance();
      while (pos < css.length && css.slice(pos, pos + 2) !== "*/") advance();
      if (pos === css.length) fail("syntax", "/*", start);
      advance();
      advance();
    }
  };
  while (pos < css.length) {
    trivia();
    if (pos === css.length) break;
    if (css[pos] === "@")
      fail("at-rule", css.slice(pos).match(/^@[-\w]+/)?.[0] ?? "@");
    const selectorLine = line;
    let selector = "";
    while (pos < css.length && css[pos] !== "{") {
      if (css[pos] === "}" || css[pos] === ";" || css[pos] === "\0")
        fail("syntax", css[pos]);
      if (css.slice(pos, pos + 2) === "/*") {
        trivia();
        selector += " ";
      } else {
        selector += css[pos];
        advance();
      }
    }
    if (pos === css.length) fail("syntax", selector.trim(), selectorLine);
    advance();
    const selectors = selector.split(",").map((part) => {
      const match =
        /^\s*\.markdown(?:\[data-theme=(?:"(light|dark)"|'(light|dark)'|(light|dark))\])?(?:\s+(h[1-6]|blockquote|a|code|pre|th|td))?\s*$/.exec(
          part,
        );
      if (!match) return fail("selector", part.trim(), selectorLine);
      return {
        theme: (match[1] ?? match[2] ?? match[3] ?? "all") as Rule["theme"],
        target: match[4] as MarkdownDecorationTarget | undefined,
      };
    });
    const declarations: Declaration[] = [];
    let closed = false;
    while (pos < css.length) {
      trivia();
      if (css[pos] === "}") {
        advance();
        closed = true;
        break;
      }
      const declarationLine = line;
      const propertyStart = pos;
      while (pos < css.length && /[-a-zA-Z0-9]/.test(css[pos])) advance();
      const property = css.slice(propertyStart, pos);
      trivia();
      if (!property || css[pos] !== ":")
        fail("syntax", property || css[pos] || "}", declarationLine);
      advance();
      let value = "";
      let quote = "";
      let parentheses = 0;
      while (pos < css.length) {
        const char = css[pos];
        if (quote) {
          if (char === "\\") fail("value", "\\", declarationLine);
          value += char;
          advance();
          if (char === quote) quote = "";
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
          value += char;
          advance();
          continue;
        }
        if (css.slice(pos, pos + 2) === "/*") {
          trivia();
          value += " ";
          continue;
        }
        if (char === "{") fail("syntax", "{", declarationLine);
        if (char === "(") parentheses++;
        if (char === ")" && --parentheses < 0)
          fail("syntax", ")", declarationLine);
        if (char === ";" || char === "}") {
          if (parentheses) fail("syntax", "(", declarationLine);
          break;
        }
        value += char;
        advance();
      }
      if (quote || parentheses || !value.trim())
        fail("syntax", value.trim(), declarationLine);
      declarations.push({
        property,
        value: value.trim(),
        line: declarationLine,
      });
      if (css[pos] === ";") advance();
    }
    if (!closed) fail("syntax", "{", selectorLine);
    for (const scope of selectors) rules.push({ ...scope, declarations });
    if (rules.length > 128) fail("limit", "128");
  }
  return rules;
}

export function compileMarkdownStyleCss(css: string): MarkdownStyleCssResult {
  if (css.length > 64000)
    return {
      ok: false,
      issues: [
        {
          line: 1,
          code: "limit",
          detail: "64000",
          message: "CSS exceeds 64000 characters",
        },
      ],
    };
  let rules: Rule[];
  try {
    rules = parseRules(css);
  } catch (issue) {
    return { ok: false, issues: [issue as MarkdownStyleCssIssue] };
  }
  const style = cloneMarkdownStyle(DEFAULT_MARKDOWN_STYLE);
  const issues: MarkdownStyleCssIssue[] = [];
  const add = (
    declaration: Declaration,
    code: MarkdownStyleCssIssueCode,
    detail = declaration.property,
  ) =>
    issues.push({
      line: declaration.line,
      code,
      detail,
      message: `${code}: ${detail}`,
    });
  // Root colors follow CSS specificity, so a later generic rule cannot override
  // an explicitly selected light/dark palette. Typography is shared by both.
  for (const scope of ["all", "light", "dark"] as const) {
    for (const rule of rules) {
      if (rule.target || rule.theme !== scope) continue;
      for (const declaration of rule.declarations) {
        const { property, value } = declaration;
        if (Object.hasOwn(STYLE_COLOR_VARIABLES, property)) {
          const color = normalizeStyleColor(value);
          if (!color) {
            add(declaration, "value", value);
            continue;
          }
          for (const theme of scope === "all"
            ? (["light", "dark"] as const)
            : [scope])
            style[theme][STYLE_COLOR_VARIABLES[property]] = color;
        } else if (property === "--zmd-style-font") {
          if (scope !== "all") {
            add(declaration, "variable");
            continue;
          }
          if (!["system", "serif", "mono"].includes(value)) {
            add(declaration, "value", value);
            continue;
          }
          style.fontFamily = value as MarkdownStyle["fontFamily"];
        } else if (Object.hasOwn(numericVariables, property)) {
          if (scope !== "all") {
            add(declaration, "variable");
            continue;
          }
          const config = numericVariables[property];
          const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px|em)?$/.exec(value);
          const number = match ? Number(match[1]) : NaN;
          if (
            !match ||
            ((match[2] ?? "") !== config.unit &&
              !(number === 0 && !match[2])) ||
            number < config.min ||
            number > config.max
          ) {
            add(declaration, "value", value);
            continue;
          }
          config.set(style, number);
        } else
          add(declaration, property.startsWith("--") ? "variable" : "property");
      }
    }
  }
  const decorations: MarkdownStyleDecoration[] = [];
  for (const rule of rules) {
    if (!rule.target) continue;
    const result: MarkdownStyleDecoration = {
      theme: rule.theme,
      target: rule.target,
      declarations: {},
    };
    for (const declaration of rule.declarations) {
      if (!decorationPropertyAllowed(rule.target, declaration.property)) {
        add(declaration, "property");
        continue;
      }
      const value = normalizeDecorationValue(
        declaration.property,
        declaration.value,
      );
      if (value === null) {
        add(declaration, "value", declaration.value);
        continue;
      }
      result.declarations[declaration.property] = value;
    }
    if (Object.keys(result.declarations).length) decorations.push(result);
  }
  if (decorations.length) style.decorations = decorations;
  return issues.length ? { ok: false, issues } : { ok: true, style };
}

export function serializeMarkdownStyleCss(style: MarkdownStyle): string {
  const typography = [
    `  --zmd-style-font: ${style.fontFamily};`,
    ...Object.entries(numericVariables).map(
      ([name, config]) => `  ${name}: ${config.get(style)}${config.unit};`,
    ),
  ];
  const blocks = [`.markdown {\n${typography.join("\n")}\n}`];
  for (const theme of ["light", "dark"] as const)
    blocks.push(
      `.markdown[data-theme="${theme}"] {\n${Object.entries(
        STYLE_COLOR_VARIABLES,
      )
        .map(([name, field]) => `  ${name}: ${style[theme][field]};`)
        .join("\n")}\n}`,
    );
  for (const rule of style.decorations ?? []) {
    const selector = `.markdown${rule.theme === "all" ? "" : `[data-theme="${rule.theme}"]`} ${rule.target}`;
    blocks.push(
      `${selector} {\n${Object.entries(rule.declarations)
        .map(([key, value]) => `  ${key}: ${value};`)
        .join("\n")}\n}`,
    );
  }
  return blocks.join("\n\n");
}

export function getMarkdownStyleCssReference(): string {
  return [
    "Scholar Sketch Markdown CSS contract (a supported subset, not arbitrary webpage CSS).",
    'Root selectors: .markdown; .markdown[data-theme="light"]; .markdown[data-theme="dark"]. Root rules accept only the variables below.',
    "Typography variables belong only in .markdown. Font IDs: --zmd-style-font: system | serif | mono.",
    ...Object.entries(numericVariables).map(
      ([name, config]) =>
        `${name}: ${config.min}–${config.max}${config.unit || " (unitless)"}.`,
    ),
    `Color variables: ${Object.keys(STYLE_COLOR_VARIABLES).join(", ")}. Use #RGB or #RRGGBB. Shared colors may appear in .markdown; theme-specific colors override them.`,
    `Element selectors: append one of ${MARKDOWN_DECORATION_TARGETS.join(", ")} to any root selector. Comma-separated supported selectors are allowed.`,
    `Supported decoration properties: ${MARKDOWN_DECORATION_PROPERTIES.join(", ")}. text-align and border-radius apply only to block targets (not a/code). border-color applies only to blockquote/pre/th/td, coloring existing borders.`,
    "Decoration colors: #RGB, #RRGGBB, transparent, currentColor, or var(--zmd-style-COLOR) referring to a listed color variable. font-weight: normal, bold or integers 100–900; font-style: normal/italic/oblique; text-decoration: none/underline/line-through/overline; text-align: left/right/center/justify/start/end; border-radius: 0–32px or 0–2em.",
    "code styles code text (inline and block content); pre styles the surrounding code block. As in HTML, explicit code properties outrank properties inherited from pre. Paragraph spacing preserves editable source blank lines; Live and Reading are not pixel-identical.",
    "Rules use braces and property: value declarations separated by semicolons. CSS comments are allowed. Reject all other selectors/properties, !important, nested rules, at-rules including @import/@font-face/@media, escapes, url(), calc(), remote resources and arbitrary functions. Only the color var() form above is supported. No layout/position/cursor/selection rules. Limit: 64000 characters and 128 selector rules.",
    "Return CSS only, without Markdown fences, HTML, JavaScript or explanatory prose. Use the common sample supplied by the app; do not assume access to a user's notes.",
  ].join("\n");
}
