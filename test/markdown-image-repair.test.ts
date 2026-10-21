import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  lstat,
  rm,
  link,
  unlink,
  symlink,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import test, { type TestContext } from "node:test";
import {
  inspectImageAssets,
  repairImageAssets,
} from "../src/modules/markdown/images/repair.ts";

const png = (marker = 1) =>
  new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, marker]);

test("automatic repair stops if the editor changes while waiting for the write gate", async (t) => {
  const f = await fixture(t);
  await f.source();
  let current = true;
  const result = repairImageAssets(f.item, f.markdown, {
    shouldProceed: () => current,
    waitForSync: false,
  });
  current = false;
  await assert.rejects(result, /deferred/);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(existsSync(join(f.root, "assets")), false);
  assert.equal(f.saves, 0);
});

test("automatic repair retains the original when editing starts after copying", async (t) => {
  const f = await fixture(t);
  await f.source();
  let current = true;
  f.afterMove = async () => {
    current = false;
  };
  const result = await repairImageAssets(f.item, f.markdown, {
    shouldProceed: () => current,
    waitForSync: false,
  });
  assert.equal(result.failed, 1);
  assert.equal(result.retainedOriginals, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(f.saves, 0);
  current = true;
  const retry = await repairImageAssets(f.item, f.markdown, {
    shouldProceed: () => current,
  });
  assert.equal(retry.repaired, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
});

async function fixture(t: TestContext, markdown = "![image](assets/a.png)") {
  const root = mkdtempSync(join(tmpdir(), "scholar-image-repair-"));
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
  let state = 2;
  let busy = false;
  let held = 0;
  let pauses = 0;
  let saves = 0;
  let failSave = false;
  let failWrite = false;
  let editable = true;
  let filesEditable = true;
  let stored = true;
  let onWait: (() => Promise<void>) | undefined;
  let afterMove: (() => Promise<void>) | undefined;
  let afterSave: (() => Promise<void>) | undefined;
  const item = {
    id: 1,
    libraryID: 1,
    key: "REPAIR01",
    attachmentContentType: "text/markdown",
    attachmentSyncedModificationTime: 1000,
    isStoredFileAttachment: () => stored,
    isEditable: () => editable,
    getFilePathAsync: async () => path,
    get attachmentSyncState() {
      return state;
    },
    set attachmentSyncState(value: number | string) {
      state = value === "to_upload" ? 0 : Number(value);
    },
    async saveTx() {
      saves++;
      assert.equal(held, 1);
      if (failSave) throw new Error("Metadata save failed");
      await afterSave?.();
    },
  } as unknown as Zotero.Item;
  const io = {
    exists: async (target: string) => {
      try {
        await lstat(target);
        return true;
      } catch {
        return false;
      }
    },
    stat: async (target: string) => {
      const info = await lstat(target);
      return {
        type: info.isFile()
          ? "regular"
          : info.isDirectory()
            ? "directory"
            : "symlink",
        size: info.size,
        lastModified: info.mtimeMs,
      };
    },
    getChildren: async (target: string) => {
      const { readdir } = await import("node:fs/promises");
      return (await readdir(target)).map((name) => join(target, name));
    },
    read: async (target: string, options?: { maxBytes?: number }) =>
      new Uint8Array((await readFile(target)).subarray(0, options?.maxBytes)),
    makeDirectory: async (target: string) => {
      assert.equal(held, 1);
      await mkdir(target, { recursive: true });
    },
    write: async (target: string, data: Uint8Array, options: any) => {
      assert.equal(held, 1);
      assert.equal(options.mode, "create");
      if (failWrite) throw new Error("Disk full");
      await writeFile(target, data, { flag: "wx" });
      return data.length;
    },
    move: async (source: string, target: string, options: any) => {
      assert.equal(held, 1);
      assert.equal(options.noOverwrite, true);
      await link(source, target); // Atomic no-overwrite publication.
      await unlink(source);
      await afterMove?.();
    },
    remove: async (target: string, options?: { ignoreAbsent?: boolean }) => {
      assert.equal(held, 1);
      await rm(target, { force: options?.ignoreAbsent ?? false });
    },
    setModificationTime: async (target: string, value: number) => {
      assert.equal(held, 1);
      await utimes(target, new Date(), new Date(value));
    },
  };
  Object.assign(globalThis, {
    IOUtils: io,
    PathUtils: {
      join: (base: string, ...parts: string[]) => {
        if (
          parts.some((part) => !part || /[\\/\0]/.test(part) || part === "..")
        )
          throw new Error("Invalid leaf path");
        return join(base, ...parts);
      },
      parent: dirname,
      filename: basename,
    },
    Zotero: {
      Libraries: { get: () => ({ editable, filesEditable }) },
      Attachments: { getStorageDirectory: () => ({ path: root }) },
      File: {
        pathToFile: (target: string) => ({
          isSymlink: () => lstatSync(target).isSymbolicLink(),
        }),
        getContentsAsync: (target: string) => readFile(target, "utf8"),
      },
      Promise: {
        delay: async () => {
          assert.equal(held, 0);
          await onWait?.();
        },
      },
      Sync: {
        Runner: {
          get syncInProgress() {
            return busy;
          },
          delayIndefinite: () => {
            assert.equal(held, 0);
            held++;
            pauses++;
            return () => {
              held--;
            };
          },
        },
      },
    },
  });
  return {
    root,
    path,
    item,
    markdown,
    io,
    async source(name = "assetsa.png", data = png()) {
      await writeFile(join(root, name), data);
    },
    async target(name = "a.png", data = png()) {
      await mkdir(join(root, "assets"), { recursive: true });
      await writeFile(join(root, "assets", name), data);
    },
    get state() {
      return state;
    },
    set state(value: number) {
      state = value;
    },
    get held() {
      return held;
    },
    get pauses() {
      return pauses;
    },
    get saves() {
      return saves;
    },
    set failSave(value: boolean) {
      failSave = value;
    },
    set failWrite(value: boolean) {
      failWrite = value;
    },
    set editable(value: boolean) {
      editable = value;
    },
    set filesEditable(value: boolean) {
      filesEditable = value;
    },
    set stored(value: boolean) {
      stored = value;
    },
    set busy(value: boolean) {
      busy = value;
    },
    set onWait(value: () => Promise<void>) {
      onWait = value;
    },
    set afterMove(value: () => Promise<void>) {
      afterMove = value;
    },
    set afterSave(value: () => Promise<void>) {
      afterSave = value;
    },
  };
}

test("inspection is read-only and repair relocates only exact referenced originals", async (t) => {
  const f = await fixture(t, "![image](assets/a.png)\n![](assets/missing.png)");
  await f.source();
  await f.source("assetsunrelated.png");
  const report = await inspectImageAssets(f.item, f.markdown);
  assert.equal(report.checked, 2);
  assert.equal(report.repairable, 1);
  assert.equal(report.missing, 1);
  assert.deepEqual(report.skippedPaths, [join(f.root, "assetsunrelated.png")]);
  assert.equal(f.pauses, 0);
  assert.equal(existsSync(join(f.root, "assets")), false);
  const fixed = await repairImageAssets(f.item, f.markdown);
  assert.equal(fixed.repaired, 1);
  assert.equal(fixed.missing, 1);
  assert.equal(f.state, 0);
  assert.equal(f.saves, 1);
  assert.equal(f.held, 0);
  assert.deepEqual(
    new Uint8Array(readFileSync(join(f.root, "assets", "a.png"))),
    png(),
  );
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
  assert.equal(existsSync(join(f.root, "assetsunrelated.png")), true);
  assert.equal(readFileSync(f.path, "utf8"), f.markdown);
  const again = await repairImageAssets(f.item, f.markdown);
  assert.equal(again.healthy, 1);
  assert.equal(again.repaired, 0);
  assert.equal(f.saves, 1);
});

test("literal backslash originals are supported without constructing invalid leaf paths", async (t) => {
  const f = await fixture(t);
  await f.source("assets\\a.png");
  assert.equal((await repairImageAssets(f.item, f.markdown)).repaired, 1);
  assert.equal(existsSync(join(f.root, "assets\\a.png")), false);
});

test("different existing targets and ambiguous originals are never overwritten", async (t) => {
  const f = await fixture(t);
  await f.source();
  await f.target("a.png", png(2));
  assert.equal((await repairImageAssets(f.item, f.markdown)).conflicts, 1);
  assert.deepEqual(
    new Uint8Array(readFileSync(join(f.root, "assets", "a.png"))),
    png(2),
  );
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(f.saves, 0);
});

test("mark failure retains both files and retry persists metadata before removing source", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.failSave = true;
  const failed = await repairImageAssets(f.item, f.markdown);
  assert.equal(failed.failed, 1);
  assert.equal(failed.retainedOriginals, 1);
  assert.equal(f.state, 2);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(existsSync(join(f.root, "assets", "a.png")), true);
  f.failSave = false;
  assert.equal((await inspectImageAssets(f.item, f.markdown)).repairable, 1);
  assert.equal((await repairImageAssets(f.item, f.markdown)).repaired, 1);
  assert.equal(f.saves, 2);
  assert.equal(existsSync(join(f.root, "assetsa.png")), false);
});

test("failed temporary write preserves originals and permits a clean retry", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.failWrite = true;
  assert.equal((await repairImageAssets(f.item, f.markdown)).failed, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.equal(existsSync(join(f.root, "assets", "a.png")), false);
  f.failWrite = false;
  assert.equal((await repairImageAssets(f.item, f.markdown)).repaired, 1);
});

test("waits for active sync and rechecks external document changes after acquiring gate", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.busy = true;
  f.onWait = async () => {
    await writeFile(f.path, "remote revision");
    f.busy = false;
  };
  await assert.rejects(
    repairImageAssets(f.item, f.markdown),
    (error: any) => error.code === "WRITE_CONFLICT",
  );
  assert.equal(existsSync(join(f.root, "assets")), false);
  assert.equal(f.held, 0);
});

