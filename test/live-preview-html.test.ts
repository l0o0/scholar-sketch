import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { GFM } from "@lezer/markdown";

async function editor(t: TestContext, source: string) {
  const win = new Window({ url: "https://editor.test/?channel=inline-html" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
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
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const { livePreviewPlugin } =
    await import("../src/editor/live-preview/plugin.ts");
  const live = new Compartment();
  const readOnly = new Compartment();
  const errors: unknown[] = [];
  const state = EditorState.create({
    doc: source,
    selection: { anchor: source.length },
    extensions: [
      markdown({ extensions: GFM }),
      history(),
      live.of(livePreviewPlugin()),
      readOnly.of(EditorState.readOnly.of(false)),
      EditorView.exceptionSink.of((error) => errors.push(error)),
    ],
  });
  assert.ok(ensureSyntaxTree(state, source.length, 5000));
  const parent = win.document.createElement("div");
  win.document.body.append(parent);
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: state.update({}).state,
  });
  t.after(async () => {
    view.destroy();
    await win.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    assert.deepEqual(errors, [], "no editor/plugin exceptions");
  });
  return { view, win, live, readOnly, livePreviewPlugin };
}

test("Live renders common inline HTML tags and keeps the Markdown source", async (t) => {
  const tags = [
    "sup",
    "sub",
    "u",
    "mark",
    "kbd",
    "b",
    "strong",
    "i",
    "em",
    "s",
    "del",
    "small",
    "code",
  ];
  const source =
    tags.map((tag) => `<${tag}>${tag}</${tag}>`).join(" ") + "\n\nEnd";
  const { view } = await editor(t, source);
  for (const tag of tags) {
    assert.equal(
      view.contentDOM.querySelector(`${tag}.zmd-lp-html-${tag}`)?.textContent,
      tag,
    );
  }
  assert.doesNotMatch(view.contentDOM.textContent || "", /<\/?(?:sup|sub)>/);
  assert.equal(view.state.doc.toString(), source);
});

test("HTML source reappears for editing and survives undo and Source/Live switching", async (t) => {
  const source = "Reference<sup>9</sup> H<sub>2</sub>O\n\nEnd";
  const { view, live, livePreviewPlugin } = await editor(t, source);
  const at = source.indexOf("9");
  view.dispatch({ selection: { anchor: at } });
  assert.match(view.contentDOM.textContent || "", /<sup>9<\/sup>/);
  view.dispatch({ changes: { from: at, to: at + 1, insert: "10" } });
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.equal(view.contentDOM.querySelector("sup")?.textContent, "10");
  assert.ok(undo(view));
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.equal(view.contentDOM.querySelector("sup")?.textContent, "9");
  view.dispatch({ effects: live.reconfigure([]) });
  assert.match(view.contentDOM.textContent || "", /<sup>9<\/sup>/);
  view.dispatch({ effects: live.reconfigure(livePreviewPlugin()) });
  assert.equal(view.contentDOM.querySelector("sup")?.textContent, "9");
  assert.equal(view.state.doc.toString(), source);
});

test("Live keeps HTML in code, escaped text, math and unsupported markup literal", async (t) => {
  const source = [
    "---\nexample: <sup>frontmatter</sup>\n---",
    "`<sup>inline</sup>`",
    "```html\n<sup>fence</sup>\n```",
    "    <sup>indented</sup>",
    "\\<sup>escaped\\</sup>",
    "<!-- <sup>comment</sup> -->",
    '<sup onclick="alert(1)">attribute</sup>',
    "<span>unsupported</span>",
    "<sup>unclosed",
    "$\\text{<sup>math</sup>}$",
    "End",
  ].join("\n\n");
  const { view } = await editor(t, source);
  assert.equal(view.contentDOM.querySelector(".zmd-lp-html-sup"), null);
  assert.equal(view.contentDOM.querySelector("[onclick]"), null);
  assert.match(view.contentDOM.textContent || "", /<sup>inline<\/sup>/);
  assert.match(view.contentDOM.textContent || "", /<sup>indented<\/sup>/);
});

test("Live composes nested HTML with Markdown links and styles", async (t) => {
  const source =
    "**Value <sup>9</sup>** <mark><u>highlight</u></mark> [<sub>2</sub>](https://example.test)\n\nEnd";
  const { view } = await editor(t, source);
  assert.equal(view.contentDOM.querySelector("sup")?.textContent, "9");
  assert.ok(view.contentDOM.querySelector(".zmd-lp-strong sup"));
  assert.equal(
    view.contentDOM.querySelector("mark u")?.textContent,
    "highlight",
  );
  assert.equal(view.contentDOM.querySelector(".zmd-lp-link")?.textContent, "2");
});

