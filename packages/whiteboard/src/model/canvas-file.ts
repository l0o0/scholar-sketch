import type { AcademicNode } from "./academic";
import type { CanvasNode } from "./academic";
import { isConnectionSide, type CanvasConnection } from "./connection";
import {
  CANVAS_DOCUMENT_VERSION,
  CanvasDocumentError,
  parseCanvasDocument,
  type CanvasDocument,
  type CanvasParseIssue,
} from "./document";
import type { CanvasNodeStyle, CanvasViewport } from "./core";

export const JSON_CANVAS_VERSION = 1 as const;
const BAMBOO_SCHEMA_VERSION = 2 as const;

export interface CanvasFileNode extends Record<string, unknown> {
  id: string;
  type: "text" | "group" | "file" | "link";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: string;
  file?: string;
  subpath?: string;
  url?: string;
  bamboo?: {
    node?: Record<string, unknown>;
    frameId?: string;
    extensions?: Record<string, unknown>;
  };
}

export interface CanvasFileEdge extends Record<string, unknown> {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  label?: string;
  color?: string;
  bamboo?: {
    kind?: "basic" | "academic";
    relation?: "related" | "supports" | "contradicts";
    sourceHandle?: string | null;
    targetHandle?: string | null;
    dashed?: boolean;
    arrow?: boolean;
    startArrow?: boolean;
    textStyle?: CanvasNodeStyle;
    extensions?: Record<string, unknown>;
  };
}

export interface CanvasFile extends Record<string, unknown> {
  version: typeof JSON_CANVAS_VERSION;
  nodes: CanvasFileNode[];
  edges: CanvasFileEdge[];
  bamboo: {
    schemaVersion: typeof BAMBOO_SCHEMA_VERSION;
    title?: string;
    createdAt: string;
    updatedAt: string;
    viewport: CanvasViewport;
    extensions?: Record<string, unknown>;
  };
}

export interface CanvasFileOptions {
  title?: string;
  now?: string;
}

export interface ParsedCanvasFile {
  document: CanvasDocument;
  issues: CanvasParseIssue[];
}

const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };
const BAMBOO_EXTENSION_KEY = "bamboo";
const JSON_CANVAS_NODE_EXTENSION_KEY = "jsonCanvas";
const JSON_CANVAS_NODE_EXTENSION_FIELDS = [
  "type",
  "file",
  "subpath",
  "url",
] as const;

function cloneOwnInput(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior;
  if (Array.isArray(value)) {
    const clone: unknown[] = new Array(value.length);
    seen.set(value, clone);
    for (let index = 0; index < value.length; index += 1) {
      const item = Object.prototype.hasOwnProperty.call(value, index)
        ? cloneOwnInput(value[index], seen)
        : undefined;
      defineOwn(clone, String(index), item);
    }
    return clone;
  }
  const clone = Object.create(null) as Record<string, unknown>;
  seen.set(value, clone);
  for (const [key, fieldValue] of Object.entries(value)) {
    defineOwn(clone, key, cloneOwnInput(fieldValue, seen));
  }
  return clone;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = Object.create(null) as Record<string, unknown>;
  for (const [key, fieldValue] of Object.entries(value)) {
    defineOwn(record, key, fieldValue);
  }
  return record;
}

