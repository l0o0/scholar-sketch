import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createServer } from "../packages/whiteboard/node_modules/vite/dist/node/index.js";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import type { WhiteboardRuntime } from "../packages/whiteboard/src/whiteboard/app.tsx";

function painterDocument(): CanvasDocument {
  return {
    version: 2,
    nodes: [
      {
        id: "source",
        kind: "rect",
        position: { x: 80, y: 120 },
        width: 320,
        height: 160,
        data: { title: "Automatic source" },
        style: {
          fill: "#abcdef",
          stroke: "#123456",
          strokeWidth: 3,
          radius: 16,
          fontWeight: "bold",
          textAlign: "center",
        },
      },
      {
        id: "target-a",
        kind: "rect",
        position: { x: 440, y: 120 },
        width: 200,
        height: 100,
        data: { title: "Keep A" },
        style: { fill: "#ff0000", fontSize: 12, radius: 0 },
      },
      {
        id: "target-b",
        kind: "rect",
        position: { x: 700, y: 120 },
        width: 240,
        height: 120,
        data: { title: "Keep B" },
        style: { fill: "#00ff00", fontSize: 24 },
      },
      {
        id: "note",
        kind: "note",
        position: { x: 80, y: 400 },
        width: 280,
        height: 160,
        content: "[Open paper](https://example.test/paper)",
        style: { fill: "#eeeeee", fontSize: 13, textAlign: "left" },
      },
      {
        id: "paper",
        kind: "literature",
        position: { x: 440, y: 400 },
        width: 280,
        height: 160,
        source: { library: { type: "user" }, itemKey: "ITEM1234" },
        snapshot: { title: "Keep paper and source" },
      },
    ],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test("format painter preserves content and handles canvas interaction modes", async (t) => {
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
    FileReader: window.FileReader,
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
  const root = createRoot(container);
  let runtime: WhiteboardRuntime | undefined;
  const openedLinks: string[] = [];
  const openedSources: unknown[] = [];
  const errors: string[] = [];
  const previousConsoleError = console.error;
  console.error = (...args: unknown[]) =>
    errors.push(args.map(String).join(" "));
  try {
    const { WhiteboardApp } = (await server.ssrLoadModule(
      "/src/whiteboard/app.tsx",
    )) as typeof import("../packages/whiteboard/src/whiteboard/app.tsx");
    const noop = () => {};
    await act(async () => {
      root.render(
        createElement(WhiteboardApp, {
          theme: "light",
          initialSnapshot: painterDocument(),
          onReady: (api: WhiteboardRuntime) => {
            runtime = api;
          },
          onChange: noop,
          onSave: noop,
          onPickAcademicSource: noop,
          onOpenLink: (href) => openedLinks.push(href),
          onOpenItem: (source) => openedSources.push(source),
          onOpenAcademicSource: (_request, _node, source) =>
            openedSources.push(source),
          onDropAcademicSources: noop,
          onRefreshZoteroNote: noop,
          onExportFile: noop,
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.ok(runtime, "React Flow initializes the canvas runtime");
    const api = runtime;
    const node = (id: string) => {
      const element = container.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${id}"]`,
      );
      assert.ok(element, `Node ${id} is rendered`);
      return element;
    };
    const snapshotNode = (id: string) => {
      const value = api
        .getSnapshot()
        .nodes.find((candidate) => candidate.id === id);
      assert.ok(value);
      return value;
    };
    const dispatch = async (
      target: Element,
      type: string,
      options: Record<string, unknown> = {},
    ) => {
      await act(async () => {
        target.dispatchEvent(
          new window.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: 540,
            clientY: 170,
            ...options,
          }),
        );
      });
    };
    const key = async (value: string, type = "keydown", target?: Element) => {
      const event = new window.KeyboardEvent(type, {
        key: value,
        code: value === "Control" ? "ControlLeft" : value,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        (target ?? window).dispatchEvent(event);
      });
      return event;
    };
    const menuButton = (label: string) =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".zmd-board-context-menu button",
        ),
      ).find((button) => button.textContent === label);
    const command = async (label: string) => {
      const button = menuButton(label);
      assert.ok(button, `Context menu contains ${label}`);
      assert.equal(button.disabled, false);
      await dispatch(button, "click");
    };
    const cancelButton = () =>
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Cancel format painter"]',
      );
    const startPainter = async (continuous = false) => {
      await dispatch(node("source"), "click");
      const button = container.querySelector<HTMLButtonElement>(
        '.zmd-board-style-bar [aria-label="Format painter"]',
      );
      assert.ok(button, "selection toolbar exposes format painter");
      await dispatch(button, "click", { detail: 1 });
      if (continuous) {
        await dispatch(button, "click", { detail: 2 });
        await dispatch(button, "dblclick", { detail: 2 });
      }
      assert.ok(cancelButton(), "format painter has a visible exit");
      assert.ok(container.querySelector('[role="status"]'));
    };
    const reset = async () => {
      await act(async () => {
        api.setEditable(true);
        api.loadSnapshot(painterDocument());
      });
      openedLinks.length = 0;
      openedSources.length = 0;
    };

    await t.test(
      "single use preserves automatic size and ignores the source",
      async () => {
        const original = snapshotNode("target-a");
        await startPainter();
        assert.ok(node("source").classList.contains("is-format-source"));
        await dispatch(node("source"), "click");
        assert.ok(
          cancelButton(),
          "clicking the source does not consume the painter",
        );
        await dispatch(node("target-a"), "mouseover");
        assert.ok(node("target-a").classList.contains("is-format-target"));
        await dispatch(node("target-a"), "click");
        const painted = snapshotNode("target-a");
        assert.deepEqual(painted, {
          ...original,
          style: snapshotNode("source").style,
        });
        assert.equal(
          painted.style?.fontSize,
          undefined,
          "automatic font sizing is copied as automatic",
        );
        assert.equal(cancelButton(), null, "single use exits after applying");
        assert.equal(
          container.querySelector(".is-format-source, .is-format-target"),
          null,
        );
        await act(async () => api.undo());
        assert.deepEqual(snapshotNode("target-a"), original);
      },
    );

    await t.test(
      "double click enables repeated painting until Escape",
      async () => {
        await reset();
        await startPainter(true);
        await dispatch(node("target-a"), "click");
        assert.ok(cancelButton(), "continuous mode survives its first target");
        await dispatch(node("target-b"), "click");
        assert.equal(snapshotNode("target-b").style?.fill, "#abcdef");
        assert.ok(cancelButton());
        await key("Escape");
        assert.equal(cancelButton(), null);
        assert.equal(
          container.querySelector(".is-format-source, .is-format-target"),
          null,
        );
      },
    );

    await t.test(
      "keyboard painting does not move or delete the source selection",
      async () => {
        await reset();
        await startPainter(true);
        const before = api.getSnapshot();
        for (const blockedKey of [
          "ArrowRight",
          "ArrowUp",
          "Delete",
          "Backspace",
        ]) {
          const event = await key(blockedKey, "keydown", node("source"));
          assert.equal(event.defaultPrevented, true);
        }
        assert.deepEqual(
          api.getSnapshot(),
          before,
          "painting mode protects the current selection from mutation",
        );
        await key("Enter", "keydown", node("source"));
        assert.ok(
          cancelButton(),
          "keyboard activation of the source keeps painting active",
        );
        await key("Enter", "keydown", node("target-a"));
        assert.equal(snapshotNode("target-a").style?.fill, "#abcdef");
        await key(" ", "keydown", node("target-b"));
        assert.equal(snapshotNode("target-b").style?.fill, "#abcdef");
        assert.ok(cancelButton());
        await key("Escape");
      },
    );

    await t.test(
      "context menu exposes continuous use and cancel button exits",
      async () => {
        await reset();
        await dispatch(node("source"), "contextmenu");
        await command("Continuous format painter");
        await dispatch(node("target-a"), "click");
        assert.ok(cancelButton());
        await dispatch(cancelButton()!, "click");
        assert.equal(cancelButton(), null);
      },
    );

    await t.test(
      "copy and paste styles across a selection create one undo step",
      async () => {
        await reset();
        const before = api.getSnapshot();
        await dispatch(node("source"), "contextmenu");
        await command("Copy style");
        await dispatch(node("target-a"), "click");
        await key("Control");
        await dispatch(node("target-b"), "click");
        await key("Control", "keyup");
        assert.deepEqual(
          Array.from(
            container.querySelectorAll(".react-flow__node.selected"),
            (element) => element.getAttribute("data-id"),
          ).sort(),
          ["target-a", "target-b"],
        );
        await dispatch(node("target-a"), "contextmenu");
        await command("Paste style");
        assert.equal(snapshotNode("target-a").style?.fill, "#abcdef");
        assert.equal(snapshotNode("target-b").style?.fill, "#abcdef");
        await act(async () => api.undo());
        assert.deepEqual(
          api.getSnapshot(),
          before,
          "one undo restores the entire pasted selection",
        );
      },
    );

    await t.test(
      "painting takes precedence over links, editing, and source opening",
      async () => {
        await reset();
        const noteBefore = snapshotNode("note");
        const paperBefore = snapshotNode("paper");
        await startPainter(true);
        const link = node("note").querySelector("a[href]");
        assert.ok(link);
        await dispatch(link, "click");
        assert.deepEqual(openedLinks, []);
        assert.equal(snapshotNode("note").style?.fill, "#abcdef");
        assert.equal(
          snapshotNode("note").style?.fontSize,
          13,
          "cross-kind painting preserves typography",
        );
        assert.equal(snapshotNode("note").style?.textAlign, "left");
        assert.equal(snapshotNode("note").kind, noteBefore.kind);
        await dispatch(node("note"), "dblclick");
        assert.equal(
          container.querySelector(".zmd-board-editor textarea"),
          null,
        );
        await dispatch(node("paper"), "dblclick", {
          clientX: 540,
          clientY: 460,
        });
        assert.deepEqual(openedSources, []);
        const { style: _beforeStyle, ...paperContent } = paperBefore;
        const { style: _afterStyle, ...paintedPaperContent } =
          snapshotNode("paper");
        assert.deepEqual(
          paintedPaperContent,
          paperContent,
          "painting preserves the academic source",
        );
        assert.ok(cancelButton());
      },
    );

    await t.test(
      "a target double click does not open the source after single use exits",
      async () => {
        await reset();
        await startPainter();
        await dispatch(node("paper"), "click", {
          detail: 1,
          clientX: 540,
          clientY: 460,
        });
        assert.equal(cancelButton(), null);
        await dispatch(node("paper"), "click", {
          detail: 2,
          clientX: 540,
          clientY: 460,
        });
        await dispatch(node("paper"), "dblclick", {
          detail: 2,
          clientX: 540,
          clientY: 460,
        });
        assert.deepEqual(
          openedSources,
          [],
          "the same gesture must only paint the target",
        );
        assert.equal(
          container.querySelector(".zmd-board-editor textarea"),
          null,
        );
      },
    );

    await t.test(
      "read-only transition cancels painting and prevents style changes",
      async () => {
        await reset();
        await startPainter();
        const before = api.getSnapshot();
        await act(async () => api.setEditable(false));
        assert.equal(cancelButton(), null);
        await dispatch(node("target-a"), "click");
        await dispatch(node("target-a"), "contextmenu");
        assert.ok(
          !menuButton("Paste style") || menuButton("Paste style")!.disabled,
        );
        assert.deepEqual(api.getSnapshot(), before);
      },
    );

    await t.test(
      "loading a document clears the active painter and copied style",
      async () => {
        await reset();
        await dispatch(node("source"), "contextmenu");
        await command("Copy style");
        await startPainter(true);
        await act(async () => api.loadSnapshot(painterDocument()));
        assert.equal(cancelButton(), null);
        assert.equal(
          container.querySelector(".is-format-source, .is-format-target"),
          null,
        );
        await dispatch(node("target-a"), "contextmenu");
        assert.ok(
          !menuButton("Paste style") || menuButton("Paste style")!.disabled,
        );
        assert.deepEqual(api.getSnapshot(), painterDocument());
      },
    );

    assert.deepEqual(errors, [], "format painter renders without React errors");
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
