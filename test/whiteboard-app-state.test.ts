import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MarkerType } from "@xyflow/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertiesPanel } from "../packages/whiteboard/src/chrome/PropertiesPanel.tsx";
import { quoteSourceIdentity } from "../packages/whiteboard/src/model/academic.ts";
import {
  parseCanvasDocument,
  type CanvasDocument,
} from "../packages/whiteboard/src/model/document.ts";
import {
  canvasDocumentToFile,
  canvasFileToDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import {
  beginNodeEditing,
  applySourceResolutionResults,
  CanvasDocumentHistory,
  canvasDocumentToFlow,
  flowNodeText,
  flowToCanvasDocument,
  labelTextStyle,
  mergeEditingStyle,
  toggleEditingBold,
  updateFlowNodeModel,
  withEdgeStyle,
  verticalAlignmentStyle,
  withEdgeColor,
} from "../packages/whiteboard/src/whiteboard/document.ts";
import {
  armEditFocusHold,
  consumeEditFocusHold,
  handleEditBlur,
} from "../packages/whiteboard/src/whiteboard/editFocus.ts";
import { buildCanvasSvg } from "../packages/whiteboard/src/whiteboard/export.ts";
import { captureCanvasArrowKey } from "../packages/whiteboard/src/whiteboard/keyboard.ts";
import {
  createAcademicAcquisitionRuntime,
  useCanvasDocumentRuntime,
  type CanvasDocumentRuntime,
} from "../packages/whiteboard/src/whiteboard/runtime.ts";
import * as runtimeModule from "../packages/whiteboard/src/whiteboard/runtime.ts";
import {
  createNoteRefreshRuntime,
  requestConfirmedNoteRefresh,
} from "../packages/whiteboard/src/whiteboard/noteRefresh.ts";
import {
  applyResolvedAcquisition,
  createQuoteBatchRuntime,
  createSourceRefreshRuntime,
  sourceCacheKey,
  sourceDescriptor,
} from "../packages/whiteboard/src/whiteboard/sourceState.ts";
import type {
  AcademicAcquisitionFailure,
  AnnotationCandidate,
  WhiteboardLabels,
} from "../packages/whiteboard/src/model/protocol.ts";

type Assert<T extends true> = T;
type _RuntimeLoadsCanvasDocument = Assert<
  Parameters<CanvasDocumentRuntime["loadSnapshot"]>[0] extends CanvasDocument
    ? true
    : false
>;

const EMPTY: CanvasDocument = {
  version: 2,
  nodes: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const noteActionLabels = {
  selection: "Current selection",
  sourceStatus: "Source status",
  sourceIdle: "Not checked",
  sourceAvailable: "Available",
  sourceLoading: "Checking…",
  sourceMissing: "Source unavailable",
  openSource: "Open source",
  refreshSource: "Refresh source",
  refreshNote: "Refresh from Zotero",
  noteOverwriteTitle: "Replace local Note?",
  noteOverwriteBody:
    "Zotero's current Note will replace local content. Local changes will be lost.",
  confirm: "Replace",
  cancel: "Cancel",
} satisfies Pick<
  WhiteboardLabels,
  | "sourceStatus"
  | "selection"
  | "sourceIdle"
  | "sourceAvailable"
  | "sourceLoading"
  | "sourceMissing"
  | "openSource"
  | "refreshSource"
  | "refreshNote"
  | "noteOverwriteTitle"
  | "noteOverwriteBody"
  | "confirm"
  | "cancel"
>;

test("multi-source acquisition preserves order, duplicates, grid placement, and one history boundary", () => {
  let nodes = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "keep",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 128,
        content: "Keep this edit",
      },
    ],
  }).nodes;
  let edges: ReturnType<typeof canvasDocumentToFlow>["edges"] = [];
  let pushes = 0;
  let changes = 0;
  const historyKinds: string[][] = [];
  const notices: unknown[] = [];
  const acquisition = createAcademicAcquisitionRuntime({
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next;
    },
    getEdges: () => edges,
    setEdges: (next) => {
      edges = next;
    },
    pushHistory: () => {
      pushes += 1;
      historyKinds.push(
        runtimeModule
          .omitAcademicPlaceholders(
            flowToCanvasDocument(nodes, edges, { x: 0, y: 0, zoom: 1 }),
            acquisition.pendingNodeIds(),
          )
          .nodes.map((node) => node.kind),
      );
    },
    changed: () => {
      changes += 1;
    },
    onNotice: (message) => notices.push(message),
    createNodeId: (_requestId, sourceIndex) => `placed-${sourceIndex}`,
    onPickAcademicSource: () => assert.fail("unexpected picker"),
    onDropAcademicSources: () => undefined,
  });

  acquisition.dropLiterature(
    "drop-many",
    "batch-placeholder",
    { x: 100, y: 200 },
    [
      { library: { type: "user" }, itemKey: "FIRST123" },
      { library: { type: "user" }, itemKey: "PDF12345" },
      { library: { type: "user" }, itemKey: "FIRST123" },
      { library: { type: "user" }, itemKey: "NOTE1234" },
    ],
  );
  const failures: AcademicAcquisitionFailure[] = [
    {
      index: 1,
      code: "unsupported-attachment",
      message: "Zotero attachments cannot be added to the canvas.",
    },
  ];
  acquisition.resolveBatch(
    "drop-many",
    "batch-placeholder",
    [
      {
        index: 0,
        acquisition: {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: "SAME1234" },
          snapshot: { title: "First placement" },
        },
      },
      {
        index: 2,
        acquisition: {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: "SAME1234" },
          snapshot: { title: "Repeated placement" },
        },
      },
      {
        index: 3,
        acquisition: {
          kind: "note",
          source: { library: { type: "user" }, noteKey: "NOTE1234" },
          sourceSnapshot: { title: "Imported note" },
          content: "Independent local content",
        },
      },
      {
        index: 5,
        acquisition: {
          kind: "note",
          source: { library: { type: "user" }, noteKey: "NOTE5678" },
          sourceSnapshot: { title: "Bounded second row" },
          content: "Second independent Note",
        },
      },
    ],
    failures,
  );

  const saved = flowToCanvasDocument(nodes, edges, {
    x: 0,
    y: 0,
    zoom: 1,
  });
  assert.deepEqual(
    saved.nodes.map((node) => node.kind),
    ["note", "literature", "literature", "note", "note"],
  );
  assert.deepEqual(
    saved.nodes.slice(1).map((node) => node.position),
    [
      { x: 100, y: 200 },
      { x: 404, y: 200 },
      { x: 708, y: 200 },
      { x: 100, y: 424 },
    ],
  );
  assert.deepEqual(
    saved.nodes
      .filter((node) => node.kind === "literature")
      .map((node) => node.source.itemKey),
    ["SAME1234", "SAME1234"],
  );
  assert.equal(
    saved.nodes.filter((node) => node.kind === "literature").length,
    2,
  );
  assert.equal(saved.nodes.filter((node) => node.kind === "note").length, 3);
  assert.equal(
    saved.nodes.some((node) => node.kind === "attachment"),
    false,
  );
  const repeatedCacheKeys = saved.nodes.flatMap((node) => {
    if (node.kind !== "literature" || node.source.itemKey !== "SAME1234") {
      return [];
    }
    const descriptor = sourceDescriptor(node);
    return descriptor ? [sourceCacheKey(descriptor)] : [];
  });
  assert.deepEqual(repeatedCacheKeys, [
    '["literature","user",null,"SAME1234"]',
    '["literature","user",null,"SAME1234"]',
  ]);
  assert.equal(saved.connections.length, 0);
  assert.equal(
    saved.nodes.some((node) => node.id === "batch-placeholder"),
    true,
    "the first success reuses the batch placement id, not a loading model",
  );
  assert.equal(saved.nodes[1].kind, "literature");
  assert.equal(pushes, 1);
  assert.equal(changes, 1);
  assert.deepEqual(historyKinds, [["note"]]);
  assert.deepEqual(notices, [
    {
      code: "acquisition-summary",
      context: { successCount: 4, failureCount: 1 },
    },
  ]);
  assert.deepEqual(
    failures.map((failure) => failure.index),
    [1],
  );
});

test("a zero-success source batch removes loading state without history and ignores stale replies", () => {
  let nodes = canvasDocumentToFlow(EMPTY).nodes;
  let edges: ReturnType<typeof canvasDocumentToFlow>["edges"] = [];
  let pushes = 0;
  let changes = 0;
  const notices: unknown[] = [];
  const acquisition = createAcademicAcquisitionRuntime({
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next;
    },
    getEdges: () => edges,
    setEdges: (next) => {
      edges = next;
    },
    pushHistory: () => {
      pushes += 1;
    },
    changed: () => {
      changes += 1;
    },
    onNotice: (message) => notices.push(message),
    onPickAcademicSource: () => undefined,
    onDropAcademicSources: () => undefined,
  });

  acquisition.dropLiterature("failed", "pending", { x: 1, y: 2 }, [
    { library: { type: "user" }, itemKey: "MISSING1" },
  ]);
  acquisition.resolveBatch(
    "failed",
    "pending",
    [],
    [{ index: 0, code: "item-missing", message: "Missing" }],
  );
  assert.deepEqual(nodes, []);
  assert.deepEqual(acquisition.pendingNodeIds(), []);
  assert.equal(pushes, 0);
  assert.equal(changes, 0);
  assert.deepEqual(notices, [
    {
      code: "acquisition-summary",
      context: { successCount: 0, failureCount: 1 },
    },
  ]);

  acquisition.dropLiterature("stale", "old-document", { x: 3, y: 4 }, [
    { library: { type: "user" }, itemKey: "STALE123" },
  ]);
  acquisition.clear();
  nodes = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "replacement",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "New document",
      },
    ],
  }).nodes;
  acquisition.resolveBatch(
    "stale",
    "old-document",
    [
      {
        index: 0,
        acquisition: {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: "STALE123" },
          snapshot: { title: "Late reply" },
        },
      },
    ],
    [],
  );
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["replacement"],
  );
  assert.equal(pushes, 0);
  assert.equal(changes, 0);
});

const appSource = readFileSync(
  new URL("../packages/whiteboard/src/whiteboard/app.tsx", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("../packages/whiteboard/src/whiteboard/runtime.ts", import.meta.url),
  "utf8",
);
const canvasCss = readFileSync(
  new URL("../packages/whiteboard/src/whiteboard/board.css", import.meta.url),
  "utf8",
);

function callbackSource(name: string): string | undefined {
  const start = appSource.indexOf(`const ${name} = useCallback`);
  if (start < 0) return undefined;
  const end = appSource.indexOf("\n\n  const ", start);
  return end < 0 ? undefined : appSource.slice(start, end);
}

function academicDocument(): CanvasDocument {
  return {
    version: 2,
    nodes: [
      {
        id: "literature-1",
        kind: "literature",
        position: { x: 24, y: 36 },
        width: 280,
        height: 136,
        source: { library: { type: "user" }, itemKey: "ITEM1234" },
        snapshot: { title: "A paper", creators: "Smith", year: "2026" },
      },
      {
        id: "claim-1",
        kind: "note",
        position: { x: 360, y: 52 },
        width: 260,
        height: 128,
        content: "The result generalizes",
      },
    ],
    connections: [
      {
        id: "supports-1",
        kind: "academic",
        source: "literature-1",
        target: "claim-1",
        relation: "supports",
        color: "#2563eb",
      },
    ],
  };
}

function annotationCandidate(
  attachmentKey: string,
  annotationKey: string,
  text: string,
): AnnotationCandidate {
  return {
    attachmentTitle: `${attachmentKey}.pdf`,
    sortIndex: annotationKey,
    acquisition: {
      kind: "quote",
      source: {
        library: { type: "user" },
        itemKey: "ITEM1234",
        attachmentKey,
        annotationKey,
      },
      snapshot: { text },
    },
  };
}

test("runtime load and replace methods accept canonical documents", () => {
  assert.match(
    runtimeSource,
    /applyDocument: \(value: CanvasDocument\) => void/,
  );
  assert.match(
    runtimeSource,
    /loadSnapshot: \(value: CanvasDocument\) => void/,
  );
  assert.doesNotMatch(runtimeSource, /\(value: unknown\)/);
});

test("a Literature acquisition replaces its placeholder with native keys", () => {
  const placeholder = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "literature-pending",
        kind: "item",
        position: { x: 48, y: 72 },
        width: 240,
        height: 96,
        data: { title: "Loading…" },
      },
    ],
  }).nodes;
  const resolved = runtimeModule.resolveAcademicPlaceholder(
    placeholder,
    "literature-pending",
    {
      kind: "literature",
      source: { library: { type: "user" }, itemKey: "ABCD2345" },
      snapshot: { title: "A source-key paper" },
    },
  );
  const saved = flowToCanvasDocument(resolved, [], {
    x: 0,
    y: 0,
    zoom: 1,
  });

  assert.equal(saved.nodes[0].kind, "literature");
  assert.deepEqual(
    saved.nodes[0].kind === "literature" && saved.nodes[0].source,
    { library: { type: "user" }, itemKey: "ABCD2345" },
  );
  assert.deepEqual(saved.nodes[0].position, { x: 48, y: 72 });
  assert.equal(JSON.stringify(saved).includes("itemID"), false);
});

