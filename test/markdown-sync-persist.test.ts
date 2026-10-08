import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { readFileVersions } from "../src/modules/file-safety.ts";
import { persistMarkdownContent } from "../src/modules/markdown/persist.ts";
import { writeImageAsset } from "../src/modules/markdown/images/service.ts";
import { SaveCoordinator } from "../src/modules/markdown/save-coordinator.ts";

const TO_UPLOAD = 0;
const TO_DOWNLOAD = 1;
const IN_SYNC = 2;
const FORCE_UPLOAD = 3;
const FORCE_DOWNLOAD = 4;
const IN_CONFLICT = 5;
const usedFilename = "1700000000000-aaaaaaa.png";
const orphanFilename = "1700000000000-bbbbbbb.png";
const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

type WriteOptions = { tmpPath?: string; flush?: boolean; mode?: string };

async function setup(context: TestContext, state = IN_SYNC) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "markdown-sync-"));
  const storage = path.join(root, "storage", "ABCDEFGH");
  const assets = path.join(storage, "assets");
  const target = path.join(storage, "note.md");
  const initial = `# Note\n\n![figure](assets/${usedFilename})\n`;
  await fs.mkdir(assets, { recursive: true });
  await fs.writeFile(target, initial);
  await fs.writeFile(path.join(assets, usedFilename), imageBytes);
  await fs.writeFile(path.join(assets, orphanFilename), imageBytes);
  const baselineMtime = (await fs.stat(target)).mtimeMs;
  const baselineHash = createHash("md5").update(initial).digest("hex");
  let title = "Note.md";
  let busy = false;
  let heldDelays = 0;
  let releases = 0;
  let syncState = state;
  let delay: (ms: number) => Promise<void> = async () => {
    throw new Error("Unexpected sync wait");
  };
  const utf8Writes: Array<{
    target: string;
    options: WriteOptions;
    heldDelays: number;
  }> = [];
  const saveOptions: Record<string, unknown>[] = [];
  const touched: number[] = [];
  const removed: string[] = [];

  const io = {
    exists: (target: string) =>
      fs.access(target).then(
        () => true,
        () => false,
      ),
    getChildren: async (target: string) =>
      (await fs.readdir(target)).sort().map((name) => path.join(target, name)),
    readUTF8: (target: string) => fs.readFile(target, "utf8"),
    read: async (target: string) => Uint8Array.from(await fs.readFile(target)),
    makeDirectory: (target: string, _options?: unknown) =>
      fs.mkdir(target, { recursive: true }),
    stat: async (target: string) => {
      const info = await fs.stat(target);
      return {
        type: info.isDirectory() ? "directory" : "regular",
        lastModified: info.mtimeMs,
        size: info.size,
      };
    },
    setModificationTime: async (target: string, mtime: number) => {
      touched.push(mtime);
      const info = await fs.stat(target);
      await fs.utimes(target, info.atime, new Date(mtime));
    },
    writeUTF8: async (
      target: string,
      content: string,
      options: WriteOptions = {},
    ) => {
      utf8Writes.push({ target, options, heldDelays });
      await fs.writeFile(options.tmpPath ?? target, content, {
        flag: options.mode === "create" ? "wx" : "w",
      });
      if (options.tmpPath) await fs.rename(options.tmpPath, target);
    },
    write: async (target: string, bytes: Uint8Array) => {
      assert.equal(heldDelays, 1, "image writes must hold the sync delay");
      await fs.writeFile(target, bytes);
    },
    remove: async (target: string) => {
      removed.push(target);
      if ((await fs.stat(target)).isDirectory()) await fs.rmdir(target);
      else await fs.unlink(target);
    },
  };
  const item = {
    id: 42,
    key: "ABCDEFGH",
    libraryID: 1,
    attachmentLinkMode: 0,
    attachmentFilename: "note.md",
    attachmentContentType: "text/markdown",
    attachmentSyncedModificationTime: baselineMtime,
    attachmentSyncedHash: baselineHash,
    isStoredFileAttachment: () => true,
    isAttachment: () => true,
    isEditable: () => true,
    getFilePath: () => target,
    getFilePathAsync: async () => target,
    getField: (field: string) => (field === "title" ? title : ""),
    setField: (field: string, value: string) => {
      if (field === "title") title = value;
    },
    get attachmentSyncState() {
      return syncState;
    },
    set attachmentSyncState(value: number | string) {
      const normalized =
        typeof value === "string"
          ? {
              to_upload: TO_UPLOAD,
              to_download: TO_DOWNLOAD,
              in_sync: IN_SYNC,
              force_upload: FORCE_UPLOAD,
              force_download: FORCE_DOWNLOAD,
              in_conflict: IN_CONFLICT,
            }[value]
          : value;
      assert.equal(typeof normalized, "number");
      syncState = normalized!;
    },
    get attachmentModificationTime() {
      return fs.stat(target).then((info) => info.mtimeMs);
    },
    get attachmentHash() {
      return fs
        .readFile(target)
        .then((bytes) => createHash("md5").update(bytes).digest("hex"));
    },
    saveTx: async (options: Record<string, unknown>) => {
      saveOptions.push(options);
    },
  } as unknown as Zotero.Item;
  const globals = globalThis as unknown as Record<string, unknown>;
  const names = ["Zotero", "IOUtils", "PathUtils", "ztoolkit"];
  const previous = names.map((name) => [name, globals[name]] as const);
  Object.assign(globals, {
    IOUtils: io,
    PathUtils: {
      join: path.join,
      parent: path.dirname,
      filename: path.basename,
    },
    ztoolkit: { log() {} },
    Zotero: {
      DataDirectory: { dir: root },
      Libraries: { userLibraryID: 1 },
      Attachments: {
        LINK_MODE_IMPORTED_FILE: 0,
        LINK_MODE_IMPORTED_URL: 1,
        LINK_MODE_LINKED_FILE: 2,
        LINK_MODE_LINKED_URL: 3,
        getStorageDirectory: () => ({ path: storage }),
      },
      File: {
        getContentsAsync: io.readUTF8,
        putContentsAsync: (target: string, value: string) =>
          io.writeUTF8(target, value),
      },
      Promise: { delay: (ms: number) => delay(ms) },
      Sync: {
        Runner: {
          get syncInProgress() {
            return busy;
          },
          delayIndefinite: () => {
            heldDelays += 1;
            return () => {
              heldDelays -= 1;
              releases += 1;
            };
          },
        },
      },
    },
  });
  context.after(async () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const revision = { content: initial };
  return {
    root,
    storage,
    assets,
    target,
    initial,
    item,
    io,
    revision,
    baselineMtime,
    baselineHash,
    utf8Writes,
    saveOptions,
    touched,
    removed,
    setBusy(value: boolean) {
      busy = value;
    },
    setDelay(callback: (ms: number) => Promise<void>) {
      delay = callback;
    },
    get heldDelays() {
      return heldDelays;
    },
    get releases() {
      return releases;
    },
  };
}

