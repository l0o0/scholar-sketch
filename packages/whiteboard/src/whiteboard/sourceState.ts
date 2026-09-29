import {
  ACADEMIC_SOURCE_CARD_SIZE,
  attachmentSourceIdentity,
  createAcademicNode,
  literatureSourceIdentity,
  noteSourceIdentity,
  quoteSourceIdentity,
  type CanvasNode,
} from "../model/academic";
import type { CanvasDocument } from "../model/document";
import type {
  AcademicAcquisition,
  AcademicSourceDescriptor,
  AnnotationCandidate,
  SourceResolutionPriority,
  SourceResolutionResult,
} from "../model/protocol";
import type { CanvasFlowNode } from "../nodes";

export type SourceResolutionState =
  | { status: "idle" | "loading" | "resolved" }
  | { status: "unavailable"; message: string };

export type SourceResolutionStateUpdate =
  | { nodeId: string; status: "idle" | "loading" | "resolved" }
  | { nodeId: string; status: "unavailable"; message: string };

export interface SourceResolutionRequest {
  nodeId: string;
  source: AcademicSourceDescriptor;
  refresh?: boolean;
}

export interface QuoteBatchRuntimeBindings {
  getWorkingDocument: () => CanvasDocument;
  getHistoryDocument: () => CanvasDocument;
  applyDocument: (document: CanvasDocument) => void;
  commitHistory: (document: CanvasDocument) => void;
  createNodeId: (candidate: AnnotationCandidate, index: number) => string;
}

export interface QuoteBatchRuntime {
  add(
    literatureNodeId: string,
    candidates: readonly AnnotationCandidate[],
    selectedKeys: ReadonlySet<string>,
  ): string[];
}

export interface SourceRefreshRuntimeBindings {
  getNodes: () => CanvasFlowNode[];
  applyResolutionBatch: (
    generation: number,
    results: SourceResolutionResult[],
  ) => void;
  changed: () => void;
}

export interface SourceRefreshRuntime {
  request(node: CanvasFlowNode): SourceResolutionRequest | undefined;
  apply(
    generation: number,
    results: SourceResolutionResult[],
  ): SourceResolutionResult[];
  clear(): void;
}

export interface SourceActionCorrelation {
  begin(
    requestId: string,
    nodeId: string,
    source: AcademicSourceDescriptor,
  ): void;
  accept(
    requestId: string,
    nodeId: string,
    source: AcademicSourceDescriptor,
  ): boolean;
  clear(): void;
}

export function createSourceActionCorrelation(): SourceActionCorrelation {
  const pending = new Map<string, { requestId: string; sourceKey: string }>();
  return {
    begin(requestId, nodeId, source) {
      pending.set(nodeId, { requestId, sourceKey: sourceCacheKey(source) });
    },
    accept(requestId, nodeId, source) {
      const expected = pending.get(nodeId);
      if (
        !expected ||
        expected.requestId !== requestId ||
        expected.sourceKey !== sourceCacheKey(source)
      ) {
        return false;
      }
      pending.delete(nodeId);
      return true;
    },
    clear() {
      pending.clear();
    },
  };
}

const QUOTE_LAYOUT_COLUMNS = 2;
const QUOTE_LAYOUT_GAP = 24;

export function sourceDescriptor(
  node: CanvasNode,
): AcademicSourceDescriptor | undefined {
  if (node.kind === "literature")
    return { kind: "literature", source: node.source };
  if (node.kind === "quote") return { kind: "quote", source: node.source };
  if (node.kind === "note" && node.source) {
    return { kind: "note", source: node.source };
  }
  if ((node.kind === "pdf" || node.kind === "attachment") && node.data.source) {
    return { kind: "attachment", source: node.data.source };
  }
  return undefined;
}

export function sourceCacheKey(descriptor: AcademicSourceDescriptor): string {
  if (descriptor.kind === "literature") {
    return literatureSourceIdentity(descriptor.source);
  }
  if (descriptor.kind === "note") {
    return noteSourceIdentity(descriptor.source);
  }
  if (descriptor.kind === "attachment") {
    return attachmentSourceIdentity(descriptor.source);
  }
  return quoteSourceIdentity(descriptor.source);
}

