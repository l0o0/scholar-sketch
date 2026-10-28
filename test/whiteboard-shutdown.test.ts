import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import {
  createSourceFile,
  isFunctionDeclaration,
  ModuleKind,
  ScriptTarget,
  transpileModule,
} from "typescript";
import { runShutdownSteps } from "../src/utils/shutdown.ts";

// Execute the real hook with host operations supplied by the test. Loading
// Zotero's complete sandbox is unnecessary for its teardown control flow.
const source = createSourceFile(
  "hooks.ts",
  readFileSync(new URL("../src/hooks.ts", import.meta.url), "utf8"),
  ScriptTarget.ES2022,
  true,
);
const shutdown = source.statements.find(
  (node) => isFunctionDeclaration(node) && node.name?.text === "onShutdown",
);
assert.ok(shutdown);
const { outputText: shutdownCode } = transpileModule(shutdown.getText(source), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
});

const bootstrapCode = readFileSync(
  new URL("../addon/bootstrap.js", import.meta.url),
  "utf8",
);
const APP_SHUTDOWN = 2;
const ADDON_DISABLE = 4;

const operations = [
  "retainWorkspaceOnShutdown",
  "disposeFeatureUpdates",
  "unregisterAttachmentZipCompatibility",
  "unregisterAttachmentIcons",
  "unregisterAllCreationToolbars",
  "closeAllMarkdownWindows",
  "flushAllSessions",
  "flushAllWhiteboards",
  "unregisterItemPane",
  "closeAllWhiteboards",
  "disposeMarkdownRenderer",
  "clearNoteLibraries",
  "closeNoteIndex",
  "unregisterFileOpenInterceptor",
  "unregisterWhiteboardFileOpenInterceptor",
  "unregisterMenus",
  "unregisterShortcuts",
] as const;

function setup(
  overrides: Record<string, () => unknown> = {},
  options: {
    tutorial?: Promise<void>;
    logThrows?: boolean;
    windows?: object[];
    unregisterWhiteboardMenus?: (win: object) => unknown;
  } = {},
) {
  const calls: string[] = [];
  const menuWindows: object[] = [];
  const reports: Array<{ message: string; error: unknown }> = [];
  const addon = {
    data: { alive: true, config: { addonInstance: "ScholarSketch" } },
  };
  const Zotero = {
    ScholarSketch: addon,
    getMainWindows: () => options.windows ?? [],
  };
  const context: Record<string, unknown> = {
    addon,
    Zotero,
    tutorialStartup: options.tutorial,
    settingsPhase: "ready",
    runShutdownSteps,
    unregisterWhiteboardMenus: (win: object) => {
      calls.push("unregisterWhiteboardMenus");
      menuWindows.push(win);
      return options.unregisterWhiteboardMenus?.(win);
    },
    ztoolkit: {
      unregisterAll: () => {
        calls.push("unregisterAll");
        return overrides.unregisterAll?.();
      },
      log: (message: string, error: unknown) => {
        reports.push({ message, error });
        if (options.logThrows) throw new Error("Logger is unavailable");
      },
    },
  };
  for (const operation of operations) {
    context[operation] = () => {
      calls.push(operation);
      return overrides[operation]?.();
    };
  }
  const onShutdown = runInNewContext(
    `${shutdownCode}\nonShutdown;`,
    context,
  ) as (isAppShutdown?: boolean) => Promise<void>;
  Object.assign(addon, { hooks: { onShutdown } });
  context.APP_SHUTDOWN = APP_SHUTDOWN;
  const shutdownFromBootstrap = runInNewContext(
    `${bootstrapCode.replaceAll("__addonInstance__", addon.data.config.addonInstance)}\nshutdown;`,
    context,
  ) as (data: object, reason: number) => Promise<void>;
  context.chromeHandle = {
    destruct: () => calls.push("chromeHandle.destruct"),
  };
  const bootstrapShutdown = (reason: number) =>
    shutdownFromBootstrap({}, reason);
  return {
    onShutdown,
    bootstrapShutdown,
    calls,
    menuWindows,
    reports,
    addon,
    Zotero,
    context,
  };
}

