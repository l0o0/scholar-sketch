import assert from "node:assert/strict";
import test from "node:test";
import {
  migrateLegacyPluginSettings,
  type LegacyPluginSetting,
  type LegacyPluginSettingDeletion,
  type PluginSettingsMigrationDependencies,
} from "../src/modules/synced-settings-migration.ts";
import {
  NOTE_TEMPLATE_PREF,
  NOTE_TEMPLATE_SETTING,
} from "../src/modules/whiteboard/template-repository.ts";

const baseline = "bamboo.tutorialBaseline.ABC12345";
const template = (id: string, name: string) => ({
  template: { id, name, style: {}, updatedAt: "2026-10-24T12:00:00.000Z" },
});
const registry = (records: Record<string, unknown>) =>
  JSON.stringify({ version: 1, records });
const setting = (
  setting: string,
  value: unknown = '"fingerprint"',
  libraryID = 1,
) => ({ libraryID, setting, value });
const deletion = (key: string, libraryID = 1) => ({ libraryID, key });

function fixture(
  rows: LegacyPluginSetting[] = [],
  deleted: LegacyPluginSettingDeletion[] = [],
) {
  const state = {
    rows: [...rows],
    deleted: [...deleted],
    pref: undefined as unknown,
  };
  const events: string[] = [];
  const deps: PluginSettingsMigrationDependencies = {
    userLibraryID: 1,
    settings: async () => structuredClone(state.rows),
    deletions: async () => structuredClone(state.deleted),
    readTemplates: () => state.pref,
    writeTemplates: (value) => {
      events.push("write");
      state.pref = value;
    },
    persistTemplates: async (expected) => {
      assert.equal(state.pref, expected);
      events.push("persist");
    },
    clearSetting: async (libraryID, key) => {
      events.push(`clear:${libraryID}:${key}`);
      state.rows = state.rows.filter(
        (row) => row.libraryID !== libraryID || row.setting !== key,
      );
    },
    clearDeletions: async (libraryID, keys) => {
      state.deleted = state.deleted.filter(
        (row) => row.libraryID !== libraryID || !keys.includes(row.key),
      );
    },
  };
  return { state, events, deps };
}

test("tutorial caches are removed without preferences, including other libraries; exact namespaces are respected", async () => {
  const unrelated = [
    "bamboo.tutorialBaseline.abc12345",
    `${baseline}.suffix`,
    "bamboo.tutorialBaseline.short",
    "bamboo.noteTemplates.v2",
    "tagColors",
  ];
  const f = fixture(
    [
      setting(baseline),
      setting(baseline, "cache", 2),
      ...unrelated.map((key) => setting(key)),
    ],
    [deletion(baseline, 2), ...unrelated.map((key) => deletion(key))],
  );
  f.deps.readTemplates = () =>
    assert.fail("tutorial cleanup does not read template preferences");
  assert.deepEqual(await migrateLegacyPluginSettings(f.deps), {
    settingsRemoved: 2,
    deletionsRemoved: 1,
  });
  assert.deepEqual(
    f.state.rows.map((row) => row.setting),
    unrelated,
  );
  assert.deepEqual(
    f.state.deleted.map((row) => row.key),
    unrelated,
  );
  assert.ok(!f.events.includes("write"));
  assert.ok(!f.events.includes("persist"));
});

test("only personal templates migrate; unexpected group templates and their deletion records stay untouched", async () => {
  const f = fixture(
    [
      setting(
        NOTE_TEMPLATE_SETTING,
        registry({ a: template("a", "Personal") }),
      ),
      setting(
        NOTE_TEMPLATE_SETTING,
        registry({ b: template("b", "Group") }),
        2,
      ),
    ],
    [deletion(NOTE_TEMPLATE_SETTING), deletion(NOTE_TEMPLATE_SETTING, 2)],
  );
  assert.deepEqual(await migrateLegacyPluginSettings(f.deps), {
    settingsRemoved: 1,
    deletionsRemoved: 1,
  });
  assert.equal(
    JSON.parse(String(f.state.pref)).records.a.template.name,
    "Personal",
  );
  assert.equal(f.state.rows[0].libraryID, 2);
  assert.deepEqual(f.state.deleted, [deletion(NOTE_TEMPLATE_SETTING, 2)]);
  assert.ok(
    f.events.indexOf("persist") <
      f.events.indexOf(`clear:1:${NOTE_TEMPLATE_SETTING}`),
  );
});

