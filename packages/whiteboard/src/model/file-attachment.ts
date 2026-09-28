/** Maximum amount of original attachment data persisted in a canvas file. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  css: "text/css",
  csv: "text/csv",
  gif: "image/gif",
  html: "text/html",
  htm: "text/html",
  js: "text/javascript",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  jsx: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  text: "text/plain",
  txt: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  zip: "application/zip",
};

const RASTER_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ACTIVE_MIME_TYPES = new Set([
  "application/xhtml+xml",
  "image/svg+xml",
  "text/html",
]);

interface ParsedDataUrl {
  mimeType: string;
  bytes: Uint8Array;
}

/** Infer a stable MIME type from a supplied value and, if needed, filename. */
export function inferAttachmentContentType(
  filename: string,
  suppliedMime?: string,
): string {
  const supplied = normalizeMimeType(suppliedMime);
  const extension = filename
    .trim()
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1];
  const inferred = extension && MIME_BY_EXTENSION[extension];
  return supplied && supplied !== "application/octet-stream"
    ? supplied
    : inferred || supplied || "application/octet-stream";
}

/** Return true only for a bounded, base64 data URL that is safe to persist. */
export function isSafeAttachmentDataUrl(
  value: unknown,
  maxBytes = MAX_ATTACHMENT_BYTES,
): value is string {
  const info = dataUrlInfo(value, maxBytes);
  return Boolean(info && !ACTIVE_MIME_TYPES.has(info.mimeType));
}

/** Validate bounded base64 data while retaining inert original HTML/SVG bytes. */
export function isValidAttachmentDataUrl(
  value: unknown,
  maxBytes = MAX_ATTACHMENT_BYTES,
): value is string {
  return dataUrlInfo(value, maxBytes) !== undefined;
}

/** Decode a safe attachment data URL without relying on Node globals. */
export function decodeAttachmentDataUrl(
  value: unknown,
  maxBytes = MAX_ATTACHMENT_BYTES,
): Uint8Array | undefined {
  return parseDataUrl(value, maxBytes)?.bytes;
}

/** Validate and normalize original attachment bytes for canvas persistence. */
export function safeAttachmentDataUrl(
  value: unknown,
  contentType?: string,
  maxBytes = MAX_ATTACHMENT_BYTES,
): string | undefined {
  const parsed = parseDataUrl(value, maxBytes);
  if (!parsed || ACTIVE_MIME_TYPES.has(parsed.mimeType)) return undefined;
  const supplied = normalizeMimeType(contentType);
  if (
    supplied &&
    supplied !== "application/octet-stream" &&
    supplied !== parsed.mimeType
  ) {
    return undefined;
  }
  return `data:${parsed.mimeType};base64,${encodeBase64(parsed.bytes)}`;
}

/** Images rendered by a node must be raster, or a small inert static SVG. */
export function isSafeImagePreview(value: unknown): value is string {
  if (typeof value === "string" && value.startsWith("data:image/svg+xml")) {
    const comma = value.indexOf(",");
    if (comma >= 0) {
      const metadata = value.slice(5, comma).split(";");
      const mimeType = normalizeMimeType(metadata.shift());
      const payload = value.slice(comma + 1);
      if (
        mimeType === "image/svg+xml" &&
        payload &&
        !metadata.includes("base64")
      ) {
        try {
          return isSafeSvgSource(decodeURIComponent(payload));
        } catch {
          return false;
        }
      }
    }
  }
  const parsed = parseDataUrl(value, MAX_ATTACHMENT_BYTES);
  if (!parsed) return false;
  if (RASTER_MIME_TYPES.has(parsed.mimeType)) return true;
  if (parsed.mimeType !== "image/svg+xml") return false;
  return isSafeSvgSource(bytesToAscii(parsed.bytes));
}

function isSafeSvgSource(source: string): boolean {
  const tags = source.match(/<\/?[a-z][^>]*>/giu) ?? [];
  const allowedTags = new Set([
    "circle",
    "ellipse",
    "g",
    "line",
    "path",
    "polygon",
    "polyline",
    "rect",
    "svg",
  ]);
  return (
    /<svg(?:\s|\/?>)/iu.test(source) &&
    tags.length > 0 &&
    tags.every((tag) =>
      allowedTags.has(tag.match(/^<\/?([a-z]+)/iu)?.[1]?.toLowerCase() ?? ""),
    ) &&
    !/<(?:script|foreignObject|iframe|object|embed|animate|set|mpath)(?:\s|\/?>)/iu.test(
      source,
    ) &&
    !/(?:<!|<\?xml|<(?:style|link)(?:\s|\/?>))/iu.test(source) &&
    !/\bon[a-z]+\s*=|javascript\s*:/iu.test(source) &&
    !/(?:href|xlink:href|src)\s*=\s*["']\s*(?:https?:|data:|\/\/)/iu.test(
      source,
    ) &&
    !/url\s*\(\s*(?:https?:|data:|\/\/)/iu.test(source)
  );
}

function normalizeMimeType(value: string | undefined): string | undefined {
  if (!value || typeof value !== "string") return undefined;
  const mime = value.split(";", 1)[0]?.trim().toLowerCase();
  return mime && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mime)
    ? mime
    : undefined;
}

function parseDataUrl(
  value: unknown,
  maxBytes: number,
): ParsedDataUrl | undefined {
  const info = dataUrlInfo(value, maxBytes);
  if (!info) return undefined;
  try {
    const decoded = atob(info.payload);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return { mimeType: info.mimeType, bytes };
  } catch {
    return undefined;
  }
}

function dataUrlInfo(
  value: unknown,
  maxBytes: number,
): { mimeType: string; payload: string } | undefined {
  if (
    typeof value !== "string" ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    !value.startsWith("data:")
  ) {
    return undefined;
  }
  const comma = value.indexOf(",");
  if (comma < 6) return undefined;
  const parts = value.slice(5, comma).split(";");
  const mimeType = normalizeMimeType(parts.shift());
  const payload = value.slice(comma + 1);
  if (
    !mimeType ||
    !parts.length ||
    parts.at(-1) !== "base64" ||
    parts
      .slice(0, -1)
      .some((part) => !/^[a-z0-9!#$&^_.+-]+=[^;]*$/iu.test(part)) ||
    payload.length % 4 !== 0 ||
    payload.length > 4 * Math.ceil(maxBytes / 3) + 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(payload)
  ) {
    return undefined;
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  if (padding > 0 && payload.slice(0, -padding).includes("=")) return undefined;
  const byteLength = (payload.length / 4) * 3 - padding;
  return byteLength <= maxBytes ? { mimeType, payload } : undefined;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function bytesToAscii(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index]!);
  }
  return result;
}
