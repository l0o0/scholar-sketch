const DIRECTORY_NAME = "scholar-sketch";
const DATABASE_NAME = `${DIRECTORY_NAME}.sqlite`;
const LEGACY_DIRECTORY_NAME = "scholar-canvas";
const LEGACY_DATABASE_NAME = `${LEGACY_DIRECTORY_NAME}.sqlite`;

export function pluginDataDirectory(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, DIRECTORY_NAME);
}

export function noteIndexDatabasePath(): string {
  return PathUtils.join(pluginDataDirectory(), DATABASE_NAME);
}

async function removeClosedSidecars(path: string): Promise<void> {
  const files: string[] = [];
  for (const suffix of ["-wal", "-journal", "-shm"]) {
    const file = `${path}${suffix}`;
    if (!(await IOUtils.exists(file))) continue;
    const info = await IOUtils.stat(file);
    if (info.type !== "regular" || (suffix !== "-shm" && info.size !== 0))
      throw new Error("Legacy note index still has an unrecovered journal");
    files.push(file);
  }
  // Only a closed database with no persistent journal can discard its SHM.
  for (const file of files) await IOUtils.remove(file);
}

async function prepareDatabaseRename(directory: string): Promise<{
  database: boolean;
  backups: string[];
}> {
  const source = PathUtils.join(directory, LEGACY_DATABASE_NAME);
  const target = PathUtils.join(directory, DATABASE_NAME);
  const database = await IOUtils.exists(source);
  const targetExists = await IOUtils.exists(target);
  if (database && targetExists)
    throw new Error("Both legacy and current note index databases exist");
  if (!targetExists) {
    for (const suffix of ["-wal", "-journal", "-shm"])
      if (await IOUtils.exists(`${target}${suffix}`))
        throw new Error("A destination note index journal has no database");
  }

  const backups: string[] = [];
  for (const path of await IOUtils.getChildren(directory)) {
    const name = PathUtils.filename(path);
    if (!name.startsWith(`${LEGACY_DATABASE_NAME}.`) || !name.endsWith(".bak"))
      continue;
    const renamed = `${DATABASE_NAME}${name.slice(LEGACY_DATABASE_NAME.length)}`;
    if (
      (await IOUtils.stat(path)).type !== "regular" ||
      (await IOUtils.exists(PathUtils.join(directory, renamed)))
    )
      throw new Error(
        "A note index backup conflicts with its migration target",
      );
    backups.push(name);
  }

  if (database) {
    if ((await IOUtils.stat(source)).type !== "regular")
      throw new Error("Legacy note index path is not a file");
    // Recover the original journal family before changing any database name.
    const db = new Zotero.DBConnection(source);
    try {
      const mode = await db.valueQueryAsync<string>(
        "PRAGMA journal_mode=DELETE",
      );
      if (mode !== "delete")
        throw new Error("Legacy note index could not leave WAL mode");
    } finally {
      await db.closeDatabase(true);
    }
  }
  await removeClosedSidecars(source);
  return { database, backups };
}

/** Run before storage consumers start. Filesystem names make interrupted moves retryable. */
export async function migratePluginStorage(): Promise<void> {
  const legacy = PathUtils.join(
    Zotero.DataDirectory.dir,
    LEGACY_DIRECTORY_NAME,
  );
  const current = pluginDataDirectory();
  const legacyExists = await IOUtils.exists(legacy);
  let currentExists = await IOUtils.exists(current);
  if (legacyExists && currentExists) {
    if (
      (await IOUtils.stat(current)).type !== "directory" ||
      (await IOUtils.getChildren(current)).length
    )
      throw new Error("Both legacy and current plugin data directories exist");
    // Nonrecursive removal fails if another writer has populated the directory.
    await IOUtils.remove(current);
    currentExists = false;
  }
  if (!legacyExists && !currentExists) {
    await IOUtils.makeDirectory(current, { ignoreExisting: false });
    return;
  }

  const directory = legacyExists ? legacy : current;
  if ((await IOUtils.stat(directory)).type !== "directory")
    throw new Error("Plugin data path is not a directory");
  const plan = await prepareDatabaseRename(directory);
  if (legacyExists) await IOUtils.move(legacy, current, { noOverwrite: true });

  for (const name of plan.backups) {
    await IOUtils.move(
      PathUtils.join(current, name),
      PathUtils.join(
        current,
        `${DATABASE_NAME}${name.slice(LEGACY_DATABASE_NAME.length)}`,
      ),
      { noOverwrite: true },
    );
  }
  // Commit the basename last, after all independent backup moves have completed.
  if (plan.database)
    await IOUtils.move(
      PathUtils.join(current, LEGACY_DATABASE_NAME),
      noteIndexDatabasePath(),
      { noOverwrite: true },
    );
}
