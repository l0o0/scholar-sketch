import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import type {
  FakeItem,
  FakeItemData,
} from "../packages/fake-zotero/dist/index.js";
import {
  annotationMarkdown,
  annotationMarkdownFragment,
  AnnotationSourceUnavailableError,
  readMarkdownAnnotations,
  readMarkdownAnnotationItems,
  annotationIdentity,
} from "../src/modules/markdown/annotations.ts";
import {
  getInitialAnnotationSources,
  searchAnnotationSources,
} from "../src/modules/markdown/annotation-sources.ts";
import { searchLibraryAnnotations } from "../src/modules/markdown/annotation-search.ts";
import { parsePdfDocumentLink } from "../src/modules/markdown/document-link-shared.ts";

function fixture(t: TestContext, items: FakeItemData[]) {
  const fake = createFakeZotero({
    items,
    libraries: [
      { libraryID: 1, libraryType: "user" },
      { libraryID: 7, libraryType: "group", groupID: 42 },
    ],
  });
  const loaded = new Map<number, Set<string>>();
  Object.assign(fake.Zotero.Items, {
    loadDataTypes: async (records: FakeItem[], types: string[]) => {
      for (const item of records) {
        const state = loaded.get(item.id) ?? new Set<string>();
        for (const type of types) state.add(type);
        loaded.set(item.id, state);
      }
    },
  });
  Object.assign(fake.Zotero.Groups, {
    getGroupIDFromLibraryID: (libraryID: number) =>
      libraryID === 7 ? 42 : false,
  });
  for (const { id } of items) {
    const item = fake.Zotero.Items.get(id)! as FakeItem;
    const requireLoaded = (type: string) =>
      assert.ok(loaded.get(id)?.has(type), `item ${id} requires ${type}`);
    const getField = item.getField.bind(item);
    item.getField = (field) => {
      requireLoaded("itemData");
      return getField(field);
    };
    const getAttachments = item.getAttachments.bind(item);
    item.getAttachments = () => {
      requireLoaded("childItems");
      return getAttachments();
    };
    const getAnnotations = item.getAnnotations.bind(item);
    item.getAnnotations = () => {
      requireLoaded("childItems");
      return getAnnotations();
    };
    const getTags = item.getTags.bind(item);
    item.getTags = () => {
      requireLoaded("tags");
      return getTags();
    };
    if (item.isAnnotation()) {
      for (const [name, type] of [
        ["annotationText", "annotation"],
        ["annotationSortIndex", "annotation"],
        ["annotationPosition", "annotationDeferred"],
      ]) {
        const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
        Object.defineProperty(item, name, {
          ...descriptor,
          get() {
            requireLoaded(type);
            return descriptor.get!.call(item);
          },
        });
      }
    }
    Object.assign(item, { isEditable: () => false });
  }
  const searches: Array<{
    libraryID: number;
    conditions: Array<[string, string, string]>;
  }> = [];
  // Native Search and the page-label query are the only replaced boundaries.
  // Fake Zotero intentionally has a smaller metadata-only Search contract.
  Object.assign(fake.Zotero, {
    Search: class {
      conditions: Array<[string, string, string]> = [];
      libraryID: number;
      constructor({ libraryID }: { libraryID: number }) {
        this.libraryID = libraryID;
      }
      addCondition(field: string, operator: string, value: string) {
        assert.ok(
          [
            "title",
            "creator",
            "itemType",
            "annotationText",
            "annotationComment",
            "tag",
          ].includes(field),
        );
        assert.ok(["contains", "is"].includes(operator));
        this.conditions.push([field, operator, value]);
      }
      async search() {
        searches.push({
          libraryID: this.libraryID,
          conditions: this.conditions,
        });
        return items
          .filter(
            (data) =>
              (data.libraryID ?? 1) === this.libraryID &&
              this.conditions.every(([field, operator, value]) => {
                if (field === "itemType") return data.itemType === value;
                const haystack =
                  field === "title"
                    ? data.fields?.title || ""
                    : field === "creator"
                      ? data.fields?.firstCreator || ""
                      : field === "tag"
                        ? (data.tags || []).map(({ tag }) => tag).join(" ")
                        : field === "annotationText"
                          ? data.annotationText || ""
                          : data.annotationComment || "";
                return operator === "is"
                  ? haystack === value
                  : haystack
                      .toLocaleLowerCase()
                      .includes(value.toLocaleLowerCase());
              }),
          )
          .map((data) => data.id);
      }
    },
    Promise: { delay: () => new Promise((resolve) => setTimeout(resolve, 0)) },
  });
  const labelQueries: Array<unknown[]> = [];
  Object.assign(fake.Zotero, {
    DB: {
      columnQueryAsync: async (sql: string, params: [number, string]) => {
        assert.match(sql, /itemAnnotations\.pageLabel LIKE \? ESCAPE/);
        assert.match(sql, /items\.libraryID = \?/);
        labelQueries.push(params);
        const needle = params[1]
          .slice(1, -1)
          .replace(/\\([\\%_])/g, "$1")
          .toLocaleLowerCase();
        return items
          .filter(
            (data) =>
              (data.libraryID ?? 1) === params[0] &&
              data.itemType === "annotation" &&
              (data.annotationPageLabel || "")
                .toLocaleLowerCase()
                .includes(needle),
          )
          .map((data) => data.id);
      },
    },
  });
  const restore = fake.install(globalThis);
  t.after(restore);
  const item = (id: number) =>
    fake.Zotero.Items.get(id) as unknown as Zotero.Item;
  return { fake, item, loaded, searches, labelQueries };
}

