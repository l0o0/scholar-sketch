import assert from "node:assert/strict";
import test from "node:test";
import {
  CanvasDocumentError,
  demoCanvasDocument,
  emptyCanvasDocument,
  parseCanvasDocument,
} from "../packages/whiteboard/src/model/document.ts";

test("rejects a wholly invalid Bamboo document", () => {
  assert.throws(
    () => parseCanvasDocument({ version: 2, nodes: "bad", connections: [] }),
    CanvasDocumentError,
  );
});

test("Literature annotation counts are non-negative safe integers", () => {
  for (const annotationCount of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
  ]) {
    const node = literature("invalid-count", "ITEM1234");
    const parsed = parseCanvasDocument({
      version: 2,
      nodes: [{ ...node, snapshot: { ...node.snapshot, annotationCount } }],
      connections: [],
    });
    assert.equal(parsed.document.nodes.length, 0, String(annotationCount));
    assert.equal(parsed.issues[0]?.code, "malformed-node");
  }
  for (const annotationCount of [0, 2, Number.MAX_SAFE_INTEGER]) {
    const node = literature("valid-count", "ITEM1234");
    const parsed = parseCanvasDocument({
      version: 2,
      nodes: [{ ...node, snapshot: { ...node.snapshot, annotationCount } }],
      connections: [],
    });
    assert.equal(parsed.document.nodes.length, 1);
    assert.deepEqual(parsed.issues, []);
  }
});

test("direct parser requires own root fields and ignores inherited optionals", () => {
  const rootFields = {
    version: 2,
    nodes: [],
    connections: [],
  };

  for (const field of Object.keys(rootFields)) {
    const inherited = Object.create({
      [field]: rootFields[field as keyof typeof rootFields],
    }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(rootFields)) {
      if (key !== field) inherited[key] = value;
    }
    assert.throws(() => parseCanvasDocument(inherited), CanvasDocumentError);
  }

  const inheritedOptionals = Object.assign(
    Object.create({
      viewport: { x: 10, y: 20, zoom: 2 },
      metadata: { title: "Inherited" },
      extensions: { inherited: true },
    }),
    rootFields,
  );
  const result = parseCanvasDocument(inheritedOptionals);
  assert.equal(result.document.viewport, undefined);
  assert.equal(result.document.metadata, undefined);
  assert.equal(result.document.extensions, undefined);
});

test("direct parser rejects inherited node geometry and content fields", () => {
  const inheritedNode = (
    id: string,
    own: Record<string, unknown>,
    inherited: Record<string, unknown>,
  ) => Object.assign(Object.create(inherited), { id, ...own });
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      inheritedNode(
        "inherited-position",
        { kind: "note", width: 240, height: 120, content: "Claim" },
        { position: { x: 0, y: 0 } },
      ),
      {
        ...claim("inherited-x"),
        position: Object.assign(Object.create({ x: 0 }), { y: 0 }),
      },
      inheritedNode(
        "inherited-content",
        {
          kind: "note",
          position: { x: 0, y: 0 },
          width: 240,
          height: 120,
        },
        { content: "Claim" },
      ),
      {
        id: "inherited-title",
        kind: "text",
        position: { x: 0, y: 0 },
        width: 240,
        height: 120,
        data: Object.create({ title: "Inherited" }),
      },
      claim("valid-claim"),
    ],
    connections: [],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["valid-claim"],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-node", "malformed-node", "malformed-node"],
  );
});