test("pending downloads and conflicts prevent all writes", async (t) => {
  const f = await fixture(t);
  await f.source();
  for (const state of [1, 4, 5]) {
    f.state = state;
    await assert.rejects(
      repairImageAssets(f.item, f.markdown),
      (error: any) => error.code === "ATTACHMENT_SYNC_CONFLICT",
    );
  }
  assert.equal(existsSync(join(f.root, "assets")), false);
  assert.equal(f.held, 0);
});

test("read-only libraries, linked attachments and file permissions block repair", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.editable = false;
  assert.equal((await inspectImageAssets(f.item, f.markdown)).canRepair, false);
  await assert.rejects(repairImageAssets(f.item, f.markdown));
  f.editable = true;
  f.filesEditable = false;
  await assert.rejects(repairImageAssets(f.item, f.markdown));
  f.filesEditable = true;
  f.stored = false;
  await assert.rejects(repairImageAssets(f.item, f.markdown));
  assert.equal(existsSync(join(f.root, "assets")), false);
});

test("symlink originals and symlink assets directories are rejected", async (t) => {
  const f = await fixture(t);
  await f.source("outside.png");
  await symlink(join(f.root, "outside.png"), join(f.root, "assetsa.png"));
  assert.equal((await repairImageAssets(f.item, f.markdown)).conflicts, 1);
  await unlink(join(f.root, "assetsa.png"));
  await f.source();
  await mkdir(join(f.root, "outside"));
  await symlink(join(f.root, "outside"), join(f.root, "assets"));
  assert.equal((await repairImageAssets(f.item, f.markdown)).conflicts, 1);
  assert.equal(existsSync(join(f.root, "outside", "a.png")), false);
});

