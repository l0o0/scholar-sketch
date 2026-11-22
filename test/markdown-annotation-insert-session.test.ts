import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";
import {
  createFakeZotero,
  type FakeItem,
} from "../packages/fake-zotero/dist/index.js";
import { insertSessionAnnotations } from "../src/modules/markdown/annotation-insert-session.ts";
import {
  sessionRegistry,
  type OpenSession,
} from "../src/modules/markdown/session-registry.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let sequence = 0;

function fixture(t: TestContext) {
  const fake = createFakeZotero({
    items: [
      {
        id: 1,
        key: "PAPER001",
        itemType: "journalArticle",
        fields: { title: "Research paper" },
      },
      {
        id: 2,
        key: "PDF00002",
        itemType: "attachment",
        parentID: 1,
        attachmentContentType: "application/pdf",
        fields: { title: "Full text" },
      },
      {
        id: 3,
        key: "NOTE0003",
        itemType: "attachment",
        parentID: 1,
        attachmentContentType: "text/markdown",
        fields: { title: "Reading note" },
      },
      {
        id: 4,
        key: "ANNO0004",
        itemType: "annotation",
        parentID: 2,
        annotationType: "highlight",
        annotationText: "Selected passage",
        annotationComment: "Review this",
        annotationPageLabel: "153",
        annotationPosition: '{"pageIndex":1}',
      },
    ],
  });
  for (const id of [1, 2, 3, 4])
    Object.assign(fake.Zotero.Items.get(id)!, { isEditable: () => true });

  let readGate:
    | {
        entered: ReturnType<typeof deferred<void>>;
        done: ReturnType<typeof deferred<void>>;
      }
    | undefined;
  const releasePending: Array<() => void> = [];
  Object.assign(fake.Zotero.Items, {
    loadDataTypes: async (_items: FakeItem[], types: string[]) => {
      if (!readGate || !types.includes("annotationDeferred")) return;
      const pending = readGate;
      readGate = undefined;
      pending.entered.resolve();
      await pending.done.promise;
    },
  });
  const restore = fake.install(globalThis);
  const win = new Window();
  const state = {
    content: "# Current draft",
    insertions: [] as Array<{ markdown: string; expectedValue: string }>,
    focused: 0,
  };
  let snapshotGate:
    | {
        entered: ReturnType<typeof deferred<void>>;
        done: ReturnType<typeof deferred<string>>;
      }
    | undefined;
  const editor = {
    isComposing: () => false,
    requestSnapshot: async () => {
      if (!snapshotGate) return state.content;
      const pending = snapshotGate;
      snapshotGate = undefined;
      pending.entered.resolve();
      return pending.done.promise;
    },
    insertPdfQuotation: (markdown: string, expectedValue: string) => {
      if (state.content !== expectedValue) return false;
      state.insertions.push({ markdown, expectedValue });
      state.content += `\n\n${markdown}`;
      return true;
    },
    focus: () => {
      state.focused++;
    },
  };
  const session = {
    tabID: `annotation-insert-${++sequence}`,
    surface: "tab",
    itemID: 3,
    win: win as unknown as globalThis.Window,
    isActive: () => true,
    editor,
  } as OpenSession;
  sessionRegistry.register(session);
  t.after(() => {
    sessionRegistry.unregister(session.tabID);
    for (const release of releasePending) release();
    win.close();
    restore();
  });
  const query = <T extends HTMLElement>(selector: string) => {
    const node = win.document.querySelector<T>(selector);
    assert.ok(node, selector);
    return node;
  };
  const action = (name: string) =>
    query<HTMLButtonElement>(`[data-action="${name}"]`);
  const open = async () => {
    await insertSessionAnnotations(session, () => true);
    await setImmediate();
    assert.equal(win.document.querySelectorAll("dialog").length, 1);
    assert.equal(
      win.document.querySelectorAll(".ss-annotation-card").length,
      1,
    );
    action("select-results").click();
    assert.equal(action("insert").disabled, false);
  };
  const closeSession = () => {
    session.closing = true;
    sessionRegistry.unregister(session.tabID);
  };
  const blockRead = () => {
    const pending = { entered: deferred<void>(), done: deferred<void>() };
    readGate = pending;
    const release = () => pending.done.resolve();
    releasePending.push(release);
    return { entered: pending.entered.promise, release };
  };
  const blockSnapshot = () => {
    const pending = { entered: deferred<void>(), done: deferred<string>() };
    snapshotGate = pending;
    const release = () => pending.done.resolve(state.content);
    releasePending.push(release);
    return { entered: pending.entered.promise, release };
  };
  return {
    fake,
    win,
    session,
    state,
    query,
    action,
    open,
    closeSession,
    blockRead,
    blockSnapshot,
  };
}

