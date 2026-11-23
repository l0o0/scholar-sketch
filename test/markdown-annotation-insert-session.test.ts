import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";
import {
  createFakeZotero,
  type FakeItem,
} from "../packages/fake-zotero/dist/index.js";
import { insertSessionAnnotations } from "../src/modules/markdown/annotation-insert-session.ts";
import { mountRenderedMarkdown } from "../src/modules/markdown/preview-dom.ts";
import { renderMarkdown } from "../src/modules/markdown/preview.ts";
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

function fixture(
  t: TestContext,
  locale = "zh-CN",
  secondPdfStandalone = false,
) {
  const fake = createFakeZotero({
    items: [
      {
        id: 1,
        key: "PAPER001",
        itemType: "journalArticle",
        fields: {
          title: "Research paper",
          firstCreator: locale === "zh-CN" ? "沈 和 苏" : "Smith",
          date: locale === "zh-CN" ? "2017-06-01" : "2020-06-01",
        },
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
        annotationPageLabel: "4",
        annotationPosition: '{"pageIndex":1}',
      },
      {
        id: 6,
        key: "PAPER006",
        itemType: "journalArticle",
        fields: { title: "Other paper" },
      },
      {
        id: 7,
        key: "PDF00007",
        itemType: "attachment",
        parentID: secondPdfStandalone ? undefined : 6,
        attachmentContentType: "application/pdf",
        fields: { title: "Other PDF" },
      },
      {
        id: 8,
        key: "ANNO0008",
        itemType: "annotation",
        parentID: 7,
        annotationType: "highlight",
        annotationText: "Other passage",
        annotationPageLabel: "4",
        annotationPosition: '{"pageIndex":3}',
      },
    ],
  });
  for (const id of [1, 2, 3, 4, 6, 7, 8])
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
  // This fixture extends only the native search boundary absent from Fake Zotero.
  const MetadataSearch = fake.Zotero.Search;
  const messages = new Map(
    Array.from(
      readFileSync(`addon/locale/${locale}/addon.ftl`, "utf8").matchAll(
        /^(markdown-annotation-citation-page) = (.+)$/gm,
      ),
      ([, key, value]) => [`bamboo-${key}`, value],
    ),
  );
  Object.assign(fake.Zotero, {
    ScholarSketch: {
      data: {
        locale: {
          current: {
            formatMessagesSync: ([{ id, args }]: {
              id: string;
              args?: { page: string };
            }[]) => [
              {
                value:
                  messages.get(id)?.replace("{ $page }", args?.page ?? "") ||
                  id,
              },
            ],
          },
        },
      },
    },
    Search: class extends MetadataSearch {
      private extra: Array<[string, string]> = [];
      addCondition(field: string, operator: string, value: string): number {
        if (
          ["annotationText", "annotationComment", "tag", "creator"].includes(
            field,
          )
        ) {
          assert.equal(operator, "contains");
          return this.extra.push([field, value]);
        }
        return super.addCondition(field, operator, value);
      }
      async search() {
        return (await super.search()).filter((id) =>
          this.extra.every(([field, value]) => {
            const item = fake.Zotero.Items.get(id)!;
            const text =
              field === "annotationText"
                ? item.annotationText
                : field === "annotationComment"
                  ? item.annotationComment
                  : field === "tag"
                    ? item
                        .getTags()
                        .map((t) => t.tag)
                        .join(" ")
                    : item.getField("firstCreator");
            return String(text ?? "")
              .toLocaleLowerCase()
              .includes(value.toLocaleLowerCase());
          }),
        );
      }
    },
    DB: { columnQueryAsync: async () => [] },
    Annotations: {
      COLORS: [
        ["general-yellow", "#ffd400"],
        ["general-red", "#ff6666"],
      ],
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
    query<HTMLButtonElement>('[data-source-id="1"]').click();
    await win.happyDOM.waitUntilComplete();
    assert.equal(
      win.document.querySelectorAll(".ss-annotation-card").length,
      1,
    );
    action("select-results").click();
    assert.equal(action("insert").disabled, false);
  };
  const searchQuery = async (value: string) => {
    const search = query<HTMLInputElement>(".ss-annotation-search");
    search.value = value;
    search.dispatchEvent(new win.Event("input"));
    await win.happyDOM.waitUntilComplete();
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
    searchQuery,
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
        "> Selected passage [(沈 和 苏, 2017, 第 4 页)](zotero://open-pdf/library/items/PDF00002?page=2&annotation=ANNO0004)\n\nReview this\n",
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

test("inline English citations render the printed page and retain the physical PDF location", async (t) => {
  const f = fixture(t, "en-US");
  f.fake.Zotero.Items.get(4)!.annotationPageLabel = "iv";
  await f.open();
  f.action("insert").click();
  await setImmediate();
  assert.equal(f.state.insertions.length, 1);
  const readingView = f.win.document.createElement("article");
  mountRenderedMarkdown(
    readingView as unknown as HTMLElement,
    renderMarkdown(f.state.insertions[0].markdown),
  );
  const link = readingView.querySelector("blockquote a");
  assert.equal(link?.textContent, "(Smith, 2020, p. iv)");
  assert.equal(
    link?.getAttribute("href"),
    "zotero://open-pdf/library/items/PDF00002?page=2&annotation=ANNO0004",
  );
});

test("citations follow the last line of a multiline excerpt or a standalone PDF comment", async (t) => {
  const f = fixture(t, "en-US", true);
  Object.assign(f.fake.Zotero.Items.get(4)!, {
    annotationText: "Selected passage\nLast line  \n\n",
    annotationPageLabel: "",
  });
  Object.assign(f.fake.Zotero.Items.get(8)!, {
    annotationText: " \n",
    annotationComment: "Review the passage\nFollow up\n\n",
    annotationPageLabel: "",
    annotationPosition: "{}",
  });
  await insertSessionAnnotations(f.session, () => true);
  await f.searchQuery("passage");
  f.action("select-results").click();
  f.action("insert").click();
  await setImmediate();
  assert.equal(f.state.insertions.length, 1);
  const { markdown } = f.state.insertions[0];
  assert.ok(
    markdown.includes(
      "> Selected passage\n> Last line [(Smith, 2020, p. 2)](zotero://open-pdf/library/items/PDF00002?page=2&annotation=ANNO0004)\n\nReview this",
    ),
  );
  assert.ok(
    markdown.includes(
      "Review the passage\nFollow up [(Other PDF)](zotero://open-pdf/library/items/PDF00007?annotation=ANNO0008)",
    ),
  );
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
    f.query(".ss-annotation-error:not([hidden])").textContent!,
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
    f.query(".ss-annotation-error:not([hidden])").textContent!,
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

test("one picker collects annotations across searches and inserts grouped sources atomically", async (t) => {
  const f = fixture(t);
  await insertSessionAnnotations(f.session, () => true);
  assert.equal(
    f.query<HTMLInputElement>(".ss-annotation-search").disabled,
    false,
  );
  assert.equal(
    f.win.document.querySelectorAll(".ss-annotation-card").length,
    0,
  );
  await f.searchQuery("Selected");
  assert.equal(
    f.win.document.querySelectorAll(".ss-annotation-card").length,
    1,
  );
  f.action("select-results").click();
  await f.searchQuery("Other");
  assert.equal(
    f.win.document.querySelectorAll(".ss-annotation-card").length,
    1,
  );
  f.action("select-results").click();
  f.action("view-selected").click();
  assert.equal(
    f.win.document.querySelectorAll(".ss-annotation-card input:checked").length,
    2,
  );
  f.action("insert").click();
  await setImmediate();
  assert.equal(f.state.insertions.length, 1);
  const markdown = f.state.insertions[0].markdown;
  assert.ok(markdown.includes("### Research paper"));
  assert.ok(markdown.includes("### Other paper"));
  assert.ok(markdown.includes("items/PDF00002?page=2&annotation=ANNO0004"));
  assert.ok(
    markdown.includes(
      "[(Other paper, 第 4 页)](zotero://open-pdf/library/items/PDF00007?page=4&annotation=ANNO0008)",
    ),
  );
  assert.equal(f.win.document.querySelector("dialog"), null);
});

test("a deleted annotation in a mixed selection prevents partial insertion and retains the selection", async (t) => {
  const f = fixture(t);
  await insertSessionAnnotations(f.session, () => true);
  await f.searchQuery("passage");
  f.action("select-results").click();
  f.fake.Zotero.Items.get(8)!.deleted = true;
  f.action("insert").click();
  await setImmediate();
  assert.equal(f.state.insertions.length, 0);
  assert.equal(f.state.content, "# Current draft");
  f.action("view-selected").click();
  assert.equal(
    f.win.document.querySelectorAll(".ss-annotation-card input:checked").length,
    2,
  );
  assert.ok(
    f
      .query(".ss-annotation-error:not([hidden])")
      .textContent!.includes("markdown-annotation-source-changed"),
  );
});

test("opening an original annotation preserves the picker and uses the correct PDF window location", async (t) => {
  const f = fixture(t);
  const opened: unknown[][] = [];
  Object.assign(f.fake.Zotero.Reader, {
    open: async (...args: unknown[]) => {
      opened.push(args);
    },
  });
  await f.open();
  f.query<HTMLButtonElement>(".ss-annotation-location").click();
  await setImmediate();
  assert.deepEqual(opened, [
    [
      2,
      { annotationID: "ANNO0004", pageIndex: 1 },
      { openInWindow: true, allowDuplicate: true },
    ],
  ]);
  assert.equal(f.query<HTMLDialogElement>("dialog").open, true);
  assert.equal(
    f.win.document.querySelectorAll(".ss-annotation-card input:checked").length,
    1,
  );
});
