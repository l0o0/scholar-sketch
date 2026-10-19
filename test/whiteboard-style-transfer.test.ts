import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import {
  canvasNodeUiSurfaceDefaults,
  effectiveCanvasNodeTextStyle,
  type CanvasNode,
  type FrameNode,
  type LiteratureNode,
  type NoteNode,
} from "../packages/whiteboard/src/model/academic.ts";
import type { RectNode } from "../packages/whiteboard/src/model/basic.ts";
import {
  applyNodeStyle,
  copyNodeStyle,
  supportsNodeStyleTransfer,
} from "../packages/whiteboard/src/model/style-transfer.ts";
import { CardShell } from "../packages/whiteboard/src/nodes/CardShell.tsx";

function rect(overrides: Partial<RectNode> = {}): RectNode {
  return {
    id: "rect",
    kind: "rect",
    position: { x: 10, y: 20 },
    width: 480,
    height: 240,
    data: { title: "Title" },
    ...overrides,
  };
}

function note(overrides: Partial<NoteNode> = {}): NoteNode {
  return {
    id: "note",
    kind: "note",
    position: { x: 100, y: 200 },
    width: 240,
    height: 160,
    content: "Original content",
    ...overrides,
  };
}

test("style transfer excludes line and arrow nodes", () => {
  const copied = copyNodeStyle(rect({ style: { stroke: "red" } }));
  assert.ok(copied);
  for (const kind of ["line", "arrow"] as const) {
    const node: CanvasNode = { ...rect(), kind };
    assert.equal(supportsNodeStyleTransfer(node), false);
    assert.equal(copyNodeStyle(node), null);
    assert.strictEqual(applyNodeStyle(node, copied), node);
  }
  assert.equal(supportsNodeStyleTransfer(rect()), true);
  assert.equal(supportsNodeStyleTransfer(note()), true);
});

test("same-kind transfer copies appearance and text without content or geometry", () => {
  const source = rect({
    style: {
      shape: "diamond",
      fill: "transparent",
      stroke: "#123456",
      strokeWidth: 0,
      dashed: false,
      strokeOpacity: 0,
      fillStyle: "none",
      strokeStyle: "dotted",
      fontFamily: "serif",
      fontSize: 32,
      fontWeight: "bold",
      fontStyle: "italic",
      textDecoration: "underline",
      textAlign: "right",
      verticalAlign: "bottom",
      textColor: "#abcdef",
      textOpacity: 0.5,
    },
  });
  const target = rect({
    id: "target",
    position: { x: 600, y: 800 },
    width: 120,
    height: 80,
    frameId: "frame",
    data: { title: "Keep this text" },
    style: { radius: 16, fill: "red" },
    extensions: { custom: true },
  });
  const before = structuredClone(target);
  const copied = copyNodeStyle(source);
  assert.ok(copied);
  const result = applyNodeStyle(target, copied);
  assert.deepEqual(result, {
    ...target,
    style: { ...copied.style, radius: 16 },
  });
  assert.equal(result.style?.shape, undefined);
  assert.strictEqual(result.position, target.position);
  assert.strictEqual(result.extensions, target.extensions);
  assert.deepEqual(target, before);
  assert.equal(source.style?.shape, "diamond");
});

test("rectangle and ellipse share text styles while retaining geometry", () => {
  const copied = copyNodeStyle(
    rect({ style: { radius: 16, fontSize: 24, textAlign: "right" } }),
  );
  assert.ok(copied);
  const ellipse: CanvasNode = {
    ...rect(),
    kind: "ellipse",
    style: { radius: 999, fontSize: 12 },
  };
  const result = applyNodeStyle(ellipse, copied);
  assert.equal(result.kind, "ellipse");
  assert.deepEqual(result.style, {
    radius: 999,
    fontSize: 24,
    textAlign: "right",
  });
  const fromEllipse = copyNodeStyle(result);
  assert.ok(fromEllipse);
  const diamond = rect({ style: { shape: "diamond", radius: 0 } });
  assert.deepEqual(applyNodeStyle(diamond, fromEllipse).style, {
    shape: "diamond",
    radius: 0,
    fontSize: 24,
    textAlign: "right",
  });
});