test("encoded filenames resolve one layer and ambiguous literal/decoded originals conflict", async (t) => {
  const f = await fixture(t, "![](assets/a%20b.png)");
  await f.source("assetsa b.png");
  await f.source("assetsa%20b.png", png(2));
  assert.equal((await repairImageAssets(f.item, f.markdown)).conflicts, 1);
  await unlink(join(f.root, "assetsa%20b.png"));
  assert.equal((await repairImageAssets(f.item, f.markdown)).repaired, 1);
  assert.equal(existsSync(join(f.root, "assets", "a b.png")), true);
  assert.equal((await inspectImageAssets(f.item, f.markdown)).healthy, 1);
});

test("HTML, wiki, and reference-style images are repaired but examples and unsafe formats are not", async (t) => {
  const markdown =
    '<img src="assets/a.png">\n\n![[b.png]]\n![c][figure]\n\n[figure]: assets/c.png\n\n```md\n![](assets/code.png)\n```\n`![](assets/inline.png)`\n![](https://example.com/a.png)\n![](assets/../outside.png)\n![](assets/x.svg)';
  const f = await fixture(t, markdown);
  for (const name of ["a", "b", "c", "code", "inline"])
    await f.source(`assets${name}.png`);
  const report = await repairImageAssets(f.item, markdown);
  assert.equal(report.checked, 3);
  assert.equal(report.repaired, 3);
  assert.equal(report.skippedPaths.length, 2);
});

