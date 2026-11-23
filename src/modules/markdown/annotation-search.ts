import {
  AnnotationSourceUnavailableError,
  markdownAnnotationAttachments,
  readMarkdownAnnotationItems,
  type MarkdownAnnotation,
} from "./annotations";

export interface AnnotationInsertSource {
  id: number;
  title: string;
  detail?: string;
}

/** One bounded result batch. The continuation belongs to this query only. */
export interface AnnotationSearchPage {
  annotations: readonly MarkdownAnnotation[];
  loadMore?: (shouldContinue: () => boolean) => Promise<AnnotationSearchPage>;
}

export interface AnnotationSearchFilters {
  type: string;
  colors: readonly string[];
  tag: string;
}

const PAGE_SIZE = 50;

async function sourceAnnotationScope(
  libraryID: number,
  sources: readonly AnnotationInsertSource[],
  shouldContinue: () => boolean,
): Promise<{
  ids: Set<number>;
  sourceKeys: Set<string>;
  attachmentKeys: Set<string>;
}> {
  const ids = new Set<number>();
  const sourceKeys = new Set<string>();
  const attachmentKeys = new Set<string>();
  const scope = { ids, sourceKeys, attachmentKeys };
  for (const source of sources) {
    if (!shouldContinue()) return scope;
    const item = await Zotero.Items.getAsync(source.id);
    if (!item || item.deleted || item.libraryID !== libraryID)
      throw new AnnotationSourceUnavailableError();
    const attachments = await markdownAnnotationAttachments(item);
    if (item.isRegularItem()) sourceKeys.add(item.key);
    else attachmentKeys.add(item.key);
    await Zotero.Items.loadDataTypes(attachments, ["childItems"]);
    for (const attachment of attachments)
      for (const annotation of attachment.getAnnotations())
        ids.add(annotation.id);
  }
  return scope;
}

function nativeAnnotationQuery(
  libraryID: number,
  condition: "annotationText" | "annotationComment" | "tag",
  query: string,
): Promise<number[]> {
  const search = new Zotero.Search({ libraryID });
  search.addCondition("itemType", "is", "annotation");
  search.addCondition(condition, "contains", query);
  return search.search();
}

/** Search native annotation records, then hydrate bounded pages rather than whole PDFs. */
export async function searchLibraryAnnotations(
  currentItem: Zotero.Item,
  query: string,
  sources: readonly AnnotationInsertSource[],
  shouldContinue: () => boolean,
  filters: AnnotationSearchFilters = { type: "", colors: [], tag: "" },
): Promise<AnnotationSearchPage> {
  const colors = new Set(
    filters.colors.map((color) => color.trim().toLowerCase()),
  );
  const needle = query.trim();
  if (
    (!needle &&
      !sources.length &&
      !filters.type &&
      !filters.tag &&
      !colors.size) ||
    !shouldContinue()
  )
    return { annotations: [] };
  const libraryID = currentItem.libraryID;
  const scoped = sources.length
    ? await sourceAnnotationScope(libraryID, sources, shouldContinue)
    : undefined;
  if (!shouldContinue() || scoped?.ids.size === 0) return { annotations: [] };
  let ids: number[];
  if (!needle) {
    if (scoped) ids = [...scoped.ids];
    else {
      const search = new Zotero.Search({ libraryID });
      search.addCondition("itemType", "is", "annotation");
      ids = await search.search();
      if (!shouldContinue()) return { annotations: [] };
    }
  } else {
    // Search has no page-label condition. Read only matching IDs from Zotero's
    // existing schema, with LIKE metacharacters treated as literal user text.
    const pageNeedle = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
    const matches = await Promise.all([
      nativeAnnotationQuery(libraryID, "annotationText", needle),
      nativeAnnotationQuery(libraryID, "annotationComment", needle),
      nativeAnnotationQuery(libraryID, "tag", needle),
      Zotero.DB.columnQueryAsync<number>(
        "SELECT itemAnnotations.itemID FROM itemAnnotations JOIN items USING (itemID) WHERE items.libraryID = ? AND itemAnnotations.pageLabel LIKE ? ESCAPE '\\'",
        [libraryID, pageNeedle],
      ),
    ]);
    if (!shouldContinue()) return { annotations: [] };
    ids = [...new Set(matches.flat())].filter(
      (id) => !scoped || scoped.ids.has(id),
    );
  }
  ids.sort((a, b) => a - b);
  let offset = 0;
  const loadPage = async (
    isCurrent: () => boolean,
  ): Promise<AnnotationSearchPage> => {
    const annotations: MarkdownAnnotation[] = [];
    // Advance the cursor only after the whole page succeeds, so a failed read
    // can retry the same candidates without silently dropping any matches.
    let nextOffset = offset;
    while (nextOffset < ids.length && annotations.length < PAGE_SIZE) {
      if (!isCurrent()) return { annotations: [] };
      const batch = ids.slice(
        nextOffset,
        nextOffset + PAGE_SIZE - annotations.length,
      );
      const items = await Zotero.Items.getAsync(batch);
      if (!isCurrent()) return { annotations: [] };
      const records = await readMarkdownAnnotationItems(libraryID, items);
      if (!isCurrent()) return { annotations: [] };
      annotations.push(
        ...records.filter(
          (record) =>
            (!scoped ||
              scoped.attachmentKeys.has(record.attachmentKey) ||
              (record.sourceKey !== undefined &&
                scoped.sourceKeys.has(record.sourceKey))) &&
            (!filters.type || record.type === filters.type) &&
            (!filters.tag || record.tags?.includes(filters.tag)) &&
            (!colors.size ||
              colors.has(record.color?.trim().toLowerCase() || "")),
        ),
      );
      nextOffset += batch.length;
      if (nextOffset < ids.length && annotations.length < PAGE_SIZE)
        await Zotero.Promise.delay(0);
    }
    offset = nextOffset;
    return {
      annotations,
      ...(offset < ids.length ? { loadMore: loadPage } : {}),
    };
  };
  return loadPage(shouldContinue);
}
