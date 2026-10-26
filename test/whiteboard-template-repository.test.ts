import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as noteTemplateModel from "../packages/whiteboard/src/model/note-template.ts";
import test from "node:test";
import {
  NOTE_TEMPLATE_PREF,
  createNoteTemplateRepository,
  parseTemplateRegistry,
  type TemplatePreferencesPort,
} from "../src/modules/whiteboard/template-repository.ts";
import type { NoteTemplate } from "../packages/whiteboard/src/model/note-template.ts";

function template(id: string, name: string, updatedAt: string): NoteTemplate {
  return { id, name, style: {}, updatedAt };
}

function fakePreferences(initial?: string) {
  let value = initial;
  const writes: string[] = [];
  const port: TemplatePreferencesPort = {
    get(key, global) {
      assert.equal(key, NOTE_TEMPLATE_PREF);
      assert.equal(global, true);
      return value;
    },
    set(key, next, global) {
      assert.equal(key, NOTE_TEMPLATE_PREF);
      assert.equal(global, true);
      value = next;
      writes.push(next);
    },
  };
  return { port, writes };
}

test("repository persists local JSON and reloads templates and tombstones", async () => {
  const preferences = fakePreferences();
  const repository = createNoteTemplateRepository({
    preferences: preferences.port,
    now: () => "2026-09-06T03:00:00.000Z",
  });
  await repository.save(
    template("custom-1", "Question", "2026-09-06T01:00:00.000Z"),
  );
  const reopened = createNoteTemplateRepository({
    preferences: preferences.port,
  });
  assert.deepEqual(
    reopened.list().map((item) => item.id),
    ["custom-1"],
  );
  await repository.remove("custom-1");
  assert.deepEqual(reopened.list(), []);
  assert.equal(preferences.writes.length, 2);
  assert.equal(
    JSON.parse(preferences.writes[1]).records["custom-1"].deletedAt,
    "2026-09-06T03:00:00.000Z",
  );
  assert.equal(NOTE_TEMPLATE_PREF, "extensions.zotero.bamboo.noteTemplates");
});

test("legacy parsing retains valid records for migration", () => {
  const registry = parseTemplateRegistry({
    version: 1,
    records: {
      good: { template: template("good", "Good", "2026-09-06T01:00:00.000Z") },
      bad: { template: { id: "", name: "Bad", style: {} } },
    },
  });
  assert.deepEqual(Object.keys(registry.records), ["good"]);
});

test("local writes notify open views and unsubscribe releases each listener", async () => {
  const preferences = fakePreferences();
  const repository = createNoteTemplateRepository({
    preferences: preferences.port,
  });
  const seen: string[][] = [];
  let secondNotifications = 0;
  const stopFirst = repository.subscribe(() =>
    seen.push(repository.list().map((item) => item.name)),
  );
  const stopSecond = repository.subscribe(() => secondNotifications++);
  try {
    await repository.save(template("one", "First", "2026-09-06T01:00:00.000Z"));
    stopSecond();
    await repository.remove("one");
    assert.deepEqual(seen, [["First"], []]);
    assert.equal(secondNotifications, 1);
  } finally {
    stopFirst();
    stopSecond();
  }
});

test("local preference failures preserve prior templates and do not report a save", async () => {
  const raw = JSON.stringify({
    version: 1,
    records: {
      one: {
        template: template("one", "Original", "2026-09-06T01:00:00.000Z"),
      },
    },
  });
  const preferences = fakePreferences(raw);
  preferences.port.set = () => {
    throw new Error("Preference write failed");
  };
  const repository = createNoteTemplateRepository({
    preferences: preferences.port,
  });
  let notifications = 0;
  const stop = repository.subscribe(() => notifications++);
  try {
    await assert.rejects(
      repository.save(template("two", "New", "2026-09-06T01:00:00.000Z")),
      /Preference write failed/,
    );
    await assert.rejects(repository.remove("one"), /Preference write failed/);
    assert.deepEqual(
      repository.list().map((item) => item.name),
      ["Original"],
    );
    assert.equal(notifications, 0);
    assert.equal(preferences.writes.length, 0);
  } finally {
    stop();
  }
});

test("malformed local JSON or unknown schema is not silently overwritten", async () => {
  for (const raw of [
    "{broken",
    "null",
    JSON.stringify({ version: 2, records: {} }),
    JSON.stringify({
      version: 1,
      records: { bad: { template: { id: "", name: "Bad", style: {} } } },
    }),
  ]) {
    const preferences = fakePreferences(raw);
    const repository = createNoteTemplateRepository({
      preferences: preferences.port,
    });
    assert.throws(() => repository.list());
    await assert.rejects(
      repository.save(template("one", "New", "2026-09-06T01:00:00.000Z")),
    );
    assert.equal(preferences.writes.length, 0);
  }
});

test("production repository writes only plugin preferences, never synchronized settings", async () => {
  const preferences = fakePreferences();
  const module = {
    exports:
      {} as typeof import("../src/modules/whiteboard/template-repository.ts"),
  };
  const source = readFileSync(
    new URL(
      "../src/modules/whiteboard/template-repository.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const compiled = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  }).outputText;
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (path: string) => {
      if (path === "../../../package.json")
        return { config: { prefsPrefix: "extensions.zotero.bamboo" } };
      if (path === "../../../packages/whiteboard/src/model/note-template")
        return noteTemplateModel;
      throw new Error(`Unexpected dependency: ${path}`);
    },
    Zotero: {
      Prefs: preferences.port,
      Libraries: { userLibraryID: 1 },
      SyncedSettings: {
        get: () => null,
        set: () => {
          throw new Error("Invalid setting bamboo.noteTemplates.v1");
        },
        onSyncDownload: { addListener: () => {} },
      },
    },
  });
  const repository = module.exports.getZoteroNoteTemplateRepository();
  assert.equal(module.exports.getZoteroNoteTemplateRepository(), repository);
  await repository.save(
    template("one", "Saved locally", "2026-09-06T01:00:00.000Z"),
  );
  assert.equal(
    JSON.parse(preferences.writes[0]).records.one.template.name,
    "Saved locally",
  );
});
