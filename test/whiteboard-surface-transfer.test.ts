import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  FileConflictError,
  writeProtectedFile,
} from "../src/modules/file-safety.ts";
import { WhiteboardSaveCoordinator } from "../src/modules/whiteboard/save-coordinator.ts";
import { captureWhiteboardSurfaceTransfer } from "../src/modules/whiteboard/surface-transfer.ts";
import {
  createBasicNode,
  emptyCanvasDocument,
  type CanvasDocument,
} from "../src/modules/whiteboard/snapshot.ts";
import {
  parseStoredCanvas,
  serializeCanvasDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";

const serialize = (document: CanvasDocument) =>
  serializeCanvasDocument(document, { now: "2026-10-06T00:00:00.000Z" });

function document(text: string): CanvasDocument {
  return parseStoredCanvas(
    serialize({
      ...emptyCanvasDocument(),
      nodes: [
        {
          ...createBasicNode("text", { x: 16, y: 32 }, "card"),
          data: { title: text },
        },
      ],
    }),
  ).document;
}

let fixtureNumber = 0;

/** Run the original coordinator and write protection against isolated memory IO. */
function fixture(t: test.TestContext) {
  const initial = document("initial");
  const initialSource = serialize(initial);
  const root = `/surface-transfer-test-${fixtureNumber++}`;
  const target = `${root}/note.canvas`;
  const item = { libraryID: 1, key: "SURFACE1" };
  const files = new Map([[target, initialSource]]);
  const directories = new Set<string>();
  const names = ["Zotero", "IOUtils", "PathUtils", "ztoolkit"];
  const globals = globalThis as Record<string, unknown>;
  const previous = new Map(names.map((name) => [name, globals[name]]));
  const read = async (filename: string) => {
    if (!files.has(filename)) throw new Error("file not found");
    return files.get(filename)!;
  };
  Object.assign(globalThis, {
    Zotero: { DataDirectory: { dir: root }, File: { getContentsAsync: read } },
    IOUtils: {
      exists: async (filename: string) =>
        files.has(filename) || directories.has(filename),
      getChildren: async (directory: string) =>
        [...files.keys()].filter(
          (filename) => path.dirname(filename) === directory,
        ),
      readUTF8: read,
      makeDirectory: async (directory: string) => {
        directories.add(directory);
      },
      writeUTF8: async (filename: string, content: string) => {
        files.set(filename, content);
      },
      remove: async (filename: string) => {
        files.delete(filename);
      },
    },
    PathUtils: { join: path.join, parent: path.dirname },
    ztoolkit: { log() {} },
  });
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
  });

  let shot = { rev: 0, snapshot: initial };
  let persistedReads = 0;
  let snapshotReads = 0;
  let writes = 0;
  const failures: { snapshot?: Error; write?: Error; read?: Error } = {};
  const hooks: { beforeWrite?: () => void } = {};
  const editor = {
    async requestSnapshot() {
      snapshotReads += 1;
      if (failures.snapshot) throw failures.snapshot;
      return shot;
    },
  };
  const revision = { content: initialSource };
  const save = new WhiteboardSaveCoordinator({
    initialDocument: initial,
    getSnapshot: async () => {
      const snapshot = await editor.requestSnapshot();
      return { rev: snapshot.rev, document: snapshot.snapshot };
    },
    write: async ({ document }) => {
      hooks.beforeWrite?.();
      await writeProtectedFile(
        target,
        serialize(document),
        revision,
        item,
        async (content) => {
          if (failures.write) throw failures.write;
          writes += 1;
          files.set(target, content);
        },
      );
    },
  });
  const source: Parameters<typeof captureWhiteboardSurfaceTransfer>[0] = {
    editor,
    fileRevision: revision,
    saveCoordinator: save,
  };
  return {
    initial,
    initialSource,
    source,
    editor,
    save,
    revision,
    failures,
    hooks,
    setDraft(snapshot: CanvasDocument, rev: number) {
      shot = { rev, snapshot };
      save.markChanged(rev);
    },
    setDisk(snapshot: CanvasDocument) {
      files.set(target, serialize(snapshot));
    },
    get disk() {
      return files.get(target)!;
    },
    get writes() {
      return writes;
    },
    get persistedReads() {
      return persistedReads;
    },
    get snapshotReads() {
      return snapshotReads;
    },
    async readPersisted() {
      persistedReads += 1;
      if (failures.read) throw failures.read;
      const source = await read(target);
      return { ...parseStoredCanvas(source), source };
    },
  };
}

