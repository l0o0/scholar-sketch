import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import test, { type TestContext } from "node:test";
import {
  migratePluginStorage,
  noteIndexDatabasePath,
  pluginDataDirectory,
} from "../src/modules/data-directory.ts";

const LEGACY_DATABASE = "scholar-canvas.sqlite";
const CURRENT_DATABASE = "scholar-sketch.sqlite";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function setup(
  t: TestContext,
  options: {
    returnedMode?: string;
    beforeMove?: (source: string, target: string) => Promise<void>;
    afterClose?: (path: string) => Promise<void>;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "sketch-storage-migration-"));
  const legacy = join(directory, "scholar-canvas");
  const current = join(directory, "scholar-sketch");
  const previous = new Map(
    ["Zotero", "PathUtils", "IOUtils"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const opened: string[] = [];
  const closed: string[] = [];
  const moves: [string, string][] = [];
  const connections = new Set<DatabaseSync>();
  Object.assign(globalThis, {
    PathUtils: { join, filename: basename },
    Zotero: {
      DataDirectory: { dir: directory },
      DBConnection: function (path: string) {
        assert.ok(path.startsWith(directory + sep));
        opened.push(path);
        const db = new DatabaseSync(path);
        connections.add(db);
        return {
          async valueQueryAsync(query: string) {
            const result = Object.values(db.prepare(query).get()!)[0];
            return options.returnedMode ?? result;
          },
          async closeDatabase(permanent: boolean) {
            assert.equal(permanent, true);
            db.close();
            connections.delete(db);
            await options.afterClose?.(path);
            closed.push(path);
          },
        };
      },
    },
    IOUtils: {
      exists,
      async stat(path: string) {
        const info = await stat(path);
        return {
          type: info.isDirectory() ? "directory" : "regular",
          size: info.size,
        };
      },
      async getChildren(path: string) {
        return (await readdir(path)).map((name) => join(path, name));
      },
      async makeDirectory(path: string, settings: { ignoreExisting: boolean }) {
        await mkdir(path, { recursive: settings.ignoreExisting });
      },
      async remove(path: string) {
        if ((await stat(path)).isDirectory()) await rmdir(path);
        else await rm(path);
      },
      async move(
        source: string,
        target: string,
        settings: { noOverwrite: boolean },
      ) {
        assert.equal(settings.noOverwrite, true);
        await options.beforeMove?.(source, target);
        moves.push([source, target]);
        // Gecko moves a source inside an existing destination directory.
        const destination =
          (await exists(target)) && (await stat(target)).isDirectory()
            ? join(target, basename(source))
            : target;
        if (await exists(destination)) throw new Error("Destination exists");
        await rename(source, destination);
      },
    },
  });
  t.after(async () => {
    for (const db of connections) db.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, legacy, current, opened, closed, moves, options };
}

function createDatabase(path: string, value = "Saved cache content"): void {
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE migration_fixture (content TEXT NOT NULL)");
    db.prepare("INSERT INTO migration_fixture VALUES (?)").run(value);
  } finally {
    db.close();
  }
}

function databaseContent(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("SELECT content FROM migration_fixture").get()!
      .content as string;
  } finally {
    db.close();
  }
}

test("fresh storage uses canonical paths and repeated startup does not create an index database", async (t) => {
  const app = await setup(t);
  assert.equal(pluginDataDirectory(), app.current);
  assert.equal(noteIndexDatabasePath(), join(app.current, CURRENT_DATABASE));
  await migratePluginStorage();
  await migratePluginStorage();
  assert.equal((await stat(app.current)).isDirectory(), true);
  assert.deepEqual(await readdir(app.current), []);
  assert.deepEqual(app.opened, []);
  assert.deepEqual(app.moves, []);
});

