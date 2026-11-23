export type PdfTextRectangle = [number, number, number, number];

/** Zotero Reader's text-selection location, in PDF page coordinates. */
export interface PdfTextPosition {
  pageIndex: number;
  rects: PdfTextRectangle[];
  nextPageRects?: PdfTextRectangle[];
}

function isRectangle(value: unknown): value is PdfTextRectangle {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    ) &&
    value[0] <= value[2] &&
    value[1] <= value[3]
  );
}

export function parsePdfTextPosition(value: unknown): PdfTextPosition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.pageIndex !== "number" ||
    !Number.isSafeInteger(record.pageIndex + 1) ||
    record.pageIndex < 0 ||
    !Array.isArray(record.rects) ||
    !record.rects.length ||
    !record.rects.every(isRectangle) ||
    (record.nextPageRects !== undefined &&
      (!Array.isArray(record.nextPageRects) ||
        !record.nextPageRects.every(isRectangle)))
  )
    return null;
  return {
    pageIndex: record.pageIndex,
    rects: record.rects,
    ...(record.nextPageRects !== undefined
      ? { nextPageRects: record.nextPageRects as PdfTextRectangle[] }
      : {}),
  };
}