test("ADDON_DISABLE waits for saving before unregistering editors and bootstrap chrome", async () => {
  let finish!: () => void;
  const saving = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fixture = setup({ flushAllWhiteboards: () => saving });
  const closing = fixture.bootstrapShutdown(ADDON_DISABLE);
  try {
    await setImmediate();
    assert.equal(fixture.context.settingsPhase, "stopped");
    assert.deepEqual(
      fixture.calls,
      operations.slice(0, operations.indexOf("flushAllWhiteboards") + 1),
    );
    assert.equal(fixture.Zotero.ScholarSketch, fixture.addon);
  } finally {
    finish();
    await closing;
  }
  assert.deepEqual(fixture.calls, [
    ...operations,
    "unregisterAll",
    "chromeHandle.destruct",
  ]);
  assert.equal(fixture.context.chromeHandle, null);
  assert.deepEqual(fixture.reports, []);
  assert.equal(fixture.addon.data.alive, false);
  assert.equal(Object.hasOwn(fixture.Zotero, "ScholarSketch"), false);
});

test("APP_SHUTDOWN calls the hook and waits for index close without destructing chrome", async () => {
  let finish!: () => void;
  const indexClosing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fixture = setup({ closeNoteIndex: () => indexClosing });
  const chromeHandle = fixture.context.chromeHandle;
  let completed = false;
  const closing = fixture.bootstrapShutdown(APP_SHUTDOWN).then(() => {
    completed = true;
  });
  try {
    await setImmediate();
    assert.equal(fixture.context.settingsPhase, "stopped");
    assert.deepEqual(fixture.calls, ["clearNoteLibraries", "closeNoteIndex"]);
    assert.equal(completed, false);
    assert.equal(fixture.context.chromeHandle, chromeHandle);
  } finally {
    finish();
    await closing;
  }
  assert.equal(completed, true);
  assert.deepEqual(fixture.calls, ["clearNoteLibraries", "closeNoteIndex"]);
  assert.equal(fixture.context.chromeHandle, chromeHandle);
  assert.deepEqual(fixture.reports, []);
});

test("APP_SHUTDOWN still awaits index close when library cleanup fails", async () => {
  const libraryError = new Error("library observer cleanup failed");
  let finish!: () => void;
  const indexClosing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fixture = setup({
    clearNoteLibraries: () => {
      throw libraryError;
    },
    closeNoteIndex: () => indexClosing,
  });
  let completed = false;
  const closing = fixture.bootstrapShutdown(APP_SHUTDOWN).then(() => {
    completed = true;
  });
  try {
    await setImmediate();
    assert.deepEqual(fixture.calls, ["clearNoteLibraries", "closeNoteIndex"]);
    assert.equal(completed, false);
    assert.deepEqual(fixture.reports, [
      {
        message: "Shutdown cleanup failed (noteLibraries)",
        error: libraryError,
      },
    ]);
  } finally {
    finish();
    await closing;
  }
  assert.equal(completed, true);
  assert.deepEqual(fixture.calls, ["clearNoteLibraries", "closeNoteIndex"]);
});

test("APP_SHUTDOWN does not wait for tutorial or window snapshot responses", async () => {
  let release!: () => void;
  const unavailableWindow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = setup(
    {
      closeAllMarkdownWindows: () => unavailableWindow,
      flushAllSessions: () => unavailableWindow,
      flushAllWhiteboards: () => unavailableWindow,
      closeAllWhiteboards: () => unavailableWindow,
    },
    { tutorial: unavailableWindow },
  );
  let completed = false;
  const closing = fixture.bootstrapShutdown(APP_SHUTDOWN).then(() => {
    completed = true;
  });
  try {
    await setImmediate();
    assert.equal(completed, true);
    assert.deepEqual(fixture.calls, ["clearNoteLibraries", "closeNoteIndex"]);
    assert.deepEqual(fixture.reports, []);
  } finally {
    // Release only for fixture cleanup if a regression entered the UI path.
    release();
    await closing;
  }
});