test("direct parser rejects inherited Academic source, library, and keys", () => {
  const inheritedSource = Object.assign(
    Object.create({
      source: { library: { type: "user" }, itemKey: "ITEM1234" },
    }),
    literature("inherited-source", "ITEM1234"),
  );
  delete inheritedSource.source;

  const inheritedLibrary = literature("inherited-library", "ITEM1234");
  inheritedLibrary.source = Object.assign(
    Object.create({ library: { type: "user" } }),
    { itemKey: "ITEM1234" },
  );

  const inheritedKey = literature("inherited-key", "ITEM1234");
  inheritedKey.source = Object.assign(Object.create({ itemKey: "ITEM1234" }), {
    library: { type: "user" as const },
  });

  const inheritedLibraryType = literature("inherited-library-type", "ITEM1234");
  inheritedLibraryType.source.library = Object.create({ type: "user" });

  const inheritedGroupID = literature("inherited-group-id", "ITEM1234");
  inheritedGroupID.source.library = Object.assign(
    Object.create({ groupID: 7 }),
    { type: "group" as const },
  );

  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      inheritedSource,
      inheritedLibrary,
      inheritedKey,
      inheritedLibraryType,
      inheritedGroupID,
      literature("valid-literature", "ITEM1234"),
    ],
    connections: [],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["valid-literature"],
  );
  assert.equal(result.issues.length, 5);
  assert.ok(result.issues.every((issue) => issue.code === "malformed-node"));
});

test("direct parser rejects inherited connection fields", () => {
  const required = {
    id: "edge",
    kind: "academic",
    source: "claim-1",
    target: "claim-2",
    relation: "supports",
  };
  const inheritedConnections = Object.keys(required).map((field, index) => {
    const edge = Object.create({
      [field]: required[field as keyof typeof required],
    }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(required)) {
      if (key !== field) edge[key] = key === "id" ? `edge-${index}` : value;
    }
    return edge;
  });
  const result = parseCanvasDocument({
    version: 2,
    nodes: [claim("claim-1"), claim("claim-2")],
    connections: inheritedConnections,
  });

  assert.deepEqual(result.document.connections, []);
  assert.equal(result.issues.length, inheritedConnections.length);
  assert.ok(
    result.issues.every((issue) => issue.code === "malformed-connection"),
  );
});

test("direct parser preserves own __proto__ extension data without mutation", () => {
  const input = JSON.parse(`{
    "version": 2,
    "nodes": [{
      "id": "claim-1",
      "kind": "note",
      "position": { "x": 0, "y": 0 },
      "width": 240,
      "height": 120,
      "content": "Claim",
      "extensions": {
        "__proto__": { "nodeMarker": true },
        "nested": { "__proto__": { "nestedMarker": true } },
        "items": [{ "__proto__": "array-marker" }]
      }
    }],
    "connections": [],
    "extensions": { "__proto__": { "rootMarker": true } }
  }`) as Record<string, unknown>;

  const result = parseCanvasDocument(input);
  const nodeExtensions = result.document.nodes[0].extensions!;
  const nested = nodeExtensions.nested as Record<string, unknown>;
  const arrayItem = (nodeExtensions.items as Record<string, unknown>[])[0];
  assert.equal(Object.hasOwn(result.document.extensions!, "__proto__"), true);
  assert.equal(Object.hasOwn(nodeExtensions, "__proto__"), true);
  assert.equal(Object.hasOwn(nested, "__proto__"), true);
  assert.equal(Object.hasOwn(arrayItem, "__proto__"), true);
  assert.deepEqual(result.document.extensions, input.extensions);
  assert.deepEqual(
    nodeExtensions,
    (input.nodes as Record<string, unknown>[])[0].extensions,
  );
  assert.equal(({} as Record<string, unknown>).rootMarker, undefined);
  assert.equal(({} as Record<string, unknown>).nodeMarker, undefined);
  assert.equal(({} as Record<string, unknown>).nestedMarker, undefined);
});

test("direct parser does not materialize inherited sparse-array entries", () => {
  const nodes: unknown[] = new Array(1);
  Object.setPrototypeOf(
    nodes,
    Object.assign(Object.create(Array.prototype), { 0: claim("inherited") }),
  );
  const extensionItems: unknown[] = new Array(1);
  Object.setPrototypeOf(
    extensionItems,
    Object.assign(Object.create(Array.prototype), { 0: "inherited" }),
  );

  const result = parseCanvasDocument({
    version: 2,
    nodes,
    connections: [],
    extensions: { extensionItems },
  });
  const parsedItems = result.document.extensions!.extensionItems as unknown[];
  assert.deepEqual(result.document.nodes, []);
  assert.equal(Object.hasOwn(parsedItems, 0), true);
  assert.equal(parsedItems[0], undefined);
  assert.equal(parsedItems.length, 1);
});

