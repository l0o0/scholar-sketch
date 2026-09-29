import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "../packages/whiteboard/node_modules/vite/dist/node/index.js";
import type {
  WhiteboardApp,
  WhiteboardRuntime,
} from "../packages/whiteboard/src/whiteboard/app.tsx";
import {
  canvasDocumentToFile,
  canvasFileToDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";

test("canvas editing keeps toolbars exclusive and preserves creation, history, and grouping", async () => {
  const window = new Window({ url: "https://example.test" });
  window.document.write(
    "<!doctype html><html><head></head><body></body></html>",
  );
  const resizeObservers = new Set<{
    callback: (entries: { target: Element }[]) => void;
    targets: Set<Element>;
  }>();
  class TestResizeObserver {
    targets = new Set<Element>();
    constructor(readonly callback: (entries: { target: Element }[]) => void) {
      resizeObservers.add(this);
    }
    observe(target: Element) {
      this.targets.add(target);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      resizeObservers.delete(this);
    }
  }
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
    get: () => 1024,
  });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    get: () => 768,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
    get() {
      return parseFloat(this.style.width) || 1024;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    get() {
      return parseFloat(this.style.height) || 768;
    },
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains("zmd-board-style-bar")) {
      return new window.DOMRect(0, 0, 400, 40);
    }
    return new window.DOMRect(0, 0, 1024, 768);
  };
  const style = window.document.createElement("style");
  style.textContent =
    readFileSync("node_modules/@xyflow/react/dist/style.css", "utf8") +
    readFileSync("packages/whiteboard/src/whiteboard/board.css", "utf8");
  window.document.head.append(style);
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window,
    self: window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    FileReader: window.FileReader,
    ResizeObserver: TestResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const server = await createServer({
    root: "packages/whiteboard",
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
  });
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  let runtime: WhiteboardRuntime;
  const errors: string[] = [];
  const previousConsoleError = console.error;
  console.error = (...args: unknown[]) =>
    errors.push(args.map(String).join(" "));
  try {
    const app = (await server.ssrLoadModule("/src/whiteboard/app.tsx")) as {
      WhiteboardApp: typeof WhiteboardApp;
    };
    const noop = () => {};
    const openedItems: unknown[] = [];
    const openedSources: unknown[] = [];
    await act(async () =>
      root.render(
        createElement(app.WhiteboardApp, {
          theme: "light",
          initialSnapshot: {
            version: 2,
            nodes: [
              {
                id: "note",
                kind: "note",
                content: "Existing",
                position: { x: 200, y: 200 },
                width: 240,
                height: 140,
              },
            ],
            connections: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          onReady: (api) => {
            runtime = api;
          },
          onChange: noop,
          onSave: noop,
          onPickAcademicSource: noop,
          onOpenItem: (payload) => openedItems.push(payload),
          onOpenAcademicSource: (_requestId, _nodeId, source) =>
            openedSources.push(source),
          onDropAcademicSources: noop,
          onRefreshZoteroNote: noop,
          onExportFile: noop,
        }),
      ),
    );
    // React Flow invokes onInit on the next timer turn after initializing pan/zoom.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const pane = container.querySelector(".react-flow__pane")!;
    // OS file drags expose only the type until drop (protected data store).
    const fileTransfer = { types: ["Files"], files: [], dropEffect: "none" };
    const fileDrag = new window.Event("dragover", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(fileDrag, "dataTransfer", { value: fileTransfer });
    await act(async () => {
      pane.dispatchEvent(fileDrag);
    });
    assert.equal(fileDrag.defaultPrevented, true);
    assert.equal(fileTransfer.dropEffect, "copy");
    const dispatch = async (
      target: Element,
      type: string,
      options: Record<string, unknown> = {},
    ) => {
      await act(async () =>
        target.dispatchEvent(
          new window.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: 300,
            clientY: 300,
            ...options,
          }),
        ),
      );
    };
    const expectToolbar = (
      mode: "text" | "shape" | "selection",
      detailsOpen = false,
    ) => {
      assert.equal(
        container.querySelectorAll(".zmd-board-properties").length,
        detailsOpen ? 1 : 0,
        "the details panel must yield to the active editor",
      );
      assert.equal(
        container.querySelectorAll(".zmd-board-style-bar.is-text").length,
        mode === "text" ? 1 : 0,
      );
      assert.equal(
        container.querySelectorAll(".zmd-board-style-bar.is-selection").length,
        mode === "text" ? 0 : 1,
      );
    };
    const exitTextEditing = async () => {
      await act(async () =>
        container.querySelector("textarea")!.dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expectToolbar("selection");
    };
    await dispatch(
      container.querySelector('.react-flow__node[data-id="note"]')!,
      "click",
    );
    expectToolbar("selection");
    const selectionBar = container.querySelector<HTMLElement>(
      ".zmd-board-style-bar.is-selection",
    )!;
    const editButton = selectionBar.querySelector<HTMLButtonElement>(
      ".zmd-board-selection-edit",
    )!;
    assert.equal(editButton.getAttribute("aria-label"), "Edit body");
    await dispatch(
      container.querySelector('.react-flow__node[data-id="note"]')!,
      "dblclick",
    );
    assert.equal(
      runtime!.getSnapshot().nodes.length,
      1,
      "editing a card must not also create a card",
    );
    assert.ok(container.querySelector("textarea"));
    expectToolbar("text");
    await exitTextEditing();
    await dispatch(
      container.querySelector<HTMLButtonElement>(".zmd-board-selection-edit")!,
      "click",
    );
    expectToolbar("text");
    await exitTextEditing();
    const detailsButton = container.querySelector<HTMLButtonElement>(
      ".zmd-board-selection-details",
    )!;
    await dispatch(detailsButton, "click");
    assert.ok(container.querySelector(".zmd-board-properties.is-expanded"));
    assert.equal(
      window.document.activeElement,
      container.querySelector(".zmd-board-properties-close"),
      "opening details must move keyboard focus into the panel",
    );
    expectToolbar("selection", true);
    await dispatch(
      container.querySelector<HTMLButtonElement>(
        ".zmd-board-properties-close",
      )!,
      "click",
    );
    assert.equal(container.querySelector(".zmd-board-properties"), null);
    assert.equal(window.document.activeElement, detailsButton);
    await dispatch(
      container.querySelector('.react-flow__node[data-id="note"]')!,
      "dblclick",
    );
    expectToolbar("text");
    await exitTextEditing();
    await dispatch(
      container.querySelector('.react-flow__node[data-id="note"]')!,
      "dblclick",
      { clientX: 201, clientY: 270 },
    );
    expectToolbar("shape");

    // React Flow opens the pane menu on right-button release when right-drag
    // panning is enabled, rather than on the contextmenu event itself.
    for (const type of ["mousedown", "mouseup"]) {
      await dispatch(container.querySelector(".react-flow__pane")!, type, {
        button: 2,
        clientX: 600,
        clientY: 400,
      });
    }
    const createNote = Array.from(
      container.querySelectorAll(".zmd-board-context-menu button"),
    ).find((button) => button.textContent?.trim() === "Note");
    assert.ok(
      createNote,
      container.querySelector(".zmd-board-context-menu")?.textContent ??
        "missing context menu",
    );
    await dispatch(createNote, "click");
    expectToolbar("text");
    await exitTextEditing();
    await act(async () => runtime!.undo());
    assert.equal(runtime!.getSnapshot().nodes.length, 1);
    await act(async () => runtime!.loadSnapshot(runtime!.getSnapshot()));
    const edge = window.document.createElement("div");
    edge.className = "react-flow__edge";
    pane.append(edge);
    await dispatch(edge, "dblclick");
    assert.equal(
      runtime!.getSnapshot().nodes.length,
      1,
      "edge double click must not reach blank creation",
    );
    edge.remove();
    await dispatch(pane, "dblclick", { clientX: 600, clientY: 400 });
    assert.equal(runtime!.getSnapshot().nodes.length, 2);
    assert.ok(
      container.querySelector("textarea"),
      "blank creation starts editing",
    );
    await act(async () => runtime!.undo());
    assert.equal(runtime!.getSnapshot().nodes.length, 1);
    assert.equal(container.querySelector("textarea"), null);
    await dispatch(
      container.querySelector('.react-flow__node[data-id="note"]')!,
      "click",
    );
    await dispatch(
      container.querySelector('.react-flow__node[data-id="note"]')!,
      "contextmenu",
    );
    const group = Array.from(
      container.querySelectorAll(".zmd-board-context-menu button"),
    ).find((button) => button.textContent?.includes("Group selection"));
    assert.ok(group, "selected card offers grouping");
    await dispatch(group, "click");
    const grouped = runtime!.getSnapshot();
    const frame = grouped.nodes.find((node) => node.kind === "frame");
    assert.ok(frame);
    const member = grouped.nodes.find((node) => node.id === "note")!;
    assert.equal("frameId" in member && member.frameId, frame.id);
    assert.deepEqual(member.position, { x: 200, y: 200 });
    await act(async () => runtime!.undo());
    assert.equal(runtime!.getSnapshot().nodes.length, 1);
    assert.ok(!("frameId" in runtime!.getSnapshot().nodes[0]!));
    await act(async () => runtime!.redo());
    assert.equal(runtime!.getSnapshot().nodes.length, 2);
    await dispatch(
      container.querySelector(`.react-flow__node[data-id="${frame.id}"]`)!,
      "contextmenu",
    );
    const ungroup = Array.from(
      container.querySelectorAll(".zmd-board-context-menu button"),
    ).find((button) => button.textContent === "Ungroup");
    assert.ok(ungroup, "frame offers explicit ungroup action");
    await dispatch(ungroup, "click");
    const ungrouped = runtime!.getSnapshot();
    assert.equal(ungrouped.nodes.length, 1);
    assert.equal(ungrouped.nodes[0].id, "note");
    assert.deepEqual(ungrouped.nodes[0].position, member.position);
    assert.ok(!("frameId" in ungrouped.nodes[0]));
    assert.deepEqual(ungrouped.connections, grouped.connections);
    await act(async () => runtime!.undo());
    assert.deepEqual(
      runtime!.getSnapshot().nodes,
      grouped.nodes,
      "one undo restores frame and membership",
    );
    const loaded = canvasFileToDocument(
      canvasDocumentToFile(runtime!.getSnapshot()),
    ).document;
    await act(async () => runtime!.loadSnapshot(loaded));
    assert.deepEqual(runtime!.getSnapshot().nodes, loaded.nodes);
    await dispatch(
      container.querySelector('.react-flow__node[data-id="note"]')!,
      "click",
    );
    await dispatch(
      container.querySelector('.react-flow__node[data-id="note"]')!,
      "contextmenu",
    );
    const remove = Array.from(
      container.querySelectorAll(".zmd-board-context-menu button"),
    ).find((button) => button.textContent?.includes("Remove from group"));
    assert.ok(remove);
    await dispatch(remove, "click");
    assert.ok(
      !(
        "frameId" in
        runtime!.getSnapshot().nodes.find((node) => node.id === "note")!
      ),
    );
    assert.equal(
      runtime!.getSnapshot().nodes.length,
      2,
      "removing membership retains the frame and card",
    );
    const twoCardDocument = {
      version: 2 as const,
      nodes: [
        {
          id: "style-a",
          kind: "note" as const,
          content: "Style A",
          position: { x: 160, y: 180 },
          width: 220,
          height: 120,
          style: { stroke: "#111111" },
        },
        {
          id: "style-b",
          kind: "note" as const,
          content: "Style B",
          position: { x: 560, y: 180 },
          width: 320,
          height: 160,
          style: { stroke: "#222222" },
        },
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    await act(async () => runtime!.loadSnapshot(twoCardDocument));
    const styleA = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="style-a"]',
    )!;
    const styleB = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="style-b"]',
    )!;
    await dispatch(styleA, "click", { clientX: 200, clientY: 220 });
    await dispatch(styleA, "dblclick", { clientX: 161, clientY: 220 });
    expectToolbar("shape");
    const styleBar = container.querySelector<HTMLElement>(
      ".zmd-board-style-bar.is-selection",
    )!;
    const styleBarLeft = styleBar.style.left;
    await dispatch(
      styleBar.querySelector('[data-color-target="stroke"]')!,
      "click",
    );
    assert.ok(container.querySelector(".zmd-board-popover"));

    await dispatch(styleB, "click", { clientX: 600, clientY: 220 });
    const switchedStyleBar = container.querySelector<HTMLElement>(
      ".zmd-board-style-bar:not(.is-text)",
    )!;
    assert.notEqual(
      switchedStyleBar.style.left,
      styleBarLeft,
      "style toolbar anchor must follow the newly selected card",
    );
    assert.equal(
      container.querySelector(".zmd-board-popover"),
      null,
      "switching cards must reset an open color popover",
    );
    assert.equal(switchedStyleBar.querySelector('input[type="number"]'), null);
    await dispatch(
      switchedStyleBar.querySelector('[aria-label="Size and position"]')!,
      "click",
    );
    assert.deepEqual(
      Array.from(
        switchedStyleBar.querySelectorAll<HTMLInputElement>(
          'input[type="number"]',
        ),
      )
        .slice(0, 2)
        .map((input) => input.value),
      ["320", "160"],
      "geometry flyout shows the newly selected card dimensions",
    );
    const xInput = switchedStyleBar.querySelector<HTMLInputElement>(
      '[aria-label="Horizontal position"]',
    )!;
    await act(async () => {
      xInput.value = "0";
      xInput.dispatchEvent(
        new window.FocusEvent("focusout", { bubbles: true }),
      );
    });
    assert.equal(
      runtime!.getSnapshot().nodes.find((node) => node.id === "style-b")
        ?.position.x,
      0,
    );
    await dispatch(
      switchedStyleBar.querySelector('[aria-label="Line style"]')!,
      "click",
    );
    await dispatch(
      switchedStyleBar.querySelector(
        '[data-style-option][aria-label="Dashed"]',
      )!,
      "click",
    );
    const styledSnapshot = runtime!.getSnapshot();
    assert.equal(
      styledSnapshot.nodes.find((node) => node.id === "style-a")?.style?.stroke,
      "#111111",
    );
    assert.equal(
      styledSnapshot.nodes.find((node) => node.id === "style-b")?.style
        ?.strokeStyle,
      "dashed",
    );

    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Control",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    await dispatch(styleA, "click", {
      clientX: 200,
      clientY: 220,
      ctrlKey: true,
    });
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keyup", {
          key: "Control",
          bubbles: true,
        }),
      ),
    );
    assert.equal(
      container.querySelectorAll(".zmd-board-style-bar.is-selection").length,
      0,
      "multi-selection must leave style mode",
    );
    const nodeBatch = container.querySelector(".zmd-board-batch-style")!;
    await dispatch(
      nodeBatch.querySelector('button[aria-haspopup="dialog"]')!,
      "click",
    );
    const beforeNodeBatch = runtime!.getSnapshot();
    const strokeInput = nodeBatch.querySelector<HTMLInputElement>(
      'input[aria-label="Stroke"]',
    )!;
    assert.equal(
      strokeInput.value,
      "#111111",
      "batch color starts at the first selected card's actual color",
    );
    await act(async () => {
      strokeInput.value = "#059669";
      strokeInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => {
      strokeInput.value = "#dc2626";
      strokeInput.dispatchEvent(new window.Event("input", { bubbles: true }));
      strokeInput.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const batchNodes = runtime!.getSnapshot().nodes;
    for (const id of ["style-a", "style-b"]) {
      assert.equal(
        batchNodes.find((node) => node.id === id)?.style?.stroke,
        "#dc2626",
      );
    }
    for (const node of beforeNodeBatch.nodes.filter(
      (node) => !["style-a", "style-b"].includes(node.id),
    )) {
      assert.deepEqual(
        batchNodes.find((current) => current.id === node.id),
        node,
        "unselected nodes remain unchanged",
      );
    }
    await act(async () => {
      strokeInput.value = "#2563eb";
      strokeInput.dispatchEvent(new window.Event("input", { bubbles: true }));
      strokeInput.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await act(async () => runtime!.undo());
    assert.deepEqual(
      runtime!.getSnapshot().nodes,
      batchNodes,
      "a second native color choice has its own undo entry",
    );
    await act(async () => runtime!.undo());
    assert.deepEqual(runtime!.getSnapshot().nodes, beforeNodeBatch.nodes);
    await dispatch(
      container.querySelector('.react-flow__node[data-id="style-a"]')!,
      "click",
    );
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Control",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    await dispatch(
      container.querySelector('.react-flow__node[data-id="style-b"]')!,
      "click",
      { ctrlKey: true },
    );
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keyup", {
          key: "Control",
          bubbles: true,
        }),
      ),
    );
    const restoredBatch = container.querySelector(".zmd-board-batch-style")!;
    await dispatch(
      restoredBatch.querySelector('button[aria-haspopup="dialog"]')!,
      "click",
    );
    assert.equal(
      restoredBatch.querySelector<HTMLInputElement>(
        'input[aria-label="Stroke"]',
      )!.value,
      "#111111",
      "undo restores the batch color display",
    );
    // In marquee mode React Flow clears selection on pointer-up, not click.
    for (const type of ["pointerdown", "pointerup"]) {
      await act(async () =>
        container.querySelector(".react-flow__pane")!.dispatchEvent(
          new window.PointerEvent(type, {
            bubbles: true,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            clientX: 900,
            clientY: 600,
          }),
        ),
      );
    }
    assert.equal(
      container.querySelectorAll(".react-flow__node.selected").length,
      0,
    );
    assert.equal(
      container.querySelectorAll(".zmd-board-style-bar.is-selection").length,
      0,
      "empty selection must leave style mode",
    );

    await dispatch(styleB, "click", { clientX: 40, clientY: 220 });
    assert.deepEqual(
      Array.from(container.querySelectorAll(".react-flow__node.selected")).map(
        (node) => node.getAttribute("data-id"),
      ),
      ["style-b"],
    );
    expectToolbar("shape");
    await dispatch(styleB, "dblclick", { clientX: 40, clientY: 240 });
    expectToolbar("text");
    await exitTextEditing();
    for (const theme of ["dark", "light", "dark"] as const) {
      await act(async () => runtime!.setTheme(theme));
      assert.ok(
        container.querySelector(`.react-flow.${theme}`),
        "native canvas controls must follow runtime theme changes",
      );
    }
    const textDocument = {
      version: 2 as const,
      nodes: [
        {
          id: "text",
          kind: "text" as const,
          position: { x: 200, y: 200 },
          width: 320,
          height: 180,
          data: { title: "Title\n第二行" },
          style: { fontSize: 24, strokeWidth: 2 },
        },
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 0.5 },
    };
    await act(async () => runtime!.loadSnapshot(textDocument));
    await dispatch(
      container.querySelector('.react-flow__node[data-id="text"]')!,
      "click",
      { clientX: 150, clientY: 140 },
    );
    await dispatch(
      container.querySelector('.react-flow__node[data-id="text"]')!,
      "dblclick",
      { clientX: 150, clientY: 140 },
    );
    expectToolbar("text");
    const editor = container.querySelector<HTMLElement>(".zmd-board-editor")!;
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    assert.ok(editor.closest(".react-flow__viewport"));
    assert.equal(editor.style.left, "200px");
    assert.equal(editor.style.width, "320px");
    assert.equal(editor.style.borderWidth, "2px");
    assert.equal(textarea.style.fontSize, "24px");
    assert.equal(textarea.value, "Title\n第二行");
    assert.equal(
      container.querySelector(".zmd-board-edit-measure")?.textContent,
      "Title\n第二行\u200b",
      "editor sizing must use the full multiline draft",
    );
    assert.equal(
      window.getComputedStyle(
        container.querySelector(
          ".zmd-board-card.is-text .zmd-board-card-title",
        )!,
      ).whiteSpace,
      "pre-wrap",
    );
    await exitTextEditing();
    assert.deepEqual(runtime!.getSnapshot().nodes, textDocument.nodes);
    const edgeDocument = {
      version: 2 as const,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: ["a", "b", "c"].map((id, index) => ({
        id,
        kind: "note" as const,
        position: { x: 100 + index * 300, y: 220 },
        width: 180,
        height: 120,
        content: `Endpoint ${id}`,
      })),
      connections: [
        {
          id: "edge-a",
          kind: "basic" as const,
          source: "a",
          target: "b",
          color: "#111111",
        },
        {
          id: "edge-b",
          kind: "academic" as const,
          relation: "supports" as const,
          source: "b",
          target: "c",
          color: "#222222",
          dashed: true,
          arrow: false,
        },
      ],
    };
    await act(async () => runtime!.loadSnapshot(edgeDocument));
    // Happy DOM has no layout notifications; supply the measured node handles.
    const measureObservedElements = () =>
      act(async () => {
        for (const observer of resizeObservers) {
          observer.callback(
            [...observer.targets].map((target) => ({
              target,
              contentRect: target.getBoundingClientRect(),
            })),
          );
        }
      });
    await measureObservedElements();
    const edgeElement = (id: string) =>
      container.querySelector(`[data-id="${id}"].react-flow__edge`)!;
    await dispatch(edgeElement("edge-a"), "click");
    assert.equal(
      container.querySelectorAll(".zmd-board-style-bar.is-edge").length,
      1,
      "one click exposes connection styles",
    );
    assert.equal(
      container.querySelector(".zmd-board-style-bar.is-selection"),
      null,
    );
    assert.equal(container.querySelector(".zmd-board-connection-editor"), null);
    const chooseEdgeStyle = async (label: string, option: string) => {
      await dispatch(
        container.querySelector(`.is-edge button[aria-label="${label}"]`)!,
        "click",
      );
      await dispatch(
        container.querySelector(
          `.is-edge [data-style-option][aria-label="${option}"]`,
        )!,
        "click",
      );
    };
    await chooseEdgeStyle("Arrows", "Both ends");
    await chooseEdgeStyle("Line style", "Dashed");
    let changedEdge = runtime!
      .getSnapshot()
      .connections.find((edge) => edge.id === "edge-a")!;
    assert.equal(changedEdge.arrow, true);
    assert.equal(changedEdge.startArrow, true);
    assert.equal(changedEdge.dashed, true);
    await dispatch(container.querySelector('button[title="Undo"]')!, "click");
    assert.equal(runtime!.getSnapshot().connections[0].dashed, false);
    assert.equal(runtime!.getSnapshot().connections[0].startArrow, true);
    await dispatch(container.querySelector('button[title="Redo"]')!, "click");
    assert.equal(runtime!.getSnapshot().connections[0].dashed, true);
    await measureObservedElements();
    await dispatch(edgeElement("edge-a"), "click");
    await dispatch(
      container.querySelector('.is-edge [aria-label="Edge color"]')!,
      "click",
    );
    assert.ok(container.querySelector('.is-edge [role="dialog"]'));
    await dispatch(edgeElement("edge-b"), "click");
    assert.equal(
      container.querySelector('.is-edge [role="dialog"]'),
      null,
      "changing the selected edge closes its old picker",
    );
    await dispatch(
      container.querySelector('.is-edge button[aria-label="Arrows"]')!,
      "click",
    );
    assert.equal(
      container
        .querySelector('.is-edge [aria-label="None"]')!
        .getAttribute("aria-pressed"),
      "true",
    );
    await dispatch(
      container.querySelector('.is-edge button[aria-label="Arrows"]')!,
      "click",
    );
    await chooseEdgeStyle("Arrows", "Reverse");
    changedEdge = runtime!
      .getSnapshot()
      .connections.find((edge) => edge.id === "edge-b")!;
    assert.equal(changedEdge.arrow, false);
    assert.equal(changedEdge.startArrow, true);
    assert.equal(
      changedEdge.kind === "academic" && changedEdge.relation,
      "supports",
    );
    assert.equal(
      runtime!.getSnapshot().connections[0].arrow,
      true,
      "editing edge B must preserve edge A",
    );
    await dispatch(
      container.querySelector('.is-edge [aria-label="Connection text"]')!,
      "click",
    );
    assert.ok(container.querySelector(".zmd-board-connection-editor"));
    assert.equal(
      container.querySelector(".zmd-board-style-bar.is-edge"),
      null,
      "label editor and style menu must be exclusive",
    );
    await act(async () =>
      container
        .querySelector(".zmd-board-connection-editor textarea")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
    );
    assert.ok(container.querySelector(".zmd-board-style-bar.is-edge"));
    const persistedEdges = runtime!.getSnapshot();
    await act(async () =>
      runtime!.loadSnapshot(
        canvasFileToDocument(canvasDocumentToFile(persistedEdges)).document,
      ),
    );
    assert.deepEqual(
      runtime!.getSnapshot().connections,
      persistedEdges.connections,
      "line style and both endpoints persist through save/reload",
    );
    await measureObservedElements();
    await dispatch(edgeElement("edge-a"), "click");
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Control",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    await dispatch(edgeElement("edge-b"), "click", { ctrlKey: true });
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keyup", { key: "Control", bubbles: true }),
      ),
    );
    assert.equal(
      container.querySelector(".zmd-board-style-bar.is-edge"),
      null,
      "multi-selection must not show a toolbar for an arbitrary first edge",
    );
    const batch = container.querySelector(".zmd-board-batch-style")!;
    assert.ok(batch, "multi-selection has its own style menu");
    await dispatch(
      batch.querySelector('button[aria-haspopup="dialog"]')!,
      "click",
    );
    const batchButton = (name: string) =>
      Array.from(batch.querySelectorAll("button")).find(
        (button) =>
          button.textContent === name ||
          button.getAttribute("aria-label") === name,
      )!;
    const edgeColorInput = batch.querySelector<HTMLInputElement>(
      'input[aria-label="Edge color"]',
    )!;
    await act(async () => {
      edgeColorInput.value = "#dc2626";
      edgeColorInput.dispatchEvent(
        new window.Event("input", { bubbles: true }),
      );
    });
    assert.ok(
      runtime!
        .getSnapshot()
        .connections.every((edge) => edge.color === "#dc2626"),
      "color selection immediately applies to all selected edges",
    );
    await dispatch(batchButton("Solid"), "click");
    assert.ok(runtime!.getSnapshot().connections.every((edge) => !edge.dashed));
    const beforeBatch = runtime!.getSnapshot().connections;
    await dispatch(batchButton("Both ends"), "click");
    assert.ok(
      runtime!
        .getSnapshot()
        .connections.every((edge) => edge.arrow && edge.startArrow),
      "both selected edges receive the same explicit arrows",
    );
    await act(async () => runtime!.undo());
    assert.deepEqual(
      runtime!.getSnapshot().connections,
      beforeBatch,
      "batch styling undoes in one step",
    );
    await act(async () => runtime!.redo());
    assert.ok(
      runtime!
        .getSnapshot()
        .connections.every((edge) => edge.arrow && edge.startArrow),
    );
    await act(async () => runtime!.loadSnapshot(persistedEdges));
    await dispatch(
      container.querySelector('.react-flow__node[data-id="a"]')!,
      "click",
    );
    assert.ok(container.querySelector(".zmd-board-style-bar.is-selection"));
    assert.equal(container.querySelector(".zmd-board-style-bar.is-edge"), null);
    // Native clipboard transfer into a different (empty) board must keep the
    // whole selection and its internal connections, and undo as one operation.
    await dispatch(
      container.querySelector('.react-flow__node[data-id="a"]')!,
      "click",
    );
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Control",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    await dispatch(
      container.querySelector('.react-flow__node[data-id="b"]')!,
      "click",
      { ctrlKey: true },
    );
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keyup", { key: "Control", bubbles: true }),
      ),
    );
    const clipboard = new Map<string, string>();
    const clipboardEvent = async (type: string) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          setData: (type: string, value: string) => clipboard.set(type, value),
          getData: (type: string) => clipboard.get(type) || "",
        },
      });
      await act(async () => window.dispatchEvent(event));
      return event.defaultPrevented;
    };
    assert.equal(await clipboardEvent("copy"), true);
    const copied = JSON.parse(clipboard.get("text/plain")!);
    assert.equal(copied.document.nodes.length, 2);
    assert.ok(copied.document.connections.length);
    await act(async () =>
      runtime!.loadSnapshot({ version: 2, nodes: [], connections: [] }),
    );
    assert.equal(await clipboardEvent("paste"), true);
    const pasted = runtime!.getSnapshot();
    assert.equal(pasted.nodes.length, 2);
    assert.equal(pasted.connections.length, copied.document.connections.length);
    assert.ok(
      pasted.connections.every(
        (edge) =>
          pasted.nodes.some((n) => n.id === edge.source) &&
          pasted.nodes.some((n) => n.id === edge.target),
      ),
    );
    assert.ok(pasted.nodes.every((n) => !["a", "b"].includes(n.id)));
    await act(async () => runtime!.undo());
    assert.equal(runtime!.getSnapshot().nodes.length, 0);
    await act(async () => runtime!.redo());
    assert.equal(runtime!.getSnapshot().nodes.length, 2);

    const imageData = "data:image/png;base64,aGVsbG8=";
    await act(async () =>
      runtime!.loadSnapshot({
        version: 2,
        nodes: [
          {
            id: "image",
            kind: "attachment",
            position: { x: 200, y: 200 },
            width: 240,
            height: 160,
            data: {
              title: "Image",
              contentType: "image/png",
              fileData: imageData,
            },
          },
        ],
        connections: [],
      }),
    );
    const imageNode = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="image"]',
    )!;
    imageNode.focus();
    await dispatch(imageNode.querySelector("img")!, "click");
    const viewerClose = container.querySelector<HTMLButtonElement>(
      ".zmd-board-image-viewer-close",
    )!;
    assert.ok(viewerClose);
    assert.equal(window.document.activeElement, viewerClose);
    const previewSnapshot = runtime!.getSnapshot();
    for (const key of ["Delete", "ArrowRight", "z"]) {
      await act(async () =>
        window.document.body.dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key,
            ctrlKey: key === "z",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    }
    assert.deepEqual(
      runtime!.getSnapshot(),
      previewSnapshot,
      "preview must isolate canvas shortcuts",
    );
    assert.equal(await clipboardEvent("copy"), false);
    assert.equal(await clipboardEvent("paste"), false);
    assert.deepEqual(runtime!.getSnapshot(), previewSnapshot);
    await act(async () =>
      viewerClose.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(window.document.activeElement, viewerClose);
    await act(async () =>
      viewerClose.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(
      container.querySelector(".zmd-board-image-viewer-backdrop"),
      null,
    );
    assert.equal(window.document.activeElement, imageNode);

    const source = {
      library: { type: "user" as const },
      attachmentKey: "PDFKEY01",
    };
    for (const data of [
      { title: "PDF", image: imageData, source },
      { title: "PDF", image: imageData, attachmentID: 42, pdfPage: 3 },
    ]) {
      await act(async () =>
        runtime!.loadSnapshot({
          version: 2,
          nodes: [
            {
              id: "pdf",
              kind: "pdf",
              position: { x: 200, y: 200 },
              width: 240,
              height: 180,
              data,
            },
          ],
          connections: [],
        }),
      );
      await dispatch(
        container.querySelector('.react-flow__node[data-id="pdf"]')!,
        "contextmenu",
      );
      const open = Array.from(
        container.querySelectorAll(".zmd-board-context-menu button"),
      ).find((button) =>
        ["Open source", "Open item"].includes(button.textContent?.trim() ?? ""),
      )!;
      assert.ok(open);
      await dispatch(open, "click");
      assert.equal(
        container.querySelector(".zmd-board-image-viewer-backdrop"),
        null,
      );
    }
    assert.deepEqual(openedSources, [{ kind: "attachment", source }]);
    assert.deepEqual(openedItems, [{ attachmentID: 42, pdfPage: 3 }]);

    for (const kind of ["text", "rect", "frame", "note"] as const) {
      await act(async () =>
        runtime!.loadSnapshot({
          version: 2,
          nodes: [
            {
              id: "editable",
              kind,
              position: { x: 200, y: 200 },
              width: 240,
              height: 160,
              ...(kind === "note"
                ? { content: "" }
                : kind === "frame"
                  ? { title: "" }
                  : { data: { title: "" } }),
            } as Parameters<
              WhiteboardRuntime["loadSnapshot"]
            >[0]["nodes"][number],
          ],
          connections: [],
        }),
      );
      await dispatch(
        container.querySelector('.react-flow__node[data-id="editable"]')!,
        "click",
      );
      await dispatch(
        container.querySelector(".zmd-board-selection-edit")!,
        "click",
      );
      assert.equal(
        Boolean(container.querySelector(".zmd-board-edit-file")),
        kind === "note",
      );
      const file = new window.File(["image"], "paste.png", {
        type: "image/png",
      });
      const paste = new window.Event("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(paste, "clipboardData", {
        value: {
          items: [{ type: "image/png", getAsFile: () => file }],
        },
      });
      await act(async () => {
        container.querySelector("textarea")!.dispatchEvent(paste);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      assert.equal(paste.defaultPrevented, kind === "note");
      const text =
        container.querySelector<HTMLTextAreaElement>("textarea")!.value;
      if (kind === "note")
        assert.match(text, /^!\[paste\.png\]\(data:image\/png;base64,/);
      else
        assert.equal(
          text,
          "",
          "plain text editors must not receive image data URLs",
        );
    }
    assert.deepEqual(errors, [], "workflow must render without React errors");
  } finally {
    console.error = previousConsoleError;
    await act(async () => root.unmount());
    await server.close();
    window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
