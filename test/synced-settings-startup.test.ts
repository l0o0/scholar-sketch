import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import {
  createSourceFile,
  isFunctionDeclaration,
  isVariableStatement,
  ScriptTarget,
  transpileModule,
} from "typescript";

// Run the actual startup hook; replace the host and other feature boundaries.
const source = createSourceFile(
  "hooks.ts",
  readFileSync(new URL("../src/hooks.ts", import.meta.url), "utf8"),
  ScriptTarget.ES2022,
  true,
);
const lifecycle = source.statements.filter(
  (node) =>
    (isFunctionDeclaration(node) &&
      ["onStartup", "onMainWindowLoad"].includes(node.name?.text ?? "")) ||
    (isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (decl) => decl.name.getText(source) === "settingsPhase",
      )),
);
assert.equal(lifecycle.length, 3);
const code = transpileModule(
  lifecycle.map((node) => node.getText(source)).join("\n"),
  {
    compilerOptions: { target: ScriptTarget.ES2022 },
  },
).outputText;

function host(
  migrate: () => Promise<unknown>,
  overrides: Record<string, () => unknown> = {},
) {
  const calls: string[] = [];
  const errors: unknown[] = [];
  const notices: unknown[] = [];
  const addon = {
    data: { initialized: false, config: { addonName: "Scholar Sketch" } },
    api: {},
  };
  const window = { MozXULElement: { insertFTLIfNeeded() {} } };
  const context: Record<string, unknown> = {
    addon,
    tutorialStartup: undefined,
    migrateLegacyPluginSettings: migrate,
    Zotero: {
      initializationPromise: Promise.resolve(),
      unlockPromise: Promise.resolve(),
      uiReadyPromise: Promise.resolve(),
      getMainWindows: () => [window],
      getMainWindow: () => ({}),
      logError: (error: unknown) => errors.push(error),
    },
    ztoolkit: {
      log() {},
      ProgressWindow: class {
        createLine(line: unknown) {
          notices.push(line);
          return this;
        }
        show() {
          return this;
        }
        startCloseTimer() {}
      },
    },
    getString: (key: string) => key,
    canvasApi: {},
    markdownApi: {},
    openMarkdownAttachment() {},
    createMarkdownAttachment() {},
  };
  for (const name of [
    "initLocale",
    "registerPrefs",
    "registerAttachmentZipCompatibility",
    "registerAttachmentIcons",
    "registerFileOpenInterceptor",
    "registerWhiteboardFileOpenInterceptor",
    "ensureDOMGlobals",
    "resumeWorkspaceTracking",
    "registerShortcuts",
    "registerMarkdownTabHooks",
    "registerWhiteboardTabHooks",
    "registerCreationToolbar",
    "registerItemContextMenu",
    "registerWhiteboardMenus",
    "injectMarkdownStyles",
    "injectWhiteboardStyles",
    "registerNoteLibraryObserver",
    "registerSidebarSection",
    "registerWhiteboardSidebar",
    "ensureTutorialWhiteboard",
    "restoreWorkspace",
  ]) {
    context[name] = async () => {
      calls.push(name);
      return overrides[name]?.();
    };
  }
  const hooks = runInNewContext(
    `${code}\n({ start: onStartup, load: onMainWindowLoad, stop: () => { settingsPhase = "stopped"; } })`,
    context,
  ) as {
    start(): Promise<void>;
    load(win: unknown): Promise<void>;
    stop(): void;
  };
  return { ...hooks, window, calls, errors, notices, addon };
}

test("startup waits for durable settings migration before exposing templates or tutorials", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const h = host(() => pending);
  const running = h.start();
  await setImmediate();
  await h.load(h.window);
  assert.deepEqual(h.calls, ["initLocale"]);
  assert.equal(h.addon.data.initialized, false);
  finish();
  await running;
  assert.ok(h.calls.includes("registerCreationToolbar"));
  assert.ok(h.calls.includes("ensureTutorialWhiteboard"));
  assert.equal(h.addon.data.initialized, true);
  assert.deepEqual(h.errors, []);
});

test("failed migration reports retained templates while Markdown and Canvas still initialize", async () => {
  const error = new Error("local configuration could not be saved");
  const h = host(async () => {
    throw error;
  });
  await h.start();
  assert.deepEqual(h.errors, [error]);
  assert.ok(
    h.notices.some((notice) => (notice as { type: string }).type === "fail"),
  );
  assert.ok(h.calls.includes("registerCreationToolbar"));
  assert.ok(h.calls.includes("ensureTutorialWhiteboard"));
  assert.equal(h.addon.data.initialized, true);
});

test("completion after shutdown cannot activate plugin windows", async () => {
  let finish!: () => void;
  const h = host(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const running = h.start();
  await setImmediate();
  h.stop();
  finish();
  await running;
  await h.load(h.window);
  assert.deepEqual(h.calls, ["initLocale"]);
  assert.equal(h.addon.data.initialized, false);
});

test("shutdown during icon registration cannot start later feature consumers", async () => {
  let finish!: () => void;
  const h = host(async () => {}, {
    registerAttachmentIcons: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  const running = h.start();
  await setImmediate();
  h.stop();
  finish();
  await running;
  assert.ok(h.calls.includes("registerAttachmentIcons"));
  assert.ok(!h.calls.includes("registerFileOpenInterceptor"));
  assert.ok(!h.calls.includes("registerNoteLibraryObserver"));
  assert.equal(h.addon.data.initialized, false);
});

test("a migration failure after shutdown logs diagnostics without opening a notification", async () => {
  let fail!: (reason: unknown) => void;
  const error = new Error("late migration failure");
  const h = host(
    () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      }),
  );
  const running = h.start();
  await setImmediate();
  h.stop();
  fail(error);
  await running;
  assert.deepEqual(h.errors, [error]);
  assert.deepEqual(h.notices, []);
  assert.equal(h.addon.data.initialized, false);
});