test("tag-like TeX content cannot interfere with surrounding HTML formatting", async (t) => {
  const value = String.raw`<mark>$\text{<sup>}$ x</mark>`;
  const source = `${value}\n\n| Value |\n| --- |\n| ${value} |\n\nEnd`;
  const { view } = await editor(t, source);
  assert.equal(view.contentDOM.querySelectorAll("mark math").length, 2);
  assert.equal(view.contentDOM.querySelectorAll(".zmd-lp-html-sup").length, 0);
  assert.ok(view.contentDOM.querySelector(".zmd-lp-table-cell mark math"));
});

test("table cells compose HTML with existing Markdown and math rendering", async (t) => {
  const source =
    "| Value | Label |\n| --- | --- |\n| **x<sup>2</sup>** and H<sub>2</sub>O | <mark><kbd>Ctrl</kbd></mark> <mark>$y$</mark><br>next |\n\nEnd";
  const { view } = await editor(t, source);
  const cells = view.contentDOM.querySelectorAll(".zmd-lp-table-cell");
  assert.equal(cells.length, 4);
  assert.equal(cells[2].textContent, "x2 and H2O");
  assert.equal(cells[2].querySelector(".zmd-lp-strong sup")?.textContent, "2");
  assert.equal(cells[3].querySelector("mark kbd")?.textContent, "Ctrl");
  assert.ok(cells[3].querySelector("mark math"));
  assert.ok(cells[3].querySelector("br"));
  assert.equal(view.state.doc.toString(), source);
});

test("Live renders br as an inline line break and reveals its source on the active line", async (t) => {
  const source = "first<br>second\n\nEnd";
  const { view } = await editor(t, source);
  assert.ok(view.contentDOM.querySelector(".zmd-lp-html-br br"));
  assert.doesNotMatch(view.contentDOM.textContent || "", /<br>/);
  view.dispatch({ selection: { anchor: 0 } });
  assert.match(view.contentDOM.textContent || "", /first<br>second/);
});

