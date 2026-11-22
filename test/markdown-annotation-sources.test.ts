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
} from "../src/modules/markdown/annotations.ts";
import {
  getInitialAnnotationSources,
  searchAnnotationSources,
} from "../src/modules/markdown/annotation-sources.ts";
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
  const restore = fake.install(globalThis);
  t.after(restore);
  const item = (id: number) =>
    fake.Zotero.Items.get(id) as unknown as Zotero.Item;
  return { fake, item };
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
