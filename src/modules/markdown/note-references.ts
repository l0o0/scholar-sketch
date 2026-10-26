import {
  describeDocumentLinkTargets,
  type DocumentLinkCandidate,
} from "./document-links";
import { isPdfDocumentLink, parseDocumentLink } from "./document-link-shared";
import { readSavedNote, type NoteReadFailure } from "./note-library";
import {
  extractNoteLinks,
  noteLinkExcerpt,
  noteLinkLabel,
  parseNoteLink,
  type ExtractedNoteLink,
} from "./note-links";

export interface NoteReferenceOccurrence {
  /** Keep the persisted destination, including a heading, PDF page or annotation. */
  href: string;
  position: number;
  excerpt: string;
}

export interface NoteReference {
  id: string;
  title: string;
  category: "literature" | "note" | "attachment" | "unresolved";
  status: "resolved" | "pending" | "unavailable";
  candidate?: DocumentLinkCandidate;
  occurrences: NoteReferenceOccurrence[];
}

interface ReferenceTarget {
  id: string;
  libraryID?: number;
  key?: string;
  status: "pending" | "unavailable";
}

function referenceTarget(
  link: ExtractedNoteLink,
  currentItem: Zotero.Item,
): ReferenceTarget | null {
  // This rewrite is only for identity lookup, after the full PDF URI has been
  // validated. Navigation retains the original page/annotation destination.
  const nativeHref = isPdfDocumentLink(link.href)
    ? link.href
        .split("?", 1)[0]
        .replace("zotero://open-pdf/", "zotero://select/")
    : link.href;
  const native = parseDocumentLink(nativeHref);
  if (native) {
    const libraryID =
      native.scope === "library"
        ? Zotero.Libraries.userLibraryID
        : Zotero.Groups.get(native.groupID)?.libraryID;
    return {
      id: libraryID
        ? `${libraryID}/${native.key}`
        : `group/${native.scope === "group" ? native.groupID : "unknown"}/${native.key}`,
      ...(libraryID ? { libraryID } : {}),
      key: native.key,
      status: "unavailable",
    };
  }
  const note = parseNoteLink(link.href);
  // Absolute/remote links, image embeds and local heading-only links do not
  // refer to another Zotero resource in this panel.
  if (!note || !note.target) return null;
  const key = !/[\\/]/.test(note.target)
    ? /--([A-Za-z0-9]{8})(?:\.md)?$/i.exec(note.target)?.[1]
    : undefined;
  if (key) {
    return {
      id: `${currentItem.libraryID}/${key}`,
      libraryID: currentItem.libraryID,
      key,
      status: "unavailable",
    };
  }
  // A legacy title may address a note, a canvas or a regular item. Leave it
  // pending until navigation instead of searching every title during render.
  return { id: `pending/${note.target}`, status: "pending" };
}

/** Read this saved note and metadata for its explicit targets, never target bodies. */
export async function getOutgoingNoteReferences(item: Zotero.Item): Promise<{
  entries: NoteReference[];
  failure?: NoteReadFailure;
}> {
  const note = await readSavedNote(item);
  if (!note) return { entries: [] };
  if (note.readFailure) return { entries: [], failure: note.readFailure };
  const links = note.links ?? extractNoteLinks(note.content);
  const groups = new Map<string, NoteReference>();
  const targets: { libraryID: number; key: string }[] = [];
  for (const link of links) {
    const target = referenceTarget(link, item);
    if (!target || target.id === `${item.libraryID}/${item.key}`) continue;
    let reference = groups.get(target.id);
    if (!reference) {
      reference = {
        id: target.id,
        title: noteLinkLabel(link),
        category: "unresolved",
        status: target.status,
        occurrences: [],
      };
      groups.set(target.id, reference);
      if (target.libraryID && target.key)
        targets.push({ libraryID: target.libraryID, key: target.key });
    }
    reference.occurrences.push({
      href: link.href,
      position: link.from,
      excerpt: noteLinkExcerpt(note.content, link, links),
    });
  }
  for (const candidate of await describeDocumentLinkTargets(targets)) {
    const reference = groups.get(`${candidate.libraryID}/${candidate.key}`);
    if (!reference) continue;
    reference.title = candidate.title;
    reference.status = "resolved";
    reference.category =
      candidate.kind === "regular"
        ? "literature"
        : candidate.kind === "markdown" || candidate.kind === "note"
          ? "note"
          : "attachment";
    reference.candidate = candidate;
  }
  return { entries: [...groups.values()] };
}
