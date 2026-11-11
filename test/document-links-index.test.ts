import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NoteIndex,
  connectNoteIndex,
  noteIndex,
  closeNoteIndex,
} from "../src/modules/markdown/note-index.ts";
import {
  readLibraryNotes,
  clearNoteLibraries,
  invalidateNoteLibrary,
  updateIndexedNote,
  rebuildNoteLibrary,
} from "../src/modules/markdown/note-library.ts";
import type { NoteDocument } from "../src/modules/markdown/note-links.ts";

// Run the production SQL against real SQLite, using the same async API shape.
function connection(path: string, afterQuery?: (sql: string) => void): any {
  const db = new DatabaseSync(path);
  return {
    async queryAsync(sql: string, params: any[] = []) {
      const statement = db.prepare(sql);
      const result = statement.columns().length
        ? statement.all(...params)
        : (statement.run(...params), []);
      afterQuery?.(sql);
      return result;
    },
    async valueQueryAsync(sql: string) {
      return Object.values(db.prepare(sql).get()!)[0];
    },
    async executeTransaction(fn: () => Promise<unknown>) {
      db.exec("BEGIN");
      try {
        const result = await fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async closeDatabase() {
      db.close();
    },
  };
}
const note = (key: string, content: string, libraryID = 1): NoteDocument => ({
  key,
  libraryID,
  filename: `${key}.md`,
  title: key,
  content,
  path: `/${key}.md`,
  fileModified: 10,
  fileSize: content.length,
});

test("SQLite survives reopen, preserves duplicate link positions, isolates libraries and prunes deleted notes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-index-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "index.sqlite");
  const first = new NoteIndex(() => connection(path));
  await first.save(note("A", "[[B]] and [[B]]"));
  await first.save(note("A", "Group body", 2));
  await first.close();
  const second = new NoteIndex(() => connection(path));
  const [cached] = await second.load(1);
  assert.equal(cached.content, "[[B]] and [[B]]");
  assert.deepEqual(
    cached.links?.map((link) => link.from),
    [0, 10],
  );
  assert.equal(cached.fileModified, 10);
  await second.replace(1, [], () => true);
  assert.deepEqual(await second.load(1), []);
  assert.equal((await second.load(2))[0].content, "Group body");
  await second.close();
});

test("a scan overtaken during its transaction rolls back and a newer save wins", async () => {
  let current = true,
    race = false;
  const store = new NoteIndex(() =>
    connection(":memory:", (sql) => {
      if (race && sql.startsWith("INSERT OR REPLACE")) current = false;
    }),
  );
  await store.save(note("A", "Original"));
  race = true;
  await store.replace(1, [note("A", "Stale")], () => current);
  assert.equal((await store.load(1))[0].content, "Original");
  race = false;
  await store.save(note("A", "Latest"));
  assert.equal((await store.load(1))[0].content, "Latest");
  await store.close();
});

test("database failure falls back without rejecting saves or deleting a newer schema", async () => {
  let writes = 0;
  const store = new NoteIndex(
    () =>
      ({
        valueQueryAsync: async () => 999,
        queryAsync: async () => {
          writes++;
        },
        closeDatabase: async () => {},
      }) as any,
  );
  await store.save(note("A", "Body"));
  assert.deepEqual(await store.load(1), []);
  assert.equal(writes, 0);
  await store.close();
});

test("library scans reuse persisted bodies, detect changes and missing files, and can force rebuild", async (t) => {
  const previous = new Map(
    ["Zotero", "IOUtils", "PathUtils"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const dir = mkdtempSync(join(tmpdir(), "scholar-library-"));
  let content = "[[B]]",
    modified = 1,
    reads = 0,
    missing = false;
  const item: any = {
    id: 1,
    key: "NOTE0001",
    libraryID: 1,
    attachmentFilename: "A.md",
    attachmentContentType: "text/markdown",
    attachmentLinkMode: 0,
    isAttachment: () => true,
    getField: () => "A",
    getFilePathAsync: async () => "/A.md",
  };
  Object.assign(globalThis, {
    PathUtils: { join },
    IOUtils: {
      makeDirectory: async (path: string) => mkdir(path, { recursive: true }),
      stat: async () => {
        if (missing) throw new Error("Missing");
        return {
          type: "regular",
          lastModified: modified,
          size: content.length,
        };
      },
    },
    Zotero: {
      DBConnection: function (path: string) {
        return connection(path);
      },
      DataDirectory: { dir },
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      Libraries: { userLibraryID: 1 },
      Items: { getAll: async () => [item] },
      File: {
        getContentsAsync: async () => {
          reads++;
          return content;
        },
      },
    },
  });
  t.after(async () => {
    clearNoteLibraries();
    await closeNoteIndex();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal((await readLibraryNotes(1))[0].content, "[[B]]");
  await noteIndex().load(1); // Drain queued writes before simulating memory eviction.
  clearNoteLibraries();
  assert.equal((await readLibraryNotes(1))[0].links?.length, 1);
  assert.equal(reads, 1);
  content = "[[C]]";
  modified++;
  invalidateNoteLibrary(1);
  assert.equal((await readLibraryNotes(1))[0].content, content);
  assert.equal(reads, 2);
  await noteIndex().load(1);
  content = "[[D]]"; // Same size and timestamp: explicit rebuild must bypass the cache.
  await rebuildNoteLibrary(1);
  assert.equal((await readLibraryNotes(1))[0].content, content);
  assert.equal(reads, 3);
  missing = true;
  invalidateNoteLibrary(1);
  assert.ok((await readLibraryNotes(1))[0].readError);
  assert.deepEqual(await noteIndex().load(1), []);
  clearNoteLibraries();
  updateIndexedNote(item, "Saved without an open backlinks panel");
  assert.equal(
    (await noteIndex().load(1))[0].content,
    "Saved without an open backlinks panel",
  );
});

test("forced rebuild repairs link rows even when the cached body is unchanged", async () => {
  const db = connection(":memory:");
  const store = new NoteIndex(() => db);
  const source = note("A", "[[B]]");
  await store.save(source);
  await db.queryAsync("DELETE FROM links");
  assert.equal((await store.load(1))[0].links?.length, 0);
  await store.replace(1, [source], () => true, true);
  assert.equal((await store.load(1))[0].links?.length, 1);
  await store.close();
});

test("plugin database is created in its own directory without accessing the legacy index", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-canvas-db-"));
  const previous = new Map(
    ["Zotero", "IOUtils", "PathUtils"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const opened: string[] = [];
  Object.assign(globalThis, {
    PathUtils: { join },
    IOUtils: {
      makeDirectory: async (path: string) => mkdir(path, { recursive: true }),
    },
    Zotero: {
      DataDirectory: { dir },
      DBConnection: function (path: string) {
        opened.push(path);
        return connection(path);
      },
    },
  });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const db = new NoteIndex(connectNoteIndex);
  await db.save(note("NEW", "[[Linked]]"));
  assert.equal((await db.load(1))[0].content, "[[Linked]]");
  assert.deepEqual(opened, [
    join(dir, "scholar-sketch", "scholar-sketch.sqlite"),
  ]);
  await db.close();
});