test("the session inserts selected native annotations once and permits reopening the picker", async (t) => {
  const f = fixture(t);
  await f.open();
  await insertSessionAnnotations(f.session, () => true);
  assert.equal(f.win.document.querySelectorAll("dialog").length, 1);
  f.action("insert").click();
  f.action("insert").click();
  await setImmediate();
  assert.deepEqual(f.state.insertions, [
    {
      markdown:
        "> Selected passage\n\nReview this\n\n[153](zotero://open-pdf/library/items/PDF00002?page=2&annotation=ANNO0004)\n",
      expectedValue: "# Current draft",
    },
  ]);
  assert.equal(f.win.document.querySelector("dialog"), null);
  assert.equal(f.session.closeAnnotationInsert, undefined);
  assert.equal(f.state.focused, 1);
  await f.open();
  f.query<HTMLButtonElement>(".ss-annotation-close").click();
  assert.equal(f.win.document.querySelector("dialog"), null);
  assert.equal(f.session.closeAnnotationInsert, undefined);
  assert.equal(f.state.insertions.length, 1);
});

test("a changed document rejects insertion without replacing its new content or closing the picker", async (t) => {
  const f = fixture(t);
  await f.open();
  f.state.content = "# Edited while choosing annotations";
  f.action("insert").click();
  await setImmediate();
  assert.equal(f.state.insertions.length, 0);
  assert.equal(f.state.content, "# Edited while choosing annotations");
  assert.match(
    f.query(".ss-annotation-error").textContent!,
    /markdown-annotation-document-changed/,
  );
  assert.equal(f.query<HTMLDialogElement>("dialog").open, true);
  assert.equal(f.action("insert").disabled, false);
});

test("changed source text is reread and rejected instead of inserting the stale preview", async (t) => {
  const f = fixture(t);
  await f.open();
  f.fake.Zotero.Items.get(4)!.annotationText = "Updated native passage";
  f.action("insert").click();
  await setImmediate();
  assert.equal(f.state.insertions.length, 0);
  assert.equal(f.state.content, "# Current draft");
  assert.match(
    f.query(".ss-annotation-error").textContent!,
    /markdown-annotation-source-changed/,
  );
  assert.equal(f.query<HTMLDialogElement>("dialog").open, true);
});

test("closing a session during its initial snapshot prevents a late picker and clears ownership", async (t) => {
  const f = fixture(t);
  const pending = f.blockSnapshot();
  const opening = insertSessionAnnotations(f.session, () => true);
  await pending.entered;
  f.closeSession();
  assert.equal(f.session.closeAnnotationInsert, undefined);
  assert.equal(sessionRegistry.get(f.session.tabID), undefined);
  pending.release();
  await opening;
  assert.equal(f.win.document.querySelector("dialog"), null);
  assert.equal(f.state.insertions.length, 0);
  assert.equal(f.state.focused, 0);
});

test("closing a session during the source reread removes the picker and discards the late insertion", async (t) => {
  const f = fixture(t);
  await f.open();
  const pending = f.blockRead();
  f.action("insert").click();
  await pending.entered;
  f.closeSession();
  assert.equal(f.win.document.querySelector("dialog"), null);
  assert.equal(f.session.closeAnnotationInsert, undefined);
  assert.equal(sessionRegistry.get(f.session.tabID), undefined);
  pending.release();
  await setImmediate();
  assert.equal(f.state.insertions.length, 0);
  assert.equal(f.state.content, "# Current draft");
  assert.equal(f.state.focused, 0);
  assert.equal(f.win.document.querySelector("dialog"), null);
});
