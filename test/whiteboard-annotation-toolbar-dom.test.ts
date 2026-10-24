import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  Window,
  type Element as DOMElement,
  type HTMLButtonElement as DOMButton,
  type HTMLInputElement as DOMInput,
  type HTMLSelectElement as DOMSelect,
} from "happy-dom";
import { act, createElement } from "react";
import { createServer } from "../packages/whiteboard/node_modules/vite/dist/node/index.js";
import type { AnnotationListSource } from "../packages/whiteboard/src/model/academic.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import type { AnnotationCandidate } from "../packages/whiteboard/src/model/protocol.ts";
import type { WhiteboardRuntime } from "../packages/whiteboard/src/whiteboard/app.tsx";

test("selection toolbar opens scoped annotations once and Escape restores focus without an edit", async () => {
  const window = new Window({ url: "https://example.test" });
  window.document.write(
    "<!doctype html><html><head></head><body></body></html>",
  );
  for (const [property, fallback] of [
    ["clientWidth", 1200],
    ["clientHeight", 800],
    ["offsetWidth", 1200],
    ["offsetHeight", 800],
  ] as const) {
    Object.defineProperty(window.HTMLElement.prototype, property, {
      get() {
        const dimension = property.endsWith("Width") ? "width" : "height";
        return parseFloat(this.style[dimension]) || fallback;
      },
    });
  }
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return new window.DOMRect(0, 0, 1200, 800);
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
    ResizeObserver: window.ResizeObserver,
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
  container.style.cssText = "width:1200px;height:800px";
  window.document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  // React types require browser DOM; Happy DOM provides that runtime boundary.
  const root = createRoot(container as unknown as HTMLElement);
  let runtime: WhiteboardRuntime | undefined;
  const requests: Array<{ requestId: string; source: AnnotationListSource }> =
    [];
  const changes: number[] = [];
  const paperSource = {
    library: { type: "user" as const },
    itemKey: "PAPER001",
  };
  const attachmentSource = {
    library: { type: "user" as const },
    attachmentKey: "FILE0001",
  };
  const document: CanvasDocument = {
    version: 2,
    nodes: [
      {
        id: "paper",
        kind: "literature",
        position: { x: 80, y: 120 },
        width: 280,
        height: 180,
        source: paperSource,
        snapshot: { title: "A paper", annotationCount: 2 },
      },
      {
        id: "file",
        kind: "attachment",
        position: { x: 440, y: 120 },
        width: 280,
        height: 180,
        data: {
          title: "Source.pdf",
          source: attachmentSource,
          contentType: "application/pdf",
          availability: "available",
        },
      },
    ],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  try {
    const { WhiteboardApp } = (await server.ssrLoadModule(
      "/src/whiteboard/app.tsx",
    )) as typeof import("../packages/whiteboard/src/whiteboard/app.tsx");
    const noop = () => {};
    await act(async () => {
      root.render(
        createElement(WhiteboardApp, {
          theme: "light",
          initialSnapshot: document,
          onReady: (api) => {
            runtime = api;
          },
          onChange: (revision) => changes.push(revision),
          onListLiteratureAnnotations: (requestId, source) =>
            requests.push({ requestId, source }),
          onSave: noop,
          onPickAcademicSource: noop,
          onOpenItem: noop,
          onDropAcademicSources: noop,
          onRefreshZoteroNote: noop,
          onExportFile: noop,
        }),
      );
    });
    await act(async () => {
      await window.happyDOM.waitUntilComplete();
    });
    assert.ok(runtime, "React Flow has initialized the real canvas runtime");
    const api = runtime;
    const click = async (element: DOMElement) => {
      await act(async () => {
        element.dispatchEvent(
          new window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      });
    };
    const changeSelect = async (label: string, value: string) => {
      const select = container.querySelector<DOMSelect>(
        `select[aria-label="${label}"]`,
      );
      assert.ok(select);
      await act(async () => {
        select.value = value;
        select.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    };
    const chooseType = async (label: string) => {
      const button = Array.from(
        container.querySelectorAll<DOMButton>(
          '[aria-label="Annotation type"] button',
        ),
      ).find((button) => button.getAttribute("aria-label") === label);
      assert.ok(button, `Annotation type filter exposes ${label}`);
      await click(button);
      assert.equal(button.getAttribute("aria-pressed"), "true");
    };
    const rows = () =>
      Array.from(container.querySelectorAll(".zmd-board-annotation-group li"));
    for (const [id, source] of [
      ["paper", paperSource],
      ["file", attachmentSource],
    ] as const) {
      const card = container.querySelector(
        `.react-flow__node[data-id="${id}"]`,
      );
      assert.ok(card);
      const requestsBeforeSelection = requests.length;
      await click(card);
      assert.equal(
        requests.length,
        requestsBeforeSelection,
        "selection alone does not fetch annotations",
      );
      const trigger = container.querySelector<DOMButton>(
        '.zmd-board-style-bar [aria-label="Add annotations"]',
      );
      assert.ok(
        trigger,
        `${id} exposes Add annotations in the selection toolbar`,
      );
      assert.equal(trigger.disabled, false);
      const before = structuredClone(api.getSnapshot());
      const beforeChanges = changes.length;
      const beforeRequests = requests.length;
      await act(async () => {
        trigger.click();
        trigger.click();
      });
      assert.equal(
        requests.length,
        beforeRequests + 1,
        "rapid activation must not duplicate the request",
      );
      const request = requests.at(-1)!;
      assert.deepEqual(request.source, source);
      assert.equal(container.querySelectorAll('[role="dialog"]').length, 1);
      assert.equal(
        window.document.activeElement?.getAttribute("aria-label"),
        "Search annotations",
      );
      const quoteSource = {
        ...attachmentSource,
        ...(id === "paper" ? { itemKey: paperSource.itemKey } : {}),
      };
      const candidates: AnnotationCandidate[] = [
        {
          attachmentTitle: "Source.pdf",
          sortIndex: "1",
          acquisition: {
            kind: "quote",
            source: { ...quoteSource, annotationKey: "MARK0001" },
            snapshot: {
              text: "Highlighted evidence",
              annotationType: "highlight",
              tags: ["method"],
              color: "#ffd400",
            },
          },
        },
        {
          attachmentTitle: "Source.pdf",
          sortIndex: "2",
          acquisition: {
            kind: "quote",
            source: { ...quoteSource, annotationKey: "NOTE0001" },
            snapshot: {
              text: "",
              comment: "A test comment",
              annotationType: "note",
              tags: ["question"],
              color: "#ffd400",
            },
          },
        },
      ];
      await act(async () =>
        api.applyAnnotationCandidates(
          request.requestId,
          source,
          candidates,
          [],
        ),
      );
      assert.equal(rows().length, 2);
      const search = container.querySelector(
        '[aria-label="Search annotations"]',
      );
      const filters = container.querySelector('[aria-label="Annotation type"]');
      assert.ok(search);
      assert.ok(filters);
      assert.ok(
        search.compareDocumentPosition(filters) &
          window.Node.DOCUMENT_POSITION_FOLLOWING,
        "search precedes all type filters",
      );
      assert.deepEqual(
        Array.from(filters.querySelectorAll("button"), (button) =>
          button.getAttribute("data-annotation-type"),
        ),
        ["", "highlight", "underline", "note", "text", "image", "ink"],
      );
      await chooseType("Note");
      assert.equal(rows().length, 1);
      assert.match(rows()[0].textContent ?? "", /A test comment/);
      const checkbox = rows()[0].querySelector<DOMInput>(
        'input[type="checkbox"]',
      );
      assert.ok(checkbox);
      await click(checkbox);
      assert.equal(checkbox.checked, true);
      await chooseType("Highlight");
      assert.equal(rows().length, 1);
      assert.match(rows()[0].textContent ?? "", /Highlighted evidence/);
      const add = container.querySelector<DOMButton>(
        ".zmd-board-annotation-browser footer button",
      );
      assert.ok(add);
      assert.equal(
        add.disabled,
        false,
        "selection survives hiding its row with a filter",
      );
      await chooseType("Ink");
      assert.equal(
        rows().length,
        0,
        "types without candidates remain available and show the empty state",
      );
      assert.match(
        container.querySelector(".zmd-board-annotation-results")?.textContent ??
          "",
        /No matching annotations/,
      );
      assert.equal(
        add.disabled,
        false,
        "an empty type filter does not clear the existing selection",
      );
      await chooseType("All");
      await changeSelect("Annotation tag", "question");
      assert.equal(rows().length, 1);
      assert.equal(
        rows()[0].querySelector<DOMInput>('input[type="checkbox"]')?.checked,
        true,
      );
      await act(async () =>
        window.dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      assert.equal(container.querySelector('[role="dialog"]'), null);
      assert.equal(
        window.document.activeElement,
        trigger,
        "Escape restores the actual selection-toolbar trigger",
      );
      assert.deepEqual(
        api.getSnapshot(),
        before,
        "browsing and selecting candidates does not edit the canvas",
      );
      assert.equal(changes.length, beforeChanges);
      assert.equal(requests.length, beforeRequests + 1);
      await act(async () =>
        api.applyAnnotationCandidates(
          request.requestId,
          source,
          candidates,
          [],
        ),
      );
      assert.equal(
        container.querySelector('[role="dialog"]'),
        null,
        "late replies cannot reopen a closed browser",
      );
      assert.deepEqual(api.getSnapshot(), before);
    }
  } finally {
    await act(async () => root.unmount());
    await server.close();
    window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