function htmlMatrix() {
  return (
    "<table>" +
    Array.from({ length: 5 }, (_, row) => {
      const cells = Array.from({ length: 5 }, (_, column) => {
        const formula =
          row === column
            ? `$g_${row + 1}$`
            : `$(g_${row + 1}, g_${column + 1})$`;
        return `<td> ${formula} </td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("") +
    "</table>"
  );
}

test("Live renders the reported HTML matrix as five rows of mathematical cells", async (t) => {
  const source = `Before\n\n${htmlMatrix()}\n\nAfter`;
  const { view } = await editor(t, source);
  const table = view.contentDOM.querySelector(".zmd-lp-html-table table");
  assert.ok(table);
  assert.equal(table.querySelectorAll("tr").length, 5);
  assert.equal(table.querySelectorAll("td").length, 25);
  assert.equal(table.querySelectorAll("math").length, 25);
  assert.match(table.querySelector("annotation")?.textContent || "", /g_1/);
  assert.match(view.contentDOM.textContent || "", /Before/);
  assert.match(view.contentDOM.textContent || "", /After/);
  assert.doesNotMatch(view.contentDOM.textContent || "", /<table>/);
  assert.equal(view.state.doc.toString(), source);
});

test("multiline HTML tables own blank lines, formatting and multiline formulas", async (t) => {
  const source = [
    '<table class="imported">',
    "<caption>Matrix $A$</caption>",
    '<thead><tr><th colspan="2">Coefficients</th></tr></thead>',
    "",
    "<tbody><tr><td><mark>**Value**</mark></td><td>",
    "$$",
    "\\frac{1}{2}",
    "$$",
    "</td></tr></tbody>",
    "",
    "</table>",
    "",
    "End",
  ].join("\n");
  const { view } = await editor(t, source);
  const table = view.contentDOM.querySelector(".zmd-lp-html-table table");
  assert.ok(table);
  assert.equal(table.querySelectorAll("math").length, 2);
  assert.equal(table.querySelector("th")?.getAttribute("colspan"), "2");
  assert.equal(table.querySelector("mark strong")?.textContent, "Value");
  assert.equal(table.getAttribute("class"), null);
  assert.equal(view.state.doc.toString(), source);
});

test("clicking an HTML table reveals all source and preserves edits, undo and moved positions", async (t) => {
  const source = "Intro\n\n<table>\n<tr><td>$g_1$</td></tr>\n</table>\n\nEnd";
  const { view, win, live, livePreviewPlugin } = await editor(t, source);
  const wrapper = view.contentDOM.querySelector(".zmd-lp-html-table")!;
  wrapper.dispatchEvent(
    new win.MouseEvent("mousedown", { bubbles: true, button: 0 }),
  );
  assert.equal(
    view.contentDOM.querySelector(".zmd-lp-html-table"),
    wrapper,
    "the overflow container remains available for scrolling",
  );
  const clickCell = () => {
    const cell = view.contentDOM.querySelector(".zmd-lp-html-table td");
    assert.ok(cell);
    cell.dispatchEvent(
      new win.MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  };
  clickCell();
  assert.equal(view.contentDOM.querySelector(".zmd-lp-html-table"), null);
  assert.match(view.contentDOM.textContent || "", /<td>\$g_1\$<\/td>/);
  assert.equal(view.contentDOM.querySelector("math"), null);
  const at = source.indexOf("g_1") + 2;
  view.dispatch({ changes: { from: at, to: at + 1, insert: "2" } });
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.match(
    view.contentDOM.querySelector("annotation")?.textContent || "",
    /g_2/,
  );
  assert.ok(undo(view));
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.match(
    view.contentDOM.querySelector("annotation")?.textContent || "",
    /g_1/,
  );
  view.dispatch({ changes: { from: 0, insert: "Shift " } });
  clickCell();
  assert.equal(view.state.selection.main.head, source.indexOf("$g_1$") + 6);
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.dispatch({ effects: live.reconfigure([]) });
  assert.match(view.contentDOM.textContent || "", /<table>/);
  view.dispatch({ effects: live.reconfigure(livePreviewPlugin()) });
  assert.equal(
    view.contentDOM.querySelectorAll(".zmd-lp-html-table math").length,
    1,
  );
  view.contentDOM
    .querySelector(".zmd-lp-html-table")!
    .dispatchEvent(
      new win.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
  assert.equal(view.contentDOM.querySelector(".zmd-lp-html-table"), null);
  assert.equal(view.state.doc.toString(), `Shift ${source}`);
});

test("HTML table rendering preserves adjacent tables and following prose", async (t) => {
  const first = "<table><tr><td>$a$</td></tr></table>";
  const second = "<table><tr><td>$b$</td></tr></table>";
  const source = `${first}${second}\nFollowing prose\n${first}\n\nEnd`;
  const { view } = await editor(t, source);
  assert.equal(
    view.contentDOM.querySelectorAll(".zmd-lp-html-table table").length,
    3,
  );
  assert.equal(
    view.contentDOM.querySelectorAll(".zmd-lp-html-table math").length,
    3,
  );
  assert.match(view.contentDOM.textContent || "", /Following prose/);
  assert.equal(view.state.doc.toString(), source);
});

test("HTML table block parsing preserves later fenced examples and owns fences inside cells", async (t) => {
  const simple = "<table><tr><td>$x$</td></tr></table>";
  const source = [
    "---",
    "example: |",
    `  ${simple}`,
    "---",
    "",
    simple,
    "```html",
    simple,
    "```",
    "",
    "<table><tr><td>",
    "",
    "```mermaid",
    "flowchart LR",
    " A-->B",
    "```",
    "",
    "</td></tr></table>",
    "",
    "End",
  ].join("\n");
  const { view } = await editor(t, source);
  assert.equal(
    view.contentDOM.querySelectorAll(".zmd-lp-html-table table").length,
    2,
  );
  assert.equal(view.contentDOM.querySelector(".zmd-lp-mermaid"), null);
  view.dispatch({ selection: { anchor: source.indexOf("flowchart") } });
  assert.equal(view.contentDOM.querySelector(".zmd-lp-mermaid"), null);
  assert.match(view.contentDOM.textContent || "", /```mermaid[\s\S]*A-->B/);
  assert.equal(view.state.doc.toString(), source);
});

test("HTML table examples and unfinished tables remain editable source", async (t) => {
  const table = "<table><tr><td>$x$</td></tr></table>";
  const source = [
    `\`${table}\``,
    `\`\`\`html\n${table}\n\`\`\``,
    `    ${table}`,
    `<!-- ${table} -->`,
    `<!--\n${table}\n-->`,
    `\\${table}`,
    "<table><tr><td>unfinished",
    "End",
  ].join("\n\n");
  const { view } = await editor(t, source);
  assert.equal(view.contentDOM.querySelector(".zmd-lp-html-table"), null);
  assert.match(view.contentDOM.textContent || "", /<table><tr><td>unfinished/);
  assert.equal(view.state.doc.toString(), source);
});

test("read-only HTML tables stay rendered when the selection intersects their source", async (t) => {
  const source = "<table><tr><td>$x$</td></tr></table>\n\nEnd";
  const { view, win, readOnly } = await editor(t, source);
  view.dispatch({
    selection: { anchor: source.indexOf("$x$") },
    effects: readOnly.reconfigure(EditorState.readOnly.of(true)),
  });
  const table = view.contentDOM.querySelector(".zmd-lp-html-table");
  assert.ok(table);
  const before = view.state.selection.main.head;
  table.dispatchEvent(
    new win.MouseEvent("mousedown", { bubbles: true, button: 0 }),
  );
  assert.equal(view.state.selection.main.head, before);
  assert.equal(view.contentDOM.querySelector(".zmd-lp-html-table"), table);
  assert.equal(view.state.doc.toString(), source);
});
