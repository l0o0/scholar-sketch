import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { Window } from "happy-dom";
import { clearNoteLibraries } from "../../src/modules/markdown/note-library.ts";

export function noteConversionFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "scholar-note-conversion-"));
  const temp = join(directory, "temp");
  const storage = join(directory, "storage");
  const win = new Window();
  const previous = new Map(
    ["Zotero", "IOUtils", "PathUtils", "ztoolkit", "addon"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const library = { id: 1, libraryID: 1, editable: true, filesEditable: true };
  const group = { id: 2, libraryID: 2, editable: true, filesEditable: true };
  const items = new Map<number, any>();
  const imports: Array<Record<string, any>> = [];
  const erased: number[] = [];
  const logs: unknown[][] = [];
  const staged: string[] = [];
  let failSave = false;
  let failTranslation = false;
  let failRemove: string | undefined;
  let afterRead: ((path: string) => void | Promise<void>) | undefined;
  let afterImport: (() => void | Promise<void>) | undefined;
  let translate: (html: string) => string | Promise<string> = (html) => {
    const doc = new win.DOMParser().parseFromString(html, "text/html");
    const images = [...doc.querySelectorAll("img")].map(
      (image) =>
        `![${image.getAttribute("alt") || ""}](${image.getAttribute("src")})`,
    );
    return `# Converted\n\n${doc.body.textContent}\n\n${images.join("\n\n")}`;
  };
  class TemporaryNote {
    libraryID = 0;
    html = "";
    setNote(value: string) {
      this.html = value;
    }
    getNote() {
      return this.html;
    }
    isNote() {
      return true;
    }
  }
  class Translation {
    items: TemporaryNote[] = [];
    string = "";
    done: ((translation: Translation, worked: boolean) => void) | undefined;
    setItems(value: TemporaryNote[]) {
      assert.ok(
        value.every((note) => note instanceof TemporaryNote),
        "must pass an unsaved copy to Zotero translator",
      );
      this.items = value;
    }
    setTranslator(id: string) {
      assert.equal(id, "native-note-markdown");
    }
    setDisplayOptions(options: unknown) {
      assert.deepEqual(options, { includeAppLinks: true });
    }
    setHandler(name: string, handler: Translation["done"]) {
      assert.equal(name, "done");
      this.done = handler;
    }
    async translate() {
      if (!failTranslation)
        this.string = await translate(this.items[0].getNote());
      this.done?.(this, !failTranslation);
    }
  }
  const api = {
    Libraries: {
      userLibraryID: 1,
      get: (id: number) => (id === 1 ? library : id === 2 ? group : false),
    },
    Collections: {
      get: (id: number) =>
        [10, 11, 20].includes(id)
          ? { id, libraryID: id === 20 ? 2 : 1 }
          : false,
    },
    Items: {
      get: (id: number) => items.get(id),
      getByLibraryAndKey: (libraryID: number, key: string) =>
        [...items.values()].find(
          (item) => item.libraryID === libraryID && item.key === key,
        ),
    },
    Item: TemporaryNote,
    Translate: { Export: Translation },
    Translators: { TRANSLATOR_ID_NOTE_MARKDOWN: "native-note-markdown" },
    File: {
      getContentsAsync: (path: string) => readFile(path, "utf8"),
      putContentsAsync: (path: string, content: string) =>
        writeFile(path, content),
      pathToFile: (path: string) => ({
        isSymlink: () => lstatSync(path).isSymbolicLink(),
      }),
    },
    getTempDirectory: () => ({ path: temp }),
    Attachments: {
      LINK_MODE_IMPORTED_FILE: 0,
      async importSnapshotFromFile(options: Record<string, any>) {
        // Native snapshot import forwards url to Item.setField, which rejects undefined.
        if (options.url === undefined)
          throw new Error("'url' value cannot be undefined");
        assert.equal(
          options.url,
          "",
          "local Markdown packages must not claim a remote URL",
        );
        imports.push(options);
        const id = 100 + imports.length;
        const folder = join(storage, String(id));
        await cp(dirname(options.file), folder, { recursive: true });
        let syncState: string | number = 0;
        const created = {
          id,
          key: `FILE${String(id).padStart(4, "0")}`,
          libraryID: options.parentItemID
            ? items.get(options.parentItemID).libraryID
            : options.libraryID,
          parentItemID: options.parentItemID,
          attachmentFilename: basename(options.file),
          attachmentContentType: "text/markdown",
          attachmentLinkMode: 1,
          attachmentSyncedModificationTime: 0,
          collections: [] as number[],
          isAttachment: () => true,
          isStoredFileAttachment: () => true,
          getField: () => options.title,
          getFilePathAsync: async () => join(folder, basename(options.file)),
          get attachmentSyncState() {
            return syncState;
          },
          set attachmentSyncState(value: number | string) {
            syncState = value === "to_upload" ? 0 : value;
          },
          setCollections(ids: number[]) {
            this.collections = ids;
          },
          async saveTx() {
            if (failSave) throw new Error("Metadata save failed");
          },
          async eraseTx() {
            erased.push(id);
            items.delete(id);
            await rm(folder, { recursive: true, force: true });
          },
        };
        items.set(id, created);
        await afterImport?.();
        return created;
      },
    },
  };
  Object.assign(globalThis, {
    Zotero: api,
    PathUtils: {
      join: (base: string, ...components: string[]) => {
        for (const component of components)
          assert.ok(
            component && !/[\\/\0]/.test(component) && component !== "..",
          );
        return join(base, ...components);
      },
      parent: dirname,
      filename: basename,
    },
    IOUtils: {
      exists: async (path: string) => existsSync(path),
      makeDirectory: async (path: string, options: any = {}) => {
        if (dirname(path) === temp) staged.push(path);
        await mkdir(path, {
          recursive: Boolean(options.ignoreExisting || options.createAncestors),
        });
      },
      read: async (path: string) => {
        const bytes = await readFile(path);
        await afterRead?.(path);
        return bytes;
      },
      write: (path: string, bytes: Uint8Array) => writeFile(path, bytes),
      stat: async (path: string) => {
        const info = await stat(path);
        return {
          type: info.isFile() ? "regular" : "directory",
          size: info.size,
          lastModified: info.mtimeMs,
        };
      },
      remove: async (path: string, options: any) => {
        if (path === failRemove) throw new Error("Temporary cleanup denied");
        await rm(path, { recursive: options?.recursive, force: true });
      },
      setModificationTime: (path: string, time: number) =>
        utimes(path, new Date(time), new Date(time)),
    },
    ztoolkit: {
      log: (...args: unknown[]) => logs.push(args),
      getGlobal: (name: string) =>
        name === "DOMParser" ? win.DOMParser : undefined,
    },
    addon: {
      data: { config: { addonRef: "bamboo", addonName: "Scholar Sketch" } },
    },
  });
  t.after(() => {
    clearNoteLibraries();
    win.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    rmSync(directory, { recursive: true, force: true });
  });
  function makeNote(
    id: number,
    html: string,
    options: {
      libraryID?: number;
      parent?: number;
      collections?: number[];
      title?: string;
    } = {},
  ) {
    const note = {
      id,
      key: `NOTE${String(id).padStart(4, "0")}`,
      libraryID: options.libraryID ?? 1,
      parentItemID: options.parent,
      deleted: false,
      editable: true,
      html,
      collections: options.collections ?? [],
      get parentItem() {
        return items.get(this.parentItemID!);
      },
      isNote: () => true,
      isEditable() {
        return this.editable;
      },
      getNote() {
        return this.html;
      },
      getNoteTitle: () => options.title ?? `Test Note ${id}`,
      getCollections() {
        return [...this.collections];
      },
      setNote() {
        throw new Error("Original Note must never be modified");
      },
      saveTx() {
        throw new Error("Original Note must never be saved");
      },
      eraseTx() {
        throw new Error("Original Note must never be deleted");
      },
    };
    items.set(id, note);
    return note as unknown as Zotero.Item & {
      html: string;
      collections: number[];
      editable: boolean;
    };
  }
  async function addImage(
    note: Zotero.Item,
    key = "IMAGE001",
    bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  ) {
    const path = join(directory, `${key}.png`);
    await writeFile(path, bytes);
    const image = {
      id: 1000 + items.size,
      key,
      libraryID: note.libraryID,
      parentItemID: note.id,
      deleted: false,
      attachmentContentType: "image/png",
      isEmbeddedImageAttachment: () => true,
      getFilePathAsync: async () => path,
    };
    items.set(image.id, image);
    return { image, path, bytes };
  }
  return {
    win: win as unknown as Window & globalThis.Window,
    domWindow: win,
    directory,
    temp,
    storage,
    library,
    group,
    api,
    items,
    imports,
    erased,
    staged,
    logs,
    makeNote,
    addImage,
    async setup() {
      await mkdir(temp);
      await mkdir(storage);
    },
    async content(attachment: Zotero.Item) {
      return readFile((await attachment.getFilePathAsync()) as string, "utf8");
    },
    setTranslate: (value: typeof translate) => {
      translate = value;
    },
    setAfterRead: (value: typeof afterRead) => {
      afterRead = value;
    },
    setAfterImport: (value: typeof afterImport) => {
      afterImport = value;
    },
    setFailTranslation: (value = true) => {
      failTranslation = value;
    },
    setFailSave: (value = true) => {
      failSave = value;
    },
    setFailRemove: (value: string) => {
      failRemove = value;
    },
  };
}
