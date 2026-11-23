import { getString } from "../utils/locale";
import {
  parsePdfTextPosition,
  type PdfTextPosition,
} from "../utils/pdf-position";

interface SelectionRecord {
  attachment: Zotero.Item;
  position: PdfTextPosition;
  text: string;
  pageLabel?: string;
  annotationKey?: string;
  citation?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pdfAttachment(
  item: Zotero.Item | false | undefined,
): Zotero.Item | null {
  return item &&
    item.isAttachment() &&
    !item.deleted &&
    item.attachmentContentType === "application/pdf" &&
    /^[A-Za-z0-9]{8}$/.test(item.key)
    ? item
    : null;
}

function nativeSelections(json: string): SelectionRecord[] | null {
  const values: unknown = JSON.parse(json);
  if (!Array.isArray(values) || !values.length) return null;
  const selections: SelectionRecord[] = [];
  for (const value of values) {
    const input = record(value);
    if (
      !input ||
      typeof input.attachmentItemID !== "number" ||
      !Number.isSafeInteger(input.attachmentItemID) ||
      input.attachmentItemID <= 0
    )
      return null;
    const attachment = pdfAttachment(Zotero.Items.get(input.attachmentItemID));
    if (!attachment) return null;
    let text: unknown = input.text;
    let location: unknown = input.position;
    let pageLabel: unknown = input.pageLabel;
    let annotationKey: string | undefined;
    // Saved annotations keep their authoritative text and attachment chain.
    // A Reader text selection has no saved annotation identity.
    if (input.id !== undefined) {
      if (typeof input.id !== "string" || !/^[A-Za-z0-9]{8}$/.test(input.id))
        return null;
      const annotation = Zotero.Items.getByLibraryAndKey(
        attachment.libraryID,
        input.id,
      );
      if (
        !annotation ||
        !annotation.isAnnotation() ||
        annotation.deleted ||
        annotation.parentID !== attachment.id
      )
        return null;
      annotationKey = annotation.key;
      text = annotation.annotationText;
      location = JSON.parse(annotation.annotationPosition);
      pageLabel = annotation.annotationPageLabel;
    }
    const position = parsePdfTextPosition(location);
    if (!position || typeof text !== "string" || !text.trim()) return null;
    selections.push({
      attachment,
      position,
      text,
      ...(typeof pageLabel === "string" ? { pageLabel } : {}),
      ...(annotationKey ? { annotationKey } : {}),
    });
  }
  return selections;
}

function htmlSelections(
  html: string,
  document: Document,
): SelectionRecord[] | null {
  const template = document.createElement("template");
  template.innerHTML = html;
  if (
    template.content.querySelector(
      "img, svg, video, audio, iframe, object, embed, canvas",
    )
  )
    return null;
  const highlights = template.content.querySelectorAll<HTMLElement>(
    "span[data-annotation]",
  );
  if (!highlights.length) return null;
  const remaining = template.content.cloneNode(true) as DocumentFragment;
  for (const element of remaining.querySelectorAll(
    "span[data-annotation], .citation",
  ))
    element.remove();
  // A mixed native Note selection still belongs to the ordinary paste path.
  // Importing only its annotated spans would silently discard other prose.
  if (remaining.textContent?.trim()) return null;
  const selections: SelectionRecord[] = [];
  for (const span of highlights) {
    const input = record(
      JSON.parse(decodeURIComponent(span.getAttribute("data-annotation")!)),
    );
    if (
      !input ||
      typeof input.attachmentURI !== "string" ||
      !/^https?:\/\/zotero\.org\/(?:users\/(?:[1-9][0-9]*|local\/[A-Za-z0-9]+)|groups\/[1-9][0-9]*)\/items\/[A-Za-z0-9]{8}$/.test(
        input.attachmentURI,
      )
    )
      return null;
    const identity = Zotero.URI.getURIItemLibraryKey(input.attachmentURI);
    if (!identity || !identity.key) return null;
    const attachment = pdfAttachment(
      Zotero.Items.getByLibraryAndKey(identity.libraryID, identity.key),
    );
    const position = parsePdfTextPosition(input.position);
    const text = span.textContent;
    if (!attachment || !position || !text?.trim()) return null;
    const annotationKey = input.annotationKey;
    if (
      annotationKey !== undefined &&
      (typeof annotationKey !== "string" ||
        !/^[A-Za-z0-9]{8}$/.test(annotationKey))
    )
      return null;
    const citation = span
      .closest("p")
      ?.querySelector(".citation-item")?.textContent;
    selections.push({
      attachment,
      position,
      text,
      ...(typeof input.pageLabel === "string"
        ? { pageLabel: input.pageLabel }
        : {}),
      ...(typeof annotationKey === "string" ? { annotationKey } : {}),
      ...(citation?.trim() ? { citation: citation.trim() } : {}),
    });
  }
  return selections;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]<>#!|~$()+.-])/g, "\\$1");
}

function selectionMarkdown(selection: SelectionRecord): string | null {
  const { attachment, position, annotationKey } = selection;
  const library = Zotero.Libraries.get(attachment.libraryID);
  if (!library) return null;
  let scope = "library";
  if (library.libraryType === "group") {
    const groupID = Zotero.Groups.getGroupIDFromLibraryID(attachment.libraryID);
    if (!Number.isSafeInteger(groupID) || groupID <= 0) return null;
    scope = `groups/${groupID}`;
  } else if (attachment.libraryID !== Zotero.Libraries.userLibraryID)
    return null;
  const page = position.pageIndex + 1;
  const location = annotationKey
    ? `annotation=${annotationKey}`
    : `position=${encodeURIComponent(JSON.stringify(position))}`;
  const href = `zotero://open-pdf/${scope}/items/${attachment.key}?page=${page}&${location}`;
  const title = String(
    attachment.parentItem?.getField("title") || attachment.getField("title"),
  );
  const label =
    selection.citation ||
    getString("pdf-selection-source", {
      args: { title, page: selection.pageLabel || String(page) },
    });
  const quote = escapeMarkdown(selection.text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quote}\n\n[${escapeMarkdown(label).replace(/\n/g, " ")}](${href})`;
}

/** Decode Reader/native-note transfers synchronously in the owning host event. */
export function pdfSelectionTransferMarkdown(
  transfer: Pick<DataTransfer, "types" | "getData">,
  document: Document,
): string | null {
  const types = Array.from(transfer.types);
  let selections: SelectionRecord[] | null;
  try {
    selections = types.includes("zotero/annotation")
      ? nativeSelections(transfer.getData("zotero/annotation"))
      : types.includes("text/html")
        ? htmlSelections(transfer.getData("text/html"), document)
        : null;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof URIError) return null;
    // Host lookup failures are observable to the caller. Only malformed
    // external serialization falls back to the native plain-text paste.
    throw error;
  }
  if (!selections) return null;
  const parts = selections.map(selectionMarkdown);
  return parts.every((part) => part !== null) ? parts.join("\n\n") : null;
}
