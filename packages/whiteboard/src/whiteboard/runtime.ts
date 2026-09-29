import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Viewport } from "@xyflow/react";
import {
  ACADEMIC_SOURCE_CARD_SIZE,
  createAcademicNode,
  type LiteratureSource,
} from "../model/academic";
import { createBasicNode } from "../model/basic";
import { parseCanvasDocument, type CanvasDocument } from "../model/document";
import type {
  AcademicAcquisition,
  AcademicAcquisitionFailure,
  AcademicDropSourceRef,
  AcademicRequestFailureCode,
  CanvasNotice,
  IndexedAcademicAcquisition,
} from "../model/protocol";
import type { SourceResolutionResult } from "../model/protocol";
import type { CanvasFlowNode } from "../nodes";
import {
  CanvasDocumentHistory,
  applySourceOwnedResolutionResults,
  applySourceResolutionResults,
  canvasDocumentToFlow,
  flowToCanvasDocument,
  sourceOwnedResolutionResults,
  type CanvasDocumentShell,
  type CanvasFlowEdge,
} from "./document";
import {
  applyLiteratureAnnotationCountToCanvasNode,
  applyLiteratureAnnotationCountToDocument,
} from "./sourceState";

export interface CanvasDocumentRuntime {
  nodes: CanvasFlowNode[];
  edges: CanvasFlowEdge[];
  setNodes: Dispatch<SetStateAction<CanvasFlowNode[]>>;
  setEdges: Dispatch<SetStateAction<CanvasFlowEdge[]>>;
  nodesRef: MutableRefObject<CanvasFlowNode[]>;
  edgesRef: MutableRefObject<CanvasFlowEdge[]>;
  viewportRef: MutableRefObject<Viewport>;
  shellRef: MutableRefObject<CanvasDocumentShell>;
  history: CanvasDocumentHistory;
  changed: () => void;
  pushHistory: () => void;
  applyDocument: (value: CanvasDocument) => void;
  loadSnapshot: (value: CanvasDocument) => void;
  applySourceResolutionBatch: (
    generation: number,
    results: SourceResolutionResult[],
  ) => void;
  applyLiteratureAnnotationCount: (
    nodeId: string,
    source: LiteratureSource,
    annotationCount: number,
  ) => void;
  getRawSnapshot: () => CanvasDocument;
  getSnapshot: () => CanvasDocument;
  undo: () => void;
  redo: () => void;
}

export interface AcademicAcquisitionRuntimeBindings {
  getNodes: () => CanvasFlowNode[];
  setNodes: (nodes: CanvasFlowNode[]) => void;
  getEdges: () => CanvasFlowEdge[];
  setEdges: (edges: CanvasFlowEdge[]) => void;
  pushHistory: () => void;
  changed: () => void;
  onNotice?: (notice: CanvasNotice) => void;
  createNodeId?: (requestId: string, sourceIndex: number) => string;
  onPickAcademicSource: (
    requestId: string,
    nodeId: string,
    kind: "literature",
  ) => void;
  onDropAcademicSources: (
    requestId: string,
    nodeId: string,
    sources: AcademicDropSourceRef[],
  ) => void;
}