test("snapshot and cleanup failures still remove every later registration and singleton", async () => {
  const saveError = new Error("snapshot timeout");
  const sidebarError = new Error("sidebar unregister failed");
  const indexError = new Error("index close failed");
  const draft = {
    dirty: true,
    content: "Unsaved local draft",
    editorAlive: true,
  };
  const fixture = setup({
    flushAllWhiteboards: async () => {
      throw saveError;
    },
    unregisterItemPane: () => {
      throw sidebarError;
    },
    closeAllWhiteboards: () => {
      // The normal close path declines to destroy an editor after save failure.
      assert.equal(draft.dirty, true);
    },
    closeNoteIndex: async () => {
      throw indexError;
    },
  });
  await fixture.onShutdown();
  assert.deepEqual(fixture.calls, [...operations, "unregisterAll"]);
  assert.deepEqual(
    fixture.reports.map(({ error }) => error),
    [saveError, sidebarError, indexError],
  );
  assert.deepEqual(
    fixture.reports.map(({ message }) => message),
    [
      "Shutdown cleanup failed (whiteboardSave)",
      "Shutdown cleanup failed (itemPane)",
      "Shutdown cleanup failed (noteIndex)",
    ],
  );
  assert.deepEqual(draft, {
    dirty: true,
    content: "Unsaved local draft",
    editorAlive: true,
  });
  assert.equal(fixture.addon.data.alive, false);
  assert.equal(Object.hasOwn(fixture.Zotero, "ScholarSketch"), false);
});

test("rejected tutorial startup is cleared and cannot block later cleanup", async () => {
  const tutorialError = new Error("tutorial initialization failed");
  const fixture = setup({}, { tutorial: Promise.reject(tutorialError) });
  await fixture.onShutdown();
  assert.equal(fixture.context.tutorialStartup, undefined);
  assert.deepEqual(fixture.calls, [...operations, "unregisterAll"]);
  assert.equal(fixture.reports.length, 1);
  assert.equal(fixture.reports[0].error, tutorialError);
});

test("toolkit and logging failures still permit bootstrap chrome cleanup", async () => {
  const fixture = setup(
    {
      flushAllWhiteboards: async () => {
        throw new Error("snapshot timeout");
      },
      unregisterAll: () => {
        throw new Error("toolkit cleanup failed");
      },
    },
    { logThrows: true },
  );
  await fixture.bootstrapShutdown(ADDON_DISABLE);
  assert.equal(fixture.calls.at(-1), "chromeHandle.destruct");
  assert.equal(fixture.reports.length, 2);
  assert.equal(fixture.addon.data.alive, false);
  assert.equal(Object.hasOwn(fixture.Zotero, "ScholarSketch"), false);
});

test("hot reload unregisters whiteboard menus in every window despite individual failures", async () => {
  const first = { id: "main-window-1" };
  const second = { id: "main-window-2" };
  const third = { id: "main-window-3" };
  const firstError = new Error("First window menu cleanup failed");
  const secondError = new Error("Second window menu cleanup failed");
  const fixture = setup(
    {},
    {
      windows: [first, second, third],
      unregisterWhiteboardMenus: (win) => {
        if (win === first) throw firstError;
        if (win === second) return Promise.reject(secondError);
      },
      logThrows: true,
    },
  );
  await fixture.onShutdown();
  assert.deepEqual(fixture.menuWindows, [first, second, third]);
  const whiteboardFileHandler = fixture.calls.indexOf(
    "unregisterWhiteboardFileOpenInterceptor",
  );
  assert.deepEqual(fixture.calls.slice(whiteboardFileHandler + 1), [
    "unregisterWhiteboardMenus",
    "unregisterWhiteboardMenus",
    "unregisterWhiteboardMenus",
    "unregisterMenus",
    "unregisterShortcuts",
    "unregisterAll",
  ]);
  assert.deepEqual(
    fixture.reports.map(({ error }) => error),
    [firstError, secondError],
  );
  assert.deepEqual(
    fixture.reports.map(({ message }) => message),
    [
      "Shutdown cleanup failed (whiteboardMenus:window-1)",
      "Shutdown cleanup failed (whiteboardMenus:window-2)",
    ],
  );
  assert.equal(fixture.addon.data.alive, false);
  assert.equal(Object.hasOwn(fixture.Zotero, "ScholarSketch"), false);
});
