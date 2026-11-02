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
export function annotationMarkdown(
  title: string,
  annotations: readonly MarkdownAnnotation[],
): string {
  const parts = [`# ${escape(title).replace(/\n/g, " ")}`, ""];
  let attachmentKey = "";
  for (const annotation of annotations) {
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
    if (attachmentKey !== annotation.attachmentKey) {
      parts.push(
        `## ${escape(annotation.attachmentTitle).replace(/\n/g, " ")}`,
        "",
      );
      attachmentKey = annotation.attachmentKey;
    }
    const scope = annotation.groupID
      ? `groups/${annotation.groupID}`
      : "library";
    const page =
      annotation.page &&
      Number.isInteger(annotation.page) &&
      annotation.page > 0
        ? `page=${annotation.page}&`
        : "";
    const href = `zotero://open-pdf/${scope}/items/${annotation.attachmentKey}?${page}annotation=${annotation.key}`;
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
  }
  return parts.join("\n");
}

export async function showAnnotationExport(win: Window, item: Zotero.Item) {
  if (!item.isEditable())
    throw new Error(getString("annotation-export-read-only"));
  const attachments = item.isAttachment()
    ? [item]
    : item.getAttachments().map((id) => Zotero.Items.get(id));
  const annotations: MarkdownAnnotation[] = [];
  const library = Zotero.Libraries.get(item.libraryID);
  const groupID =
    library && library.libraryType === "group"
      ? Zotero.Groups.getGroupIDFromLibraryID(item.libraryID)
      : undefined;
  for (const attachment of attachments) {
    if (
      !attachment ||
      attachment.deleted ||
      attachment.attachmentContentType !== "application/pdf"
    )
      continue;
    for (const annotation of [...attachment.getAnnotations()].sort((a, b) =>
      (a.annotationSortIndex || "").localeCompare(b.annotationSortIndex || ""),
    )) {
      if (
        annotation.deleted ||
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