test("divergent templates preserve local content and retain one legacy copy across retries", async () => {
  const legacy = { ...template("a", "Legacy"), futureField: { keep: true } };
  const f = fixture([setting(NOTE_TEMPLATE_SETTING, registry({ a: legacy }))]);
  const local = { a: template("a", "Local"), future: { futureData: [1, 2] } };
  f.state.pref = registry(local);
  const clear = f.deps.clearSetting;
  f.deps.clearSetting = async () => {
    throw new Error("locked");
  };
  await assert.rejects(migrateLegacyPluginSettings(f.deps), /locked/);
  const first = f.state.pref;
  f.deps.clearSetting = clear;
  await migrateLegacyPluginSettings(f.deps);
  assert.equal(f.state.pref, first);
  const records = JSON.parse(String(first)).records;
  assert.deepEqual(records.a, local.a);
  assert.deepEqual(records.future, local.future);
  assert.equal(records["a.migrated.1"].template.name, "Legacy");
  assert.deepEqual(records["a.migrated.1"].futureField, { keep: true });
  assert.deepEqual(await migrateLegacyPluginSettings(f.deps), {
    settingsRemoved: 0,
    deletionsRemoved: 0,
  });
});

test("bad legacy JSON, schema or records preserve template sources after tutorial cleanup", async () => {
  for (const value of [
    "",
    "{bad",
    "null",
    '{"version":2}',
    registry({ invalid: { template: {} } }),
  ]) {
    const f = fixture(
      [setting(baseline), setting(NOTE_TEMPLATE_SETTING, value)],
      [deletion(baseline), deletion(NOTE_TEMPLATE_SETTING)],
    );
    await assert.rejects(migrateLegacyPluginSettings(f.deps));
    assert.deepEqual(f.state.rows, [setting(NOTE_TEMPLATE_SETTING, value)]);
    assert.deepEqual(f.state.deleted, [deletion(NOTE_TEMPLATE_SETTING)]);
    assert.equal(f.state.pref, undefined);
  }
});

test("local parse, write, memory readback and persistence failures retain the original templates", async () => {
  for (const failure of ["local", "write", "readback", "persist"]) {
    const row = setting(
      NOTE_TEMPLATE_SETTING,
      registry({ a: template("a", "A") }),
    );
    const f = fixture([row]);
    if (failure === "local") f.state.pref = "{";
    if (failure === "write")
      f.deps.writeTemplates = () => {
        throw new Error("write failed");
      };
    if (failure === "readback") f.deps.readTemplates = () => undefined;
    if (failure === "persist")
      f.deps.persistTemplates = async () => {
        throw new Error("disk full");
      };
    await assert.rejects(migrateLegacyPluginSettings(f.deps));
    assert.deepEqual(f.state.rows, [row], failure);
  }
});

test("template cleanup waits for disk verification and rejects a changed source", async () => {
  const f = fixture([
    setting(NOTE_TEMPLATE_SETTING, registry({ a: template("a", "A") })),
  ]);
  let release!: () => void;
  let enter!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  f.deps.persistTemplates = async () => {
    enter();
    await pending;
  };
  const migration = migrateLegacyPluginSettings(f.deps);
  await entered;
  assert.equal(f.state.rows.length, 1);
  f.state.rows[0].value = registry({ a: template("a", "Changed") });
  release();
  await assert.rejects(migration, /changed during migration/);
  assert.equal(f.state.rows.length, 1);
});

test("partial tutorial cleanup can resume, while no-op cleanup is not reported as success", async () => {
  const f = fixture([
    setting(baseline),
    setting("bamboo.tutorialBaseline.ZYX98765"),
  ]);
  const clear = f.deps.clearSetting;
  let calls = 0;
  f.deps.clearSetting = async (...args) => {
    if (++calls === 2) throw new Error("interrupted");
    await clear(...args);
  };
  await assert.rejects(migrateLegacyPluginSettings(f.deps), /interrupted/);
  assert.equal(f.state.rows.length, 1);
  f.deps.clearSetting = async () => {};
  await assert.rejects(migrateLegacyPluginSettings(f.deps), /incomplete/);
  f.deps.clearSetting = clear;
  await migrateLegacyPluginSettings(f.deps);
  assert.deepEqual(f.state.rows, []);
});

test("deletion-only cleanup does not create or persist preferences", async () => {
  const f = fixture(
    [],
    [
      deletion(baseline),
      deletion(NOTE_TEMPLATE_SETTING),
      deletion("tagColors"),
    ],
  );
  await migrateLegacyPluginSettings(f.deps);
  assert.deepEqual(f.state.deleted, [deletion("tagColors")]);
  assert.equal(f.state.pref, undefined);
  assert.deepEqual(f.events, []);
});

