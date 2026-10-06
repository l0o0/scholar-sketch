import type { CanvasDocument } from "../model/document";
import type { CanvasNode } from "../model/academic";
import { parseCanvasDocument } from "../model/document";
import type { CanvasFlowNode } from "../nodes";
import { autoLayoutNodes } from "./layout";

export function selectedDocument(
  document: CanvasDocument,
  ids: readonly string[],
): CanvasDocument {
  const selected = new Set(ids);
  const frames = new Set(
    document.nodes
      .filter((n) => n.kind === "frame" && selected.has(n.id))
      .map((n) => n.id),
  );
  for (const node of document.nodes)
    if (node.kind !== "frame" && node.frameId && frames.has(node.frameId))
      selected.add(node.id);
  return {
    version: document.version,
    nodes: document.nodes
      .filter((n) => selected.has(n.id))
      .map((node) => {
        const copy = JSON.parse(JSON.stringify(node));
        if (copy.frameId && !selected.has(copy.frameId)) delete copy.frameId;
        return copy;
      }),
    connections: document.connections.filter(
      (e) => selected.has(e.source) && selected.has(e.target),
    ),
  };
}

export function cloneSelection(
  document: CanvasDocument,
  createId: () => string,
  offset = { x: 24, y: 24 },
): CanvasDocument {
  const copy: CanvasDocument = JSON.parse(JSON.stringify(document));
  const ids = new Map(copy.nodes.map((node) => [node.id, createId()]));
  return {
    version: copy.version,
    nodes: copy.nodes.map((node) => ({
      ...node,
      id: ids.get(node.id)!,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      ...(node.kind !== "frame" && node.frameId
        ? { frameId: ids.get(node.frameId) }
        : {}),
    })),
    connections: copy.connections.map((edge) => ({
      ...edge,
      id: createId(),
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
    })),
  };
}

const CLIPBOARD_KIND = "scholar-canvas-selection";
export function serializeSelection(document: CanvasDocument): string {
  return JSON.stringify({ type: CLIPBOARD_KIND, document });
}
export function parseSelection(value: string): CanvasDocument | null {
  if (value.length > 20 * 1024 * 1024) return null;
  try {
    const payload = JSON.parse(value);
    if (payload.type !== CLIPBOARD_KIND) return null;
    const parsed = parseCanvasDocument(payload.document);
    return parsed.issues.length || !parsed.document.nodes.length
      ? null
      : parsed.document;
  } catch {
    return null;
  }
}

/** Move frames as units; their members are moved by moveNodesInDocument. */
export function layoutSelection(nodes: CanvasFlowNode[]): CanvasFlowNode[] {
  const selected = nodes.filter((node) => node.selected);
  const candidates = selected.length ? selected : nodes;
  const frameIds = new Set(
    candidates.filter((n) => n.type === "frame").map((n) => n.id),
  );
  return autoLayoutNodes(
    candidates.filter(
      (n) =>
        n.data.model.kind === "frame" ||
        !n.data.model.frameId ||
        !frameIds.has(n.data.model.frameId),
    ),
  );
}

export function searchCanvas(
  document: CanvasDocument,
  query: string,
): string[] {
  return searchCanvasNodes(document.nodes, query);
}

/** Search node text directly; geometry, edges and binary payloads are not text. */
export function searchCanvasNodes(
  nodes: readonly CanvasNode[],
  query: string,
): string[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return nodes
    .filter((node) => {
      const data =
        node.kind === "note"
          ? [node.content, node.badge]
          : node.kind === "literature" || node.kind === "quote"
            ? Object.values(node.snapshot)
            : node.kind === "frame"
              ? [node.title]
              : Object.keys(node.data)
                  .filter((key) => key !== "fileData" && key !== "image")
                  .map((key) => node.data[key as keyof typeof node.data]);
      const text = data
        .filter((value) => typeof value === "string" || Array.isArray(value))
        .join(" ")
        .toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .map((node) => node.id);
}
