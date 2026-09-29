import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { TopIsland } from "../packages/whiteboard/src/chrome/TopIsland.tsx";
import {
  PropertiesPanel,
  placePropertiesPanel,
} from "../packages/whiteboard/src/chrome/PropertiesPanel.tsx";
import { StyleBar } from "../packages/whiteboard/src/chrome/StyleBar.tsx";
import { createAcademicNode } from "../packages/whiteboard/src/model/academic.ts";
import { createBasicNode } from "../packages/whiteboard/src/model/basic.ts";
import type { CanvasNodeStyle } from "../packages/whiteboard/src/model/core.ts";
import { createBuiltinNoteTemplates } from "../packages/whiteboard/src/model/note-template.ts";
import type { WhiteboardLabels } from "../packages/whiteboard/src/model/protocol.ts";

const labels = new Proxy({} as WhiteboardLabels, {
  get: (_target, property) => String(property),
});

function installDom(t: TestContext) {
  const window = new Window({ url: "https://example.test" });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window,
    self: window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    PointerEvent: window.PointerEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    window.close();
  });
  return window;
}

function toolbarProps(
  onSelectNoteTemplate: (templateId: string) => void = () => {},
  onSelectTool: (tool: string) => void = () => {},
) {
  return {
    labels,
    activeTool: "select" as const,
    onSelectTool,
    noteTemplates: createBuiltinNoteTemplates({
      note: "Note",
      question: "Question",
      claim: "Claim",
      evidence: "Evidence",
      summary: "Summary",
    }),
    activeNoteTemplateId: "bamboo.note",
    onSelectNoteTemplate,
    saveState: "saved" as const,
    selectedNodeCount: 0,
    selectedEdgeCount: 0,
    onUndo: () => {},
    onRedo: () => {},
    onAddFile: () => {},
    onSave: () => {},
    onFitView: () => {},
    onAutoLayout: () => {},
    onAlign: () => {},
    onDistribute: () => {},
    onOpenShortcuts: () => {},
  };
}

function menuItem(window: Window, name: string) {
  return Array.from(
    window.document.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]',
    ),
  ).find((button) => button.textContent?.includes(name));
}

test("template menu selects a Note template and restores trigger focus", async (t) => {
  const window = installDom(t);
  const selected: string[] = [];
  const tools: string[] = [];
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        TopIsland,
        toolbarProps(
          (templateId) => selected.push(templateId),
          (tool) => tools.push(tool),
        ),
      ),
    ),
  );

  const trigger = window.document.querySelector<HTMLButtonElement>(
    ".zmd-board-template-trigger",
  );
  await act(async () => trigger?.click());
  assert.equal(trigger?.getAttribute("aria-expanded"), "true");
  assert.equal(menuItem(window, "Note")?.getAttribute("aria-checked"), "true");

  await act(async () => menuItem(window, "Question")?.click());
  assert.deepEqual(selected, ["bamboo.question"]);
  assert.deepEqual(tools, ["note"]);
  assert.equal(window.document.querySelector(".zmd-board-template-menu"), null);
  assert.equal(window.document.activeElement, trigger);
  await act(async () => root.unmount());
});

test("template menu closes on Escape, outside press, and More opening", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(TopIsland, toolbarProps())));
  const trigger = window.document.querySelector<HTMLButtonElement>(
    ".zmd-board-template-trigger",
  );
  const more = window.document.querySelector<HTMLButtonElement>(
    'button[title="more"]',
  );

  await act(async () => trigger?.click());
  await act(async () =>
    window.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(window.document.querySelector(".zmd-board-template-menu"), null);
  assert.equal(window.document.activeElement, trigger);

  await act(async () => trigger?.click());
  await act(async () =>
    window.document.body.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true }),
    ),
  );
  assert.equal(window.document.querySelector(".zmd-board-template-menu"), null);

  await act(async () => trigger?.click());
  await act(async () => more?.click());
  assert.equal(window.document.querySelector(".zmd-board-template-menu"), null);
  assert.ok(window.document.querySelector(".zmd-board-more-menu"));

  await act(async () => trigger?.click());
  assert.equal(window.document.querySelector(".zmd-board-more-menu"), null);
  assert.ok(window.document.querySelector(".zmd-board-template-menu"));
  await act(async () => root.unmount());
});

