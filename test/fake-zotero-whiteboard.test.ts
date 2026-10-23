import assert from "node:assert/strict";
import test from "node:test";
import {
  createFakeZotero,
  type FakeItemData,
} from "@zotero-plugin/fake-zotero";
import {
  createZoteroSourceGateway,
  SourceGatewayError,
} from "../src/modules/whiteboard/source-gateway.ts";
import type { NoteSource } from "../packages/whiteboard/src/model/academic.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import {
  applySourceResolutionResults,
  canvasDocumentToFlow,
  flowToCanvasDocument,
} from "../packages/whiteboard/src/whiteboard/document.ts";
import { createNoteRefreshRuntime } from "../packages/whiteboard/src/whiteboard/noteRefresh.ts";
import { createSourceRefreshRuntime } from "../packages/whiteboard/src/whiteboard/sourceState.ts";

const GROUP_ID = 42;
const GROUP_LIBRARY_ID = 2;
const USER_ITEM_KEY = "SAMEKEY";
const GROUP_ITEM_KEY = "SAMEKEY";

const items: FakeItemData[] = [
  {
    id: 1,
    key: USER_ITEM_KEY,
    itemType: "journalArticle",
    fields: { title: "User paper", date: "2025" },
  },
  {
    id: 2,
    key: "USER-PDF",
    itemType: "attachment",
    parentID: 1,
    attachmentContentType: "application/pdf",
    fields: { title: "User paper.pdf" },
  },
  {
    id: 3,
    key: "USER-QUOTE",
    itemType: "annotation",
    parentID: 2,
    annotationType: "highlight",
    annotationText: "User evidence",
    annotationPosition: '{"pageIndex":2}',
  },
  {
    id: 4,
    key: "USER-NOTE",
    itemType: "note",
    parentID: 1,
    note: "<p>User note</p>",
  },
  {
    id: 10,
    key: GROUP_ITEM_KEY,
    libraryID: GROUP_LIBRARY_ID,
    itemType: "journalArticle",
    fields: { title: "Group paper", date: "2026" },
  },
  {
    id: 11,
    key: "GROUP-PDF",
    libraryID: GROUP_LIBRARY_ID,
    itemType: "attachment",
    parentID: 10,
    attachmentContentType: "application/pdf",
    fields: { title: "Group paper.pdf" },
  },
  {
    id: 12,
    key: "GROUP-QUOTE",
    libraryID: GROUP_LIBRARY_ID,
    itemType: "annotation",
    parentID: 11,
    annotationType: "underline",
    annotationText: "Group evidence",
    annotationPosition: '{"pageIndex":4}',
  },
  {
    id: 13,
    key: "GROUP-NOTE",
    libraryID: GROUP_LIBRARY_ID,
    itemType: "note",
    parentID: 10,
    note: "<p>Group note</p>",
  },
];

function createFixture() {
  return createFakeZotero({
    libraries: [
      {
        libraryID: GROUP_LIBRARY_ID,
        libraryType: "group",
        groupID: GROUP_ID,
      },
    ],
    items,
  });
}

function groupLibrary() {
  return { type: "group" as const, groupID: GROUP_ID };
}

test("the production gateway keeps same-key group sources and complete chains isolated", async () => {
  const fake = createFixture();
  const restore = fake.install();
  try {
    const gateway = createZoteroSourceGateway();
    const userItem = fake.Zotero.Items.getByLibraryAndKey(1, USER_ITEM_KEY);
    const groupItem = fake.Zotero.Items.getByLibraryAndKey(
      GROUP_LIBRARY_ID,
      GROUP_ITEM_KEY,
    );
    assert.ok(userItem && groupItem);

    assert.deepEqual(gateway.acquireItem(userItem as unknown as Zotero.Item), {
      kind: "literature",
      source: { library: { type: "user" }, itemKey: USER_ITEM_KEY },
      snapshot: { title: "User paper", year: "2025" },
    });
    assert.deepEqual(gateway.acquireItem(groupItem as unknown as Zotero.Item), {
      kind: "literature",
      source: { library: groupLibrary(), itemKey: GROUP_ITEM_KEY },
      snapshot: { title: "Group paper", year: "2026" },
    });

    const groupSource = { library: groupLibrary(), itemKey: GROUP_ITEM_KEY };
    const groupResolution = await gateway.resolve("group-paper", 7, {
      kind: "literature",
      source: groupSource,
    });
    assert.equal(groupResolution.status, "resolved");
    if (groupResolution.status === "resolved") {
      assert.deepEqual(groupResolution.acquisition.source, groupSource);
      assert.equal(groupResolution.acquisition.snapshot.title, "Group paper");
    }
    const userAnnotations = await gateway.listAnnotations({
      library: { type: "user" },
      itemKey: USER_ITEM_KEY,
    });
    const groupAnnotations = await gateway.listAnnotations(groupSource);
    assert.deepEqual(
      userAnnotations.candidates.map(
        (candidate) => candidate.acquisition.source.annotationKey,
      ),
      ["USER-QUOTE"],
    );
    assert.deepEqual(
      groupAnnotations.candidates.map(
        (candidate) => candidate.acquisition.source.annotationKey,
      ),
      ["GROUP-QUOTE"],
    );

    const groupNoteSource = {
      library: groupLibrary(),
      noteKey: "GROUP-NOTE",
      itemKey: GROUP_ITEM_KEY,
    };
    assert.equal(
      (await gateway.refreshNote(groupNoteSource)).content,
      "Group note",
    );
    assert.deepEqual(
      await gateway.resolve("wrong-parent", 8, {
        kind: "note",
        source: { ...groupNoteSource, itemKey: "OTHERGROUP" },
      }),
      {
        nodeId: "wrong-parent",
        generation: 8,
        status: "unavailable",
        code: "parent-mismatch",
        message: "The Zotero item's parent has changed.",
      },
    );

    await gateway.open({
      kind: "quote",
      source: {
        ...groupAnnotations.candidates[0].acquisition.source,
        library: groupLibrary(),
      },
    });
    assert.deepEqual(
      fake.calls.find((call) => call.method === "Reader.open")?.args,
      [11, { annotationID: "GROUP-QUOTE" }],
    );
  } finally {
    restore();
  }
});

