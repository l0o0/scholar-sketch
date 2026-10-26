import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  NoteIndex,
  closeNoteIndex,
  noteIndex,
} from "../src/modules/markdown/note-index.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Only connection scheduling is substituted; NoteIndex owns its real queue.
function connection(
  options: {
    query?: (params: unknown[]) => Promise<void>;
    close?: (permanent: boolean) => Promise<void>;
  } = {},
): _ZoteroTypes.DB {
  return {
    async queryAsync(_sql: string, params: unknown[] = []) {
      await options.query?.(params);
      return [];
    },
    async valueQueryAsync() {
      return 0;
    },
    async executeTransaction(operation: () => Promise<unknown>) {
      return operation();
    },
    async closeDatabase(permanent: boolean) {
      await options.close?.(permanent);
    },
  } as unknown as _ZoteroTypes.DB;
}

test("closing an uncreated singleton prevents late operations from opening a connection", async (t) => {
  let opened = 0;
  let directories = 0;
  const previous = new Map(
    ["Zotero", "PathUtils", "IOUtils"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.assign(globalThis, {
    Zotero: {
      DataDirectory: { dir: "/unused-shutdown-fixture" },
      DBConnection: function () {
        opened++;
        return connection();
      },
    },
    PathUtils: { join },
    IOUtils: {
      async makeDirectory() {
        directories++;
      },
    },
  });
  t.after(async () => {
    await closeNoteIndex();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  await closeNoteIndex();
  const late = noteIndex();
  assert.deepEqual(await late.load(1), []);
  assert.equal(opened, 0, "a late read must not create the first connection");
  assert.equal(
    await late.save({
      libraryID: 1,
      key: "LATE0001",
      title: "Late save",
      filename: "late.md",
      content: "Body",
    }),
    false,
  );
  assert.equal(await late.replace(1, [], () => true), false);
  assert.equal(await late.searchCandidateKeys(1, "body"), undefined);
  assert.equal(opened, 0);
  assert.equal(directories, 0);
});

test("close waits for initialization, queued work and connection closure without reopening", async (t) => {
  const connectStarted = deferred();
  const allowConnect = deferred();
  const queryStarted = deferred();
  const allowQuery = deferred();
  const closeStarted = deferred();
  const allowClose = deferred();
  const queriedLibraries = new Set<number>();
  const closes: boolean[] = [];
  let opened = 0;
  let blockedQuery = false;
  let finished = false;
  const store = new NoteIndex(async () => {
    opened++;
    connectStarted.resolve();
    await allowConnect.promise;
    return connection({
      async query(params) {
        if (typeof params[0] !== "number") return;
        queriedLibraries.add(params[0]);
        if (params[0] === 1 && !blockedQuery) {
          blockedQuery = true;
          queryStarted.resolve();
          await allowQuery.promise;
        }
      },
      async close(permanent) {
        closes.push(permanent);
        closeStarted.resolve();
        await allowClose.promise;
      },
    });
  });
  const first = store.load(1);
  const queued = store.load(2);
  await connectStarted.promise;
  const closing = store.close().then(() => {
    finished = true;
  });
  t.after(async () => {
    allowConnect.resolve();
    allowQuery.resolve();
    allowClose.resolve();
    await closing;
  });

  assert.deepEqual(await store.load(3), []);
  assert.equal(finished, false, "initialization must finish before closing");
  assert.deepEqual(closes, []);
  allowConnect.resolve();
  await queryStarted.promise;
  assert.equal(finished, false, "the running operation must finish");
  assert.deepEqual([...queriedLibraries], [1]);
  assert.deepEqual(closes, []);
  allowQuery.resolve();
  await Promise.all([first, queued]);
  await closeStarted.promise;
  assert.deepEqual([...queriedLibraries], [1, 2]);
  assert.equal(finished, false, "the native close promise must be awaited");
  allowClose.resolve();
  await closing;

  assert.deepEqual(await store.load(4), []);
  assert.equal(opened, 1);
  assert.deepEqual(closes, [true]);
  assert.deepEqual([...queriedLibraries], [1, 2]);
});
