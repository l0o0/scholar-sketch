import { getString } from "../../utils/locale";
import { createMarkdownAttachment } from "./create";
import { showAnnotationExportDialog } from "./annotation-dialog";

export interface MarkdownAnnotation {
  key: string;
  attachmentKey: string;
  attachmentTitle: string;
  sourceKey?: string;
  sourceTitle?: string;
  sourceDetail?: string;
  sortIndex?: string;
  groupID?: number;
  pageLabel: string;
  page?: number;
  text: string;
  comment: string;
  type?: string;
  color?: string;
  tags?: string[];
}
export const escapeAnnotationMarkdown = (value: string) =>
  value.replace(/([\\`*_{}[\]<>#!|])/g, "\\$1");

function annotationLines(
  annotation: MarkdownAnnotation,
  inlinePageLink = false,
): string[] {
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
      ? annotation.page
      : undefined;
  const href = `zotero://open-pdf/${scope}/items/${annotation.attachmentKey}?${page ? `page=${page}&` : ""}annotation=${annotation.key}`;
  let linkLabel = annotation.pageLabel || "PDF";
  if (inlinePageLink) {
    const pageLabel = annotation.pageLabel.trim() || (page ? String(page) : "");
    linkLabel = pageLabel
      ? getString("markdown-annotation-page-link", {
          args: { page: pageLabel },
        })
      : `${getString("markdown-annotation-open-source")} ↗`;
    linkLabel = linkLabel.replace(/[\r\n]+/g, " ");
  }
  const link = `[${escapeAnnotationMarkdown(linkLabel)}](${href})`;
  const text = inlinePageLink ? annotation.text.trimEnd() : annotation.text;
  const comment =
    inlinePageLink && !text ? annotation.comment.trimEnd() : annotation.comment;
  const parts: string[] = [];
  if (text) {
    const quote = escapeAnnotationMarkdown(text)
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");
    parts.push(inlinePageLink ? `${quote} ${link}` : quote, "");
  }
  if (comment) {
    const body = escapeAnnotationMarkdown(comment);
    parts.push(inlinePageLink && !text ? `${body} ${link}` : body, "");
  }
  if (!inlinePageLink || (!text && !comment)) parts.push(link, "");
  return parts;
}

/** Insertable annotation content without document or attachment headings. */
export function annotationMarkdownFragment(
  annotations: readonly MarkdownAnnotation[],
): string {
  return annotations
    .flatMap((annotation) => annotationLines(annotation, true))
    .join("\n");
}

export function annotationMarkdown(
  title: string,
  annotations: readonly MarkdownAnnotation[],
): string {
  const parts = [
    `# ${escapeAnnotationMarkdown(title).replace(/\n/g, " ")}`,
    "",
  ];
  let attachmentKey = "";
  for (const annotation of annotations) {
    const lines = annotationLines(annotation);
    if (attachmentKey !== annotation.attachmentKey) {
      parts.push(
        `## ${escapeAnnotationMarkdown(annotation.attachmentTitle).replace(/\n/g, " ")}`,
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

/** Native keys identify selections independently of a result page or filter. */
export function annotationIdentity(annotation: MarkdownAnnotation): string {
  return `${annotation.groupID ? `groups/${annotation.groupID}` : "library"}/${annotation.attachmentKey}/${annotation.key}`;
}

/** Read only the supplied annotations, validating their complete PDF source chain. */
export async function readMarkdownAnnotationItems(
  libraryID: number,
  items: readonly Zotero.Item[],
): Promise<MarkdownAnnotation[]> {
  const library = Zotero.Libraries.get(libraryID);
  if (!library) throw new AnnotationSourceUnavailableError();
  const groupID =
    library.libraryType === "group"
      ? Zotero.Groups.getGroupIDFromLibraryID(libraryID)
      : undefined;
  if (groupID !== undefined && (!Number.isSafeInteger(groupID) || groupID <= 0))
    throw new AnnotationSourceUnavailableError();
  const candidates = items.filter(
    (item) =>
      item &&
      item.isAnnotation() &&
      !item.deleted &&
      item.libraryID === libraryID &&
      /^[A-Za-z0-9]{8}$/.test(item.key),
  );
  if (!candidates.length) return [];
  const attachments = (
    await Zotero.Items.getAsync([
      ...new Set(
        candidates
          .map((item) => item.parentID)
          .filter((id): id is number => Boolean(id)),
      ),
    ])
  ).filter(
    (item) =>
      item &&
      !item.deleted &&
      item.libraryID === libraryID &&
      item.isAttachment() &&
      item.attachmentContentType === "application/pdf" &&
      /^[A-Za-z0-9]{8}$/.test(item.key),
  );
  const parents = await Zotero.Items.getAsync([
    ...new Set(
      attachments
        .map((item) => item.parentID)
        .filter((id): id is number => Boolean(id)),
    ),
  ]);
  const sources = new Map(
    parents
      .filter(
        (item) =>
          item &&
          !item.deleted &&
          item.libraryID === libraryID &&
          item.isRegularItem() &&
          /^[A-Za-z0-9]{8}$/.test(item.key),
      )
      .map((item) => [item.id, item]),
  );
  await Zotero.Items.loadDataTypes(
    [...attachments, ...sources.values()],
    ["itemData"],
  );
  await Zotero.Items.loadDataTypes(candidates, [
    "annotation",
    "annotationDeferred",
    "tags",
  ]);
  const byAttachment = new Map(attachments.map((item) => [item.id, item]));
  const result: MarkdownAnnotation[] = [];
  for (const annotation of candidates) {
    const attachment = annotation.parentID
      ? byAttachment.get(annotation.parentID)
      : undefined;
    if (
      !attachment ||
      attachment.deleted ||
      attachment.libraryID !== libraryID ||
      attachment.attachmentContentType !== "application/pdf" ||
      annotation.deleted ||
      annotation.libraryID !== libraryID
    )
      continue;
    const source = attachment.parentID
      ? sources.get(attachment.parentID)
      : attachment;
    if (!source || source.deleted || source.libraryID !== libraryID) continue;
    if (
      !annotation.annotationText?.trim() &&
      !annotation.annotationComment?.trim()
    )
      continue;
    let page: number | undefined;
    try {
      const position = JSON.parse(annotation.annotationPosition);
      if (Number.isInteger(position.pageIndex) && position.pageIndex >= 0)
        page = position.pageIndex + 1;
    } catch {
      // A malformed position does not invalidate the native annotation-key link.
    }
    const creator = source.isRegularItem()
      ? String(source.getField("firstCreator") || "")
      : "";
    const year = source.isRegularItem()
      ? String(source.getField("date") || "").match(/\b\d{4}\b/)?.[0]
      : "";
    const sourceDetail = [creator, year].filter(Boolean).join(" · ");
    const attachmentTitle =
      attachment.getField("title") || attachment.attachmentFilename || "PDF";
    result.push({
      key: annotation.key,
      attachmentKey: attachment.key,
      attachmentTitle,
      sourceKey: source.key,
      sourceTitle: source.getField("title") || attachmentTitle,
      ...(sourceDetail ? { sourceDetail } : {}),
      sortIndex: annotation.annotationSortIndex || "",
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
  return result;
}

/** Read text-bearing annotations without requiring write access to their source. */
export async function readMarkdownAnnotations(
  item: Zotero.Item,
): Promise<MarkdownAnnotation[]> {
  const attachments = await markdownAnnotationAttachments(item);
  await Zotero.Items.loadDataTypes(attachments, ["childItems"]);
  const candidates = attachments.flatMap((attachment) =>
    attachment.getAnnotations(),
  );
  const records = await readMarkdownAnnotationItems(item.libraryID, candidates);
  if (item.deleted) throw new AnnotationSourceUnavailableError();
  const annotations = item.isRegularItem()
    ? records.filter((annotation) => annotation.sourceKey === item.key)
    : records;
  const attachmentOrder = new Map(
    attachments.map((attachment, index) => [attachment.key, index]),
  );
  return annotations.sort(
    (a, b) =>
      attachmentOrder.get(a.attachmentKey)! -
        attachmentOrder.get(b.attachmentKey)! ||
      (a.sortIndex || "").localeCompare(b.sortIndex || ""),
  );
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