function withoutKeys(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  const blocked = new Set(keys);
  const entries = Object.entries(source).filter(([key]) => !blocked.has(key));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function mergeRecords(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const record of records) {
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      const current = has(result, key) ? asRecord(result[key]) : undefined;
      const incoming = asRecord(value);
      defineOwn(
        result,
        key,
        incoming ? (mergeRecords(current, incoming) ?? {}) : value,
      );
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function defineOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function has(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isViewport(value: unknown): value is CanvasViewport {
  const viewport = asRecord(value);
  return Boolean(
    viewport &&
    isFiniteNumber(viewport.x) &&
    isFiniteNumber(viewport.y) &&
    isFiniteNumber(viewport.zoom) &&
    viewport.zoom > 0,
  );
}

function hasValidBambooNodeEnvelope(node: Record<string, unknown>): boolean {
  if (
    node.type !== "text" &&
    node.type !== "group" &&
    node.type !== "file" &&
    node.type !== "link"
  ) {
    return false;
  }
  if (
    !isFiniteNumber(node.x) ||
    !isFiniteNumber(node.y) ||
    !isFiniteNumber(node.width) ||
    node.width <= 0 ||
    !isFiniteNumber(node.height) ||
    node.height <= 0
  ) {
    return false;
  }
  if (node.type === "text") return typeof node.text === "string";
  if (node.type === "group") {
    return node.label === undefined || typeof node.label === "string";
  }
  if (node.type === "file") {
    return (
      typeof node.file === "string" &&
      (node.subpath === undefined || typeof node.subpath === "string")
    );
  }
  return typeof node.url === "string";
}

function standardExtensions(
  extensions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return extensions
    ? withoutKeys(extensions, [BAMBOO_EXTENSION_KEY])
    : undefined;
}

function bambooExtensions(
  extensions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extensions || !has(extensions, BAMBOO_EXTENSION_KEY)) return undefined;
  const bamboo = asRecord(extensions[BAMBOO_EXTENSION_KEY]);
  if (!bamboo) {
    throw new CanvasDocumentError(
      "Canvas document Bamboo extensions must be an object.",
    );
  }
  return mergeRecords(bamboo);
}

function decodedExtensions(
  standard: Record<string, unknown> | undefined,
  bamboo: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return mergeRecords(
    standard,
    bamboo ? { [BAMBOO_EXTENSION_KEY]: bamboo } : undefined,
  );
}

function academicText(node: AcademicNode): string {
  switch (node.kind) {
    case "literature":
      return [node.snapshot.title, node.snapshot.creators, node.snapshot.year]
        .filter(Boolean)
        .join("\n\n");
    case "quote":
      return [
        node.snapshot.text,
        node.snapshot.citation,
        node.snapshot.pageLabel,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "note":
      return node.content;
    case "frame":
      return node.title;
  }
}

interface PayloadSchema {
  [key: string]: true | PayloadSchema;
}

const POINT_SCHEMA: PayloadSchema = { x: true, y: true };
const LIBRARY_SCHEMA: PayloadSchema = { type: true, groupID: true };
const STYLE_SCHEMA: PayloadSchema = {
  shape: true,
  stroke: true,
  fill: true,
  strokeWidth: true,
  radius: true,
  dashed: true,
  fontFamily: true,
  fontSize: true,
  fontWeight: true,
  fontStyle: true,
  textDecoration: true,
  textAlign: true,
  verticalAlign: true,
  textColor: true,
  textOpacity: true,
  strokeOpacity: true,
  fillStyle: true,
  strokeStyle: true,
};

function payloadSchema(kind: unknown): PayloadSchema | undefined {
  const common: PayloadSchema = { kind: true, style: STYLE_SCHEMA };
  const itemData: PayloadSchema = {
    title: true,
    subtitle: true,
    preview: true,
    itemID: true,
  };
  const attachmentData: PayloadSchema = {
    ...itemData,
    attachmentID: true,
    source: { library: LIBRARY_SCHEMA, attachmentKey: true },
    contentType: true,
    availability: true,
    fileData: true,
    image: true,
    size: true,
    imageWidth: true,
    imageHeight: true,
    pageCount: true,
  };
  switch (kind) {
    case "item":
      return { ...common, data: itemData };
    case "pdf":
      return {
        ...common,
        data: {
          ...attachmentData,
          pdfPage: true,
          asset: true,
        },
      };
    case "attachment":
      return { ...common, data: attachmentData };
    case "text":
    case "rect":
    case "ellipse":
      return { ...common, data: { title: true } };
    case "line":
    case "arrow":
      return {
        ...common,
        data: { title: true, from: POINT_SCHEMA, to: POINT_SCHEMA },
      };
    case "literature":
      return {
        ...common,
        source: { library: LIBRARY_SCHEMA, itemKey: true },
        snapshot: {
          title: true,
          creators: true,
          year: true,
          publicationTitle: true,
          tags: true,
          annotationCount: true,
        },
      };
    case "quote":
      return {
        ...common,
        source: {
          library: LIBRARY_SCHEMA,
          itemKey: true,
          attachmentKey: true,
          annotationKey: true,
        },
        snapshot: {
          text: true,
          comment: true,
          citation: true,
          pageLabel: true,
          color: true,
        },
      };
    case "note":
      return {
        ...common,
        content: true,
        badge: true,
        noteType: true,
        source: {
          library: LIBRARY_SCHEMA,
          noteKey: true,
          itemKey: true,
        },
        sourceSnapshot: { title: true },
      };
    case "frame":
      return { ...common, title: true };
    default:
      return undefined;
  }
}

function unknownPayloadFields(
  value: Record<string, unknown>,
  schema: PayloadSchema,
): Record<string, unknown> | undefined {
  const unknown: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const fieldSchema = has(schema, key) ? schema[key] : undefined;
    if (!fieldSchema) {
      defineOwn(unknown, key, fieldValue);
      continue;
    }
    if (fieldSchema === true) continue;
    const fieldRecord = asRecord(fieldValue);
    if (!fieldRecord) continue;
    const nested = unknownPayloadFields(fieldRecord, fieldSchema);
    if (nested) defineOwn(unknown, key, nested);
  }
  return Object.keys(unknown).length ? unknown : undefined;
}

function unknownNodePayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  const schema = payloadSchema(payload.kind);
  return schema ? unknownPayloadFields(payload, schema) : undefined;
}

function basicText(node: Exclude<CanvasNode, AcademicNode>): string {
  return "data" in node
    ? [
        node.data.title,
        "subtitle" in node.data ? node.data.subtitle : undefined,
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
}

function nodePayload(node: CanvasNode): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...node };
  delete payload.id;
  delete payload.position;
  delete payload.width;
  delete payload.height;
  delete payload.frameId;
  delete payload.extensions;
  return payload;
}