async function directorySnapshot(
  root: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else
        result[path.relative(root, target)] = (
          await fs.readFile(target)
        ).toString("hex");
    }
  }
  await visit(root);
  return result;
}

async function holdSync(mock: Awaited<ReturnType<typeof setup>>) {
  const waiting = deferred();
  const finished = deferred();
  mock.setBusy(true);
  mock.setDelay(async (ms) => {
    assert.equal(ms, 100);
    waiting.resolve();
    await finished.promise;
  });
  return {
    waiting: waiting.promise,
    finish() {
      mock.setBusy(false);
      finished.resolve();
    },
  };
}

test("sync keeps the Markdown package stable while an outside-storage draft protects pending text", async (context) => {
  const mock = await setup(context);
  const before = await directorySnapshot(mock.storage);
  const sync = await holdSync(mock);
  const value = mock.initial.replace("# Note", "# Edited");
  const save = persistMarkdownContent(mock.item, value, {
    revision: mock.revision,
    syncFile: true,
  });
  await sync.waiting;

  assert.deepEqual(await directorySnapshot(mock.storage), before);
  assert.equal(mock.heldDelays, 0);
  const drafts = (await readFileVersions(mock.item)).filter(
    (v) => v.kind === "draft",
  );
  assert.deepEqual(
    drafts.map((v) => v.content),
    [value],
  );
  const history = path.join(
    mock.root,
    "scholar-canvas",
    "history",
    "1",
    mock.item.key,
  );
  assert.equal(history.startsWith(mock.storage + path.sep), false);
  assert.equal((await fs.readdir(history)).length, 1);

  sync.finish();
  await save;
  assert.equal(await fs.readFile(mock.target, "utf8"), value);
  assert.equal(mock.revision.content, value);
  assert.equal(mock.item.attachmentSyncState, TO_UPLOAD);
  assert.equal(
    await mock.io.exists(path.join(mock.assets, usedFilename)),
    true,
  );
  assert.equal(
    await mock.io.exists(path.join(mock.assets, orphanFilename)),
    true,
  );
  assert.equal(mock.releases, 1);
});