const paper: FakeItemData = {
  id: 1,
  key: "PAPER001",
  itemType: "journalArticle",
  fields: { title: "Research paper" },
};
const pdf: FakeItemData = {
  id: 2,
  key: "PDF00002",
  itemType: "attachment",
  parentID: 1,
  attachmentContentType: "application/pdf",
  fields: { title: "Full text" },
};
const markdown: FakeItemData = {
  id: 3,
  key: "NOTE0003",
  itemType: "attachment",
  parentID: 1,
  attachmentContentType: "text/markdown",
  fields: { title: "Reading note" },
};

test("the source picker defaults to a note's literature and reads loaded, ordered text annotations", async (t) => {
  const f = fixture(t, [
    paper,
    pdf,
    markdown,
    {
      id: 4,
      key: "ANNO0004",
      itemType: "annotation",
      parentID: 2,
      annotationType: "highlight",
      annotationText: "Second passage",
      annotationPageLabel: "154",
      annotationPosition: '{"pageIndex":1}',
      annotationSortIndex: "00002",
      tags: [{ tag: "result" }],
    },
    {
      id: 5,
      key: "ANNO0005",
      itemType: "annotation",
      parentID: 2,
      annotationType: "note",
      annotationComment: "First comment",
      annotationPageLabel: "153",
      annotationPosition: '{"pageIndex":0}',
      annotationSortIndex: "00001",
    },
    {
      id: 6,
      key: "ANNO0006",
      itemType: "annotation",
      parentID: 2,
      annotationType: "image",
      annotationPosition: '{"pageIndex":0}',
    },
  ]);
  assert.deepEqual(await getInitialAnnotationSources(f.item(3)), [
    { id: 1, title: "Research paper" },
  ]);
  assert.deepEqual(await searchAnnotationSources(f.item(3), ""), [
    { id: 1, title: "Research paper" },
  ]);
  const annotations = await readMarkdownAnnotations(f.item(1));
  assert.deepEqual(
    annotations.map((entry) => entry.key),
    ["ANNO0005", "ANNO0004"],
  );
  assert.deepEqual(
    annotations.map((entry) => entry.page),
    [1, 2],
  );
  assert.deepEqual(annotations[1].tags, ["result"]);
  assert.equal(annotations[0].comment, "First comment");
  assert.deepEqual(await readMarkdownAnnotations(f.item(2)), annotations);
});

test("source eligibility is applied before the search limit and direct PDF results identify their parent", async (t) => {
  const irrelevant: FakeItemData[] = Array.from({ length: 30 }, (_, index) => ({
    id: 100 + index,
    key: `EMPTY${String(index).padStart(3, "0")}`,
    itemType: "book",
    fields: { title: `Shared book ${index}` },
  }));
  const f = fixture(t, [
    ...irrelevant,
    { ...paper, fields: { title: "Shared research paper" } },
    pdf,
    markdown,
    {
      id: 7,
      key: "PDF00007",
      itemType: "attachment",
      attachmentContentType: "application/pdf",
      fields: { title: "Standalone PDF" },
    },
  ]);
  assert.deepEqual(await searchAnnotationSources(f.item(3), "Shared"), [
    { id: 1, title: "Shared research paper" },
  ]);
  assert.deepEqual(await searchAnnotationSources(f.item(3), "Full text"), [
    { id: 2, title: "Full text", detail: "Shared research paper" },
  ]);
  assert.deepEqual(await searchAnnotationSources(f.item(3), "Standalone"), [
    { id: 7, title: "Standalone PDF" },
  ]);
  assert.deepEqual(await getInitialAnnotationSources(f.item(7)), [
    { id: 7, title: "Standalone PDF" },
  ]);
});

