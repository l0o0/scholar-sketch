import { isMarkdownAttachment } from "../markdown/detect";
import { isWhiteboardAttachment } from "./detect";

export type TutorialKind = "markdown" | "canvas";

const tutorialTags: Record<TutorialKind, string> = {
  markdown: "scholar-sketch:tutorial:markdown",
  canvas: "scholar-sketch:tutorial:canvas",
};

/** Find by synced identity first; legacy titles only establish a reuse candidate. */
export async function findTutorialAttachment(
  kind: TutorialKind,
  titles: readonly string[],
): Promise<Zotero.Item | null> {
  const libraryID = Zotero.Libraries.userLibraryID;
  const matchesKind =
    kind === "markdown" ? isMarkdownAttachment : isWhiteboardAttachment;
  const search = async (condition: "tag" | "title", value: string) => {
    const query = new Zotero.Search({ libraryID });
    query.addCondition("itemType", "is", "attachment");
    query.addCondition("deleted", "false");
    query.addCondition(condition, "is", value);
    return query.search();
  };
  const firstAttachment = async (ids: number[]) => {
    if (!ids.length) return null;
    const items = await Zotero.Items.getAsync([...new Set(ids)]);
    return (
      items
        .filter(
          (item) =>
            item.libraryID === libraryID && !item.deleted && matchesKind(item),
        )
        .sort((left, right) => left.id - right.id)[0] ?? null
    );
  };

  const marked = await firstAttachment(await search("tag", tutorialTags[kind]));
  if (marked) return marked;

  const aliases = new Set<string>();
  for (const title of titles) {
    aliases.add(title);
    // Zotero may display an attachment title without the filename extension.
    aliases.add(title.replace(/\.(?:md|canvas)$/i, ""));
  }
  const candidates: number[] = [];
  for (const title of aliases)
    candidates.push(...(await search("title", title)));
  // Discovery deliberately reads metadata only: a file waiting for download
  // remains the existing tutorial and must not cause a duplicate attachment.
  return firstAttachment(candidates);
}

export async function markTutorialAttachment(
  item: Zotero.Item,
  kind: TutorialKind,
): Promise<void> {
  await Zotero.Items.loadDataTypes([item], ["tags"]);
  if (item.hasTag(tutorialTags[kind])) return;
  item.addTag(tutorialTags[kind], 1);
  await item.saveTx({ skipSelect: true });
}

/** Resolve a saved identity without requiring the attachment file to be downloaded. */
export async function resolveTutorialAttachment(
  kind: TutorialKind,
  key: string,
): Promise<Zotero.Item | null> {
  if (!Zotero.Utilities.isValidObjectKey(key))
    throw new Error("Invalid tutorial attachment key");
  const libraryID = Zotero.Libraries.userLibraryID;
  const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  return item &&
    item.libraryID === libraryID &&
    !item.deleted &&
    (kind === "markdown"
      ? isMarkdownAttachment(item)
      : isWhiteboardAttachment(item))
    ? item
    : null;
}