export function applyResolvedAcquisition(
  node: CanvasFlowNode,
  acquisition: AcademicAcquisition,
): CanvasFlowNode {
  const resolved = applyResolvedAcquisitionToCanvasNode(
    node.data.model,
    acquisition,
  );
  return resolved === node.data.model
    ? node
    : {
        ...node,
        type: resolved.kind,
        data: { ...node.data, model: resolved },
      };
}

export function applyResolvedAcquisitionToCanvasNode(
  node: CanvasNode,
  acquisition: AcademicAcquisition,
): CanvasNode {
  const descriptor = sourceDescriptor(node);
  const acquiredDescriptor = descriptorForAcquisition(acquisition);
  if (
    !descriptor ||
    descriptor.kind !== acquisition.kind ||
    sourceCacheKey(descriptor) !== sourceCacheKey(acquiredDescriptor)
  ) {
    return node;
  }

  if (node.kind === "literature" && acquisition.kind === "literature") {
    return {
      ...node,
      snapshot: mergeLiteratureSnapshot(node.snapshot, acquisition.snapshot),
    };
  }
  if (node.kind === "quote" && acquisition.kind === "quote") {
    return { ...node, snapshot: acquisition.snapshot };
  }
  if (node.kind === "note" && acquisition.kind === "note") {
    const { sourceSnapshot: _previousSourceSnapshot, ...withoutTitle } = node;
    return acquisition.sourceSnapshot
      ? { ...withoutTitle, sourceSnapshot: acquisition.sourceSnapshot }
      : withoutTitle;
  }
  if (
    (node.kind === "pdf" || node.kind === "attachment") &&
    acquisition.kind === "attachment"
  ) {
    const nextKind =
      node.kind === "pdf" &&
      acquisition.snapshot.contentType?.toLowerCase() === "application/pdf"
        ? "pdf"
        : "attachment";
    const cleanData =
      nextKind === "attachment" && node.kind === "pdf"
        ? (() => {
            const {
              subtitle: _subtitle,
              contentType: _contentType,
              pdfPage: _page,
              image: _image,
              asset: _asset,
              ...rest
            } = node.data;
            return rest;
          })()
        : (() => {
            const {
              subtitle: _subtitle,
              contentType: _contentType,
              ...rest
            } = node.data;
            return rest;
          })();
    return {
      ...node,
      kind: nextKind,
      data: {
        ...cleanData,
        title: acquisition.snapshot.title || acquisition.snapshot.filename,
        ...(acquisition.snapshot.contentType
          ? { subtitle: acquisition.snapshot.contentType }
          : {}),
        source: acquisition.source,
        ...(acquisition.snapshot.contentType
          ? { contentType: acquisition.snapshot.contentType }
          : {}),
        availability: acquisition.snapshot.availability,
      },
    } as CanvasNode;
  }
  return node;
}

export function applyLiteratureAnnotationCountToCanvasNode(
  node: CanvasNode,
  nodeId: string,
  source: Extract<AcademicSourceDescriptor, { kind: "literature" }>["source"],
  annotationCount: number,
): CanvasNode {
  if (
    node.id !== nodeId ||
    node.kind !== "literature" ||
    literatureSourceIdentity(node.source) !==
      literatureSourceIdentity(source) ||
    !Number.isSafeInteger(annotationCount) ||
    annotationCount < 0 ||
    node.snapshot.annotationCount === annotationCount
  ) {
    return node;
  }
  return {
    ...node,
    snapshot: { ...node.snapshot, annotationCount },
  };
}

export function applyLiteratureAnnotationCountToDocument(
  document: CanvasDocument,
  nodeId: string,
  source: Extract<AcademicSourceDescriptor, { kind: "literature" }>["source"],
  annotationCount: number,
): CanvasDocument {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    const next = applyLiteratureAnnotationCountToCanvasNode(
      node,
      nodeId,
      source,
      annotationCount,
    );
    if (next !== node) changed = true;
    return next;
  });
  return changed ? { ...document, nodes } : document;
}