test("deleted sources are unavailable and stale moved children cannot leak into a literature's annotations", async (t) => {
  const f = fixture(t, [
    paper,
    pdf,
    markdown,
    {
      id: 7,
      key: "PAPER007",
      itemType: "journalArticle",
      fields: { title: "Other paper" },
    },
    {
      id: 8,
      key: "PDF00008",
      itemType: "attachment",
      parentID: 7,
      attachmentContentType: "application/pdf",
      fields: { title: "Moved PDF" },
    },
    {
      id: 9,
      key: "ANNO0009",
      itemType: "annotation",
      parentID: 8,
      annotationText: "Other parent's passage",
    },
  ]);
  Object.assign(f.item(1), { getAttachments: () => [2, 3, 8] });
  assert.deepEqual(await readMarkdownAnnotations(f.item(1)), []);
  Object.assign(f.item(1), { deleted: true });
  assert.deepEqual(await getInitialAnnotationSources(f.item(3)), []);
  await assert.rejects(
    readMarkdownAnnotations(f.item(2)),
    AnnotationSourceUnavailableError,
  );
  assert.deepEqual(await searchAnnotationSources(f.item(3), "Full text"), []);
});

test("annotation fragments preserve full-export content and group locations without adding headings", async (t) => {
  const f = fixture(t, [
    { ...paper, libraryID: 7 },
    { ...pdf, libraryID: 7 },
    { ...markdown, libraryID: 7 },
    {
      id: 4,
      key: "ANNO0004",
      libraryID: 7,
      itemType: "annotation",
      parentID: 2,
      annotationType: "underline",
      annotationText: "A *literal* passage\n<script>value</script>",
      annotationComment: "A [comment]",
      annotationPageLabel: "iv",
      annotationPosition: '{"pageIndex":3}',
    },
  ]);
  const annotations = await readMarkdownAnnotations(f.item(2));
  const fragment = annotationMarkdownFragment(annotations);
  const full = annotationMarkdown("Reading notes", annotations);
  assert.equal(full, `# Reading notes\n\n## Full text\n\n${fragment}`);
  assert.match(fragment, /> A \\\*literal\\\* passage\n> \\<script\\>value/);
  assert.ok(fragment.includes("A \\[comment\\]"));
  assert.equal(/^#{1,6} /m.test(fragment), false);
  const href = fragment.match(/\]\(([^)]+)\)/)![1];
  assert.deepEqual(parsePdfDocumentLink(href), {
    reference: { scope: "group", groupID: 42, key: "PDF00002" },
    page: 4,
    annotationKey: "ANNO0004",
  });
  assert.throws(() =>
    annotationMarkdownFragment([{ ...annotations[0], key: "../invalid" }]),
  );
});

function passages(count: number, parentID = 2): FakeItemData[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 100 + index,
    key: `ANNO${String(index).padStart(4, "0")}`,
    itemType: "annotation",
    parentID,
    annotationText: `Shared passage ${index}`,
    annotationPageLabel: String(index + 1),
    annotationSortIndex: String(index).padStart(6, "0"),
    annotationPosition: JSON.stringify({ pageIndex: index }),
  }));
}

