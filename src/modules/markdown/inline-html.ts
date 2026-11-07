import MarkdownIt from "markdown-it";
import { configureMath } from "./math";

const MarkdownItCtor: typeof MarkdownIt =
  typeof MarkdownIt === "function"
    ? MarkdownIt
    : (MarkdownIt as unknown as { default: typeof MarkdownIt }).default;

export type InlineHtmlTag =
  | "sup"
  | "sub"
  | "u"
  | "mark"
  | "kbd"
  | "b"
  | "strong"
  | "i"
  | "em"
  | "s"
  | "del"
  | "small"
  | "code"
  | "br";

export interface InlineHtmlRange {
  from: number;
  openTo: number;
  closeFrom: number;
  to: number;
  tag: InlineHtmlTag;
}

interface InlineHtmlTokenMeta {
  closing: boolean;
  range: InlineHtmlRange;
}

type InlineHtmlToken = InstanceType<typeof MarkdownItCtor.Token> & {
  meta: InlineHtmlTokenMeta;
};

/** Render only paired, attribute-free formatting tags and standalone breaks. */
export function configureInlineHtml(md: InstanceType<typeof MarkdownIt>): void {
  md.inline.ruler.before("html_inline", "zmd_inline_html", (state, silent) => {
    if (state.src[state.pos] !== "<") return false;
    const match =
      /^<(\/?)(sup|sub|u|mark|kbd|b|strong|i|em|s|del|small|code|br)\s*(\/?)>/i.exec(
        state.src.slice(state.pos, state.posMax),
      );
    if (!match) return false;
    const tag = match[2].toLowerCase() as InlineHtmlTag;
    const closing = match[1] === "/";
    if ((tag === "br" && closing) || (tag !== "br" && match[3])) return false;
    const to = state.pos + match[0].length;
    if (!silent) {
      const token = state.push(
        tag === "br" ? "zmd_inline_html" : "zmd_inline_html_candidate",
        tag,
        0,
      );
      token.content = match[0];
      token.meta = {
        closing,
        range: { from: state.pos, openTo: to, closeFrom: to, to, tag },
      } satisfies InlineHtmlTokenMeta;
    }
    state.pos = to;
    return true;
  });

  md.inline.ruler2.before(
    "fragments_join",
    "zmd_inline_html_pairs",
    (state) => {
      const openings: InlineHtmlToken[] = [];
      for (const value of state.tokens) {
        if (value.type !== "zmd_inline_html_candidate") continue;
        const token = value as InlineHtmlToken;
        if (!token.meta.closing) {
          openings.push(token);
          continue;
        }
        const opener = openings.at(-1);
        if (opener?.tag !== token.tag) continue;
        openings.pop();
        opener.type = token.type = "zmd_inline_html";
        opener.nesting = 1;
        token.nesting = -1;
        opener.meta.range.closeFrom = token.meta.range.from;
        opener.meta.range.to = token.meta.range.to;
      }
      for (const token of state.tokens) {
        if (token.type === "zmd_inline_html_candidate") {
          token.type = "text";
          token.tag = "";
        }
      }
    },
  );

  md.renderer.rules.zmd_inline_html = (tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options);
}

const rangeParser = new MarkdownItCtor({ html: false });
configureMath(rangeParser);
configureInlineHtml(rangeParser);

/** The Live editor shares the renderer's code, escape and tag-pairing rules. */
export function parseInlineHtmlRanges(source: string): InlineHtmlRange[] {
  if (!source.includes("<")) return [];
  const tokens = rangeParser.parseInline(source, {});
  return (tokens[0]?.children ?? [])
    .filter((token) => token.type === "zmd_inline_html" && token.nesting !== -1)
    .map((token) => (token as InlineHtmlToken).meta.range);
}
