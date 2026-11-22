import { getString } from "../../utils/locale";
import { showAnnotationInsertDialog } from "./annotation-dialog";
import {
  getInitialAnnotationSources,
  searchAnnotationSources,
} from "./annotation-sources";
import {
  annotationMarkdownFragment,
  readMarkdownAnnotations,
  type MarkdownAnnotation,
} from "./annotations";
import { sessionRegistry, type OpenSession } from "./session-registry";

async function currentAnnotations(
  libraryID: number,
  chosen: readonly MarkdownAnnotation[],
): Promise<MarkdownAnnotation[]> {
  const attachments = [...new Set(chosen.map((entry) => entry.attachmentKey))];
  const latest = await Promise.all(
    attachments.map(async (key) => {
      const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
      if (!item || item.deleted)
        throw new Error(getString("markdown-annotation-source-changed"));
      return readMarkdownAnnotations(item);
    }),
  );
  const byIdentity = new Map(
    latest
      .flat()
      .map((entry) => [`${entry.attachmentKey}/${entry.key}`, entry]),
  );
  return chosen.map((entry) => {
    const current = byIdentity.get(`${entry.attachmentKey}/${entry.key}`);
    if (!current)
      throw new Error(getString("markdown-annotation-source-changed"));
    return current;
  });
}

/** Own the picker and its asynchronous insertion for one mounted editor. */
export async function insertSessionAnnotations(
  session: OpenSession,
  editable: () => boolean,
): Promise<void> {
  const editor = session.editor;
  if (!editor || session.closeAnnotationInsert || !editable()) return;
  const item = Zotero.Items.get(session.itemID);
  if (!item || item.deleted)
    throw new Error(getString("error-attachment-gone"));
  if (editor.isComposing()) throw new Error(getString("note-export-composing"));

  let active = true;
  let inserted = false;
  let disposeDialog = () => {};
  const current = () =>
    active &&
    !session.closing &&
    sessionRegistry.get(session.tabID) === session &&
    session.editor === editor &&
    session.isActive() &&
    !item.deleted &&
    item.isEditable() &&
    editable();
  const clear = () => {
    active = false;
    if (session.closeAnnotationInsert === close)
      session.closeAnnotationInsert = undefined;
  };
  const close = () => {
    if (!active) return;
    clear();
    disposeDialog();
  };
  session.closeAnnotationInsert = close;

  try {
    const [source, initialSources] = await Promise.all([
      editor.requestSnapshot(),
      getInitialAnnotationSources(item),
    ]);
    if (!current()) {
      close();
      return;
    }
    disposeDialog = showAnnotationInsertDialog(session.win, {
      initialSources,
      searchSources: (query) => searchAnnotationSources(item, query),
      loadAnnotations: (source) => {
        const sourceItem = Zotero.Items.get(source.id);
        if (
          !sourceItem ||
          sourceItem.deleted ||
          sourceItem.libraryID !== item.libraryID
        )
          throw new Error(getString("markdown-annotation-source-changed"));
        return readMarkdownAnnotations(sourceItem);
      },
      insert: async (chosen, shouldContinue) => {
        const latest = await currentAnnotations(item.libraryID, chosen);
        const value = await editor.requestSnapshot();
        if (!shouldContinue() || !current()) return false;
        if (value !== source || editor.isComposing())
          throw new Error(getString("markdown-annotation-document-changed"));
        const markdown = annotationMarkdownFragment(chosen);
        if (markdown !== annotationMarkdownFragment(latest))
          throw new Error(getString("markdown-annotation-source-changed"));
        if (!editor.insertPdfQuotation(markdown, source))
          throw new Error(getString("markdown-annotation-document-changed"));
        inserted = true;
        return true;
      },
      onClose: () => {
        clear();
        if (
          inserted &&
          !session.closing &&
          sessionRegistry.get(session.tabID) === session &&
          session.editor === editor
        )
          editor.focus();
      },
    });
  } catch (error) {
    close();
    throw error;
  }
}

export function reportAnnotationInsertError(error: unknown): void {
  ztoolkit.log("Markdown annotation insertion failed", error);
  const message = error instanceof Error ? error.message : String(error);
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({ text: message, type: "fail" })
    .show();
}