test("library search matches native annotation fields and literal page labels with complete source metadata", async (t) => {
  const f = fixture(t, [
    paper,
    pdf,
    markdown,
    {
      id: 10,
      key: "PAPER010",
      itemType: "journalArticle",
      fields: {
        title: "Second paper",
        firstCreator: "Ada",
        date: "2021-06-01",
      },
    },
    {
      id: 11,
      key: "PDF00011",
      itemType: "attachment",
      parentID: 10,
      attachmentContentType: "application/pdf",
      fields: { title: "Supplement" },
    },
    {
      id: 12,
      key: "ANNO0012",
      itemType: "annotation",
      parentID: 11,
      annotationText: "Memory text",
    },
    {
      id: 13,
      key: "ANNO0013",
      itemType: "annotation",
      parentID: 11,
      annotationComment: "Memory comment",
    },
    {
      id: 14,
      key: "ANNO0014",
      itemType: "annotation",
      parentID: 11,
      annotationText: "Tagged text",
      tags: [{ tag: "memory" }],
    },
    {
      id: 15,
      key: "ANNO0015",
      itemType: "annotation",
      parentID: 11,
      annotationText: "Labelled text",
      annotationPageLabel: "Memory-4",
    },
    {
      id: 16,
      key: "ANNO0016",
      itemType: "annotation",
      parentID: 11,
      annotationText: "Literal label",
      annotationPageLabel: "p%_3",
    },
    {
      id: 17,
      key: "ANNO0017",
      itemType: "annotation",
      parentID: 11,
      annotationText: "Memory deleted",
    },
    {
      id: 18,
      key: "HTML0018",
      itemType: "attachment",
      attachmentContentType: "text/html",
    },
    {
      id: 19,
      key: "ANNO0019",
      itemType: "annotation",
      parentID: 18,
      annotationText: "Memory HTML",
    },
    { id: 20, key: "PAPER020", itemType: "book" },
    {
      id: 21,
      key: "PDF00021",
      itemType: "attachment",
      parentID: 20,
      attachmentContentType: "application/pdf",
    },
    {
      id: 22,
      key: "ANNO0022",
      itemType: "annotation",
      parentID: 21,
      annotationText: "Memory invalid source",
    },
    {
      id: 23,
      key: "PDF00023",
      itemType: "attachment",
      libraryID: 7,
      attachmentContentType: "application/pdf",
    },
    {
      id: 24,
      key: "ANNO0024",
      itemType: "annotation",
      libraryID: 7,
      parentID: 23,
      annotationText: "Memory other library",
    },
  ]);
  Object.assign(f.item(17), { deleted: true });
  Object.assign(f.item(20), { deleted: true });
  assert.deepEqual(
    await searchLibraryAnnotations(f.item(3), "", [], () => true),
    { annotations: [] },
  );
  assert.equal(f.searches.length, 0);
  assert.equal(f.labelQueries.length, 0);
  const page = await searchLibraryAnnotations(
    f.item(3),
    "Memory",
    [],
    () => true,
  );
  assert.deepEqual(
    page.annotations.map((a) => a.key),
    ["ANNO0012", "ANNO0013", "ANNO0014", "ANNO0015"],
  );
  assert.equal(page.annotations[0].sourceKey, "PAPER010");
  assert.equal(page.annotations[0].sourceTitle, "Second paper");
  assert.equal(page.annotations[0].sourceDetail, "Ada · 2021");
  assert.ok(
    f.searches.every(
      (search) =>
        search.libraryID === 1 &&
        search.conditions.some(
          ([field, , value]) => field === "itemType" && value === "annotation",
        ),
    ),
  );
  const literal = await searchLibraryAnnotations(
    f.item(3),
    "%_",
    [],
    () => true,
  );
  assert.deepEqual(
    literal.annotations.map((a) => a.key),
    ["ANNO0016"],
  );
  assert.deepEqual(f.labelQueries.at(-1), [1, "%\\%\\_%"]);
  assert.deepEqual(await searchAnnotationSources(f.item(3), "Ada"), [
    { id: 10, title: "Second paper", detail: "Ada · 2021" },
  ]);
});

test("search pages hydrate fifty matches at a time without loading an entire PDF", async (t) => {
  const f = fixture(t, [paper, pdf, markdown, ...passages(120)]);
  const page = await searchLibraryAnnotations(
    f.item(3),
    "Shared",
    [],
    () => true,
  );
  assert.equal(page.annotations.length, 50);
  const hydrated = () =>
    [...f.loaded.entries()]
      .filter(([id, types]) => id >= 100 && types.has("annotation"))
      .map(([id]) => id);
  assert.deepEqual(
    hydrated(),
    Array.from({ length: 50 }, (_, i) => 100 + i),
  );
  const second = await page.loadMore!(() => true);
  assert.equal(second.annotations.length, 50);
  assert.equal(second.annotations[0].key, "ANNO0050");
  assert.equal(hydrated().length, 100);
  const third = await second.loadMore!(() => true);
  assert.equal(third.annotations.length, 20);
  assert.equal(third.loadMore, undefined);
  assert.equal(
    new Set(
      [...page.annotations, ...second.annotations, ...third.annotations].map(
        annotationIdentity,
      ),
    ).size,
    120,
  );
});

