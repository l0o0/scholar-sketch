export const PREVIEW_WORKER_PROTOCOL_VERSION = 1 as const;

export interface PreviewWorkerFragment {
  maxChars: number;
  heading?: string;
}

export interface PreviewWorkerRequest {
  version: typeof PREVIEW_WORKER_PROTOCOL_VERSION;
  requestID: number;
  source: string;
  title?: string;
  fragment?: PreviewWorkerFragment;
}

export type PreviewWorkerResponse =
  | {
      version: typeof PREVIEW_WORKER_PROTOCOL_VERSION;
      requestID: number;
      ok: true;
      title: string;
      bodyHtml: string;
      headingFound?: boolean;
    }
  | {
      version: typeof PREVIEW_WORKER_PROTOCOL_VERSION;
      requestID: number;
      ok: false;
      error: string;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function isPreviewWorkerRequest(
  value: unknown,
): value is PreviewWorkerRequest {
  const data = record(value);
  return (
    data?.version === PREVIEW_WORKER_PROTOCOL_VERSION &&
    typeof data.requestID === "number" &&
    Number.isInteger(data.requestID) &&
    data.requestID >= 0 &&
    typeof data.source === "string" &&
    (data.title === undefined || typeof data.title === "string") &&
    (data.fragment === undefined || isFragment(data.fragment))
  );
}

export function isPreviewWorkerResponse(
  value: unknown,
): value is PreviewWorkerResponse {
  const data = record(value);
  if (
    data?.version !== PREVIEW_WORKER_PROTOCOL_VERSION ||
    typeof data.requestID !== "number" ||
    !Number.isInteger(data.requestID) ||
    data.requestID < 0 ||
    typeof data.ok !== "boolean"
  ) {
    return false;
  }
  if (data.ok) {
    return (
      typeof data.title === "string" &&
      typeof data.bodyHtml === "string" &&
      (data.headingFound === undefined ||
        typeof data.headingFound === "boolean")
    );
  }
  return typeof data.error === "string";
}

function isFragment(value: unknown): value is PreviewWorkerFragment {
  const data = record(value);
  return Boolean(
    data &&
    typeof data.maxChars === "number" &&
    Number.isSafeInteger(data.maxChars) &&
    data.maxChars > 0 &&
    data.maxChars <= 64 * 1024 &&
    (data.heading === undefined || typeof data.heading === "string"),
  );
}
