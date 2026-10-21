import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import * as ts from "typescript";
import { createStatusFeedback } from "../src/modules/markdown/status-feedback.ts";

const source = ts.createSourceFile(
  "tab.ts",
  readFileSync(
    new URL("../src/modules/markdown/tab.ts", import.meta.url),
    "utf8",
  ),
  ts.ScriptTarget.ES2022,
  true,
);
const functions = [
  "beginSessionImageOperation",
  "importExternalImagesInSession",
  "cleanupImagesInSession",
  "setStatus",
  "updateSaveStatus",
  "mountMoreMenu",
].map((name) => {
  const fn = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(fn, name);
  return fn.getText(source).replace(/^export\s+/, "");
});
const { outputText } = ts.transpileModule(functions.join("\n"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(t: TestContext) {
  const win = new Window();
  const element = win.document.createElement("span");
  win.document.body.append(element);
  const feedback = createStatusFeedback(element as unknown as HTMLElement);
  t.after(async () => {
    feedback.destroy();
    await win.happyDOM.close();
  });
  const state = {
    value: "![image](https://example.com/image.png)",
    composing: false,
    editable: true,
    applyAllowed: true,
    downloads: 0,
    applies: 0,
    saves: 0,
    cleanups: 0,
    flush: async () => {},
    beforeDownload: async () => {},
    saveError: null as Error | null,
    result: {
      markdown: "![image](assets/local.png)",
      imported: 1,
      total: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      cancelled: false,
    },
  };
  const session = {
    tabID: "note",
    itemID: 7,
    closing: false,
    statusFeedback: feedback,
    editor: {
      getValue: () => state.value,
      isComposing: () => state.composing,
      requestSnapshot: async () => state.value,
      applyIfUnchanged: async (expected: string, value: string) => {
        if (!state.applyAllowed || state.value !== expected) return false;
        state.applies++;
        state.value = value;
        session.save.dirty = true;
        return true;
      },
    },
    save: {
      dirty: false,
      writing: false,
      lastError: null as Error | null,
      request: async (options?: { cleanupImages?: boolean }) => {
        state.saves++;
        if (state.saveError) {
          session.save.lastError = state.saveError;
          api.updateSaveStatus(session);
          throw state.saveError;
        }
        if (options?.cleanupImages) state.cleanups++;
        session.save.dirty = false;
        api.updateSaveStatus(session);
      },
    },
  };
  const api = runInNewContext(
    `${outputText}\n({ importExternalImagesInSession, cleanupImagesInSession, updateSaveStatus, mountMoreMenu });`,
    {
      imageOperations: new Map(),
      sessionRegistry: { get: () => session },
      getString: (key: string, options?: { args?: object }) =>
        options?.args ? `${key}:${JSON.stringify(options.args)}` : key,
      ztoolkit: { log() {} },
      Zotero: { Items: { get: () => ({ isEditable: () => state.editable }) } },
      flushMarkdownItems: () => state.flush(),
      refreshImageAssets: async () => {},
      importExternalImages: async (
        _item: unknown,
        _source: string,
        options: {
          shouldContinue(): boolean;
          onProgress(progress: object): void;
        },
      ) => {
        state.downloads++;
        options.onProgress({ completed: 0, total: state.result.total });
        await state.beforeDownload();
        if (!options.shouldContinue())
          return { ...state.result, cancelled: true };
        options.onProgress({
          completed: state.result.completed,
          total: state.result.total,
        });
        return state.result;
      },
      MORE_MENU_SECTIONS: [[{ action: "shortcuts" }, { action: "settings" }]],
      moreMenuLabel: (value: string) => value,
    },
  ) as {
    importExternalImagesInSession(session: unknown): Promise<void>;
    cleanupImagesInSession(session: unknown): Promise<void>;
    updateSaveStatus(session: unknown): void;
    mountMoreMenu(session: unknown): void;
  };
  api.updateSaveStatus(session);
  return { api, state, session, element, win };
}

test("download progress survives autosave and reports success only after persisting links", async (t) => {
  const f = fixture(t);
  f.state.beforeDownload = async () => {
    f.api.updateSaveStatus(f.session);
    assert.equal(f.element.dataset.statusState, "busy");
    assert.match(f.element.textContent, /status-images-download-progress/);
  };
  await f.api.importExternalImagesInSession(f.session);
  assert.equal(f.state.applies, 1);
  assert.equal(f.state.saves, 1);
  assert.equal(f.state.value, f.state.result.markdown);
  assert.equal(f.element.dataset.statusState, "success");
  assert.match(f.element.textContent, /status-imported-images/);
});

test("empty, fully failed and partly failed downloads have distinct outcomes", async (t) => {
  for (const [total, imported, failed, status, key] of [
    [0, 0, 0, "success", "status-no-external-images"],
    [1, 0, 1, "error", "status-images-download-failed"],
    [2, 1, 1, "warning", "status-images-download-partial"],
  ] as const) {
    const f = fixture(t);
    Object.assign(f.state.result, {
      total,
      imported,
      failed,
      completed: total,
    });
    await f.api.importExternalImagesInSession(f.session);
    assert.equal(f.element.dataset.statusState, status);
    assert.match(f.element.textContent, new RegExp(key));
    assert.equal(f.state.applies, imported ? 1 : 0);
  }
});

test("editing during download preserves new text and refuses stale results", async (t) => {
  const f = fixture(t);
  f.state.beforeDownload = async () => {
    f.state.value = "new user text";
  };
  await f.api.importExternalImagesInSession(f.session);
  assert.equal(f.state.applies, 0);
  assert.equal(f.state.saves, 0);
  assert.equal(f.state.value, "new user text");
  assert.equal(f.element.dataset.statusState, "warning");
  assert.equal(f.element.textContent, "status-images-document-changed");
});

test("an iframe rejection preserves the document even if the parent snapshot is unchanged", async (t) => {
  const f = fixture(t);
  f.state.applyAllowed = false;
  await f.api.importExternalImagesInSession(f.session);
  assert.equal(f.state.applies, 0);
  assert.equal(f.state.saves, 0);
  assert.equal(f.element.textContent, "status-images-links-unconfirmed");
});

test("a failed save remains visible instead of claiming downloaded links were saved", async (t) => {
  const f = fixture(t);
  f.state.saveError = new Error("disk full");
  await f.api.importExternalImagesInSession(f.session);
  assert.equal(f.state.applies, 1);
  assert.equal(f.element.dataset.statusState, "error");
  assert.equal(f.element.dataset.statusSource, "save");
  assert.equal(f.element.textContent, "status-save-failed");
});

test("a download excludes duplicate downloads and cleanup until completion", async (t) => {
  const f = fixture(t);
  const wait = deferred();
  const started = deferred();
  f.state.beforeDownload = async () => {
    started.resolve();
    await wait.promise;
  };
  const pending = f.api.importExternalImagesInSession(f.session);
  await started.promise;
  await f.api.importExternalImagesInSession(f.session);
  await f.api.cleanupImagesInSession(f.session);
  assert.equal(f.state.downloads, 1);
  assert.equal(f.state.cleanups, 0);
  assert.equal(f.element.dataset.statusState, "busy");
  wait.resolve();
  await pending;
  await f.api.cleanupImagesInSession(f.session);
  assert.equal(f.state.cleanups, 1);
  assert.equal(f.element.textContent, "status-image-cleanup-complete");
});

test("closed sessions never apply or save late download results", async (t) => {
  const f = fixture(t);
  f.state.beforeDownload = async () => {
    f.session.closing = true;
  };
  await f.api.importExternalImagesInSession(f.session);
  assert.equal(f.state.applies, 0);
  assert.equal(f.state.saves, 0);
});

test("composition and competing drafts prevent cleanup and do not show success", async (t) => {
  const f = fixture(t);
  f.state.composing = true;
  await f.api.cleanupImagesInSession(f.session);
  assert.equal(f.state.saves, 0);
  assert.equal(f.element.textContent, "status-image-operation-composing");
  f.state.composing = false;
  f.state.flush = async () => {
    throw new Error("other editor draft");
  };
  await f.api.cleanupImagesInSession(f.session);
  assert.equal(f.state.cleanups, 0);
  assert.equal(f.element.dataset.statusState, "error");
});

test("cleanup paused by a new draft is a warning, while ordinary save failures stay errors", async (t) => {
  const f = fixture(t);
  f.state.saveError = Object.assign(new Error("cleanup cancelled"), {
    code: "IMAGE_CLEANUP_STALE",
  });
  await f.api.cleanupImagesInSession(f.session);
  assert.equal(f.state.cleanups, 0);
  assert.equal(f.session.save.lastError, null);
  assert.equal(f.element.dataset.statusState, "warning");
  assert.equal(f.element.textContent, "status-images-cleanup-changed");
});

test("the actual More menu opens the shortcuts page and restores focus to its visible trigger", async (t) => {
  const f = fixture(t);
  const root = f.win.document.createElement("div");
  root.innerHTML =
    '<button data-action="more">More</button><div class="zotero-markdown-more-menu"></div>';
  f.win.document.body.append(root);
  const opened: unknown[][] = [];
  const session = {
    view: { root },
    modal: {
      open: (...args: unknown[]) => {
        assert.equal(
          root.querySelector<HTMLElement>(".zotero-markdown-more-menu")?.hidden,
          true,
        );
        assert.equal(
          f.win.document.activeElement,
          root.querySelector('[data-action="more"]'),
        );
        opened.push(args);
      },
    },
    closeMoreMenu: undefined as (() => void) | undefined,
  };
  f.api.mountMoreMenu(session);
  root.querySelector<HTMLElement>('[data-menu-action="shortcuts"]')?.click();
  assert.deepEqual(opened[0], ["settings", undefined, "shortcuts"]);
  session.closeMoreMenu?.();
});