test("drawing menu keeps shape tools reachable and restores trigger focus", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const selected: string[] = [];
  await act(async () =>
    root.render(
      createElement(TopIsland, {
        ...toolbarProps(undefined, (tool) => selected.push(tool)),
      }),
    ),
  );

  const trigger = window.document.querySelector<HTMLButtonElement>(
    ".zmd-board-draw-tools > button",
  )!;
  await act(async () => trigger.click());
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const editor = window.document.createElement("textarea");
  window.document.body.append(editor);
  editor.focus();
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => editor.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false);
    assert.equal(window.document.activeElement, editor);
  }
  trigger.focus();
  await act(async () =>
    trigger.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const rect = Array.from(
    window.document.querySelectorAll<HTMLButtonElement>(
      '.zmd-board-draw-menu [role="menuitemradio"]',
    ),
  ).find((button) => button.textContent?.includes("addRect"));
  assert.ok(rect);
  assert.equal(window.document.activeElement, rect);
  await act(async () =>
    rect.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "End", bubbles: true }),
    ),
  );
  assert.match(window.document.activeElement?.textContent ?? "", /eraser/);
  await act(async () =>
    window.document.activeElement!.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    ),
  );
  assert.equal(window.document.activeElement, rect);
  await act(async () => rect.click());
  assert.deepEqual(selected, ["rect"]);
  assert.equal(window.document.querySelector(".zmd-board-draw-menu"), null);
  assert.equal(window.document.activeElement, trigger);
  await act(async () => root.unmount());
});

test("More keeps document actions in one menu", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const actions: string[] = [];
  await act(async () =>
    root.render(
      createElement(TopIsland, {
        ...toolbarProps(),
        selectedNodeCount: 3,
        selectedEdgeCount: 1,
        onExportPng: () => actions.push("png"),
        onExportSvg: () => actions.push("svg"),
        onExportMarkdown: () => actions.push("markdown"),
        onSave: () => actions.push("save"),
      }),
    ),
  );
  await act(async () =>
    window.document
      .querySelector<HTMLButtonElement>(".zmd-board-more > button")
      ?.click(),
  );
  const menu = window.document.querySelector(".zmd-board-more-menu")!;
  assert.doesNotMatch(menu.textContent ?? "", /edgeColor|edgeDash|edgeArrow/);
  await act(async () =>
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home" })),
  );
  assert.match(window.document.activeElement?.textContent ?? "", /alignLeft/);
  await act(async () =>
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End" })),
  );
  assert.match(
    window.document.activeElement?.textContent ?? "",
    /shortcutsTitle/,
  );
  for (const label of [
    "save",
    "exportPng",
    "exportSvg",
    "exportMarkdown",
    "fitView",
    "autoLayout",
    "alignLeft",
    "alignRight",
    "alignTop",
    "alignBottom",
    "alignHorizontal",
    "alignVertical",
    "distributeHorizontal",
    "distributeVertical",
  ]) {
    assert.ok(
      Array.from(menu.querySelectorAll("button")).some((button) =>
        button.textContent?.includes(label),
      ),
      `missing ${label}`,
    );
  }
  await act(async () =>
    Array.from(menu.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("exportSvg"))
      ?.click(),
  );
  assert.deepEqual(actions, ["svg"]);
  await act(async () => root.unmount());
});

