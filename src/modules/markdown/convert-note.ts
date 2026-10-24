import { getString } from "../../utils/locale";
import {
  assertRegularImageFile,
  assertTransferContinues,
} from "./export-notes";
import { validateImageInput, MAX_IMAGE_BYTES } from "./images/model";
import {
  createMarkdownImportPaths,
  normalizeMarkdownFilename,
} from "./storage-filename";
import {
  assertMarkdownImportTarget,
  importMarkdownFile,
  type MarkdownImportTarget,
} from "./transfer";

const converting = new Set<number>();

export interface NoteConversionResult {
  created: Zotero.Item[];
  failed: Array<{ note: Zotero.Item; error: unknown }>;
  cancelled: boolean;
  warnings: number;
}

/** Conversion always creates a new stored attachment. The source Note is read-only. */
export async function convertSelectedNotes(
  win: Window,
  notes: readonly Zotero.Item[],
  options: { shouldContinue?: () => boolean } = {},
): Promise<NoteConversionResult> {
  const result: NoteConversionResult = {
    created: [],
    failed: [],
    cancelled: false,
    warnings: 0,
  };
  const seen = new Set<number>();
  for (const note of notes) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    if (options.shouldContinue?.() === false) {
      result.cancelled = true;
      break;
    }
    try {
      const created = await convertNoteToMarkdown(win, note, options);
      if (created) {
        result.created.push(created.attachment);
        if (created.hasWarnings) result.warnings++;
      } else {
        result.cancelled = true;
        break;
      }
    } catch (error) {
      result.failed.push({ note, error });
    }
  }
  return result;
}

export function canConvertNote(note: Zotero.Item): boolean {
  if (!note.isNote() || note.deleted || !note.isEditable()) return false;
  const library = Zotero.Libraries.get(note.libraryID);
  const parent = note.parentItem;
  return Boolean(
    library &&
    library.editable &&
    library.filesEditable &&
    (!note.parentItemID ||
      (parent?.isRegularItem() && !parent.deleted && parent.isEditable())),
  );
}

