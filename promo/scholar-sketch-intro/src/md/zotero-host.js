// Markdown host on the film's shared Zotero (src/library/zotero.js): the REAL host modules run on it
// (link search, backlinks, note index), with the same post-processing as the production bridge.
import {fake, itemByKey} from '../library/zotero.js';
import {searchDocumentLinks} from '@plugin/modules/markdown/document-links.ts';
import {clearNoteLibraries} from '@plugin/modules/markdown/note-library.ts';
import {isEditorLinkIcon} from '@plugin/modules/markdown/editor-protocol.ts';
import {KEYS} from '../library/fixture.js';
import {zhOr} from './zh.js';

export {fake};
clearNoteLibraries();

export const currentItem = () => itemByKey(KEYS.note);

/** Same post-processing as createMarkdownEditor's linkSearch branch (src/modules/markdown/editor.ts). */
export async function linkSearch(query, filter, currentContent) {
  const results = await searchDocumentLinks(currentItem(), query, false, {filter, win: window, currentContent});
  return results.slice(0, 24).map(({itemID: _id, ...candidate}) => ({
    ...candidate,
    icon: isEditorLinkIcon(candidate.icon) ? candidate.icon : undefined,
    kindLabel: candidate.kindLabel || zhOr(`document-link-kind-${candidate.kind}`, candidate.kind),
  }));
}