test("standalone and child Zotero Notes replace generic acquisition placeholders", () => {
  const placeholder = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "note-pending",
        kind: "item",
        position: { x: 48, y: 72 },
        width: 240,
        height: 96,
        data: { title: "Loading…" },
      },
    ],
  }).nodes;
  const standalone = runtimeModule.resolveAcademicPlaceholder(
    placeholder,
    "note-pending",
    {
      kind: "note",
      source: { library: { type: "user" }, noteKey: "NOTE1234" },
      sourceSnapshot: { title: "Standalone" },
      content: "Standalone text",
    },
  );
  const child = runtimeModule.resolveAcademicPlaceholder(
    placeholder,
    "note-pending",
    {
      kind: "note",
      source: {
        library: { type: "group", groupID: 5 },
        noteKey: "NOTE5678",
        itemKey: "ITEM1234",
      },
      sourceSnapshot: { title: "Child Note" },
      content: "Child text",
    },
  );

  assert.equal(standalone?.[0].data.model.kind, "note");
  assert.deepEqual(standalone?.[0].data.model, {
    id: "note-pending",
    kind: "note",
    position: { x: 48, y: 72 },
    width: 260,
    height: 152,
    source: { library: { type: "user" }, noteKey: "NOTE1234" },
    sourceSnapshot: { title: "Standalone" },
    content: "Standalone text",
  });
  assert.equal(child?.[0].data.model.kind, "note");
  assert.deepEqual(
    child?.[0].data.model.kind === "note" && child[0].data.model.source,
    {
      library: { type: "group", groupID: 5 },
      noteKey: "NOTE5678",
      itemKey: "ITEM1234",
    },
  );
});

test("background Note resolution updates source title without overwriting local content", () => {
  const [node] = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "note-1",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Local edit",
        source: { library: { type: "user" }, noteKey: "NOTE1234" },
        sourceSnapshot: { title: "Old title" },
      },
    ],
  }).nodes;

  const afterBackgroundResolution = applyResolvedAcquisition(node, {
    kind: "note",
    source: { library: { type: "user" }, noteKey: "NOTE1234" },
    sourceSnapshot: { title: "Current title" },
    content: "Current Zotero text",
  }).data.model;

  assert.equal(
    afterBackgroundResolution.kind === "note" &&
      afterBackgroundResolution.content,
    "Local edit",
  );
  assert.deepEqual(
    afterBackgroundResolution.kind === "note" &&
      afterBackgroundResolution.sourceSnapshot,
    { title: "Current title" },
  );
});

test("selected annotations become one undoable Quote batch without automatic connections", () => {
  const existing = annotationCandidate("PDF-A", "SAME-KEY", "Existing");
  const first = annotationCandidate("PDF-B", "SAME-KEY", "First");
  const duplicateFirst = annotationCandidate(
    "PDF-B",
    "SAME-KEY",
    "Duplicate payload",
  );
  const second = annotationCandidate("PDF-B", "SECOND", "Second");
  let live: CanvasDocument = {
    ...academicDocument(),
    nodes: [
      ...academicDocument().nodes,
      {
        id: "existing-quote",
        kind: "quote",
        position: { x: 400, y: 36 },
        width: 280,
        height: 192,
        source: existing.acquisition.source,
        snapshot: existing.acquisition.snapshot,
      },
    ],
  };
  const before = structuredClone(live);
  const changes: number[] = [];
  const history = new CanvasDocumentHistory((revision) =>
    changes.push(revision),
  );
  const ids = ["quote-added-1", "quote-added-2"];
  const batch = createQuoteBatchRuntime({
    getWorkingDocument: () => live,
    getHistoryDocument: () => live,
    applyDocument: (document) => {
      live = document;
    },
    commitHistory: (document) => history.commit(document),
    createNodeId: () => ids.shift()!,
  });
  const selected = new Set(
    [first, duplicateFirst, second].map((candidate) =>
      quoteSourceIdentity(candidate.acquisition.source),
    ),
  );

  const addedNodeIds = batch.add(
    "literature-1",
    [existing, first, duplicateFirst, second],
    selected,
  );

  assert.deepEqual(addedNodeIds, ["quote-added-1", "quote-added-2"]);
  assert.equal(live.nodes.filter((node) => node.kind === "quote").length, 3);
  assert.deepEqual(
    live.nodes
      .filter((node) => addedNodeIds.includes(node.id))
      .map((node) => ({
        kind: node.kind,
        position: node.position,
        source: node.kind === "quote" ? node.source : undefined,
        snapshot: node.kind === "quote" ? node.snapshot : undefined,
      })),
    [
      {
        kind: "quote",
        position: { x: 328, y: 252 },
        source: first.acquisition.source,
        snapshot: { text: "First" },
      },
      {
        kind: "quote",
        position: { x: 632, y: 252 },
        source: second.acquisition.source,
        snapshot: { text: "Second" },
      },
    ],
  );
  assert.deepEqual(live.connections, before.connections);
  assert.equal(JSON.stringify(live).includes("attachmentTitle"), false);
  assert.equal(JSON.stringify(live).includes("sortIndex"), false);
  assert.equal(history.revision, 1);
  assert.deepEqual(changes, [1]);

  const undone = history.undo(live);
  assert.deepEqual(undone, before);
  assert.equal(history.undo(undone!), undefined);
});

test("an empty or duplicate-only Quote batch creates no history or save revision", () => {
  const existing = annotationCandidate("PDF-A", "SAME-KEY", "Existing");
  let live: CanvasDocument = {
    ...academicDocument(),
    nodes: [
      ...academicDocument().nodes,
      {
        id: "existing-quote",
        kind: "quote",
        position: { x: 400, y: 36 },
        width: 280,
        height: 192,
        source: existing.acquisition.source,
        snapshot: existing.acquisition.snapshot,
      },
    ],
  };
  const changes: number[] = [];
  const history = new CanvasDocumentHistory((revision) =>
    changes.push(revision),
  );
  const batch = createQuoteBatchRuntime({
    getWorkingDocument: () => live,
    getHistoryDocument: () => live,
    applyDocument: (document) => {
      live = document;
    },
    commitHistory: (document) => history.commit(document),
    createNodeId: () => "must-not-be-created",
  });

  assert.deepEqual(
    batch.add(
      "literature-1",
      [existing, existing],
      new Set([quoteSourceIdentity(existing.acquisition.source)]),
    ),
    [],
  );
  assert.equal(history.revision, 0);
  assert.deepEqual(changes, []);
});

test("explicit Quote refresh changes the save revision once without adding undo history", () => {
  const quote = annotationCandidate("PDF-A", "ANN-A", "Persisted excerpt");
  let nodes = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "quote-1",
        kind: "quote",
        position: { x: 10, y: 20 },
        width: 280,
        height: 192,
        source: quote.acquisition.source,
        snapshot: quote.acquisition.snapshot,
      },
    ],
  }).nodes;
  const changes: number[] = [];
  const history = new CanvasDocumentHistory((revision) =>
    changes.push(revision),
  );
  const refresh = createSourceRefreshRuntime({
    getNodes: () => nodes,
    applyResolutionBatch: (generation, results) => {
      nodes = applySourceResolutionResults(nodes, generation, results);
    },
    changed: () => history.changed(),
  });
  const descriptor = refresh.request(nodes[0]);
  assert.deepEqual(descriptor, {
    nodeId: "quote-1",
    source: { kind: "quote", source: quote.acquisition.source },
  });

  refresh.apply(3, [
    {
      nodeId: "quote-1",
      generation: 3,
      status: "resolved",
      acquisition: {
        ...quote.acquisition,
        snapshot: { text: "Current Zotero excerpt", pageLabel: "14" },
      },
    },
  ]);

  assert.equal(
    nodes[0].data.model.kind === "quote" && nodes[0].data.model.snapshot.text,
    "Current Zotero excerpt",
  );
  assert.equal(history.revision, 1);
  assert.deepEqual(changes, [1]);
  assert.equal(
    history.undo(flowToCanvasDocument(nodes, [], { x: 0, y: 0, zoom: 1 })),
    undefined,
    "refresh must not create an undo entry",
  );

  refresh.request(nodes[0]);
  refresh.apply(3, [
    {
      nodeId: "quote-1",
      generation: 3,
      status: "resolved",
      acquisition: {
        ...quote.acquisition,
        snapshot: { text: "Current Zotero excerpt", pageLabel: "14" },
      },
    },
  ]);
  refresh.request(nodes[0]);
  refresh.apply(3, [
    {
      nodeId: "quote-1",
      generation: 3,
      status: "unavailable",
      code: "item-missing",
      message: "Missing",
    },
  ]);
  assert.equal(history.revision, 1);
  assert.deepEqual(changes, [1]);
});

test("background Quote resolution stays outside save and undo history", () => {
  const quote = annotationCandidate("PDF-A", "ANN-A", "Persisted excerpt");
  let nodes = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "quote-1",
        kind: "quote",
        position: { x: 10, y: 20 },
        width: 280,
        height: 192,
        source: quote.acquisition.source,
        snapshot: quote.acquisition.snapshot,
      },
    ],
  }).nodes;
  const history = new CanvasDocumentHistory(() =>
    assert.fail("background resolution must not change save history"),
  );
  const refresh = createSourceRefreshRuntime({
    getNodes: () => nodes,
    applyResolutionBatch: (generation, results) => {
      nodes = applySourceResolutionResults(nodes, generation, results);
    },
    changed: () => history.changed(),
  });

  refresh.apply(5, [
    {
      nodeId: "quote-1",
      generation: 5,
      status: "resolved",
      acquisition: {
        ...quote.acquisition,
        snapshot: { text: "Background excerpt" },
      },
    },
  ]);

  assert.equal(
    nodes[0].data.model.kind === "quote" && nodes[0].data.model.snapshot.text,
    "Background excerpt",
  );
  assert.equal(history.revision, 0);
});