export async function convertNoteToMarkdown(
  win: Window,
  note: Zotero.Item,
  options: { shouldContinue?: () => boolean } = {},
): Promise<{ attachment: Zotero.Item; hasWarnings: boolean } | null> {
  if (!canConvertNote(note))
    throw new Error(getString("note-convert-unavailable"));
  if (converting.has(note.id))
    throw new Error(getString("note-convert-running"));
  const html = note.getNote();
  const libraryID = note.libraryID;
  const parentID = note.parentItemID;
  const collections = parentID
    ? []
    : [...note.getCollections()].sort((a, b) => a - b);
  const target: MarkdownImportTarget = {
    libraryID,
    parent: note.parentItem || undefined,
    collectionIDs: collections,
  };
  const title =
    note.getNoteTitle().trim() || getString("note-convert-untitled");
  // A native Note title can contain 120 CJK characters, exceeding common
  // 255-byte filename limits. Sixty Unicode characters also fit with 4-byte UTF-8.
  const filename = normalizeMarkdownFilename([...title].slice(0, 60).join(""));
  const staged = createMarkdownImportPaths(
    Zotero.getTempDirectory().path,
    filename,
  );
  let ownsStaging = false;
  const continues = () => {
    if (options.shouldContinue?.() === false) return false;
    if (
      !canConvertNote(note) ||
      note.libraryID !== libraryID ||
      note.parentItemID !== parentID ||
      note.getNote() !== html ||
      (!parentID &&
        JSON.stringify([...note.getCollections()].sort((a, b) => a - b)) !==
          JSON.stringify(collections))
    )
      throw new Error(getString("note-convert-changed"));
    assertMarkdownImportTarget(target);
    return true;
  };
  converting.add(note.id);
  try {
    assertTransferContinues(continues);
    await IOUtils.makeDirectory(staged.directory, { ignoreExisting: false });
    ownsStaging = true;
    const Parser = win.DOMParser;
    const doc = new Parser().parseFromString(html, "text/html");
    const token = `SCHOLARIMAGE${Math.random().toString(36).slice(2)}${Date.now()}`;
    const markers: string[] = [];
    const preserved: Array<{ marker: string; content: string }> = [];
    let hasWarnings = false;
    let imageIndex = 0;
    for (const image of doc.querySelectorAll("img")) {
      assertTransferContinues(continues);
      const key = image.getAttribute("data-attachment-key");
      const source = image.getAttribute("src") || "";
      let bytes: Uint8Array | undefined;
      let mime = "";
      if (key !== null) {
        if (!/^[A-Za-z0-9]{8}$/.test(key))
          throw new Error(getString("note-convert-image-unavailable"));
        const attachment = Zotero.Items.getByLibraryAndKey(libraryID, key);
        if (
          !attachment ||
          attachment.deleted ||
          !attachment.isEmbeddedImageAttachment() ||
          attachment.libraryID !== libraryID ||
          attachment.parentItemID !== note.id
        )
          throw new Error(getString("note-convert-image-unavailable"));
        const path = await attachment.getFilePathAsync();
        if (!path) throw new Error(getString("note-convert-image-unavailable"));
        const before = await assertRegularImageFile(path);
        mime = attachment.attachmentContentType;
        validateImageInput(mime, before.size ?? 0);
        bytes = await IOUtils.read(path);
        const after = await assertRegularImageFile(path);
        if (
          before.size !== after.size ||
          before.lastModified !== after.lastModified ||
          attachment.deleted ||
          attachment.parentItemID !== note.id
        )
          throw new Error(getString("note-convert-changed"));
      } else if (source.startsWith("data:")) {
        const match =
          /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
            source,
          );
        if (
          !match ||
          match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024
        )
          throw new Error(getString("note-convert-image-unavailable"));
        mime = match[1].toLowerCase();
        try {
          const binary = win.atob(match[2].replace(/\s/g, ""));
          bytes = Uint8Array.from(binary, (character) =>
            character.charCodeAt(0),
          );
        } catch {
          throw new Error(getString("note-convert-image-unavailable"));
        }
      } else if (!/^https?:\/\//i.test(source)) {
        throw new Error(getString("note-convert-image-unavailable"));
      }
      assertTransferContinues(continues);
      if (bytes) {
        const extension = validateImageInput(mime, bytes.byteLength);
        const filename = `note-image-${++imageIndex}.${extension}`;
        const assets = PathUtils.join(staged.directory, "assets");
        await IOUtils.makeDirectory(assets, { ignoreExisting: true });
        await IOUtils.write(PathUtils.join(assets, filename), bytes);
        image.setAttribute("src", `assets/${filename}`);
      }
      image.removeAttribute("data-attachment-key");
      // Native Note Markdown skips image-only Notes. A temporary text marker
      // lets it convert the image normally, including its annotation metadata.
      const marker = `${token}${markers.length}END`;
      markers.push(marker);
      image.after(doc.createTextNode(marker));
    }
    // Markdown cannot express scientific sub/superscripts or merged cells.
    // Keep their source markup instead of allowing the native translator to
    // flatten their meaning; the result explicitly warns about source-only HTML.
    for (const element of doc.querySelectorAll("table, sub, sup")) {
      if (!doc.body.contains(element)) continue;
      if (
        element.localName === "table" &&
        element.querySelector("th") &&
        ![...element.querySelectorAll("[colspan], [rowspan]")].some(
          (cell) =>
            Number(cell.getAttribute("colspan") || 1) > 1 ||
            Number(cell.getAttribute("rowspan") || 1) > 1,
        )
      )
        continue;
      const marker = `${token}HTML${preserved.length}END`;
      preserved.push({ marker, content: element.outerHTML });
      element.replaceWith(doc.createTextNode(marker));
      hasWarnings = true;
    }
    // Turndown escapes Markdown punctuation inside TeX, e.g. a * b becomes
    // a \\* b. Native math already stores its $/$$ delimiters in textContent.
    for (const math of doc.querySelectorAll("span.math, pre.math")) {
      const marker = `${token}MATH${preserved.length}END`;
      const content = math.textContent || "";
      preserved.push({
        marker,
        content: math.localName === "pre" ? `\n\n${content}\n\n` : content,
      });
      math.replaceWith(doc.createTextNode(marker));
    }
    for (const citation of doc.querySelectorAll(".citation[data-citation]")) {
      let valid = false;
      try {
        const data = JSON.parse(
          decodeURIComponent(citation.getAttribute("data-citation")!),
        );
        valid =
          Array.isArray(data.citationItems) &&
          data.citationItems.length > 0 &&
          data.citationItems.every(
            (item: { uris?: unknown }) =>
              Array.isArray(item.uris) &&
              typeof item.uris[0] === "string" &&
              /^https?:\/\/zotero\.org\/(?:users\/(?:local\/[A-Za-z0-9]+|\d+)|groups\/\d+)\/items\/[A-Za-z0-9]{8}$/.test(
                item.uris[0],
              ),
          );
      } catch {
        // Damaged native metadata must not turn a visible citation into an
        // "undefined" link. Keep the text and report the reduced conversion.
      }
      if (!valid) {
        citation.replaceWith(...citation.childNodes);
        hasWarnings = true;
      }
    }
    assertTransferContinues(continues);
    const temporary = new Zotero.Item("note");
    temporary.libraryID = libraryID;
    temporary.setNote(doc.body.innerHTML);
    const translation = new Zotero.Translate.Export();
    translation.setItems([temporary]);
    translation.setTranslator(Zotero.Translators.TRANSLATOR_ID_NOTE_MARKDOWN);
    translation.setDisplayOptions({ includeAppLinks: true });
    let worked = false;
    translation.setHandler(
      "done",
      (_translation: unknown, success: boolean) => {
        worked = success;
      },
    );
    await translation.translate();
    if (!worked || typeof translation.string !== "string")
      throw new Error(getString("note-convert-translation-failed"));
    let markdown = translation.string.replace(/\r\n/g, "\n");
    for (const { marker, content } of preserved.reverse()) {
      if (!markdown.includes(marker))
        throw new Error(getString("note-convert-translation-failed"));
      markdown = markdown.replace(marker, () => content);
    }
    for (const marker of markers) {
      if (!markdown.includes(marker))
        throw new Error(getString("note-convert-translation-failed"));
      markdown = markdown.replace(marker, "");
    }
    if (doc.body.textContent?.trim() && !markdown.trim())
      throw new Error(getString("note-convert-translation-failed"));
    assertTransferContinues(continues);
    await Zotero.File.putContentsAsync(staged.file, markdown);
    const attachment = await importMarkdownFile(win, target, {
      sourcePath: staged.file,
      shouldContinue: continues,
    });
    return attachment ? { attachment, hasWarnings } : null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return null;
    throw error;
  } finally {
    converting.delete(note.id);
    if (ownsStaging) {
      try {
        await IOUtils.remove(staged.directory, { recursive: true });
      } catch (error) {
        // A successfully imported package stays valid even if temporary-file
        // cleanup fails. Reporting it as failed would invite duplicate retries.
        ztoolkit.log("Native Note conversion temporary cleanup failed", error);
      }
    }
  }
}