test("selected sources intersect candidate IDs before hydration and duplicate source paths do not duplicate annotations", async (t) => {
  const f = fixture(t, [
    paper,
    pdf,
    markdown,
    ...passages(65),
    {
      id: 10,
      key: "PAPER010",
      itemType: "book",
      fields: { title: "Other paper" },
    },
    {
      id: 11,
      key: "PDF00011",
      itemType: "attachment",
      parentID: 10,
      attachmentContentType: "application/pdf",
    },
    {
      id: 12,
      key: "EXTR0012",
      itemType: "annotation",
      parentID: 11,
      annotationText: "Shared other source",
    },
  ]);
  const source = { id: 1, title: "Research paper" };
  const page = await searchLibraryAnnotations(
    f.item(3),
    "Shared",
    [source, { id: 2, title: "Full text" }],
    () => true,
  );
  assert.equal(page.annotations.length, 50);
  assert.equal(f.loaded.get(12)?.has("annotation"), undefined);
  const rest = await page.loadMore!(() => true);
  assert.equal(rest.annotations.length, 15);
  assert.equal(
    new Set([...page.annotations, ...rest.annotations].map(annotationIdentity))
      .size,
    65,
  );
  f.searches.length = 0;
  f.labelQueries.length = 0;
  const browse = await searchLibraryAnnotations(
    f.item(3),
    "",
    [source],
    () => true,
  );
  assert.equal(browse.annotations.length, 50);
  assert.equal(f.searches.length, 0);
  assert.equal(f.labelQueries.length, 0);
});

test("a failed page can retry the same candidates and cancelled queries do not hydrate or advance", async (t) => {
  const f = fixture(t, [paper, pdf, markdown, ...passages(101)]);
  const first = await searchLibraryAnnotations(
    f.item(3),
    "Shared",
    [],
    () => true,
  );
  const originalLoad = Zotero.Items.loadDataTypes;
  let fail = true;
  Object.assign(Zotero.Items, {
    loadDataTypes: async (items: Zotero.Item[], types: string[]) => {
      if (
        fail &&
        types.includes("annotation") &&
        items.some((item) => item.id === 150)
      )
        throw new Error("read unavailable");
      return originalLoad(items, types as _ZoteroTypes.Item.DataType[]);
    },
  });
  await assert.rejects(
    first.loadMore!(() => true),
    /read unavailable/,
  );
  fail = false;
  const retry = await first.loadMore!(() => true);
  assert.equal(retry.annotations[0].key, "ANNO0050");
  assert.equal(retry.annotations.length, 50);
  let active = true;
  const originalGet = Zotero.Items.getAsync;
  Object.assign(Zotero.Items, {
    getAsync: async (ids: number | number[]) => {
      const result = await originalGet.call(Zotero.Items, ids as number[]);
      if (Array.isArray(ids) && ids.includes(200)) active = false;
      return result;
    },
  });
  assert.deepEqual(await retry.loadMore!(() => active), { annotations: [] });
  assert.equal(f.loaded.get(200)?.has("annotation"), undefined);
  active = true;
  const final = await retry.loadMore!(() => true);
  assert.equal(final.annotations[0].key, "ANNO0100");
});

test("batch reads validate source chains and stable identities distinguish personal and group libraries", async (t) => {
  const f = fixture(t, [
    paper,
    pdf,
    markdown,
    ...passages(1),
    {
      id: 10,
      key: "PDF00002",
      itemType: "attachment",
      libraryID: 7,
      attachmentContentType: "application/pdf",
    },
    {
      id: 11,
      key: "ANNO0000",
      itemType: "annotation",
      libraryID: 7,
      parentID: 10,
      annotationText: "Group annotation",
    },
  ]);
  const personal = await readMarkdownAnnotationItems(1, [
    f.item(100),
    f.item(11),
  ]);
  const group = await readMarkdownAnnotationItems(7, [f.item(11)]);
  assert.equal(personal.length, 1);
  assert.equal(group.length, 1);
  assert.notEqual(
    annotationIdentity(personal[0]),
    annotationIdentity(group[0]),
  );
  assert.equal(group[0].groupID, 42);
  assert.equal(group[0].sourceKey, "PDF00002");
  await assert.rejects(
    searchLibraryAnnotations(
      f.item(3),
      "",
      [{ id: 10, title: "foreign" }],
      () => true,
    ),
    AnnotationSourceUnavailableError,
  );
});