test("expanded properties avoid the card on each available side", () => {
  const viewport = { x: 0, y: 0, width: 1000, height: 700 };
  const panel = { width: 420, height: 360 };
  for (const [side, anchor] of [
    ["right", { x: 100, y: 160, width: 200, height: 150 }],
    ["left", { x: 780, y: 160, width: 180, height: 150 }],
    ["bottom", { x: 200, y: 200, width: 600, height: 100 }],
    ["top", { x: 200, y: 520, width: 600, height: 100 }],
    ["bottom", { x: 200, y: 180, width: 600, height: 300 }],
  ] as const) {
    const result = placePropertiesPanel(anchor, panel, viewport, true);
    const height = Math.min(panel.height, result.maxHeight);
    assert.equal(result.side, side);
    assert.ok(result.left >= 8 && result.left + result.width <= 992);
    assert.ok(result.top >= 8 && result.top + height <= 692);
    assert.ok(
      result.left >= anchor.x + anchor.width + 12 ||
        result.left + result.width <= anchor.x - 12 ||
        result.top >= anchor.y + anchor.height + 12 ||
        result.top + height <= anchor.y - 12,
      `${side} placement must leave the selected card clear`,
    );
  }
  const narrow = placePropertiesPanel(
    { x: 90, y: 100, width: 300, height: 500 },
    panel,
    { ...viewport, width: 700 },
    true,
  );
  assert.equal(narrow.side, "right");
  assert.equal(narrow.width, 290);
  for (const anchor of [
    { x: -300, y: 100, width: 200, height: 500 },
    { x: 1100, y: 100, width: 200, height: 500 },
    { x: 200, y: -400, width: 600, height: 100 },
  ]) {
    const result = placePropertiesPanel(anchor, panel, viewport, true);
    assert.ok(result.left >= 8 && result.left + result.width <= 992);
    assert.ok(
      result.top >= 8 &&
        result.top + Math.min(panel.height, result.maxHeight) <= 692,
    );
  }
  const compact = placePropertiesPanel(
    { x: 200, y: 20, width: 200, height: 100 },
    { width: 420, height: 40 },
    viewport,
    false,
  );
  assert.equal(compact.side, "bottom");
  assert.equal(
    compact.top,
    132,
    "below means below the card, not its top edge",
  );
  const shortSide = placePropertiesPanel(
    { x: 80, y: 200, width: 240, height: 240 },
    panel,
    { x: 0, y: 0, width: 700, height: 500 },
    true,
    { x: 8, y: 148, width: 684, height: 40 },
  );
  assert.equal(shortSide.side, "right");
  assert.equal(shortSide.top, 200);
  assert.equal(shortSide.maxHeight, 292);
  const crowded = placePropertiesPanel(viewport, panel, viewport, true);
  assert.ok(crowded.left >= 8 && crowded.left + crowded.width <= 992);
  assert.ok(
    crowded.top >= 8 &&
      crowded.top + Math.min(panel.height, crowded.maxHeight) <= 692,
  );
  for (const [side, anchor, toolbar] of [
    [
      "top",
      { x: 200, y: 520, width: 600, height: 100 },
      { x: 150, y: 468, width: 700, height: 40 },
    ],
    [
      "bottom",
      { x: 200, y: 20, width: 600, height: 100 },
      { x: 150, y: 132, width: 700, height: 40 },
    ],
    [
      "right",
      { x: 100, y: 20, width: 200, height: 100 },
      { x: 8, y: 132, width: 700, height: 40 },
    ],
    [
      "top",
      { x: 200, y: 400, width: 600, height: 250 },
      { x: 150, y: 348, width: 700, height: 40 },
    ],
  ] as const) {
    const result = placePropertiesPanel(anchor, panel, viewport, true, toolbar);
    const height = Math.min(panel.height, result.maxHeight);
    assert.equal(result.side, side);
    for (const obstacle of [anchor, toolbar]) {
      assert.ok(
        result.left >= obstacle.x + obstacle.width + 12 ||
          result.left + result.width <= obstacle.x - 12 ||
          result.top >= obstacle.y + obstacle.height + 12 ||
          result.top + height <= obstacle.y - 12,
        "details must avoid both the card and its persistent toolbar",
      );
    }
  }
});

