import {
  NOTE_TEMPLATE_PREF,
  NOTE_TEMPLATE_SETTING,
  parseTemplateRegistry,
} from "./whiteboard/template-repository";

export interface LegacyPluginSetting {
  libraryID: number;
  setting: string;
  value: unknown;
}
export interface LegacyPluginSettingDeletion {
  libraryID: number;
  key: string;
}
interface TemplateRegistry {
  version: 1;
  records: Record<string, unknown>;
}
export interface PluginSettingsMigrationDependencies {
  userLibraryID: number;
  settings(): Promise<LegacyPluginSetting[]>;
  deletions(): Promise<LegacyPluginSettingDeletion[]>;
  readTemplates(): unknown;
  writeTemplates(value: string): void;
  persistTemplates(expected: string): Promise<void>;
  clearSetting(libraryID: number, key: string): Promise<void>;
  clearDeletions(libraryID: number, keys: string[]): Promise<void>;
}

const isTutorialSetting = (key: string) =>
  /^bamboo\.tutorialBaseline\.[A-Z0-9]{8}$/.test(key);

/** Discard obsolete tutorial fingerprints and move personal templates to local prefs. */
export async function migrateLegacyPluginSettings(
  deps: PluginSettingsMigrationDependencies = productionDependencies(),
): Promise<{ settingsRemoved: number; deletionsRemoved: number }> {
  const settings = await deps.settings();
  const deletions = await deps.deletions();
  if (!settings.length && !deletions.length)
    return { settingsRemoved: 0, deletionsRemoved: 0 };
  const tutorials = settings.filter((row) => isTutorialSetting(row.setting));
  const tutorialDeletions = deletions.filter((row) =>
    isTutorialSetting(row.key),
  );
  for (const row of tutorials)
    await deps.clearSetting(row.libraryID, row.setting);
  await clearDeletionRecords(tutorialDeletions, deps);

  // Templates were only stored in the personal library. Leave unexpected group
  // template records untouched; tutorial cleanup does not depend on valid templates.
  const template = settings.find(
    (row) =>
      row.libraryID === deps.userLibraryID &&
      row.setting === NOTE_TEMPLATE_SETTING,
  );
  if (template) {
    const value = deps.readTemplates();
    const local: TemplateRegistry =
      value === undefined || value === null || value === ""
        ? { version: 1, records: {} }
        : readRegistry(value);
    const legacy = readRegistry(template.value);
    const serialized = JSON.stringify(preserveTemplates(local, legacy));
    deps.writeTemplates(serialized);
    if (deps.readTemplates() !== serialized)
      throw new Error("Could not verify local Note templates");
    await deps.persistTemplates(serialized);
    const current = (await deps.settings()).find(
      (row) =>
        row.libraryID === template.libraryID &&
        row.setting === template.setting,
    );
    if (current && current.value !== template.value)
      throw new Error("Legacy Note templates changed during migration");
    await deps.clearSetting(template.libraryID, template.setting);
  }
  const templateDeletions = deletions.filter(
    (row) =>
      row.libraryID === deps.userLibraryID && row.key === NOTE_TEMPLATE_SETTING,
  );
  await clearDeletionRecords(templateDeletions, deps);
  const owned = (libraryID: number, key: string) =>
    isTutorialSetting(key) ||
    (libraryID === deps.userLibraryID && key === NOTE_TEMPLATE_SETTING);
  if (
    (await deps.settings()).some((row) => owned(row.libraryID, row.setting)) ||
    (await deps.deletions()).some((row) => owned(row.libraryID, row.key))
  )
    throw new Error(
      "Legacy plugin settings cleanup is incomplete; retry required",
    );
  return {
    settingsRemoved: tutorials.length + Number(Boolean(template)),
    deletionsRemoved: tutorialDeletions.length + templateDeletions.length,
  };
}

async function clearDeletionRecords(
  rows: LegacyPluginSettingDeletion[],
  deps: PluginSettingsMigrationDependencies,
) {
  for (const libraryID of new Set(rows.map((row) => row.libraryID)))
    await deps.clearDeletions(
      libraryID,
      rows.filter((row) => row.libraryID === libraryID).map((row) => row.key),
    );
}

