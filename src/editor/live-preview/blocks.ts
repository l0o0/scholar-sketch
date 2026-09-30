import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";

/** Use the Markdown parser so code, escaped markers and Setext headings stay literal. */
export function liveBlockMarkers(state: EditorState) {
  const rules = new Map<number, { from: number; to: number }>();
  const tasks = new Map<number, { from: number; to: number }>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "HorizontalRule" || node.name === "TaskMarker") {
        const target = node.name === "HorizontalRule" ? rules : tasks;
        target.set(state.doc.lineAt(node.from).number, {
          from: node.from,
          to: node.to,
        });
      }
    },
  });
  return { rules, tasks };
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly checked: boolean,
    readonly label: string,
    readonly disabled: boolean,
  ) {
    super();
  }
  eq(other: TaskCheckboxWidget) {
    return (
      this.from === other.from &&
      this.checked === other.checked &&
      this.label === other.label &&
      this.disabled === other.disabled
    );
  }
  toDOM(view: EditorView) {
    const input = view.dom.ownerDocument.createElement("input");
    input.type = "checkbox";
    input.className = "zmd-lp-task-checkbox";
    input.checked = this.checked;
    input.disabled = this.disabled;
    input.setAttribute("aria-label", this.label || "Task");
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("change", () => {
      if (view.state.readOnly || !view.state.facet(EditorView.editable)) return;
      if (
        !/^\[[ xX]\]$/.test(
          view.state.doc.sliceString(this.from, this.from + 3),
        )
      )
        return;
      view.dispatch({
        changes: {
          from: this.from + 1,
          to: this.from + 2,
          insert: input.checked ? "x" : " ",
        },
        userEvent: "input.task",
      });
    });
    return input;
  }
  ignoreEvent() {
    return true;
  }
}

export class HorizontalRuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const line = view.dom.ownerDocument.createElement("span");
    line.className = "zmd-lp-horizontal-rule";
    line.setAttribute("role", "separator");
    return line;
  }
  ignoreEvent() {
    return false;
  }
}
