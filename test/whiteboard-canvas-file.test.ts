import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ANNOTATION_TYPES } from "../packages/whiteboard/src/model/academic.ts";
import {
  canvasDocumentToFile,
  canvasFileToDocument,
  parseStoredCanvas,
  serializeCanvasDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import {
  CanvasDocumentError,
  parseCanvasDocument,
} from "../packages/whiteboard/src/model/document.ts";

const document = parseCanvasDocument({
  version: 2,
  viewport: { x: 12, y: -8, zoom: 1.25 },
  metadata: {
    title: "Source title",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
  extensions: { rootPlugin: { enabled: true } },
  nodes: [
    {
      id: "lit-1",
      kind: "literature",
      position: { x: 0, y: 0 },
      width: 280,
      height: 136,
      frameId: "frame-1",
      source: { library: { type: "user" }, itemKey: "ITEM1234" },
      snapshot: {
        title: "A paper",
        creators: "Ada Lovelace",
        year: "1843",
        publicationTitle: "Notes",
        tags: ["history", "computing"],
        annotationCount: 2,
      },
      style: { fill: "#fff4cc", fontWeight: "bold", radius: 12 },
      extensions: { nodePlugin: "literature" },
    },
    {
      id: "quote-1",
      kind: "quote",
      position: { x: 320, y: 0 },
      width: 280,
      height: 168,
      source: {
        library: { type: "group", groupID: 42 },
        itemKey: "ITEM5678",
        attachmentKey: "ATTACH12",
        annotationKey: "ANNO1234",
      },
      snapshot: {
        text: "Evidence",
        comment: "Important",
        citation: "Lovelace, 1843",
        pageLabel: "12",
        color: "#ffd400",
      },
    },
    {
      id: "note-1",
      kind: "note",
      position: { x: 640, y: 0 },
      width: 260,
      height: 152,
      content: "A note",
      source: {
        library: { type: "group", groupID: 42 },
        noteKey: "NOTE1234",
        itemKey: "ITEM5678",
      },
      sourceSnapshot: { title: "Original note" },
    },
    {
      id: "question-1",
      kind: "note",
      position: { x: 0, y: 220 },
      width: 260,
      height: 128,
      content: "Why?",
      badge: "Question",
    },
    {
      id: "claim-1",
      kind: "note",
      position: { x: 320, y: 220 },
      width: 260,
      height: 128,
      content: "A claim",
      badge: "Claim",
    },
    {
      id: "frame-1",
      kind: "frame",
      position: { x: -20, y: -20 },
      width: 640,
      height: 200,
      title: "Sources",
      style: { stroke: "#3355aa", strokeWidth: 3 },
    },
    {
      id: "rect-1",
      kind: "rect",
      position: { x: 640, y: 220 },
      width: 140,
      height: 88,
      data: { title: "Context" },
      style: { fill: "#eef2ff", strokeStyle: "dashed" },
    },
  ],
  connections: [
    {
      id: "basic-1",
      kind: "basic",
      source: "lit-1",
      target: "quote-1",
      sourceHandle: "right",
      targetHandle: null,
      label: "leads to",
      color: "#445566",
      dashed: true,
      arrow: false,
      extensions: { connectionPlugin: "basic" },
    },
    {
      id: "related-1",
      kind: "academic",
      source: "lit-1",
      target: "quote-1",
      relation: "related",
    },
    {
      id: "supports-1",
      kind: "academic",
      source: "quote-1",
      target: "claim-1",
      relation: "supports",
      arrow: true,
    },
    {
      id: "contradicts-1",
      kind: "academic",
      source: "claim-1",
      target: "question-1",
      relation: "contradicts",
      dashed: true,
    },
  ],
}).document;

const NOW = "2026-09-03T00:00:00.000Z";
const officialFormatFixture = readFileSync(
  new URL("./fixtures/json-canvas-1.0-all-node-types.canvas", import.meta.url),
  "utf8",
);

test("standalone annotation metadata round-trips without becoming extension data", () => {
  const parsed = parseCanvasDocument({
    version: 2,
    nodes: ANNOTATION_TYPES.map((annotationType) => ({
      id: annotationType,
      kind: "quote",
      position: { x: 0, y: 0 },
      width: 280,
      height: 192,
      source: {
        library: { type: "user" },
        attachmentKey: "ATTACH12",
        annotationKey: "ANNOT123",
      },
      snapshot: {
        text: "",
        comment: "Comment",
        annotationType,
        tags: ["review", "方法"],
      },
    })),
    connections: [],
  });
  assert.deepEqual(parsed.issues, []);
  const first = parseStoredCanvas(
    serializeCanvasDocument(parsed.document, { now: NOW }),
  );
  assert.deepEqual(first.issues, []);
  assert.deepEqual(first.document.nodes, parsed.document.nodes);
  const second = parseStoredCanvas(
    serializeCanvasDocument(first.document, { now: NOW }),
  );
  assert.deepEqual(second.issues, []);
  assert.deepEqual(second.document, first.document);
});

test("standard JSON Canvas annotation text retains comments for external viewers", () => {
  const parsed = parseCanvasDocument({
    version: 2,
    nodes: ["", "Quoted passage"].map((text, index) => ({
      id: `annotation-${index}`,
      kind: "quote",
      position: { x: 0, y: 0 },
      width: 280,
      height: 192,
      source: {
        library: { type: "user" },
        attachmentKey: "ATTACH12",
        annotationKey: `ANNOT12${index}`,
      },
      snapshot: {
        text,
        comment: "Visible comment",
        citation: "Citation",
        pageLabel: "3",
      },
    })),
    connections: [],
  });
  const file = canvasDocumentToFile(parsed.document);
  assert.deepEqual(
    file.nodes.map((node) => (node.type === "text" ? node.text : undefined)),
    [
      "Visible comment\n\nCitation\n\n3",
      "Quoted passage\n\nVisible comment\n\nCitation\n\n3",
    ],
  );
  const external = canvasFileToDocument({
    nodes: file.nodes.map(({ bamboo: _bamboo, ...node }) => node),
    edges: [],
  });
  assert.deepEqual(external.issues, []);
  assert.ok(
    external.document.nodes.every(
      (node) =>
        node.kind === "text" && node.data.title.includes("Visible comment"),
    ),
  );
});

test("encodes version-two academic documents as readable JSON Canvas", () => {
  const file = canvasDocumentToFile(document, { title: "Review", now: NOW });

  assert.equal(file.version, 1);
  assert.equal(file.bamboo.schemaVersion, 2);
  assert.equal(file.bamboo.title, "Review");
  assert.equal(file.bamboo.createdAt, "2026-09-01T00:00:00.000Z");
  assert.equal(file.bamboo.updatedAt, NOW);
  assert.deepEqual(file.rootPlugin, { enabled: true });
  assert.equal(file.nodes.find((node) => node.id === "lit-1")?.type, "text");
  assert.match(
    String(file.nodes.find((node) => node.id === "lit-1")?.text),
    /A paper/,
  );
  assert.equal(file.nodes.find((node) => node.id === "frame-1")?.type, "group");
  assert.equal(
    file.edges.find((edge) => edge.id === "supports-1")?.bamboo?.relation,
    "supports",
  );
});

test("round-trips Zotero references, snapshots, Frames, styles, and connections", () => {
  const decoded = canvasFileToDocument(
    canvasDocumentToFile(document, { title: "Review", now: NOW }),
  );

  assert.deepEqual(decoded.issues, []);
  assert.deepEqual(decoded.document.nodes, document.nodes);
  assert.deepEqual(decoded.document.connections, document.connections);
  assert.deepEqual(decoded.document.viewport, document.viewport);
  assert.deepEqual(decoded.document.extensions, document.extensions);
  assert.deepEqual(decoded.document.metadata, {
    title: "Review",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: NOW,
  });
});

test("preserves unknown standard and nested Bamboo extension fields", () => {
  const source = {
    version: 1,
    vendorRoot: { keep: "root" },
    nodes: [
      {
        id: "text-1",
        type: "text",
        x: 10,
        y: 20,
        width: 240,
        height: 72,
        text: "Hello",
        vendorNode: { keep: "node" },
        bamboo: {
          node: {
            kind: "text",
            data: { title: "Hello", futureDataField: "data" },
            futurePayloadField: { keep: "payload" },
            collision: { fromPayload: true },
          },
          extensions: {
            nodeBamboo: { keep: true },
            data: { existingDataField: "extension" },
            collision: { fromExtensions: true },
          },
          futureNodeField: [1, 2, 3],
          collision: { fromSibling: true },
        },
      },
    ],
    edges: [
      {
        id: "edge-1",
        fromNode: "text-1",
        toNode: "text-1",
        fromSide: "right",
        toSide: "left",
        vendorEdge: { keep: "edge" },
        bamboo: {
          kind: "basic",
          extensions: { edgeBamboo: "nested" },
          futureEdgeField: 9,
        },
      },
    ],
    bamboo: {
      schemaVersion: 2,
      title: "Extensions",
      createdAt: NOW,
      updatedAt: NOW,
      viewport: { x: 0, y: 0, zoom: 1 },
      extensions: { rootBamboo: { keep: true } },
      futureRootField: "future",
    },
  };

  const encoded = canvasDocumentToFile(canvasFileToDocument(source).document, {
    now: NOW,
  });

  assert.deepEqual(encoded.vendorRoot, { keep: "root" });
  assert.deepEqual(encoded.nodes[0].vendorNode, { keep: "node" });
  assert.equal(encoded.edges[0].fromSide, "right");
  assert.equal(encoded.edges[0].toSide, "left");
  assert.deepEqual(encoded.edges[0].vendorEdge, { keep: "edge" });
  assert.deepEqual(encoded.bamboo.extensions, {
    rootBamboo: { keep: true },
    futureRootField: "future",
  });
  assert.deepEqual(encoded.nodes[0].bamboo?.extensions, {
    nodeBamboo: { keep: true },
    futureNodeField: [1, 2, 3],
    data: {
      existingDataField: "extension",
      futureDataField: "data",
    },
    futurePayloadField: { keep: "payload" },
    collision: {
      fromExtensions: true,
      fromSibling: true,
      fromPayload: true,
    },
  });
  assert.deepEqual(encoded.edges[0].bamboo?.extensions, {
    edgeBamboo: "nested",
    futureEdgeField: 9,
  });
});

test("imports an unmodified JSON Canvas 1.0 fixture with all four node types", () => {
  const parsed = parseStoredCanvas(officialFormatFixture);

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(
    parsed.document.nodes.map((node) => [node.id, node.kind]),
    [
      ["group-1", "frame"],
      ["text-1", "text"],
      ["file-1", "attachment"],
      ["link-1", "text"],
    ],
  );
  const file = parsed.document.nodes.find((node) => node.id === "file-1");
  const link = parsed.document.nodes.find((node) => node.id === "link-1");
  assert.equal(file?.kind, "attachment");
  assert.deepEqual(file?.data, { title: "papers/study.pdf" });
  assert.equal(link?.kind, "text");
  assert.deepEqual(link?.data, {
    title: "https://example.org/paper?section=methods&year=2026",
  });
  assert.deepEqual(file?.extensions?.bamboo, {
    jsonCanvas: {
      type: "file",
      file: "papers/study.pdf",
      subpath: "#page=12",
    },
  });
  assert.deepEqual(link?.extensions?.bamboo, {
    jsonCanvas: {
      type: "link",
      url: "https://example.org/paper?section=methods&year=2026",
    },
  });

  const encoded = canvasDocumentToFile(parsed.document, { now: NOW });
  const encodedGroup = encoded.nodes.find((node) => node.id === "group-1");
  const encodedText = encoded.nodes.find((node) => node.id === "text-1");
  const encodedFile = encoded.nodes.find((node) => node.id === "file-1");
  const encodedLink = encoded.nodes.find((node) => node.id === "link-1");
  assert.equal(encodedGroup?.type, "group");
  assert.equal(encodedGroup?.background, "assets/grid.png");
  assert.equal(encodedGroup?.backgroundStyle, "repeat");
  assert.equal(encodedText?.type, "text");
  assert.equal(encodedText?.color, "4");
  assert.equal(encodedFile?.type, "file");
  assert.equal(encodedFile?.file, "papers/study.pdf");
  assert.equal(encodedFile?.subpath, "#page=12");
  assert.equal(encodedLink?.type, "link");
  assert.equal(
    encodedLink?.url,
    "https://example.org/paper?section=methods&year=2026",
  );
});

test("does not infer JSON Canvas file or link types from Basic payload collisions", () => {
  const parsed = canvasFileToDocument({
    nodes: [
      {
        id: "text-1",
        type: "text",
        x: 0,
        y: 0,
        width: 240,
        height: 72,
        text: "Ordinary text",
        bamboo: {
          node: {
            kind: "text",
            data: { title: "Ordinary text", url: "future-payload-field" },
          },
          extensions: {
            jsonCanvas: { type: "link", url: 42 },
          },
        },
      },
      {
        id: "attachment-1",
        type: "text",
        x: 280,
        y: 0,
        width: 240,
        height: 96,
        text: "Ordinary attachment",
        bamboo: {
          node: {
            kind: "attachment",
            data: {
              title: "Ordinary attachment",
              file: "future-payload-field.pdf",
            },
          },
        },
      },
    ],
    edges: [],
  });

  const encoded = canvasDocumentToFile(parsed.document, { now: NOW });
  assert.deepEqual(
    encoded.nodes.map((node) => node.type),
    ["text", "text"],
  );
  assert.equal(encoded.nodes[0].bamboo?.extensions?.data !== undefined, true);
  assert.deepEqual(encoded.nodes[0].bamboo?.extensions?.jsonCanvas, {
    type: "link",
    url: 42,
  });
  assert.deepEqual(encoded.nodes[1].bamboo?.extensions?.data, {
    file: "future-payload-field.pdf",
  });
});

test("preserves unknown fields on standard file and link nodes", () => {
  const source = JSON.parse(officialFormatFixture) as {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
  const file = source.nodes.find((node) => node.type === "file")!;
  const link = source.nodes.find((node) => node.type === "link")!;
  file.vendorFile = { cache: "keep" };
  link.vendorLink = ["keep", 42];

  const encoded = canvasDocumentToFile(canvasFileToDocument(source).document, {
    now: NOW,
  });
  assert.deepEqual(
    encoded.nodes.find((node) => node.id === "file-1")?.vendorFile,
    { cache: "keep" },
  );
  assert.deepEqual(
    encoded.nodes.find((node) => node.id === "link-1")?.vendorLink,
    ["keep", 42],
  );
});

test("uses current standard file fields without reviving stale marker data", () => {
  const source = canvasDocumentToFile(
    canvasFileToDocument(JSON.parse(officialFormatFixture) as unknown).document,
    { now: NOW },
  );
  const file = source.nodes.find((node) => node.type === "file")!;
  const marker = file.bamboo?.extensions?.jsonCanvas as Record<string, unknown>;
  marker.vendorMarker = { keep: true };
  delete file.subpath;

  const encoded = canvasDocumentToFile(canvasFileToDocument(source).document, {
    now: NOW,
  });
  const encodedFile = encoded.nodes.find((node) => node.type === "file")!;
  assert.equal(Object.hasOwn(encodedFile, "subpath"), false);
  assert.deepEqual(encodedFile.bamboo?.extensions?.jsonCanvas, {
    vendorMarker: { keep: true },
    type: "file",
    file: "papers/study.pdf",
  });
});

test("reports Bamboo projection and canonical node-kind mismatches", () => {
  const geometry = { x: 0, y: 0, width: 240, height: 96 };
  const parsed = canvasFileToDocument({
    version: 1,
    nodes: [
      {
        id: "file-as-text",
        type: "file",
        ...geometry,
        file: "paper.pdf",
        bamboo: { node: { kind: "text", data: { title: "paper.pdf" } } },
      },
      {
        id: "link-as-attachment",
        type: "link",
        ...geometry,
        url: "https://example.org",
        bamboo: {
          node: {
            kind: "attachment",
            data: { title: "https://example.org" },
          },
        },
      },
      {
        id: "group-as-claim",
        type: "group",
        ...geometry,
        label: "Boundary",
        bamboo: { node: { kind: "claim", content: "Boundary" } },
      },
      {
        id: "text-as-frame",
        type: "text",
        ...geometry,
        text: "Boundary",
        bamboo: { node: { kind: "frame", title: "Boundary" } },
      },
      {
        id: "valid-file",
        type: "file",
        ...geometry,
        file: "valid.pdf",
        bamboo: {
          node: { kind: "attachment", data: { title: "valid.pdf" } },
        },
      },
    ],
    edges: [],
    bamboo: {
      schemaVersion: 2,
      createdAt: NOW,
      updatedAt: NOW,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });

  assert.deepEqual(
    parsed.document.nodes.map((node) => node.id),
    ["valid-file"],
  );
  assert.deepEqual(
    parsed.issues.map((issue) => issue.code),
    Array.from({ length: 4 }, () => "malformed-node"),
  );
});

test("reports malformed standard file and link nodes without dropping valid peers", () => {
  const geometry = { x: 0, y: 0, width: 240, height: 96 };
  const parsed = canvasFileToDocument({
    nodes: [
      { id: "missing-file", type: "file", ...geometry },
      {
        id: "invalid-subpath",
        type: "file",
        ...geometry,
        file: "paper.pdf",
        subpath: 12,
      },
      { id: "missing-url", type: "link", ...geometry },
      { id: "invalid-url", type: "link", ...geometry, url: 42 },
      {
        id: "valid-link",
        type: "link",
        ...geometry,
        url: "https://example.org",
      },
    ],
  });

  assert.deepEqual(
    parsed.document.nodes.map((node) => node.id),
    ["valid-link"],
  );
  assert.deepEqual(
    parsed.issues.map((issue) => issue.code),
    Array.from({ length: 4 }, () => "malformed-node"),
  );
});

test("rejects unsupported Bamboo schema versions", () => {
  assert.throws(
    () =>
      canvasFileToDocument({
        version: 1,
        nodes: [],
        edges: [],
        bamboo: { schemaVersion: 3 },
      }),
    CanvasDocumentError,
  );
});

test("defaults omitted standard JSON Canvas node and edge arrays to empty", () => {
  assert.deepEqual(canvasFileToDocument({}).document.nodes, []);
  assert.deepEqual(canvasFileToDocument({}).document.connections, []);
  assert.deepEqual(
    canvasFileToDocument({ nodes: [] }).document.connections,
    [],
  );
  assert.deepEqual(canvasFileToDocument({ edges: [] }).document.nodes, []);
});

test("rejects malformed standard JSON Canvas arrays when they are present", () => {
  assert.throws(() => canvasFileToDocument({ nodes: {} }), CanvasDocumentError);
  assert.throws(
    () => canvasFileToDocument({ edges: null }),
    CanvasDocumentError,
  );
});

test("keeps version and required arrays strict for Bamboo canvas files", () => {
  const bamboo = {
    schemaVersion: 2,
    createdAt: NOW,
    updatedAt: NOW,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  assert.throws(
    () => canvasFileToDocument({ nodes: [], edges: [], bamboo }),
    CanvasDocumentError,
  );
  assert.throws(
    () => canvasFileToDocument({ version: 2, nodes: [], edges: [], bamboo }),
    CanvasDocumentError,
  );
  assert.throws(
    () => canvasFileToDocument({ version: 1, nodes: [], bamboo }),
    CanvasDocumentError,
  );
  assert.throws(
    () => canvasFileToDocument({ version: 1, edges: [], bamboo }),
    CanvasDocumentError,
  );
});

test("preserves own __proto__ extension fields without prototype mutation", () => {
  const source = JSON.parse(`{
    "nodes": [{
      "id": "text-1",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 240,
      "height": 72,
      "text": "Safe",
      "__proto__": {"nodeMarker": true},
      "bamboo": {
        "node": {
          "kind": "text",
          "data": {
            "title": "Safe",
            "__proto__": {"payloadMarker": true}
          },
          "settings": {"__proto__": {"payloadNested": true}}
        },
        "extensions": {
          "settings": {"__proto__": {"extensionNested": true}}
        },
        "settings": {"__proto__": {"siblingNested": true}}
      }
    }],
    "edges": [],
    "__proto__": {"rootMarker": true}
  }`) as Record<string, unknown>;

  const decoded = canvasFileToDocument(source).document;
  const node = decoded.nodes[0];
  assert.equal(Object.getPrototypeOf(decoded.extensions), Object.prototype);
  assert.equal(Object.getPrototypeOf(node.extensions), Object.prototype);
  assert.equal(
    Object.prototype.hasOwnProperty.call(decoded.extensions, "__proto__"),
    true,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(node.extensions, "__proto__"),
    true,
  );
  assert.deepEqual(decoded.extensions?.__proto__, { rootMarker: true });
  assert.deepEqual(node.extensions?.__proto__, { nodeMarker: true });

  const encoded = canvasDocumentToFile(decoded, { now: NOW });
  assert.deepEqual(encoded.__proto__, { rootMarker: true });
  assert.deepEqual(encoded.nodes[0].__proto__, { nodeMarker: true });
  assert.deepEqual(
    encoded.nodes[0].bamboo?.extensions?.data,
    JSON.parse('{"__proto__":{"payloadMarker":true}}'),
  );
  assert.deepEqual(
    encoded.nodes[0].bamboo?.extensions?.settings,
    JSON.parse(
      '{"__proto__":{"extensionNested":true,"siblingNested":true,"payloadNested":true}}',
    ),
  );
  assert.equal(({} as Record<string, unknown>).rootMarker, undefined);
  assert.equal(({} as Record<string, unknown>).nodeMarker, undefined);
  assert.equal(({} as Record<string, unknown>).payloadNested, undefined);
});

test("codec neutralizes sparse entries from Array.prototype", () => {
  const pollutedNode = {
    id: "array-prototype-node",
    type: "text",
    x: 0,
    y: 0,
    width: 240,
    height: 72,
    text: "Inherited",
  };
  let parsed: ReturnType<typeof canvasFileToDocument>;
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  try {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      value: pollutedNode,
      writable: true,
    });
    parsed = canvasFileToDocument({
      nodes: new Array(1),
      edges: [],
      items: new Array(1),
    });
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "0", previous);
    else delete (Array.prototype as unknown[])[0];
  }

  const items = parsed.document.extensions!.items as unknown[];
  assert.deepEqual(parsed.document.nodes, []);
  assert.deepEqual(
    parsed.issues.map((issue) => issue.code),
    ["malformed-node"],
  );
  assert.equal(Object.hasOwn(items, 0), true);
  assert.equal(items[0], undefined);
});

test("ignores inherited Bamboo envelopes and rejects inherited envelope fields", () => {
  const geometry = { x: 0, y: 0, width: 240, height: 72 };
  const inheritedNode = Object.assign(
    Object.create({
      bamboo: {
        node: { kind: "text", data: { title: "INHERITED" } },
        extensions: { polluted: true },
      },
    }) as Record<string, unknown>,
    {
      id: "standard-own",
      type: "text",
      ...geometry,
      text: "Own standard text",
    },
  );
  const inheritedEnvelope = Object.create({
    node: { kind: "text", data: { title: "INHERITED" } },
    extensions: { polluted: true },
  }) as Record<string, unknown>;
  const inheritedData = Object.create({ title: "INHERITED" }) as Record<
    string,
    unknown
  >;
  const parsed = canvasFileToDocument({
    nodes: [
      inheritedNode,
      {
        id: "invalid-envelope",
        type: "text",
        ...geometry,
        text: "Own projection",
        bamboo: inheritedEnvelope,
      },
      {
        id: "invalid-nested-payload",
        type: "text",
        ...geometry,
        text: "Own projection",
        bamboo: { node: { kind: "text", data: inheritedData } },
      },
    ],
    edges: [],
  });

  assert.deepEqual(
    parsed.document.nodes.map((node) => [node.id, node.kind]),
    [["standard-own", "text"]],
  );
  const own = parsed.document.nodes[0];
  assert.deepEqual(own.kind === "text" ? own.data : undefined, {
    title: "Own standard text",
  });
  assert.equal(own.extensions?.polluted, undefined);
  assert.deepEqual(
    parsed.issues.map((issue) => issue.code),
    ["malformed-node", "malformed-node"],
  );
});

test("rejects malformed required Bamboo root fields", () => {
  const validBamboo = {
    schemaVersion: 2,
    createdAt: NOW,
    updatedAt: NOW,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const invalidBambooValues = [
    { ...validBamboo, title: 42 },
    { ...validBamboo, createdAt: 42 },
    { ...validBamboo, updatedAt: 42 },
    { ...validBamboo, viewport: { x: Infinity, y: 0, zoom: 1 } },
    { ...validBamboo, viewport: { x: 0, y: NaN, zoom: 1 } },
    { ...validBamboo, viewport: { x: 0, y: 0, zoom: 0 } },
    { schemaVersion: 2 },
  ];

  for (const bamboo of invalidBambooValues) {
    assert.throws(
      () => canvasFileToDocument({ version: 1, nodes: [], edges: [], bamboo }),
      CanvasDocumentError,
    );
  }
});

test("reports malformed Bamboo-backed JSON Canvas node envelopes", () => {
  const geometry = { x: 0, y: 0, width: 240, height: 72 };
  const textPayload = {
    node: { kind: "text", data: { title: "Bamboo text" } },
  };
  const framePayload = { node: { kind: "frame", title: "Bamboo frame" } };
  const parsed = canvasFileToDocument({
    version: 1,
    nodes: [
      { id: "missing-type", ...geometry, text: "Text", bamboo: textPayload },
      {
        id: "invalid-type",
        type: "unknown",
        ...geometry,
        text: "Text",
        bamboo: textPayload,
      },
      { id: "missing-text", type: "text", ...geometry, bamboo: textPayload },
      {
        id: "invalid-text",
        type: "text",
        ...geometry,
        text: 42,
        bamboo: textPayload,
      },
      {
        id: "missing-label",
        type: "group",
        ...geometry,
        bamboo: framePayload,
      },
      {
        id: "invalid-label",
        type: "group",
        ...geometry,
        label: 42,
        bamboo: framePayload,
      },
      {
        id: "missing-file",
        type: "file",
        ...geometry,
        bamboo: textPayload,
      },
      {
        id: "missing-url",
        type: "link",
        ...geometry,
        bamboo: textPayload,
      },
      {
        id: "invalid-coordinate",
        type: "text",
        ...geometry,
        x: Infinity,
        text: "Text",
        bamboo: textPayload,
      },
      {
        id: "invalid-width",
        type: "text",
        ...geometry,
        width: 0,
        text: "Text",
        bamboo: textPayload,
      },
      {
        id: "valid-bamboo-text",
        type: "text",
        ...geometry,
        text: "Text",
        bamboo: textPayload,
      },
    ],
    edges: [],
  });

  assert.deepEqual(
    parsed.document.nodes.map((node) => node.id),
    ["missing-label", "valid-bamboo-text"],
  );
  assert.deepEqual(
    parsed.issues.map((issue) => issue.code),
    Array.from({ length: 9 }, () => "malformed-node"),
  );
});

test("returns recoverable issues for malformed individual records", () => {
  const result = canvasFileToDocument({
    version: 1,
    nodes: [
      { id: "bad-node", type: "text", x: 0, y: 0, width: 0, height: 72 },
      {
        id: "bad-bamboo-node",
        type: "text",
        x: 0,
        y: 0,
        width: 240,
        height: 72,
        text: "Bad extension",
        bamboo: 42,
      },
      {
        id: "bad-bamboo-extensions-node",
        type: "text",
        x: 0,
        y: 0,
        width: 240,
        height: 72,
        text: "Bad nested extension",
        bamboo: {
          node: { kind: "text", data: { title: "Bad nested extension" } },
          extensions: 42,
        },
      },
      {
        id: "missing-text",
        type: "text",
        x: 0,
        y: 0,
        width: 240,
        height: 72,
      },
      {
        id: "bad-group-label",
        type: "group",
        x: 0,
        y: 0,
        width: 240,
        height: 72,
        label: 42,
      },
      {
        type: "text",
        x: 0,
        y: 0,
        width: 240,
        height: 72,
        text: "Missing ID",
      },
      {
        id: "good-node",
        type: "text",
        x: 0,
        y: 0,
        width: 240,
        height: 72,
        text: "Good",
      },
    ],
    edges: [
      { id: "bad-edge", fromNode: "good-node", toNode: "missing" },
      {
        id: "bad-bamboo-edge",
        fromNode: "good-node",
        toNode: "good-node",
        bamboo: 42,
      },
      {
        id: "bad-bamboo-extensions-edge",
        fromNode: "good-node",
        toNode: "good-node",
        bamboo: { kind: "basic", extensions: 42 },
      },
      { fromNode: "good-node", toNode: "good-node" },
    ],
  });

  assert.deepEqual(
    result.document.nodes.map((node) => node.id),
    ["good-node"],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "malformed-node",
      "malformed-node",
      "malformed-node",
      "malformed-node",
      "malformed-node",
      "malformed-node",
      "dangling-connection",
      "malformed-connection",
      "malformed-connection",
      "malformed-connection",
    ],
  );
  assert.equal(
    result.issues.some((issue) => issue.id === undefined),
    true,
  );
});

test("rejects malformed root Bamboo extensions", () => {
  assert.throws(
    () =>
      canvasFileToDocument({
        version: 1,
        nodes: [],
        edges: [],
        bamboo: { schemaVersion: 2, extensions: 42 },
      }),
    CanvasDocumentError,
  );
});

test("rejects invalid reserved Bamboo namespaces during direct encoding", () => {
  assert.throws(
    () =>
      canvasDocumentToFile({
        version: 2,
        nodes: [],
        connections: [],
        extensions: { bamboo: "vendor" },
      }),
    CanvasDocumentError,
  );
});

test("rejects legacy xyflow documents instead of converting them", () => {
  assert.throws(
    () => parseStoredCanvas({ v: 1, engine: "xyflow", nodes: [], edges: [] }),
    CanvasDocumentError,
  );
});

test("serializes the canonical JSON Canvas format", () => {
  const encoded = JSON.parse(
    serializeCanvasDocument(document, { title: "Review", now: NOW }),
  ) as Record<string, unknown>;
  assert.equal(encoded.version, 1);
  assert.equal((encoded.bamboo as Record<string, unknown>).schemaVersion, 2);
});

test("connection sides survive JSON Canvas import, changing endpoints, and export", () => {
  const file = canvasDocumentToFile(document, { now: NOW });
  file.edges = [
    {
      id: "sides",
      fromNode: "lit-1",
      toNode: "quote-1",
      fromSide: "bottom",
      toSide: "top",
      label: "支持",
    },
  ];
  const parsed = canvasFileToDocument(file).document;
  assert.equal(parsed.connections[0].sourceHandle, "bottom");
  assert.equal(parsed.connections[0].targetHandle, "top");
  parsed.connections[0].targetHandle = "right";
  const saved = canvasDocumentToFile(parsed, { now: NOW });
  assert.equal(saved.edges[0].fromSide, "bottom");
  assert.equal(saved.edges[0].toSide, "right");
  assert.equal(saved.edges[0].label, "支持");
  assert.deepEqual(
    canvasFileToDocument(saved).document.connections,
    parsed.connections,
  );
});

test("standard arrow endpoints override stale Bamboo fields after external edits", () => {
  const source = parseCanvasDocument({
    version: 2,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: ["a", "b"].map((id) => ({
      id,
      kind: "note",
      position: { x: 0, y: 0 },
      width: 180,
      height: 120,
      content: id,
    })),
    connections: [
      {
        id: "edge",
        kind: "basic",
        source: "a",
        target: "b",
        arrow: true,
        startArrow: false,
      },
    ],
  });
  const file = canvasDocumentToFile(source.document);
  file.edges[0].fromEnd = "arrow";
  file.edges[0].toEnd = "none";
  const edited = canvasFileToDocument(file).document.connections[0];
  assert.equal(edited.arrow, false);
  assert.equal(edited.startArrow, true);
  const saved = canvasDocumentToFile(canvasFileToDocument(file).document);
  assert.equal(saved.edges[0].bamboo?.arrow, false);
  assert.equal(saved.edges[0].bamboo?.startArrow, true);

  delete file.edges[0].fromEnd;
  delete file.edges[0].toEnd;
  const legacy = canvasFileToDocument(file).document.connections[0];
  assert.equal(legacy.arrow, true);
  assert.equal(legacy.startArrow, false);
});

test("connection text formatting survives save and reload", () => {
  const textStyle = {
    fontSize: 24,
    fontWeight: "bold" as const,
    textColor: "#ff0000",
  };
  const doc = {
    ...document,
    connections: [{ ...document.connections[0], textStyle }],
  };
  const restored = parseStoredCanvas(serializeCanvasDocument(doc));
  assert.deepEqual(restored.document.connections[0].textStyle, textStyle);
});
