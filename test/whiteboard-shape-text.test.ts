import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveCanvasNodeTextStyle,
  effectiveCanvasNodeUiTextStyle,
} from "../packages/whiteboard/src/model/academic.ts";
import type { CanvasNodeStyle } from "../packages/whiteboard/src/model/core.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import {
  canvasDocumentToFile,
  canvasFileToDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import { wrappedTextLines } from "../packages/whiteboard/src/model/text-layout.ts";
import {
  applyCanvasNodeChanges,
  canvasDocumentToFlow,
  flowToCanvasDocument,
} from "../packages/whiteboard/src/whiteboard/document.ts";
import { buildCanvasSvg } from "../packages/whiteboard/src/whiteboard/export.ts";

test("automatic shape text grows with both dimensions and has a readable upper bound", () => {
  for (const kind of ["rect", "ellipse"] as const) {
    assert.equal(
      effectiveCanvasNodeTextStyle(kind, {}, { width: 120, height: 80 })
        .fontSize,
      16,
    );
    assert.equal(
      effectiveCanvasNodeTextStyle(
        kind,
        {},
        { width: 480, height: 240, text: "研究问题" },
      ).fontSize,
      48,
    );
    assert.equal(
      effectiveCanvasNodeTextStyle(
        kind,
        {},
        { width: 2400, height: 1600, text: "A" },
      ).fontSize,
      64,
    );
    assert.equal(
      effectiveCanvasNodeTextStyle(
        kind,
        {},
        { width: 2400, height: 80, text: "A" },
      ).fontSize,
      16,
    );
  }
});

test("invalid dimensions retain the legacy default and non-shape text is unchanged", () => {
  for (const layout of [
    undefined,
    { width: 0, height: 240 },
    { width: 480, height: -1 },
    { width: Number.NaN, height: 240 },
    { width: 480, height: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(effectiveCanvasNodeTextStyle("rect", {}, layout).fontSize, 16);
  }
  for (const kind of [
    "text",
    "line",
    "arrow",
    "note",
    "frame",
    "literature",
  ] as const) {
    assert.equal(
      effectiveCanvasNodeTextStyle(kind, {}, { width: 1200, height: 800 })
        .fontSize,
      effectiveCanvasNodeTextStyle(kind).fontSize,
    );
  }
});

test("manual font sizes take precedence over dimensions and long text", () => {
  for (const fontSize of [12, 18, 32, 96]) {
    const layout = { width: 40, height: 40, text: "Long content ".repeat(100) };
    assert.equal(
      effectiveCanvasNodeTextStyle("rect", { fontSize }, layout).fontSize,
      fontSize,
    );
    assert.equal(
      effectiveCanvasNodeUiTextStyle("rect", { fontSize }, layout).fontSize,
      fontSize,
    );
  }
  for (const fontSize of [0, -16, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      effectiveCanvasNodeTextStyle(
        "rect",
        { fontSize },
        { width: 480, height: 240 },
      ).fontSize,
      48,
    );
  }
});

test("Chinese, English and explicit lines shrink to fit the available shape text area", () => {
  const texts = [
    "研究问题与结论".repeat(8),
    "The evidence supports this research question. ".repeat(6),
    "First line\r\nSecond line\rThird line\nFourth line",
    "W".repeat(80),
    "研究 📚 evidence ".repeat(12),
  ];
  for (const text of texts) {
    const fontSize = effectiveCanvasNodeTextStyle(
      "rect",
      {},
      { width: 480, height: 240, text },
    ).fontSize;
    assert.ok(
      fontSize >= 14 && fontSize < 48,
      `${text.slice(0, 20)}: ${fontSize}`,
    );
    const lines = wrappedTextLines(text, 456, fontSize);
    assert.ok(
      lines.length * fontSize * 1.25 <= 216,
      `text must fit at ${fontSize}px`,
    );
  }
});

test("diamond labels use their smaller inner region", () => {
  const text = "研究问题与结论".repeat(8);
  const layout = { width: 480, height: 240, text };
  const rectangle = effectiveCanvasNodeTextStyle("rect", {}, layout).fontSize;
  const diamond = effectiveCanvasNodeTextStyle(
    "rect",
    { shape: "diamond" },
    layout,
  ).fontSize;
  assert.ok(diamond < rectangle);
  assert.ok(
    wrappedTextLines(text, 480 * 0.54, diamond).length * diamond * 1.25 <=
      240 * 0.58,
  );
});

test("tiny shapes and excessive content retain a readable floor without mutating the source", () => {
  const text = "正文".repeat(5000);
  const style: CanvasNodeStyle = { textColor: "#345678" };
  const layout = { width: 18, height: 18, text };
  assert.equal(
    effectiveCanvasNodeTextStyle("rect", style, layout).fontSize,
    14,
  );
  assert.equal(
    effectiveCanvasNodeTextStyle("rect", style, {
      ...layout,
      width: 480,
      height: 240,
    }).fontSize,
    14,
  );
  assert.deepEqual(style, { textColor: "#345678" });
  assert.equal(layout.text, text);
});

test("automatic size is recomputed after resize and save without persisting a fixed font size", () => {
  const document: CanvasDocument = {
    version: 2,
    nodes: [
      {
        id: "shape",
        kind: "rect",
        position: { x: 0, y: 0 },
        width: 120,
        height: 80,
        data: { title: "研究问题" },
        style: { radius: 16 },
      },
    ],
    connections: [],
  };
  const flow = canvasDocumentToFlow(document);
  const nodes = applyCanvasNodeChanges(
    [
      {
        id: "shape",
        type: "dimensions",
        dimensions: { width: 480, height: 240 },
        resizing: false,
        setAttributes: true,
      },
    ],
    flow.nodes,
  );
  assert.equal(
    nodes[0].data.model.width,
    120,
    "the stored model is intentionally separate from live Flow dimensions",
  );
  const saved = flowToCanvasDocument(nodes, [], { x: 0, y: 0, zoom: 0.5 });
  const restored = canvasFileToDocument(canvasDocumentToFile(saved));
  assert.deepEqual(restored.issues, []);
  const model = restored.document.nodes[0];
  assert.equal(model.width, 480);
  assert.equal(model.height, 240);
  assert.equal(model.style?.fontSize, undefined);
  assert.equal(
    effectiveCanvasNodeTextStyle("rect", model.style, {
      width: model.width,
      height: model.height,
      text: "研究问题",
    }).fontSize,
    48,
  );
});

test("SVG export uses the same automatic size and all fitted lines as the editor", () => {
  const text = "研究问题与结论".repeat(8);
  for (const shape of [undefined, "diamond"] as const) {
    const style: CanvasNodeStyle = { ...(shape ? { shape } : {}) };
    const layout = { width: 480, height: 240, text };
    const document: CanvasDocument = {
      version: 2,
      nodes: [
        {
          id: "shape",
          kind: "rect",
          position: { x: 0, y: 0 },
          width: layout.width,
          height: layout.height,
          data: { title: text },
          style,
        },
      ],
      connections: [],
    };
    const fontSize = effectiveCanvasNodeUiTextStyle(
      "rect",
      style,
      layout,
    ).fontSize;
    const svg = buildCanvasSvg(document);
    assert.match(svg, new RegExp(`font-size="${fontSize}"`));
    const exportedText = Array.from(
      svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g),
      (match) => match[1],
    ).join("");
    assert.equal(exportedText, text);
    assert.equal(document.nodes[0].style?.fontSize, undefined);
  }
});
