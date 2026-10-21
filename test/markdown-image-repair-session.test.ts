import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  createSourceFile,
  isFunctionDeclaration,
  ModuleKind,
  ScriptTarget,
  transpileModule,
} from "typescript";
import type { ImageRepairDialogOptions } from "../src/modules/markdown/images/repair-dialog.ts";

// Exercise the real session wiring without starting Zotero or an editor iframe.
const source = createSourceFile(
  "tab.ts",
  readFileSync(
    new URL("../src/modules/markdown/tab.ts", import.meta.url),
    "utf8",
  ),
  ScriptTarget.ES2022,
  true,
);
const functions = [
  "beginSessionImageOperation",
  "showImageRepairStatus",
  "openSessionImageRepair",
].map((name) => {
  const fn = source.statements.find(
    (node) => isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(fn, name);
  return fn.getText(source);
});
const { outputText } = transpileModule(functions.join("\n"), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
});

function setup() {
  let options!: ImageRepairDialogOptions;
  const events: string[] = [];
  const state = {
    disk: "saved references",
    flush: async () => {
      state.disk = "latest draft references";
    },
  };
  const item = { id: 7, getFilePathAsync: async () => "/stored/note.md" };
  const session = {
    tabID: "note",
    itemID: 7,
    closing: false,
    view: { root: { ownerDocument: {} } },
    closeImageRepair: undefined as (() => void) | undefined,
  };
  const report = { checked: 1, repaired: 1 };
  const open = runInNewContext(`${outputText}\nopenSessionImageRepair;`, {
    imageOperations: new Map(),
    sessionRegistry: { get: () => session },
    getString: (key: string) => key,
    Zotero: {
      Items: { get: () => item },
      File: { getContentsAsync: async () => state.disk },
    },
    openImageRepairDialog: (value: ImageRepairDialogOptions) => {
      options = value;
      return { destroy: () => options.onClose?.() };
    },
    flushMarkdownItems: async (ids: number[]) => {
      assert.equal(ids.join(","), "7");
      events.push("flush");
      await state.flush();
    },
    inspectImageAssets: async (_item: unknown, markdown: string) => {
      events.push(`inspect:${markdown}`);
      return report;
    },
    repairImageAssets: async (_item: unknown, markdown: string) => {
      events.push(`repair:${markdown}`);
      return report;
    },
    refreshRepairedImageAssets: async (value: unknown) => {
      assert.equal(value, item);
      events.push("refresh");
    },
  }) as (session: unknown) => void;
  open(session);
  return { options, state, events, session, report };
}

test("checking uses saved references and never flushes an unsaved editor", async () => {
  const fixture = setup();
  await fixture.options.inspect();
  assert.deepEqual(fixture.events, ["inspect:saved references"]);
  assert.equal(fixture.state.disk, "saved references");
});

test("repair flushes drafts, uses the latest disk version, then refreshes images", async () => {
  const fixture = setup();
  assert.equal(await fixture.options.repair(), fixture.report);
  assert.deepEqual(fixture.events, [
    "flush",
    "repair:latest draft references",
    "refresh",
  ]);
});

test("a failed save prevents image repair and refresh", async () => {
  const fixture = setup();
  fixture.state.flush = async () => {
    throw new Error("conflicting draft");
  };
  await assert.rejects(fixture.options.repair(), /conflicting draft/);
  assert.deepEqual(fixture.events, ["flush"]);
});

test("closing the dialog during a save prevents a later repair from starting", async () => {
  const fixture = setup();
  fixture.state.flush = async () => {
    fixture.session.closeImageRepair?.();
  };
  await assert.rejects(fixture.options.repair(), /image-repair-session-closed/);
  assert.deepEqual(fixture.events, ["flush"]);
  assert.equal(fixture.session.closeImageRepair, undefined);
});

test("closing the note before repair prevents both saving and file changes", async () => {
  const fixture = setup();
  fixture.session.closing = true;
  await assert.rejects(fixture.options.repair(), /image-repair-session-closed/);
  assert.deepEqual(fixture.events, []);
});
