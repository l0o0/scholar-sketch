import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { GFM } from "@lezer/markdown";
let plugin: typeof import("../src/editor/live-preview/plugin");
import { editorMermaidLabels } from "../src/editor/live-preview/mermaid";

function diagrams(state: EditorState) {
  const results: Array<{
    from: number;
    to: number;
    source: string;
    theme: string;
  }> = [];
  state
    .field(plugin.livePreviewMermaidDecorations)
    .between(0, state.doc.length, (from, to, decoration) => {
      results.push({
        from,
        to,
        source: decoration.spec.widget.source,
        theme: decoration.spec.widget.theme,
      });
    });
  return results;
}

function stateFor(source: string, anchor = source.length) {
  const state = EditorState.create({
    doc: source,
    selection: { anchor },
    extensions: [markdown({ extensions: GFM }), plugin.livePreviewPlugin()],
  });
  ensureSyntaxTree(state, source.length, 5000);
  return state.update({}).state;
}

async function editor(t: TestContext, source: string, anchor = source.length) {
  const win = new Window({ url: "https://editor.test/?channel=mermaid" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  // Hold intersection notifications so DOM tests exercise real widgets without
  // loading the Zotero-only renderer URL. Runtime/SVG rendering is tested apart.
  const observers: Array<{ disconnected: boolean }> = [];
  class DeferredObserver {
    disconnected = false;
    constructor() {
      observers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  Object.defineProperty(win, "IntersectionObserver", {
    configurable: true,
    value: DeferredObserver,
  });
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    MutationObserver: win.MutationObserver,
    ResizeObserver: win.ResizeObserver,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  plugin = await import("../src/editor/live-preview/plugin");
  const parent = win.document.createElement("div");
  win.document.body.append(parent);
  const errors: unknown[] = [];
  const live = new Compartment();
  const theme = new Compartment();
  const readOnly = new Compartment();
  let dispatches = 0;
  const state = EditorState.create({
    doc: source,
    selection: { anchor },
    extensions: [
      markdown({ extensions: GFM }),
      history(),
      live.of(plugin.livePreviewPlugin()),
      theme.of(EditorView.theme({}, { dark: false })),
      readOnly.of(EditorState.readOnly.of(false)),
      editorMermaidLabels.of({
        loading: "绘制图表中",
        error: "图表语法有误",
        edit: "编辑图表源码",
      }),
      EditorView.exceptionSink.of((error) => errors.push(error)),
    ],
  });
  ensureSyntaxTree(state, source.length, 5000);
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: state.update({}).state,
    dispatchTransactions(transactions, current) {
      dispatches++;
      current.update(transactions);
    },
  });
  t.after(async () => {
    view.destroy();
    assert.ok(observers.every((observer) => observer.disconnected));
    await win.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    assert.deepEqual(errors, [], "no asynchronous editor/plugin exceptions");
  });
  return {
    view,
    win,
    live,
    theme,
    readOnly,
    observers,
    dispatches: () => dispatches,
  };
}

test("only completed Mermaid fences render; ordinary code and literal examples remain source", async (t) => {
  const source = [
    "---",
    "example: |",
    "  ```mermaid",
    "  flowchart LR",
    "  ```",
    "---",
    "",
    "```mermaid",
    "flowchart LR",
    " A --> B",
    "```",
    "",
    "~~~mermaid",
    "sequenceDiagram",
    " A->>B: hello",
    "~~~~",
    "",
    "````markdown",
    "```mermaid",
    "flowchart LR",
    "```",
    "````",
    "",
    "```javascript",
    "const mermaid = 'text';",
    "```",
    "",
    "    ```mermaid",
    "    flowchart LR",
    "    ```",
    "",
    "<pre>",
    "```mermaid",
    "flowchart LR",
    "```",
    "</pre>",
    "",
    "```mermaid",
    "incomplete",
  ].join("\n");
  const { view } = await editor(t, source);
  const found = diagrams(view.state);
  assert.equal(found.length, 2);
  assert.equal(found[0].source, "flowchart LR\n A --> B");
  assert.equal(found[1].source, "sequenceDiagram\n A->>B: hello");
});

test("diagram click exposes the full source; edits, leaving, undo and moved offsets stay current", async (t) => {
  const source = "Intro\n\n```mermaid\nflowchart LR\n A --> B\n```\n\nEnd";
  const { view, win } = await editor(t, source);
  let widget = view.dom.querySelector<HTMLElement>(".zmd-lp-mermaid")!;
  assert.ok(widget);
  assert.equal(widget.title, "编辑图表源码");
  assert.match(widget.textContent || "", /绘制图表中/);
  widget.dispatchEvent(
    new win.MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
    }) as unknown as Event,
  );
  assert.equal(view.state.selection.main.head, source.indexOf("flowchart"));
  assert.equal(view.dom.querySelector(".zmd-lp-mermaid"), null);
  assert.match(view.contentDOM.textContent || "", /```mermaid/);
  assert.match(view.contentDOM.textContent || "", /A --> B/);
  const at = source.indexOf(" B") + 1;
  view.dispatch({ changes: { from: at, to: at + 1, insert: "C" } });
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.match(diagrams(view.state)[0].source, /A --> C/);
  assert.ok(undo(view));
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.match(diagrams(view.state)[0].source, /A --> B/);
  view.dispatch({ changes: { from: 0, insert: "Shift " } });
  widget = view.dom.querySelector<HTMLElement>(".zmd-lp-mermaid")!;
  assert.equal(
    Number(widget.dataset.zmdMermaidFrom),
    source.indexOf("```") + 6,
  );
  widget.dispatchEvent(
    new win.KeyboardEvent("keydown", {
      bubbles: true,
      key: "Enter",
    }) as unknown as Event,
  );
  assert.equal(view.state.selection.main.head, source.indexOf("flowchart") + 6);
});

