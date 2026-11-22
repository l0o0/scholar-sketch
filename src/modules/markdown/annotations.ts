import { getString } from "../../utils/locale";
import { createMarkdownAttachment } from "./create";
import { showAnnotationExportDialog } from "./annotation-dialog";

export interface MarkdownAnnotation {
  key: string;
  attachmentKey: string;
  attachmentTitle: string;
  groupID?: number;
  pageLabel: string;
  page?: number;
  text: string;
  comment: string;
  type?: string;
  color?: string;
  tags?: string[];
}
const escape = (value: string) => value.replace(/([\\`*_{}[\]<>#!|])/g, "\\$1");

function annotationLines(annotation: MarkdownAnnotation): string[] {
  if (
    !/^[A-Za-z0-9]{8}$/.test(annotation.attachmentKey) ||
    !/^[A-Za-z0-9]{8}$/.test(annotation.key)
  )
    throw new Error("Invalid annotation identity");
  if (
    annotation.groupID !== undefined &&
    (!Number.isSafeInteger(annotation.groupID) || annotation.groupID <= 0)
  )
    throw new Error("Invalid group identity");
  const scope = annotation.groupID ? `groups/${annotation.groupID}` : "library";
  const page =
    annotation.page && Number.isInteger(annotation.page) && annotation.page > 0
      ? `page=${annotation.page}&`
      : "";
  const href = `zotero://open-pdf/${scope}/items/${annotation.attachmentKey}?${page}annotation=${annotation.key}`;
  const parts: string[] = [];
  if (annotation.text)
    parts.push(
      escape(annotation.text)
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n"),
      "",
    );
  if (annotation.comment) parts.push(escape(annotation.comment), "");
  parts.push(`[${escape(annotation.pageLabel || "PDF")}](${href})`, "");
  return parts;
}

/** Insertable annotation content without document or attachment headings. */
export function annotationMarkdownFragment(
  annotations: readonly MarkdownAnnotation[],
): string {
  return annotations.flatMap(annotationLines).join("\n");
}

export function annotationMarkdown(
  title: string,
  annotations: readonly MarkdownAnnotation[],
): string {
  const parts = [`# ${escape(title).replace(/\n/g, " ")}`, ""];
  let attachmentKey = "";
  for (const annotation of annotations) {
    const lines = annotationLines(annotation);
    if (attachmentKey !== annotation.attachmentKey) {
      parts.push(
        `## ${escape(annotation.attachmentTitle).replace(/\n/g, " ")}`,
        "",
      );
      attachmentKey = annotation.attachmentKey;
    }
    parts.push(...lines);
  }
  return parts.join("\n");
}

export class AnnotationSourceUnavailableError extends Error {
  constructor() {
    super(getString("document-link-unresolved"));
  }
}

/** Load and validate the PDF children used by both the source picker and reader. */
export async function markdownAnnotationAttachments(
  item: Zotero.Item,
): Promise<Zotero.Item[]> {
  const regular = item.isRegularItem();
  if (
    !regular &&
    (!item.isAttachment() || item.attachmentContentType !== "application/pdf")
  )
    throw new AnnotationSourceUnavailableError();
  await Zotero.Items.loadDataTypes(
    [item],
    regular ? ["itemData", "childItems"] : ["itemData"],
  );
  const attachments = regular
    ? await Zotero.Items.getAsync(item.getAttachments())
    : [item];
  const pdfs = attachments.filter(
    (attachment) =>
      attachment &&
      attachment.isAttachment() &&
      !attachment.deleted &&
      attachment.libraryID === item.libraryID &&
      attachment.attachmentContentType === "application/pdf" &&
      /^[A-Za-z0-9]{8}$/.test(attachment.key) &&
      (!regular || attachment.parentID === item.id),
  );
  if (!regular && item.parentID) {
    const parent = await Zotero.Items.getAsync(item.parentID);
    if (
      !parent ||
      parent.deleted ||
      !parent.isRegularItem() ||
      parent.libraryID !== item.libraryID
    )
      throw new AnnotationSourceUnavailableError();
    await Zotero.Items.loadDataTypes([parent], ["itemData"]);
  }
  await Zotero.Items.loadDataTypes(pdfs, ["itemData"]);
  if (item.deleted || !/^[A-Za-z0-9]{8}$/.test(item.key))
    throw new AnnotationSourceUnavailableError();
  return pdfs;
}

/** Read text-bearing annotations without requiring write access to their source. */
export async function readMarkdownAnnotations(
  item: Zotero.Item,
): Promise<MarkdownAnnotation[]> {
  const attachments = await markdownAnnotationAttachments(item);
  await Zotero.Items.loadDataTypes(attachments, ["childItems"]);
  const byAttachment = attachments.map((attachment) => ({
    attachment,
    annotations: attachment.getAnnotations(),
  }));
  await Zotero.Items.loadDataTypes(
    byAttachment.flatMap(({ annotations }) => annotations),
    ["annotation", "annotationDeferred", "tags"],
  );
  const annotations: MarkdownAnnotation[] = [];
  const library = Zotero.Libraries.get(item.libraryID);
  if (!library || item.deleted) throw new AnnotationSourceUnavailableError();
  const groupID =
    library && library.libraryType === "group"
      ? Zotero.Groups.getGroupIDFromLibraryID(item.libraryID)
      : undefined;
  if (groupID !== undefined && (!Number.isSafeInteger(groupID) || groupID <= 0))
    throw new AnnotationSourceUnavailableError();
  for (const { attachment, annotations: children } of byAttachment) {
    if (
      attachment.deleted ||
      attachment.libraryID !== item.libraryID ||
      (item.isRegularItem() && attachment.parentID !== item.id)
    )
      continue;
    for (const annotation of [...children].sort((a, b) =>
      (a.annotationSortIndex || "").localeCompare(b.annotationSortIndex || ""),
    )) {
      if (
        !annotation.isAnnotation() ||
        annotation.deleted ||
        annotation.libraryID !== attachment.libraryID ||
        annotation.parentID !== attachment.id ||
        (!annotation.annotationText?.trim() &&
          !annotation.annotationComment?.trim())
      )
        continue;
      let page: number | undefined;
      try {
        const position = JSON.parse(annotation.annotationPosition);
        if (Number.isInteger(position.pageIndex) && position.pageIndex >= 0)
          page = position.pageIndex + 1;
      } catch {
        /* The annotation key still identifies its location. */
      }
      annotations.push({
        key: annotation.key,
        attachmentKey: attachment.key,
        attachmentTitle:
          attachment.getField("title") ||
          attachment.attachmentFilename ||
          "PDF",
        groupID,
        page,
        pageLabel: annotation.annotationPageLabel || "",
        text: annotation.annotationText || "",
        comment: annotation.annotationComment || "",
        type: annotation.annotationType,
        color: annotation.annotationColor,
        tags: annotation.getTags().map(({ tag }) => tag),
      });
    }
  }
  return annotations;
}

export async function showAnnotationExport(win: Window, item: Zotero.Item) {
  if (!item.isEditable())
    throw new Error(getString("annotation-export-read-only"));
  const annotations = await readMarkdownAnnotations(item);
  showAnnotationExportDialog(
    win,
    annotations,
    async (chosen, shouldContinue) => {
      const created = await createMarkdownAttachment(
        item.isRegularItem() ? item : item.parentItem,
        {
          libraryID: item.libraryID,
          win: win as _ZoteroTypes.MainWindow,
          shouldContinue,
          initialContent: annotationMarkdown(
            item.getField("title") || "Annotations",
            chosen,
          ),
        },
      );
      return Boolean(created);
    },
  );
}