for (const diskResult of ["written", "stale", "read-failure"] as const) {
  test(`production adapter scopes deletion types and verifies template persistence: ${diskResult}`, async (t) => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    t.after(() => db.close());
    db.exec(`
      CREATE TABLE syncedSettings (libraryID INTEGER, setting TEXT, value TEXT);
      CREATE TABLE syncObjectTypes (syncObjectTypeID INTEGER, name TEXT);
      CREATE TABLE syncDeleteLog (syncObjectTypeID INTEGER, libraryID INTEGER, key TEXT);
      INSERT INTO syncObjectTypes VALUES (3, 'item'), (7, 'setting');
    `);
    const name = 'A "quoted"\npath\\中文';
    const rows = [
      setting(baseline),
      setting(NOTE_TEMPLATE_SETTING, registry({ a: template("a", name) })),
      setting(NOTE_TEMPLATE_SETTING, "group", 2),
      setting(`${baseline}.extra`),
    ];
    for (const row of rows)
      db.prepare("INSERT INTO syncedSettings VALUES (?, ?, ?)").run(
        row.libraryID,
        row.setting,
        String(row.value),
      );
    for (const [type, library, key] of [
      [7, 1, baseline],
      [3, 1, baseline],
      [7, 1, NOTE_TEMPLATE_SETTING],
      [7, 2, NOTE_TEMPLATE_SETTING],
    ] as const)
      db.prepare("INSERT INTO syncDeleteLog VALUES (?, ?, ?)").run(
        type,
        library,
        key,
      );
    const prefFile = { path: "/test-profile/prefs.js" };
    const fileInterface = {};
    let pref: unknown;
    let disk = '// Other preferences\nuser_pref("unrelated", true);';
    let read = false;
    const previous = new Map(
      ["Zotero", "Services", "Ci"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    t.after(() => {
      for (const [key, value] of previous) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
      }
    });
    Object.defineProperty(globalThis, "Ci", {
      configurable: true,
      value: { nsIFile: fileInterface },
    });
    Object.defineProperty(globalThis, "Services", {
      configurable: true,
      value: {
        dirsvc: {
          get(key: string, type: unknown) {
            assert.equal(key, "PrefF");
            assert.equal(type, fileInterface);
            return prefFile;
          },
        },
        prefs: {
          savePrefFile(file: unknown) {
            if (file === null) return; // A queued default-file write has not reached disk.
            assert.equal(file, prefFile);
            disk += `\nuser_pref(${JSON.stringify(NOTE_TEMPLATE_PREF)}, ${JSON.stringify(diskResult === "stale" ? "old value" : pref)});`;
          },
        },
      },
    });
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        Libraries: { userLibraryID: 1 },
        Prefs: {
          get(key: string, global: boolean) {
            assert.equal(key, NOTE_TEMPLATE_PREF);
            assert.equal(global, true);
            return pref;
          },
          set(key: string, value: string, global: boolean) {
            assert.equal(key, NOTE_TEMPLATE_PREF);
            assert.equal(global, true);
            pref = value;
          },
        },
        File: {
          async getContentsAsync(file: unknown) {
            assert.equal(file, prefFile);
            if (diskResult === "read-failure")
              throw new Error("unreadable prefs");
            read = true;
            return disk;
          },
        },
        DB: {
          queryAsync: async (sql: string, params: (string | number)[]) =>
            db.prepare(sql).all(...params),
        },
        SyncedSettings: {
          async clear(libraryID: number, key: string, options: unknown) {
            assert.deepEqual(options, { skipDeleteLog: true });
            if (key === NOTE_TEMPLATE_SETTING) assert.equal(read, true);
            db.prepare(
              "DELETE FROM syncedSettings WHERE libraryID=? AND setting=?",
            ).run(libraryID, key);
          },
          set: () => assert.fail("no writes to synced settings"),
        },
        Sync: {
          Data: {
            Local: {
              async removeObjectsFromDeleteLog(
                kind: string,
                libraryID: number,
                keys: string[],
              ) {
                assert.equal(kind, "setting");
                for (const key of keys)
                  db.prepare(
                    "DELETE FROM syncDeleteLog WHERE syncObjectTypeID=7 AND libraryID=? AND key=?",
                  ).run(libraryID, key);
              },
            },
          },
        },
      },
    });
    if (diskResult === "written") {
      assert.deepEqual(await migrateLegacyPluginSettings(), {
        settingsRemoved: 2,
        deletionsRemoved: 2,
      });
      assert.equal(JSON.parse(String(pref)).records.a.template.name, name);
    } else {
      await assert.rejects(
        migrateLegacyPluginSettings(),
        diskResult === "stale" ? /verify persisted/ : /unreadable prefs/,
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM syncedSettings WHERE libraryID=1 AND setting=?",
          )
          .get(NOTE_TEMPLATE_SETTING)!.count,
        1,
      );
    }
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM syncedSettings WHERE setting=?")
        .get(baseline)!.count,
      0,
    );
    assert.equal(
      db.prepare("SELECT value FROM syncedSettings WHERE libraryID=2").get()!
        .value,
      "group",
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM syncedSettings WHERE setting=?")
        .get(`${baseline}.extra`)!.count,
      1,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT syncObjectTypeID, libraryID, key FROM syncDeleteLog ORDER BY syncObjectTypeID, libraryID",
        )
        .all()
        .map((row) => [row.syncObjectTypeID, row.libraryID, row.key]),
      diskResult === "written"
        ? [
            [3, 1, baseline],
            [7, 2, NOTE_TEMPLATE_SETTING],
          ]
        : [
            [3, 1, baseline],
            [7, 1, NOTE_TEMPLATE_SETTING],
            [7, 2, NOTE_TEMPLATE_SETTING],
          ],
    );
  });
}
