import assert from "node:assert/strict";
import test from "node:test";
import {
  searchDocumentLinks,
  openDocumentLink,
} from "../src/modules/markdown/document-links.ts";

test("PDF links dispatch through the owning Zotero pane without leaving the process", async (t) => {
  const globals = globalThis as any;
  const previous = globals.Zotero;
  t.after(() => {
    globals.Zotero = previous;
  });
  const external: string[] = [];
  const dispatched: string[] = [];
  const ownerPane = {
    loadURI(href: string) {
      assert.equal(this, ownerPane);
      dispatched.push(href);
    },
  };
  globals.Zotero = {
    launchURL: (href: string) => external.push(href),
    getMainWindow: () => {
      throw new Error("an owning pane must take precedence");
    },
  };
  const pdf = "zotero://open-pdf/library/items/J3QEKE7G?page=2";
  const result = await openDocumentLink(pdf, {
    win: { ZoteroPane: ownerPane } as unknown as Window,
  });
  assert.deepEqual(result, { status: "dispatched" });
  assert.deepEqual(dispatched, [pdf]);
  assert.deepEqual(external, [], "internal PDF links must never reach the OS");

  const mainPane = {
    loadURI(href: string) {
      assert.equal(this, mainPane);
      dispatched.push(href);
    },
  };
  globals.Zotero.getMainWindow = () => ({ ZoteroPane: mainPane });
  const groupPDF =
    "zotero://open-pdf/groups/42/items/J3QEKE7G?page=7&annotation=ANNO0001";
  assert.deepEqual(await openDocumentLink(groupPDF, { win: {} as Window }), {
    status: "dispatched",
  });
  assert.deepEqual(dispatched, [pdf, groupPDF]);
  assert.deepEqual(external, []);

  assert.deepEqual(await openDocumentLink(" https://example.com/paper "), {
    status: "external",
  });
  assert.deepEqual(await openDocumentLink("mailto:author@example.com"), {
    status: "external",
  });
  assert.deepEqual(external, [
    "https://example.com/paper",
    "mailto:author@example.com",
  ]);
});

test("PDF dispatch fails without a native pane and never falls back to an external launch", async (t) => {
  const globals = globalThis as any;
  const previous = globals.Zotero;
  t.after(() => {
    globals.Zotero = previous;
  });
  const external: string[] = [];
  globals.Zotero = {
    launchURL: (href: string) => external.push(href),
    getMainWindow: () => undefined,
  };
  const pdf = "zotero://open-pdf/library/items/J3QEKE7G?page=2";
  assert.deepEqual(await openDocumentLink(pdf), { status: "unsupported" });
  assert.deepEqual(
    await openDocumentLink(pdf, {
      win: {
        ZoteroPane: {
          loadURI() {
            throw new Error("native protocol unavailable");
          },
        },
      } as unknown as Window,
    }),
    { status: "unsupported" },
  );
  assert.deepEqual(external, []);
});

test("document links query only host metadata and preserve library identity", async (t) => {
  const globals = globalThis as any;
  const previous = globals.Zotero;
  t.after(() => {
    globals.Zotero = previous;
  });
  const item = (
    id: number,
    title: string,
    kind = "regular",
    libraryID = 1,
  ) => ({
    id,
    key: `KEY${String(id).padStart(5, "0")}`,
    libraryID,
    attachmentFilename:
      kind === "markdown"
        ? "zmd-source.md"
        : kind === "canvas"
          ? "source.canvas"
          : "source.pdf",
    attachmentLinkMode: 0,
    isAttachment: () => kind !== "regular",
    isRegularItem: () => kind === "regular",
    isTrashed: () => false,
    getField: () => title,
    getDisplayTitle: () => Promise.resolve(title),
    getFilePathAsync: () => {
      throw new Error("must not read attachment files");
    },
  });
  let records: ReturnType<typeof item>[] = [];
  const batches: number[][] = [];
  const conditions: unknown[][] = [];
  let queryLibrary: number | undefined;
  let knownGroup = true;
  globals.Zotero = {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Libraries: {
      userLibraryID: 1,
      get: (id: number) =>
        id === 7 && knownGroup
          ? { libraryType: "group", groupID: 42 }
          : undefined,
    },
    Search: class {
      constructor(options: { libraryID: number }) {
        queryLibrary = options.libraryID;
      }
      addCondition(...args: unknown[]) {
        conditions.push(args);
      }
      async search() {
        return records.map(({ id }) => id);
      }
    },
    Items: {
      get() {
        throw new Error("unloaded items must be loaded asynchronously");
      },
      async getAsync(ids: number[]) {
        batches.push(ids);
        return records.filter(({ id }) => ids.includes(id));
      },
    },
  };

  records = [
    item(1, "Paper"),
    item(2, "zmd-Note", "markdown"),
    item(3, "Canvas", "canvas"),
    item(4, "PDF", "pdf"),
    item(5, "Other library", "markdown", 7),
  ];
  const found = await searchDocumentLinks({ libraryID: 1 } as Zotero.Item, "a");
  assert.equal(queryLibrary, 1);
  assert.deepEqual(
    found.map(({ kind }) => kind),
    ["regular", "markdown", "canvas"],
  );
  assert.equal(found[1].title, "Note");
  assert.equal(found[1].href, "source--KEY00002.md");

  records = [item(6, "Group doc", "markdown", 7)];
  assert.equal(
    (await searchDocumentLinks({ libraryID: 7 } as Zotero.Item, "Group"))[0]
      .href,
    "source--KEY00006.md",
  );
  knownGroup = false;
  assert.deepEqual(
    await searchDocumentLinks({ libraryID: 7 } as Zotero.Item, "Group"),
    [],
  );

  records = Array.from({ length: 55 }, (_, index) =>
    item(index + 10, "Noise", "pdf"),
  );
  records.push(item(99, "Target", "markdown"));
  assert.equal(
    (await searchDocumentLinks({ libraryID: 1 } as Zotero.Item, "Target"))[0]
      .key,
    "KEY00099",
  );
  assert.ok(batches.every((batch) => batch.length <= 48));

  records = [item(100, "Exact")];
  await searchDocumentLinks({ libraryID: 1 } as Zotero.Item, "Exact", true);
  assert.ok(
    conditions.some(
      (condition) => condition[0] === "title" && condition[1] === "is",
    ),
  );
  const unresolved = await openDocumentLink("[[Missing]]", {
    currentItem: { libraryID: 1 } as Zotero.Item,
    searchExact: async () => [
      {
        key: "KEY00100",
        libraryID: 1,
        title: "Missing suffix",
        kind: "regular",
        href: "zotero://select/library/items/KEY00100",
      },
    ],
  });
  assert.equal(unresolved.status, "unresolved");
});
