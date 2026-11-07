import { parseMarkdownImages } from "../../modules/markdown/images/model";
import { parseInlineL2 } from "./inline";
import {
  parseInlineHtmlRanges,
  type InlineHtmlRange,
} from "../../modules/markdown/inline-html";
import { planLiveImageDecorations } from "./images";
import {
  parseAtxHeading,
  parseBlockQuotePrefix,
  parseListPrefix,
} from "./structure";
import type {
  AtxHeadingParse,
  InlineRange,
  ListPrefixParse,
  PrefixParse,
} from "./types";
import type { MarkdownImageReference } from "../../modules/markdown/images/model";

export interface CachedLineParse {
  heading: AtxHeadingParse | null;
  list: ListPrefixParse | null;
  quote: PrefixParse | null;
  inlines: InlineRange[];
  html: InlineHtmlRange[];
  imagePlans: ReturnType<typeof planLiveImageDecorations>;
  /** Raw image references of the line (shared by both active/inactive). */
  images: MarkdownImageReference[];
}

const cache = new Map<
  string,
  { active: CachedLineParse; inactive: CachedLineParse }
>();
const CACHE_LIMIT = 2500;

function parseLine(text: string, active: boolean): CachedLineParse {
  const inlines = parseInlineL2(text);
  const images = parseMarkdownImages(text).filter(
    (image) =>
      !inlines.some(
        (range) =>
          range.kind === "code" &&
          range.from <= image.from &&
          range.to >= image.to,
      ),
  );
  return {
    heading: parseAtxHeading(text),
    list: parseListPrefix(text),
    quote: parseBlockQuotePrefix(text),
    inlines,
    html: parseInlineHtmlRanges(text),
    imagePlans: planLiveImageDecorations(text, active, images),
    images,
  };
}

export function cachedLineParse(
  text: string,
  active: boolean,
): CachedLineParse {
  let entry = cache.get(text);
  if (!entry) {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    entry = {
      active: parseLine(text, true),
      inactive: parseLine(text, false),
    };
    cache.set(text, entry);
  } else {
    // LRU recency refresh: full-document rebuilds insert lines in document
    // order, so insertion-order eviction alone would thrash the cache on
    // documents larger than CACHE_LIMIT. Touching the key on every hit keeps
    // the working set hot.
    cache.delete(text);
    cache.set(text, entry);
  }
  return active ? entry.active : entry.inactive;
}
