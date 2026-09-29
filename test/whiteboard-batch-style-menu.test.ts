import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { BatchStyleMenu } from "../packages/whiteboard/src/chrome/BatchStyleMenu.tsx";
import type { CanvasNodeStyle } from "../packages/whiteboard/src/model/core.ts";
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
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
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

test("batch palette starts a new history group after custom picker ends", async (t) => {
  const window = installDom(t);
  const changes: Array<{ color: string; recordHistory: boolean }> = [];
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(BatchStyleMenu, {
        left: 0,
        top: 0,
        nodeCount: 1,
        edgeCount: 0,
        stroke: "#111111",
        fill: "#ffffff",
        edgeColor: "#9ca3af",
        labels,
        onNodes: (patch: Partial<CanvasNodeStyle>, recordHistory = true) => {
          if (patch.stroke) {
            changes.push({ color: patch.stroke, recordHistory });
          }
        },
        onEdges: () => {},
      }),
    ),
  );

  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="dialog"]',
  )!;
  await act(async () => trigger.click());
  const picker = container.querySelector<HTMLElement>(
    ".zmd-board-batch-color .zmd-board-color-picker",
  )!;
  const custom = picker.querySelector<HTMLButtonElement>(
    '[aria-label="customColor"]',
  )!;
  await act(async () => custom.click());
  const saturation = picker.querySelector<HTMLElement>(
    ".react-colorful__saturation .react-colorful__interactive",
  )!;
  saturation.getBoundingClientRect = () => new window.DOMRect(0, 0, 100, 100);
  await act(async () =>
    saturation.dispatchEvent(
      new window.MouseEvent("mousedown", {
        bubbles: true,
        buttons: 1,
        clientX: 50,
        clientY: 50,
      }),
    ),
  );
  await act(async () =>
    window.dispatchEvent(
      new window.MouseEvent("mouseup", { bubbles: true, buttons: 0 }),
    ),
  );
  assert.ok(changes.length > 0, "custom picker emits a live color change");

  await act(async () =>
    picker
      .querySelector<HTMLButtonElement>('button[aria-label="#ed5736"]')!
      .click(),
  );
  assert.equal(
    changes.at(-1)?.recordHistory,
    true,
    "the first preset after a completed custom drag records its own history entry",
  );
  await act(async () => root.unmount());
});
