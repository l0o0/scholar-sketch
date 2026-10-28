import assert from "node:assert/strict";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  acquireDeletedImageAssets,
  getDeletedImageAssetPath,
  type DeletedImageAssets,
} from "../src/modules/markdown/images/deleted-assets.ts";

const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
let nextItemID = 1;

async function fixture(context: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deleted-md-image-"));
  const storage = path.join(root, "storage");
  const assets = path.join(storage, "assets");
  const temporary = path.join(root, "temporary");
  await fs.mkdir(assets, { recursive: true });
  await fs.mkdir(temporary);
  const previous = new Map(
    ["Zotero", "IOUtils", "PathUtils", "ztoolkit"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const owners: DeletedImageAssets[] = [];
  const io = {
    exists: (target: string) =>
      fs.access(target).then(
        () => true,
        () => false,
      ),
    stat: async (target: string) => ({
      type: (await fs.stat(target)).isFile() ? "regular" : "directory",
    }),
    copy: async (
      source: string,
      target: string,
      options?: { noOverwrite?: boolean },
    ) => {
      await fs.copyFile(
        source,
        target,
        options?.noOverwrite ? constants.COPYFILE_EXCL : 0,
      );
    },
    makeDirectory: async (target: string) => {
      await fs.mkdir(target, { recursive: true });
    },
    createUniqueDirectory: (parent: string, prefix: string) =>
      fs.mkdtemp(path.join(parent, prefix)),
    remove: (target: string, options?: { recursive?: boolean }) =>
      fs.rm(target, { recursive: options?.recursive ?? false, force: true }),
  };
  const item = {
    id: nextItemID++,
    isStoredFileAttachment: () => true,
    isEditable: () => true,
  } as unknown as Zotero.Item;
  Object.assign(globalThis, {
    ztoolkit: { log() {} },
    PathUtils: { join: path.join, parent: path.dirname, tempDir: temporary },
    IOUtils: io,
    Zotero: {
      Attachments: { getStorageDirectory: () => ({ path: storage }) },
    },
  });
  context.after(async () => {
    try {
      for (const owner of owners) await owner.release();
    } finally {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  return {
    item,
    assets,
    storage,
    temporary,
    io,
    acquire() {
      const owner = acquireDeletedImageAssets(item);
      owners.push(owner);
      return owner;
    },
    async write(name: string, bytes = imageBytes) {
      const target = path.join(assets, name);
      await fs.writeFile(target, bytes);
      return target;
    },
  };
}

test("only explicitly deleted assets are removed and undo/redo preserve their bytes", async (context) => {
  const f = await fixture(context);
  const target = await f.write("figure.png");
  const orphan = await f.write("unrelated.png");
  const owner = f.acquire();
  assert.equal(await owner.remove("# Note", () => true), false);
  assert.equal(await f.io.exists(target), true);

  owner.record(["assets/figure.png"]);
  assert.equal(await owner.remove("# Note", () => true), true);
  assert.equal(await f.io.exists(target), false);
  assert.equal(await f.io.exists(orphan), true);
  const backup = getDeletedImageAssetPath(f.item, "assets/figure.png")!;
  assert.equal(path.dirname(path.dirname(backup)), f.temporary);
  assert.deepEqual(new Uint8Array(await fs.readFile(backup)), imageBytes);

  assert.equal(await owner.restore("![figure](assets/figure.png)"), true);
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), imageBytes);
  assert.equal(await owner.remove("# Note", () => true), true);
  assert.equal(await f.io.exists(target), false);
  assert.equal(await owner.restore("![figure](assets/figure.png)"), true);
  const replacement = Uint8Array.from([1, 2, 3]);
  await fs.writeFile(target, replacement);
  assert.equal(await owner.restore("![figure](assets/figure.png)"), false);
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), replacement);
});

test("other image references and reference definitions protect the same asset", async (context) => {
  const f = await fixture(context);
  const target = await f.write("shared image.png");
  const owner = f.acquire();
  owner.record(["assets/shared%20image.png"]);
  assert.equal(
    await owner.remove("![other](<assets/shared image.png>)", () => true),
    false,
  );
  assert.equal(
    await owner.remove("[figure]: assets/shared%20image.png", () => true),
    false,
  );
  assert.equal(await f.io.exists(target), true);
  assert.equal(await owner.remove("# Note", () => true), true);
  assert.equal(await f.io.exists(target), false);
  assert.equal(
    await owner.restore("![figure](assets/shared%20image.png)"),
    true,
  );
});

test("encoded sources keep their original target when both filenames exist", async (context) => {
  const f = await fixture(context);
  const literal = await f.write("a%20b.png");
  const decoded = await f.write("a b.png", Uint8Array.from([4, 5, 6]));
  const owner = f.acquire();
  owner.record(["assets/a%20b.png"]);
  assert.equal(await owner.remove("", () => true), true);
  assert.equal(await f.io.exists(literal), false);
  assert.equal(await f.io.exists(decoded), true);
  owner.record(["assets/a%20b.png"]);
  assert.equal(await owner.remove("", () => true), false);
  assert.equal(await f.io.exists(decoded), true);
  assert.equal(await owner.restore("![](assets/a%20b.png)"), true);
  assert.deepEqual(new Uint8Array(await fs.readFile(literal)), imageBytes);
});

test("shared owners retain undo files until the last editor releases them", async (context) => {
  const f = await fixture(context);
  const target = await f.write("figure.png");
  const first = f.acquire();
  const second = f.acquire();
  first.record(["assets/figure.png"]);
  await first.remove("", () => true);
  const backup = getDeletedImageAssetPath(f.item, "assets/figure.png")!;
  await first.release(true);
  assert.equal(await f.io.exists(backup), true);
  assert.equal(await second.restore("![](assets/figure.png)"), true);
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), imageBytes);
  await second.release();
  assert.equal(
    getDeletedImageAssetPath(f.item, "assets/figure.png"),
    undefined,
  );
  assert.equal(await f.io.exists(path.dirname(backup)), false);
  assert.equal(await f.io.exists(target), true);
});