test("direct parser neutralizes sparse entries from Array.prototype", () => {
  const pollutedNode = claim("array-prototype-node");
  let result: ReturnType<typeof parseCanvasDocument>;
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  try {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      value: pollutedNode,
      writable: true,
    });
    result = parseCanvasDocument({
      version: 2,
      nodes: new Array(1),
      connections: [],
      extensions: { items: new Array(1) },
    });
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "0", previous);
    else delete (Array.prototype as unknown[])[0];
  }

  const items = result.document.extensions!.items as unknown[];
  assert.deepEqual(result.document.nodes, []);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node"],
  );
  assert.equal(Object.hasOwn(items, 0), true);
  assert.equal(items[0], undefined);
});

test("repairs dangling connections and invalid frame membership", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      {
        id: "frame-1",
        kind: "frame",
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        title: "Topic",
      },
      {
        id: "claim-1",
        kind: "note",
        position: { x: 20, y: 30 },
        width: 240,
        height: 120,
        frameId: "missing-frame",
        content: "Claim",
      },
    ],
    connections: [
      {
        id: "bad-edge",
        kind: "academic",
        source: "claim-1",
        target: "missing",
        relation: "supports",
      },
    ],
  });

  assert.equal(result.document.nodes[1].frameId, undefined);
  assert.deepEqual(result.document.connections, []);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["invalid-frame", "dangling-connection"],
  );
});

test("allows semantic relationships between arbitrary existing nodes", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      {
        id: "rect-1",
        kind: "rect",
        position: { x: 0, y: 0 },
        width: 100,
        height: 80,
        data: { title: "Context" },
      },
      {
        id: "question-1",
        kind: "note",
        badge: "Question",
        position: { x: 200, y: 0 },
        width: 240,
        height: 120,
        content: "Why?",
      },
    ],
    connections: [
      {
        id: "edge-1",
        kind: "academic",
        source: "rect-1",
        target: "question-1",
        relation: "supports",
      },
    ],
  });
  assert.equal(result.document.connections[0].kind, "academic");
});

test("drops duplicate node and connection identifiers in source order", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      claim("claim-1"),
      { ...claim("claim-1"), content: "duplicate" },
      claim("claim-2"),
    ],
    connections: [
      academicConnection("edge-1", "claim-1", "claim-2"),
      academicConnection("edge-1", "claim-2", "claim-1"),
    ],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["claim-1", "claim-2"],
  );
  assert.deepEqual(
    result.document.connections.map((connection) => connection.id),
    ["edge-1"],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["duplicate-node-id", "duplicate-connection-id"],
  );
});

test("clears nesting from Frames", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [{ ...frame("frame-1"), frameId: "frame-2" }, frame("frame-2")],
    connections: [],
  });

  assert.equal(result.document.nodes[0].frameId, undefined);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["nested-frame"],
  );
});

test("clears an empty frame membership", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [{ ...claim("claim-1"), frameId: "" }],
    connections: [],
  });

  assert.equal(result.document.nodes[0].frameId, undefined);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["invalid-frame"],
  );
});

test("drops nodes with non-finite coordinates or non-positive dimensions", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      { ...claim("bad-coordinate"), position: { x: Infinity, y: 0 } },
      { ...claim("bad-width"), width: 0 },
      { ...claim("bad-height"), height: -1 },
      claim("valid-claim"),
    ],
    connections: [],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["valid-claim"],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-node", "malformed-node"],
  );
});

test("drops nodes with non-positive font sizes", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      { ...claim("zero-font"), style: { fontSize: 0 } },
      { ...claim("negative-font"), style: { fontSize: -12 } },
      { ...claim("valid-font"), style: { fontSize: 12 } },
    ],
    connections: [],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["valid-font"],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-node"],
  );
});

test("drops malformed individual nodes while retaining valid records", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      { id: "unknown", kind: "unknown" },
      { ...claim("no-content"), content: 42 },
      claim("valid-claim"),
    ],
    connections: [],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["valid-claim"],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-node"],
  );
});

