import assert from "node:assert/strict";
import test from "node:test";
import { createBasicNode } from "../packages/whiteboard/src/model/basic.ts";
import type { CanvasNode } from "../packages/whiteboard/src/model/academic.ts";
import {
  searchCanvas,
  searchCanvasNodes,
} from "../packages/whiteboard/src/whiteboard/selection.ts";

test("search reads text from node models without copying geometry or binary attachment content", () => {
  const attachment = createBasicNode("attachment", { x: 0, y: 0 }, "pdf");
  attachment.data.title = "方法论.PDF";
  attachment.data.preview = "Research evidence";
  Object.defineProperties(attachment.data, {
    fileData: {
      enumerable: true,
      get: () => {
        throw new Error("Binary content read");
      },
    },
    image: {
      enumerable: true,
      get: () => {
        throw new Error("Image content read");
      },
    },
  });
  Object.defineProperty(attachment, "position", {
    get: () => {
      throw new Error("Geometry read");
    },
  });
  const nodes: CanvasNode[] = [
    attachment,
    {
      id: "note",
      kind: "note",
      content: "研究 **Evidence**",
      badge: "idea",
      position: { x: 100, y: 0 },
      width: 200,
      height: 150,
    },
  ];
  assert.deepEqual(searchCanvasNodes(nodes, "方法论 research"), ["pdf"]);
  assert.deepEqual(searchCanvasNodes(nodes, "evidence"), ["pdf", "note"]);
  assert.deepEqual(searchCanvasNodes(nodes, "研究 idea"), ["note"]);
  assert.deepEqual(
    searchCanvas({ version: 2, nodes, connections: [] }, "evidence"),
    ["pdf", "note"],
  );
  assert.deepEqual(searchCanvasNodes(nodes, "not found"), []);
});

test("an empty or whitespace query does not inspect any node", () => {
  const nodes = new Proxy([] as CanvasNode[], {
    get() {
      throw new Error("Empty search inspected nodes");
    },
  });
  assert.deepEqual(searchCanvasNodes(nodes, ""), []);
  assert.deepEqual(searchCanvasNodes(nodes, " \n\t "), []);
});

test("metadata remains searchable while base64 images and embedded files are excluded", () => {
  const attachment = createBasicNode("attachment", { x: 0, y: 0 }, "file");
  Object.assign(attachment.data, {
    title: "figure.png",
    subtitle: "Experiment result",
    contentType: "image/png",
    fileData: "data:image/png;base64,SGVsbG8=",
    image: "data:image/png;base64,SGVsbG8=",
  });
  assert.deepEqual(searchCanvasNodes([attachment], "figure experiment"), [
    "file",
  ]);
  assert.deepEqual(searchCanvasNodes([attachment], "image/png"), ["file"]);
  assert.deepEqual(searchCanvasNodes([attachment], "SGVsbG8"), []);
});