test("a failed closing save preserves undo bytes for reopening until a successful release", async (context) => {
  const f = await fixture(context);
  const target = await f.write("figure.png");
  const original = f.acquire();
  original.record(["assets/figure.png"]);
  await original.remove("", () => true);
  const backup = getDeletedImageAssetPath(f.item, "assets/figure.png")!;

  await original.release(true);
  assert.equal(getDeletedImageAssetPath(f.item, "assets/figure.png"), backup);
  assert.deepEqual(new Uint8Array(await fs.readFile(backup)), imageBytes);
  assert.equal(await f.io.exists(target), false);

  const reopened = f.acquire();
  assert.equal(await reopened.restore("![](assets/figure.png)"), true);
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), imageBytes);
  await reopened.release();
  assert.equal(
    getDeletedImageAssetPath(f.item, "assets/figure.png"),
    undefined,
  );
  assert.equal(await f.io.exists(path.dirname(backup)), false);
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), imageBytes);
});

test("a failed undo copy leaves the source available and deletion retryable", async (context) => {
  const f = await fixture(context);
  const target = await f.write("figure.png");
  const owner = f.acquire();
  owner.record(["assets/figure.png"]);
  const originalCopy = f.io.copy;
  f.io.copy = async () => {
    throw new Error("Disk full");
  };
  await assert.rejects(
    owner.remove("", () => true),
    /Disk full/,
  );
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), imageBytes);
  assert.equal(
    getDeletedImageAssetPath(f.item, "assets/figure.png"),
    undefined,
  );
  f.io.copy = originalCopy;
  assert.equal(await owner.remove("", () => true), true);
});

test("a failed owner retains recovery files after a clean peer also closes", async (context) => {
  const f = await fixture(context);
  const target = await f.write("figure.png");
  const first = f.acquire();
  const second = f.acquire();
  first.record(["assets/figure.png"]);
  await first.remove("", () => true);
  const backup = getDeletedImageAssetPath(f.item, "assets/figure.png")!;
  await first.release(true);
  await second.release();
  assert.equal(getDeletedImageAssetPath(f.item, "assets/figure.png"), backup);
  assert.deepEqual(new Uint8Array(await fs.readFile(backup)), imageBytes);
  const reopened = f.acquire();
  await reopened.restore("![](assets/figure.png)");
  await reopened.release();
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), imageBytes);
  assert.equal(await f.io.exists(backup), false);
});

test("a changed editor or dirty peer defers removal, including during the undo copy", async (context) => {
  const f = await fixture(context);
  const target = await f.write("figure.png");
  const owner = f.acquire();
  owner.record(["assets/figure.png"]);
  assert.equal(await owner.remove("", () => false), false);
  assert.equal(await f.io.exists(target), true);
  assert.deepEqual(await fs.readdir(f.temporary), []);
  let current = true;
  const originalCopy = f.io.copy;
  f.io.copy = async (...args) => {
    await originalCopy(...args);
    current = false;
  };
  assert.equal(await owner.remove("", () => current), false);
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), imageBytes);
  f.io.copy = originalCopy;
  assert.equal(await owner.remove("", () => true), true);
});

test("external and escaping references never become deletion targets", async (context) => {
  const f = await fixture(context);
  const target = path.join(f.storage, "figure.png");
  await fs.writeFile(target, imageBytes);
  const owner = f.acquire();
  owner.record([
    "../figure.png",
    "assets/../figure.png",
    "assets/%2E%2E%2Ffigure.png",
    `file://${target}`,
    "https://example.com/figure.png",
  ]);
  assert.equal(await owner.remove("", () => true), false);
  assert.deepEqual(new Uint8Array(await fs.readFile(target)), imageBytes);
  assert.deepEqual(await fs.readdir(f.temporary), []);
});