test("migration preserves history, SQLite contents and backup suffixes, then remains idempotent", async (t) => {
  let closeCompleted = false;
  const app = await setup(t, {
    async afterClose() {
      await new Promise<void>((resolve) => setImmediate(resolve));
      closeCompleted = true;
    },
    async beforeMove() {
      assert.equal(closeCompleted, true, "native closure must finish first");
    },
  });
  const history = join("history", "1", "NOTE0001");
  await mkdir(join(app.legacy, history), { recursive: true });
  for (const kind of ["saved", "conflict", "draft"])
    await writeFile(
      join(app.legacy, history, `1-${kind}.json`),
      `${kind} body`,
    );
  await writeFile(join(app.legacy, "unrecognized.bin"), "Preserved extra file");
  const source = join(app.legacy, LEGACY_DATABASE);
  createDatabase(source);
  for (const suffix of [".bak", ".1.bak"])
    await copyFile(source, source + suffix);
  await migratePluginStorage();
  assert.equal(await exists(app.legacy), false);
  assert.equal(databaseContent(noteIndexDatabasePath()), "Saved cache content");
  for (const kind of ["saved", "conflict", "draft"])
    assert.equal(
      await readFile(join(app.current, history, `1-${kind}.json`), "utf8"),
      `${kind} body`,
    );
  assert.equal(
    await readFile(join(app.current, "unrecognized.bin"), "utf8"),
    "Preserved extra file",
  );
  for (const suffix of [".bak", ".1.bak"])
    assert.equal(
      databaseContent(noteIndexDatabasePath() + suffix),
      "Saved cache content",
    );
  assert.deepEqual(app.opened, [source]);
  assert.deepEqual(app.closed, [source]);
  const before = await readFile(noteIndexDatabasePath());
  const moveCount = app.moves.length;
  await migratePluginStorage();
  assert.equal(app.moves.length, moveCount);
  assert.deepEqual(app.opened, [source]);
  assert.deepEqual(await readFile(noteIndexDatabasePath()), before);
  assert.equal(await exists(join(app.current, LEGACY_DATABASE)), false);
});