export function sourceSnapshotChanged(
  node: CanvasFlowNode,
  acquisition: AcademicAcquisition,
): boolean {
  const current = sourceDescriptor(node.data.model);
  const incoming = descriptorForAcquisition(acquisition);
  if (
    !current ||
    sourceCacheKey(current) !== sourceCacheKey(incoming) ||
    current.kind !== incoming.kind
  ) {
    return false;
  }
  const model = node.data.model;
  if (model.kind === "literature" && acquisition.kind === "literature") {
    return !literatureSnapshotsEqual(
      model.snapshot,
      mergeLiteratureSnapshot(model.snapshot, acquisition.snapshot),
    );
  }
  if (model.kind === "quote" && acquisition.kind === "quote") {
    return !quoteSnapshotsEqual(model.snapshot, acquisition.snapshot);
  }
  if (
    (model.kind === "pdf" || model.kind === "attachment") &&
    acquisition.kind === "attachment"
  ) {
    return (
      model.data.title !==
        (acquisition.snapshot.title || acquisition.snapshot.filename) ||
      model.data.subtitle !== acquisition.snapshot.contentType ||
      model.data.availability !== acquisition.snapshot.availability
    );
  }
  return false;
}

export function createQuoteBatchRuntime(
  bindings: QuoteBatchRuntimeBindings,
): QuoteBatchRuntime {
  return {
    add(literatureNodeId, candidates, selectedKeys) {
      const document = bindings.getWorkingDocument();
      const literature = document.nodes.find(
        (node) => node.id === literatureNodeId && node.kind === "literature",
      );
      if (!literature || literature.kind !== "literature") return [];

      const literatureIdentity = literatureSourceIdentity(literature.source);
      const seen = new Set(
        document.nodes.flatMap((node) =>
          node.kind === "quote" ? [quoteSourceIdentity(node.source)] : [],
        ),
      );
      const accepted: AnnotationCandidate[] = [];
      for (const candidate of candidates) {
        const source = candidate.acquisition.source;
        const identity = quoteSourceIdentity(source);
        if (
          !selectedKeys.has(identity) ||
          seen.has(identity) ||
          literatureSourceIdentity(source) !== literatureIdentity
        ) {
          continue;
        }
        seen.add(identity);
        accepted.push(candidate);
      }
      if (!accepted.length) return [];

      const existingRows = Math.ceil(
        document.nodes.filter(
          (node) =>
            node.kind === "quote" &&
            literatureSourceIdentity(node.source) === literatureIdentity,
        ).length / QUOTE_LAYOUT_COLUMNS,
      );
      const added = accepted.map((candidate, index) => {
        const column = index % QUOTE_LAYOUT_COLUMNS;
        const row = existingRows + Math.floor(index / QUOTE_LAYOUT_COLUMNS);
        return createAcademicNode(
          "quote",
          {
            x:
              literature.position.x +
              literature.width +
              QUOTE_LAYOUT_GAP +
              column *
                (ACADEMIC_SOURCE_CARD_SIZE.quote.width + QUOTE_LAYOUT_GAP),
            y:
              literature.position.y +
              row * (ACADEMIC_SOURCE_CARD_SIZE.quote.height + QUOTE_LAYOUT_GAP),
          },
          bindings.createNodeId(candidate, index),
          {
            source: candidate.acquisition.source,
            snapshot: candidate.acquisition.snapshot,
          },
        );
      });
      bindings.commitHistory(bindings.getHistoryDocument());
      bindings.applyDocument({
        ...document,
        nodes: [...document.nodes, ...added],
      });
      return added.map((node) => node.id);
    },
  };
}

export function createSourceRefreshRuntime(
  bindings: SourceRefreshRuntimeBindings,
): SourceRefreshRuntime {
  const pending = new Map<string, string>();
  return {
    request(node) {
      const source = sourceDescriptor(node.data.model);
      if (!source || source.kind === "note") return undefined;
      pending.set(node.id, sourceCacheKey(source));
      return { nodeId: node.id, source };
    },
    apply(generation, results) {
      const before = bindings.getNodes();
      let changedSnapshots = false;
      const explicitResults: SourceResolutionResult[] = [];
      for (const result of results) {
        if (result.generation !== generation) continue;
        const expected = pending.get(result.nodeId);
        if (!expected) continue;
        pending.delete(result.nodeId);
        explicitResults.push(result);
        if (result.status !== "resolved") continue;
        const node = before.find((candidate) => candidate.id === result.nodeId);
        const descriptor = node && sourceDescriptor(node.data.model);
        if (
          node &&
          descriptor &&
          sourceCacheKey(descriptor) === expected &&
          sourceSnapshotChanged(node, result.acquisition)
        ) {
          changedSnapshots = true;
        }
      }
      bindings.applyResolutionBatch(generation, results);
      if (changedSnapshots) bindings.changed();
      return explicitResults;
    },
    clear() {
      pending.clear();
    },
  };
}