test("properties show full details immediately and reset per node", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const first = createAcademicNode("note", { x: 0, y: 0 }, "first-note", {
    content: "First note",
  });
  const second = createAcademicNode("note", { x: 0, y: 0 }, "second-note", {
    content: "Second note",
  });
  const node = (model: typeof first) => ({
    id: model.id,
    type: model.kind,
    position: model.position,
    data: { model },
  });
  const panelProps = (model: typeof first) => ({
    labels,
    node: node(model),
    position: { x: 180, y: 120 },
    onOpen: () => {},
    onRefreshSource: () => {},
    onViewAnnotations: () => {},
    onCopy: () => {},
    onDelete: () => {},
  });
  await act(async () =>
    root.render(createElement(PropertiesPanel, panelProps(first))),
  );
  assert.equal(container.querySelector("details"), null);
  assert.ok(container.querySelector(".zmd-board-properties.is-expanded"));
  assert.ok(container.querySelector(".zmd-board-properties-details-body"));
  assert.equal(
    Array.from(container.querySelectorAll("button")).some((button) =>
      /Edit|Style/.test(button.textContent ?? ""),
    ),
    false,
  );
  assert.match(
    container.querySelector("aside")?.getAttribute("style") ?? "",
    /--zmd-properties-left:/,
  );
  await act(async () =>
    root.render(createElement(PropertiesPanel, panelProps(second))),
  );
  assert.match(container.textContent ?? "", /Second note/);
  await act(async () =>
    root.render(
      createElement(PropertiesPanel, { ...panelProps(second), node: null }),
    ),
  );
  assert.equal(container.querySelector("aside"), null);
  await act(async () =>
    root.render(createElement(PropertiesPanel, panelProps(first))),
  );
  assert.ok(container.querySelector("aside"));
  await act(async () => root.unmount());
});

test("file properties keep metadata visible and expose embedded open", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const model = createBasicNode("attachment", { x: 0, y: 0 }, "file-node");
  model.data = {
    ...model.data,
    title: "paper.png",
    contentType: "image/png",
    size: 2048,
    fileData: "data:image/png;base64,AA==",
    imageWidth: 640,
    imageHeight: 480,
    pageCount: 3,
  };
  let opened = 0;
  await act(async () =>
    root.render(
      createElement(PropertiesPanel, {
        labels,
        node: {
          id: model.id,
          type: model.kind,
          position: model.position,
          data: { model },
        },
        onOpen: () => {
          opened += 1;
        },
        onRefreshSource: () => {},
        onViewAnnotations: () => {},
        onCopy: () => {},
        onDelete: () => {},
      }),
    ),
  );
  assert.match(container.textContent ?? "", /paper\.png/);
  assert.match(container.textContent ?? "", /image\/png/);
  assert.match(container.textContent ?? "", /2 KB/);
  assert.match(container.textContent ?? "", /640 × 480/);
  assert.match(container.textContent ?? "", /3/);
  const open = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("fileOpen"),
  );
  assert.ok(open);
  await act(async () => open?.click());
  assert.equal(opened, 1);
  await act(async () => root.unmount());
});

