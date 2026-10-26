import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import { getOutgoingNoteReferences } from "../src/modules/markdown/note-references.ts";

function fixture(t: TestContext, content: string) {
  const fake = createFakeZotero({
    libraries: [
      { libraryID: 1, libraryType: "user" },
      { libraryID: 7, libraryType: "group", groupID: 42 },
    ],
    items: [
      {
        id: 1,
        key: "ARTICLE1",
        itemType: "journalArticle",
        fields: { title: "Research paper" },
      },
      {
        id: 2,
        key: "CURRENT1",
        itemType: "attachment",
        fields: { title: "Current note" },
        attachmentContentType: "text/markdown",
      },
      {
        id: 3,
        key: "MDNOTE02",
        itemType: "attachment",
        fields: { title: "Reading notes" },
        attachmentContentType: "text/markdown",
      },
      {
        id: 4,
        key: "NATNOTE1",
        parentID: 1,
        itemType: "note",
        fields: { title: "Native note" },
      },
      {
        id: 5,
        key: "PAPERPDF",
        parentID: 1,
        itemType: "attachment",
        fields: { title: "Paper PDF" },
        attachmentContentType: "application/pdf",
      },
      {
        id: 6,
        key: "CANVAS01",
        itemType: "attachment",
        fields: { title: "Research canvas" },
      },
      {
        id: 7,
        libraryID: 7,
        key: "ARTICLE1",
        itemType: "journalArticle",
        fields: { title: "Group paper" },
      },
      {
        id: 8,
        key: "UNUSED01",
        itemType: "journalArticle",
        fields: { title: "Unreferenced paper" },
      },
    ],
  });
  const item = (id: number) =>
    fake.Zotero.Items.get(id) as unknown as Zotero.Item;
  const reads: string[] = [];
  const loads: { ids: number[]; types: string[] }[] = [];
  const files = new Map([["/notes/current.md", content]]);
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const target = item(id);
    Object.assign(target, {
      itemTypeID: target.isRegularItem() ? 1 : target.isNote() ? 2 : 3,
      attachmentLinkMode: 0,
      attachmentFilename:
        id === 2 || id === 3
          ? `${target.key}.md`
          : id === 6
            ? "research.canvas"
            : "paper.pdf",
      isPDFAttachment: () => id === 5,
      getItemTypeIconName: () =>
        target.isRegularItem()
          ? "journalArticle"
          : target.isNote()
            ? "note"
            : "attachment",
      getImageSrc: () =>
        `chrome://zotero/skin/item-type/16/light/${target.isRegularItem() ? "journal-article" : target.isNote() ? "note" : "attachment"}.svg`,
      getCreators: () => [
        { firstName: "Ada", lastName: "Lovelace", creatorTypeID: 1 },
      ],
      getFilePathAsync: async () => {
        assert.equal(id, 2, "reference targets must not have their files read");
        return "/notes/current.md";
      },
    });
  }
  Object.assign(fake.Zotero.Items, {
    getAll: () => {
      throw new Error("No full-library metadata scan allowed");
    },
    loadDataTypes: async (records: Zotero.Item[], types: string[]) => {
      loads.push({ ids: records.map((record) => record.id), types });
    },
  });
  Object.assign(fake.Zotero, {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Search: class {
      constructor() {
        throw new Error("No title search before navigation");
      }
    },
    ItemTypes: {
      getLocalizedString: (id: number) =>
        id === 1 ? "Journal article" : id === 2 ? "Note" : "Attachment",
    },
    CreatorTypes: { getID: () => 1 },
    File: {
      getContentsAsync: async (path: string) => {
        reads.push(path);
        return files.get(path);
      },
    },
  });
  const restore = fake.install();
  t.after(restore);
  return { item, reads, loads, files, fake };
}

