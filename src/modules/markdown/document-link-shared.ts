/** Data-only Markdown document link helpers shared by chrome and host code. */
import {
  parsePdfTextPosition,
  type PdfTextPosition,
} from "../../utils/pdf-position";

export type DocumentLinkReference =
  | { scope: "library"; key: string }
  | { scope: "group"; groupID: number; key: string };

const ZOTERO_KEY = "[A-Za-z0-9]{8}";

/** Parse the only Zotero URI forms Bamboo persists in Markdown. */
export function parseDocumentLink(value: string): DocumentLinkReference | null {
  if (typeof value !== "string") return null;
  // Do not normalize whitespace before checking the URI shape. Persisted links
  // have one canonical spelling and callers can trim user-entered query text
  // separately.
  const input = value;
  const library = new RegExp(
    `^zotero://select/library/items/(${ZOTERO_KEY})$`,
  ).exec(input);
  if (library) return { scope: "library", key: library[1] };
  const group = new RegExp(
    `^zotero://select/groups/([1-9][0-9]*)/items/(${ZOTERO_KEY})$`,
  ).exec(input);
  if (!group) return null;
  const groupID = Number(group[1]);
  return Number.isSafeInteger(groupID) && groupID > 0
    ? { scope: "group", groupID, key: group[2] }
    : null;
}

/** Parse [[name]] / [[name|display label]], excluding ![[images]]. */
export function parseWikiLink(
  value: string,
): { name: string; label: string } | null {
  if (typeof value !== "string" || value.startsWith("!")) return null;
  const match = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]$/.exec(value);
  if (!match) return null;
  const name = match[1].trim();
  const label = (match[2] ?? match[1]).trim();
  if (!name || !label) return null;
  return { name, label };
}

export function buildDocumentLink(target: {
  key: string;
  libraryID: number;
  isGroup: boolean;
  groupID?: number;
}): string {
  if (!/^[A-Za-z0-9]{8}$/.test(target.key)) {
    throw new Error("A Zotero item key is required");
  }
  if (target.isGroup) {
    if (
      !target.groupID ||
      !Number.isSafeInteger(target.groupID) ||
      target.groupID <= 0
    ) {
      throw new Error("A group link requires a valid group ID");
    }
    return `zotero://select/groups/${target.groupID}/items/${target.key}`;
  }
  return `zotero://select/library/items/${target.key}`;
}

/** Remove Bamboo's private storage prefix for display/matching only. */
export function documentLinkTitle(value: string): string {
  return value.trim().replace(/^(?:zmd-)+/i, "");
}

export interface PdfDocumentLink {
  reference: DocumentLinkReference;
  page?: number;
  annotationKey?: string;
  position?: PdfTextPosition;
}

/** Canonical PDF links, including the page-coordinate text selection we persist. */
export function parsePdfDocumentLink(value: string): PdfDocumentLink | null {
  const match =
    /^zotero:\/\/open-pdf\/(library|groups\/([1-9][0-9]*))\/items\/([A-Za-z0-9]{8})(?:\?(.+))?$/.exec(
      value,
    );
  if (!match) return null;
  const reference = parseDocumentLink(
    `zotero://select/${match[1]}/items/${match[3]}`,
  );
  if (!reference) return null;
  if (!match[4]) return { reference };
  const selection = /^page=([1-9][0-9]*)&position=([^&#\s]+)$/.exec(match[4]);
  if (selection) {
    try {
      const position = parsePdfTextPosition(
        JSON.parse(decodeURIComponent(selection[2])),
      );
      const page = Number(selection[1]);
      return position &&
        Number.isSafeInteger(page) &&
        page === position.pageIndex + 1
        ? { reference, page, position }
        : null;
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof URIError)
        return null;
      throw error;
    }
  }
  const location =
    /^(?:page=([1-9][0-9]*)(?:&annotation=([A-Za-z0-9]{8}))?|annotation=([A-Za-z0-9]{8}))$/.exec(
      match[4],
    );
  if (!location) return null;
  const page = location[1] ? Number(location[1]) : undefined;
  if (page !== undefined && !Number.isSafeInteger(page)) return null;
  const annotationKey = location[2] || location[3];
  return {
    reference,
    ...(page !== undefined ? { page } : {}),
    ...(annotationKey ? { annotationKey } : {}),
  };
}

export function isPdfDocumentLink(value: string): boolean {
  return parsePdfDocumentLink(value) !== null;
}