test("surface color popovers keep changes separate and preserve transparent fill", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const model = createAcademicNode("note", { x: 0, y: 0 }, "color-note");
  model.style = { fillStyle: "none" };
  const patches: Partial<CanvasNodeStyle>[] = [];
  let edited = 0;
  let toggled = 0;
  const detailsButtonRef = { current: null as HTMLButtonElement | null };
  await act(async () =>
    root.render(
      createElement(StyleBar, {
        node: {
          id: model.id,
          type: model.kind,
          position: model.position,
          data: { model },
        },
        labels,
        theme: "light",
        left: 0,
        top: 0,
        onEdit: () => {
          edited += 1;
        },
        onToggleDetails: () => {
          toggled += 1;
        },
        detailsButtonRef,
        onChange: (patch) => patches.push(patch),
      }),
    ),
  );
  const stroke = container.querySelector<HTMLButtonElement>(
    '[data-color-target="stroke"]',
  )!;
  const fill = container.querySelector<HTMLButtonElement>(
    '[data-color-target="fill"]',
  )!;
  const edit = container.querySelector<HTMLButtonElement>(
    ".zmd-board-selection-edit",
  )!;
  const details = container.querySelector<HTMLButtonElement>(
    ".zmd-board-selection-details",
  )!;
  assert.equal(edit.textContent, "");
  assert.equal(edit.getAttribute("aria-label"), labels.editNoteBody);
  assert.ok(
    !!details.compareDocumentPosition(edit) &&
      (details.compareDocumentPosition(edit) &
        Node.DOCUMENT_POSITION_PRECEDING) !==
        0,
  );
  await act(async () => edit.click());
  assert.equal(edited, 1);
  const swatch = (label: string) =>
    container.querySelector<HTMLButtonElement>(
      label === "transparent"
        ? ".zmd-board-color-actions button:first-child"
        : `[aria-label="${label}"]`,
    )!;
  assert.equal(container.querySelector('[role="dialog"]'), null);
  await act(async () => stroke.click());
  assert.equal(stroke.getAttribute("aria-expanded"), "true");
  await act(async () => details.click());
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(toggled, 1);
  await act(async () => stroke.click());
  assert.deepEqual(
    patches,
    [],
    "opening a picker must not persist theme defaults",
  );
  await act(async () => swatch("#a34557").click());
  assert.deepEqual(patches.pop(), { stroke: "#a34557" });

  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((el) => el.getAttribute("aria-label") === "resetColor")
      ?.click(),
  );
  assert.deepEqual(patches.pop(), { stroke: undefined });
  await act(async () => fill.click());
  assert.equal(container.querySelectorAll('[role="dialog"]').length, 1);
  assert.equal(stroke.getAttribute("aria-expanded"), "false");
  assert.equal(swatch("transparent").getAttribute("aria-pressed"), "true");
  await act(async () => swatch("#e3edf7").click());
  assert.deepEqual(patches.pop(), { fill: "#e3edf7", fillStyle: "solid" });
  await act(async () => swatch("transparent").click());
  assert.deepEqual(patches.pop(), { fill: "transparent", fillStyle: "none" });
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((el) => el.getAttribute("aria-label") === "resetColor")
      ?.click(),
  );
  assert.deepEqual(patches.pop(), { fill: undefined, fillStyle: undefined });

  await act(async () =>
    swatch("transparent").dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(window.document.activeElement, fill);
  await act(async () => stroke.click());
  await act(async () =>
    window.document.body.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true }),
    ),
  );
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(container.querySelector('input[type="number"]'), null);
  const geometry = container.querySelector<HTMLButtonElement>(
    '[aria-label="geometry"]',
  )!;
  await act(async () => geometry.click());
  const widthInput = container.querySelector<HTMLInputElement>(
    '[aria-label="nodeWidth"]',
  )!;
  await act(async () => {
    widthInput.focus();
    widthInput.value = "240";
  });
  await act(async () =>
    window.document.body.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true }),
    ),
  );
  assert.deepEqual(
    patches.pop(),
    { width: 240 },
    "outside click commits numeric edits before closing",
  );
  await act(async () => geometry.click());
  const draft = container.querySelector<HTMLInputElement>(
    '[aria-label="positionX"]',
  )!;
  await act(async () => {
    draft.focus();
    draft.value = "-100";
  });
  await act(async () =>
    draft.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(
    patches.length,
    0,
    "Escape discards an uncommitted coordinate draft",
  );
  assert.equal(window.document.activeElement, geometry);
  assert.equal(container.querySelector('[role="dialog"]'), null);
  await act(async () => root.unmount());
});

test("More opens the standalone window action and closes the menu", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  let opened = 0;
  await act(async () =>
    root.render(
      createElement(TopIsland, {
        ...toolbarProps(),
        onSwitchWindow: () => {
          opened += 1;
        },
      }),
    ),
  );
  await act(async () =>
    window.document
      .querySelector<HTMLButtonElement>(".zmd-board-more > button")
      ?.click(),
  );
  const button = [
    ...window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((el) => el.textContent === "switchWindow");
  assert.ok(button);
  await act(async () => button.click());
  assert.equal(opened, 1);
  assert.equal(window.document.querySelector('[role="menu"]'), null);
  await act(async () => root.unmount());
});
