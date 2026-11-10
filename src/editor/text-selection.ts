import { Transaction, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { EditorTextSelection } from "../modules/markdown/editor-protocol";
import { eventTargetElement } from "./table-cell-edit";

/** The iframe reports canonical text; translation and its popup belong to the host. */
export function editorTextSelection(options: {
  getRevision(): number;
  isComposing(): boolean;
  publish(selection: EditorTextSelection | null): void;
}): Extension {
  return ViewPlugin.fromClass(
    class {
      private active: EditorTextSelection | null = null;
      private generation = 0;
      private dragging = false;
      private destroyed = false;
      private readonly win: Window;

      constructor(private readonly view: EditorView) {
        this.win = view.dom.ownerDocument.defaultView!;
        view.dom.addEventListener("mousedown", this.mouseDown, true);
        this.win.addEventListener("mouseup", this.mouseUp, true);
        view.dom.addEventListener("dblclick", this.doubleClick, true);
        view.dom.addEventListener("keydown", this.keyDown, true);
        view.dom.addEventListener("keyup", this.keyUp, true);
        view.dom.addEventListener(
          "compositionstart",
          this.compositionStart,
          true,
        );
        view.scrollDOM.addEventListener("scroll", this.remeasure);
        this.win.addEventListener("resize", this.remeasure);
        this.win.addEventListener("blur", this.cancelDrag);
      }

      private editorTarget(event: Event) {
        const element = eventTargetElement(event);
        return (
          element &&
          this.view.contentDOM.contains(element) &&
          !element.closest("input,textarea,.zmd-lp-table-cell-editing")
        );
      }

      private mouseDown = (event: MouseEvent) => {
        this.clear();
        this.dragging = event.button === 0 && !!this.editorTarget(event);
      };
      private mouseUp = (event: MouseEvent) => {
        const selecting = this.dragging || !!this.editorTarget(event);
        this.dragging = false;
        if (event.button === 0 && selecting) this.measure();
      };
      private doubleClick = (event: MouseEvent) => {
        if (this.editorTarget(event)) this.measure();
      };
      private keyDown = () => this.clear();
      private keyUp = (event: KeyboardEvent) => {
        if (
          event.isComposing ||
          event.keyCode === 229 ||
          !this.editorTarget(event)
        )
          return;
        if (
          (event.shiftKey &&
            /^(?:Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(
              event.key,
            )) ||
          ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a")
        )
          this.measure();
      };
      private compositionStart = () => {
        this.dragging = false;
        this.clear();
      };
      private cancelDrag = () => {
        if (!this.dragging) return;
        this.dragging = false;
        this.clear();
      };
      private remeasure = () => {
        if (this.active) this.measure();
      };
      private clear() {
        this.generation++;
        if (this.active) options.publish(null);
        this.active = null;
      }
      private eligible() {
        const selection = this.view.state.selection;
        return (
          !this.destroyed &&
          !this.dragging &&
          !options.isComposing() &&
          !this.view.compositionStarted &&
          selection.ranges.length === 1 &&
          !selection.main.empty
        );
      }
      private measure() {
        const generation = this.generation;
        this.view.requestMeasure({
          key: this,
          read: () => {
            if (generation !== this.generation || !this.eligible()) return null;
            const state = this.view.state;
            const { from, to, head } = state.selection.main;
            const text = state.doc.sliceString(from, to);
            if (!text.trim()) return null;
            const rect = this.view.coordsAtPos(head, head === to ? -1 : 1);
            if (!rect) return null;
            const viewport = this.view.scrollDOM.getBoundingClientRect();
            if (
              rect.bottom <= Math.max(0, viewport.top) ||
              rect.top >= Math.min(this.win.innerHeight, viewport.bottom) ||
              rect.right < Math.max(0, viewport.left) ||
              rect.left > Math.min(this.win.innerWidth, viewport.right)
            )
              return null;
            return { state, from, to, text, rect };
          },
          write: (selected) => {
            if (generation !== this.generation || this.destroyed) return;
            if (!selected || !this.eligible()) return this.clear();
            if (this.view.state !== selected.state) return this.measure();
            const { from, to, text, rect } = selected;
            const next: EditorTextSelection = {
              rev: options.getRevision(),
              from,
              to,
              text,
              rect: {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
              },
            };
            if (
              this.active &&
              this.active.rev === next.rev &&
              this.active.from === from &&
              this.active.to === to &&
              this.active.rect.left === next.rect.left &&
              this.active.rect.top === next.rect.top &&
              this.active.rect.right === next.rect.right &&
              this.active.rect.bottom === next.rect.bottom
            )
              return;
            this.active = next;
            options.publish(next);
          },
        });
      }
      update(update: ViewUpdate) {
        if (update.docChanged || !this.eligible()) this.clear();
        else if (update.selectionSet) {
          this.clear();
          if (
            update.transactions.some(
              (transaction) =>
                transaction.isUserEvent("select.pointer") ||
                transaction.isUserEvent("select.keyboard") ||
                transaction.annotation(Transaction.userEvent) === "select",
            )
          )
            this.measure();
        } else if (
          this.active &&
          (update.geometryChanged || update.viewportChanged)
        )
          this.measure();
      }
      destroy() {
        this.destroyed = true;
        this.clear();
        this.view.dom.removeEventListener("mousedown", this.mouseDown, true);
        this.win.removeEventListener("mouseup", this.mouseUp, true);
        this.view.dom.removeEventListener("dblclick", this.doubleClick, true);
        this.view.dom.removeEventListener("keydown", this.keyDown, true);
        this.view.dom.removeEventListener("keyup", this.keyUp, true);
        this.view.dom.removeEventListener(
          "compositionstart",
          this.compositionStart,
          true,
        );
        this.view.scrollDOM.removeEventListener("scroll", this.remeasure);
        this.win.removeEventListener("resize", this.remeasure);
        this.win.removeEventListener("blur", this.cancelDrag);
      }
    },
  );
}