test("background source snapshots rebase both undo and redo while preserving geometry", () => {
  const initial: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "literature-1",
        kind: "literature",
        position: { x: 10, y: 20 },
        width: 280,
        height: 200,
        source: { library: { type: "user" }, itemKey: "ITEM" },
        snapshot: { title: "Persisted paper", annotationCount: 9 },
      },
      {
        id: "quote-1",
        kind: "quote",
        position: { x: 330, y: 20 },
        width: 280,
        height: 192,
        source: {
          library: { type: "user" },
          itemKey: "ITEM",
          attachmentKey: "PDF",
          annotationKey: "ANNOTATION",
        },
        snapshot: { text: "Persisted quote" },
      },
    ],
  };
  const edited: CanvasDocument = {
    ...initial,
    nodes: initial.nodes.map((node) =>
      node.id === "literature-1"
        ? { ...node, position: { x: 80, y: 90 } }
        : { ...node, position: { x: 420, y: 90 } },
    ),
  };
  const firstResults = [
    {
      nodeId: "literature-1",
      generation: 7,
      status: "resolved" as const,
      acquisition: {
        kind: "literature" as const,
        source: { library: { type: "user" as const }, itemKey: "ITEM" },
        snapshot: { title: "First current paper" },
      },
    },
    {
      nodeId: "quote-1",
      generation: 7,
      status: "resolved" as const,
      acquisition: {
        kind: "quote" as const,
        source: {
          library: { type: "user" as const },
          itemKey: "ITEM",
          attachmentKey: "PDF",
          annotationKey: "ANNOTATION",
        },
        snapshot: { text: "First current quote" },
      },
    },
  ];
  let runtime: CanvasDocumentRuntime | undefined;
  const revisions: number[] = [];

  function Harness() {
    runtime = useCanvasDocumentRuntime(
      initial,
      (revision) => revisions.push(revision),
      () => {},
    );
    return null;
  }

  renderToStaticMarkup(createElement(Harness));
  assert.ok(runtime);
  runtime.pushHistory();
  runtime.applyDocument(edited);
  runtime.applySourceResolutionBatch(7, firstResults);
  assert.equal(
    runtime.getSnapshot().nodes[0].kind === "literature" &&
      runtime.getSnapshot().nodes[0].snapshot.annotationCount,
    9,
  );
  assert.deepEqual(revisions, []);

  runtime.undo();
  let snapshot = runtime.getSnapshot();
  assert.deepEqual(snapshot.nodes[0].position, { x: 10, y: 20 });
  assert.equal(
    snapshot.nodes[0].kind === "literature" && snapshot.nodes[0].snapshot.title,
    "First current paper",
  );
  assert.equal(
    snapshot.nodes[0].kind === "literature" &&
      snapshot.nodes[0].snapshot.annotationCount,
    9,
  );
  assert.equal(
    snapshot.nodes[1].kind === "quote" && snapshot.nodes[1].snapshot.text,
    "First current quote",
  );

  runtime.applySourceResolutionBatch(7, [
    {
      ...firstResults[0],
      acquisition: {
        ...firstResults[0].acquisition,
        snapshot: { title: "Second current paper" },
      },
    },
    {
      ...firstResults[1],
      acquisition: {
        ...firstResults[1].acquisition,
        snapshot: { text: "Second current quote" },
      },
    },
  ]);
  runtime.redo();
  snapshot = runtime.getSnapshot();
  assert.deepEqual(snapshot.nodes[0].position, { x: 80, y: 90 });
  assert.equal(
    snapshot.nodes[0].kind === "literature" && snapshot.nodes[0].snapshot.title,
    "Second current paper",
  );
  assert.equal(
    snapshot.nodes[1].kind === "quote" && snapshot.nodes[1].snapshot.text,
    "Second current quote",
  );
  assert.deepEqual(revisions, [1, 2]);
});

test("background Note titles rebase undo and redo without rebasing local content", () => {
  const targetSource = {
    library: { type: "user" as const },
    noteKey: "TARGET-NOTE",
  };
  const otherSource = {
    library: { type: "group" as const, groupID: 7 },
    itemKey: "OTHER-ITEM",
    noteKey: "OTHER-NOTE",
  };
  const initial: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "target-note",
        kind: "note",
        position: { x: 10, y: 20 },
        width: 260,
        height: 152,
        source: targetSource,
        sourceSnapshot: { title: "Old target title" },
        content: "Local target content",
      },
      {
        id: "other-note",
        kind: "note",
        position: { x: 310, y: 20 },
        width: 260,
        height: 152,
        source: otherSource,
        sourceSnapshot: { title: "Old other title" },
        content: "Local other content",
      },
    ],
  };
  const edited: CanvasDocument = {
    ...initial,
    nodes: initial.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + 70, y: 90 },
    })),
  };
  const targetResult = {
    nodeId: "target-note",
    generation: 12,
    status: "resolved" as const,
    acquisition: {
      kind: "note" as const,
      source: targetSource,
      sourceSnapshot: { title: "Current target title" },
      content: "Remote content must not replace the local copy",
    },
  };
  const mismatchedResult = {
    nodeId: "other-note",
    generation: 12,
    status: "resolved" as const,
    acquisition: {
      kind: "note" as const,
      source: targetSource,
      sourceSnapshot: { title: "Cross-source title" },
      content: "Cross-source content",
    },
  };
  const revisions: number[] = [];
  let runtime: CanvasDocumentRuntime | undefined;

  function Harness() {
    runtime = useCanvasDocumentRuntime(
      initial,
      (revision) => revisions.push(revision),
      () => {},
    );
    return null;
  }

  renderToStaticMarkup(createElement(Harness));
  assert.ok(runtime);
  runtime.pushHistory();
  runtime.applyDocument(edited);
  runtime.applySourceResolutionBatch(12, [targetResult, mismatchedResult]);
  assert.deepEqual(revisions, []);

  runtime.undo();
  let snapshot = runtime.getSnapshot();
  assert.deepEqual(snapshot.nodes[0].position, { x: 10, y: 20 });
  assert.deepEqual(
    snapshot.nodes[0].kind === "note" && snapshot.nodes[0].sourceSnapshot,
    { title: "Current target title" },
  );
  assert.equal(
    snapshot.nodes[0].kind === "note" && snapshot.nodes[0].content,
    "Local target content",
  );
  assert.deepEqual(
    snapshot.nodes[1].kind === "note" && snapshot.nodes[1].sourceSnapshot,
    { title: "Old other title" },
  );
  assert.equal(
    snapshot.nodes[1].kind === "note" && snapshot.nodes[1].content,
    "Local other content",
  );

  runtime.applySourceResolutionBatch(12, [
    {
      ...targetResult,
      acquisition: {
        ...targetResult.acquisition,
        sourceSnapshot: { title: "Newest target title" },
        content: "A second remote body that must stay ignored",
      },
    },
    mismatchedResult,
  ]);
  runtime.redo();
  snapshot = runtime.getSnapshot();
  assert.deepEqual(snapshot.nodes[0].position, { x: 80, y: 90 });
  assert.deepEqual(
    snapshot.nodes[0].kind === "note" && snapshot.nodes[0].sourceSnapshot,
    { title: "Newest target title" },
  );
  assert.equal(
    snapshot.nodes[0].kind === "note" && snapshot.nodes[0].content,
    "Local target content",
  );
  assert.deepEqual(snapshot.nodes[1].position, { x: 380, y: 90 });
  assert.deepEqual(
    snapshot.nodes[1].kind === "note" && snapshot.nodes[1].sourceSnapshot,
    { title: "Old other title" },
  );
  assert.equal(
    snapshot.nodes[1].kind === "note" && snapshot.nodes[1].content,
    "Local other content",
  );
  assert.deepEqual(revisions, [1, 2]);
});

test("an explicit multi-source refresh dirties once without adding an undo entry", () => {
  const literatureSource = {
    library: { type: "user" as const },
    itemKey: "ITEM",
  };
  const quoteSource = {
    ...literatureSource,
    attachmentKey: "PDF",
    annotationKey: "ANNOTATION",
  };
  const initial: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "literature-1",
        kind: "literature",
        position: { x: 0, y: 0 },
        width: 280,
        height: 200,
        source: literatureSource,
        snapshot: { title: "Old paper", annotationCount: 4 },
      },
      {
        id: "quote-1",
        kind: "quote",
        position: { x: 320, y: 0 },
        width: 280,
        height: 192,
        source: quoteSource,
        snapshot: { text: "Old quote" },
      },
    ],
  };
  const edited: CanvasDocument = {
    ...initial,
    nodes: initial.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x, y: 64 },
    })),
  };
  const revisions: number[] = [];
  let runtime: CanvasDocumentRuntime | undefined;

  function Harness() {
    runtime = useCanvasDocumentRuntime(
      initial,
      (revision) => revisions.push(revision),
      () => {},
    );
    return null;
  }

  renderToStaticMarkup(createElement(Harness));
  assert.ok(runtime);
  runtime.pushHistory();
  runtime.applyDocument(edited);
  const refresh = createSourceRefreshRuntime({
    getNodes: () => runtime!.nodesRef.current,
    applyResolutionBatch: runtime.applySourceResolutionBatch,
    changed: runtime.changed,
  });
  assert.ok(refresh.request(runtime.nodesRef.current[0]));
  assert.ok(refresh.request(runtime.nodesRef.current[1]));
  refresh.apply(3, [
    {
      nodeId: "literature-1",
      generation: 3,
      status: "resolved",
      acquisition: {
        kind: "literature",
        source: literatureSource,
        snapshot: { title: "Current paper" },
      },
    },
    {
      nodeId: "quote-1",
      generation: 3,
      status: "resolved",
      acquisition: {
        kind: "quote",
        source: quoteSource,
        snapshot: { text: "Current quote" },
      },
    },
  ]);

  assert.deepEqual(revisions, [1]);
  runtime.undo();
  const undone = runtime.getSnapshot();
  assert.deepEqual(undone.nodes[0].position, { x: 0, y: 0 });
  assert.equal(
    undone.nodes[0].kind === "literature" && undone.nodes[0].snapshot.title,
    "Current paper",
  );
  assert.equal(
    undone.nodes[0].kind === "literature" &&
      undone.nodes[0].snapshot.annotationCount,
    4,
  );
  assert.equal(
    undone.nodes[1].kind === "quote" && undone.nodes[1].snapshot.text,
    "Current quote",
  );
  runtime.redo();
  assert.deepEqual(runtime.getSnapshot().nodes[0].position, { x: 0, y: 64 });
});

test("successful and partial annotation listings update only the originating Literature count", () => {
  const source = {
    library: { type: "user" as const },
    itemKey: "ITEM",
  };
  const initial: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "origin",
        kind: "literature",
        position: { x: 0, y: 0 },
        width: 280,
        height: 200,
        source,
        snapshot: { title: "Paper", annotationCount: 8 },
      },
      {
        id: "duplicate-placement",
        kind: "literature",
        position: { x: 320, y: 0 },
        width: 280,
        height: 200,
        source,
        snapshot: { title: "Paper copy", annotationCount: 8 },
      },
    ],
  };
  const revisions: number[] = [];
  let runtime: CanvasDocumentRuntime | undefined;

  function Harness() {
    runtime = useCanvasDocumentRuntime(
      initial,
      (revision) => revisions.push(revision),
      () => {},
    );
    return null;
  }

  renderToStaticMarkup(createElement(Harness));
  assert.ok(runtime);
  runtime.pushHistory();
  runtime.applyDocument({
    ...initial,
    nodes: initial.nodes.map((node) =>
      node.id === "origin" ? { ...node, position: { x: 20, y: 30 } } : node,
    ),
  });
  runtime.applyLiteratureAnnotationCount("origin", source, 3);
  let snapshot = runtime.getSnapshot();
  assert.equal(
    snapshot.nodes[0].kind === "literature" &&
      snapshot.nodes[0].snapshot.annotationCount,
    3,
  );
  assert.equal(
    snapshot.nodes[1].kind === "literature" &&
      snapshot.nodes[1].snapshot.annotationCount,
    8,
  );
  assert.deepEqual(revisions, []);

  runtime.undo();
  snapshot = runtime.getSnapshot();
  assert.deepEqual(snapshot.nodes[0].position, { x: 0, y: 0 });
  assert.equal(
    snapshot.nodes[0].kind === "literature" &&
      snapshot.nodes[0].snapshot.annotationCount,
    3,
  );
  runtime.redo();
  assert.equal(
    runtime.getSnapshot().nodes[0].kind === "literature" &&
      runtime.getSnapshot().nodes[0].snapshot.annotationCount,
    3,
  );

  const applyListing = callbackSource("applyAnnotationCandidates") ?? "";
  const rejectListing = callbackSource("rejectAnnotationList") ?? "";
  assert.match(applyListing, /applyLiteratureAnnotationCount/);
  assert.match(applyListing, /candidates\.length/);
  assert.doesNotMatch(rejectListing, /applyLiteratureAnnotationCount/);
});