test("requires non-empty Zotero keys", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      literature("empty-item", ""),
      quote("empty-attachment", "ITEM1234", "", "ANNO1234"),
      note("empty-note", ""),
      literature("valid-literature", "ITEM1234"),
    ],
    connections: [],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["valid-literature"],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-node", "malformed-node"],
  );
});

test("requires positive safe integer Zotero group identifiers", () => {
  const groupLiterature = (id: string, groupID: number) => ({
    ...literature(id, "ITEM1234"),
    source: { library: { type: "group", groupID }, itemKey: "ITEM1234" },
  });
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      groupLiterature("negative-group", -1),
      groupLiterature("zero-group", 0),
      groupLiterature("fractional-group", 1.5),
      groupLiterature("unsafe-group", Number.MAX_SAFE_INTEGER + 1),
      groupLiterature("valid-group", 42),
    ],
    connections: [],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["valid-group"],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-node", "malformed-node", "malformed-node"],
  );
});

test("parses the four academic node payloads", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      literature("literature-1", "ITEM1234"),
      quote("quote-1", "ITEM1234", "ATTACH12", "ANNO1234"),
      note("note-1", "NOTE1234"),
      frame("frame-1"),
    ],
    connections: [],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.kind),
    ["literature", "quote", "note", "frame"],
  );
  assert.deepEqual(result.issues, []);
});

test("round-trips legacy Quotes and all annotation types from standalone attachments", () => {
  const legacy = quote("legacy", "ITEM1234", "ATTACH12", "ANNO1234");
  const nodes: unknown[] = [legacy];
  for (const annotationType of [
    "highlight",
    "underline",
    "note",
    "text",
    "image",
    "ink",
  ]) {
    nodes.push({
      ...quote(annotationType, "ITEM1234", "ATTACH12", "ANNO1234"),
      source: {
        library: { type: "user" },
        attachmentKey: "ATTACH12",
        annotationKey: "ANNO1234",
      },
      snapshot: {
        text: "",
        comment: "My comment",
        annotationType,
        tags: ["review", "方法"],
      },
    });
  }
  const original = { version: 2, nodes, connections: [] };
  const parsed = parseCanvasDocument(original);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.document.nodes, nodes);
  const reopened = parseCanvasDocument(
    JSON.parse(JSON.stringify(parsed.document)),
  );
  assert.deepEqual(reopened.issues, []);
  assert.deepEqual(reopened.document.nodes, nodes);
});

test("rejects invalid annotation metadata and invalid optional parent keys", () => {
  const valid = quote("valid", "ITEM1234", "ATTACH12", "ANNO1234");
  const invalidSnapshots = [
    { text: "", annotationType: "shape" },
    { text: "", annotationType: null },
    { text: "", annotationType: 2 },
    { text: "", tags: [""] },
    { text: "", tags: ["  "] },
    { text: "", tags: ["review", 1] },
    { text: "", tags: "review" },
  ];
  const malformedNodes: unknown[] = invalidSnapshots.map((snapshot, index) => ({
    ...valid,
    id: `snapshot-${index}`,
    snapshot,
  }));
  for (const [index, itemKey] of ["", null, 2].entries()) {
    malformedNodes.push({
      ...valid,
      id: `source-${index}`,
      source: { ...valid.source, itemKey },
    });
  }
  const parsed = parseCanvasDocument({
    version: 2,
    nodes: [...malformedNodes, valid],
    connections: [],
  });
  assert.deepEqual(parsed.document.nodes, [valid]);
  assert.equal(parsed.issues.length, malformedNodes.length);
  assert.ok(parsed.issues.every((issue) => issue.code === "malformed-node"));
});

test("persists a Note badge and rejects retired thought kinds", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      { ...note("note-1", "NOTE1234"), badge: "观点" },
      { ...claim("question-1"), kind: "question" },
      { ...claim("claim-1"), kind: "claim" },
      { ...note("bad-badge", "NOTE5678"), badge: 42 },
    ],
    connections: [],
  });

  assert.deepEqual(result.document.nodes, [
    { ...note("note-1", "NOTE1234"), badge: "观点" },
  ]);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-node", "malformed-node"],
  );
});