test("cross-kind transfer leaves the target's text hierarchy and Zotero references", () => {
  const copied = copyNodeStyle(
    rect({
      style: {
        fill: "#ffdddd",
        stroke: "#cc4444",
        radius: 0,
        fontSize: 64,
        textAlign: "center",
        textColor: "red",
      },
    }),
  );
  assert.ok(copied);
  const target: LiteratureNode = {
    id: "paper",
    kind: "literature",
    position: { x: 200, y: 300 },
    width: 280,
    height: 200,
    source: { library: { type: "user" }, itemKey: "ABCDEFGH" },
    snapshot: { title: "Original title", creators: "Author", year: "2026" },
    style: {
      fontSize: 13,
      fontWeight: "bold",
      textAlign: "left",
      textColor: "#222222",
    },
  };
  const result = applyNodeStyle(target, copied);
  assert.equal(result.kind, "literature");
  assert.deepEqual(result.style, {
    ...target.style,
    fill: "#ffdddd",
    stroke: "#cc4444",
    radius: 0,
  });
  assert.strictEqual((result as LiteratureNode).source, target.source);
  assert.strictEqual((result as LiteratureNode).snapshot, target.snapshot);
});

test("automatic font size resets a manual size and adapts to target dimensions", () => {
  const source = rect();
  const target = rect({ width: 120, height: 80, style: { fontSize: 48 } });
  const copied = copyNodeStyle(source);
  assert.ok(copied);
  const result = applyNodeStyle(target, copied);
  assert.equal(result.style, undefined);
  assert.equal(
    effectiveCanvasNodeTextStyle(source.kind, source.style, {
      width: source.width,
      height: source.height,
      text: source.data.title,
    }).fontSize,
    48,
  );
  assert.equal(
    effectiveCanvasNodeTextStyle(result.kind, result.style, {
      width: result.width,
      height: result.height,
      text: target.data.title,
    }).fontSize,
    16,
  );
});

test("default note styles restore the target role's theme instead of the source role", () => {
  const source = note({ noteType: "question" });
  const target = note({
    id: "evidence",
    noteType: "evidence",
    badge: "Original badge",
    source: { library: { type: "user" }, noteKey: "NOTEKEY1" },
    references: [
      {
        id: "ref",
        kind: "literature",
        title: "Referenced paper",
        source: { library: { type: "user" }, itemKey: "ITEMKEY1" },
      },
    ],
    style: {
      fill: "red",
      stroke: "blue",
      strokeWidth: 8,
      radius: 40,
      dashed: true,
      strokeStyle: "dashed",
      fontSize: 32,
      fontFamily: "serif",
      textColor: "white",
    },
  });
  const copied = copyNodeStyle(source);
  assert.ok(copied);
  const result = applyNodeStyle(target, copied) as NoteNode;
  assert.equal(result.style, undefined);
  assert.equal(result.noteType, "evidence");
  assert.equal(result.badge, target.badge);
  assert.equal(result.content, target.content);
  assert.strictEqual(result.source, target.source);
  assert.strictEqual(result.references, target.references);
  for (const theme of ["light", "dark"] as const) {
    assert.deepEqual(
      canvasNodeUiSurfaceDefaults(result.kind, theme, result.noteType),
      canvasNodeUiSurfaceDefaults(target.kind, theme, target.noteType),
    );
    assert.notDeepEqual(
      canvasNodeUiSurfaceDefaults(result.kind, theme, result.noteType),
      canvasNodeUiSurfaceDefaults(source.kind, theme, source.noteType),
    );
  }
});

test("a default cross-kind source clears surface overrides without clearing text", () => {
  const copied = copyNodeStyle(rect());
  assert.ok(copied);
  const target = note({
    style: {
      fill: "red",
      stroke: "blue",
      radius: 20,
      fillStyle: "hatch",
      fontSize: 18,
      textColor: "green",
    },
  });
  assert.deepEqual(applyNodeStyle(target, copied).style, {
    fontSize: 18,
    textColor: "green",
  });
});