test("only source-backed Notes expose refresh in properties", () => {
  const makeNode = (source: boolean) =>
    canvasDocumentToFlow({
      ...EMPTY,
      nodes: [
        {
          id: source ? "source-note" : "local-note",
          kind: "note",
          position: { x: 0, y: 0 },
          width: 260,
          height: 152,
          content: "Note",
          ...(source
            ? {
                source: {
                  library: { type: "user" as const },
                  noteKey: "NOTE1234",
                },
              }
            : {}),
        },
      ],
    }).nodes[0];
  const actions = (node: ReturnType<typeof makeNode>) =>
    renderToStaticMarkup(
      createElement(PropertiesPanel, {
        labels: { ...({} as WhiteboardLabels), ...noteActionLabels },
        node,
        sourceState: { status: "resolved" },
        onOpen: () => undefined,
        onRefreshSource: () => undefined,
        onViewAnnotations: () => undefined,
        onCopy: () => undefined,
        onDelete: () => undefined,
      }),
    );

  const localNoteActions = actions(makeNode(false));
  const sourceNoteActions = actions(makeNode(true));
  assert.equal(localNoteActions.includes("Refresh from Zotero"), false);
  assert.equal(sourceNoteActions.includes("Refresh from Zotero"), true);
  assert.equal(sourceNoteActions.includes("Source status"), true);
  assert.equal(sourceNoteActions.includes("Available"), true);
  assert.equal(
    sourceNoteActions.includes('aria-label="Current selection"'),
    true,
  );
  const unavailable = renderToStaticMarkup(
    createElement(PropertiesPanel, {
      labels: { ...({} as WhiteboardLabels), ...noteActionLabels },
      node: makeNode(true),
      sourceState: { status: "unavailable", message: "Item missing" },
      onOpen: () => undefined,
      onRefreshSource: () => undefined,
      onViewAnnotations: () => undefined,
      onCopy: () => undefined,
      onDelete: () => undefined,
    }),
  );
  assert.equal(unavailable.includes("Source unavailable"), true);
  assert.equal(unavailable.includes('title="Item missing"'), false);
});

test("source-backed properties distinguish every transient source state", () => {
  const node = canvasDocumentToFlow(academicDocument()).nodes[0];
  const markup = (
    sourceState:
      | { status: "idle" | "loading" | "resolved" }
      | { status: "unavailable"; message: string },
  ) =>
    renderToStaticMarkup(
      createElement(PropertiesPanel, {
        labels: { ...({} as WhiteboardLabels), ...noteActionLabels },
        node,
        sourceState,
        onOpen: () => undefined,
        onRefreshSource: () => undefined,
        onViewAnnotations: () => undefined,
        onCopy: () => undefined,
        onDelete: () => undefined,
      }),
    );

  assert.match(markup({ status: "idle" }), /data-source-status="idle"/);
  assert.match(markup({ status: "idle" }), /Not checked/);
  assert.match(markup({ status: "loading" }), /data-source-status="loading"/);
  assert.match(markup({ status: "loading" }), /Checking/);
  assert.match(markup({ status: "resolved" }), /data-source-status="resolved"/);
  assert.match(markup({ status: "resolved" }), /Available/);
  assert.match(
    markup({ status: "unavailable", message: "Source was deleted" }),
    /data-source-status="unavailable"/,
  );
  assert.match(
    markup({ status: "unavailable", message: "Source was deleted" }),
    /A paper/,
    "availability must not replace the persisted snapshot title",
  );
});

test("source action failures are rendered inside the nonblocking canvas UI", () => {
  assert.match(appSource, /className="zmd-board-notice/);
  assert.match(appSource, /role="status"/);
  assert.match(appSource, /aria-live="polite"/);
  assert.match(
    appSource,
    /rejectSourceAction\(requestId, nodeId, source, failure\)/,
  );
  assert.match(canvasCss, /\.zmd-board-notice/);
  assert.doesNotMatch(
    canvasCss,
    /\.zmd-board-notice\s*\{[^}]*pointer-events:\s*none/s,
  );
  assert.match(appSource, /CanvasNoticeRegion/);
  assert.match(appSource, /failureCode:\s*failure\.code/);
  assert.match(
    callbackSource("applySourceResolutionBatch") ?? "",
    /showCanvasNotice/,
    "an explicit refresh failure must surface in the canvas",
  );
  assert.match(
    callbackSource("rejectAnnotationList") ?? "",
    /showCanvasNotice/,
    "an annotation failure must surface in the canvas as well as its dialog",
  );
});

test("open action correlation makes stale request/source replies completely inert", async () => {
  const module =
    (await import("../packages/whiteboard/src/whiteboard/sourceState.ts")) as typeof import("../packages/whiteboard/src/whiteboard/sourceState.ts") & {
      createSourceActionCorrelation?: () => {
        begin(
          requestId: string,
          nodeId: string,
          source: ReturnType<typeof sourceDescriptor>,
        ): void;
        accept(
          requestId: string,
          nodeId: string,
          source: ReturnType<typeof sourceDescriptor>,
        ): boolean;
        clear(): void;
      };
    };
  assert.equal(typeof module.createSourceActionCorrelation, "function");
  const correlation = module.createSourceActionCorrelation!();
  const first = {
    kind: "literature" as const,
    source: { library: { type: "user" as const }, itemKey: "FIRST123" },
  };
  const other = {
    kind: "literature" as const,
    source: { library: { type: "user" as const }, itemKey: "OTHER123" },
  };
  correlation.begin("request-1", "node-1", first);
  assert.equal(correlation.accept("request-old", "node-1", first), false);
  assert.equal(correlation.accept("request-1", "node-1", other), false);
  assert.equal(correlation.accept("request-1", "node-1", first), true);
  assert.equal(
    correlation.accept("request-1", "node-1", first),
    false,
    "a duplicate late success is inert after the correlated request is removed",
  );
  correlation.begin("request-2", "node-1", first);
  correlation.clear();
  assert.equal(
    correlation.accept("request-2", "node-1", first),
    false,
    "document replacement/unmount clears pending opens",
  );
});

test("annotation failure correlation precedes every canvas-visible notice", () => {
  const callback = callbackSource("rejectAnnotationList") ?? "";
  assert.ok(callback.indexOf("acceptAnnotationListFailure") >= 0);
  assert.ok(callback.indexOf("showCanvasNotice") >= 0);
  assert.ok(
    callback.indexOf("acceptAnnotationListFailure") <
      callback.indexOf("showCanvasNotice"),
    "closed, replaced, request-mismatched, and source-mismatched replies must be inert",
  );
});

test("canvas notices never render raw host diagnostic messages", () => {
  assert.doesNotMatch(appSource, /message:\s*failure\.message/);
  assert.doesNotMatch(appSource, /message:\s*failedRefresh\.message/);
  assert.doesNotMatch(appSource, /failure\.message/);
  assert.match(appSource, /function CanvasNoticeRegion/);
  assert.match(appSource, /clearTimeout/);
});

test("Literature and Quote properties expose native source open and refresh actions", () => {
  const literature = canvasDocumentToFlow(academicDocument()).nodes[0];
  const quote = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "quote-1",
        kind: "quote",
        position: { x: 0, y: 0 },
        width: 280,
        height: 192,
        source: {
          library: { type: "user" },
          itemKey: "ITEM1234",
          attachmentKey: "PDF12345",
          annotationKey: "ANN12345",
        },
        snapshot: { text: "Evidence" },
      },
    ],
  }).nodes[0];
  const renderActions = (node: typeof literature) =>
    renderToStaticMarkup(
      createElement(PropertiesPanel, {
        labels: { ...({} as WhiteboardLabels), ...noteActionLabels },
        node,
        sourceState: { status: "resolved" },
        onOpen: () => undefined,
        onRefreshSource: () => undefined,
        onViewAnnotations: () => undefined,
        onCopy: () => undefined,
        onDelete: () => undefined,
      }),
    );

  for (const markup of [renderActions(literature), renderActions(quote)]) {
    assert.equal(markup.includes("Open source"), true);
    assert.equal(markup.includes("Refresh source"), true);
    assert.equal(markup.includes("Open item"), false);
  }
});

test("context-menu open copy distinguishes source-backed and retained Basic nodes", () => {
  const menuMarkup = appSource.slice(
    appSource.indexOf('className="zmd-board-context-menu"'),
    appSource.indexOf("{toolbarNode && toolbarScreen"),
  );
  assert.match(menuMarkup, /sourceDescriptor\(menuNode\.data\.model\)/);
  assert.match(menuMarkup, /labels\.openSource/);
  assert.match(menuMarkup, /labels\.openItem/);
});

test("cancelled Note refresh posts nothing and uses the localized warning once", () => {
  const [node] = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "source-note",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Local edit",
        source: { library: { type: "user" }, noteKey: "NOTE1234" },
      },
    ],
  }).nodes;
  const warnings: string[] = [];
  const requests: unknown[] = [];

  const requested = requestConfirmedNoteRefresh(
    node,
    noteActionLabels,
    (warning) => {
      warnings.push(warning);
      return false;
    },
    (...args) => requests.push(args),
    () => "refresh-1",
  );

  assert.equal(requested, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Replace local Note\?/);
  assert.match(warnings[0], /Local changes will be lost\./);
  assert.deepEqual(requests, []);
});

test("confirmed Note refresh posts one correlated source request", () => {
  const [node] = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "source-note",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Local edit",
        source: {
          library: { type: "group", groupID: 5 },
          noteKey: "NOTE1234",
          itemKey: "ITEM1234",
        },
      },
    ],
  }).nodes;
  const requests: unknown[] = [];

  const requestId = requestConfirmedNoteRefresh(
    node,
    noteActionLabels,
    () => true,
    (...args) => requests.push(args),
    () => "refresh-1",
  );

  assert.equal(requestId, "refresh-1");
  assert.deepEqual(requests, [
    [
      "refresh-1",
      "source-note",
      {
        library: { type: "group", groupID: 5 },
        noteKey: "NOTE1234",
        itemKey: "ITEM1234",
      },
    ],
  ]);
});

test("confirmed Note refresh overwrites content and title in one undoable revision", () => {
  let live: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "source-note",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Local edit",
        source: { library: { type: "user" }, noteKey: "NOTE1234" },
        sourceSnapshot: { title: "Old title" },
      },
    ],
  };
  const changes: number[] = [];
  const history = new CanvasDocumentHistory((revision) =>
    changes.push(revision),
  );
  const refresh = createNoteRefreshRuntime({
    getWorkingDocument: () => live,
    getHistoryDocument: () => live,
    applyDocument: (document) => {
      live = document;
    },
    commitHistory: (document) => history.commit(document),
    confirm: () => true,
    request: () => undefined,
    onError: () => assert.fail("unexpected refresh error"),
    createRequestId: () => "refresh-1",
  });
  const [node] = canvasDocumentToFlow(live).nodes;

  assert.equal(refresh.request(node, noteActionLabels), "refresh-1");
  assert.equal(
    refresh.resolve("refresh-1", "source-note", {
      kind: "note",
      source: { library: { type: "user" }, noteKey: "NOTE1234" },
      sourceSnapshot: { title: "Current title" },
      content: "Current Zotero text",
    }),
    true,
  );

  const refreshed = live.nodes[0];
  assert.equal(
    refreshed.kind === "note" && refreshed.content,
    "Current Zotero text",
  );
  assert.deepEqual(refreshed.kind === "note" && refreshed.sourceSnapshot, {
    title: "Current title",
  });
  assert.deepEqual(changes, [1]);
  const afterUndo = history.undo(live);
  assert.equal(
    afterUndo?.nodes[0].kind === "note" && afterUndo.nodes[0].content,
    "Local edit",
  );
  assert.deepEqual(changes, [1, 2]);
});

