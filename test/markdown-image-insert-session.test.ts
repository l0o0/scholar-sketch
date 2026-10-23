import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function source(name: string) {
  return ts.createSourceFile(
    name,
    readFileSync(
      new URL(`../src/modules/markdown/${name}.ts`, import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.ES2022,
    true,
  );
}
const tab = source("tab");
const sidebar = source("sidebar");
function tabFunction(name: string) {
  const node = tab.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(node);
  return node.getText(tab);
}
const controllerClass = sidebar.statements.find(
  (node) =>
    ts.isClassDeclaration(node) && node.name?.text === "SidebarController",
);
assert.ok(controllerClass && ts.isClassDeclaration(controllerClass));
const insertMethod = controllerClass.members.find(
  (node) =>
    ts.isMethodDeclaration(node) &&
    node.name.getText(sidebar) === "insertImage",
);
assert.ok(insertMethod);
function pasteCallback(tree: ts.SourceFile) {
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(tree) === "onPasteImage"
    )
      callback = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(callback);
  return callback.getText(tree);
}
const transpile = (code: string) =>
  ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;

function fixture(surface: "tab" | "sidebar") {
  const inserted: string[] = [];
  const assets: unknown[] = [];
  const errors: unknown[] = [];
  const state = {
    editable: true,
    composing: false,
    current: true,
    writes: 0,
    picks: 0,
    beforeWrite: async () => {},
    beforeResolve: async () => {},
  };
  const item = {
    id: 7,
    isEditable: () => state.editable,
    isStoredFileAttachment: () => true,
  };
  const editor = {
    isComposing: () => state.composing,
    insertText: (text: string) => inserted.push(text),
    setImageAssets: (value: unknown, replace: boolean) => {
      assert.equal(replace, false);
      assets.push(value);
    },
    importImage: () => {
      state.picks++;
    },
  };
  const session = {
    tabID: "note",
    itemID: 7,
    editor,
    closing: false,
    pendingImageSave: false,
  };
  const context = {
    Zotero: { Items: { get: (id: number) => (id === 7 ? item : undefined) } },
    addon: { data: { config: { addonName: "Scholar Sketch" } } },
    ztoolkit: {
      log() {},
      ProgressWindow: class {
        createLine({ text }: { text: string }) {
          errors.push(text);
          return this;
        }
        show() {}
      },
    },
    getString: (key: string) => key,
    writeImageAsset: async (
      target: unknown,
      bytes: Uint8Array,
      mimeType: string,
    ) => {
      assert.equal(target, item);
      assert.equal(bytes[0], 42);
      assert.equal(mimeType, "image/png");
      state.writes++;
      await state.beforeWrite();
      return "assets/local.png";
    },
    resolveImageAssetEntry: async (target: unknown, reference: string) => {
      assert.equal(target, item);
      assert.equal(reference, "assets/local.png");
      await state.beforeResolve();
      return { dataUrl: "data:image/png;base64,AA==" };
    },
    showImageError: (error: unknown) => errors.push(error),
    session,
    sessionRegistry: { get: () => (state.current ? session : undefined) },
    readOnlySessions: new WeakSet(),
  };
  const payload = {
    bytes: new Uint8Array([42]).buffer,
    mimeType: "image/png",
    name: "local.png",
  };
  if (surface === "tab") {
    const callbacks = runInNewContext(
      transpile(
        `${tabFunction("insertImageBytes")}\n${tabFunction("chooseAndInsertImage")}\n({ paste: ${pasteCallback(tab)}, choose: () => chooseAndInsertImage(session) });`,
      ),
      context,
    );
    return {
      state,
      session,
      inserted,
      assets,
      errors,
      receive: () => callbacks.paste(payload),
      choose: callbacks.choose,
      controller: null,
    };
  }
  const controller = runInNewContext(
    transpile(`new class {
    ${insertMethod.getText(sidebar)}
    receive(payload) { return (${pasteCallback(sidebar)})(payload); }
  }`),
    context,
  );
  Object.assign(controller, {
    renderSeq: 1,
    itemID: 7,
    editor,
    destroyed: false,
    editable: true,
    editorHost: { hidden: false },
  });
  return {
    state,
    session,
    inserted,
    assets,
    errors,
    receive: () => controller.receive(payload),
    choose: () => {},
    controller,
  };
}

for (const surface of ["tab", "sidebar"] as const) {
  test(`${surface}: the actual image callback writes once and inserts its saved relative path`, async () => {
    const f = fixture(surface);
    await f.receive();
    assert.equal(f.state.writes, 1);
    assert.deepEqual(f.inserted, ["![](assets/local.png)"]);
    assert.equal(f.assets.length, 1);
    assert.equal(f.errors.length, 0);
    if (surface === "tab") assert.equal(f.session.pendingImageSave, true);
  });

  test(`${surface}: closing or replacing the editor during image writing cannot insert into another document`, async () => {
    for (const transition of ["close", "replace"] as const) {
      const f = fixture(surface);
      f.state.beforeWrite = async () => {
        if (f.controller) {
          if (transition === "close") f.controller.destroyed = true;
          else {
            f.controller.renderSeq++;
            f.controller.itemID = 8;
          }
        } else if (transition === "close") f.session.closing = true;
        else f.state.current = false;
      };
      await f.receive();
      assert.equal(f.state.writes, 1);
      assert.deepEqual(f.inserted, []);
      assert.deepEqual(f.assets, []);
    }
  });

  test(`${surface}: permission changes and composition prevent image mutation`, async () => {
    const f = fixture(surface);
    f.state.editable = false;
    await f.receive();
    assert.equal(f.state.writes, 0);
    f.state.editable = true;
    f.state.composing = true;
    await f.receive();
    assert.equal(f.state.writes, 0);
    f.state.composing = false;
    f.state.beforeWrite = async () => {
      f.state.editable = false;
    };
    await f.receive();
    assert.deepEqual(f.inserted, []);
  });

  test(`${surface}: late asset previews never reach a replaced editor`, async () => {
    const f = fixture(surface);
    f.state.beforeResolve = async () => {
      if (f.controller) f.controller.editor = {};
      else f.session.editor = {} as typeof f.session.editor;
    };
    await f.receive();
    assert.equal(f.inserted.length, 1);
    assert.deepEqual(f.assets, []);
  });

  test(`${surface}: a failed image write reports failure and inserts nothing`, async () => {
    const f = fixture(surface);
    f.state.beforeWrite = async () => {
      throw new Error("Disk full");
    };
    await f.receive();
    assert.deepEqual(f.inserted, []);
    assert.equal(f.errors.length, 1);
  });
}

test("the toolbar shares the editor-owned local picker", () => {
  const f = fixture("tab");
  f.choose();
  assert.equal(f.state.picks, 1);
  assert.equal(f.state.writes, 0);
});

test("a sidebar switching documents refuses a late picker callback while flushing the previous note", async () => {
  const f = fixture("sidebar");
  f.controller!.editorHost.hidden = true;
  await f.receive();
  assert.equal(f.state.writes, 0);
  assert.deepEqual(f.inserted, []);
});
