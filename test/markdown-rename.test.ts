import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import path from "node:path";
import { renameMarkdownAttachment } from "../src/modules/markdown/rename.ts";

const syncStates = {
  SYNC_STATE_TO_UPLOAD: 0,
  SYNC_STATE_TO_DOWNLOAD: 1,
  SYNC_STATE_IN_SYNC: 2,
  SYNC_STATE_FORCE_UPLOAD: 3,
  SYNC_STATE_FORCE_DOWNLOAD: 4,
  SYNC_STATE_IN_CONFLICT: 5,
};

function setup(t: TestContext, linked = false) {
  const directory = linked ? "/vault" : "/storage/RENAME01";
  let filename = "zmd-Old.md";
  let title = "Old.md";
  let state = syncStates.SYNC_STATE_IN_SYNC;
  const baselineTime = 1_750_000_000_000;
  const baselineHash = "same-primary-content-hash";
  const imagePath = path.join(directory, "assets", "figure.png");
  const files = new Map([
    [
      path.join(directory, filename),
      { content: "![figure](assets/figure.png)", lastModified: baselineTime },
    ],
    [imagePath, { content: "image bytes", lastModified: baselineTime }],
  ]);
  const modifications: Array<{ path: string; time: number }> = [];
  const saves: Array<{ state: number; title: string }> = [];
  let renameResult: boolean | number | Error = true;
  let nativeRenames = 0;
  const attachment = {
    id: 1201,
    libraryID: 1,
    key: "RENAME01",
    attachmentLinkMode: linked ? 2 : 0,
    attachmentSyncedModificationTime: baselineTime,
    attachmentSyncedHash: baselineHash,
    isAttachment: () => true,
    isStoredFileAttachment: () => !linked,
    isEditable: () => true,
    get attachmentFilename() {
      return filename;
    },
    get attachmentSyncState() {
      return state;
    },
    set attachmentSyncState(value: number | string) {
      assert.equal(linked, false, "linked files do not have file-sync state");
      state =
        typeof value === "string"
          ? syncStates[
              `SYNC_STATE_${value.toUpperCase()}` as keyof typeof syncStates
            ]
          : value;
    },
    getFilePathAsync: async () => path.join(directory, filename),
    getField: () => title,
    setField(field: string, value: string) {
      assert.equal(field, "title");
      title = value;
    },
    async saveTx() {
      saves.push({ state, title });
    },
    async renameAttachmentFile(next: string, overwrite: boolean) {
      assert.equal(overwrite, false);
      nativeRenames += 1;
      if (renameResult instanceof Error) throw renameResult;
      if (renameResult !== true) return renameResult;
      if (next !== filename) {
        const previousPath = path.join(directory, filename);
        const entry = files.get(previousPath)!;
        files.delete(previousPath);
        files.set(path.join(directory, next), entry);
        filename = next;
      }
      return true;
    },
  };
  const globals = {
    Zotero: {
      Attachments: {
        LINK_MODE_IMPORTED_FILE: 0,
        LINK_MODE_IMPORTED_URL: 1,
        LINK_MODE_LINKED_FILE: 2,
      },
      Sync: {
        Storage: { Local: syncStates },
        Runner: { syncInProgress: false },
      },
    },
    IOUtils: {
      async stat(target: string) {
        const entry = files.get(target);
        if (!entry) throw new Error("missing file");
        return { ...entry, type: "regular", size: entry.content.length };
      },
      async setModificationTime(target: string, time: number) {
        const entry = files.get(target);
        if (!entry) throw new Error("missing file");
        entry.lastModified = time;
        modifications.push({ path: target, time });
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  return {
    item: attachment as unknown as Zotero.Item,
    files,
    imagePath,
    baselineTime,
    baselineHash,
    modifications,
    saves,
    set renameResult(value: boolean | number | Error) {
      renameResult = value;
    },
    get nativeRenames() {
      return nativeRenames;
    },
  };
}

test("renaming a synced Markdown attachment with assets invalidates the package without changing its sync baseline", async (t) => {
  const f = setup(t);
  const originalImage = { ...f.files.get(f.imagePath)! };
  assert.equal(await renameMarkdownAttachment(f.item, "Updated.md"), true);
  assert.equal(f.item.attachmentFilename, "zmd-Updated.md");
  assert.equal(f.item.getField("title"), "Updated.md");
  assert.equal(f.item.attachmentSyncState, syncStates.SYNC_STATE_TO_UPLOAD);
  assert.equal(f.item.attachmentSyncedHash, f.baselineHash);
  assert.equal(f.item.attachmentSyncedModificationTime, f.baselineTime);
  const newPath = await f.item.getFilePathAsync();
  const renamed = f.files.get(newPath!)!;
  assert.equal(renamed.content, "![figure](assets/figure.png)");
  assert.ok(renamed.lastModified >= f.baselineTime + 2000);
  assert.equal(f.modifications.length, 1);
  assert.deepEqual(f.files.get(f.imagePath), originalImage);
  assert.equal(f.files.size, 2);
});

test("renaming to the same physical filename does not touch mtime or queue another package upload", async (t) => {
  const f = setup(t);
  assert.equal(await renameMarkdownAttachment(f.item, " zmd-Old.md "), true);
  assert.equal(f.item.attachmentFilename, "zmd-Old.md");
  assert.equal(f.item.attachmentSyncState, syncStates.SYNC_STATE_IN_SYNC);
  assert.equal(
    f.files.get((await f.item.getFilePathAsync())!)!.lastModified,
    f.baselineTime,
  );
  assert.deepEqual(f.modifications, []);
  assert.deepEqual(f.saves, []);
});

test("renaming after choosing the local conflict version preserves force_upload", async (t) => {
  const f = setup(t);
  f.item.attachmentSyncState = syncStates.SYNC_STATE_FORCE_UPLOAD;
  assert.equal(await renameMarkdownAttachment(f.item, "Updated.md"), true);
  assert.equal(f.item.attachmentSyncState, syncStates.SYNC_STATE_FORCE_UPLOAD);
  assert.equal(f.item.attachmentSyncedHash, f.baselineHash);
  assert.equal(f.item.attachmentSyncedModificationTime, f.baselineTime);
  assert.equal(f.modifications.length, 1);
});

for (const result of [false, -1, -2] as const) {
  test(`native rename failure ${result} leaves title, package and sync state intact`, async (t) => {
    const f = setup(t);
    f.renameResult = result;
    assert.equal(await renameMarkdownAttachment(f.item, "Updated.md"), result);
    assert.equal(f.item.attachmentFilename, "zmd-Old.md");
    assert.equal(f.item.getField("title"), "Old.md");
    assert.equal(f.item.attachmentSyncState, syncStates.SYNC_STATE_IN_SYNC);
    assert.deepEqual(f.modifications, []);
    assert.deepEqual(f.saves, []);
    assert.equal(f.files.size, 2);
  });
}

test("a thrown native rename failure remains visible and does not mark an upload", async (t) => {
  const f = setup(t);
  f.renameResult = new Error("Native rename failed");
  await assert.rejects(
    renameMarkdownAttachment(f.item, "Updated.md"),
    /Native rename failed/,
  );
  assert.equal(f.item.attachmentFilename, "zmd-Old.md");
  assert.equal(f.item.attachmentSyncState, syncStates.SYNC_STATE_IN_SYNC);
  assert.deepEqual(f.modifications, []);
  assert.deepEqual(f.saves, []);
});

test("linked Markdown files keep their filename rules without touching Zotero file-sync state", async (t) => {
  const f = setup(t, true);
  assert.equal(await renameMarkdownAttachment(f.item, "Updated.md"), true);
  assert.equal(f.item.attachmentFilename, "zmd-Updated.md");
  assert.equal(await f.item.getFilePathAsync(), "/vault/zmd-Updated.md");
  assert.equal(f.item.getField("title"), "Updated.md");
  assert.equal(f.item.attachmentSyncState, syncStates.SYNC_STATE_IN_SYNC);
  assert.deepEqual(f.modifications, []);
  assert.equal(f.nativeRenames, 1);
});
