import { toPng } from "html-to-image";
import type { CanvasDocument } from "../model/document";
import { boundsOf } from "./export";

export type PngScale = 1 | 2 | 4;

export function pngExportSize(document: CanvasDocument, scale: PngScale) {
  const bounds = boundsOf(document.nodes);
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  // Bound the actual allocation. Never silently reduce the requested quality.
  if (
    !Number.isFinite(width * height) ||
    width <= 0 ||
    height <= 0 ||
    width * scale > 16384 ||
    height * scale > 16384 ||
    width * height * scale * scale > 64_000_000
  )
    throw new Error("PNG is too large. Choose a lower resolution.");
  return {
    ...bounds,
    width,
    height,
    pixelWidth: width * scale,
    pixelHeight: height * scale,
  };
}

export function includeInPng(node: HTMLElement): boolean {
  return !node.matches?.(
    ".react-flow__handle, .react-flow__resize-control, .react-flow__selection, .react-flow__nodesselection, .react-flow__edge-interaction, .react-flow__edgeupdater, .zmd-board-smart-guides",
  );
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PNG rendering timed out")),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Capture the actual cards, images and edge labels, independent of pan/zoom. */
export async function exportCanvasPng(
  host: HTMLElement,
  document: CanvasDocument,
  scale: PngScale = 2,
): Promise<string> {
  const viewport = host.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport) throw new Error("Canvas is not ready");
  const bounds = pngExportSize(document, scale);
  const owner = host.ownerDocument;
  const win = owner.defaultView!;
  await withTimeout(
    Promise.all([
      owner.fonts.ready,
      ...Array.from(viewport.querySelectorAll("img"), (image) =>
        image.decode(),
      ),
    ]),
  );
  host.setAttribute("data-exporting", "true");
  try {
    const result = await withTimeout(
      toPng(viewport, {
        width: bounds.width,
        height: bounds.height,
        pixelRatio: scale,
        backgroundColor:
          win.getComputedStyle(host)?.backgroundColor || "#fbfbfc",
        filter: includeInPng,
        preferredFontFormat: "woff2",
        style: {
          transform: `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)`,
          transformOrigin: "0 0",
        },
      }),
    );
    if (!result.startsWith("data:image/png;base64,"))
      throw new Error("PNG rendering failed");
    return result;
  } finally {
    host.removeAttribute("data-exporting");
  }
}