test("reversed same-Note refresh replies apply only the latest confirmed request", () => {
  let live: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "source-note",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Local edit",
        source: { library: { type: "user" }, noteKey: "NOTE1234" },
      },
    ],
  };
  const changes: number[] = [];
  const history = new CanvasDocumentHistory((revision) =>
    changes.push(revision),
  );
  const requestIds = ["refresh-old", "refresh-new"];
  const refresh = createNoteRefreshRuntime({
    getWorkingDocument: () => live,
    getHistoryDocument: () => live,
    applyDocument: (document) => {
      live = document;
    },
    commitHistory: (document) => history.commit(document),
    confirm: () => true,
    request: () => undefined,
    onError: () => assert.fail("unexpected refresh error"),
    createRequestId: () => requestIds.shift()!,
  });
  const [node] = canvasDocumentToFlow(live).nodes;

  assert.equal(refresh.request(node, noteActionLabels), "refresh-old");
  assert.equal(refresh.request(node, noteActionLabels), "refresh-new");
  assert.equal(
    refresh.resolve("refresh-new", "source-note", {
      kind: "note",
      source: { library: { type: "user" }, noteKey: "NOTE1234" },
      content: "Newer Zotero text",
    }),
    true,
  );
  assert.equal(
    refresh.resolve("refresh-old", "source-note", {
      kind: "note",
      source: { library: { type: "user" }, noteKey: "NOTE1234" },
      content: "Older Zotero text",
    }),
    false,
  );

  assert.equal(
    live.nodes[0].kind === "note" && live.nodes[0].content,
    "Newer Zotero text",
  );
  assert.deepEqual(changes, [1]);
  const previous = history.undo(live);
  assert.equal(
    previous?.nodes[0].kind === "note" && previous.nodes[0].content,
    "Local edit",
  );
});

test("Note refresh preserves a pending acquisition until its later reply resolves", () => {
  const initial: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "source-note",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Local edit",
        source: { library: { type: "user" }, noteKey: "NOTE1234" },
      },
    ],
  };
  let { nodes, edges } = canvasDocumentToFlow(initial);
  const history = new CanvasDocumentHistory(() => undefined);
  const liveDocument = () =>
    flowToCanvasDocument(nodes, edges, { x: 0, y: 0, zoom: 1 });
  const canonicalDocument = () =>
    runtimeModule.omitAcademicPlaceholders(
      liveDocument(),
      acquisition.pendingNodeIds(),
    );
  const acquisition = createAcademicAcquisitionRuntime({
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next;
    },
    getEdges: () => edges,
    setEdges: (next) => {
      edges = next;
    },
    pushHistory: () => history.push(canonicalDocument()),
    changed: () => history.changed(),
    onPickAcademicSource: () => assert.fail("unexpected picker"),
    onDropAcademicSources: () => undefined,
  });
  const refresh = createNoteRefreshRuntime({
    getWorkingDocument: liveDocument,
    getHistoryDocument: canonicalDocument,
    applyDocument: (document) => {
      const flow = canvasDocumentToFlow(document);
      nodes = flow.nodes;
      edges = flow.edges;
    },
    commitHistory: (document) => history.commit(document),
    confirm: () => true,
    request: () => undefined,
    onError: () => assert.fail("unexpected refresh error"),
    createRequestId: () => "refresh-1",
  });

  acquisition.dropLiterature("drop-1", "literature-pending", { x: 320, y: 0 }, [
    { library: { type: "user" }, itemKey: "ITEM1234" },
  ]);
  const note = nodes.find((node) => node.id === "source-note")!;
  refresh.request(note, noteActionLabels);
  assert.equal(
    refresh.resolve("refresh-1", "source-note", {
      kind: "note",
      source: { library: { type: "user" }, noteKey: "NOTE1234" },
      content: "Current Zotero text",
    }),
    true,
  );
  assert.equal(
    nodes.some((node) => node.id === "literature-pending"),
    true,
  );

  acquisition.resolveBatch(
    "drop-1",
    "literature-pending",
    [
      {
        index: 0,
        acquisition: {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: "ITEM1234" },
          snapshot: { title: "Later Literature" },
        },
      },
    ],
    [],
  );
  assert.equal(
    nodes.find((node) => node.id === "literature-pending")?.data.model.kind,
    "literature",
  );
  assert.equal(
    nodes.find((node) => node.id === "source-note")?.data.model.kind ===
      "note" &&
      nodes.find((node) => node.id === "source-note")?.data.model.content,
    "Current Zotero text",
  );
});

test("the app binds Note refresh mutation to live state and history to canonical state", () => {
  assert.match(
    appSource,
    /createNoteRefreshRuntime\(\{[\s\S]*getWorkingDocument: workingSnapshot,[\s\S]*getHistoryDocument: snapshotNow,/,
  );
  assert.doesNotMatch(
    callbackSource("applyNoteRefresh") ?? "",
    /snapshotNow\(\)/,
  );
});

test("failed or mismatched Note refresh preserves the complete document", () => {
  let live: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "source-note",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Local edit",
        source: { library: { type: "user" }, noteKey: "NOTE1234" },
      },
    ],
  };
  const changes: number[] = [];
  const errors: Array<{ message: string; nodeId: string }> = [];
  const requests = ["refresh-mismatch", "refresh-failure"];
  const refresh = createNoteRefreshRuntime({
    getWorkingDocument: () => live,
    getHistoryDocument: () => live,
    applyDocument: (document) => {
      live = document;
    },
    commitHistory: () => assert.fail("failure must not commit history"),
    confirm: () => true,
    request: () => undefined,
    onError: (message, nodeId) => errors.push({ message, nodeId }),
    createRequestId: () => requests.shift()!,
  });
  const [node] = canvasDocumentToFlow(live).nodes;
  refresh.request(node, noteActionLabels);
  assert.equal(
    refresh.resolve("refresh-mismatch", "source-note", {
      kind: "note",
      source: { library: { type: "user" }, noteKey: "OTHER123" },
      content: "Wrong source",
    }),
    false,
  );
  refresh.request(node, noteActionLabels);
  assert.equal(
    refresh.reject("refresh-failure", "source-note", "Missing"),
    true,
  );
  assert.equal(
    live.nodes[0].kind === "note" && live.nodes[0].content,
    "Local edit",
  );
  assert.deepEqual(errors, [
    { message: noteActionLabels.sourceMissing, nodeId: "source-note" },
    { message: "Missing", nodeId: "source-note" },
  ]);
  assert.deepEqual(changes, []);
});

test("the app converts a defensive Note reply mismatch into a localized canvas notice", () => {
  const binding = appSource.slice(
    appSource.indexOf("createNoteRefreshRuntime({"),
    appSource.indexOf("const noteRefreshRuntime ="),
  );
  assert.doesNotMatch(binding, /onError:\s*\(\)\s*=>\s*undefined/);
  assert.match(binding, /code:\s*"note-refresh-failed"/);
  assert.match(binding, /failureCode:\s*"note-refresh-failed"/);
});

test("a rejected Literature acquisition removes only its placeholder", () => {
  const reject = (
    runtimeModule as unknown as {
      rejectAcademicPlaceholder?: (
        nodes: ReturnType<typeof canvasDocumentToFlow>["nodes"],
        nodeId: string,
      ) => ReturnType<typeof canvasDocumentToFlow>["nodes"];
    }
  ).rejectAcademicPlaceholder;
  assert.equal(typeof reject, "function");

  const nodes = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "keep",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Keep me",
      },
      {
        id: "literature-pending",
        kind: "item",
        position: { x: 48, y: 72 },
        width: 240,
        height: 96,
        data: { title: "Loading…" },
      },
    ],
  }).nodes;

  assert.deepEqual(
    reject!(nodes, "literature-pending").map((node) => node.id),
    ["keep"],
  );
});

test("rejecting Literature also removes every incident placeholder edge", () => {
  const rejectEdges = (
    runtimeModule as unknown as {
      rejectAcademicPlaceholderConnections?: (
        edges: ReturnType<typeof canvasDocumentToFlow>["edges"],
        nodeId: string,
      ) => ReturnType<typeof canvasDocumentToFlow>["edges"];
    }
  ).rejectAcademicPlaceholderConnections;
  assert.equal(typeof rejectEdges, "function");

  const flow = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "keep",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Keep me",
      },
      {
        id: "literature-pending",
        kind: "item",
        position: { x: 48, y: 72 },
        width: 240,
        height: 96,
        data: { title: "Loading…" },
      },
    ],
    connections: [
      {
        id: "pending-edge",
        kind: "basic",
        source: "keep",
        target: "literature-pending",
      },
    ],
  });

  assert.deepEqual(
    rejectEdges!(flow.edges, "literature-pending").map((edge) => edge.id),
    [],
  );
});

test("pending Literature placeholders are omitted from canonical persistence", () => {
  const omit = (
    runtimeModule as unknown as {
      omitAcademicPlaceholders?: (
        document: CanvasDocument,
        nodeIds: Iterable<string>,
      ) => CanvasDocument;
    }
  ).omitAcademicPlaceholders;
  assert.equal(typeof omit, "function");

  const document: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "keep",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Keep me",
      },
      {
        id: "literature-pending",
        kind: "item",
        position: { x: 48, y: 72 },
        width: 240,
        height: 96,
        data: { title: "Loading…" },
      },
    ],
    connections: [
      {
        id: "pending-edge",
        kind: "basic",
        source: "keep",
        target: "literature-pending",
      },
    ],
  };

  assert.deepEqual(omit!(document, ["literature-pending"]), {
    ...EMPTY,
    nodes: [document.nodes[0]],
    connections: [],
  });
});

test("internal mutations use raw snapshots without exposing placeholders to history", () => {
  assert.match(runtimeSource, /getRawSnapshot: \(\) => CanvasDocument/);
  assert.match(runtimeSource, /history\.push\(getSnapshot\(\)\)/);
  for (const callback of [
    "applyNodePositions",
    "deleteCanvasElements",
    "beginNodeDrag",
    "beginDraw",
  ]) {
    assert.match(callbackSource(callback) ?? "", /workingSnapshot\(\)/);
  }
  assert.match(appSource, /getSnapshot: snapshotNow/);
});

