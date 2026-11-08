import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { LinkHoverTarget } from "../modules/markdown/editor-protocol";
import { linkRangeAt, type EditorLinkRange } from "./link-target";
import { eventTargetElement } from "./table-cell-edit";

/** The host owns the card; this plugin only publishes a stable link anchor. */
export function editorLinkHover(
  publish: (target: LinkHoverTarget | null) => void,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private timer: number | null = null;
      private pointer: { x: number; y: number; element: Element } | null = null;
      private active: { element?: Element; range?: EditorLinkRange } | null =
        null;
      private readonly win: Window;

      constructor(private readonly view: EditorView) {
        this.win = view.dom.ownerDocument.defaultView!;
        // Capture also sees events owned by Live table widgets (ignoreEvent).
        view.dom.addEventListener("mousemove", this.move, true);
        view.dom.addEventListener("mouseleave", this.clear);
        view.dom.addEventListener("mousedown", this.clear, true);
        view.dom.addEventListener("keydown", this.clear, true);
        view.scrollDOM.addEventListener("scroll", this.clear);
        this.win.addEventListener("blur", this.clear);
      }

      private move = (event: MouseEvent) => {
        const element = eventTargetElement(event);
        if (
          !element ||
          !this.view.contentDOM.contains(element) ||
          event.buttons ||
          this.view.compositionStarted
        ) {
          this.clear();
          return;
        }
        if (this.active?.element?.contains(element)) return;
        if (this.active?.range) {
          const position = this.position(event.clientX, event.clientY, element);
          if (
            position !== null &&
            position >= this.active.range.from &&
            position < this.active.range.to
          )
            return;
        }
        this.clear();
        this.pointer = { x: event.clientX, y: event.clientY, element };
        this.timer = this.win.setTimeout(() => {
          this.timer = null;
          this.resolve();
        }, 300);
      };

      private position(x: number, y: number, element: Element): number | null {
        const position = this.view.posAtCoords({ x, y });
        if (position !== null) return position;
        const marker = element.closest("[data-zmd-link]");
        return marker ? this.view.posAtDOM(marker) : null;
      }

      private resolve() {
        const pointer = this.pointer;
        if (!pointer || !pointer.element.isConnected) return;
        const table = pointer.element.closest(
          ".zmd-lp-html-table, .zmd-lp-table-cell:not(.zmd-lp-table-cell-editing)",
        );
        const widgetLink = table
          ? pointer.element.closest(
              "a[href], [data-zmd-wikilink], [data-zmd-link]",
            )
          : null;
        let href: string;
        let rect: { left: number; top: number; right: number; bottom: number };
        if (widgetLink && table!.contains(widgetLink)) {
          const sourceFrom = widgetLink.getAttribute("data-zmd-link-from");
          if (sourceFrom !== null) {
            // Cell widgets map all child DOM to one CodeMirror position. The
            // renderer records each label's source position instead of a URL.
            href =
              linkRangeAt(this.view.state, Number(sourceFrom), {
                allowParsing: false,
              })?.href ?? "";
          } else {
            const wiki = widgetLink.getAttribute("data-zmd-wikilink");
            href =
              (wiki ? `[[${wiki}]]` : widgetLink.getAttribute("href")) ||
              widgetLink.getAttribute("data-zmd-link") ||
              "";
          }
          if (!href) return;
          rect = widgetLink.getBoundingClientRect();
          this.active = { element: widgetLink };
        } else {
          const position = this.position(pointer.x, pointer.y, pointer.element);
          if (position === null) return;
          const range = linkRangeAt(this.view.state, position, {
            allowParsing: false,
          });
          if (!range) return;
          const marker = pointer.element.closest("[data-zmd-link]");
          const start = this.view.coordsAtPos(range.from);
          const end = this.view.coordsAtPos(range.to);
          const point = this.view.coordsAtPos(position);
          if (marker) rect = marker.getBoundingClientRect();
          else if (start && end && start.top === end.top)
            rect = { ...start, right: end.right };
          else if (point) rect = point;
          else return;
          href = range.href;
          this.active = { range };
        }
        publish({
          href,
          rect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          },
        });
      }

      private clear = () => {
        if (this.timer !== null) this.win.clearTimeout(this.timer);
        this.timer = null;
        this.pointer = null;
        if (this.active) publish(null);
        this.active = null;
      };

      update(update: ViewUpdate) {
        if (update.docChanged || (this.active && update.geometryChanged))
          this.clear();
        else if (
          this.pointer &&
          !this.active &&
          this.timer === null &&
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          // Retry only after CodeMirror advances its background parse. Layout
          // reads belong in the measurement phase, outside the view update.
          this.view.requestMeasure({ read: () => this.resolve() });
        }
      }

      destroy() {
        this.clear();
        this.view.dom.removeEventListener("mousemove", this.move, true);
        this.view.dom.removeEventListener("mouseleave", this.clear);
        this.view.dom.removeEventListener("mousedown", this.clear, true);
        this.view.dom.removeEventListener("keydown", this.clear, true);
        this.view.scrollDOM.removeEventListener("scroll", this.clear);
        this.win.removeEventListener("blur", this.clear);
      }
    },
  );
}