test("a remote Markdown rewrite during sync becomes a recoverable conflict before any image cleanup", async (context) => {
  const mock = await setup(context);
  const imagesBefore = await directorySnapshot(mock.assets);
  const sync = await holdSync(mock);
  const localDraft = "# Local draft without the image reference\n";
  const remote = "# Remote document\n";
  const save = persistMarkdownContent(mock.item, localDraft, {
    revision: mock.revision,
    syncFile: true,
    syncTitle: true,
    cleanupImages: true,
  });
  await sync.waiting;
  await fs.writeFile(mock.target, remote);
  sync.finish();
  await assert.rejects(save, { code: "WRITE_CONFLICT" });

  assert.equal(await fs.readFile(mock.target, "utf8"), remote);
  assert.equal(mock.revision.content, mock.initial);
  assert.deepEqual(await directorySnapshot(mock.assets), imagesBefore);
  assert.deepEqual(mock.removed, []);
  assert.deepEqual(mock.touched, []);
  assert.deepEqual(mock.saveOptions, []);
  assert.equal(mock.item.getField("title"), "Note.md");
  assert.ok(
    (await readFileVersions(mock.item)).some(
      (v) => v.kind === "conflict" && v.content === localDraft,
    ),
  );
  assert.equal(mock.heldDelays, 0);
});

for (const state of [TO_DOWNLOAD, FORCE_DOWNLOAD, IN_CONFLICT]) {
  test(`numeric sync state ${state} archives the draft without writing or deleting package files`, async (context) => {
    const mock = await setup(context, state);
    const before = await directorySnapshot(mock.storage);
    const draft = "# Local draft\n";
    await assert.rejects(
      persistMarkdownContent(mock.item, draft, {
        revision: mock.revision,
        syncFile: true,
        syncTitle: true,
        cleanupImages: true,
      }),
      { code: "ATTACHMENT_SYNC_CONFLICT" },
    );

    assert.deepEqual(await directorySnapshot(mock.storage), before);
    assert.equal(mock.item.attachmentSyncState, state);
    assert.equal(mock.revision.content, mock.initial);
    assert.deepEqual(mock.removed, []);
    assert.deepEqual(mock.touched, []);
    assert.deepEqual(mock.saveOptions, []);
    assert.deepEqual(
      (await readFileVersions(mock.item)).map((v) => [v.kind, v.content]),
      [["draft", draft]],
    );
    assert.equal(mock.heldDelays, 0);
  });
}

test("saving keeps the native local-version force-upload choice intact", async (context) => {
  const mock = await setup(context, FORCE_UPLOAD);
  const value = mock.initial.replace("# Note", "# Local version");
  await persistMarkdownContent(mock.item, value, {
    revision: mock.revision,
    syncFile: true,
  });
  assert.equal(await fs.readFile(mock.target, "utf8"), value);
  assert.equal(mock.item.attachmentSyncState, FORCE_UPLOAD);
  assert.deepEqual(mock.saveOptions, []);
  assert.equal(mock.item.attachmentSyncedHash, mock.baselineHash);
  assert.equal(mock.item.attachmentSyncedModificationTime, mock.baselineMtime);
});

test("ordinary saving preserves generated images even when the current text does not reference them", async (context) => {
  const mock = await setup(context);
  const before = await directorySnapshot(mock.assets);
  await persistMarkdownContent(
    mock.item,
    "# Edited without image references\n",
    {
      revision: mock.revision,
      syncFile: true,
    },
  );
  assert.deepEqual(await directorySnapshot(mock.assets), before);
  assert.deepEqual(mock.removed, []);
});

test("explicit image cleanup preserves referenced and custom images and signals a new package with unchanged text", async (context) => {
  const mock = await setup(context);
  const custom = path.join(mock.assets, "user-image.png");
  await fs.writeFile(custom, imageBytes);
  await persistMarkdownContent(mock.item, mock.initial, {
    revision: mock.revision,
    syncFile: true,
    cleanupImages: true,
  });

  assert.equal(await fs.readFile(mock.target, "utf8"), mock.initial);
  assert.equal(await mock.item.attachmentHash, mock.baselineHash);
  assert.equal(
    await mock.io.exists(path.join(mock.assets, usedFilename)),
    true,
  );
  assert.equal(await mock.io.exists(custom), true);
  assert.equal(
    await mock.io.exists(path.join(mock.assets, orphanFilename)),
    false,
  );
  assert.equal(mock.touched.length, 1);
  assert.ok(mock.touched[0] >= mock.baselineMtime + 2000);
  assert.equal(mock.item.attachmentSyncState, TO_UPLOAD);
  assert.equal(mock.item.attachmentSyncedModificationTime, mock.baselineMtime);
  assert.equal(mock.item.attachmentSyncedHash, mock.baselineHash);
});