test("missing children and open failures stay typed at the gateway boundary", async () => {
  const fake = createFixture();
  const restore = fake.install();
  try {
    const gateway = createZoteroSourceGateway();
    const source = {
      library: { type: "user" as const },
      itemKey: USER_ITEM_KEY,
    };
    const userItem = fake.Zotero.Items.getByLibraryAndKey(1, USER_ITEM_KEY);
    assert.ok(userItem);
    userItem.getAttachments = () => [99999];
    const listed = await gateway.listAnnotations(source);
    assert.deepEqual(listed.candidates, []);
    assert.deepEqual(listed.failures, [
      {
        code: "attachment-unavailable",
        message: "Annotations from an attachment could not be loaded.",
      },
    ]);

    const missing = await gateway.resolve("gone", 9, {
      kind: "literature",
      source: { ...source, itemKey: "GONE" },
    });
    assert.equal(missing.status, "unavailable");
    if (missing.status === "unavailable")
      assert.equal(missing.code, "item-missing");

    const reader = fake.Zotero.Reader;
    reader.open = () => {
      throw new Error("reader failed");
    };
    const quoteSource = {
      library: { type: "user" as const },
      itemKey: USER_ITEM_KEY,
      attachmentKey: "USER-PDF",
      annotationKey: "USER-QUOTE",
    };
    await assert.rejects(
      gateway.open({ kind: "quote", source: quoteSource }),
      (error: unknown) =>
        error instanceof SourceGatewayError &&
        error.code === "open-failed" &&
        error.message === "reader failed",
    );
  } finally {
    restore();
  }
});

