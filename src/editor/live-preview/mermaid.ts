import { Facet, type EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import type { syntaxTree } from "@codemirror/language";
import type { EditorMermaidLabels } from "../../modules/markdown/editor-protocol";
import { mountMermaidBlock } from "../../modules/markdown/mermaid-view";

export interface MermaidBlockRange {
  from: number;
  to: number;
}

export const editorMermaidLabels = Facet.define<
  EditorMermaidLabels,
  EditorMermaidLabels | undefined
>({
  combine: (values) => values[0],
});

/** Only completed Markdown fences become diagrams; examples in code stay text. */
export function mermaidBlockFromNode(
  state: EditorState,
  node: ReturnType<typeof syntaxTree>["topNode"],
): MermaidBlockRange | null {
  if (node.name !== "FencedCode") return null;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  if (first.number === last.number) return null;
  const opening = /^[ ]{0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*$/i.exec(
    first.text,
  );
  const closing = /^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(last.text);
  if (
    !opening ||
    !closing ||
    opening[1][0] !== closing[1][0] ||
    opening[1].length > closing[1].length ||
    node.lastChild?.name !== "CodeMark"
  )
    return null;
  return { from: first.from, to: last.to };
}

export class MermaidWidget extends WidgetType {
  private disposers = new WeakMap<HTMLElement, () => void>();

  constructor(
    readonly block: MermaidBlockRange,
    readonly source: string,
    readonly sourceFrom: number,
    readonly theme: "light" | "dark",
    readonly labels: EditorMermaidLabels | undefined,
    readonly editable: boolean,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return (
      this.block.from === other.block.from &&
      this.block.to === other.block.to &&
      this.source === other.source &&
      this.sourceFrom === other.sourceFrom &&
      this.theme === other.theme &&
      this.labels === other.labels &&
      this.editable === other.editable
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = view.dom.ownerDocument.createElement("div");
    dom.className = "zmd-lp-mermaid";
    dom.contentEditable = "false";
    dom.dataset.zmdMermaidFrom = String(this.block.from);
    dom.dataset.zmdMermaidTo = String(this.block.to);
    let live = true;
    const edit = () => {
      if (
        !live ||
        !this.editable ||
        view.state.readOnly ||
        view.compositionStarted
      )
        return;
      view.dispatch({ selection: { anchor: this.sourceFrom } });
      view.focus();
    };
    const dispose = mountMermaidBlock(dom, this.source, {
      theme: this.theme,
      labels: this.labels,
      onLayout: () => {
        if (live && dom.isConnected) view.requestMeasure();
      },
      onEdit: this.editable ? edit : undefined,
    });
    this.disposers.set(dom, () => {
      live = false;
      dispose();
    });
    return dom;
  }

  destroy(dom: HTMLElement): void {
    this.disposers.get(dom)?.();
    this.disposers.delete(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }
}