test("selection in any diagram line exposes source; source mode and removal dispose widgets", async (t) => {
  const source = "```mermaid\nflowchart LR\n A --> B\n```\n\nEnd";
  const { view, live, observers } = await editor(t, source);
  assert.equal(view.dom.querySelectorAll(".zmd-lp-mermaid").length, 1);
  for (const anchor of [
    0,
    source.indexOf("A -->"),
    source.indexOf("\n```") + 2,
  ]) {
    view.dispatch({ selection: { anchor } });
    assert.equal(view.dom.querySelector(".zmd-lp-mermaid"), null);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  }
  view.dispatch({ effects: live.reconfigure([]) });
  assert.equal(view.dom.querySelector(".zmd-lp-mermaid"), null);
  assert.match(view.contentDOM.textContent || "", /```mermaid/);
  assert.ok(observers.every((observer) => observer.disconnected));
  view.dispatch({ effects: live.reconfigure(plugin.livePreviewPlugin()) });
  assert.equal(view.dom.querySelectorAll(".zmd-lp-mermaid").length, 1);
  view.dispatch({
    changes: { from: 0, to: source.indexOf("\n\nEnd"), insert: "" },
  });
  assert.equal(view.dom.querySelector(".zmd-lp-mermaid"), null);
  assert.ok(observers.every((observer) => observer.disconnected));
});

test("theme reconfiguration replaces the render and readonly documents retain diagrams", async (t) => {
  const source = "```mermaid\nflowchart LR\n A --> B\n```\n\nEnd";
  const { view, theme, readOnly, observers } = await editor(t, source);
  assert.equal(diagrams(view.state)[0].theme, "light");
  view.dispatch({
    effects: theme.reconfigure(EditorView.theme({}, { dark: true })),
  });
  assert.equal(diagrams(view.state)[0].theme, "dark");
  assert.equal(observers[0].disconnected, true);
  view.dispatch({
    effects: readOnly.reconfigure(EditorState.readOnly.of(true)),
    selection: { anchor: source.indexOf("flowchart") },
  });
  assert.equal(diagrams(view.state).length, 1);
  assert.equal(
    view.dom.querySelector(".zmd-lp-mermaid")?.getAttribute("role"),
    null,
  );
});

test("Mermaid source composition preserves pending native text and never replaces its DOM", async (t) => {
  const source = "```mermaid\nflowchart LR\n A[文] --> B\n```\n\nEnd";
  const { view, win, dispatches } = await editor(
    t,
    source,
    source.indexOf("文") + 1,
  );
  view.focus();
  const before = dispatches();
  const node = win.document.getSelection()?.focusNode;
  assert.ok(node && node.nodeType === 3);
  view.contentDOM.dispatchEvent(
    new win.CompositionEvent("compositionstart", {
      bubbles: true,
    }) as unknown as Event,
  );
  assert.equal(view.plugin(plugin.livePreviewViewPlugin)?.composing, true);
  assert.equal(dispatches(), before);
  assert.equal(view.dom.querySelector(".zmd-lp-mermaid"), null);
  node.nodeValue = node.nodeValue!.replace("文", "中文");
  view.contentDOM.dispatchEvent(
    new win.CompositionEvent("compositionend", {
      bubbles: true,
    }) as unknown as Event,
  );
  await Promise.resolve();
  assert.equal(view.state.doc.toString(), source.replace("文", "中文"));
  assert.equal(win.document.getSelection()?.focusNode, node);
  assert.equal(node.isConnected, true);
  assert.equal(view.dom.querySelector(".zmd-lp-mermaid"), null);
});

test("ordinary diagram typing preserves the structural cache; fence changes match a fresh parse", async (t) => {
  const source = "# Heading\n\n```mermaid\nflowchart LR\n A --> B\n```\n\nEnd";
  await editor(t, source, source.indexOf("A -->"));
  let state = stateFor(source, source.indexOf("A -->"));
  const heading = state.field(plugin.livePreviewBlockDecorations).iter().value;
  const at = source.indexOf(" B") + 1;
  state = state.update({
    changes: { from: at, to: at + 1, insert: "中文" },
  }).state;
  assert.equal(
    state.field(plugin.livePreviewBlockDecorations).iter().value,
    heading,
    "diagram text input does not rescan/rebuild the entire structural document",
  );
  state = state.update({ selection: { anchor: state.doc.length } }).state;
  assert.match(diagrams(state)[0].source, /中文/);
  const close = state.doc.toString().lastIndexOf("\n```") + 1;
  state = state.update({
    changes: { from: close, to: close + 1, insert: "" },
  }).state;
  assert.equal(
    diagrams(state).length,
    0,
    "an incomplete fence remains editable source",
  );
  state = state.update({ changes: { from: close, insert: "`\n" } }).state;
  assert.deepEqual(diagrams(state), diagrams(stateFor(state.doc.toString())));
});