test("restoring defaults removes own undefined overrides before rendering semantic notes", () => {
  const target = note({
    noteType: "evidence",
    style: {
      fill: undefined,
      fillStyle: undefined,
      stroke: undefined,
      radius: undefined,
      strokeWidth: undefined,
      fontSize: undefined,
    },
  });
  const copied = copyNodeStyle(note());
  assert.ok(copied);
  const result = applyNodeStyle(target, copied) as NoteNode;
  assert.notStrictEqual(result, target);
  assert.equal(result.style, undefined);
  assert.strictEqual(applyNodeStyle(result, copied), result);
  assert.ok(Object.hasOwn(target.style!, "fill"), "the target is not mutated");
  const markup = renderToStaticMarkup(
    createElement(
      ReactFlowProvider,
      null,
      createElement(CardShell, {
        kind: "note",
        kindLabel: "Evidence",
        noteType: result.noteType,
        nodeStyle: result.style,
        children: result.content,
      }),
    ),
  );
  assert.match(markup, /--zmd-board-node-fill:var\(--zmd-note-type-fill\)/);
  assert.match(markup, /--zmd-board-node-stroke:var\(--zmd-note-type-stroke\)/);
  assert.match(markup, /--zmd-board-node-radius:4px/);
  assert.match(markup, /--zmd-board-node-stroke-width:1px/);
});

test("radius is copied or reset only when both source and target support it", () => {
  const square = rect({ style: { radius: 0 } });
  const rounded = rect({ style: { radius: 24 } });
  const diamond = rect({ style: { shape: "diamond", radius: 0 } });
  const ellipse: CanvasNode = { ...rect(), kind: "ellipse" };
  for (const source of [diamond, ellipse]) {
    const copied = copyNodeStyle(source);
    assert.ok(copied);
    assert.strictEqual(applyNodeStyle(rounded, copied), rounded);
  }
  const squareStyle = copyNodeStyle(square);
  assert.ok(squareStyle);
  assert.equal(applyNodeStyle(rounded, squareStyle).style?.radius, 0);
  assert.strictEqual(applyNodeStyle(diamond, squareStyle), diamond);
  assert.strictEqual(applyNodeStyle(ellipse, squareStyle), ellipse);
  const defaults = copyNodeStyle(rect());
  assert.ok(defaults);
  assert.equal(applyNodeStyle(rounded, defaults).style, undefined);
});

test("formatting a frame leaves its title, geometry, and members unchanged", () => {
  const source: FrameNode = {
    id: "source-frame",
    kind: "frame",
    title: "Source",
    position: { x: 0, y: 0 },
    width: 500,
    height: 400,
    style: { fill: "#f0f0f0", fontSize: 18, textColor: "blue" },
  };
  const target: FrameNode = {
    ...source,
    id: "target-frame",
    title: "Keep this title",
    position: { x: 700, y: 0 },
    width: 800,
    height: 600,
    style: { fill: "white" },
  };
  const member = note({ frameId: target.id });
  const copied = copyNodeStyle(source);
  assert.ok(copied);
  const nodes = [target, member].map((node) =>
    node.id === target.id ? applyNodeStyle(node, copied) : node,
  );
  assert.deepEqual(nodes[0], { ...target, style: source.style });
  assert.strictEqual(nodes[1], member);
  assert.equal(member.frameId, target.id);
});

test("copied styles are snapshots isolated from source and destination edits", () => {
  const source = rect({ style: { fill: "red", fontSize: 24, radius: 8 } });
  const copied = copyNodeStyle(source);
  assert.ok(copied);
  assert.ok(source.style);
  source.style.fill = "blue";
  source.style.shape = "diamond";
  const first = applyNodeStyle(rect({ id: "first" }), copied);
  assert.equal(first.style?.fill, "red");
  assert.equal(first.style?.radius, 8);
  assert.equal(first.style?.shape, undefined);
  assert.ok(first.style);
  first.style.fontSize = 48;
  first.style.fill = "green";
  const second = applyNodeStyle(rect({ id: "second" }), copied);
  assert.equal(second.style?.fontSize, 24);
  assert.equal(second.style?.fill, "red");
  assert.notStrictEqual(first.style, second.style);
  assert.notStrictEqual(second.style, copied.style);
});

test("reapplying a style returns the original object to avoid empty history steps", () => {
  const source = rect({ style: { fill: "red", fontSize: 24 } });
  const copied = copyNodeStyle(source);
  assert.ok(copied);
  const target = rect({
    style: { shape: "diamond", fill: "red", fontSize: 24 },
  });
  assert.strictEqual(applyNodeStyle(target, copied), target);
  const defaults = copyNodeStyle(rect());
  assert.ok(defaults);
  for (const node of [rect(), rect({ style: {} })]) {
    assert.strictEqual(applyNodeStyle(node, defaults), node);
  }
});
