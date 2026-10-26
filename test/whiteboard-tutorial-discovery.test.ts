import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  findTutorialAttachment,
  markTutorialAttachment,
  resolveTutorialAttachment,
} from "../src/modules/whiteboard/tutorial-discovery.ts";

interface Tag {
  tag: string;
  type: number;
}

function attachment(
  id: number,
  title: string,
  filename: string,
  tags: Tag[] = [],
) {
  const item = {
    id,
    key: `ABCDEF${id}${id}`,
    title,
    libraryID: 1,
    deleted: false,
    attachmentFilename: filename,
    attachmentContentType: "",
    attachmentLinkMode: 0,
    tags,
    tagsLoaded: false,
    saves: 0,
    isAttachment: () => true,
    getFilePathAsync: async () => {
      throw new Error("Discovery must not inspect the local file");
    },
    hasTag(tag: string) {
      assert.ok(item.tagsLoaded, "tags must be loaded before access");
      return item.tags.some((value) => value.tag === tag);
    },
    addTag(tag: string, type: number) {
      assert.ok(item.tagsLoaded, "tags must be loaded before mutation");
      item.tags.push({ tag, type });
      return true;
    },
    async saveTx(options: { skipSelect: boolean }) {
      assert.deepEqual(options, { skipSelect: true });
      item.saves += 1;
      return true;
    },
  };
  return item;
}

type FakeItem = ReturnType<typeof attachment>;
type Condition = [string, string, string | undefined];