test("a clean forced capture does not write and loads the latest external file", async (t) => {
  const f = fixture(t);
  const external = document("external latest");
  f.setDisk(external);
  const issues = [
    {
      code: "dangling-connection" as const,
      id: "edge",
      message: "Dropped edge",
    },
  ];
  const result = await captureWhiteboardSurfaceTransfer(f.source, async () => ({
    ...(await f.readPersisted()),
    issues,
  }));
  assert.deepEqual(result.document, external);
  assert.deepEqual(result.revision, { content: serialize(external) });
  assert.equal(result.issues, issues);
  assert.equal(result.conflict, undefined);
  assert.equal(
    f.snapshotReads,
    1,
    "force must check the latest iframe snapshot",
  );
  assert.equal(f.writes, 0);
  assert.equal(f.persistedReads, 1);
  assert.equal(f.save.dirty, false);
  assert.equal(f.revision.content, f.initialSource);
});

test("a dirty conflict transfers the latest draft and keeps its old protected baseline", async (t) => {
  const f = fixture(t);
  const draftAtSave = document("draft at save start");
  const latestDraft = document("edit completed while saving");
  const external = document("external change");
  f.setDraft(draftAtSave, 1);
  f.setDisk(external);
  f.hooks.beforeWrite = () => f.setDraft(latestDraft, 2);
  const result = await captureWhiteboardSurfaceTransfer(
    f.source,
    f.readPersisted,
  );
  assert.deepEqual(result.document, latestDraft);
  assert.ok(result.conflict instanceof FileConflictError);
  assert.equal(result.conflict, f.save.lastError);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.revision, { content: f.initialSource });
  assert.notEqual(result.revision, f.revision);
  result.revision!.content = "replacement surface owns this copy";
  assert.equal(f.revision.content, f.initialSource);
  assert.equal(f.persistedReads, 0);
  assert.equal(f.writes, 0);
  assert.equal(f.disk, serialize(external));
  assert.equal(f.save.dirty, true);
  assert.deepEqual((await f.editor.requestSnapshot()).snapshot, latestDraft);
});

test("a successful dirty save is followed by a fresh read of its committed file", async (t) => {
  const f = fixture(t);
  const draft = document("saved draft");
  f.setDraft(draft, 1);
  const result = await captureWhiteboardSurfaceTransfer(
    f.source,
    f.readPersisted,
  );
  assert.deepEqual(result.document, draft);
  assert.deepEqual(result.revision, { content: serialize(draft) });
  assert.equal(result.conflict, undefined);
  assert.equal(f.writes, 1);
  assert.equal(f.persistedReads, 1);
  assert.equal(f.disk, serialize(draft));
  assert.equal(f.save.dirty, false);
  assert.equal(f.revision.content, serialize(draft));
});

test("two captures separated by an external change use the second file, never the old snapshot", async (t) => {
  const f = fixture(t);
  const firstExternal = document("external before destination creation");
  const latestExternal = document("external before destination ready");
  f.setDisk(firstExternal);
  const first = await captureWhiteboardSurfaceTransfer(
    f.source,
    f.readPersisted,
  );
  f.setDisk(latestExternal);
  const second = await captureWhiteboardSurfaceTransfer(
    f.source,
    f.readPersisted,
  );
  assert.deepEqual(first.document, firstExternal);
  assert.deepEqual(second.document, latestExternal);
  assert.notDeepEqual(second.document, first.document);
  assert.deepEqual(second.revision, { content: serialize(latestExternal) });
  assert.equal(f.persistedReads, 2);
  assert.equal(f.writes, 0);
  assert.deepEqual((await f.editor.requestSnapshot()).snapshot, f.initial);
});