test("outgoing references classify and group explicit targets without loading their bodies", async (t) => {
  const source = [
    "[Paper](zotero://select/library/items/ARTICLE1)",
    "[[Reading--MDNOTE02#Overview|Reading]]",
    "[Another section](Reading--MDNOTE02.md#Details)",
    "[Native](zotero://select/library/items/NATNOTE1)",
    "[PDF](zotero://open-pdf/library/items/PAPERPDF?page=3)",
    "[Annotation](zotero://open-pdf/library/items/PAPERPDF?page=5&annotation=ANNOTE01)",
    "[Canvas](zotero://select/library/items/CANVAS01)",
  ].join("\n");
  const { item, reads, loads } = fixture(t, source);
  const { entries, failure } = await getOutgoingNoteReferences(item(2));
  assert.equal(failure, undefined);
  assert.deepEqual(
    entries.map(({ id, category, status }) => ({ id, category, status })),
    [
      { id: "1/ARTICLE1", category: "literature", status: "resolved" },
      { id: "1/MDNOTE02", category: "note", status: "resolved" },
      { id: "1/NATNOTE1", category: "note", status: "resolved" },
      { id: "1/PAPERPDF", category: "attachment", status: "resolved" },
      { id: "1/CANVAS01", category: "attachment", status: "resolved" },
    ],
  );
  assert.equal(entries[0].candidate?.kindLabel, "Journal article");
  assert.match(entries[0].candidate?.icon || "", /journal-article\.svg$/);
  assert.equal(entries[0].candidate?.author, "Ada Lovelace");
  assert.equal(
    entries[2].candidate?.author,
    "Ada Lovelace",
    "native notes use parent authors",
  );
  assert.equal(entries[4].candidate?.kind, "canvas");
  assert.equal(entries[1].occurrences.length, 2);
  assert.equal(entries[1].occurrences[1].href, "Reading--MDNOTE02.md#Details");
  assert.equal(
    entries[1].occurrences[1].position,
    source.indexOf("[Another section]"),
  );
  assert.deepEqual(
    entries[3].occurrences.map((occurrence) => occurrence.href),
    [
      "zotero://open-pdf/library/items/PAPERPDF?page=3",
      "zotero://open-pdf/library/items/PAPERPDF?page=5&annotation=ANNOTE01",
    ],
  );
  assert.deepEqual(reads, ["/notes/current.md"]);
  assert.ok(loads.length > 0);
  assert.ok(
    loads.every((load) =>
      load.types.every((type) => ["itemData", "creators"].includes(type)),
    ),
  );
  assert.ok(
    loads.every((load) => !load.ids.includes(8)),
    "unreferenced metadata is not loaded",
  );
});

test("title-only links stay pending while code, images, external URLs and self links are excluded", async (t) => {
  const source = [
    "---\ntitle: '[[Hidden]]'\n---",
    "`[[Code]]` ![[Image.png]] ![image](note.md)",
    "```md\n[[Fenced]]\n```",
    "<!-- [[Comment]] -->",
    "[External](https://example.com) [Mail](mailto:person@example.com)",
    "[Unsafe](javascript:alert) [Heading](#Overview) [[#Details]]",
    "[[Current--CURRENT1#Overview]] [Current](zotero://select/library/items/CURRENT1)",
    "[[Unsearched title|Displayed title]] [[Unsearched title#Details|Other section]]",
  ].join("\n");
  const { item, loads } = fixture(t, source);
  const { entries } = await getOutgoingNoteReferences(item(2));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Displayed title");
  assert.equal(entries[0].category, "unresolved");
  assert.equal(entries[0].status, "pending");
  assert.equal(entries[0].occurrences.length, 2);
  assert.deepEqual(
    loads,
    [],
    "pending links do not search or load target metadata",
  );
});

test("native scopes keep identical personal and group keys separate and missing targets unavailable", async (t) => {
  const { item } = fixture(
    t,
    [
      "[Personal](zotero://select/library/items/ARTICLE1)",
      "[Group](zotero://select/groups/42/items/ARTICLE1)",
      "[Unknown group](zotero://select/groups/99/items/ARTICLE1)",
      "[Deleted](zotero://select/library/items/UNUSED01)",
      "[[Gone--MISSING1|Gone]]",
    ].join("\n"),
  );
  item(8).deleted = true;
  const { entries } = await getOutgoingNoteReferences(item(2));
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.status]),
    [
      ["1/ARTICLE1", "resolved"],
      ["7/ARTICLE1", "resolved"],
      ["group/99/ARTICLE1", "unavailable"],
      ["1/UNUSED01", "unavailable"],
      ["1/MISSING1", "unavailable"],
    ],
  );
  assert.equal(entries[1].candidate?.groupID, 42);
  assert.equal(
    entries[1].candidate?.href,
    "zotero://select/groups/42/items/ARTICLE1",
  );
});

test("a missing current attachment reports a read failure instead of an empty reference list", async (t) => {
  const { item, reads } = fixture(t, "[[Reading--MDNOTE02]]");
  item(2).getFilePathAsync = async () => false;
  const result = await getOutgoingNoteReferences(item(2));
  assert.deepEqual(result.entries, []);
  assert.equal(result.failure?.key, "CURRENT1");
  assert.equal(result.failure?.stage, "path");
  assert.deepEqual(reads, []);
});

test("outgoing references reread the saved source without retaining an obsolete snapshot", async (t) => {
  const { item, files } = fixture(t, "[[Reading--MDNOTE02]]");
  assert.equal(
    (await getOutgoingNoteReferences(item(2))).entries[0].id,
    "1/MDNOTE02",
  );
  files.set(
    "/notes/current.md",
    "[Paper](zotero://select/library/items/ARTICLE1)",
  );
  assert.equal(
    (await getOutgoingNoteReferences(item(2))).entries[0].id,
    "1/ARTICLE1",
  );
});
