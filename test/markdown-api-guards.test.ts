import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { markdownApi } from "../src/modules/markdown/api.ts";
import { editorSnapshotChanged } from "../src/modules/markdown/api-guards.ts";
import { SaveCoordinator } from "../src/modules/markdown/save-coordinator.ts";
import { sessionRegistry } from "../src/modules/markdown/session-registry.ts";
import type { MarkdownEditorHandle } from "../src/modules/markdown/editor.ts";

test("detects editor input that arrives after the API snapshot", () => {
  assert.equal(editorSnapshotChanged("before", "after"), true);
  assert.equal(editorSnapshotChanged("same", "same"), false);
});

test("does not skip image cleanup when replacement content is unchanged", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/api.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /content === existing && !options\.cleanupImages/);
});

test("Markdown update checks the caller's revision before writes and no-ops", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "markdown-api-"));
  const target = path.join(root, "note.md");
  const initial = "Original tutorial";
  await fs.writeFile(target, initial);
  const globals = globalThis as Record<string, unknown>;
  const names = ["Zotero", "IOUtils", "PathUtils", "ztoolkit", "addon"];
  const previous = names.map((name) => globals[name]);
  let writes = 0;
  let itemSaves = 0;
  const item = {
    id: 42,
    key: "EXAMPLE1",
    libraryID: 1,
    attachmentFilename: "note.md",
    attachmentContentType: "text/markdown",
    attachmentLinkMode: 2,
    isAttachment: () => true,
    isStoredFileAttachment: () => false,
    getFilePathAsync: async () => target,
    getField: () => "note.md",
    saveTx: async () => itemSaves++,
  };
  Object.assign(globals, {
    Zotero: {
      Items: { get: (id: number) => (id === item.id ? item : undefined) },
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      DataDirectory: { dir: root },
      File: { getContentsAsync: (file: string) => fs.readFile(file, "utf8") },
    },
    IOUtils: {
      exists: (file: string) =>
        fs.access(file).then(
          () => true,
          () => false,
        ),
      stat: async (file: string) => ({ size: (await fs.stat(file)).size }),
      getChildren: async (directory: string) =>
        (await fs.readdir(directory)).map((name) => path.join(directory, name)),
      readUTF8: (file: string) => fs.readFile(file, "utf8"),
      makeDirectory: (directory: string) =>
        fs.mkdir(directory, { recursive: true }),
      writeUTF8: async (file: string, content: string) => {
        writes++;
        await fs.writeFile(file, content);
      },
    },
    PathUtils: { join: path.join, parent: path.dirname },
    ztoolkit: { log: () => {} },
    addon: {
      data: {
        locale: {
          current: { formatMessagesSync: () => [{ value: "Conflict" }] },
        },
      },
    },
  });
  t.after(async () => {
    sessionRegistry.unregister("markdown-api-test");
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete globals[name];
      else globals[name] = previous[index];
    });
    await fs.rm(root, { recursive: true, force: true });
  });

  await t.test(
    "a file changed after read is preserved, even with force",
    async () => {
      const observed = await markdownApi.read(item.id);
      await fs.writeFile(target, "User edits on disk");
      await assert.rejects(
        markdownApi.update(item.id, {
          content: "New tutorial",
          expectedRevision: observed.content,
          force: true,
        }),
        { code: "WRITE_CONFLICT" },
      );
      assert.equal(await fs.readFile(target, "utf8"), "User edits on disk");
      assert.equal(writes, 0);
      assert.equal(itemSaves, 0);
    },
  );

  await t.test(
    "stale no-op updates are rejected before returning success",
    async () => {
      await assert.rejects(
        markdownApi.update(item.id, {
          content: "User edits on disk",
          expectedRevision: initial,
        }),
        { code: "WRITE_CONFLICT" },
      );
      assert.equal(writes, 0);
    },
  );

  await t.test(
    "matching revisions still use protected persistence and history",
    async () => {
      const observed = await markdownApi.read(item.id);
      await markdownApi.update(item.id, {
        content: "New tutorial",
        expectedRevision: observed.content,
      });
      assert.equal((await markdownApi.read(item.id)).content, "New tutorial");
      const history = path.join(
        root,
        "scholar-canvas",
        "history",
        "1",
        item.key,
      );
      const versions = await fs.readdir(history);
      assert.equal(versions.length, 1);
      assert.equal(
        JSON.parse(await fs.readFile(path.join(history, versions[0]), "utf8"))
          .content,
        observed.content,
      );
    },
  );

  let buffer = "New tutorial";
  let applied = 0;
  let saved = 0;
  let snapshot: () => Promise<string> = async () => buffer;
  const save = new SaveCoordinator({
    getSnapshot: () => ({ rev: save.currentRev, value: buffer }),
    write: async (content) => {
      saved++;
      await fs.writeFile(target, content);
    },
  });
  sessionRegistry.register({
    tabID: "markdown-api-test",
    surface: "tab",
    sourceID: "tab:markdown-api-test",
    itemID: item.id,
    path: target,
    win: {} as Window,
    isActive: () => true,
    updateTitle: () => {},
    storageLabel: "linked",
    mode: "live",
    save,
    editor: {
      requestSnapshot: () => snapshot(),
      getValue: () => buffer,
      setValue: (content: string) => {
        applied++;
        buffer = content;
        save.markChanged();
      },
    } as MarkdownEditorHandle,
  });

  await t.test(
    "changed live buffers reject stale revisions and stale no-ops",
    async () => {
      const observed = await markdownApi.read(item.id);
      buffer = "Unsaved user edits";
      save.markChanged();
      for (const content of ["New tutorial", buffer]) {
        await assert.rejects(
          markdownApi.update(item.id, {
            content,
            expectedRevision: observed.content,
            force: true,
          }),
          { code: "WRITE_CONFLICT" },
        );
      }
      assert.equal(buffer, "Unsaved user edits");
      assert.equal(applied, 0);
      assert.equal(saved, 0);
      assert.equal(await fs.readFile(target, "utf8"), "New tutorial");
    },
  );

  await t.test(
    "editor changes after the matching snapshot are also preserved",
    async () => {
      const observed = buffer;
      snapshot = async () => {
        buffer = "Typed while the snapshot was in flight";
        save.markChanged();
        return observed;
      };
      await assert.rejects(
        markdownApi.update(item.id, {
          content: "New tutorial",
          expectedRevision: observed,
          force: true,
        }),
        { code: "WRITE_CONFLICT" },
      );
      assert.equal(buffer, "Typed while the snapshot was in flight");
      assert.equal(applied, 0);
      assert.equal(saved, 0);
      snapshot = async () => buffer;
    },
  );

  await t.test(
    "matching live revisions retain the existing dirty-buffer guard",
    async () => {
      await assert.rejects(
        markdownApi.update(item.id, {
          content: "Update",
          expectedRevision: buffer,
        }),
        { code: "WRITE_CONFLICT" },
      );
      assert.equal(applied, 0);
      await markdownApi.update(item.id, {
        content: "Explicitly updated buffer",
        expectedRevision: buffer,
        force: true,
      });
      assert.equal(applied, 1);
      assert.equal(saved, 1);
      assert.equal(
        await fs.readFile(target, "utf8"),
        "Explicitly updated buffer",
      );
    },
  );
});