test("source changes after copying retain the newer original", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.afterSave = async () => {
    await f.source("assetsa.png", png(2));
  };
  const report = await repairImageAssets(f.item, f.markdown);
  assert.equal(report.repaired, 1);
  assert.equal(report.retainedOriginals, 1);
  assert.deepEqual(
    new Uint8Array(readFileSync(join(f.root, "assetsa.png"))),
    png(2),
  );
});

test("document changes after copying preserve original and do not mark upload", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.afterMove = async () => {
    await writeFile(f.path, "external edit");
  };
  assert.equal((await repairImageAssets(f.item, f.markdown)).failed, 1);
  assert.equal(f.saves, 0);
  assert.equal(f.state, 2);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
});

test("a direct reference to the flattened name protects the original from relocation", async (t) => {
  const f = await fixture(t, "![](assets/a.png)\n![](assetsa.png)");
  await f.source();
  assert.equal((await repairImageAssets(f.item, f.markdown)).conflicts, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
});

test("download links and HTML anchors also protect the old filename", async (t) => {
  const markdown =
    '![](assets/a.png)\n[下载原图](assetsa.png)\n![](assets/b.png)\n<a href="assetsb.png">下载</a>\n![](assets/c.png)\n[下载][original]\n\n[original]: assetsc.png';
  const f = await fixture(t, markdown);
  for (const name of ["a", "b", "c"]) await f.source(`assets${name}.png`);
  const report = await repairImageAssets(f.item, markdown);
  assert.equal(report.conflicts, 3);
  assert.equal(report.repaired, 0);
  assert.equal(f.saves, 0);
});

test("frontmatter and commented examples never authorize image relocation", async (t) => {
  const f = await fixture(
    t,
    '---\nexample: "![](assets/a.png)"\n---\n<!-- ![](assets/b.png) -->\n',
  );
  await f.source();
  await f.source("assetsb.png");
  const report = await repairImageAssets(f.item, f.markdown);
  assert.equal(report.checked, 0);
  assert.equal(report.skippedPaths.length, 2);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
});

test("target replacement after publication retains original and preserves the new target", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.afterSave = async () => {
    await f.target("a.png", png(2));
  };
  const report = await repairImageAssets(f.item, f.markdown);
  assert.equal(report.retainedOriginals, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
  assert.deepEqual(
    new Uint8Array(readFileSync(join(f.root, "assets", "a.png"))),
    png(2),
  );
});

test("a new conflict after copying is not overwritten by failure recovery", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.afterMove = async () => {
    f.state = 5;
  };
  const report = await repairImageAssets(f.item, f.markdown);
  assert.equal(report.failed, 1);
  assert.equal(f.state, 5);
  assert.equal(f.saves, 0);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
});

test("a new download state after marking upload prevents original deletion", async (t) => {
  const f = await fixture(t);
  await f.source();
  f.afterSave = async () => {
    f.state = 1;
  };
  const report = await repairImageAssets(f.item, f.markdown);
  assert.equal(report.retainedOriginals, 1);
  assert.equal(f.state, 1);
  assert.equal(existsSync(join(f.root, "assetsa.png")), true);
});
