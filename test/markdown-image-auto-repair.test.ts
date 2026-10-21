import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { autoRepairImageAssets } from "../src/modules/markdown/images/auto-repair.ts";
import {
  resolveImageAssetEntry,
  resolveImageAssets,
} from "../src/modules/markdown/images/service.ts";

const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

async function fixture(t: TestContext, markdown = "![image](assets/a.png)") {
  const root = mkdtempSync(join(tmpdir(), "scholar-image-auto-repair-"));
  const path = join(root, "note.md");
  await writeFile(path, markdown);
  const previous = new Map(
    ["Zotero", "IOUtils", "PathUtils"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  t.after(async () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
    await rm(root, { recursive: true, force: true });
  });
  const state = {
    sync: 2 as number | string,
    busy: false,
    editable: true,
    filesEditable: true,
    stored: true,
    directories: 0,
    imageReads: 0,
    held: 0,
    gates: 0,
    saves: 0,
    failSave: false,
    failDirectory: false,
    afterChildren: undefined as (() => void | Promise<void>) | undefined,
  };
  const item = {
    id: 1,
    libraryID: 1,
    key: "AUTOREP1",
    attachmentContentType: "text/markdown",
    attachmentSyncedModificationTime: 1000,
    isStoredFileAttachment: () => state.stored,
    isEditable: () => state.editable,
    getFilePathAsync: async () => path,
    get attachmentSyncState() {
      return state.sync;
    },
    set attachmentSyncState(value: number | string) {
      state.sync = value === "to_upload" ? 0 : value;
    },
    async saveTx() {
      assert.equal(state.held, 1);
      state.saves++;
      if (state.failSave) throw new Error("Metadata save failed");
    },
  } as unknown as Zotero.Item;
  Object.assign(globalThis, {
    PathUtils: { join, parent: dirname, filename: basename },
    IOUtils: {
      exists: async (target: string) => existsSync(target),
      getChildren: async (target: string) => {
        state.directories++;
        if (state.failDirectory) throw new Error("Directory unavailable");
        const children = (await readdir(target)).map((name) =>
          join(target, name),
        );
        await state.afterChildren?.();
        return children;
      },
      stat: async (target: string) => {
        const info = await lstat(target);
        return {
          type: info.isFile() ? "regular" : "directory",
          size: info.size,
          lastModified: info.mtimeMs,
        };
      },
      read: async (target: string, options?: { maxBytes?: number }) => {
        state.imageReads++;
        return new Uint8Array(
          (await readFile(target)).subarray(0, options?.maxBytes),
        );
      },
      makeDirectory: async (target: string) => {
        assert.equal(state.held, 1);
        await mkdir(target, { recursive: true });
      },
      write: async (target: string, bytes: Uint8Array) => {
        assert.equal(state.held, 1);
        await writeFile(target, bytes, { flag: "wx" });
        return bytes.length;
      },
      move: async (source: string, target: string) => {
        assert.equal(state.held, 1);
        await link(source, target);
        await unlink(source);
      },
      remove: async (target: string, options?: { ignoreAbsent?: boolean }) => {
        assert.equal(state.held, 1);
        await rm(target, { force: options?.ignoreAbsent ?? false });
      },
      setModificationTime: async (target: string, modified: number) => {
        assert.equal(state.held, 1);
        await utimes(target, new Date(), new Date(modified));
      },
    },
    Zotero: {
      Libraries: {
        get: () => ({
          editable: state.editable,
          filesEditable: state.filesEditable,
        }),
      },
      Attachments: { getStorageDirectory: () => ({ path: root }) },
      File: {
        pathToFile: (target: string) => ({
          isSymlink: () => lstatSync(target).isSymbolicLink(),
        }),
        getContentsAsync: (target: string) => readFile(target, "utf8"),
      },
      Promise: {
        delay: async () => {
          throw new Error("Automatic repair must not wait for sync");
        },
      },
      Sync: {
        Runner: {
          get syncInProgress() {
            return state.busy;
          },
          delayIndefinite: () => {
            assert.equal(state.held, 0);
            state.held++;
            state.gates++;
            return () => state.held--;
          },
        },
      },
    },
  });
  return {
    item,
    markdown,
    path,
    root,
    state,
    source: (name = "assetsa.png") => writeFile(join(root, name), image),
    async target() {
      await mkdir(join(root, "assets"));
      await writeFile(join(root, "assets", "a.png"), image);
    },
  };
}

test("healthy notes inspect names without a write gate or image decoding", async (t) => {
  const f = await fixture(t);
  await f.target();
  await f.source("assetsunreferenced.png");
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  assert.equal(f.state.directories, 1);
  assert.equal(f.state.gates, 0);
  assert.equal(f.state.imageReads, 0);
  assert.equal(existsSync(join(f.root, "assetsunreferenced.png")), true);
});

test("notes without supported local image references require no directory IO", async (t) => {
  const f = await fixture(
    t,
    "![remote](https://example.org/a.png)\nPlain text",
  );
  await f.source();
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  assert.equal(f.state.directories, 0);
  assert.equal(f.state.gates, 0);
});

test("automatically restores exact rendered references and leaves unrelated files", async (t) => {
  const f = await fixture(
    t,
    "![a](assets/a.png)\n![[b.png]]\n![](assets/missing.png)",
  );
  await f.source();
  await f.source("assets\\b.png");
  await f.source("assetsunrelated.png");
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), true);
  assert.deepEqual(
    new Uint8Array(readFileSync(join(f.root, "assets", "a.png"))),
    image,
  );
  assert.deepEqual(
    new Uint8Array(readFileSync(join(f.root, "assets", "b.png"))),
    image,
  );
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
  assert.equal(existsSync(join(f.root, "assets\\b.png")), false);
  assert.equal(existsSync(join(f.root, "assetsunrelated.png")), true);
  assert.equal(readFileSync(f.path, "utf8"), f.markdown);
  assert.equal(f.state.sync, 0);
  assert.equal(f.state.saves, 1);
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  assert.equal(f.state.gates, 1);
});