test("draw cancellation keeps raw state while completed draw history stays canonical", () => {
  const begin = callbackSource("beginDraw");
  const cancel = callbackSource("cancelDraw");
  const finish = callbackSource("finishDraw");

  assert.ok(begin);
  assert.match(
    begin,
    /preDrawRef\.current = \{\s*working: workingSnapshot\(\),\s*history: snapshotNow\(\)/,
  );
  assert.ok(cancel);
  assert.match(cancel, /applyDocument\(previous\.working\)/);
  assert.ok(finish);
  assert.match(finish, /documentHistory\.push\(previous\.history\)/);
  assert.doesNotMatch(finish, /documentHistory\.push\(previous\.working\)/);
});

test("out-of-order Literature replies preserve intervening edits one undo at a time", () => {
  const omit = runtimeModule.omitAcademicPlaceholders;
  const editedNote: CanvasDocument["nodes"][number] = {
    id: "note-edited",
    kind: "note",
    position: { x: 0, y: 0 },
    width: 260,
    height: 152,
    content: "Edit completed while Zotero was open",
  };
  const pendingOne: CanvasDocument["nodes"][number] = {
    id: "pending-one",
    kind: "item",
    position: { x: 300, y: 0 },
    width: 240,
    height: 96,
    data: { title: "Loading…" },
  };
  const pendingTwo: CanvasDocument["nodes"][number] = {
    ...pendingOne,
    id: "pending-two",
    position: { x: 600, y: 0 },
  };
  const literatureOne: CanvasDocument["nodes"][number] = {
    id: "pending-one",
    kind: "literature",
    position: pendingOne.position,
    width: 280,
    height: 200,
    source: { library: { type: "user" }, itemKey: "FIRST234" },
    snapshot: { title: "First reply" },
  };
  const literatureTwo: CanvasDocument["nodes"][number] = {
    ...literatureOne,
    id: "pending-two",
    position: pendingTwo.position,
    source: { library: { type: "user" }, itemKey: "SECOND23" },
    snapshot: { title: "Second reply" },
  };
  const pending: CanvasDocument = {
    ...EMPTY,
    nodes: [editedNote, pendingOne, pendingTwo],
  };
  const beforeFirstReply = omit(pending, ["pending-one", "pending-two"]);
  const afterFirstReply: CanvasDocument = {
    ...EMPTY,
    nodes: [editedNote, literatureOne, pendingTwo],
  };
  const beforeSecondReply = omit(afterFirstReply, ["pending-two"]);
  const afterSecondReply: CanvasDocument = {
    ...EMPTY,
    nodes: [editedNote, literatureOne, literatureTwo],
  };
  const history = new CanvasDocumentHistory(() => {});

  history.push(beforeFirstReply);
  history.changed();
  history.push(beforeSecondReply);
  history.changed();

  assert.deepEqual(history.undo(afterSecondReply), beforeSecondReply);
  assert.deepEqual(history.undo(beforeSecondReply), beforeFirstReply);
  assert.equal(beforeFirstReply.nodes[0].kind, "note");
  assert.equal(
    beforeFirstReply.nodes[0].kind === "note" &&
      beforeFirstReply.nodes[0].content,
    "Edit completed while Zotero was open",
  );
});

test("Literature placement requests the academic picker and commits once", () => {
  let nodes = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "keep",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Original edit",
      },
    ],
  }).nodes;
  let edges: ReturnType<typeof canvasDocumentToFlow>["edges"] = [];
  let pushes = 0;
  let changes = 0;
  const picks: unknown[] = [];
  const history = new CanvasDocumentHistory(() => {});
  const canonical = () =>
    runtimeModule.omitAcademicPlaceholders(
      flowToCanvasDocument(nodes, edges, { x: 0, y: 0, zoom: 1 }),
      acquisitionRuntime.pendingNodeIds(),
    );
  const acquisitionRuntime = createAcademicAcquisitionRuntime({
    getNodes: () => nodes,
    setNodes: (next: typeof nodes) => {
      nodes = next;
    },
    getEdges: () => edges,
    setEdges: (next: typeof edges) => {
      edges = next;
    },
    pushHistory: () => {
      pushes += 1;
      history.push(canonical());
    },
    changed: () => {
      changes += 1;
      history.changed();
    },
    onPickAcademicSource: (...args: unknown[]) => picks.push(args),
    onDropAcademicSources: () => assert.fail("unexpected drop"),
  });

  acquisitionRuntime.placeLiterature("pick-1", "literature-pending", {
    x: 48,
    y: 72,
  });
  assert.deepEqual(picks, [["pick-1", "literature-pending", "literature"]]);
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["keep", "literature-pending"],
  );

  nodes = nodes.map((node) =>
    node.id === "keep"
      ? updateFlowNodeModel(node, (model) =>
          model.kind === "note"
            ? { ...model, content: "Intervening edit" }
            : model,
        )
      : node,
  );
  acquisitionRuntime.resolveBatch(
    "wrong-request",
    "literature-pending",
    [
      {
        index: 0,
        acquisition: {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: "IGNORED12" },
          snapshot: { title: "Ignored" },
        },
      },
    ],
    [],
  );
  acquisitionRuntime.resolveBatch(
    "pick-1",
    "literature-pending",
    [
      {
        index: 0,
        acquisition: {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: "ABCD2345" },
          snapshot: { title: "A source-key paper" },
        },
      },
    ],
    [],
  );

  const saved = flowToCanvasDocument(nodes, edges, { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(
    saved.nodes.map((node) => node.kind),
    ["note", "literature"],
  );
  assert.equal(
    saved.nodes[0].kind === "note" && saved.nodes[0].content,
    "Intervening edit",
  );
  assert.equal(pushes, 1);
  assert.equal(changes, 1);
  const previous = history.undo(saved);
  assert.equal(previous?.nodes.length, 1);
  assert.equal(
    previous?.nodes[0].kind === "note" && previous.nodes[0].content,
    "Intervening edit",
  );
  assert.equal(history.undo(previous!), undefined);

  acquisitionRuntime.resolveBatch(
    "pick-1",
    "literature-pending",
    [
      {
        index: 0,
        acquisition: {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: "DUPLICATE" },
          snapshot: { title: "Duplicate" },
        },
      },
    ],
    [],
  );
  assert.equal(pushes, 1);
});

test("correlated Literature rejection removes its placeholder and incident edges", () => {
  const flow = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "keep",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "Keep me",
      },
    ],
  });
  let nodes = flow.nodes;
  let edges = flow.edges;
  const errors: string[] = [];
  const acquisitionRuntime = createAcademicAcquisitionRuntime({
    getNodes: () => nodes,
    setNodes: (next: typeof nodes) => {
      nodes = next;
    },
    getEdges: () => edges,
    setEdges: (next: typeof edges) => {
      edges = next;
    },
    pushHistory: () => assert.fail("rejection must not push history"),
    changed: () => assert.fail("rejection must not mark a canonical change"),
    onNotice: (notice) => errors.push(notice.code),
    onPickAcademicSource: () => undefined,
    onDropAcademicSources: () => undefined,
  });

  acquisitionRuntime.placeLiterature("pick-reject", "literature-pending", {
    x: 48,
    y: 72,
  });
  edges = canvasDocumentToFlow({
    ...EMPTY,
    nodes: flowToCanvasDocument(nodes, [], { x: 0, y: 0, zoom: 1 }).nodes,
    connections: [
      {
        id: "pending-edge",
        kind: "basic",
        source: "keep",
        target: "literature-pending",
      },
    ],
  }).edges;

  acquisitionRuntime.reject("other", "literature-pending", "picker-failed");
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 1);
  acquisitionRuntime.reject(
    "pick-reject",
    "literature-pending",
    "picker-cancelled",
  );
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["keep"],
  );
  assert.deepEqual(edges, []);
  assert.deepEqual(errors, [], "user picker cancellation is silent");
});

test("canonical documents adapt to React Flow and back", () => {
  const document = academicDocument();
  const flow = canvasDocumentToFlow(document);

  assert.equal(flow.nodes[0].data.model.kind, "literature");
  assert.equal(flow.nodes[0].position.x, document.nodes[0].position.x);
  assert.equal(flow.edges[0].data?.connection.kind, "academic");

  const resized = flow.nodes.map((node, index) =>
    index === 0
      ? {
          ...node,
          position: { x: 40, y: 60 },
          measured: { width: 300, height: 150 },
        }
      : node,
  );
  const restored = flowToCanvasDocument(resized, flow.edges, {
    x: 12,
    y: -8,
    zoom: 1.25,
  });

  assert.equal(restored.version, 2);
  assert.equal(restored.nodes[0].kind, "literature");
  assert.deepEqual(restored.nodes[0].position, { x: 40, y: 60 });
  assert.equal(restored.nodes[0].width, 300);
  assert.equal(restored.nodes[0].height, 150);
  assert.equal(restored.connections[0].kind, "academic");
  assert.equal(
    restored.connections[0].kind === "academic" &&
      restored.connections[0].relation,
    "supports",
  );
  assert.equal(restored.viewport?.zoom, 1.25);
});

