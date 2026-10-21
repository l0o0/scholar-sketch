import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";

function readSource(name: string) {
  return ts.createSourceFile(
    name,
    readFileSync(
      new URL(`../src/modules/markdown/${name}`, import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.ES2022,
    true,
  );
}

const tabSource = readSource("tab.ts");
const tabFunctions = [
  "canAutomaticallyRepairImages",
  "refreshImageAssets",
  "refreshMarkdownSessionOnFocus",
].map((name) => {
  const fn = tabSource.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(fn, `missing tab function ${name}`);
  return fn.getText(tabSource).replace(/^export\s+/, "");
});
const sidebarSource = readSource("sidebar.ts");
const sidebarClass = sidebarSource.statements.find(
  (node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === "SidebarController",
);
assert.ok(sidebarClass);
const sidebarMethods = [
  "canAutomaticallyRepairImages",
  "refreshImages",
  "refreshFromDocumentSync",
].map((name) => {
  const method = sidebarClass.members.find(
    (node) =>
      ts.isMethodDeclaration(node) && node.name.getText(sidebarSource) === name,
  );
  assert.ok(method, `missing sidebar method ${name}`);
  return method.getText(sidebarSource);
});

function lazyImageCallback(source: ts.SourceFile) {
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "onResolveAsset"
    )
      callback = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, `missing lazy image callback in ${source.fileName}`);
  return callback.getText(source);
}

type Surface = "tab" | "sidebar";
type Assets = Record<string, { dataURL: string }>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Run the actual surface methods, substituting only the image I/O boundary.
// The boundary deliberately waits so a stale UI callback cannot authorize repair.
function fixture(surface: Surface) {
  const original = "![figure](assets/figure.png)";
  const item = { id: 7 };
  const state = {
    content: original,
    dirty: false,
    writing: false,
    composing: false,
    peerLocalWork: false,
    closed: false,
    current: true,
    hasEditor: true,
    active: true,
    hasSave: true,
    focusResult: "unchanged",
    focusCalls: 0,
    imageCalls: 0,
    lazyCalls: 0,
    repairs: 0,
    rendered: [] as Assets[],
    beforeResolve: async () => {},
    beforeFocus: async () => {},
  };
  const editor = {
    getValue: () => state.content,
    isComposing: () => state.composing,
    setImageAssets: (assets: Assets) => state.rendered.push(assets),
  };
  const save = {
    get dirty() {
      return state.dirty;
    },
    get writing() {
      return state.writing;
    },
  };
  const common = {
    documentSyncRegistry: {
      hasLocalWork: (itemID: number) => {
        assert.equal(itemID, item.id);
        return state.peerLocalWork;
      },
      refreshOnFocus: async () => {
        state.focusCalls++;
        await state.beforeFocus();
        return state.focusResult;
      },
    },
    resolveImageAssets: async (
      actualItem: unknown,
      source: string,
      shouldRepair: () => boolean,
    ) => {
      assert.equal(actualItem, item);
      assert.equal(source, original);
      state.imageCalls++;
      await state.beforeResolve();
      if (shouldRepair()) state.repairs++;
      return { "assets/figure.png": { dataURL: "data:image/png;base64,test" } };
    },
    resolveImageAssetEntry: async (
      actualItem: unknown,
      reference: string,
      context: { markdown: string; shouldProceed(): boolean },
    ) => {
      assert.equal(actualItem, item);
      assert.equal(reference, "assets/figure.png");
      assert.equal(context.markdown, original);
      state.lazyCalls++;
      await state.beforeResolve();
      if (context.shouldProceed()) state.repairs++;
      return { dataURL: "data:image/png;base64,test" };
    },
    Zotero: { Items: { get: () => item }, debug() {} },
    ztoolkit: { log() {} },
  };
  const javascript = ts.transpileModule(
    surface === "tab"
      ? `${tabFunctions.join("\n")}\n({ guard: canAutomaticallyRepairImages, refresh: refreshImageAssets, focus: refreshMarkdownSessionOnFocus, lazy(session, content) { return (${lazyImageCallback(tabSource)}); } });`
      : `class ActualSidebar { ${sidebarMethods.join("\n")} lazy(content) { return (${lazyImageCallback(sidebarSource)}); } }\nnew ActualSidebar();`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const actual = runInNewContext(javascript, {
    ...common,
    sessionRegistry: { get: () => (state.current ? current : undefined) },
  }) as {
    guard(session: object, source: string): boolean;
    refresh(session: object): Promise<void>;
    focus(session: object): Promise<void>;
    canAutomaticallyRepairImages(item: object, source: string): boolean;
    refreshImages(item: object, source: string): Promise<void>;
    refreshFromDocumentSync(): Promise<void>;
    lazy(...args: unknown[]): (reference: string) => Promise<unknown>;
  };
  const current = surface === "tab" ? {} : actual;
  Object.defineProperties(current, {
    editor: { get: () => (state.hasEditor ? editor : undefined) },
    save: { get: () => (state.hasSave ? save : null) },
    closing: { get: () => state.closed },
    destroyed: { get: () => state.closed },
    itemID: { get: () => (state.current ? item.id : 8) },
  });
  Object.assign(current, {
    item,
    tabID: "auto-repair-note",
    documentSyncSourceID: `${surface}-source`,
    isActive: () => state.active,
    editorHost: { hidden: false },
    root: { isConnected: true },
    focusSuppressed: false,
    mode: "live",
  });
  return {
    state,
    guard: () =>
      surface === "tab"
        ? actual.guard(current, original)
        : actual.canAutomaticallyRepairImages(item, original),
    refresh: () =>
      surface === "tab"
        ? actual.refresh(current)
        : actual.refreshImages(item, original),
    focus: () =>
      surface === "tab"
        ? actual.focus(current)
        : actual.refreshFromDocumentSync(),
    lazy: () =>
      (surface === "tab"
        ? actual.lazy(current, original)
        : actual.lazy(original))("assets/figure.png"),
  };
}

for (const surface of ["tab", "sidebar"] as const) {
  test(`${surface}: a current clean document permits automatic image recovery`, async () => {
    const f = fixture(surface);
    assert.equal(f.guard(), true);
    await f.refresh();
    assert.equal(f.state.repairs, 1);
    assert.equal(f.state.rendered.length, 1);
  });

  for (const blocked of [
    "dirty",
    "writing",
    "composing",
    "peerLocalWork",
    "closed",
  ] as const) {
    test(`${surface}: ${blocked} beginning during image I/O cancels automatic repair`, async () => {
      const f = fixture(surface);
      const release = deferred();
      f.state.beforeResolve = () => release.promise;
      const resolving = f.refresh();
      assert.equal(f.state.imageCalls, 1);
      f.state[blocked] = true;
      assert.equal(f.guard(), false);
      release.resolve();
      await resolving;
      assert.equal(f.state.repairs, 0);
    });
  }

  test(`${surface}: switching or closing a document invalidates delayed image recovery`, async () => {
    for (const invalidation of [
      "switched",
      "edited",
      "editor-removed",
    ] as const) {
      const f = fixture(surface);
      const release = deferred();
      f.state.beforeResolve = () => release.promise;
      const resolving = f.refresh();
      if (invalidation === "switched") f.state.current = false;
      else if (invalidation === "edited") f.state.content += "\nnew text";
      else f.state.hasEditor = false;
      assert.equal(f.guard(), false);
      release.resolve();
      await resolving;
      assert.equal(f.state.repairs, 0);
      assert.equal(f.state.rendered.length, 0);
    }
  });

  test(`${surface}: lazy image loading supplies Markdown context and a live repair guard`, async () => {
    const clean = fixture(surface);
    await clean.lazy();
    assert.equal(clean.state.lazyCalls, 1);
    assert.equal(clean.state.repairs, 1);
    for (const change of ["dirty", "composing", "content"] as const) {
      const f = fixture(surface);
      const release = deferred();
      f.state.beforeResolve = () => release.promise;
      const loading = f.lazy();
      assert.equal(f.state.lazyCalls, 1);
      if (change === "content") f.state.content += "\nnew content";
      else f.state[change] = true;
      release.resolve();
      await loading;
      assert.equal(f.state.repairs, 0, change);
    }
  });

  test(`${surface}: focus retries images downloaded separately from unchanged Markdown`, async () => {
    const f = fixture(surface);
    await f.focus();
    await nextTurn();
    assert.equal(f.state.focusCalls, 1);
    assert.equal(f.state.imageCalls, 1);
    assert.equal(f.state.repairs, 1);
    await f.focus();
    await nextTurn();
    assert.equal(
      f.state.imageCalls,
      2,
      "a previous unchanged result must not suppress a later download retry",
    );
  });

  test(`${surface}: edits or composition during focus refresh prevent its repair retry`, async () => {
    for (const blocked of [
      "dirty",
      "writing",
      "composing",
      "peerLocalWork",
      "closed",
    ] as const) {
      const f = fixture(surface);
      const release = deferred();
      f.state.beforeFocus = () => release.promise;
      const refreshing = f.focus();
      f.state[blocked] = true;
      release.resolve();
      await refreshing;
      await nextTurn();
      assert.equal(f.state.imageCalls, 0, blocked);
      assert.equal(f.state.repairs, 0, blocked);
    }
  });

  test(`${surface}: blocked peer refresh does not start automatic image repair`, async () => {
    const f = fixture(surface);
    f.state.focusResult = "blocked-peer-dirty";
    await f.focus();
    await nextTurn();
    assert.equal(f.state.imageCalls, 0);
  });

  test(`${surface}: duplicate focus events share the same pending retry`, async () => {
    const f = fixture(surface);
    const release = deferred();
    f.state.beforeFocus = () => release.promise;
    const first = f.focus();
    assert.equal(f.focus(), first);
    assert.equal(f.state.focusCalls, 1);
    release.resolve();
    await first;
    await nextTurn();
    assert.equal(f.state.imageCalls, 1);
  });
}
