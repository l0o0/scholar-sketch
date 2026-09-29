import type { CanvasDocument } from "./snapshot";
import {
  decodeAttachmentDataUrl,
  inferAttachmentContentType,
  isValidAttachmentDataUrl,
  MAX_ATTACHMENT_BYTES,
} from "../../../packages/whiteboard/src/model/file-attachment";

export { inferAttachmentContentType, MAX_ATTACHMENT_BYTES };

export interface EmbeddedFileData {
  title: string;
  contentType: string;
  size: number;
  fileData: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  preview?: string;
  pageCount?: number;
}

export interface DecodedEmbeddedFile {
  title: string;
  contentType: string;
  size: number;
  bytes: Uint8Array;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "application/json": "json",
  "application/msword": "doc",
  "application/pdf": "pdf",
  "application/rtf": "rtf",
  "application/gzip": "gz",
  "application/x-7z-compressed": "7z",
  "application/x-tar": "tar",
  "application/xml": "xml",
  "application/zip": "zip",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "text/csv": "csv",
  "text/css": "css",
  "text/html": "html",
  "text/javascript": "js",
  "text/markdown": "md",
  "text/plain": "txt",
  "text/xml": "xml",
  "video/mp4": "mp4",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function dataUrlContentType(value: string): string | undefined {
  return /^data:([^;,\s]+);base64,/s.exec(value)?.[1]?.toLowerCase();
}

export function decodeBase64DataURL(
  value: string,
): { bytes: Uint8Array; contentType: string } | null {
  const bytes = decodeAttachmentDataUrl(value);
  const contentType = dataUrlContentType(value);
  return bytes && contentType ? { bytes, contentType } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function decodeEmbeddedFileData(
  value: unknown,
  maxBytes = MAX_ATTACHMENT_BYTES,
): DecodedEmbeddedFile | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.title !== "string" ||
    typeof value.contentType !== "string" ||
    typeof value.fileData !== "string" ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    (value.size as number) > maxBytes ||
    !isValidAttachmentDataUrl(value.fileData, maxBytes)
  ) {
    return null;
  }
  const dataUrlType = dataUrlContentType(value.fileData);
  const suppliedType = value.contentType.trim().toLowerCase().split(";", 1)[0];
  if (
    !dataUrlType ||
    !suppliedType ||
    (suppliedType !== "application/octet-stream" &&
      suppliedType !== dataUrlType)
  ) {
    return null;
  }
  const bytes = decodeAttachmentDataUrl(value.fileData, maxBytes);
  if (!bytes || bytes.byteLength !== value.size) return null;
  return {
    title: value.title,
    contentType: inferAttachmentContentType(value.title, value.contentType),
    size: value.size,
    bytes,
  };
}

const ACTIVE_CONTENT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/ecmascript",
  "text/html",
  "text/javascript",
]);

export function isPotentiallyActiveFile(contentType: string): boolean {
  return ACTIVE_CONTENT_TYPES.has(
    contentType.trim().toLowerCase().split(";", 1)[0] || "",
  );
}

export function requiresExplicitSave(
  title: string,
  contentType: string,
): boolean {
  const mime = contentType.trim().toLowerCase().split(";", 1)[0] || "";
  const titleMime = inferAttachmentContentType(title);
  return (
    isPotentiallyActiveFile(mime) ||
    isPotentiallyActiveFile(titleMime) ||
    !MIME_EXTENSIONS[mime]
  );
}

function sanitizeBaseName(title: string): string {
  const basename = title.replace(/\\/g, "/").split("/").pop() || "file";
  return (
    basename
      // Control characters cannot be part of a materialized attachment filename.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[<>:"|?*]/g, "_")
      .trim()
      .replace(/^\.+$/, "")
      .slice(0, 120) || "file"
  );
}

export function safeEmbeddedFilename(
  title: string,
  contentType: string,
  options: { forOpen?: boolean } = {},
): string {
  const mime = contentType.trim().toLowerCase().split(";", 1)[0] || "";
  const sanitized = sanitizeBaseName(title);
  if (!options.forOpen && !MIME_EXTENSIONS[mime]) return sanitized;
  const extension =
    options.forOpen && isPotentiallyActiveFile(mime)
      ? "bin"
      : MIME_EXTENSIONS[mime];
  const base = sanitized.replace(/\.[^.]*$/, "");
  return `${base || "file"}.${extension || "bin"}`;
}

export function isEmbeddedFileData(value: unknown): value is EmbeddedFileData {
  return decodeEmbeddedFileData(value) !== null;
}

/** Resolve original bytes from the current canvas snapshot, never from message data. */
export function embeddedFileNodeRaw(
  snapshot: CanvasDocument,
  nodeId: string,
  attachmentId?: string,
): unknown {
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
  if (attachmentId !== undefined) {
    return node?.kind === "note"
      ? node.attachments?.find((attachment) => attachment.id === attachmentId)
      : undefined;
  }
  return node && (node.kind === "attachment" || node.kind === "pdf")
    ? node.data
    : undefined;
}