test("academic creation and later edits share the visible editing state", () => {
  const nodes = canvasDocumentToFlow({
    ...EMPTY,
    nodes: [
      {
        id: "question-1",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 128,
        content: "Why?",
      },
    ],
  }).nodes;
  const result = beginNodeEditing(nodes, "question-1");
  assert.deepEqual(result?.editing, {
    nodeId: "question-1",
    value: "Why?",
  });
  assert.equal(result?.nodes[0].className, "is-editing-label");
  assert.ok(
    (appSource.match(/beginNodeEditing\(/g) ?? []).length >= 2,
    "creation and explicit edit paths must use the same transition",
  );
});

test("in-shape editing exposes localized focus and hides underlying copy", () => {
  assert.match(
    appSource,
    /aria-label=\{[\s\S]*labels\.editNoteBody[\s\S]*labels\.editText/,
  );
  assert.match(
    canvasCss,
    /\.zmd-board-editor\.is-in-shape:focus-within\s*\{[^}]*box-shadow:/s,
  );
  const editorRule = canvasCss.match(
    /\.zmd-board-editor\.is-in-shape \.zmd-board-in-shape-edit,[\s\S]*?\.zmd-board-in-shape-edit\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(editorRule, "missing in-shape textarea rule");
  assert.match(editorRule, /caret-color:\s*var\(--zmd-board-text,\s*#111827\)/);
  assert.match(
    canvasCss,
    /\.react-flow__node\.is-editing-label \.zmd-board-card-body/,
  );
  assert.match(
    canvasCss,
    /\.react-flow__node\.is-editing-label \.zmd-board-frame h3/,
  );
});

test("document shell survives editing, history, and host replacement", () => {
  const loaded: CanvasDocument = {
    ...academicDocument(),
    metadata: {
      title: "Review",
      createdAt: "2026-09-03T00:00:00.000Z",
    },
    extensions: {
      plugin: { mode: "evidence", flags: ["a", "b"] },
    },
  };
  const flow = canvasDocumentToFlow(loaded);
  const editedNodes = flow.nodes.map((node) =>
    node.id === "claim-1"
      ? mergeEditingStyle(node, "Revised claim", { fontWeight: "bold" })
      : node,
  );
  const edited = flowToCanvasDocument(
    editedNodes,
    flow.edges,
    { x: 8, y: 12, zoom: 1.1 },
    flow.shell,
  );

  assert.deepEqual(edited.metadata, loaded.metadata);
  assert.deepEqual(edited.extensions, loaded.extensions);

  const replacement: CanvasDocument = {
    ...EMPTY,
    metadata: { title: "Replacement" },
    extensions: { host: { sequence: 2 } },
  };
  const replacementFlow = canvasDocumentToFlow(replacement);
  const replacementSnapshot = flowToCanvasDocument(
    replacementFlow.nodes,
    replacementFlow.edges,
    replacement.viewport!,
    replacementFlow.shell,
  );
  assert.deepEqual(replacementSnapshot.metadata, replacement.metadata);
  assert.deepEqual(replacementSnapshot.extensions, replacement.extensions);

  const history = new CanvasDocumentHistory(() => {});
  history.push(edited);
  const previous = history.undo(replacementSnapshot);
  assert.deepEqual(previous?.metadata, loaded.metadata);
  assert.deepEqual(previous?.extensions, loaded.extensions);
  const next = history.redo(edited);
  assert.deepEqual(next?.metadata, replacement.metadata);
  assert.deepEqual(next?.extensions, replacement.extensions);

  history.replace();
  assert.equal(history.undo(replacementSnapshot), undefined);
  assert.equal(history.redo(replacementSnapshot), undefined);
});

test("runtime snapshots are atomic before React commits loaded state", () => {
  const initial: CanvasDocument = {
    version: 2,
    nodes: [
      {
        id: "initial",
        kind: "note",
        position: { x: 10, y: 20 },
        width: 260,
        height: 128,
        content: "Initial",
      },
    ],
    connections: [],
    viewport: { x: 1, y: 2, zoom: 1 },
    metadata: { title: "Initial shell" },
    extensions: { generation: 1 },
  };
  const loaded: CanvasDocument = {
    version: 2,
    nodes: [
      {
        id: "loaded",
        kind: "note",
        position: { x: 30, y: 40 },
        width: 260,
        height: 128,
        content: "Loaded?",
      },
    ],
    connections: [],
    viewport: { x: 12, y: -8, zoom: 1.25 },
    metadata: { title: "Loaded shell" },
    extensions: { generation: 2 },
  };
  let runtime: CanvasDocumentRuntime | undefined;

  function Harness() {
    runtime = useCanvasDocumentRuntime(
      initial,
      () => {},
      () => {},
    );
    return null;
  }

  renderToStaticMarkup(createElement(Harness));
  assert.ok(runtime);
  runtime.loadSnapshot(loaded);

  assert.deepEqual(runtime.getSnapshot(), loaded);
});

test("runtime supports immediate consecutive undo and redo before React commits", () => {
  const first: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "first",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 260,
        height: 152,
        content: "First",
      },
    ],
    viewport: { x: 1, y: 2, zoom: 1 },
    metadata: { title: "First" },
    extensions: { revision: 1 },
  };
  const second: CanvasDocument = {
    ...EMPTY,
    nodes: [
      {
        id: "second",
        kind: "note",
        position: { x: 100, y: 120 },
        width: 260,
        height: 128,
        content: "Second",
      },
    ],
    viewport: { x: -4, y: 8, zoom: 1.5 },
    metadata: { title: "Second" },
    extensions: { revision: 2 },
  };
  let runtime: CanvasDocumentRuntime | undefined;

  function Harness() {
    runtime = useCanvasDocumentRuntime(
      first,
      () => {},
      () => {},
    );
    return null;
  }

  renderToStaticMarkup(createElement(Harness));
  assert.ok(runtime);
  runtime.pushHistory();
  runtime.applyDocument(second);

  runtime.undo();
  assert.deepEqual(runtime.getSnapshot(), first);
  runtime.redo();
  assert.deepEqual(runtime.getSnapshot(), second);
});

test("frame drag records one snapshot, moves direct members incrementally, and changes once", () => {
  const start = callbackSource("beginNodeDrag");
  const change = callbackSource("onNodesChange");
  const end = callbackSource("endFrameDrag");
  const finish = callbackSource("finishNodeDrag");

  assert.ok(start, "missing Frame-aware drag start");
  assert.equal((start.match(/pushHistory\(\)/g) ?? []).length, 1);
  assert.match(start, /draggedNodes/);
  assert.match(start, /beginFrameDragState\(/);
  assert.match(start, /draggedNodes\.map\(\(dragged\)\s*=>\s*dragged\.id\)/);

  assert.ok(change, "missing Frame-aware node change handler");
  assert.match(change, /updateFrameDragState\(/);
  assert.match(change, /flowToCanvasDocument\(/);
  assert.match(change, /change\.type === "position" && change\.position/);
  assert.match(change, /drag\?\.phase === "ending"/);
  assert.match(change, /if\s*\(!drag[\s\S]*bump\(\)/);
  assert.doesNotMatch(change, /frameId\s*=.*overlap|intersect|overlap/s);

  assert.ok(end, "missing shared Frame drag completion");
  assert.equal((end.match(/bump\(\)/g) ?? []).length, 1);
  assert.match(end, /settleFrameDragState\(/);
  assert.ok(finish, "missing Frame-aware drag finish");
  assert.match(finish, /finishFrameDragState\(/);
  assert.equal((finish.match(/bump\(\)/g) ?? []).length, 1);
  assert.match(
    appSource,
    /handleGlobalCanvasKeyDown\([\s\S]*endFrameDrag,[\s\S]*cancelDraw,/,
  );

  assert.match(appSource, /onNodeDragStart=\{beginNodeDrag\}/);
  assert.match(appSource, /onNodeDragStop=\{finishNodeDrag\}/);
});

test("all calculated node movement routes Frame positions through one transition", () => {
  const transition = callbackSource("applyNodePositions");
  const align = callbackSource("alignSelected");
  const distribute = callbackSource("distributeSelected");
  const layout = callbackSource("autoLayout");

  assert.ok(transition, "missing shared canonical position transition");
  assert.match(transition, /moveNodesInDocument\(/);
  assert.match(transition, /workingSnapshot\(\)/);
  assert.ok(align);
  assert.match(align, /applyNodePositions\(aligned\)/);
  assert.ok(distribute);
  assert.match(distribute, /applyNodePositions\(distributed\)/);
  assert.ok(layout);
  assert.match(layout, /applyNodePositions\(layoutSelection\(/);
  const nudge = callbackSource("nudgeSelected");
  assert.ok(nudge);
  assert.match(nudge, /applyNodePositions\(positioned\)/);
});

test("the app owns Arrow-key movement before React Flow handles focused nodes", () => {
  const nudge = callbackSource("nudgeSelected");

  assert.ok(nudge, "missing shared keyboard nudge transition");
  assert.equal((nudge.match(/pushHistory\(\)/g) ?? []).length, 1);
  assert.equal((nudge.match(/bump\(\)/g) ?? []).length, 1);
  assert.match(nudge, /applyNodePositions\(positioned\)/);
  assert.match(
    appSource,
    /onKeyDownCapture=\{\(event\)\s*=>\s*\{[\s\S]*captureCanvasArrowKey\(\s*event,\s*Boolean\(editing \|\| imageViewer\),\s*nudgeSelected,?\s*\)/,
  );
  assert.doesNotMatch(appSource, /disableKeyboardA11y/);
});

class TestKeyboardEvent extends Event {
  constructor(
    readonly key: string,
    readonly shiftKey = false,
  ) {
    super("keydown", { bubbles: true, cancelable: true });
  }
}

test("the canvas capture boundary owns an Arrow key exactly once", () => {
  const canvas = new EventTarget();
  let canonicalMoves = 0;
  let reactFlowMoves = 0;

  canvas.addEventListener("keydown", (event) => {
    captureCanvasArrowKey(event as TestKeyboardEvent, false, () => {
      canonicalMoves += 1;
      return true;
    });
  });
  canvas.addEventListener("keydown", (event) => {
    if (!event.cancelBubble) reactFlowMoves += 1;
  });

  const event = new TestKeyboardEvent("ArrowRight");
  canvas.dispatchEvent(event);

  assert.equal(canonicalMoves, 1);
  assert.equal(reactFlowMoves, 0);
  assert.equal(event.defaultPrevented, true);
});

test("the canvas capture boundary leaves editable targets alone", () => {
  for (const editable of [
    Object.assign(new EventTarget(), { tagName: "INPUT" }),
    Object.assign(new EventTarget(), { isContentEditable: true }),
  ]) {
    let canonicalMoves = 0;
    let downstreamMoves = 0;
    editable.addEventListener("keydown", (event) => {
      captureCanvasArrowKey(event as TestKeyboardEvent, false, () => {
        canonicalMoves += 1;
        return true;
      });
    });
    editable.addEventListener("keydown", (event) => {
      if (!event.cancelBubble) downstreamMoves += 1;
    });

    const event = new TestKeyboardEvent("ArrowLeft");
    editable.dispatchEvent(event);

    assert.equal(canonicalMoves, 0);
    assert.equal(downstreamMoves, 1);
    assert.equal(event.defaultPrevented, false);
  }
});

test("all node deletion entrances share canonical Frame deletion rules", () => {
  const deletion = callbackSource("deleteCanvasElements");
  const eraseNode = callbackSource("eraseNode");
  const deleteNode = callbackSource("deleteNode");

  assert.ok(deletion, "missing unified canvas deletion transition");
  assert.match(deletion, /deleteNodeFromDocument\(/);
  assert.equal((deletion.match(/pushHistory\(\)/g) ?? []).length, 1);
  assert.equal((deletion.match(/bump\(\)/g) ?? []).length, 1);
  assert.match(deletion, /settleFrameDragState\(/);

  assert.ok(eraseNode);
  assert.match(eraseNode, /deleteCanvasElements\(\[id\]/);
  assert.ok(deleteNode);
  assert.match(deleteNode, /deleteCanvasElements\(\[nodeId\]/);
  assert.match(appSource, /onDelete=\{deleteNode\}/);
  assert.match(appSource, /onClick=\{\(\)\s*=>\s*deleteNode\(menuNode\.id\)\}/);
  assert.match(appSource, /deleteSelection: deleteCanvasElements/);
  assert.match(appSource, /deleteKeyCode=\{null\}/);
});

test("frames stay behind nodes and expose only title and border hit regions", () => {
  assert.match(
    canvasCss,
    /\.react-flow__node-frame\s*\{[^}]*z-index:\s*0\s*!important;[^}]*pointer-events:\s*none/s,
  );
  assert.match(
    canvasCss,
    /\.react-flow__node:not\(\.react-flow__node-frame\)\s*\{[^}]*z-index:\s*1/s,
  );
  assert.match(
    canvasCss,
    /\.zmd-board-frame-title,[\s\S]*\.zmd-board-frame-hit-edge\s*\{[^}]*pointer-events:\s*auto/s,
  );
  assert.match(
    canvasCss,
    /\.zmd-board-frame-hit-edge\.is-(?:top|bottom)[\s\S]*\.zmd-board-frame-hit-edge\.is-(?:left|right)/,
  );
});

test("fit view can zoom out far enough for a narrow canvas", () => {
  assert.match(appSource, /<ReactFlow[\s\S]*minZoom=\{0\.1\}/);
});

test("edge arrow state survives flow, snapshot, and history round trips", () => {
  const document: CanvasDocument = {
    version: 2,
    nodes: [
      {
        id: "a",
        kind: "rect",
        position: { x: 0, y: 0 },
        width: 100,
        height: 80,
        data: { title: "A" },
      },
      {
        id: "b",
        kind: "rect",
        position: { x: 200, y: 0 },
        width: 100,
        height: 80,
        data: { title: "B" },
      },
    ],
    connections: [
      {
        id: "legacy",
        kind: "basic",
        source: "a",
        target: "b",
        color: "#2563eb",
      },
      {
        id: "plain",
        kind: "basic",
        source: "a",
        target: "b",
        color: "#dc2626",
        arrow: false,
      },
    ],
  };
  const flow = canvasDocumentToFlow(document);
  assert.equal(flow.edges[0].sourceHandle, "right");
  assert.equal(flow.edges[0].targetHandle, "left");
  assert.deepEqual(flow.edges[0].markerEnd, {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "#2563eb",
  });
  assert.equal(flow.edges[1].markerEnd, undefined);

  const snapshot = flowToCanvasDocument(flow.nodes, flow.edges, {
    x: 4,
    y: 5,
    zoom: 1.25,
  });
  assert.equal(snapshot.connections[0].arrow, true);
  assert.equal(snapshot.connections[1].arrow, false);

  const changes: number[] = [];
  const history = new CanvasDocumentHistory((rev) => changes.push(rev));
  history.push(EMPTY);
  history.changed();
  const previous = history.undo(snapshot);
  assert.deepEqual(previous, EMPTY);
  const redone = history.redo(EMPTY);
  assert.equal(redone?.connections[1].arrow, false);
  assert.deepEqual(changes, [1, 2, 3]);
});

test("all edge arrow directions survive style, file, SVG, and history round trips", () => {
  const nodes: CanvasDocument["nodes"] = [
    {
      id: "source",
      kind: "rect",
      position: { x: 0, y: 0 },
      width: 100,
      height: 80,
      data: { title: "Source" },
    },
    {
      id: "target",
      kind: "rect",
      position: { x: 240, y: 0 },
      width: 100,
      height: 80,
      data: { title: "Target" },
    },
  ];
  const directions = [
    { arrow: false, startArrow: false, start: false, end: false },
    { arrow: true, startArrow: false, start: false, end: true },
    { arrow: false, startArrow: true, start: true, end: false },
    { arrow: true, startArrow: true, start: true, end: true },
  ];

  for (const direction of directions) {
    const source: CanvasDocument = {
      version: 2,
      nodes,
      connections: [
        {
          id: "edge",
          kind: "academic",
          source: "source",
          target: "target",
          relation: "supports",
          arrow: direction.arrow,
          startArrow: direction.startArrow,
        },
      ],
    };
    const flow = canvasDocumentToFlow(source);
    const styled = withEdgeStyle(flow.edges[0]!, { color: "#059669" });
    assert.equal(Boolean(styled.markerStart), direction.start);
    assert.equal(Boolean(styled.markerEnd), direction.end);
    assert.equal(styled.data?.connection.relation, "supports");

    const snapshot = flowToCanvasDocument(flow.nodes, [styled], {
      x: 0,
      y: 0,
      zoom: 1,
    });
    const file = canvasDocumentToFile(snapshot, {
      now: "2026-09-24T00:00:00.000Z",
    });
    assert.equal(file.edges[0]?.fromEnd, direction.start ? "arrow" : "none");
    assert.equal(file.edges[0]?.toEnd, direction.end ? "arrow" : "none");
    const reloaded = canvasFileToDocument(file).document;
    const edge = reloaded.connections[0]!;
    assert.equal(edge.arrow, direction.arrow);
    assert.equal(edge.startArrow, direction.startArrow);
    assert.equal(edge.color, "#059669");
    assert.equal(edge.kind, "academic");
    assert.equal(
      buildCanvasSvg(reloaded).includes("marker-start"),
      direction.start,
    );
    assert.equal(
      buildCanvasSvg(reloaded).includes("marker-end"),
      direction.end,
    );

    const history = new CanvasDocumentHistory(() => undefined);
    history.push(EMPTY);
    history.changed();
    assert.equal(history.undo(snapshot)?.connections.length, 0);
    assert.equal(
      history.redo(EMPTY)?.connections[0]?.startArrow,
      direction.startArrow,
    );
  }

  const malformed = parseCanvasDocument({
    version: 2,
    nodes,
    connections: [
      {
        id: "invalid",
        kind: "basic",
        source: "source",
        target: "target",
        startArrow: "yes",
      },
    ],
  });
  assert.deepEqual(malformed.document.connections, []);
  assert.equal(malformed.issues[0]?.code, "malformed-connection");
});

test("color-only flow edits preserve unsupported JSON Canvas endpoint values", () => {
  const imported = canvasFileToDocument({
    version: 1,
    nodes: [
      {
        id: "source",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        text: "Source",
      },
      {
        id: "target",
        type: "text",
        x: 240,
        y: 0,
        width: 100,
        height: 80,
        text: "Target",
      },
    ],
    edges: [
      {
        id: "edge",
        fromNode: "source",
        toNode: "target",
        toEnd: "future-symbol",
      },
    ],
  }).document;
  assert.equal(imported.connections[0]?.extensions?.toEnd, "future-symbol");

  const flow = canvasDocumentToFlow(imported);
  const styled = withEdgeStyle(flow.edges[0]!, { color: "#059669" });
  const saved = canvasDocumentToFile(
    flowToCanvasDocument(flow.nodes, [styled], { x: 0, y: 0, zoom: 1 }),
    { now: "2026-09-24T00:00:00.000Z" },
  );
  assert.equal(saved.edges[0]?.toEnd, "future-symbol");

  const explicitlyArrowed = withEdgeStyle(flow.edges[0]!, { arrow: false });
  const rewritten = canvasDocumentToFile(
    flowToCanvasDocument(flow.nodes, [explicitlyArrowed], {
      x: 0,
      y: 0,
      zoom: 1,
    }),
    { now: "2026-09-24T00:00:00.000Z" },
  );
  assert.equal(rewritten.edges[0]?.toEnd, "none");
  assert.notEqual(rewritten.edges[0]?.toEnd, "future-symbol");
});

test("style transition commits Academic content and style in one node update", () => {
  const [node] = canvasDocumentToFlow({
    version: 2,
    nodes: [
      {
        id: "claim-1",
        kind: "note",
        position: { x: 10, y: 20 },
        width: 260,
        height: 128,
        content: "Old",
        style: { fontSize: 16 },
      },
    ],
    connections: [],
  }).nodes;

  const next = mergeEditingStyle(node, "Typed claim", { fontSize: 24 });
  assert.equal(next.data.model.kind, "note");
  assert.equal(
    next.data.model.kind === "note" && next.data.model.content,
    "Typed claim",
  );
  assert.equal(next.data.model.style?.fontSize, 24);
  assert.equal(flowNodeText(next), "Typed claim");
  assert.equal(flowNodeText(node), "Old");
});

test("bold editing shortcut toggles effective default-bold nodes normal then bold", () => {
  const nodes: CanvasDocument["nodes"] = [
    {
      id: "item-1",
      kind: "item",
      position: { x: 0, y: 0 },
      width: 240,
      height: 96,
      data: { title: "Item" },
    },
    {
      id: "pdf-1",
      kind: "pdf",
      position: { x: 0, y: 0 },
      width: 240,
      height: 220,
      data: { title: "PDF" },
    },
    {
      id: "attachment-1",
      kind: "attachment",
      position: { x: 0, y: 0 },
      width: 240,
      height: 96,
      data: { title: "Attachment" },
    },
    academicDocument().nodes[0],
    {
      id: "frame-1",
      kind: "frame",
      position: { x: 0, y: 0 },
      width: 480,
      height: 320,
      title: "Frame",
    },
  ];
  const flowNodes = canvasDocumentToFlow({
    version: 2,
    nodes,
    connections: [],
  }).nodes;

  for (const node of flowNodes) {
    const normal = toggleEditingBold(node, flowNodeText(node));
    assert.equal(normal.data.model.style?.fontWeight, "normal", node.type);
    const bold = toggleEditingBold(normal, flowNodeText(normal));
    assert.equal(bold.data.model.style?.fontWeight, "bold", node.type);
  }
});

test("Academic edits reopen with the same canonical style and export it", () => {
  const [node] = canvasDocumentToFlow({
    version: 2,
    nodes: [
      {
        id: "claim-styled",
        kind: "note",
        position: { x: 10, y: 20 },
        width: 260,
        height: 128,
        content: "Draft",
      },
    ],
    connections: [],
  }).nodes;
  const style = {
    fill: "#fef3c7",
    stroke: "#7c3aed",
    strokeWidth: 4,
    strokeStyle: "dashed" as const,
    radius: 16,
    fontFamily: "Georgia, serif",
    fontSize: 18,
    fontWeight: "bold" as const,
    fontStyle: "italic" as const,
    textDecoration: "underline" as const,
    textAlign: "right" as const,
    verticalAlign: "bottom" as const,
    textColor: "#312e81",
    textOpacity: 0.75,
  };
  const edited = mergeEditingStyle(node, "Committed claim", style);
  const snapshot = flowToCanvasDocument([edited], [], {
    x: 0,
    y: 0,
    zoom: 1,
  });
  const reopened = canvasFileToDocument(
    canvasDocumentToFile(snapshot, { now: "2026-09-04T00:00:00.000Z" }),
  ).document;
  const reopenedFlow = canvasDocumentToFlow(reopened);

  assert.deepEqual(reopened.nodes[0].style, style);
  assert.deepEqual(
    beginNodeEditing(reopenedFlow.nodes, "claim-styled")?.editing,
    {
      nodeId: "claim-styled",
      value: "Committed claim",
    },
  );
  const svg = buildCanvasSvg(reopened);
  assert.match(
    svg,
    /<rect x="10" y="20" width="260" height="128" rx="16" fill="#fef3c7" stroke="#7c3aed" stroke-width="4" stroke-dasharray="12 12"\/>/,
  );
  assert.match(
    svg,
    /font-family="Georgia, serif" font-size="18" font-weight="bold" font-style="italic" text-decoration="underline" text-anchor="end" fill="#312e81" opacity="0\.75"/,
  );
  assert.match(svg, />Committed claim<\/tspan>/);
});

test("flow model updates are immutable and keep the renderer kind synchronized", () => {
  const [node] = canvasDocumentToFlow(academicDocument()).nodes;
  const next = updateFlowNodeModel(node, (model) => ({
    id: model.id,
    kind: "frame",
    position: model.position,
    width: 480,
    height: 320,
    title: "Review",
  }));

  assert.equal(next.type, "frame");
  assert.equal(next.data.model.kind, "frame");
  assert.equal(node.data.model.kind, "literature");
});

test("a prevented style-bar blur cannot suppress the next real edit commit", () => {
  const focusHold = { current: false };
  let release = () => {};
  let editingValue = "First edit";
  let savedValue = "";

  armEditFocusHold(focusHold, (callback) => {
    release = callback;
  });
  assert.equal(focusHold.current, true);

  editingValue = "Second edit";
  release();
  handleEditBlur(focusHold, () => {
    savedValue = editingValue;
  });

  assert.equal(savedValue, "Second edit");
});

test("an immediate style-control blur consumes the focus hold once", () => {
  const focusHold = { current: false };
  armEditFocusHold(focusHold, () => {});

  assert.equal(consumeEditFocusHold(focusHold), true);
  assert.equal(consumeEditFocusHold(focusHold), false);
});

test("an older release cannot clear a newer focus hold", () => {
  const focusHold = { current: false };
  const releases: Array<() => void> = [];
  const schedule = (callback: () => void) => {
    releases.push(callback);
  };

  armEditFocusHold(focusHold, schedule);
  armEditFocusHold(focusHold, schedule);
  releases[0]();

  assert.equal(consumeEditFocusHold(focusHold), true);
});

test("edge color changes update the typed connection and existing arrow", () => {
  const disabled = withEdgeColor(
    {
      id: "plain",
      source: "a",
      target: "b",
      markerEnd: undefined,
      data: {
        connection: {
          id: "plain",
          kind: "basic",
          source: "a",
          target: "b",
          arrow: false,
        },
      },
    },
    "#059669",
  );
  assert.equal(disabled.markerEnd, undefined);
  assert.equal(disabled.style?.stroke, "#059669");
  assert.equal(disabled.data?.connection.color, "#059669");

  const arrowed = withEdgeColor(
    {
      id: "arrowed",
      source: "a",
      target: "b",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#111111" },
      data: {
        connection: {
          id: "arrowed",
          kind: "academic",
          source: "a",
          target: "b",
          relation: "supports",
        },
      },
    },
    "#059669",
  );
  assert.deepEqual(arrowed.markerEnd, {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "#059669",
  });
  assert.equal(arrowed.data?.connection.color, "#059669");
});

test("host replacement is silent and clears both history directions", () => {
  const changes: number[] = [];
  const history = new CanvasDocumentHistory((rev) => changes.push(rev));
  history.push(EMPTY);
  history.changed();
  history.undo({ ...EMPTY, viewport: { x: 10, y: 20, zoom: 2 } });
  assert.equal(history.revision, 2);

  history.replace();
  assert.equal(history.revision, 2);
  assert.deepEqual(changes, [1, 2]);
  assert.equal(history.undo(EMPTY), undefined);
  assert.equal(history.redo(EMPTY), undefined);

  history.push(EMPTY);
  history.changed();
  assert.deepEqual(changes, [1, 2, 3]);
});

test("shape and editor layout map every vertical alignment with middle default", () => {
  assert.deepEqual(verticalAlignmentStyle({ verticalAlign: "top" }), {
    alignItems: "flex-start",
  });
  assert.deepEqual(verticalAlignmentStyle({ verticalAlign: "middle" }), {
    alignItems: "center",
  });
  assert.deepEqual(verticalAlignmentStyle({ verticalAlign: "bottom" }), {
    alignItems: "flex-end",
  });
  assert.deepEqual(verticalAlignmentStyle({}), {
    alignItems: "center",
  });
  const defaultLabel = labelTextStyle({});
  assert.equal(defaultLabel.lineHeight, 1.25);
  assert.equal(defaultLabel.color, "var(--zmd-board-text, #111827)");
  assert.equal(labelTextStyle({ textColor: "#abcdef" }).color, "#abcdef");
});
