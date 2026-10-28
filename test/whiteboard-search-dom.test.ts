import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  CanvasSearch,
  type CanvasSearchLabels,
} from "../packages/whiteboard/src/chrome/CanvasSearch.tsx";
import type { CanvasNode } from "../packages/whiteboard/src/model/academic.ts";
import { createBasicNode } from "../packages/whiteboard/src/model/basic.ts";

const labels: CanvasSearchLabels = {
  search: "Search canvas",
  close: "Close",
  all: "All",
  literature: "Literature",
  quote: "Annotations",
  note: "Notes",
  frame: "Groups",
  other: "Other",
  filter: "Filter type",
  results: "Results",
  empty: "No matching cards",
  prompt: "Enter keywords to find cards",
};
const geometry = { position: { x: 0, y: 0 }, width: 200, height: 140 };
const nodes: CanvasNode[] = [
  {
    ...geometry,
    id: "paper",
    kind: "literature",
    source: { library: { type: "user" }, itemKey: "ITEM1234" },
    snapshot: {
      title: "Research article",
      creators: "Alice Zhang",
      year: "2026",
      tags: ["evidence"],
    },
  },
  {
    ...geometry,
    id: "quote",
    kind: "quote",
    source: {
      library: { type: "user" },
      attachmentKey: "FILE1234",
      annotationKey: "ANNO1234",
    },
    snapshot: { text: "Research evidence", citation: "Zhang 2026" },
  },
  {
    ...geometry,
    id: "note",
    kind: "note",
    badge: "Research plan",
    content: "Compare the two studies",
  },
  { ...geometry, id: "group", kind: "frame", title: "Research methods" },
  {
    ...createBasicNode("attachment", { x: 0, y: 0 }, "file"),
    data: { title: "Research.pdf", preview: "Supplementary methods" },
  },
  {
    ...createBasicNode("text", { x: 0, y: 0 }, "text"),
    data: { title: "Research conclusions" },
  },
];

async function mount(t: TestContext, initialQuery = "research") {
  const window = new Window({ url: "https://example.test" });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const focused: string[] = [];
  let closed = false;
  const render = async (query: string) => {
    await act(async () => {
      root.render(
        createElement(CanvasSearch, {
          nodes,
          labels,
          query,
          onQueryChange: () => undefined,
          onFocusNode: (id) => focused.push(id),
          onClose: () => {
            closed = true;
          },
        }),
      );
    });
  };
  t.after(async () => {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    window.close();
  });
  await render(initialQuery);
  return {
    window,
    focused,
    render,
    closed: () => closed,
    options: () => Array.from(container.querySelectorAll('[role="option"]')),
    filter: async (label: string) => {
      const button = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
      ).find((button) => button.textContent === label);
      assert.ok(button, `Missing filter ${label}`);
      await act(async () => button.click());
    },
  };
}

test("search shows readable results, filters card kinds, and keeps attachments in All", async (t) => {
  const ui = await mount(t);
  assert.equal(ui.options().length, 6);
  assert.match(
    ui.options()[0].textContent,
    /Research article.*Alice Zhang.*2026/,
  );
  assert.match(
    ui.options()[2].textContent,
    /Research plan.*Compare the two studies/,
  );
  assert.ok(ui.options().every((option) => option.querySelector("svg")));
  for (const [filter, expected] of [
    ["Literature", "Research article"],
    ["Annotations", "Zhang 2026"],
    ["Notes", "Research plan"],
    ["Groups", "Research methods"],
  ]) {
    await ui.filter(filter);
    assert.equal(ui.options().length, 1);
    assert.ok(ui.options()[0].textContent.includes(expected));
  }
  await ui.filter("All");
  assert.equal(ui.options().length, 6);
  await act(async () => ui.options()[4].click());
  assert.deepEqual(ui.focused, ["file"]);
  assert.equal(ui.options()[4].getAttribute("aria-selected"), "true");

  await ui.render("Alice evidence");
  assert.equal(ui.options().length, 1);
  assert.match(ui.options()[0].textContent, /Research article/);
  assert.equal(ui.options()[0].getAttribute("aria-selected"), "false");
});

test("search keyboard navigation stays in the panel, cycles results, and preserves IME input", async (t) => {
  const ui = await mount(t);
  const input = ui.window.document.querySelector<HTMLInputElement>("input")!;
  const escapedKeys: string[] = [];
  const onCanvasKey = (event: { key: string }) => escapedKeys.push(event.key);
  ui.window.addEventListener("keydown", onCanvasKey);
  t.after(() => ui.window.removeEventListener("keydown", onCanvasKey));
  const press = async (key: string, options = {}) => {
    await act(async () => {
      input.dispatchEvent(
        new ui.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
    });
  };
  await press("ArrowDown");
  await press("ArrowDown");
  await press("Enter");
  await press("Enter", { shiftKey: true });
  await press("ArrowUp");
  assert.deepEqual(ui.focused, ["paper", "quote", "note", "quote", "paper"]);
  assert.equal(ui.window.document.activeElement, input);
  assert.equal(input.getAttribute("aria-activedescendant"), ui.options()[0].id);
  await press("Enter", { isComposing: true });
  assert.equal(ui.focused.length, 5);
  await press("Delete");
  await press("Escape");
  assert.equal(ui.closed(), true);
  assert.deepEqual(escapedKeys, []);
});

test("empty queries and empty filtered results have distinct feedback", async (t) => {
  const ui = await mount(t, "");
  assert.equal(ui.options().length, 0);
  assert.match(
    ui.window.document.body.textContent,
    /Enter keywords to find cards/,
  );
  await ui.render("Alice");
  await ui.filter("Notes");
  assert.equal(ui.options().length, 0);
  assert.match(ui.window.document.body.textContent, /No matching cards/);
  await ui.filter("All");
  assert.equal(ui.options().length, 1);
});