test("preserves only explicit extension records", () => {
  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      {
        ...claim("claim-1"),
        unknownNodeValue: "discarded",
        extensions: { plugin: { enabled: true } },
      },
    ],
    connections: [
      {
        ...academicConnection("edge-1", "claim-1", "claim-1"),
        unknownConnectionValue: "discarded",
        extensions: { externalId: "edge-x" },
      },
    ],
    viewport: { x: 10, y: 20, zoom: 1.5, ignored: true },
    metadata: { title: "Canvas", ignored: true },
    extensions: { documentPlugin: ["one"] },
    ignoredRootValue: true,
  });

  const node = result.document.nodes[0] as Record<string, unknown>;
  const connection = result.document.connections[0] as Record<string, unknown>;
  assert.deepEqual(node.extensions, { plugin: { enabled: true } });
  assert.equal(node.unknownNodeValue, undefined);
  assert.deepEqual(connection.extensions, { externalId: "edge-x" });
  assert.equal(connection.unknownConnectionValue, undefined);
  assert.deepEqual(result.document.extensions, { documentPlugin: ["one"] });
  assert.deepEqual(result.document.viewport, { x: 10, y: 20, zoom: 1.5 });
  assert.deepEqual(result.document.metadata, { title: "Canvas" });
});

test("rejects non-object values in the reserved Bamboo extension namespace", () => {
  assert.throws(
    () =>
      parseCanvasDocument({
        version: 2,
        nodes: [],
        connections: [],
        extensions: { bamboo: "vendor" },
      }),
    CanvasDocumentError,
  );

  const result = parseCanvasDocument({
    version: 2,
    nodes: [
      { ...claim("bad-node"), extensions: { bamboo: "vendor" } },
      claim("valid-node"),
    ],
    connections: [
      {
        ...academicConnection("bad-edge", "valid-node", "valid-node"),
        extensions: { bamboo: 42 },
      },
    ],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["valid-node"],
  );
  assert.deepEqual(result.document.connections, []);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-connection"],
  );
});

test("creates an empty version-two document", () => {
  assert.deepEqual(emptyCanvasDocument(), {
    version: 2,
    nodes: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
});

test("creates a valid academic demo without Zotero integer IDs", () => {
  const result = parseCanvasDocument(demoCanvasDocument());

  assert.deepEqual(
    result.document.nodes.map((node) => node.kind),
    ["literature", "quote", "note"],
  );
  assert.equal(result.document.connections[0].relation, "supports");
  assert.deepEqual(result.issues, []);
});

function claim(id: string) {
  return {
    id,
    kind: "note",
    position: { x: 0, y: 0 },
    width: 240,
    height: 120,
    content: "Claim",
    badge: "Claim",
  };
}

function frame(id: string) {
  return {
    id,
    kind: "frame",
    position: { x: 0, y: 0 },
    width: 400,
    height: 300,
    title: "Topic",
  };
}

function literature(id: string, itemKey: string) {
  return {
    id,
    kind: "literature",
    position: { x: 0, y: 0 },
    width: 280,
    height: 136,
    source: { library: { type: "user" }, itemKey },
    snapshot: { title: "A paper", tags: ["research"], annotationCount: 2 },
  };
}

function quote(
  id: string,
  itemKey: string,
  attachmentKey: string,
  annotationKey: string,
) {
  return {
    id,
    kind: "quote",
    position: { x: 0, y: 0 },
    width: 280,
    height: 168,
    source: {
      library: { type: "user" },
      itemKey,
      attachmentKey,
      annotationKey,
    },
    snapshot: { text: "Evidence", pageLabel: "12", color: "#ffd400" },
  };
}

function note(id: string, noteKey: string) {
  return {
    id,
    kind: "note",
    position: { x: 0, y: 0 },
    width: 260,
    height: 152,
    content: "A note",
    source: { library: { type: "user" }, noteKey, itemKey: "ITEM1234" },
    sourceSnapshot: { title: "Note" },
  };
}

function academicConnection(id: string, source: string, target: string) {
  return { id, kind: "academic", source, target, relation: "supports" };
}
