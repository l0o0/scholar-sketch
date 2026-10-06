import assert from "node:assert/strict";
import test from "node:test";
import {
  assignNodeToFrame,
  beginFrameDrag,
  beginFrameDragState,
  deleteNodeFromDocument,
  finishFrameDragState,
  moveFrame,
  moveNodesInDocument,
  settleFrameDragState,
  updateFrameDrag,
  updateFrameDragFlowNodes,
  updateFrameDragState,
} from "../packages/whiteboard/src/whiteboard/frame.ts";
import { parseCanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import type { CanvasNode } from "../packages/whiteboard/src/model/academic.ts";
import type { CanvasFlowNode } from "../packages/whiteboard/src/nodes/types.ts";
import { flowToCanvasDocument } from "../packages/whiteboard/src/whiteboard/document.ts";

const fixture = () =>
  parseCanvasDocument({
    version: 2,
    nodes: [
      {
        id: "frame-1",
        kind: "frame",
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        title: "Topic",
        extensions: { retained: "frame" },
      },
      {
        id: "note-claim-1",
        kind: "note",
        position: { x: 40, y: 60 },
        width: 240,
        height: 120,
        frameId: "frame-1",
        content: "Claim",
        badge: "Claim",
        extensions: { retained: "member" },
      },
      {
        id: "note-overlap",
        kind: "note",
        position: { x: 80, y: 90 },
        width: 120,
        height: 80,
        content: "Overlaps but is not assigned",
      },
      {
        id: "frame-2",
        kind: "frame",
        position: { x: 600, y: 0 },
        width: 300,
        height: 240,
        title: "Other topic",
      },
      {
        id: "note-question-1",
        kind: "note",
        position: { x: 640, y: 40 },
        width: 240,
        height: 120,
        frameId: "frame-2",
        content: "Question",
        badge: "Question",
      },
    ],
    connections: [],
    metadata: { title: "Review" },
    extensions: { retained: { root: true } },
  }).document;

const flowFixture = (): CanvasFlowNode[] =>
  fixture().nodes.map((model) => ({
    id: model.id,
    type: model.kind,
    position: { ...model.position },
    width: model.width,
    height: model.height,
    measured: { width: model.width, height: model.height },
    selected: model.id === "note-overlap",
    hidden: model.id === "note-claim-1",
    style: { opacity: 0.9 },
    data: { model, extra: { retained: model.id } },
  }));

function assignedFrame(node: CanvasNode | undefined): string | undefined {
  return node && node.kind !== "frame" ? node.frameId : undefined;
}

test("moving a frame applies the same absolute delta to direct members", () => {
  const original = fixture();
  const before = structuredClone(original);
  const moved = moveFrame(original, "frame-1", { x: 100, y: 80 });

  assert.deepEqual(moved.nodes[0].position, { x: 100, y: 80 });
  assert.deepEqual(moved.nodes[1].position, { x: 140, y: 140 });
  assert.deepEqual(
    moved.nodes.find((node) => node.id === "note-overlap")?.position,
    { x: 80, y: 90 },
  );
  assert.deepEqual(
    moved.nodes.find((node) => node.id === "note-question-1")?.position,
    { x: 640, y: 40 },
  );
  assert.deepEqual(original, before);
  assert.deepEqual(moved.metadata, original.metadata);
  assert.deepEqual(moved.extensions, original.extensions);
});

test("batch movement handles multiple frames and absolute node targets once", () => {
  const original = fixture();
  const moved = moveNodesInDocument(original, [
    { id: "frame-1", position: { x: 100, y: 80 } },
    { id: "frame-2", position: { x: 660, y: 50 } },
    { id: "note-overlap", position: { x: 90, y: 100 } },
  ]);

  assert.deepEqual(
    moved.nodes.find((node) => node.id === "note-claim-1")?.position,
    { x: 140, y: 140 },
  );
  assert.deepEqual(
    moved.nodes.find((node) => node.id === "note-question-1")?.position,
    { x: 700, y: 90 },
  );
  assert.deepEqual(
    moved.nodes.find((node) => node.id === "note-overlap")?.position,
    { x: 90, y: 100 },
  );

  const next = moveNodesInDocument(moved, [
    { id: "frame-1", position: { x: 120, y: 100 } },
  ]);
  assert.deepEqual(
    next.nodes.find((node) => node.id === "note-claim-1")?.position,
    {
      x: 160,
      y: 160,
    },
  );
  assert.deepEqual(original.metadata, next.metadata);
  assert.deepEqual(original.extensions, next.extensions);
});

test("a multi-selection Frame drag advances every Frame incrementally", () => {
  const document = fixture();
  const session = beginFrameDrag(document, [
    "note-claim-1",
    "frame-1",
    "frame-2",
  ]);
  assert.deepEqual(session, {
    previousPositions: {
      "frame-1": { x: 0, y: 0 },
      "frame-2": { x: 600, y: 0 },
    },
  });
  assert.ok(session);

  const first = updateFrameDrag(document, session, [
    { id: "frame-1", position: { x: 100, y: 80 } },
    { id: "note-claim-1", position: { x: 140, y: 140 } },
    { id: "frame-2", position: { x: 660, y: 50 } },
  ]);
  assert.deepEqual(
    first.document.nodes.find((node) => node.id === "note-claim-1")?.position,
    { x: 140, y: 140 },
  );
  assert.deepEqual(
    first.document.nodes.find((node) => node.id === "note-question-1")
      ?.position,
    { x: 700, y: 90 },
  );

  const second = updateFrameDrag(first.document, first.session, [
    { id: "frame-1", position: { x: 120, y: 100 } },
    { id: "note-claim-1", position: { x: 160, y: 160 } },
    { id: "frame-2", position: { x: 700, y: 70 } },
  ]);
  assert.deepEqual(
    second.document.nodes.find((node) => node.id === "note-claim-1")?.position,
    { x: 160, y: 160 },
  );
  assert.deepEqual(
    second.document.nodes.find((node) => node.id === "note-question-1")
      ?.position,
    { x: 740, y: 110 },
  );
  assert.deepEqual(second.session.previousPositions, {
    "frame-1": { x: 120, y: 100 },
    "frame-2": { x: 700, y: 70 },
  });
});

test("dragging only ordinary nodes does not create a Frame drag session", () => {
  assert.equal(
    beginFrameDrag(fixture(), ["note-claim-1", "note-overlap"]),
    undefined,
  );
});

test("Frame drag state treats node IDs as data rather than prototype keys", () => {
  const document = fixture();
  document.nodes.push({
    id: "toString",
    kind: "frame",
    position: { x: 900, y: 100 },
    width: 300,
    height: 200,
    title: "Prototype key",
  });
  const session = beginFrameDrag(document, ["frame-1"]);
  assert.ok(session);

  const moved = updateFrameDrag(document, session, [
    { id: "frame-1", position: { x: 20, y: 20 } },
  ]);
  assert.deepEqual(
    moved.document.nodes.find((node) => node.id === "toString")?.position,
    { x: 900, y: 100 },
  );
});

test("an ending Frame drag suppresses terminal positions and duplicate changes", () => {
  const document = fixture();
  const active = beginFrameDragState(document, ["frame-1"]);
  assert.ok(active);

  const first = updateFrameDragState(document, active, [
    { id: "frame-1", position: { x: 100, y: 80 } },
  ]);
  assert.deepEqual(first.document.nodes[1].position, { x: 140, y: 140 });

  const settled = settleFrameDragState(first.state);
  assert.equal(settled.notify, true);
  assert.equal(settled.state?.phase, "ending");

  const terminal = updateFrameDragState(first.document, settled.state!, [
    { id: "frame-1", position: { x: 180, y: 160 } },
  ]);
  assert.deepEqual(terminal.document, first.document);

  const stopped = finishFrameDragState(terminal.state);
  assert.equal(stopped.state, undefined);
  assert.equal(stopped.notify, false);

  const ordinaryStop = finishFrameDragState(active);
  assert.equal(ordinaryStop.notify, true);
});

test("Flow frame dragging moves members and independent selection while preserving node payload identities", () => {
  const nodes = flowFixture();
  const state = beginFrameDragState(fixture(), ["frame-1", "note-overlap"]);
  assert.ok(state);
  const moved = updateFrameDragFlowNodes(nodes, state, [
    { id: "frame-1", position: { x: 100, y: 80 } },
    { id: "note-overlap", position: { x: 95, y: 105 } },
  ]);
  assert.deepEqual(moved.nodes[0].position, { x: 100, y: 80 });
  assert.deepEqual(moved.nodes[1].position, { x: 140, y: 140 });
  assert.deepEqual(moved.nodes[2].position, { x: 95, y: 105 });
  for (const index of [0, 1, 2]) {
    assert.notEqual(moved.nodes[index], nodes[index]);
    assert.equal(moved.nodes[index].data, nodes[index].data);
    assert.equal(moved.nodes[index].data.model, nodes[index].data.model);
    assert.equal(moved.nodes[index].measured, nodes[index].measured);
    assert.equal(moved.nodes[index].style, nodes[index].style);
    assert.equal(moved.nodes[index].selected, nodes[index].selected);
    assert.equal(moved.nodes[index].hidden, nodes[index].hidden);
    assert.equal(moved.nodes[index].width, nodes[index].width);
    assert.equal(moved.nodes[index].height, nodes[index].height);
  }
  assert.equal(moved.nodes[3], nodes[3]);
  assert.equal(moved.nodes[4], nodes[4]);
  assert.deepEqual(nodes[1].position, { x: 40, y: 60 });
  assert.deepEqual(moved.nodes[1].data.model.position, { x: 40, y: 60 });
  const saved = flowToCanvasDocument(moved.nodes, [], { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(saved.nodes[1].position, { x: 140, y: 140 });
});

test("Flow frame geometry takes current ids and positions over stale embedded models", () => {
  const nodes = flowFixture();
  const state = beginFrameDragState(fixture(), ["frame-1", "frame-2"]);
  assert.ok(state);
  nodes[0] = {
    ...nodes[0],
    position: { x: 100, y: 80 },
    data: {
      ...nodes[0].data,
      model: {
        ...nodes[0].data.model,
        id: "stale-frame-model",
        position: { x: -500, y: -500 },
      },
    },
  };
  nodes[1] = {
    ...nodes[1],
    data: {
      ...nodes[1].data,
      model: { ...nodes[1].data.model, position: { x: -20, y: -20 } },
    },
  };
  const moved = updateFrameDragFlowNodes(nodes, state, [
    { id: "frame-1", position: { x: 100, y: 80 } },
    { id: "frame-2", position: { x: 660, y: 50 } },
  ]);
  assert.equal(
    moved.nodes[0],
    nodes[0],
    "Frame already received its Flow position",
  );
  assert.deepEqual(moved.nodes[1].position, { x: 140, y: 140 });
  assert.deepEqual(moved.nodes[4].position, { x: 700, y: 90 });
  assert.equal(moved.nodes[1].data, nodes[1].data);
  assert.equal(moved.nodes[2], nodes[2]);
  assert.deepEqual(moved.state.session.previousPositions, {
    "frame-1": { x: 100, y: 80 },
    "frame-2": { x: 660, y: 50 },
  });
});

test("continuous Flow frame dragging advances members once and respects absolute selected-member positions", () => {
  const nodes = flowFixture();
  const state = beginFrameDragState(fixture(), ["frame-1", "note-claim-1"]);
  assert.ok(state);
  const first = updateFrameDragFlowNodes(nodes, state, [
    { id: "frame-1", position: { x: 100, y: 80 } },
    { id: "note-claim-1", position: { x: 150, y: 145 } },
  ]);
  const second = updateFrameDragFlowNodes(first.nodes, first.state, [
    { id: "frame-1", position: { x: 120, y: 100 } },
    { id: "note-claim-1", position: { x: 170, y: 165 } },
  ]);
  assert.deepEqual(first.nodes[1].position, { x: 150, y: 145 });
  assert.deepEqual(second.nodes[1].position, { x: 170, y: 165 });
  const third = updateFrameDragFlowNodes(second.nodes, second.state, [
    { id: "frame-1", position: { x: 140, y: 120 } },
  ]);
  assert.deepEqual(third.nodes[1].position, { x: 190, y: 185 });
  assert.equal(third.nodes[1].data, nodes[1].data);
  assert.equal(third.nodes[2], nodes[2]);
  assert.equal(third.nodes[3], nodes[3]);
  assert.equal(third.nodes[4], nodes[4]);
});

test("unchanged and ending Flow frame drags preserve the original node array", () => {
  const nodes = flowFixture();
  const state = beginFrameDragState(fixture(), ["frame-1"]);
  assert.ok(state);
  const unchanged = updateFrameDragFlowNodes(nodes, state, [
    { id: "frame-1", position: { x: 0, y: 0 } },
  ]);
  assert.equal(unchanged.nodes, nodes);
  const settled = settleFrameDragState(unchanged.state);
  assert.equal(settled.notify, true);
  const ending = updateFrameDragFlowNodes(nodes, settled.state!, [
    { id: "frame-1", position: { x: 500, y: 400 } },
  ]);
  assert.equal(ending.nodes, nodes);
  assert.equal(ending.state, settled.state);
  assert.deepEqual(finishFrameDragState(ending.state), {
    state: undefined,
    notify: false,
  });
});

test("assignment uses explicit membership and supports detaching", () => {
  const original = fixture();
  const assigned = assignNodeToFrame(original, "note-overlap", "frame-1");
  const detached = assignNodeToFrame(assigned, "note-overlap", undefined);

  assert.equal(
    assignedFrame(assigned.nodes.find((node) => node.id === "note-overlap")),
    "frame-1",
  );
  assert.equal(
    assignedFrame(detached.nodes.find((node) => node.id === "note-overlap")),
    undefined,
  );
  assert.equal(
    assignedFrame(original.nodes.find((node) => node.id === "note-overlap")),
    undefined,
  );
  assert.deepEqual(detached.metadata, original.metadata);
  assert.deepEqual(detached.extensions, original.extensions);
});

test("assignment rejects missing IDs, non-Frame targets, and a Frame member", () => {
  const document = fixture();

  assert.throws(() => assignNodeToFrame(document, "missing", "frame-1"));
  assert.throws(() => assignNodeToFrame(document, "note-claim-1", "missing"));
  assert.throws(() =>
    assignNodeToFrame(document, "note-claim-1", "note-question-1"),
  );
  assert.throws(() => assignNodeToFrame(document, "frame-1", "frame-2"));
});

test("deleting a frame detaches and preserves members", () => {
  const original = fixture();
  const deleted = deleteNodeFromDocument(original, "frame-1");
  const member = deleted.nodes.find((node) => node.id === "note-claim-1");

  assert.equal(deleted.nodes.length, original.nodes.length - 1);
  assert.equal(assignedFrame(member), undefined);
  assert.deepEqual(member?.extensions, { retained: "member" });
  assert.equal(assignedFrame(original.nodes[1]), "frame-1");
  assert.deepEqual(deleted.metadata, original.metadata);
  assert.deepEqual(deleted.extensions, original.extensions);
});

test("deleting a node removes every incident connection", () => {
  const document = fixture();
  document.connections.push(
    {
      id: "edge-1",
      kind: "academic",
      source: "note-claim-1",
      target: "frame-1",
      relation: "related",
    },
    {
      id: "edge-2",
      kind: "basic",
      source: "note-overlap",
      target: "note-claim-1",
    },
    {
      id: "edge-3",
      kind: "basic",
      source: "note-overlap",
      target: "note-question-1",
    },
  );

  const deleted = deleteNodeFromDocument(document, "note-claim-1");
  assert.deepEqual(
    deleted.connections.map((connection) => connection.id),
    ["edge-3"],
  );
  assert.equal(
    deleted.nodes.some((node) => node.id === "note-claim-1"),
    false,
  );
});

test("deleting a frame also removes its incident connections", () => {
  const document = fixture();
  document.connections.push({
    id: "edge-1",
    kind: "academic",
    source: "note-claim-1",
    target: "frame-1",
    relation: "related",
  });

  assert.deepEqual(deleteNodeFromDocument(document, "frame-1").connections, []);
});
