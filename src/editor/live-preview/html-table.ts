import type { EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import {
  parseHtmlTableBlocksCore,
  renderHtmlTableCore,
} from "../../modules/markdown/preview-render-core";
import { eventTargetElement } from "../table-cell-edit";

export interface HtmlTableBlock {
  from: number;
  to: number;
  html: string;
  cellOffsets: number[];
}

/** Cache complete table output until an edit touches its owned source lines. */
export function htmlTableBlocks(
  state: EditorState,
  frontmatter: ReadonlySet<number>,
): HtmlTableBlock[] {
  const source = state.doc.toString();
  let body = source;
  if (frontmatter.size) {
    const end = state.doc.line(frontmatter.size).to;
    body = source.slice(0, end).replace(/[^\n]/g, " ") + source.slice(end);
  }
  return parseHtmlTableBlocksCore(body).map((table) => {
    const line = state.doc.lineAt(table.from);
    const from = source.slice(line.from, table.from).trim()
      ? table.from
      : line.from;
    return {
      from,
      to: table.to,
      html: renderHtmlTableCore(table, source),
      cellOffsets: table.rows.flatMap((row) =>
        row.cells.map((cell) => cell.contentFrom - from),
      ),
    };
  });
}

export class HtmlTableWidget extends WidgetType {
  constructor(
    readonly block: HtmlTableBlock,
    readonly from: number,
    readonly to: number,
    readonly canEdit: boolean,
  ) {
    super();
  }

  eq(other: HtmlTableWidget): boolean {
    return (
      this.block === other.block &&
      this.from === other.from &&
      this.to === other.to &&
      this.canEdit === other.canEdit
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = view.dom.ownerDocument.createElement("div");
    dom.className = "zmd-lp-html-table";
    dom.contentEditable = "false";
    dom.tabIndex = this.canEdit ? 0 : -1;
    dom.dataset.zmdHtmlTableFrom = String(this.from);
    dom.dataset.zmdHtmlTableTo = String(this.to);
    dom.innerHTML = this.block.html;
    const cells = Array.from(dom.querySelectorAll("td, th"));
    const edit = (event: Event) => {
      if (
        !dom.isConnected ||
        !this.canEdit ||
        view.state.readOnly ||
        !view.state.facet(EditorView.editable) ||
        view.compositionStarted
      )
        return;
      event.preventDefault();
      const cell = eventTargetElement(event)?.closest("td, th");
      const index = cell ? cells.indexOf(cell) : 0;
      const offset = this.block.cellOffsets[index] ?? this.block.cellOffsets[0];
      view.dispatch({ selection: { anchor: this.from + offset } });
      view.focus();
    };
    dom.addEventListener("mousedown", (event) => {
      if (event.button === 0 && eventTargetElement(event)?.closest("table"))
        edit(event);
    });
    dom.addEventListener("keydown", (event) => {
      if (event.key === "Enter") edit(event);
    });
    return dom;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