function readRegistry(value: unknown): TemplateRegistry {
  const parsed = typeof value === "string" ? JSON.parse(value) : null;
  if (
    !parsed ||
    parsed.version !== 1 ||
    !parsed.records ||
    typeof parsed.records !== "object" ||
    Array.isArray(parsed.records)
  )
    throw new Error("Invalid Note template registry; preserving originals");
  return { version: 1, records: parsed.records };
}

function preserveTemplates(
  current: TemplateRegistry,
  legacy: TemplateRegistry,
): TemplateRegistry {
  const parsed = parseTemplateRegistry(legacy);
  if (Object.keys(parsed.records).length !== Object.keys(legacy.records).length)
    throw new Error(
      "Invalid legacy Note template record; preserving originals",
    );
  const records = { ...current.records };
  for (const [id, record] of Object.entries(parsed.records)) {
    const original = legacy.records[id] as Record<string, unknown>;
    if (!Object.hasOwn(records, id)) {
      Object.defineProperty(records, id, {
        value: original,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      continue;
    }
    if (
      JSON.stringify(records[id]) === JSON.stringify(original) ||
      !record.template
    )
      continue;
    // A deterministic ID preserves both edits without adding another copy on retry.
    for (let suffix = 1; ; suffix++) {
      const copyId = `${id}.migrated.${suffix}`;
      const copy = {
        ...original,
        template: {
          ...(original.template as Record<string, unknown>),
          id: copyId,
        },
      };
      if (!Object.hasOwn(records, copyId)) {
        records[copyId] = copy;
        break;
      }
      if (JSON.stringify(records[copyId]) === JSON.stringify(copy)) break;
    }
  }
  return { version: 1, records };
}

function productionDependencies(): PluginSettingsMigrationDependencies {
  const syncedSettings = (
    Zotero as typeof Zotero & {
      SyncedSettings: {
        clear(
          libraryID: number,
          key: string,
          options: { skipDeleteLog: boolean },
        ): Promise<boolean>;
      };
    }
  ).SyncedSettings;
  return {
    userLibraryID: Zotero.Libraries.userLibraryID,
    settings: async () => {
      const rows = await Zotero.DB.queryAsync(
        "SELECT libraryID, setting, value FROM syncedSettings WHERE setting = ? OR setting LIKE ?",
        [NOTE_TEMPLATE_SETTING, "bamboo.tutorialBaseline.%"],
      );
      if (!rows) throw new Error("Could not read legacy plugin settings");
      return rows.map(({ libraryID, setting, value }) => ({
        libraryID,
        setting,
        value,
      }));
    },
    deletions: async () => {
      const rows = await Zotero.DB.queryAsync(
        "SELECT libraryID, key FROM syncDeleteLog " +
          "WHERE syncObjectTypeID = (SELECT syncObjectTypeID FROM syncObjectTypes WHERE name = ?) " +
          "AND (key = ? OR key LIKE ?)",
        ["setting", NOTE_TEMPLATE_SETTING, "bamboo.tutorialBaseline.%"],
      );
      if (!rows) throw new Error("Could not read legacy setting deletions");
      return rows.map(({ libraryID, key }) => ({ libraryID, key }));
    },
    readTemplates: () => Zotero.Prefs.get(NOTE_TEMPLATE_PREF, true),
    writeTemplates: (value) =>
      void Zotero.Prefs.set(NOTE_TEMPLATE_PREF, value, true),
    persistTemplates: async (expected) => {
      // Explicit writes can return early or hide I/O errors on older Gecko versions.
      // Only the verified on-disk template preference permits removing its source.
      const file = Services.dirsvc.get("PrefF", Ci.nsIFile);
      Services.prefs.savePrefFile(file);
      const contents = await Zotero.File.getContentsAsync(file);
      // These fixed ASCII keys store JSON strings, matching Gecko's string escaping.
      const line = `user_pref(${JSON.stringify(NOTE_TEMPLATE_PREF)}, ${JSON.stringify(expected)});`;
      if (
        typeof contents !== "string" ||
        !contents.split(/\r?\n/).includes(line)
      )
        throw new Error("Could not verify persisted Note templates");
    },
    clearSetting: async (libraryID, key) => {
      await syncedSettings.clear(libraryID, key, { skipDeleteLog: true });
    },
    clearDeletions: (libraryID, keys) =>
      Zotero.Sync.Data.Local.removeObjectsFromDeleteLog(
        "setting",
        libraryID,
        keys,
      ),
  };
}