type JsonCanvasNodeExtension =
  | { type: "file"; file: string; subpath?: string }
  | { type: "link"; url: string };

function parseJsonCanvasNodeExtension(
  extensions: Record<string, unknown> | undefined,
): JsonCanvasNodeExtension | undefined {
  const marker =
    extensions && has(extensions, JSON_CANVAS_NODE_EXTENSION_KEY)
      ? asRecord(extensions[JSON_CANVAS_NODE_EXTENSION_KEY])
      : undefined;
  if (!marker) return undefined;
  const type = has(marker, "type") ? marker.type : undefined;
  const file = has(marker, "file") ? marker.file : undefined;
  const subpath = has(marker, "subpath") ? marker.subpath : undefined;
  const url = has(marker, "url") ? marker.url : undefined;
  if (
    type === "file" &&
    typeof file === "string" &&
    (subpath === undefined || typeof subpath === "string")
  ) {
    return {
      type: "file",
      file,
      ...(typeof subpath === "string" ? { subpath } : {}),
    };
  }
  return type === "link" && typeof url === "string"
    ? { type: "link", url }
    : undefined;
}

function sourceNodeExtension(
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (
    has(raw, "type") &&
    raw.type === "file" &&
    has(raw, "file") &&
    typeof raw.file === "string" &&
    (!has(raw, "subpath") || typeof raw.subpath === "string")
  ) {
    return {
      [JSON_CANVAS_NODE_EXTENSION_KEY]: {
        type: "file",
        file: raw.file,
        ...(typeof raw.subpath === "string" ? { subpath: raw.subpath } : {}),
      },
    };
  }
  return has(raw, "type") &&
    raw.type === "link" &&
    has(raw, "url") &&
    typeof raw.url === "string"
    ? {
        [JSON_CANVAS_NODE_EXTENSION_KEY]: {
          type: "link",
          url: raw.url,
        },
      }
    : undefined;
}

