import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createBasicNode } from "../packages/whiteboard/src/model/basic.ts";
import {
  exportCanvasPng,
  includeInPng,
  pngExportSize,
} from "../packages/whiteboard/src/whiteboard/png.ts";

const document = {
  version: 2 as const,
  nodes: [
    {
      ...createBasicNode("text", { x: -120, y: -80 }, "left"),
      width: 240,
      height: 80,
    },
    {
      ...createBasicNode("text", { x: 1000, y: 600 }, "right"),
      width: 200,
      height: 100,
    },
  ],
  connections: [],
};

test("PNG includes offscreen and negative-position nodes with padding at the requested scale", () => {
  for (const scale of [1, 2, 4] as const) {
    assert.deepEqual(pngExportSize(document, scale), {
      x: -160,
      y: -120,
      width: 1400,
      height: 860,
      pixelWidth: 1400 * scale,
      pixelHeight: 860 * scale,
    });
    assert.deepEqual(
      pngExportSize(
        { ...document, viewport: { x: 999, y: -400, zoom: 0.1 } },
        scale,
      ),
      pngExportSize(document, scale),
    );
  }
});

test("oversized PNG allocations fail explicitly instead of silently losing resolution", () => {
  const large = {
    ...document,
    nodes: [{ ...document.nodes[0], width: 9000, height: 9000 }],
  };
  assert.throws(() => pngExportSize(large, 4), /lower resolution/);
});

test("PNG removes handles and selection controls while retaining card content and edge labels", () => {
  const window = new Window();
  for (const name of [
    "react-flow__handle",
    "react-flow__resize-control",
    "react-flow__selection",
    "react-flow__edge-interaction",
    "react-flow__edgeupdater",
    "zmd-board-smart-guides",
  ]) {
    const node = window.document.createElement("div");
    node.className = name;
    assert.equal(includeInPng(node as unknown as HTMLElement), false);
  }
  for (const name of [
    "zmd-board-card",
    "react-flow__edge-label",
    "react-flow__edge-path",
  ]) {
    const node = window.document.createElement("div");
    node.className = name;
    assert.equal(includeInPng(node as unknown as HTMLElement), true);
  }
  window.happyDOM.abort();
});

test("PNG fails before capture when the viewport or an image is unavailable", async () => {
  const window = new Window();
  const host = window.document.createElement("div");
  await assert.rejects(
    exportCanvasPng(host as unknown as HTMLElement, document),
    /not ready/,
  );
  host.innerHTML = '<div class="react-flow__viewport"><img /></div>';
  const image = host.querySelector("img")!;
  image.decode = async () => {
    throw new Error("Missing image");
  };
  Object.defineProperty(window.document, "fonts", {
    value: { ready: Promise.resolve() },
  });
  await assert.rejects(
    exportCanvasPng(host as unknown as HTMLElement, document),
    /Missing image/,
  );
  assert.equal(host.hasAttribute("data-exporting"), false);
  await window.happyDOM.abort();
});
