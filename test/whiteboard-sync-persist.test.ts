import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  parseStoredCanvas,
  serializeCanvasDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import { readFileVersions } from "../src/modules/file-safety.ts";
import { persistCanvasAttachment } from "../src/modules/whiteboard/persist.ts";
import { WhiteboardSaveCoordinator } from "../src/modules/whiteboard/save-coordinator.ts";
import type { CanvasDocument } from "../src/modules/whiteboard/snapshot.ts";

const TO_UPLOAD = 0;
const TO_DOWNLOAD = 1;
const IN_SYNC = 2;
const FORCE_UPLOAD = 3;
const FORCE_DOWNLOAD = 4;
const IN_CONFLICT = 5;
const ORIGINAL_FILE_DATA = "data:application/pdf;base64,JVBERi0=";
const EDITED_FILE_DATA = "data:application/pdf;base64,JVBERi0xLjc=";

function document(edited = false): CanvasDocument {
  return {
    version: 2,
    nodes: [
      {
        id: "text",
        kind: "text",
        position: { x: edited ? 64 : 24, y: 40 },
        width: 240,
        height: 96,
        data: { title: edited ? "Edited ideas" : "Original ideas" },
      },
      {
        id: "attachment",
        kind: "attachment",
        position: { x: 340, y: 40 },
        width: 240,
        height: 160,
        data: {
          title: "paper.pdf",
          contentType: "application/pdf",
          fileData: edited ? EDITED_FILE_DATA : ORIGINAL_FILE_DATA,
          size: edited ? 8 : 5,
        },
      },
    ],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: { title: "Research board", createdAt: "2026-10-08T00:00:00Z" },
  };
}

function assertCanvasContent(source: string, expected: CanvasDocument) {
  const parsed = parseStoredCanvas(source);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.document.nodes, expected.nodes);
  assert.deepEqual(parsed.document.connections, expected.connections);
  assert.deepEqual(parsed.document.viewport, expected.viewport);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

type WriteOptions = { tmpPath?: string; flush?: boolean; mode?: string };

