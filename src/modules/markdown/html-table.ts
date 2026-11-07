import { decodeImageAttribute } from "./images/html";

type TableSection = "thead" | "tbody" | "tfoot";
type TableTag = "table" | TableSection | "tr" | "td" | "th" | "caption";

export interface HtmlTableContent {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

export interface HtmlTableCell extends HtmlTableContent {
  header: boolean;
  colspan?: number;
  rowspan?: number;
}

export interface HtmlTableRow {
  from: number;
  to: number;
  section: TableSection | null;
  cells: HtmlTableCell[];
}

export interface HtmlTable {
  from: number;
  to: number;
  contentFrom: number;
  rows: HtmlTableRow[];
  caption?: HtmlTableContent;
}

type StructuralTag = {
  name: TableTag;
  closing: boolean;
  from: number;
  to: number;
  colspan?: number;
  rowspan?: number;
};

function readCellSpans(attributes: string, tag: StructuralTag): void {
  const pattern = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const attribute of attributes.matchAll(pattern)) {
    const key = attribute[1].toLowerCase();
    if ((key !== "colspan" && key !== "rowspan") || tag[key] !== undefined)
      continue;
    const value = decodeImageAttribute(
      attribute[2] ?? attribute[3] ?? attribute[4],
    );
    if (/^[1-9]\d*$/.test(value) && Number(value) <= 1000)
      tag[key] = Number(value);
  }
}

/** Parse only completed table structure, keeping cell contents in source coordinates. */
export function parseHtmlTable(source: string, from = 0): HtmlTable | null {
  if (!/^<table(?=[\s>])/i.test(source.slice(from, from + 7))) return null;
  // Read whole tags, including unknown inline tags, so quoted attributes cannot
  // introduce structural boundaries. Markdown and math are parsed per cell.
  const tags =
    /<!--[^]*?-->|<(\/?)([a-z][a-z\d:-]*)(?=[\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>/gi;
  tags.lastIndex = from;
  let table: HtmlTable | null = null;
  let section: TableSection | null = null;
  let row: HtmlTableRow | null = null;
  let cell: HtmlTableCell | null = null;
  let caption: HtmlTableContent | null = null;
  let cursor = from;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(source))) {
    if (match[0].startsWith("<!--")) continue;
    const name = match[2].toLowerCase();
    if (!/^(?:table|thead|tbody|tfoot|tr|td|th|caption)$/.test(name)) continue;
    const closing = match[1] === "/";
    if (/\/\s*$/.test(match[3]) || (closing && match[3].trim())) return null;
    const tag: StructuralTag = {
      name: name as TableTag,
      closing,
      from: match.index,
      to: tags.lastIndex,
    };
    if (!table) {
      if (tag.from !== from || tag.name !== "table" || tag.closing) return null;
      table = { from, to: tag.to, contentFrom: tag.to, rows: [] };
      cursor = tag.to;
      continue;
    }
    if (cell) {
      if (!tag.closing || tag.name !== (cell.header ? "th" : "td")) return null;
      cell.contentTo = tag.from;
      cell.to = tag.to;
      row!.cells.push(cell);
      cell = null;
      cursor = tag.to;
      continue;
    }
    if (caption) {
      if (!tag.closing || tag.name !== "caption") return null;
      caption.contentTo = tag.from;
      caption.to = tag.to;
      table.caption = caption;
      caption = null;
      cursor = tag.to;
      continue;
    }
    if (source.slice(cursor, tag.from).trim()) return null;
    cursor = tag.to;
    if (tag.name === "table") {
      if (!tag.closing || row || section || !table.rows.length) return null;
      table.to = tag.to;
      return table;
    }
    if (tag.name === "thead" || tag.name === "tbody" || tag.name === "tfoot") {
      if (row || (tag.closing ? section !== tag.name : section !== null))
        return null;
      section = tag.closing ? null : tag.name;
      continue;
    }
    if (tag.name === "tr") {
      if (tag.closing) {
        if (!row || !row.cells.length) return null;
        row.to = tag.to;
        table.rows.push(row);
        row = null;
      } else {
        if (row) return null;
        row = { from: tag.from, to: tag.to, section, cells: [] };
      }
      continue;
    }
    if (tag.name === "caption") {
      if (tag.closing || row || section || table.caption || table.rows.length)
        return null;
      caption = {
        from: tag.from,
        to: tag.to,
        contentFrom: tag.to,
        contentTo: tag.to,
      };
      continue;
    }
    if (tag.closing || !row) return null;
    readCellSpans(match[3], tag);
    cell = {
      from: tag.from,
      to: tag.to,
      contentFrom: tag.to,
      contentTo: tag.to,
      header: tag.name === "th",
      ...(tag.colspan ? { colspan: tag.colspan } : {}),
      ...(tag.rowspan ? { rowspan: tag.rowspan } : {}),
    };
  }
  return null;
}
