import type { CanvasNode } from "../model/academic";
import type { CanvasPoint } from "../model/core";
import type { CanvasDocument } from "../model/document";
import type { CanvasFlowNode } from "../nodes/types";

export interface CanvasNodePositionUpdate {
  id: string;
  position: CanvasPoint;
}

export interface FrameDragSession {
  previousPositions: Record<string, CanvasPoint>;
}

export interface FrameDragUpdate {
  document: CanvasDocument;
  session: FrameDragSession;
}

export interface FrameDragState {
  session: FrameDragSession;
  phase: "active" | "ending";
}

export interface FrameDragStateUpdate {
  document: CanvasDocument;
  state: FrameDragState;
}

export interface FrameDragFlowNodesUpdate {
  nodes: CanvasFlowNode[];
  state: FrameDragState;
}

export interface FrameDragStateTransition {
  state: FrameDragState | undefined;
  notify: boolean;
}

export function assignNodeToFrame(
  document: CanvasDocument,
  nodeId: string,
  frameId: string | undefined,
): CanvasDocument {
  const member = requireNode(document, nodeId);
  if (member.kind === "frame") {
    throw new Error(`Frame ${nodeId} cannot belong to a frame.`);
  }

  if (frameId !== undefined) {
    const frame = requireNode(document, frameId);
    if (frame.kind !== "frame") {
      throw new Error(`Node ${frameId} is not a frame.`);
    }
  }

  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId
        ? frameId === undefined
          ? omitFrameId(node)
          : { ...node, frameId }
        : node,
    ),
    connections: [...document.connections],
  };
}

export function moveFrame(
  document: CanvasDocument,
  frameId: string,
  position: CanvasPoint,
): CanvasDocument {
  const frame = requireNode(document, frameId);
  if (frame.kind !== "frame") {
    throw new Error(`Node ${frameId} is not a frame.`);
  }

  const delta = {
    x: position.x - frame.position.x,
    y: position.y - frame.position.y,
  };
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id === frameId) {
        return { ...node, position: { ...position } };
      }
      if (node.kind !== "frame" && node.frameId === frameId) {
        return {
          ...node,
          position: {
            x: node.position.x + delta.x,
            y: node.position.y + delta.y,
          },
        };
      }
      return node;
    }),
    connections: [...document.connections],
  };
}

export function moveNodesInDocument(
  document: CanvasDocument,
  updates: readonly CanvasNodePositionUpdate[],
): CanvasDocument {
  const positions = new Map(
    updates.map((update) => [update.id, update.position] as const),
  );
  let moved = document;
  for (const node of document.nodes) {
    const position = positions.get(node.id);
    if (node.kind === "frame" && position) {
      moved = moveFrame(moved, node.id, position);
    }
  }

  return {
    ...moved,
    nodes: moved.nodes.map((node) => {
      const position = positions.get(node.id);
      return position && node.kind !== "frame"
        ? { ...node, position: { ...position } }
        : node;
    }),
    connections: [...moved.connections],
  };
}

export function beginFrameDrag(
  document: CanvasDocument,
  draggedNodeIds: readonly string[],
): FrameDragSession | undefined {
  const dragged = new Set(draggedNodeIds);
  const previousPositions = Object.fromEntries(
    document.nodes
      .filter((node) => node.kind === "frame" && dragged.has(node.id))
      .map((node) => [node.id, { ...node.position }]),
  );
  return Object.keys(previousPositions).length
    ? { previousPositions }
    : undefined;
}

export function beginFrameDragState(
  document: CanvasDocument,
  draggedNodeIds: readonly string[],
): FrameDragState | undefined {
  const session = beginFrameDrag(document, draggedNodeIds);
  return session ? { session, phase: "active" } : undefined;
}

export function updateFrameDrag(
  document: CanvasDocument,
  session: FrameDragSession,
  updates: readonly CanvasNodePositionUpdate[],
): FrameDragUpdate {
  const beforeStep: CanvasDocument = {
    ...document,
    nodes: document.nodes.map((node) => {
      const position = Object.hasOwn(session.previousPositions, node.id)
        ? session.previousPositions[node.id]
        : undefined;
      return node.kind === "frame" && position
        ? { ...node, position: { ...position } }
        : node;
    }),
  };
  const previousPositions = { ...session.previousPositions };
  for (const update of updates) {
    if (Object.hasOwn(previousPositions, update.id)) {
      previousPositions[update.id] = { ...update.position };
    }
  }
  return {
    document: moveNodesInDocument(beforeStep, updates),
    session: { previousPositions },
  };
}

export function updateFrameDragState(
  document: CanvasDocument,
  state: FrameDragState,
  updates: readonly CanvasNodePositionUpdate[],
): FrameDragStateUpdate {
  if (state.phase === "ending") return { document, state };
  const moved = updateFrameDrag(document, state.session, updates);
  return {
    document: moved.document,
    state: { ...state, session: moved.session },
  };
}

/** Frame movement needs geometry and membership, without serializing content or edges. */
export function updateFrameDragFlowNodes(
  nodes: CanvasFlowNode[],
  state: FrameDragState,
  updates: readonly CanvasNodePositionUpdate[],
): FrameDragFlowNodesUpdate {
  if (state.phase === "ending") return { nodes, state };
  const geometry: CanvasDocument = {
    version: 2,
    nodes: nodes.map((node) => ({
      ...node.data.model,
      id: node.id,
      position: node.position,
    })),
    connections: [],
  };
  const moved = updateFrameDragState(geometry, state, updates);
  let changed = false;
  // The frame algorithm preserves node order and count.
  const positioned = nodes.map((node, index) => {
    const position = moved.document.nodes[index].position;
    if (node.position.x === position.x && node.position.y === position.y) {
      return node;
    }
    changed = true;
    return { ...node, position };
  });
  return { nodes: changed ? positioned : nodes, state: moved.state };
}

export function settleFrameDragState(
  state: FrameDragState | undefined,
): FrameDragStateTransition {
  if (!state || state.phase === "ending") return { state, notify: false };
  return { state: { ...state, phase: "ending" }, notify: true };
}

export function finishFrameDragState(
  state: FrameDragState | undefined,
): FrameDragStateTransition {
  return {
    state: undefined,
    notify: state?.phase === "active",
  };
}

export function deleteNodeFromDocument(
  document: CanvasDocument,
  nodeId: string,
): CanvasDocument {
  const deleted = document.nodes.find((node) => node.id === nodeId);
  return {
    ...document,
    nodes: document.nodes
      .filter((node) => node.id !== nodeId)
      .map((node) =>
        deleted?.kind === "frame" &&
        node.kind !== "frame" &&
        node.frameId === nodeId
          ? omitFrameId(node)
          : node,
      ),
    connections: document.connections.filter(
      (connection) =>
        connection.source !== nodeId && connection.target !== nodeId,
    ),
  };
}

function requireNode(document: CanvasDocument, nodeId: string): CanvasNode {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown canvas node: ${nodeId}.`);
  return node;
}

function omitFrameId(node: CanvasNode): CanvasNode {
  if (node.kind === "frame") return node;
  const { frameId: _frameId, ...detached } = node;
  return detached as CanvasNode;
}
