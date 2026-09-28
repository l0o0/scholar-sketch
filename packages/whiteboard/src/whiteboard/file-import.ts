import {
  inferAttachmentContentType,
  MAX_ATTACHMENT_BYTES,
} from "../model/file-attachment";

export const MAX_ATTACHMENT_BATCH_BYTES = 30 * 1024 * 1024;
export const MAX_TEXT_PREVIEW_CHARS = 2000;

export function canAcceptNativeFileTransfer(
  transfer: Pick<DataTransfer, "files" | "types">,
): boolean {
  const types = Array.from(transfer.types);
  if (!transfer.files.length && !types.includes("Files")) return false;
  return !types.some((type) => /zotero/i.test(type));
}

export function isEditingImportSessionCurrent(
  current: { nodeId: string; value: string; revision: number },
  expected: { nodeId: string; value: string; revision: number },
): boolean {
  return (
    current.nodeId === expected.nodeId &&
    current.value === expected.value &&
    current.revision === expected.revision
  );
}

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export interface ImportedWhiteboardFile {
  title: string;
  contentType: string;
  size: number;
  fileData: string;
  preview?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface FileImportFailure {
  title: string;
  reason: "too-large" | "batch-too-large" | "read-failed";
  error?: unknown;
}

export interface FileImportResult {
  files: ImportedWhiteboardFile[];
  failures: FileImportFailure[];
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("FileReader returned no data URL."));
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

function readText(file: File): Promise<string> {
  return typeof file.text === "function"
    ? file.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () =>
          reject(reader.error ?? new Error("File read failed."));
        reader.readAsText(file);
      });
}

function isTextType(contentType: string, filename: string): boolean {
  return (
    contentType.startsWith("text/") ||
    /\.(?:md|markdown|txt|csv|json|xml|yaml|yml|log|html?|css|js|ts|tsx|jsx)$/i.test(
      filename,
    )
  );
}

function imageDimensions(
  dataUrl: string,
): Promise<{ width?: number; height?: number }> {
  if (typeof Image === "undefined") return Promise.resolve({});
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || image.width || undefined,
        height: image.naturalHeight || image.height || undefined,
      });
    image.onerror = () => resolve({});
    image.src = dataUrl;
  });
}

function normalizeDataUrlMime(dataUrl: string, contentType: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0
    ? `data:${contentType};base64,${dataUrl.slice(comma + 1)}`
    : dataUrl;
}

export async function importWhiteboardFiles(
  input: Iterable<File>,
): Promise<FileImportResult> {
  const files: ImportedWhiteboardFile[] = [];
  const failures: FileImportFailure[] = [];
  let batchBytes = 0;
  for (const file of input) {
    const title = file.name || "Untitled file";
    if (file.size > MAX_ATTACHMENT_BYTES) {
      failures.push({ title, reason: "too-large" });
      continue;
    }
    if (batchBytes + file.size > MAX_ATTACHMENT_BATCH_BYTES) {
      failures.push({ title, reason: "batch-too-large" });
      continue;
    }
    batchBytes += file.size;
    try {
      const contentType = inferAttachmentContentType(title, file.type);
      const fileData = normalizeDataUrlMime(
        await readAsDataUrl(file),
        contentType,
      );
      const result: ImportedWhiteboardFile = {
        title,
        contentType,
        size: file.size,
        fileData,
      };
      if (isTextType(contentType, title)) {
        result.preview = (await readText(file)).slice(
          0,
          MAX_TEXT_PREVIEW_CHARS,
        );
      }
      if (IMAGE_TYPES.has(contentType)) {
        const dimensions = await imageDimensions(fileData);
        if (dimensions.width) result.imageWidth = dimensions.width;
        if (dimensions.height) result.imageHeight = dimensions.height;
      }
      files.push(result);
    } catch (error) {
      failures.push({ title, reason: "read-failed", error });
    }
  }
  return { files, failures };
}

export function fileImportFailureMessage(
  failure: FileImportFailure,
  labels: {
    fileTooLarge: string;
    fileImportFailed: string;
  },
): string {
  return failure.reason === "too-large" || failure.reason === "batch-too-large"
    ? `${failure.title}: ${labels.fileTooLarge}`
    : `${failure.title}: ${labels.fileImportFailed}`;
}