test("image insertion waits until sync finishes before adding bytes to the attachment package", async (context) => {
  const mock = await setup(context);
  const before = await directorySnapshot(mock.storage);
  const sync = await holdSync(mock);
  const write = writeImageAsset(mock.item, imageBytes, "image/png");
  await sync.waiting;
  assert.deepEqual(await directorySnapshot(mock.storage), before);
  sync.finish();
  const reference = await write;
  assert.ok(reference.startsWith("assets/"));
  assert.deepEqual(
    Uint8Array.from(await fs.readFile(path.join(mock.storage, reference))),
    imageBytes,
  );
  assert.equal(mock.releases, 1);
  assert.equal(mock.heldDelays, 0);
});

test("protected Markdown writes use a hidden atomic temporary path inside storage", async (context) => {
  const mock = await setup(context);
  await persistMarkdownContent(mock.item, "# Updated\n", {
    revision: mock.revision,
    syncFile: true,
  });
  const writes = mock.utf8Writes.filter(
    (write) => write.target === mock.target,
  );
  assert.equal(writes.length, 1);
  const [write] = writes;
  assert.equal(write.heldDelays, 1);
  assert.equal(write.options.flush, true);
  assert.ok(write.options.tmpPath);
  assert.equal(path.dirname(write.options.tmpPath), mock.storage);
  assert.ok(path.basename(write.options.tmpPath).startsWith("."));
  assert.deepEqual((await fs.readdir(mock.storage)).sort(), [
    "assets",
    "note.md",
  ]);
});

test("a disk failure stays unsaved, retains recoverable text, and cannot report successful persistence", async (context) => {
  const mock = await setup(context);
  const original = mock.io.writeUTF8;
  const diskError = new Error("disk full");
  mock.io.writeUTF8 = async (...args) => {
    if (args[0] === mock.target) throw diskError;
    await original(...args);
  };
  const value = "# Draft that did not reach disk\n";
  const save: SaveCoordinator = new SaveCoordinator({
    getSnapshot: () => ({ rev: save.currentRev, value }),
    write: async (value) => {
      await persistMarkdownContent(mock.item, value, {
        revision: mock.revision,
        syncFile: true,
      });
    },
  });
  save.markChanged();
  await assert.rejects(save.request(), (error) => error === diskError);
  assert.equal(save.dirty, true);
  assert.equal(save.savedRev, 0);
  assert.equal(save.lastError, diskError);
  assert.equal(await fs.readFile(mock.target, "utf8"), mock.initial);
  assert.equal(mock.revision.content, mock.initial);
  assert.equal(mock.item.attachmentSyncState, IN_SYNC);
  assert.ok(
    (await readFileVersions(mock.item)).some(
      (v) => v.kind === "conflict" && v.content === value,
    ),
  );
  assert.equal(mock.heldDelays, 0);
});

test("partially failed explicit cleanup rejects the save while retaining its package upload signal", async (context) => {
  const mock = await setup(context);
  const secondOrphan = path.join(mock.assets, "1700000000000-ccccccc.png");
  await fs.writeFile(secondOrphan, imageBytes);
  const original = mock.io.remove;
  const cleanupError = new Error("image removal denied");
  mock.io.remove = async (target) => {
    if (target === secondOrphan) throw cleanupError;
    await original(target);
  };
  const save: SaveCoordinator = new SaveCoordinator({
    getSnapshot: () => ({ rev: save.currentRev, value: mock.initial }),
    write: async (value) => {
      await persistMarkdownContent(mock.item, value, {
        revision: mock.revision,
        syncFile: true,
        cleanupImages: true,
      });
    },
  });
  save.markChanged();
  await assert.rejects(save.request(), (error) => error === cleanupError);
  assert.equal(save.dirty, true);
  assert.equal(save.lastError, cleanupError);
  assert.equal(
    await mock.io.exists(path.join(mock.assets, orphanFilename)),
    false,
  );
  assert.equal(await mock.io.exists(secondOrphan), true);
  assert.equal(
    await mock.io.exists(path.join(mock.assets, usedFilename)),
    true,
  );
  assert.equal(mock.item.attachmentSyncState, TO_UPLOAD);
  assert.ok(mock.touched[0] >= mock.baselineMtime + 2000);
  assert.equal(mock.item.attachmentSyncedHash, mock.baselineHash);
  assert.equal(mock.heldDelays, 0);

  mock.io.remove = original;
  await save.request();
  assert.equal(save.dirty, false);
  assert.equal(save.lastError, null);
  assert.equal(await mock.io.exists(secondOrphan), false);
  assert.equal(
    await mock.io.exists(path.join(mock.assets, usedFilename)),
    true,
  );
});