test("a crashed WAL is recovered before the database is renamed", async (t) => {
  const app = await setup(t);
  await mkdir(app.legacy);
  const source = join(app.legacy, LEGACY_DATABASE);
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { DatabaseSync } from "node:sqlite";
       const db = new DatabaseSync(process.argv[1]);
       db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
       db.exec("CREATE TABLE migration_fixture (content TEXT NOT NULL)");
       db.prepare("INSERT INTO migration_fixture VALUES (?)").run("Committed in WAL");
       process.kill(process.pid, "SIGKILL");`,
      source,
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.error, undefined);
  assert.notEqual(child.status, 0);
  assert.ok((await stat(`${source}-wal`)).size > 0);
  const mainOnly = join(app.directory, "main-only.sqlite");
  await copyFile(source, mainOnly);
  assert.throws(() => databaseContent(mainOnly), /no such table/);
  await migratePluginStorage();
  assert.equal(databaseContent(noteIndexDatabasePath()), "Committed in WAL");
  assert.equal(await exists(app.legacy), false);
  for (const suffix of ["-wal", "-shm", "-journal"])
    assert.equal(
      await exists(join(app.current, LEGACY_DATABASE + suffix)),
      false,
    );
});

test("a failure after the directory move preserves the database and retries the remaining basename change", async (t) => {
  let failMainMove = true;
  const app = await setup(t, {
    async beforeMove(source) {
      if (source.endsWith(LEGACY_DATABASE) && failMainMove)
        throw new Error("Interrupted before database rename");
    },
  });
  await mkdir(join(app.legacy, "history"), { recursive: true });
  await writeFile(join(app.legacy, "history", "checkpoint.json"), "History");
  createDatabase(join(app.legacy, LEGACY_DATABASE));
  await assert.rejects(migratePluginStorage(), /Interrupted/);
  assert.equal(await exists(app.legacy), false);
  assert.equal(
    databaseContent(join(app.current, LEGACY_DATABASE)),
    "Saved cache content",
  );
  assert.equal(
    await readFile(join(app.current, "history", "checkpoint.json"), "utf8"),
    "History",
  );
  failMainMove = false;
  await migratePluginStorage();
  assert.equal(databaseContent(noteIndexDatabasePath()), "Saved cache content");
  assert.equal(await exists(join(app.current, LEGACY_DATABASE)), false);
});

test("an empty target directory can be replaced without merging any content", async (t) => {
  const app = await setup(t);
  await mkdir(app.legacy);
  await mkdir(app.current);
  createDatabase(join(app.legacy, LEGACY_DATABASE));
  await migratePluginStorage();
  assert.equal(await exists(app.legacy), false);
  assert.equal(databaseContent(noteIndexDatabasePath()), "Saved cache content");
});

test("conflicting roots, databases and backup names preserve both sides before opening SQLite", async (t) => {
  for (const conflict of [
    "roots",
    "target-file",
    "databases",
    "backups",
  ] as const) {
    await t.test(conflict, async (t) => {
      const app = await setup(t);
      await mkdir(app.legacy);
      const source = join(app.legacy, LEGACY_DATABASE);
      createDatabase(source, "Legacy content");
      let destination: string;
      if (conflict === "roots") {
        await mkdir(app.current);
        destination = join(app.current, "preserved.txt");
        await writeFile(destination, "Destination content");
      } else if (conflict === "target-file") {
        destination = app.current;
        await writeFile(destination, "Destination file");
      } else if (conflict === "databases") {
        destination = join(app.legacy, CURRENT_DATABASE);
        createDatabase(destination, "Current content");
      } else {
        await copyFile(source, `${source}.bak`);
        destination = join(app.legacy, `${CURRENT_DATABASE}.bak`);
        await writeFile(destination, "Existing backup");
      }
      const beforeSource = await readFile(source);
      const beforeTarget = await readFile(destination);
      await assert.rejects(migratePluginStorage(), /Both|conflicts/);
      assert.deepEqual(await readFile(source), beforeSource);
      assert.deepEqual(await readFile(destination), beforeTarget);
      assert.deepEqual(app.opened, []);
      assert.deepEqual(app.moves, []);
    });
  }
});

test("an unchanged WAL mode fails before moving storage and always closes its temporary connection", async (t) => {
  const app = await setup(t, { returnedMode: "wal" });
  await mkdir(app.legacy);
  const source = join(app.legacy, LEGACY_DATABASE);
  createDatabase(source);
  await assert.rejects(migratePluginStorage(), /could not leave WAL/);
  assert.deepEqual(app.closed, [source]);
  assert.deepEqual(app.moves, []);
  assert.equal(await exists(app.current), false);
  assert.equal(databaseContent(source), "Saved cache content");
});

test("nonempty journals remaining after closure are preserved and prevent a rename", async (t) => {
  const app = await setup(t, {
    async afterClose(path) {
      await writeFile(`${path}-journal`, "Unrecovered journal");
      await writeFile(`${path}-shm`, "Shared memory");
    },
  });
  await mkdir(app.legacy);
  const source = join(app.legacy, LEGACY_DATABASE);
  createDatabase(source);
  await assert.rejects(migratePluginStorage(), /unrecovered journal/);
  assert.equal(await exists(app.current), false);
  assert.deepEqual(app.moves, []);
  assert.equal(
    await readFile(`${source}-journal`, "utf8"),
    "Unrecovered journal",
  );
  assert.equal(await readFile(`${source}-shm`, "utf8"), "Shared memory");
});

test("a journal at the target basename cannot be paired with the migrated database", async (t) => {
  const app = await setup(t);
  await mkdir(app.legacy);
  const source = join(app.legacy, LEGACY_DATABASE);
  createDatabase(source);
  const journal = join(app.legacy, `${CURRENT_DATABASE}-wal`);
  await writeFile(journal, "Another database's WAL");
  const before = await readFile(source);
  await assert.rejects(migratePluginStorage(), /journal has no database/);
  assert.deepEqual(app.opened, []);
  assert.deepEqual(await readFile(source), before);
  assert.equal(await readFile(journal, "utf8"), "Another database's WAL");
});