export interface AcademicAcquisitionRuntime {
  placeLiterature: (
    requestId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
  dropLiterature: (
    requestId: string,
    nodeId: string,
    position: { x: number; y: number },
    sources: AcademicDropSourceRef[],
  ) => void;
  resolveBatch: (
    requestId: string,
    nodeId: string,
    successes: IndexedAcademicAcquisition[],
    failures: AcademicAcquisitionFailure[],
  ) => string[];
  reject: (
    requestId: string,
    nodeId: string,
    code: AcademicRequestFailureCode,
  ) => void;
  pendingNodeIds: () => string[];
  clear: () => void;
}

const ACADEMIC_BATCH_COLUMNS = 3;
const ACADEMIC_BATCH_GAP = 24;

export function academicBatchPosition(
  origin: { x: number; y: number },
  placementIndex: number,
): { x: number; y: number } {
  return {
    x:
      origin.x +
      (placementIndex % ACADEMIC_BATCH_COLUMNS) *
        (ACADEMIC_SOURCE_CARD_SIZE.literature.width + ACADEMIC_BATCH_GAP),
    y:
      origin.y +
      Math.floor(placementIndex / ACADEMIC_BATCH_COLUMNS) *
        (ACADEMIC_SOURCE_CARD_SIZE.literature.height + ACADEMIC_BATCH_GAP),
  };
}

export function applySourceResolutionBatch(
  setNodes: Dispatch<SetStateAction<CanvasFlowNode[]>>,
  generation: number,
  results: SourceResolutionResult[],
): void {
  setNodes((current) =>
    applySourceResolutionResults(current, generation, results),
  );
}

export function createAcademicAcquisitionRuntime(
  bindings: AcademicAcquisitionRuntimeBindings,
): AcademicAcquisitionRuntime {
  const pending = new Map<string, string>();

  const addPlaceholder = (
    requestId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => {
    pending.set(requestId, nodeId);
    const placeholder = canvasDocumentToFlow({
      version: 2,
      nodes: [
        {
          ...createBasicNode("item", position, nodeId),
          data: { title: "Loading…" },
        },
      ],
      connections: [],
    }).nodes[0];
    bindings.setNodes([...bindings.getNodes(), placeholder]);
  };

  const reject = (
    requestId: string,
    nodeId: string,
    code: AcademicRequestFailureCode,
  ) => {
    if (pending.get(requestId) !== nodeId) return;
    pending.delete(requestId);
    bindings.setNodes(rejectAcademicPlaceholder(bindings.getNodes(), nodeId));
    bindings.setEdges(
      rejectAcademicPlaceholderConnections(bindings.getEdges(), nodeId),
    );
    if (code !== "picker-cancelled") {
      bindings.onNotice?.({ code: "acquisition-failed" });
    }
  };

  const resolveBatch = (
    requestId: string,
    nodeId: string,
    successes: IndexedAcademicAcquisition[],
    failures: AcademicAcquisitionFailure[],
  ): string[] => {
    if (pending.get(requestId) !== nodeId) return [];
    const placeholder = bindings.getNodes().find((node) => node.id === nodeId);
    if (!placeholder) {
      pending.delete(requestId);
      return [];
    }
    const ordered = successes
      .filter(
        ({ acquisition }) =>
          acquisition.kind === "literature" ||
          acquisition.kind === "note" ||
          acquisition.kind === "attachment",
      )
      .slice()
      .sort((left, right) => left.index - right.index);
    if (!ordered.length) {
      pending.delete(requestId);
      bindings.setNodes(rejectAcademicPlaceholder(bindings.getNodes(), nodeId));
      bindings.setEdges(
        rejectAcademicPlaceholderConnections(bindings.getEdges(), nodeId),
      );
      bindings.onNotice?.({
        code: "acquisition-summary",
        context: { successCount: 0, failureCount: failures.length },
      });
      return [];
    }

    const replacements = ordered.flatMap(
      ({ index, acquisition }, placementIndex) => {
        const id =
          placementIndex === 0
            ? nodeId
            : (bindings.createNodeId?.(requestId, index) ??
              `${nodeId}-${index}`);
        const positionedPlaceholder = {
          ...placeholder,
          id,
          position: academicBatchPosition(placeholder.position, placementIndex),
        };
        const resolved = resolveAcademicPlaceholder(
          [positionedPlaceholder],
          id,
          acquisition,
        );
        return resolved ?? [];
      },
    );
    if (!replacements.length) {
      pending.delete(requestId);
      bindings.setNodes(rejectAcademicPlaceholder(bindings.getNodes(), nodeId));
      bindings.onNotice?.({
        code: "acquisition-summary",
        context: { successCount: 0, failureCount: failures.length },
      });
      return [];
    }
    bindings.pushHistory();
    pending.delete(requestId);
    bindings.setNodes([
      ...bindings.getNodes().filter((node) => node.id !== nodeId),
      ...replacements,
    ]);
    bindings.changed();
    bindings.onNotice?.({
      code: "acquisition-summary",
      context: {
        successCount: replacements.length,
        failureCount: failures.length,
      },
    });
    return replacements.map((node) => node.id);
  };

  return {
    placeLiterature(requestId, nodeId, position) {
      addPlaceholder(requestId, nodeId, position);
      bindings.onPickAcademicSource(requestId, nodeId, "literature");
    },
    dropLiterature(requestId, nodeId, position, sources) {
      addPlaceholder(requestId, nodeId, position);
      bindings.onDropAcademicSources(requestId, nodeId, sources);
    },
    resolveBatch,
    reject,
    pendingNodeIds: () => Array.from(pending.values()),
    clear() {
      pending.clear();
    },
  };
}

export function resolveAcademicPlaceholder(
  nodes: CanvasFlowNode[],
  nodeId: string,
  acquisition: AcademicAcquisition,
): CanvasFlowNode[] | undefined {
  if (
    acquisition.kind !== "literature" &&
    acquisition.kind !== "note" &&
    acquisition.kind !== "attachment"
  ) {
    return undefined;
  }
  const placeholder = nodes.find((node) => node.id === nodeId);
  if (!placeholder) return undefined;
  const academic =
    acquisition.kind === "literature"
      ? createAcademicNode("literature", placeholder.position, nodeId, {
          source: acquisition.source,
          snapshot: acquisition.snapshot,
        })
      : acquisition.kind === "note"
        ? {
            ...createAcademicNode("note", placeholder.position, nodeId),
            source: acquisition.source,
            ...(acquisition.sourceSnapshot
              ? { sourceSnapshot: acquisition.sourceSnapshot }
              : {}),
            content: acquisition.content,
          }
        : (() => {
            const basic = createBasicNode(
              "attachment",
              placeholder.position,
              nodeId,
            );
            const { subtitle: _defaultSubtitle, ...basicData } = basic.data;
            return {
              ...basic,
              data: {
                ...basicData,
                title:
                  acquisition.snapshot.title || acquisition.snapshot.filename,
                ...(acquisition.snapshot.contentType
                  ? { subtitle: acquisition.snapshot.contentType }
                  : {}),
                source: acquisition.source,
                ...(acquisition.snapshot.contentType
                  ? { contentType: acquisition.snapshot.contentType }
                  : {}),
                availability: acquisition.snapshot.availability,
              },
            };
          })();
  const replacement = canvasDocumentToFlow({
    version: 2,
    nodes: [academic],
    connections: [],
  }).nodes[0];
  return nodes.map((node) =>
    node.id === nodeId ? { ...replacement, selected: node.selected } : node,
  );
}

export function rejectAcademicPlaceholder(
  nodes: CanvasFlowNode[],
  nodeId: string,
): CanvasFlowNode[] {
  return nodes.filter((node) => node.id !== nodeId);
}

export function rejectAcademicPlaceholderConnections(
  edges: CanvasFlowEdge[],
  nodeId: string,
): CanvasFlowEdge[] {
  return edges.filter(
    (edge) => edge.source !== nodeId && edge.target !== nodeId,
  );
}

export function omitAcademicPlaceholders(
  document: CanvasDocument,
  nodeIds: Iterable<string>,
): CanvasDocument {
  const omitted = new Set(nodeIds);
  if (!omitted.size) return document;
  return {
    ...document,
    nodes: document.nodes.filter((node) => !omitted.has(node.id)),
    connections: document.connections.filter(
      (connection) =>
        !omitted.has(connection.source) && !omitted.has(connection.target),
    ),
  };
}

export function useCanvasDocumentRuntime(
  initial: CanvasDocument,
  onChange: (revision: number) => void,
  onViewport: (viewport: Viewport) => void,
  snapshotTransform: (document: CanvasDocument) => CanvasDocument = (
    document,
  ) => document,
): CanvasDocumentRuntime {
  const seedRef = useRef(canvasDocumentToFlow(initial));
  const [nodes, setNodesState] = useState(seedRef.current.nodes);
  const [edges, setEdgesState] = useState(seedRef.current.edges);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef<Viewport>(
    initial.viewport ?? { x: 0, y: 0, zoom: 1 },
  );
  const shellRef = useRef(seedRef.current.shell);
  const onChangeRef = useRef(onChange);
  const onViewportRef = useRef(onViewport);
  const snapshotTransformRef = useRef(snapshotTransform);
  onChangeRef.current = onChange;
  onViewportRef.current = onViewport;
  snapshotTransformRef.current = snapshotTransform;

  const historyRef = useRef<CanvasDocumentHistory | null>(null);
  if (!historyRef.current) {
    historyRef.current = new CanvasDocumentHistory((revision) =>
      onChangeRef.current(revision),
    );
  }
  const history = historyRef.current;

  const setNodes = useCallback<Dispatch<SetStateAction<CanvasFlowNode[]>>>(
    (update) => {
      const next =
        typeof update === "function" ? update(nodesRef.current) : update;
      nodesRef.current = next;
      setNodesState(next);
    },
    [],
  );

  const setEdges = useCallback<Dispatch<SetStateAction<CanvasFlowEdge[]>>>(
    (update) => {
      const next =
        typeof update === "function" ? update(edgesRef.current) : update;
      edgesRef.current = next;
      setEdgesState(next);
    },
    [],
  );

  const getRawSnapshot = useCallback(
    () =>
      flowToCanvasDocument(
        nodesRef.current,
        edgesRef.current,
        viewportRef.current,
        shellRef.current,
      ),
    [],
  );

  const getSnapshot = useCallback(
    () => snapshotTransformRef.current(getRawSnapshot()),
    [getRawSnapshot],
  );

  const pushHistory = useCallback(() => {
    history.push(getSnapshot());
  }, [getSnapshot, history]);

  const changed = useCallback(() => {
    history.changed();
  }, [history]);

  const applyDocument = useCallback((value: CanvasDocument) => {
    const document = parseRuntimeDocument(value);
    const next = canvasDocumentToFlow(document);
    const viewport = document.viewport ?? { x: 0, y: 0, zoom: 1 };

    nodesRef.current = next.nodes;
    edgesRef.current = next.edges;
    shellRef.current = next.shell;
    viewportRef.current = viewport;

    setNodesState(next.nodes);
    setEdgesState(next.edges);
    onViewportRef.current(viewport);
  }, []);

  const loadSnapshot = useCallback(
    (value: CanvasDocument) => {
      applyDocument(value);
      history.replace();
    },
    [applyDocument, history],
  );

  const applyDocumentSourceResolutionBatch = useCallback(
    (generation: number, results: SourceResolutionResult[]) => {
      const sourceOwned = sourceOwnedResolutionResults(
        nodesRef.current,
        generation,
        results,
      );
      if (sourceOwned.length) {
        history.rebase((document) =>
          applySourceOwnedResolutionResults(document, generation, sourceOwned),
        );
      }
      applySourceResolutionBatch(setNodes, generation, results);
    },
    [history, setNodes],
  );

  const applyLiteratureAnnotationCount = useCallback(
    (nodeId: string, source: LiteratureSource, annotationCount: number) => {
      const current = nodesRef.current;
      const next = current.map((node) => {
        const model = applyLiteratureAnnotationCountToCanvasNode(
          node.data.model,
          nodeId,
          source,
          annotationCount,
        );
        return model === node.data.model
          ? node
          : { ...node, data: { ...node.data, model } };
      });
      if (next.every((node, index) => node === current[index])) return;
      history.rebase((document) =>
        applyLiteratureAnnotationCountToDocument(
          document,
          nodeId,
          source,
          annotationCount,
        ),
      );
      setNodes(next);
    },
    [history, setNodes],
  );

  const undo = useCallback(() => {
    const previous = history.undo(getSnapshot());
    if (previous) applyDocument(previous);
  }, [applyDocument, getSnapshot, history]);

  const redo = useCallback(() => {
    const next = history.redo(getSnapshot());
    if (next) applyDocument(next);
  }, [applyDocument, getSnapshot, history]);

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    nodesRef,
    edgesRef,
    viewportRef,
    shellRef,
    history,
    changed,
    pushHistory,
    applyDocument,
    loadSnapshot,
    applySourceResolutionBatch: applyDocumentSourceResolutionBatch,
    applyLiteratureAnnotationCount,
    getRawSnapshot,
    getSnapshot,
    undo,
    redo,
  };
}

function parseRuntimeDocument(value: CanvasDocument): CanvasDocument {
  return parseCanvasDocument(value).document;
}