test("a conflict snapshot failure rejects instead of disposing or replacing the caller draft", async (t) => {
  const f = fixture(t);
  const draft = document("local draft");
  const external = document("external draft");
  const error = new Error("snapshot channel closed");
  f.setDraft(draft, 1);
  f.setDisk(external);
  f.hooks.beforeWrite = () => {
    f.failures.snapshot = error;
  };
  await assert.rejects(
    captureWhiteboardSurfaceTransfer(f.source, f.readPersisted),
    (failure) => failure === error,
  );
  assert.equal(f.disk, serialize(external));
  assert.equal(f.persistedReads, 0);
  assert.equal(f.save.dirty, true);
  delete f.failures.snapshot;
  assert.deepEqual((await f.editor.requestSnapshot()).snapshot, draft);
});

test("ordinary write failures keep the caller usable and never fall back to transfer", async (t) => {
  const f = fixture(t);
  const draft = document("unsaved draft");
  const error = Object.assign(new Error("disk full"), {
    code: "WRITE_CONFLICT",
  });
  f.setDraft(draft, 1);
  f.failures.write = error;
  await assert.rejects(
    captureWhiteboardSurfaceTransfer(f.source, f.readPersisted),
    (failure) => failure === error,
  );
  assert.equal(f.persistedReads, 0);
  assert.equal(f.snapshotReads, 1);
  assert.equal(f.disk, f.initialSource);
  assert.equal(f.revision.content, f.initialSource);
  assert.equal(f.save.dirty, true);
  assert.deepEqual((await f.editor.requestSnapshot()).snapshot, draft);
});

test("a failed forced snapshot keeps the original dirty source available", async (t) => {
  const f = fixture(t);
  const draft = document("snapshot has not reached the parent yet");
  const error = new Error("iframe unavailable");
  f.setDraft(draft, 1);
  f.failures.snapshot = error;
  await assert.rejects(
    captureWhiteboardSurfaceTransfer(f.source, f.readPersisted),
    (failure) => failure === error,
  );
  assert.equal(f.persistedReads, 0);
  assert.equal(f.writes, 0);
  assert.equal(f.disk, f.initialSource);
  assert.equal(f.save.dirty, true);
  delete f.failures.snapshot;
  assert.deepEqual((await f.editor.requestSnapshot()).snapshot, draft);
});

test("a missing persisted file rejects while leaving the caller editor intact", async (t) => {
  const f = fixture(t);
  const error = Object.assign(new Error("canvas file missing"), {
    code: "ENOENT",
  });
  f.failures.read = error;
  await assert.rejects(
    captureWhiteboardSurfaceTransfer(f.source, f.readPersisted),
    (failure) => failure === error,
  );
  assert.equal(f.persistedReads, 1);
  assert.equal(f.writes, 0);
  assert.deepEqual((await f.editor.requestSnapshot()).snapshot, f.initial);
});

test("disk read errors, including FileConflictError, are not caught as save conflicts", async (t) => {
  const f = fixture(t);
  const error = new FileConflictError();
  f.failures.read = error;
  await assert.rejects(
    captureWhiteboardSurfaceTransfer(f.source, f.readPersisted),
    (failure) => failure === error,
  );
  assert.equal(
    f.snapshotReads,
    1,
    "the failed read must not request a fallback draft",
  );
  assert.equal(f.persistedReads, 1);
  assert.equal(f.disk, f.initialSource);
  assert.deepEqual((await f.editor.requestSnapshot()).snapshot, f.initial);
});

for (const missing of ["editor", "fileRevision"] as const) {
  test(`a conflict without ${missing} refuses an unprotected transfer`, async (t) => {
    const f = fixture(t);
    const external = document("external file");
    f.setDraft(document("local draft"), 1);
    f.setDisk(external);
    delete f.source[missing];
    await assert.rejects(
      captureWhiteboardSurfaceTransfer(f.source, f.readPersisted),
      (failure) => failure instanceof FileConflictError,
    );
    assert.equal(f.persistedReads, 0);
    assert.equal(f.disk, serialize(external));
    assert.equal(f.save.dirty, true);
    assert.equal(f.revision.content, f.initialSource);
    assert.ok((await f.editor.requestSnapshot()).snapshot);
  });
}

test("without a source coordinator the persisted document is still read fresh", async () => {
  const current = document("disk only");
  const source = serialize(current);
  const result = await captureWhiteboardSurfaceTransfer({}, async () => ({
    document: current,
    source,
    issues: [],
  }));
  assert.deepEqual(result, {
    document: current,
    revision: { content: source },
    issues: [],
  });
});