test("an unsaved snapshot never saves Markdown or moves its referenced images", async (t) => {
  const f = await fixture(t, "Saved text");
  await f.source();
  assert.equal(await autoRepairImageAssets(f.item, "![](assets/a.png)"), false);
  assert.equal(readFileSync(f.path, "utf8"), "Saved text");
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(existsSync(join(f.root, "assets")), false);
  assert.equal(f.state.saves, 0);
});

test("code examples alone do not relocate originals", async (t) => {
  const f = await fixture(t, "```markdown\n![](assets/a.png)\n```");
  await f.source();
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(f.state.saves, 0);
});

test("read-only, linked, downloading, conflicting, and syncing items are skipped", async (t) => {
  const f = await fixture(t);
  await f.source();
  for (const property of ["editable", "filesEditable", "stored"] as const) {
    f.state[property] = false;
    assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
    f.state[property] = true;
  }
  for (const sync of [
    1,
    4,
    5,
    "to_download",
    "force_download",
    "in_conflict",
  ]) {
    f.state.sync = sync;
    assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  }
  f.state.sync = 2;
  f.state.busy = true;
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  assert.equal(f.state.directories, 0);
  assert.equal(f.state.gates, 0);
  f.state.busy = false;
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), true);
});

test("sync starting during the name scan prevents taking the write gate", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.state.afterChildren = () => {
    f.state.busy = true;
  };
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  assert.equal(f.state.gates, 0);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
});

test("a caller becoming stale after IO prevents mutation", async (t) => {
  const f = await fixture(t);
  await f.source();
  let active = false;
  assert.equal(
    await autoRepairImageAssets(f.item, f.markdown, () => active),
    false,
  );
  assert.equal(f.state.directories, 0);
  active = true;
  f.state.afterChildren = () => {
    active = false;
  };
  assert.equal(
    await autoRepairImageAssets(f.item, f.markdown, () => active),
    false,
  );
  assert.equal(f.state.gates, 0);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
});

test("concurrent views share one repair for the same snapshot", async (t) => {
  const f = await fixture(t);
  await f.source();
  const first = autoRepairImageAssets(f.item, f.markdown);
  const second = autoRepairImageAssets(f.item, f.markdown);
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(f.state.gates, 1);
  assert.equal(f.state.saves, 1);
});

test("a remaining active view keeps a shared repair alive after the first closes", async (t) => {
  const f = await fixture(t);
  await f.source();
  let firstActive = true;
  f.state.afterChildren = () => {
    firstActive = false;
  };
  const first = autoRepairImageAssets(f.item, f.markdown, () => firstActive);
  const second = autoRepairImageAssets(f.item, f.markdown, () => true);
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(f.state.gates, 1);
  assert.equal(f.state.saves, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
});

test("an unguarded request can join a stale view's shared repair", async (t) => {
  const f = await fixture(t);
  await f.source();
  const first = autoRepairImageAssets(f.item, f.markdown, () => false);
  const second = autoRepairImageAssets(f.item, f.markdown);
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(f.state.gates, 1);
});

test("a concurrent newer snapshot is reconsidered after a stale snapshot", async (t) => {
  const f = await fixture(t);
  await f.source();
  const stale = autoRepairImageAssets(f.item, `${f.markdown}\nOlder draft`);
  const current = autoRepairImageAssets(f.item, f.markdown);
  assert.deepEqual(await Promise.all([stale, current]), [false, true]);
  assert.equal(f.state.gates, 2);
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
});

test("a copied target is still published and cleaned up after metadata retry", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.state.failSave = true;
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), true);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(existsSync(join(f.root, "assets", "a.png")), true);
  f.state.failSave = false;
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), true);
  assert.equal(f.state.saves, 2);
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
});

test("transient IO failures are silent and do not prevent a later retry", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.state.failDirectory = true;
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  assert.equal(f.state.gates, 0);
  f.state.failDirectory = false;
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), true);
});

test("missing originals arriving later are eligible on the next request", async (t) => {
  const f = await fixture(t);
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), false);
  await f.source();
  assert.equal(await autoRepairImageAssets(f.item, f.markdown), true);
});

test("batch image loading stays read-only unless a UI explicitly opts in", async (t) => {
  const f = await fixture(t);
  await f.source();
  const original = await resolveImageAssets(f.item, f.markdown);
  assert.ok(original["assets/a.png"].error);
  assert.equal(original["assets/a.png"].dataUrl, undefined);
  assert.equal(f.state.gates, 0);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(existsSync(join(f.root, "assets")), false);

  const repaired = await resolveImageAssets(f.item, f.markdown, () => true);
  assert.equal(repaired["assets/a.png"].error, undefined);
  assert.equal(
    repaired["assets/a.png"].dataUrl,
    `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
  );
  assert.equal(f.state.gates, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
});

test("single-image loading stays read-only by default and repairs after opted-in failure", async (t) => {
  const f = await fixture(t);
  await f.source();
  const original = await resolveImageAssetEntry(f.item, "assets/a.png");
  assert.ok(original.error);
  assert.equal(original.dataUrl, undefined);
  assert.equal(f.state.gates, 0);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);

  const repaired = await resolveImageAssetEntry(f.item, "assets/a.png", {
    markdown: f.markdown,
    shouldProceed: () => true,
  });
  assert.equal(repaired.error, undefined);
  assert.equal(
    repaired.dataUrl,
    `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
  );
  assert.equal(f.state.gates, 1);
  assert.equal(f.state.saves, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
});