export function createSourceResolutionStates(
  nodes: readonly CanvasNode[],
): Map<string, SourceResolutionState> {
  return new Map(
    nodes.flatMap((node) =>
      sourceDescriptor(node) ? ([[node.id, { status: "idle" }]] as const) : [],
    ),
  );
}

export function updateSourceResolutionStates(
  current: ReadonlyMap<string, SourceResolutionState>,
  updates: readonly SourceResolutionStateUpdate[],
): Map<string, SourceResolutionState> {
  const next = new Map(current);
  for (const { nodeId, ...state } of updates) {
    next.set(nodeId, state);
  }
  return next;
}

export function visibleSourceNodeIds(
  nodes: readonly CanvasFlowNode[],
  viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
): string[] {
  const zoom =
    Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const bounds = {
    left: -viewport.x / zoom,
    top: -viewport.y / zoom,
    right: (size.width - viewport.x) / zoom,
    bottom: (size.height - viewport.y) / zoom,
  };
  return nodes.flatMap((node) => {
    if (!sourceDescriptor(node.data.model)) return [];
    const width = node.measured?.width ?? node.width ?? node.data.model.width;
    const height =
      node.measured?.height ?? node.height ?? node.data.model.height;
    const visible =
      node.position.x + width >= bounds.left &&
      node.position.x <= bounds.right &&
      node.position.y + height >= bounds.top &&
      node.position.y <= bounds.bottom;
    return visible ? [node.id] : [];
  });
}

export function prioritizedSourceRequests(
  nodes: readonly CanvasFlowNode[],
  viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
): Record<SourceResolutionPriority, SourceResolutionRequest[]> {
  const visible = new Set(visibleSourceNodeIds(nodes, viewport, size));
  const requests: Record<SourceResolutionPriority, SourceResolutionRequest[]> =
    {
      selected: [],
      visible: [],
      idle: [],
    };
  for (const node of nodes) {
    const source = sourceDescriptor(node.data.model);
    if (!source) continue;
    const priority: SourceResolutionPriority = node.selected
      ? "selected"
      : visible.has(node.id)
        ? "visible"
        : "idle";
    requests[priority].push({ nodeId: node.id, source });
  }
  return requests;
}

function descriptorForAcquisition(
  acquisition: AcademicAcquisition,
): AcademicSourceDescriptor {
  return {
    kind: acquisition.kind,
    source: acquisition.source,
  } as AcademicSourceDescriptor;
}

function literatureSnapshotsEqual(
  left: Extract<CanvasNode, { kind: "literature" }>["snapshot"],
  right: Extract<AcademicAcquisition, { kind: "literature" }>["snapshot"],
): boolean {
  return (
    left.title === right.title &&
    left.creators === right.creators &&
    left.year === right.year &&
    left.publicationTitle === right.publicationTitle &&
    left.annotationCount === right.annotationCount &&
    stringArraysEqual(left.tags, right.tags)
  );
}

function mergeLiteratureSnapshot(
  current: Extract<CanvasNode, { kind: "literature" }>["snapshot"],
  incoming: Extract<AcademicAcquisition, { kind: "literature" }>["snapshot"],
): Extract<CanvasNode, { kind: "literature" }>["snapshot"] {
  return incoming.annotationCount === undefined &&
    current.annotationCount !== undefined
    ? { ...incoming, annotationCount: current.annotationCount }
    : incoming;
}

function quoteSnapshotsEqual(
  left: Extract<CanvasNode, { kind: "quote" }>["snapshot"],
  right: Extract<AcademicAcquisition, { kind: "quote" }>["snapshot"],
): boolean {
  return (
    left.text === right.text &&
    left.comment === right.comment &&
    left.citation === right.citation &&
    left.pageLabel === right.pageLabel &&
    left.color === right.color
  );
}

function stringArraysEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
