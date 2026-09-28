import type { AttachmentSource } from "./academic";
import type { CanvasNodeBase, CanvasPoint } from "./core";

export type BasicNodeKind =
  | "item"
  | "pdf"
  | "attachment"
  | "text"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow";

export interface ItemNodeData {
  title: string;
  subtitle?: string;
  preview?: string;
  itemID?: number;
}

interface AttachmentPreviewData extends Record<string, unknown> {
  /** Original bytes as a bounded base64 data URL for offline canvas round trips. */
  fileData?: string;
  /** Safe raster (or legacy inert SVG) preview data URL. */
  image?: string;
  size?: number;
  imageWidth?: number;
  imageHeight?: number;
  pageCount?: number;
}

export interface PdfNodeData extends AttachmentPreviewData {
  title: string;
  subtitle?: string;
  preview?: string;
  itemID?: number;
  attachmentID?: number;
  pdfPage?: number;
  image?: string;
  asset?: string;
  source?: AttachmentSource;
  availability?: "available" | "not-downloaded";
  contentType?: string;
}

export interface AttachmentNodeData extends AttachmentPreviewData {
  title: string;
  subtitle?: string;
  preview?: string;
  itemID?: number;
  attachmentID?: number;
  source?: AttachmentSource;
  availability?: "available" | "not-downloaded";
  contentType?: string;
}

export interface TextNodeData {
  title: string;
}

export interface ShapeNodeData {
  title: string;
}

export interface LineNodeData extends ShapeNodeData {
  from?: CanvasPoint;
  to?: CanvasPoint;
}

export interface ItemNode extends CanvasNodeBase<"item"> {
  data: ItemNodeData;
}

export interface PdfNode extends CanvasNodeBase<"pdf"> {
  data: PdfNodeData;
}

export interface AttachmentNode extends CanvasNodeBase<"attachment"> {
  data: AttachmentNodeData;
}

export interface TextNode extends CanvasNodeBase<"text"> {
  data: TextNodeData;
}

export interface RectNode extends CanvasNodeBase<"rect"> {
  data: ShapeNodeData;
}

export interface EllipseNode extends CanvasNodeBase<"ellipse"> {
  data: ShapeNodeData;
}

export interface LineNode extends CanvasNodeBase<"line"> {
  data: LineNodeData;
}

export interface ArrowNode extends CanvasNodeBase<"arrow"> {
  data: LineNodeData;
}

export type BasicNode =
  | ItemNode
  | PdfNode
  | AttachmentNode
  | TextNode
  | RectNode
  | EllipseNode
  | LineNode
  | ArrowNode;

const BASIC_NODE_DEFAULTS: Record<
  BasicNodeKind,
  Pick<BasicNode, "width" | "height" | "style"> & { data: BasicNode["data"] }
> = {
  item: {
    width: 240,
    height: 96,
    data: { title: "New item", subtitle: "Zotero item" },
  },
  pdf: {
    width: 240,
    height: 220,
    data: { title: "PDF page", subtitle: "Page 1", pdfPage: 1 },
  },
  attachment: {
    width: 240,
    height: 96,
    data: { title: "Attachment", subtitle: "File" },
  },
  text: { width: 240, height: 72, data: { title: "Text" } },
  rect: {
    width: 140,
    height: 88,
    data: { title: "" },
    style: { stroke: "#1f2937", fill: "#ffffff", strokeWidth: 2, radius: 8 },
  },
  ellipse: {
    width: 140,
    height: 88,
    data: { title: "" },
    style: { stroke: "#1f2937", fill: "#ffffff", strokeWidth: 2 },
  },
  line: {
    width: 160,
    height: 32,
    data: { title: "" },
    style: { stroke: "#1f2937", strokeWidth: 2 },
  },
  arrow: {
    width: 160,
    height: 32,
    data: { title: "" },
    style: { stroke: "#1f2937", strokeWidth: 2 },
  },
};

export function createBasicNode<K extends BasicNodeKind>(
  kind: K,
  position: CanvasPoint,
  id: string,
): Extract<BasicNode, { kind: K }> {
  const defaults = BASIC_NODE_DEFAULTS[kind];
  return {
    id,
    kind,
    position,
    width: defaults.width,
    height: defaults.height,
    ...(defaults.style ? { style: { ...defaults.style } } : {}),
    data: { ...defaults.data },
  } as Extract<BasicNode, { kind: K }>;
}
