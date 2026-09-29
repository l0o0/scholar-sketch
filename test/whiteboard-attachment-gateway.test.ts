import { canvasDocumentToFlow } from "../packages/whiteboard/src/whiteboard/document.ts";
import { createBasicNode } from "../packages/whiteboard/src/model/basic.ts";
import {
  applyResolvedAcquisitionToCanvasNode,
  sourceSnapshotChanged,
} from "../packages/whiteboard/src/whiteboard/sourceState.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createZoteroSourceGateway,
  type SourceGatewayDependencies,
} from "../src/modules/whiteboard/source-gateway.ts";

function attachment(overrides: Record<string, unknown> = {}) {
  const value = {
    id: 7,
    key: "ATTACHMENT",
    libraryID: 1,
    attachmentFilename: "paper.pdf",
    attachmentContentType: "application/pdf",
    fileExists: () => false,
    getField: () => "",
    isRegularItem: () => false,
    isNote: () => false,
    isAnnotation: () => false,
    isAttachment: () => true,
    ...overrides,
  };
  return value as unknown as Zotero.Item;
}

function deps(item: Zotero.Item, opened: string[]): SourceGatewayDependencies {
  return {
    userLibraryID: 1,
    getLibrary: () => ({ libraryType: "user" }),
    groupLibraryID: () => null,
    getByLibraryAndKey: (_libraryID, key) => (key === item.key ? item : null),
    cleanTags: (html) => html,
    unescapeHTML: (html) => html,
    openItem: async () => undefined,
    openNote: async () => undefined,
    openAnnotation: async () => false,
    openAttachmentPage: async () => undefined,
    openAttachment: async (value) => {
      opened.push(value.key);
    },
  };
}

test("attachment acquisition persists library/key and reports unavailable files", async () => {
  const file = attachment();
  const opened: string[] = [];
  const gateway = createZoteroSourceGateway(deps(file, opened));

  assert.deepEqual(gateway.acquireItem(file), {
    kind: "attachment",
    source: { library: { type: "user" }, attachmentKey: "ATTACHMENT" },
    snapshot: {
      filename: "paper.pdf",
      contentType: "application/pdf",
      availability: "not-downloaded",
    },
  });

  assert.deepEqual(
    await gateway.resolve("attachment-node", 3, {
      kind: "attachment",
      source: { library: { type: "user" }, attachmentKey: "ATTACHMENT" },
    }),
    {
      nodeId: "attachment-node",
      generation: 3,
      status: "resolved",
      acquisition: gateway.acquireItem(file),
    },
  );

  await gateway.open({
    kind: "attachment",
    source: { library: { type: "user" }, attachmentKey: "ATTACHMENT" },
  });
  assert.deepEqual(opened, ["ATTACHMENT"]);
});

test("deleted attachment resolution preserves a typed unavailable result", async () => {
  const file = attachment();
  const gateway = createZoteroSourceGateway({
    ...deps(file, []),
    getByLibraryAndKey: () => null,
  });
  assert.deepEqual(
    await gateway.resolve("attachment-node", 4, {
      kind: "attachment",
      source: { library: { type: "user" }, attachmentKey: "ATTACHMENT" },
    }),
    {
      nodeId: "attachment-node",
      generation: 4,
      status: "unavailable",
      code: "item-missing",
      message: "The Zotero item is unavailable.",
    },
  );
});

test("async Zotero file checks update the resolution snapshot without rejecting acquire", async () => {
  const file = attachment({ fileExists: async () => false });
  const gateway = createZoteroSourceGateway(deps(file, []));
  const initial = gateway.acquireItem(file);
  assert.equal(initial.kind, "attachment");
  if (initial.kind !== "attachment") return;
  assert.equal(initial.snapshot.availability, "not-downloaded");
  const result = await gateway.resolve("attachment-node", 5, {
    kind: "attachment",
    source: { library: { type: "user" }, attachmentKey: "ATTACHMENT" },
  });
  assert.equal(result.status, "resolved");
  if (
    result.status !== "resolved" ||
    result.acquisition.kind !== "attachment"
  ) {
    return;
  }
  assert.equal(result.acquisition.snapshot.availability, "not-downloaded");
});

test("attachments use Zotero display names on import and refresh, preserving the filename", async () => {
  let displayName = "Published version";
  const file = attachment({
    getDisplayTitle: () => displayName,
    getField: () => "Stored title",
  });
  const gateway = createZoteroSourceGateway(deps(file, []));
  const acquired = gateway.acquireItem(file);
  assert.equal(acquired.kind, "attachment");
  if (acquired.kind !== "attachment") throw new Error("Expected attachment");
  assert.equal(acquired.snapshot.title, "Published version");
  assert.equal(acquired.snapshot.filename, "paper.pdf");
  const node = createBasicNode("attachment", { x: 0, y: 0 }, "attachment");
  node.data = { title: "paper.pdf", source: acquired.source };
  const imported = applyResolvedAcquisitionToCanvasNode(node, acquired);
  assert.equal(imported.kind, "attachment");
  if (imported.kind !== "attachment") throw new Error("Expected attachment");
  assert.equal(imported.data.title, "Published version");
  const flowNode = canvasDocumentToFlow({
    version: 2,
    nodes: [imported],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }).nodes[0];
  assert.equal(sourceSnapshotChanged(flowNode, acquired), false);
  displayName = "Accepted manuscript";
  const resolved = await gateway.resolve(node.id, 1, {
    kind: "attachment",
    source: acquired.source,
  });
  assert.equal(resolved.status, "resolved");
  if (resolved.status !== "resolved") throw new Error("Expected source");
  assert.equal(sourceSnapshotChanged(flowNode, resolved.acquisition), true);
  const refreshed = applyResolvedAcquisitionToCanvasNode(
    imported,
    resolved.acquisition,
  );
  if (refreshed.kind !== "attachment") throw new Error("Expected attachment");
  assert.equal(refreshed.data.title, "Accepted manuscript");
});