function mergeSourceNodeExtension(
  decodedBamboo: Record<string, unknown> | undefined,
  payload: Record<string, unknown> | undefined,
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = mergeRecords(decodedBamboo, unknownNodePayload(payload));
  const source = sourceNodeExtension(raw);
  if (!source) return merged;
  const sourceMarker = asRecord(source[JSON_CANVAS_NODE_EXTENSION_KEY])!;
  const previousMarker =
    merged && has(merged, JSON_CANVAS_NODE_EXTENSION_KEY)
      ? asRecord(merged[JSON_CANVAS_NODE_EXTENSION_KEY])
      : undefined;
  const marker = mergeRecords(
    previousMarker
      ? withoutKeys(previousMarker, JSON_CANVAS_NODE_EXTENSION_FIELDS)
      : undefined,
    sourceMarker,
  )!;
  const result = merged ?? {};
  defineOwn(result, JSON_CANVAS_NODE_EXTENSION_KEY, marker);
  return result;
}

function hasMatchingBambooProjection(
  raw: Record<string, unknown>,
  payload: Record<string, unknown> | undefined,
  extensions: Record<string, unknown> | undefined,
): boolean {
  const source = parseJsonCanvasNodeExtension(extensions);
  const projectedType =
    payload?.kind === "frame"
      ? "group"
      : payload?.kind === "attachment" && source?.type === "file"
        ? "file"
        : payload?.kind === "text" && source?.type === "link"
          ? "link"
          : "text";
  return raw.type === projectedType;
}

function toCanvasNode(node: CanvasNode): CanvasFileNode {
  const extensions = bambooExtensions(node.extensions);
  const source = parseJsonCanvasNodeExtension(extensions);
  const frameId = "frameId" in node ? node.frameId : undefined;
  const bamboo = {
    node: nodePayload(node),
    ...(frameId !== undefined ? { frameId } : {}),
    ...(extensions ? { extensions } : {}),
  };
  if (node.kind === "frame") {
    return {
      ...(standardExtensions(node.extensions) ?? {}),
      id: node.id,
      type: "group",
      x: node.position.x,
      y: node.position.y,
      width: node.width,
      height: node.height,
      label: node.title,
      bamboo,
    };
  }
  if (node.kind === "attachment" && source?.type === "file") {
    return {
      ...(standardExtensions(node.extensions) ?? {}),
      id: node.id,
      type: "file",
      x: node.position.x,
      y: node.position.y,
      width: node.width,
      height: node.height,
      file: source.file,
      ...(source.subpath !== undefined ? { subpath: source.subpath } : {}),
      bamboo,
    };
  }
  if (node.kind === "text" && source?.type === "link") {
    return {
      ...(standardExtensions(node.extensions) ?? {}),
      id: node.id,
      type: "link",
      x: node.position.x,
      y: node.position.y,
      width: node.width,
      height: node.height,
      url: source.url,
      bamboo,
    };
  }
  return {
    ...(standardExtensions(node.extensions) ?? {}),
    id: node.id,
    type: "text",
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
    text:
      node.kind === "literature" ||
      node.kind === "quote" ||
      node.kind === "note"
        ? academicText(node)
        : basicText(node),
    bamboo,
  };
}