async function setup(context: TestContext, state = IN_SYNC) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "whiteboard-sync-"));
  const storage = path.join(root, "storage", "ABCDEFGH");
  await fs.mkdir(storage, { recursive: true });
  const target = path.join(storage, "board.canvas");
  const initialDocument = document();
  const initial = serializeCanvasDocument(initialDocument);
  await fs.writeFile(target, initial);
  const baselineMtime = (await fs.stat(target)).mtimeMs;
  const baselineHash = createHash("md5").update(initial).digest("hex");
  let currentPath = target;
  let busy = false;
  let heldDelays = 0;
  let releases = 0;
  let syncState = state;
  let delay: (ms: number) => Promise<void> = async () => {
    throw new Error("Unexpected sync wait");
  };
  const writes: Array<{
    target: string;
    options: WriteOptions;
    heldDelays: number;
  }> = [];
  const saveOptions: Record<string, unknown>[] = [];
  const io = {
    exists: (target: string) =>
      fs.access(target).then(
        () => true,
        () => false,
      ),
    getChildren: async (target: string) =>
      (await fs.readdir(target)).map((name) => path.join(target, name)),
    readUTF8: (target: string) => fs.readFile(target, "utf8"),
    makeDirectory: (target: string, _options?: unknown) =>
      fs.mkdir(target, { recursive: true }),
    writeUTF8: async (
      target: string,
      value: string,
      options: WriteOptions = {},
    ) => {
      writes.push({ target, options, heldDelays });
      await fs.writeFile(options.tmpPath ?? target, value, {
        flag: options.mode === "create" ? "wx" : "w",
      });
      if (options.tmpPath) await fs.rename(options.tmpPath, target);
    },
    remove: (target: string) => fs.unlink(target),
  };
  const item = {
    id: 42,
    libraryID: 1,
    key: "ABCDEFGH",
    attachmentLinkMode: 0,
    attachmentContentType: "application/json",
    isStoredFileAttachment: () => true,
    getFilePathAsync: async () => currentPath,
    get attachmentSyncState() {
      return syncState;
    },
    set attachmentSyncState(value: string | number) {
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
    attachmentSyncedModificationTime: baselineMtime,
    attachmentSyncedHash: baselineHash,
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
      Attachments: { LINK_MODE_IMPORTED_FILE: 0 },
      File: { getContentsAsync: io.readUTF8 },
      Promise: { delay: (ms: number) => delay(ms) },
      Sync: {
        Runner: {
          get syncInProgress() {
            return busy;
          },
          delayIndefinite() {
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
  return {
    root,
    storage,
    target,
    item,
    io,
    initial,
    initialDocument,
    baselineHash,
    baselineMtime,
    revision: { content: initial },
    writes,
    saveOptions,
    setPath(value: string) {
      currentPath = value;
    },
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

test("a running sync keeps Canvas bytes and embedded fileData stable while its draft is recoverable outside storage", async (context) => {
  const mock = await setup(context);
  const sync = await holdSync(mock);
  const edited = document(true);
  const save = persistCanvasAttachment(mock.item, edited, {
    revision: mock.revision,
  });
  await sync.waiting;
  assert.equal(await fs.readFile(mock.target, "utf8"), mock.initial);
  assertCanvasContent(
    await fs.readFile(mock.target, "utf8"),
    mock.initialDocument,
  );
  assert.equal(mock.heldDelays, 0);
  assert.deepEqual(await fs.readdir(mock.storage), ["board.canvas"]);
  const drafts = (await readFileVersions(mock.item)).filter(
    (v) => v.kind === "draft",
  );
  assert.equal(drafts.length, 1);
  assertCanvasContent(drafts[0].content, edited);
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
  assert.equal(await save, mock.target);
  assertCanvasContent(await fs.readFile(mock.target, "utf8"), edited);
  assert.equal(mock.revision.content, await fs.readFile(mock.target, "utf8"));
  assert.equal(mock.item.attachmentSyncState, TO_UPLOAD);
  assert.equal(mock.heldDelays, 0);
});

test("a remote Canvas rewrite during sync preserves remote fileData and archives the conflicting local draft", async (context) => {
  const mock = await setup(context);
  const sync = await holdSync(mock);
  const edited = document(true);
  const save = persistCanvasAttachment(mock.item, edited, {
    revision: mock.revision,
  });
  await sync.waiting;
  const remote = serializeCanvasDocument({
    ...mock.initialDocument,
    viewport: { x: 240, y: 120, zoom: 0.8 },
  });
  await fs.writeFile(mock.target, remote);
  sync.finish();
  await assert.rejects(save, { code: "WRITE_CONFLICT" });
  assert.equal(await fs.readFile(mock.target, "utf8"), remote);
  assert.equal(mock.revision.content, mock.initial);
  assert.equal(mock.item.attachmentSyncState, IN_SYNC);
  assert.deepEqual(mock.saveOptions, []);
  const conflict = (await readFileVersions(mock.item)).find(
    (v) => v.kind === "conflict",
  );
  assert.ok(conflict);
  assertCanvasContent(conflict.content, edited);
  assert.equal(mock.heldDelays, 0);
});

for (const state of [TO_DOWNLOAD, FORCE_DOWNLOAD, IN_CONFLICT]) {
  test(`numeric state ${state} blocks Canvas publication and archives the embedded local draft`, async (context) => {
    const mock = await setup(context, state);
    const edited = document(true);
    await assert.rejects(
      persistCanvasAttachment(mock.item, edited, { revision: mock.revision }),
      { code: "ATTACHMENT_SYNC_CONFLICT" },
    );
    assert.equal(await fs.readFile(mock.target, "utf8"), mock.initial);
    assert.equal(mock.revision.content, mock.initial);
    assert.equal(mock.item.attachmentSyncState, state);
    assert.deepEqual(mock.saveOptions, []);
    assert.deepEqual(await fs.readdir(mock.storage), ["board.canvas"]);
    const drafts = await readFileVersions(mock.item);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].kind, "draft");
    assertCanvasContent(drafts[0].content, edited);
    assert.equal(mock.heldDelays, 0);
  });
}

test("a successful Canvas save marks numeric to-upload and preserves the last-synced baseline", async (context) => {
  const mock = await setup(context);
  const save = new WhiteboardSaveCoordinator({
    initialDocument: mock.initialDocument,
    getSnapshot: () => ({ rev: 1, document: document(true) }),
    write: async ({ document }) => {
      await persistCanvasAttachment(mock.item, document, {
        revision: mock.revision,
      });
    },
  });
  save.markChanged(1);
  await save.request();
  assert.equal(save.dirty, false);
  assert.equal(save.lastError, undefined);
  assert.equal(mock.item.attachmentSyncState, TO_UPLOAD);
  assert.equal(mock.saveOptions.length, 1);
  assert.equal(mock.saveOptions[0].skipSelect, true);
  assert.equal(mock.item.attachmentSyncedModificationTime, mock.baselineMtime);
  assert.equal(mock.item.attachmentSyncedHash, mock.baselineHash);
  assertCanvasContent(await fs.readFile(mock.target, "utf8"), document(true));
});

test("a Canvas save preserves the user's native force-upload choice", async (context) => {
  const mock = await setup(context, FORCE_UPLOAD);
  await persistCanvasAttachment(mock.item, document(true), {
    revision: mock.revision,
  });
  assert.equal(mock.item.attachmentSyncState, FORCE_UPLOAD);
  assert.deepEqual(mock.saveOptions, []);
  assert.equal(mock.item.attachmentSyncedModificationTime, mock.baselineMtime);
  assert.equal(mock.item.attachmentSyncedHash, mock.baselineHash);
  assertCanvasContent(await fs.readFile(mock.target, "utf8"), document(true));
});

test("Canvas persistence resolves the attachment's current path after a sync rename", async (context) => {
  const mock = await setup(context);
  const sync = await holdSync(mock);
  const save = persistCanvasAttachment(mock.item, document(true), {
    revision: mock.revision,
  });
  await sync.waiting;
  const renamed = path.join(mock.storage, "renamed.canvas");
  await fs.rename(mock.target, renamed);
  mock.setPath(renamed);
  sync.finish();
  assert.equal(await save, renamed);
  assert.equal(await mock.io.exists(mock.target), false);
  assertCanvasContent(await fs.readFile(renamed, "utf8"), document(true));
  assert.equal(mock.revision.content, await fs.readFile(renamed, "utf8"));
  assert.equal(
    mock.writes.filter((write) => write.target === renamed).length,
    1,
  );
});

test("Canvas atomic writes use a hidden temporary file and leave no auxiliary synced document", async (context) => {
  const mock = await setup(context);
  await persistCanvasAttachment(mock.item, document(true), {
    revision: mock.revision,
  });
  const writes = mock.writes.filter((write) => write.target === mock.target);
  assert.equal(writes.length, 1);
  const [write] = writes;
  assert.equal(write.heldDelays, 1);
  assert.equal(write.options.flush, true);
  assert.ok(write.options.tmpPath);
  assert.equal(path.dirname(write.options.tmpPath), mock.storage);
  assert.ok(path.basename(write.options.tmpPath).startsWith("."));
  assert.deepEqual(await fs.readdir(mock.storage), ["board.canvas"]);
});

test("a failed Canvas disk write retains its dirty revision and recoverable embedded draft", async (context) => {
  const mock = await setup(context);
  const diskError = new Error("disk full");
  const states: string[] = [];
  const save = new WhiteboardSaveCoordinator({
    initialDocument: mock.initialDocument,
    getSnapshot: () => ({ rev: 1, document: document(true) }),
    write: async ({ document }) => {
      await persistCanvasAttachment(mock.item, document, {
        revision: mock.revision,
        writeUTF8: async () => {
          throw diskError;
        },
      });
    },
    onStateChange: (state) => states.push(state),
  });
  save.markChanged(1);
  await assert.rejects(save.request(), (error) => error === diskError);
  assert.equal(save.dirty, true);
  assert.equal(save.lastError, diskError);
  assert.equal(save.savedRev, 0);
  assert.equal(states.at(-1), "error");
  assert.equal(states.includes("saved"), false);
  assert.equal(await fs.readFile(mock.target, "utf8"), mock.initial);
  assert.equal(mock.revision.content, mock.initial);
  assert.deepEqual(mock.saveOptions, []);
  const conflict = (await readFileVersions(mock.item)).find(
    (v) => v.kind === "conflict",
  );
  assert.ok(conflict);
  assertCanvasContent(conflict.content, document(true));
  assert.equal(mock.heldDelays, 0);
});

test("a failed Canvas upload marker cannot report a saved coordinator even after the document reached disk", async (context) => {
  const mock = await setup(context);
  const markError = new Error("attachment metadata transaction failed");
  mock.item.saveTx = async () => {
    throw markError;
  };
  const states: string[] = [];
  const save = new WhiteboardSaveCoordinator({
    initialDocument: mock.initialDocument,
    getSnapshot: () => ({ rev: 1, document: document(true) }),
    write: async ({ document }) => {
      await persistCanvasAttachment(mock.item, document, {
        revision: mock.revision,
      });
    },
    onStateChange: (state) => states.push(state),
  });
  save.markChanged(1);
  await assert.rejects(save.request(), (error) => error === markError);
  assertCanvasContent(await fs.readFile(mock.target, "utf8"), document(true));
  assert.equal(mock.revision.content, await fs.readFile(mock.target, "utf8"));
  assert.equal(save.dirty, true);
  assert.equal(save.lastError, markError);
  assert.equal(save.savedRev, 0);
  assert.equal(states.at(-1), "error");
  assert.equal(states.includes("saved"), false);
  assert.equal(mock.item.attachmentSyncedHash, mock.baselineHash);
  assert.equal(mock.item.attachmentSyncedModificationTime, mock.baselineMtime);
  assert.equal(mock.heldDelays, 0);
});