test("source and note refresh runtimes apply real fake acquisitions and preserve references", async () => {
  const fake = createFixture();
  const restore = fake.install();
  try {
    const gateway = createZoteroSourceGateway();
    const literatureSource = {
      library: groupLibrary(),
      itemKey: GROUP_ITEM_KEY,
    };
    const initial: CanvasDocument = {
      version: 2,
      nodes: [
        {
          id: "group-literature",
          kind: "literature",
          position: { x: 0, y: 0 },
          width: 280,
          height: 200,
          source: literatureSource,
          snapshot: { title: "Old title" },
        },
        {
          id: "group-note",
          kind: "note",
          position: { x: 320, y: 0 },
          width: 260,
          height: 152,
          source: {
            library: groupLibrary(),
            noteKey: "GROUP-NOTE",
            itemKey: GROUP_ITEM_KEY,
          },
          content: "Local note",
        },
      ],
      connections: [],
    };
    let nodes = canvasDocumentToFlow(initial).nodes;
    let changed = 0;
    const sourceRefresh = createSourceRefreshRuntime({
      getNodes: () => nodes,
      applyResolutionBatch: (generation, results) => {
        nodes = applySourceResolutionResults(nodes, generation, results);
      },
      changed: () => changed++,
    });
    const request = sourceRefresh.request(nodes[0]);
    assert.ok(request);
    const result = await gateway.resolve(request.nodeId, 3, request.source);
    sourceRefresh.apply(3, [result]);
    assert.equal(
      nodes[0].data.model.kind === "literature" &&
        nodes[0].data.model.snapshot.title,
      "Group paper",
    );
    assert.equal(changed, 1);

    let live: CanvasDocument = initial;
    let noteRequest: [string, string, NoteSource] | undefined;
    let commits = 0;
    const noteRefresh = createNoteRefreshRuntime({
      getWorkingDocument: () => live,
      getHistoryDocument: () => live,
      applyDocument: (next) => {
        live = next;
      },
      commitHistory: () => commits++,
      confirm: () => true,
      request: (...args) => {
        noteRequest = args;
      },
      onError: (message) => assert.fail(message),
      createRequestId: () => "note-refresh-1",
    });
    const noteNode = canvasDocumentToFlow(initial).nodes[1];
    const requestId = noteRefresh.request(noteNode, {
      noteOverwriteTitle: "Overwrite note?",
      noteOverwriteBody: "Replace local text?",
      sourceMissing: "Source missing",
    });
    assert.equal(requestId, "note-refresh-1");
    assert.deepEqual(noteRequest, [
      "note-refresh-1",
      "group-note",
      {
        library: groupLibrary(),
        noteKey: "GROUP-NOTE",
        itemKey: GROUP_ITEM_KEY,
      },
    ]);
    const noteAcquisition = await gateway.refreshNote(noteRequest![2]);
    assert.equal(
      noteRefresh.resolve("note-refresh-1", "group-note", noteAcquisition),
      true,
    );
    assert.equal(
      live.nodes[1].kind === "note" && live.nodes[1].content,
      "Group note",
    );
    assert.equal(commits, 1);

    const saved = flowToCanvasDocument(nodes, [], { x: 0, y: 0, zoom: 1 });
    assert.deepEqual(
      (saved.nodes[0].kind === "literature" && saved.nodes[0].source.library) ||
        null,
      groupLibrary(),
    );
    assert.deepEqual(
      saved.nodes[1].kind === "note" ? saved.nodes[1].source?.library : null,
      groupLibrary(),
    );
  } finally {
    restore();
  }
});

test("production gateway reads standalone HTML and EPUB annotations but rejects linked URLs", async () => {
  const fake = createFakeZotero({
    items: [
      {
        id: 1,
        key: "HTML0001",
        itemType: "attachment",
        attachmentLinkMode: 1,
        attachmentContentType: "text/html",
        fields: { title: "Saved webpage" },
      },
      {
        id: 2,
        key: "HTMLNOTE",
        itemType: "annotation",
        parentID: 1,
        annotationType: "note",
        annotationComment: "Check this claim",
        tags: [{ tag: "review" }, { tag: "web" }],
      },
      {
        id: 3,
        key: "EPUB0001",
        itemType: "attachment",
        attachmentLinkMode: 2,
        attachmentContentType: "application/epub+zip",
        fields: { title: "A book" },
      },
      {
        id: 4,
        key: "EPUBLINE",
        itemType: "annotation",
        parentID: 3,
        annotationType: "underline",
        annotationText: "Book evidence",
        annotationComment: "Compare with webpage",
        tags: [{ tag: "review" }],
      },
      {
        id: 5,
        key: "URL00001",
        itemType: "attachment",
        attachmentLinkMode: 3,
        attachmentContentType: "text/html",
        fields: { title: "Website link" },
      },
    ],
  });
  const restore = fake.install();
  try {
    const gateway = createZoteroSourceGateway();
    for (const [attachmentKey, annotationKey, text, comment, tags] of [
      ["HTML0001", "HTMLNOTE", "", "Check this claim", ["review", "web"]],
      [
        "EPUB0001",
        "EPUBLINE",
        "Book evidence",
        "Compare with webpage",
        ["review"],
      ],
    ] as const) {
      const result = await gateway.listAnnotations({
        library: { type: "user" },
        attachmentKey,
      });
      assert.deepEqual(result.failures, []);
      assert.equal(result.candidates.length, 1);
      const acquisition = result.candidates[0].acquisition;
      assert.deepEqual(acquisition.source, {
        library: { type: "user" },
        attachmentKey,
        annotationKey,
      });
      assert.equal(acquisition.snapshot.text, text);
      assert.equal(acquisition.snapshot.comment, comment);
      assert.deepEqual(acquisition.snapshot.tags, tags);
      await gateway.open({ kind: "quote", source: acquisition.source });
    }
    assert.deepEqual(
      fake.calls
        .filter((call) => call.method === "Reader.open")
        .map((call) => call.args),
      [
        [1, { annotationID: "HTMLNOTE" }],
        [3, { annotationID: "EPUBLINE" }],
      ],
    );
    await assert.rejects(
      gateway.listAnnotations({
        library: { type: "user" },
        attachmentKey: "URL00001",
      }),
      (error: unknown) =>
        error instanceof SourceGatewayError && error.code === "wrong-kind",
    );
  } finally {
    restore();
  }
});
