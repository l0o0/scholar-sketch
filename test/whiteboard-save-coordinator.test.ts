import assert from "node:assert/strict";
import test from "node:test";
import { emptyCanvasDocument } from "../src/modules/whiteboard/snapshot.ts";
import type { CanvasDocument } from "../src/modules/whiteboard/snapshot.ts";
import { WhiteboardSaveCoordinator } from "../src/modules/whiteboard/save-coordinator.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("serializes schema-v2 snapshots when a change arrives during a write", async () => {
  const gate = deferred();
  const writes: Array<{ rev: number; version: number }> = [];
  let snapshotRev = 1;
  const save = new WhiteboardSaveCoordinator({
    getSnapshot: () => ({
      rev: snapshotRev,
      document: emptyCanvasDocument(),
    }),
    write: async ({ rev, document }) => {
      writes.push({ rev, version: document.version });
      if (writes.length === 1) await gate.promise;
    },
  });

  save.markChanged(1);
  const first = save.request();
  await Promise.resolve();
  snapshotRev = 2;
  save.markChanged(2);
  const second = save.request();
  gate.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(writes, [
    { rev: 1, version: 2 },
    { rev: 2, version: 2 },
  ]);
  assert.equal(save.dirty, false);
});

test("keeps a failed revision dirty and reports the error state", async () => {
  const states: string[] = [];
  const save = new WhiteboardSaveCoordinator({
    getSnapshot: () => ({ rev: 1, document: emptyCanvasDocument() }),
    write: async () => {
      throw new Error("disk full");
    },
    onStateChange: (state) => states.push(state),
  });
  save.markChanged(1);
  await assert.rejects(() => save.request(), /disk full/);
  assert.equal(save.dirty, true);
  assert.equal(save.lastError?.message, "disk full");
  assert.equal(states.at(-1), "error");
});

test("flush waits for the latest known schema-v2 revision", async () => {
  const writes: number[] = [];
  const save: WhiteboardSaveCoordinator = new WhiteboardSaveCoordinator({
    getSnapshot: () => ({
      rev: save.currentRev,
      document: emptyCanvasDocument(),
    }),
    write: async ({ rev, document }) => {
      assert.equal(document.version, 2);
      writes.push(rev);
    },
  });
  save.markChanged(3);
  await save.flush();
  assert.deepEqual(writes, [3]);
  assert.equal(save.savedRev, 3);
});

function board(x = 0): CanvasDocument {
  return { ...emptyCanvasDocument(), viewport: { x, y: 0, zoom: 1 } };
}

function note(content: string): CanvasDocument {
  return {
    ...board(),
    nodes: [
      {
        id: "note",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 240,
        height: 160,
        content,
      },
    ],
  };
}

test("a clean forced request reads a fresh snapshot without rewriting the initial document", async () => {
  let reads = 0;
  let writes = 0;
  const initial = board();
  const save = new WhiteboardSaveCoordinator({
    initialDocument: initial,
    getSnapshot: () => {
      reads += 1;
      // Deliberately change insertion order at the root and in a nested object.
      return {
        rev: 0,
        document: {
          connections: initial.connections,
          nodes: initial.nodes,
          viewport: { zoom: 1, y: 0, x: 0 },
          version: 2,
        },
      };
    },
    write: async () => {
      writes += 1;
    },
  });
  await save.request({ force: true });
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.equal(save.dirty, false);
});

test("a fresh snapshot discovers an unnotified revision and saves actual viewport changes", async () => {
  const writes: number[] = [];
  const save = new WhiteboardSaveCoordinator({
    initialDocument: board(),
    getSnapshot: () => ({ rev: 2, document: board(64) }),
    write: async ({ rev }) => {
      writes.push(rev);
    },
  });
  await save.request({ force: true });
  assert.deepEqual(writes, [2]);
  assert.equal(save.currentRev, 2);
  assert.equal(save.savedRev, 2);
  assert.equal(save.dirty, false);
  await save.request({ force: true });
  assert.deepEqual(writes, [2]);
});

test("an absent initial viewport equals the runtime's default viewport", async () => {
  const save = new WhiteboardSaveCoordinator({
    initialDocument: { version: 2, nodes: [], connections: [] },
    getSnapshot: () => ({ rev: 0, document: board() }),
    write: async () => {
      throw new Error("The default viewport is not a local edit");
    },
  });
  await save.request({ force: true });
  assert.equal(save.dirty, false);
});

test("undoing to the persisted document clears dirty revisions without writing", async () => {
  let writes = 0;
  const save = new WhiteboardSaveCoordinator({
    initialDocument: board(),
    getSnapshot: () => ({ rev: 4, document: board() }),
    write: async () => {
      writes += 1;
    },
  });
  save.markChanged(4);
  await save.flush();
  assert.equal(writes, 0);
  assert.equal(save.savedRev, 4);
  assert.equal(save.dirty, false);
});

