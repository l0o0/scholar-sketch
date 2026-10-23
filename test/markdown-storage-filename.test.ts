import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMarkdownAttachment } from "../src/modules/markdown/create.ts";
import {
  createMarkdownImportPaths,
  logicalMarkdownFilename,
  storedMarkdownFilename,
} from "../src/modules/markdown/storage-filename";

test("adds one compact prefix to stored Markdown files", () => {
  assert.equal(storedMarkdownFilename("Note.md"), "zmd-Note.md");
  assert.equal(storedMarkdownFilename("zmd-Note.md"), "zmd-Note.md");
  assert.equal(storedMarkdownFilename("zmd-zmd-Note.md"), "zmd-Note.md");
});

test("keeps the logical filename free of the storage prefix", () => {
  assert.equal(logicalMarkdownFilename("zmd-研究计划.md"), "研究计划.md");
  assert.equal(logicalMarkdownFilename("研究计划.md"), "研究计划.md");
});

test("puts import uniqueness in the temporary directory", () => {
  assert.deepEqual(createMarkdownImportPaths("/tmp", "Note.md", "abc"), {
    directory: "/tmp/bamboo-abc",
    file: "/tmp/bamboo-abc/zmd-Note.md",
  });
});

test("Markdown creation assigns its display title in the initial import", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "markdown-create-"));
  const importedFile = path.join(root, "imported.md");
  const globals = globalThis as Record<string, unknown>;
  const names = ["Zotero", "IOUtils", "ztoolkit"];
  const previous = names.map((name) => globals[name]);
  let importedTitle = "";
  let importedFilename = "";
  let returnedTitle = "";
  let repairContentType = false;
  let saveCalls = 0;
  const item = {
    id: 42,
    libraryID: 1,
    attachmentContentType: "text/markdown",
    getField: () => returnedTitle,
    setField: (_name: string, title: string) => {
      returnedTitle = title;
    },
    saveTx: async () => {
      saveCalls++;
      throw new Error("Follow-up save failed");
    },
  };
  Object.assign(globals, {
    Zotero: {
      Prefs: { get: () => false },
      Libraries: { userLibraryID: 1 },
      getActiveZoteroPane: () => undefined,
      getTempDirectory: () => ({ path: root }),
      File: {
        putContentsAsync: (file: string, content: string) =>
          fs.writeFile(file, content),
      },
      Attachments: {
        importFromFile: async (options: { file: string; title: string }) => {
          importedTitle = options.title;
          importedFilename = path.basename(options.file);
          returnedTitle = importedTitle;
          await fs.copyFile(options.file, importedFile);
          item.attachmentContentType = repairContentType
            ? "text/plain"
            : "text/markdown";
          return item;
        },
      },
    },
    IOUtils: {
      makeDirectory: (directory: string) => fs.mkdir(directory),
      exists: (file: string) =>
        fs.access(file).then(
          () => true,
          () => false,
        ),
      remove: (file: string) => fs.rm(file, { recursive: true }),
    },
    ztoolkit: { log: () => {} },
  });
  t.after(async () => {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete globals[name];
      else globals[name] = previous[index];
    });
    await fs.rm(root, { recursive: true, force: true });
  });
  const create = (title?: string) =>
    createMarkdownAttachment(null, {
      title,
      open: false,
      silent: true,
      initialContent: "Tutorial body",
      collectionID: null,
    });

  await t.test(
    "custom metadata title leaves the timestamped filename intact",
    async () => {
      assert.equal(await create("开始写作.md"), item);
      assert.equal(importedTitle, "开始写作.md");
      assert.equal(returnedTitle, importedTitle);
      assert.match(importedFilename, /^zmd-Note-\d{8}-\d{6}\.md$/);
      assert.equal(saveCalls, 0);
      assert.equal(await fs.readFile(importedFile, "utf8"), "Tutorial body");
    },
  );

  await t.test(
    "omitted and blank titles retain the default filename title",
    async () => {
      for (const title of [undefined, "  "]) {
        assert.equal(await create(title), item);
        assert.equal(importedTitle, logicalMarkdownFilename(importedFilename));
        assert.equal(saveCalls, 0);
      }
    },
  );

  await t.test(
    "an imported tutorial remains searchable when a later save fails",
    async () => {
      repairContentType = true;
      assert.equal(await create("Start writing.md"), null);
      assert.equal(saveCalls, 1);
      assert.equal(importedTitle, "Start writing.md");
      assert.equal(await fs.readFile(importedFile, "utf8"), "Tutorial body");
      assert.deepEqual(await fs.readdir(root), ["imported.md"]);
    },
  );
});