function host(t: TestContext, items: FakeItem[]) {
  const queries: Condition[][] = [];
  let searchError: Error | undefined;
  let loadError: Error | undefined;
  class Search {
    conditions: Condition[] = [];
    constructor(readonly options: { libraryID: number }) {
      assert.equal(options.libraryID, 1);
      queries.push(this.conditions);
    }
    addCondition(name: string, operator: string, value?: string) {
      this.conditions.push([name, operator, value]);
    }
    async search() {
      if (searchError) throw searchError;
      return items
        .filter(
          (item) =>
            item.libraryID === this.options.libraryID &&
            this.conditions.every(([name, operator, value]) => {
              if (name === "deleted")
                return operator === "false" && !item.deleted;
              assert.equal(operator, "is");
              if (name === "itemType") {
                assert.equal(value, "attachment");
                return item.isAttachment();
              }
              if (name === "title") return item.title === value;
              assert.equal(name, "tag");
              return item.tags.some((tag) => tag.tag === value);
            }),
        )
        .map((item) => item.id);
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Search,
      Libraries: { userLibraryID: 1 },
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      Utilities: {
        isValidObjectKey: (key: string) => /^[A-Z0-9]{8}$/.test(key),
      },
      Items: {
        async getAsync(ids: number[]) {
          if (loadError) throw loadError;
          return items.filter((item) => ids.includes(item.id));
        },
        async getByLibraryAndKeyAsync(libraryID: number, key: string) {
          if (loadError) throw loadError;
          assert.equal(libraryID, 1);
          return (
            items.find(
              (item) => item.libraryID === libraryID && item.key === key,
            ) ?? false
          );
        },
        async loadDataTypes(values: FakeItem[], types: string[]) {
          assert.deepEqual(types, ["tags"]);
          for (const item of values) item.tagsLoaded = true;
        },
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Zotero", previous);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  return {
    queries,
    failSearch(error: Error) {
      searchError = error;
    },
    failLoad(error: Error) {
      loadError = error;
    },
  };
}

test("a renamed tagged tutorial takes priority over older same-title attachments", async (t) => {
  const titled = attachment(2, "开始写作.md", "note.md");
  const tagged = attachment(9, "我的练习笔记", "renamed.md", [
    { tag: "scholar-sketch:tutorial:markdown", type: 1 },
  ]);
  const fixture = host(t, [titled, tagged]);
  assert.equal(
    await findTutorialAttachment("markdown", ["开始写作.md"]),
    tagged,
  );
  assert.equal(fixture.queries.length, 1);
  assert.deepEqual(fixture.queries[0], [
    ["itemType", "is", "attachment"],
    ["deleted", "false", undefined],
    ["tag", "is", "scholar-sketch:tutorial:markdown"],
  ]);
});

test("legacy localized and extensionless titles choose the earliest matching attachment", async (t) => {
  const english = attachment(4, "Start writing", "Note-20261021.md");
  const chinese = attachment(8, "开始写作.md", "Note-20261020.md");
  const similar = attachment(1, "Start writing later", "note.md");
  host(t, [chinese, similar, english]);
  assert.equal(
    await findTutorialAttachment("markdown", [
      "开始写作.md",
      "Start writing.md",
    ]),
    english,
  );
});

test("tutorial identity is separate for Markdown and Canvas and uses real attachment detection", async (t) => {
  const wrongFile = attachment(1, "wrong", "paper.pdf", [
    { tag: "scholar-sketch:tutorial:canvas", type: 1 },
  ]);
  const board = attachment(3, "Renamed board", "board.CANVAS", [
    { tag: "scholar-sketch:tutorial:canvas", type: 1 },
  ]);
  const markdown = attachment(2, "Renamed note", "note.txt", [
    { tag: "scholar-sketch:tutorial:markdown", type: 1 },
  ]);
  markdown.attachmentContentType = "text/markdown";
  host(t, [wrongFile, board, markdown]);
  assert.equal(await findTutorialAttachment("canvas", []), board);
  assert.equal(await findTutorialAttachment("markdown", []), markdown);
});

test("legacy Canvas titles are reusable without reading their not-yet-downloaded files", async (t) => {
  const item = attachment(
    5,
    "Bamboo 学术白板.canvas",
    "Bamboo 学术白板.canvas",
  );
  host(t, [item]);
  assert.equal(
    await findTutorialAttachment("canvas", [
      "Scholar Sketch 学术白板.canvas",
      "Scholar Canvas 学术白板.canvas",
      "Bamboo 学术白板.canvas",
    ]),
    item,
  );
});

test("deleted, other-library, non-attachment, URL, and wrong-file matches are excluded", async (t) => {
  const deleted = attachment(1, "开始写作.md", "note.md");
  deleted.deleted = true;
  const foreign = attachment(2, "开始写作.md", "note.md");
  foreign.libraryID = 2;
  const regular = attachment(3, "开始写作.md", "note.md");
  regular.isAttachment = () => false;
  const url = attachment(4, "开始写作.md", "note.md");
  url.attachmentLinkMode = 3;
  const pdf = attachment(5, "开始写作.md", "paper.pdf");
  host(t, [deleted, foreign, regular, url, pdf]);
  assert.equal(await findTutorialAttachment("markdown", ["开始写作.md"]), null);
});

test("the earliest tagged attachment is deterministic when prior duplicates exist", async (t) => {
  const older = attachment(2, "Old", "old.canvas", [
    { tag: "scholar-sketch:tutorial:canvas", type: 1 },
  ]);
  const newer = attachment(9, "New", "new.canvas", [...older.tags]);
  host(t, [newer, older]);
  assert.equal(await findTutorialAttachment("canvas", []), older);
});

test("search and item-loading failures propagate instead of permitting duplicate creation", async (t) => {
  const item = attachment(2, "Start writing.md", "note.md");
  const fixture = host(t, [item]);
  const searchError = new Error("search unavailable");
  fixture.failSearch(searchError);
  await assert.rejects(findTutorialAttachment("markdown", []), searchError);
});

test("failure loading a search match is not treated as an absent tutorial", async (t) => {
  const item = attachment(2, "Start writing.md", "note.md");
  const fixture = host(t, [item]);
  const loadError = new Error("item unavailable");
  fixture.failLoad(loadError);
  await assert.rejects(
    findTutorialAttachment("markdown", ["Start writing.md"]),
    loadError,
  );
});

test("marking loads tags, preserves user tags, and saves the searchable marker only once", async (t) => {
  const item = attachment(2, "Start writing.md", "note.md", [
    { tag: "My research", type: 0 },
  ]);
  host(t, [item]);
  await markTutorialAttachment(item as unknown as Zotero.Item, "markdown");
  await markTutorialAttachment(item as unknown as Zotero.Item, "markdown");
  assert.deepEqual(item.tags, [
    { tag: "My research", type: 0 },
    { tag: "scholar-sketch:tutorial:markdown", type: 1 },
  ]);
  assert.equal(item.saves, 1);
  item.title = "Renamed by user";
  assert.equal(await findTutorialAttachment("markdown", []), item);
});

test("an existing manual identity tag is preserved without an unnecessary save", async (t) => {
  const item = attachment(2, "board", "board.canvas", [
    { tag: "scholar-sketch:tutorial:canvas", type: 0 },
  ]);
  host(t, [item]);
  await markTutorialAttachment(item as unknown as Zotero.Item, "canvas");
  assert.equal(item.tags[0].type, 0);
  assert.equal(item.saves, 0);
});

test("identity persistence failure propagates to the tutorial workflow", async (t) => {
  const item = attachment(2, "note", "note.md");
  host(t, [item]);
  const failure = new Error("save failed");
  item.saveTx = async () => {
    throw failure;
  };
  await assert.rejects(
    markTutorialAttachment(item as unknown as Zotero.Item, "markdown"),
    failure,
  );
});

test("a portable Canvas link resolves renamed Markdown without reading its file", async (t) => {
  const item = attachment(2, "Renamed reading practice", "my-practice.md");
  host(t, [item]);
  assert.equal(await resolveTutorialAttachment("markdown", item.key), item);
});

test("portable resolution rejects invalid keys and propagates lookup failures", async (t) => {
  const item = attachment(2, "note", "note.md");
  const fixture = host(t, [item]);
  await assert.rejects(
    resolveTutorialAttachment("markdown", "../../note.md"),
    /Invalid/,
  );
  const failure = new Error("item lookup unavailable");
  fixture.failLoad(failure);
  await assert.rejects(
    resolveTutorialAttachment("markdown", item.key),
    failure,
  );
});

test("portable resolution excludes deleted and other-library items, wrong types and web links", async (t) => {
  const deleted = attachment(2, "note", "note.md");
  deleted.deleted = true;
  const foreign = attachment(3, "note", "note.md");
  foreign.libraryID = 2;
  const regular = attachment(4, "note", "note.md");
  regular.isAttachment = () => false;
  const url = attachment(5, "note", "note.md");
  url.attachmentLinkMode = 3;
  const pdf = attachment(6, "note", "paper.pdf");
  const items = [deleted, foreign, regular, url, pdf];
  host(t, items);
  for (const item of items) {
    assert.equal(await resolveTutorialAttachment("markdown", item.key), null);
  }
  assert.equal(await resolveTutorialAttachment("markdown", "ABSENT23"), null);
});

for (const kind of ["markdown", "canvas"] as const) {
  test(`saved ${kind} identities resolve from metadata and reject the other type`, async (t) => {
    const item = attachment(
      2,
      "Renamed guide",
      `guide.${kind === "markdown" ? "md" : "canvas"}`,
    );
    host(t, [item]);
    assert.equal(await resolveTutorialAttachment(kind, item.key), item);
    assert.equal(
      await resolveTutorialAttachment(
        kind === "markdown" ? "canvas" : "markdown",
        item.key,
      ),
      null,
    );
  });
}
