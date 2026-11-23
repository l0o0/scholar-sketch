import {
  PDF_SELECTION_EVENT,
  type PdfSelectionInsertion,
} from "./editor-protocol";

type PdfSelectionTransfer = Pick<DataTransfer, "types" | "getData">;

/** Bind to the iframe document only after its owning ready handshake. */
export function attachMarkdownPdfSelectionTransfer(
  document: Document,
  resolve: (
    transfer: PdfSelectionTransfer,
    document: Document,
  ) => string | null,
  editable: () => boolean,
  reportError: (error: unknown) => void,
): () => void {
  const dispatch = (
    event: ClipboardEvent | DragEvent,
    transfer: DataTransfer | null,
    position?: { x: number; y: number },
  ) => {
    if (!editable() || !transfer) return;
    const target = event.target as Element | null;
    const content =
      target?.closest?.(".cm-content") ||
      target?.closest?.(".cm-editor")?.querySelector(".cm-content");
    if (!content) return;
    let markdown: string | null;
    try {
      markdown = resolve(transfer, document);
    } catch (error) {
      reportError(error);
      return;
    }
    if (!markdown) return;
    const payload: PdfSelectionInsertion = { markdown, position };
    const input = document.createEvent("CustomEvent");
    // A string crosses Gecko's chrome compartments without exposing host objects.
    input.initCustomEvent(
      PDF_SELECTION_EVENT,
      true,
      true,
      JSON.stringify(payload),
    );
    content.dispatchEvent(input);
    if (!input.defaultPrevented) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPaste = (event: ClipboardEvent) =>
    dispatch(event, event.clipboardData);
  const onDrop = (event: DragEvent) =>
    dispatch(event, event.dataTransfer, { x: event.clientX, y: event.clientY });
  const onDragOver = (event: DragEvent) => {
    if (
      editable() &&
      Array.from(event.dataTransfer?.types ?? []).includes("zotero/annotation")
    ) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
  };
  document.addEventListener("paste", onPaste, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("dragenter", onDragOver, true);
  document.addEventListener("dragover", onDragOver, true);
  return () => {
    document.removeEventListener("paste", onPaste, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("dragenter", onDragOver, true);
    document.removeEventListener("dragover", onDragOver, true);
  };
}
