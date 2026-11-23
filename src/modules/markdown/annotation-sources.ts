import type { AnnotationInsertSource } from "./annotation-dialog";
import {
  AnnotationSourceUnavailableError,
  markdownAnnotationAttachments,
} from "./annotations";

const MAX_SOURCE_RESULTS = 24;

function sourceOption(item: Zotero.Item): AnnotationInsertSource {
  const title = String(
    item.getField("title") ||
      (item.isAttachment() ? item.attachmentFilename : "") ||
      item.key,
  );
  const parent = item.isAttachment() ? item.parentItem : undefined;
  const detail = parent ? String(parent.getField("title") || "") : "";
  return {
    id: item.id,
    title,
    ...(detail && detail !== title ? { detail } : {}),
  };
}

export async function getInitialAnnotationSources(
  currentItem: Zotero.Item,
): Promise<AnnotationInsertSource[]> {
  const source = currentItem.parentID
    ? await Zotero.Items.getAsync(currentItem.parentID)
    : currentItem;
  if (
    !source ||
    source.deleted ||
    source.libraryID !== currentItem.libraryID ||
    (!source.isRegularItem() &&
      (!source.isAttachment() ||
        source.attachmentContentType !== "application/pdf"))
  )
    return [];
  return (await markdownAnnotationAttachments(source)).length
    ? [sourceOption(source)]
    : [];
}

/** Search source metadata, applying PDF eligibility before the result limit. */
export async function searchAnnotationSources(
  currentItem: Zotero.Item,
  query: string,
): Promise<AnnotationInsertSource[]> {
  const needle = query.trim();
  if (!needle) return getInitialAnnotationSources(currentItem);
  const search = new Zotero.Search({ libraryID: currentItem.libraryID });
  search.addCondition("title", "contains", needle);
  const ids = await search.search();
  const sources: AnnotationInsertSource[] = [];
  for (
    let offset = 0;
    offset < ids.length && sources.length < MAX_SOURCE_RESULTS;
    offset += 48
  ) {
    const items = await Zotero.Items.getAsync(ids.slice(offset, offset + 48));
    for (const item of items) {
      if (
        !item ||
        item.deleted ||
        item.libraryID !== currentItem.libraryID ||
        (!item.isRegularItem() &&
          (!item.isAttachment() ||
            item.attachmentContentType !== "application/pdf"))
      )
        continue;
      let attachments: Zotero.Item[];
      try {
        attachments = await markdownAnnotationAttachments(item);
      } catch (error) {
        if (error instanceof AnnotationSourceUnavailableError) continue;
        throw error;
      }
      if (!attachments.length) continue;
      sources.push(sourceOption(item));
      if (sources.length === MAX_SOURCE_RESULTS) break;
    }
  }
  return sources;
}