function toCanvasEdge(connection: CanvasConnection): CanvasFileEdge {
  const extensions = bambooExtensions(connection.extensions);
  return {
    ...(standardExtensions(connection.extensions) ?? {}),
    id: connection.id,
    fromNode: connection.source,
    toNode: connection.target,
    ...(isConnectionSide(connection.sourceHandle)
      ? { fromSide: connection.sourceHandle }
      : {}),
    ...(isConnectionSide(connection.targetHandle)
      ? { toSide: connection.targetHandle }
      : {}),
    ...(connection.startArrow !== undefined
      ? { fromEnd: connection.startArrow ? "arrow" : "none" }
      : {}),
    ...(connection.arrow !== undefined
      ? { toEnd: connection.arrow ? "arrow" : "none" }
      : {}),
    ...(connection.label !== undefined ? { label: connection.label } : {}),
    ...(connection.color !== undefined ? { color: connection.color } : {}),
    bamboo: {
      kind: connection.kind,
      ...(connection.textStyle ? { textStyle: connection.textStyle } : {}),
      ...(connection.kind === "academic"
        ? { relation: connection.relation }
        : {}),
      ...(connection.sourceHandle !== undefined
        ? { sourceHandle: connection.sourceHandle }
        : {}),
      ...(connection.targetHandle !== undefined
        ? { targetHandle: connection.targetHandle }
        : {}),
      ...(connection.dashed !== undefined ? { dashed: connection.dashed } : {}),
      ...(connection.arrow !== undefined ? { arrow: connection.arrow } : {}),
      ...(connection.startArrow !== undefined
        ? { startArrow: connection.startArrow }
        : {}),
      ...(extensions ? { extensions } : {}),
    },
  };
}

export function canvasDocumentToFile(
  document: CanvasDocument,
  options: CanvasFileOptions = {},
): CanvasFile {
  const now = options.now ?? new Date().toISOString();
  const title = options.title ?? document.metadata?.title;
  const extensions = bambooExtensions(document.extensions);
  return {
    ...(standardExtensions(document.extensions) ?? {}),
    version: JSON_CANVAS_VERSION,
    nodes: document.nodes.map(toCanvasNode),
    edges: document.connections.map(toCanvasEdge),
    bamboo: {
      schemaVersion: BAMBOO_SCHEMA_VERSION,
      ...(title !== undefined ? { title } : {}),
      createdAt: document.metadata?.createdAt ?? now,
      updatedAt: now,
      viewport: { ...(document.viewport ?? DEFAULT_VIEWPORT) },
      ...(extensions ? { extensions } : {}),
    },
  };
}

const INVALID_EXTENSIONS = Symbol("invalid-extensions");

function decodedBambooExtensions(
  bamboo: Record<string, unknown> | undefined,
  knownKeys: readonly string[],
): Record<string, unknown> | undefined | typeof INVALID_EXTENSIONS {
  if (bamboo && has(bamboo, "extensions") && !asRecord(bamboo.extensions)) {
    return INVALID_EXTENSIONS;
  }
  return mergeRecords(
    asRecord(bamboo?.extensions),
    bamboo ? withoutKeys(bamboo, [...knownKeys, "extensions"]) : undefined,
  );
}