test("changed content at the same revision still writes and failed conflicts remain dirty", async () => {
  const conflict = Object.assign(new Error("File changed outside the editor"), {
    name: "FileConflictError",
    code: "WRITE_CONFLICT",
  });
  let attempts = 0;
  const save = new WhiteboardSaveCoordinator({
    initialDocument: note("Saved text"),
    getSnapshot: () => ({ rev: 0, document: note("New local text") }),
    write: async () => {
      attempts += 1;
      if (attempts === 1) throw conflict;
    },
  });
  await assert.rejects(save.request({ force: true }), {
    code: "WRITE_CONFLICT",
  });
  assert.equal(save.dirty, true);
  assert.equal(save.lastError, conflict);
  await save.flush();
  assert.equal(
    attempts,
    2,
    "failed writes must not update the persisted fingerprint",
  );
  assert.equal(save.lastError, undefined);
  assert.equal(save.savedRev, 0);
  assert.equal(save.dirty, false);
});

test("a previous write error prevents an unchanged fingerprint from masking unsaved data", async () => {
  let current = note("Draft text");
  let attempts = 0;
  const save = new WhiteboardSaveCoordinator({
    initialDocument: note("Saved text"),
    getSnapshot: () => ({ rev: 0, document: current }),
    write: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Disk full");
    },
  });
  await assert.rejects(save.request({ force: true }), /Disk full/);
  current = note("Saved text");
  await save.flush();
  assert.equal(attempts, 2);
  assert.equal(save.lastError, undefined);
  assert.equal(save.dirty, false);
});

test("an adopted revision-zero draft must be written even when it matches the constructor document", async () => {
  const states: string[] = [];
  const writes: number[] = [];
  const conflict = Object.assign(new Error("Conflicting draft"), {
    name: "FileConflictError",
    code: "WRITE_CONFLICT",
  });
  const save = new WhiteboardSaveCoordinator({
    initialDocument: board(64),
    getSnapshot: () => ({ rev: 0, document: board(64) }),
    write: async ({ rev }) => {
      writes.push(rev);
    },
    onStateChange: (state) => states.push(state),
  });
  save.adoptUnsavedSnapshot(conflict);
  assert.equal(save.savedRev, -1);
  assert.equal(save.dirty, true);
  assert.equal(save.lastError, conflict);
  assert.equal(states.at(-1), "error");
  await save.flush();
  assert.deepEqual(writes, [0]);
  assert.equal(save.savedRev, 0);
  assert.equal(save.dirty, false);
  assert.equal(save.lastError, undefined);
});

test("an adopted draft preserves its conflict and can retry without an endless drain", async () => {
  const conflict = Object.assign(new Error("Conflicting draft"), {
    name: "FileConflictError",
    code: "WRITE_CONFLICT",
  });
  let fail = true;
  let attempts = 0;
  const save = new WhiteboardSaveCoordinator({
    initialDocument: board(),
    getSnapshot: () => ({ rev: 0, document: board(64) }),
    write: async () => {
      attempts += 1;
      if (fail) throw conflict;
    },
  });
  save.adoptUnsavedSnapshot(conflict);
  await assert.rejects(save.flush(), { code: "WRITE_CONFLICT" });
  assert.equal(save.dirty, true);
  assert.equal(save.lastError, conflict);
  fail = false;
  await save.flush();
  assert.equal(attempts, 2);
  assert.equal(save.currentRev, 0);
  assert.equal(save.savedRev, 0);
  assert.equal(save.dirty, false);
});

test("adopting the latest disk snapshot establishes a saved new-iframe epoch", async () => {
  let writes = 0;
  const states: string[] = [];
  let current = board(64);
  const save = new WhiteboardSaveCoordinator({
    initialDocument: board(),
    getSnapshot: () => ({ rev: 0, document: current }),
    write: async () => {
      writes += 1;
    },
    onStateChange: (state) => states.push(state),
  });
  save.adoptUnsavedSnapshot(new Error("Old surface conflict"));
  save.adoptPersistedSnapshot({ rev: 0, document: current });
  assert.equal(save.dirty, false);
  assert.equal(save.savedRev, 0);
  assert.equal(save.lastError, undefined);
  assert.equal(states.at(-1), "saved");
  await save.request({ force: true });
  assert.equal(writes, 0);
  current = board(80);
  await save.request({ force: true });
  assert.equal(writes, 1);
  assert.equal(save.dirty, false);
});

test("adopting persisted data does not lower the current iframe revision", async () => {
  const save = new WhiteboardSaveCoordinator({
    getSnapshot: () => ({ rev: 3, document: board(64) }),
    write: async () => {
      throw new Error("Unchanged persisted data was written");
    },
  });
  save.markChanged(3);
  save.adoptPersistedSnapshot({ rev: 0, document: board(64) });
  assert.equal(save.currentRev, 3);
  assert.equal(save.savedRev, 3);
  await save.request({ force: true });
  assert.equal(save.dirty, false);
});