test("image-only candidates yield between batches and stop once their query is superseded", async (t) => {
  const f = fixture(t, [
    paper,
    pdf,
    markdown,
    ...passages(70).map((data) => ({
      ...data,
      annotationText: "",
      annotationType: "image",
      tags: [{ tag: "Shared" }],
    })),
    {
      id: 200,
      key: "TEXT0200",
      itemType: "annotation",
      parentID: 2,
      annotationText: "Shared text",
    },
  ]);
  let active = true;
  let yields = 0;
  Object.assign(Zotero.Promise, {
    delay: async () => {
      yields++;
      active = false;
    },
  });
  const result = await searchLibraryAnnotations(
    f.item(3),
    "Shared",
    [],
    () => active,
  );
  assert.deepEqual(result, { annotations: [] });
  assert.equal(yields, 1);
  assert.equal(f.loaded.get(150)?.has("annotation"), undefined);
  assert.equal(f.loaded.get(200)?.has("annotation"), undefined);
});

test("a PDF moved during loading cannot escape a selected literature scope", async (t) => {
  const f = fixture(t, [
    paper,
    pdf,
    markdown,
    ...passages(1),
    {
      id: 10,
      key: "PAPER010",
      itemType: "book",
      fields: { title: "New parent" },
    },
  ]);
  const originalLoad = Zotero.Items.loadDataTypes;
  Object.assign(Zotero.Items, {
    loadDataTypes: async (items: Zotero.Item[], types: string[]) => {
      await originalLoad(items, types as _ZoteroTypes.Item.DataType[]);
      if (types.includes("childItems") && items.some((item) => item.id === 2))
        Object.defineProperty(f.item(2), "parentID", {
          configurable: true,
          writable: true,
          value: 10,
        });
    },
  });
  assert.deepEqual(await readMarkdownAnnotations(f.item(1)), []);
  Object.assign(f.item(2), { parentID: 1 });
  const scoped = await searchLibraryAnnotations(
    f.item(3),
    "Shared",
    [{ id: 1, title: "Research paper" }],
    () => true,
  );
  assert.deepEqual(scoped.annotations, []);
  const byPDF = await searchLibraryAnnotations(
    f.item(3),
    "Shared",
    [{ id: 2, title: "Full text" }],
    () => true,
  );
  assert.equal(byPDF.annotations.length, 1);
  assert.equal(byPDF.annotations[0].sourceKey, "PAPER010");
});

test("type, color, and tag filters inspect candidates beyond the first page before returning a match", async (t) => {
  const data = passages(52).map((item, index) => ({
    ...item,
    annotationType: index === 51 ? "underline" : "highlight",
    annotationColor: index === 51 ? "#Aa00Bb" : "#ffff00",
    tags: [{ tag: index === 51 ? "target" : "other" }],
  }));
  const f = fixture(t, [paper, pdf, markdown, ...data]);
  const page = await searchLibraryAnnotations(
    f.item(3),
    "Shared",
    [],
    () => true,
    { type: "underline", colors: ["#aa00bb"], tag: "target" },
  );
  assert.deepEqual(
    page.annotations.map((item) => item.key),
    ["ANNO0051"],
  );
  assert.equal(page.loadMore, undefined);
  const noMatch = await searchLibraryAnnotations(
    f.item(3),
    "Shared",
    [],
    () => true,
    { type: "underline", colors: ["#ffff00"], tag: "target" },
  );
  assert.deepEqual(noMatch.annotations, []);
  assert.equal(noMatch.loadMore, undefined);
});

test("an explicit color filter searches the library with no text or source while a blank picker does not", async (t) => {
  const data = passages(52).map((item, index) => ({
    ...item,
    annotationColor: index === 51 ? "#aa00bb" : "#ffff00",
  }));
  const f = fixture(t, [paper, pdf, markdown, ...data]);
  const page = await searchLibraryAnnotations(f.item(3), "", [], () => true, {
    type: "",
    colors: ["#aa00bb"],
    tag: "",
  });
  assert.deepEqual(
    page.annotations.map((item) => item.key),
    ["ANNO0051"],
  );
  assert.equal(page.loadMore, undefined);
  assert.deepEqual(f.searches, [
    { libraryID: 1, conditions: [["itemType", "is", "annotation"]] },
  ]);
  assert.equal(f.labelQueries.length, 0);
  assert.deepEqual(
    await searchLibraryAnnotations(f.item(3), "", [], () => true),
    { annotations: [] },
  );
  assert.equal(f.searches.length, 1);
});