function decodeNode(value: unknown): unknown {
  const raw = asRecord(value);
  if (!raw) return value;
  const bamboo = asRecord(raw.bamboo);
  const payload = asRecord(bamboo?.node);
  const standard = withoutKeys(raw, [
    "id",
    "type",
    "x",
    "y",
    "width",
    "height",
    "bamboo",
    ...(raw.type === "text" ? ["text"] : []),
    ...(raw.type === "group" ? ["label"] : []),
    ...(raw.type === "file" ? ["file", "subpath"] : []),
    ...(raw.type === "link" ? ["url"] : []),
  ]);
  const decodedBamboo = decodedBambooExtensions(bamboo, ["node", "frameId"]);
  const mergedBamboo =
    decodedBamboo === INVALID_EXTENSIONS
      ? undefined
      : mergeSourceNodeExtension(decodedBamboo, payload, raw);
  const extensions = decodedExtensions(standard, mergedBamboo);
  const base = {
    id: raw.id,
    position: { x: raw.x, y: raw.y },
    width: raw.width,
    height: raw.height,
    ...(extensions ? { extensions } : {}),
  };

  if (
    (raw.bamboo !== undefined && !bamboo) ||
    decodedBamboo === INVALID_EXTENSIONS
  ) {
    return base;
  }
  if (bamboo) {
    if (
      !hasValidBambooNodeEnvelope(raw) ||
      !hasMatchingBambooProjection(raw, payload, mergedBamboo)
    ) {
      return base;
    }
    return {
      ...(payload ?? {}),
      ...base,
      ...(bamboo.frameId !== undefined ? { frameId: bamboo.frameId } : {}),
    };
  }
  if (raw.type === "text") {
    if (typeof raw.text !== "string") return base;
    return {
      ...base,
      kind: "text",
      data: {
        title: raw.text,
      },
    };
  }
  if (raw.type === "group") {
    if (raw.label !== undefined && typeof raw.label !== "string") return base;
    return {
      ...base,
      kind: "frame",
      title: typeof raw.label === "string" ? raw.label : "",
    };
  }
  if (raw.type === "file") {
    if (
      typeof raw.file !== "string" ||
      (raw.subpath !== undefined && typeof raw.subpath !== "string")
    ) {
      return base;
    }
    return {
      ...base,
      kind: "attachment",
      data: {
        title: raw.file,
      },
    };
  }
  if (raw.type === "link") {
    if (typeof raw.url !== "string") return base;
    return {
      ...base,
      kind: "text",
      data: { title: raw.url },
    };
  }
  return base;
}

function decodeEdge(value: unknown): unknown {
  const raw = asRecord(value);
  if (!raw) return value;
  const bamboo = asRecord(raw.bamboo);
  const standardFromEnd =
    raw.fromEnd === "none" || raw.fromEnd === "arrow" ? raw.fromEnd : undefined;
  const standardToEnd =
    raw.toEnd === "none" || raw.toEnd === "arrow" ? raw.toEnd : undefined;
  const standard = withoutKeys(raw, [
    "id",
    "fromNode",
    "toNode",
    "fromSide",
    "toSide",
    ...(standardFromEnd !== undefined ? ["fromEnd"] : []),
    ...(standardToEnd !== undefined ? ["toEnd"] : []),
    "label",
    "color",
    "bamboo",
  ]);
  const decodedBamboo = decodedBambooExtensions(bamboo, [
    "kind",
    "relation",
    "sourceHandle",
    "targetHandle",
    "dashed",
    "arrow",
    "startArrow",
    "textStyle",
  ]);
  const extensions = decodedExtensions(
    standard,
    decodedBamboo === INVALID_EXTENSIONS ? undefined : decodedBamboo,
  );
  return {
    id: raw.id,
    kind:
      (raw.bamboo !== undefined && !bamboo) ||
      decodedBamboo === INVALID_EXTENSIONS
        ? undefined
        : (bamboo?.kind ?? "basic"),
    source: raw.fromNode,
    target: raw.toNode,
    ...(bamboo?.relation !== undefined ? { relation: bamboo.relation } : {}),
    ...(bamboo?.sourceHandle !== undefined
      ? { sourceHandle: bamboo.sourceHandle }
      : isConnectionSide(raw.fromSide)
        ? { sourceHandle: raw.fromSide }
        : {}),
    ...(bamboo?.targetHandle !== undefined
      ? { targetHandle: bamboo.targetHandle }
      : isConnectionSide(raw.toSide)
        ? { targetHandle: raw.toSide }
        : {}),
    ...(bamboo?.textStyle !== undefined ? { textStyle: bamboo.textStyle } : {}),
    ...(raw.label !== undefined ? { label: raw.label } : {}),
    ...(raw.color !== undefined ? { color: raw.color } : {}),
    ...(bamboo?.dashed !== undefined ? { dashed: bamboo.dashed } : {}),
    ...(standardToEnd !== undefined
      ? { arrow: standardToEnd === "arrow" }
      : bamboo?.arrow !== undefined
        ? { arrow: bamboo.arrow }
        : {}),
    ...(standardFromEnd !== undefined
      ? { startArrow: standardFromEnd === "arrow" }
      : bamboo?.startArrow !== undefined
        ? { startArrow: bamboo.startArrow }
        : {}),
    ...(extensions ? { extensions } : {}),
  };
}

export function canvasFileToDocument(value: unknown): ParsedCanvasFile {
  const file = asRecord(cloneOwnInput(value));
  if (!file) throw new CanvasDocumentError("Canvas file must be an object.");
  if (file.v === 1 && file.engine === "xyflow") {
    throw new CanvasDocumentError(
      "Legacy xyflow canvas files are unsupported.",
    );
  }
  const bamboo = asRecord(file.bamboo);
  if (file.bamboo !== undefined && !bamboo) {
    throw new CanvasDocumentError("Canvas file Bamboo data must be an object.");
  }
  if (bamboo && file.version !== JSON_CANVAS_VERSION) {
    throw new CanvasDocumentError("Bamboo JSON Canvas version must be 1.");
  }
  if (
    (bamboo && (!Array.isArray(file.nodes) || !Array.isArray(file.edges))) ||
    (!bamboo &&
      ((has(file, "nodes") && !Array.isArray(file.nodes)) ||
        (has(file, "edges") && !Array.isArray(file.edges))))
  ) {
    throw new CanvasDocumentError(
      "Canvas file nodes and edges must be arrays when present.",
    );
  }
  if (bamboo && bamboo.schemaVersion !== BAMBOO_SCHEMA_VERSION) {
    throw new CanvasDocumentError("Bamboo schema version must be 2.");
  }
  if (
    bamboo &&
    ((bamboo.title !== undefined && typeof bamboo.title !== "string") ||
      typeof bamboo.createdAt !== "string" ||
      typeof bamboo.updatedAt !== "string" ||
      !isViewport(bamboo.viewport))
  ) {
    throw new CanvasDocumentError("Canvas file Bamboo metadata is malformed.");
  }

  const standard = withoutKeys(file, ["version", "nodes", "edges", "bamboo"]);
  const decodedBamboo = decodedBambooExtensions(bamboo, [
    "schemaVersion",
    "title",
    "createdAt",
    "updatedAt",
    "viewport",
  ]);
  if (decodedBamboo === INVALID_EXTENSIONS) {
    throw new CanvasDocumentError(
      "Canvas file Bamboo extensions must be an object.",
    );
  }
  const extensions = decodedExtensions(standard, decodedBamboo);
  const nodes = Array.isArray(file.nodes) ? file.nodes : [];
  const edges = Array.isArray(file.edges) ? file.edges : [];
  return parseCanvasDocument({
    version: CANVAS_DOCUMENT_VERSION,
    nodes: nodes.map(decodeNode),
    connections: edges.map(decodeEdge),
    ...(bamboo?.viewport !== undefined ? { viewport: bamboo.viewport } : {}),
    ...(bamboo
      ? {
          metadata: {
            ...(bamboo.title !== undefined ? { title: bamboo.title } : {}),
            ...(bamboo.createdAt !== undefined
              ? { createdAt: bamboo.createdAt }
              : {}),
            ...(bamboo.updatedAt !== undefined
              ? { updatedAt: bamboo.updatedAt }
              : {}),
          },
        }
      : {}),
    ...(extensions ? { extensions } : {}),
  });
}

export function parseStoredCanvas(value: unknown): ParsedCanvasFile {
  if (typeof value !== "string") return canvasFileToDocument(value);
  try {
    return canvasFileToDocument(JSON.parse(value) as unknown);
  } catch (error) {
    if (error instanceof CanvasDocumentError) throw error;
    throw new CanvasDocumentError("Canvas file must contain valid JSON.");
  }
}

export function serializeCanvasDocument(
  document: CanvasDocument,
  options: CanvasFileOptions = {},
): string {
  return `${JSON.stringify(canvasDocumentToFile(document, options), null, 2)}\n`;
}
