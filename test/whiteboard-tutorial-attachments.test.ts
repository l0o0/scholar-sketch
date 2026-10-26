import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  parseStoredCanvas,
  serializeCanvasDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import {
  tutorialCanvasDocument,
  type TutorialCanvasLabels,
} from "../packages/whiteboard/src/model/tutorial.ts";
import {
  ensureTutorialAttachments,
  tutorialStartupIsCurrent,
  parseTutorialAttachmentState,
  TUTORIAL_VERSION,
  type TutorialAttachmentState,
  type TutorialAttachmentDependencies,
} from "../src/modules/whiteboard/tutorial-attachments.ts";
import type { TutorialKind } from "../src/modules/whiteboard/tutorial-discovery.ts";

const labels: TutorialCanvasLabels = {
  title: "Scholar Sketch Academic Whiteboard.canvas",
  welcome: "Welcome",
  welcomeBody: "Learn Scholar Sketch",
  quickStart: "Quick controls",
  quickStartBody: "Hold Space and drag to pan.",
  sourceNotice: "Your sources stay unchanged",
  addLiterature: "Add literature",
  addLiteratureBody: "Drag an item here",
  browseQuotes: "Browse quotes",
  browseQuotesBody: "Add useful evidence",
  writeNote: "Write a note",
  writeNoteBody: "Develop a thought",
  questionBadge: "Question",
  claimBadge: "Viewpoint",
  organize: "Organize",
  organizeBody: "Group related ideas",
  practice: "Practice",
  practiceBody: "Try it here",
  supports: "Supports",
  exampleSource: "Your first source",
  exampleSourceBody: "Drag a paper from your library here.",
  exampleQuote: "Make room for evidence",
  exampleQuoteBody: "Add an excerpt that matters to your question.",
  imageTitle: "Images & PDF snapshots",
  imageBody: "Keep a visual beside your ideas.",
  attachmentTitle: "Start writing.md",
  attachmentBody: "Right-click to open the Markdown attachment.",
  attachmentContent: "# Start writing\n\n- Collect evidence\n- Ask a question",
  colorNote: "Capture a reading note.",
  colorEvidence: "Keep a useful passage and its source.",
  colorSummary: "Bring together agreements and differences.",
  organizeAction: "Arrange and personalize",
  colorQuestion: "What remains uncertain?",
  colorClaim: "Connect evidence to your own interpretation.",
  colorBody: "Select a card to change its colors.",
  share: "Share your thinking",
  shareBody: "Right-click the canvas to export PNG.",
};

function example(overrides: Partial<TutorialCanvasLabels> = {}) {
  return tutorialCanvasDocument({ ...labels, ...overrides });
}

function attachmentNode(document: CanvasDocument) {
  const node = document.nodes.find((node) => node.id === "tutorial-attachment");
  assert.ok(node?.kind === "attachment");
  return node;
}

function welcomeNode(document: CanvasDocument) {
  const node = document.nodes.find((node) => node.id === "tutorial-welcome");
  assert.ok(node?.kind === "note");
  return node;
}

function fixture() {
  const items = new Map<TutorialKind, Zotero.Item>();
  const resolvable = new Map<
    string,
    { kind: TutorialKind; item: Zotero.Item }
  >();
  const files = new Map<number, string | null>();
  const state: TutorialAttachmentState = {};
  const searches: TutorialKind[] = [];
  const marks: Array<{ id: number; kind: TutorialKind }> = [];
  const created: TutorialKind[] = [];
  const writes: Array<{ id: number; revision: string }> = [];
  const resolved: Array<{ kind: TutorialKind; key: string }> = [];
  const reads: number[] = [];
  let nextID = 40;
  const add = (kind: TutorialKind, content: string | null) => {
    const id = nextID++;
    const item = { id, key: `START${id + 222}` } as Zotero.Item;
    items.set(kind, item);
    resolvable.set(item.key, { item, kind });
    files.set(id, content);
    return item;
  };
  const deps: TutorialAttachmentDependencies = {
    find: async (kind) => {
      searches.push(kind);
      return items.get(kind) ?? null;
    },
    resolve: async (kind, key) => {
      resolved.push({ kind, key });
      const value = resolvable.get(key);
      return value?.kind === kind ? value.item : null;
    },
    state: () => structuredClone(state),
    remember: (next) => {
      delete state.markdown;
      delete state.canvas;
      Object.assign(state, structuredClone(next));
    },
    mark: async (item, kind) => {
      marks.push({ id: item.id, kind });
    },
    read: async (item) => {
      reads.push(item.id);
      assert.ok(files.has(item.id));
      return files.get(item.id)!;
    },
    createMarkdown: async (content, title) => {
      assert.equal(title, labels.attachmentTitle);
      created.push("markdown");
      return add("markdown", content);
    },
    createCanvas: async (document, title) => {
      assert.equal(title, labels.title);
      created.push("canvas");
      return add("canvas", serializeCanvasDocument(document));
    },
    updateCanvas: async (item, document, revision) => {
      assert.equal(
        files.get(item.id),
        revision,
        "stale revisions must not write",
      );
      files.set(item.id, serializeCanvasDocument(document));
      writes.push({ id: item.id, revision });
    },
  };
  const run = async (document = example(), version = TUTORIAL_VERSION) => {
    const result = await ensureTutorialAttachments(
      document,
      labels.title,
      deps,
      version,
      "manual",
    );
    assert.ok(!("deleted" in result));
    return result;
  };
  const readCanvas = () => {
    const item = items.get("canvas")!;
    const parsed = parseStoredCanvas(files.get(item.id));
    assert.deepEqual(parsed.issues, []);
    return parsed.document;
  };
  const contents = () =>
    [...files].map(([id, text]) => [
      id,
      createHash("sha256")
        .update(text ?? "")
        .digest("hex"),
    ]);
  return {
    items,
    resolvable,
    files,
    state,
    searches,
    marks,
    created,
    writes,
    resolved,
    reads,
    add,
    deps,
    run,
    readCanvas,
    contents,
  };
}

test("first creation records a portable pair locally and subsequent calls reuse it", async () => {
  const host = fixture();
  const source = example();
  attachmentNode(source).data.attachmentID = 912;
  const original = structuredClone(source);
  const first = await host.run(source);
  const markdown = host.items.get("markdown")!;
  const before = host.contents();
  assert.equal(first.created, true);
  assert.deepEqual(await host.run(), { canvas: first.canvas, created: false });
  assert.deepEqual(host.created, ["markdown", "canvas"]);
  assert.deepEqual(host.contents(), before);
  assert.deepEqual(host.writes, []);
  assert.deepEqual(host.searches, ["canvas", "markdown"]);
  assert.deepEqual(host.state, {
    markdown: { key: markdown.key, version: TUTORIAL_VERSION },
    canvas: { key: first.canvas.key, version: TUTORIAL_VERSION },
  });
  assert.deepEqual(attachmentNode(host.readCanvas()).data.source, {
    library: { type: "user" },
    attachmentKey: markdown.key,
  });
  assert.equal(attachmentNode(host.readCanvas()).data.attachmentID, undefined);
  assert.deepEqual(source, original);
});

test("same tutorial version preserves generated content when labels change", async () => {
  const host = fixture();
  await host.run();
  const before = host.contents();
  await host.run(example({ welcomeBody: "Changed without a version bump" }));
  assert.deepEqual(host.contents(), before);
  assert.deepEqual(host.writes, []);
});

test("legacy existing tutorials are adopted without overwriting user text", async () => {
  const host = fixture();
  const markdown = host.add("markdown", "# My research\n\nKeep my writing.");
  const document = example({ welcomeBody: "My own canvas note" });
  attachmentNode(document).data.source = {
    library: { type: "user" },
    attachmentKey: markdown.key,
  };
  const canvas = host.add("canvas", serializeCanvasDocument(document));
  const before = host.contents();
  assert.deepEqual(await host.run(), { canvas, created: false });
  assert.deepEqual(host.contents(), before);
  assert.deepEqual(host.created, []);
  assert.deepEqual(host.writes, []);
  assert.equal(host.state.canvas?.version, TUTORIAL_VERSION);
  assert.equal(host.state.markdown?.key, markdown.key);
});

test("a renamed Markdown is found through the portable link before a title match", async () => {
  const host = fixture();
  const markdown = host.add("markdown", "# Renamed reading practice");
  const document = example();
  attachmentNode(document).data.source = {
    library: { type: "user" },
    attachmentKey: markdown.key,
  };
  host.add("canvas", serializeCanvasDocument(document));
  const unrelated = host.add("markdown", "# Separate same-title match");
  const before = host.contents();
  await host.run();
  assert.equal(host.state.markdown?.key, markdown.key);
  assert.notEqual(host.state.markdown?.key, unrelated.key);
  assert.deepEqual(host.contents(), before);
  assert.deepEqual(host.created, []);
});

test("a current tutorial resolves its saved keys without title searches or local file reads", async () => {
  const host = fixture();
  const first = await host.run();
  host.searches.length = 0;
  host.items.clear();
  for (const id of host.files.keys()) host.files.set(id, null);
  assert.equal(await tutorialStartupIsCurrent(true, host.deps), true);
  assert.deepEqual(await host.run(), { canvas: first.canvas, created: false });
  assert.deepEqual(host.searches, []);
  assert.deepEqual(host.reads, []);
  assert.deepEqual(host.created, ["markdown", "canvas"]);
});

test("existing undistributed files are reused, while an unknown missing partner waits for download", async () => {
  const host = fixture();
  host.add("markdown", null);
  const canvas = host.add("canvas", null);
  assert.deepEqual(await host.run(), { canvas, created: false });
  assert.deepEqual(host.created, []);
  assert.deepEqual(host.writes, []);
  delete host.state.markdown;
  delete host.state.canvas;
  host.items.delete("markdown");
  await assert.rejects(host.run(), /Download the existing tutorial canvas/);
  assert.deepEqual(host.created, []);
});

test("a newer tutorial version creates a separate pair and preserves every old file", async () => {
  const host = fixture();
  const first = await host.run();
  const oldMarkdown = host.items.get("markdown")!;
  host.files.set(oldMarkdown.id, "# My edited research");
  const oldDocument = host.readCanvas();
  welcomeNode(oldDocument).content = "My edited Canvas";
  host.files.set(first.canvas.id, serializeCanvasDocument(oldDocument));
  const before = new Map(host.files);
  const upgraded = await host.run(
    example({ welcomeBody: "Version 2" }),
    TUTORIAL_VERSION + 1,
  );
  assert.notEqual(upgraded.canvas.id, first.canvas.id);
  assert.equal(upgraded.created, true);
  assert.deepEqual(host.created, ["markdown", "canvas", "markdown", "canvas"]);
  for (const [id, text] of before) assert.equal(host.files.get(id), text);
  assert.deepEqual(host.writes, []);
  assert.equal(host.state.canvas?.version, TUTORIAL_VERSION + 1);
  assert.equal(host.state.markdown?.version, TUTORIAL_VERSION + 1);
  assert.equal(welcomeNode(host.readCanvas()).content, "Version 2");
  assert.equal(
    attachmentNode(host.readCanvas()).data.source?.attachmentKey,
    host.state.markdown?.key,
  );
});

for (const upgrading of [false, true]) {
  test(`${upgrading ? "upgrade" : "first creation"} retries reuse the Markdown created before Canvas failure`, async () => {
    const host = fixture();
    if (upgrading) await host.run();
    const version = TUTORIAL_VERSION + Number(upgrading);
    const createCanvas = host.deps.createCanvas;
    host.deps.createCanvas = async () => null;
    await assert.rejects(
      host.run(example(), version),
      /Could not create tutorial whiteboard/,
    );
    const partialMarkdown = host.state.markdown!;
    assert.equal(partialMarkdown.version, version);
    assert.equal(
      await tutorialStartupIsCurrent(true, host.deps, version),
      false,
    );
    host.deps.createCanvas = createCanvas;
    await host.run(example(), version);
    assert.deepEqual(host.state.markdown, partialMarkdown);
    assert.equal(
      host.created.filter((kind) => kind === "markdown").length,
      upgrading ? 2 : 1,
    );
    assert.equal(
      attachmentNode(host.readCanvas()).data.source?.attachmentKey,
      partialMarkdown.key,
    );
  });
}

for (const kind of ["markdown", "canvas"] as const) {
  test(`a deleted recorded ${kind} prevents automatic recreation even when the tutorial version increases`, async () => {
    const host = fixture();
    await host.run();
    host.resolvable.delete(host.state[kind]!.key);
    const before = host.contents();
    assert.equal(
      await tutorialStartupIsCurrent(true, host.deps, TUTORIAL_VERSION + 1),
      true,
    );
    assert.deepEqual(host.contents(), before);
    assert.equal(host.created.length, 2);
  });
  test(`${kind} discovery failures abort without producing duplicate tutorials`, async () => {
    const host = fixture();
    const find = host.deps.find;
    host.deps.find = async (requested, titles) => {
      if (requested === kind) throw new Error("search unavailable");
      return find(requested, titles);
    };
    await assert.rejects(host.run(), /search unavailable/);
    assert.deepEqual(host.created, []);
    assert.deepEqual(host.state, {});
  });
}

test("explicit recovery of a deleted Markdown creates a linked pair and keeps the original Canvas intact", async () => {
  const host = fixture();
  const first = await host.run();
  const oldCanvasText = host.files.get(first.canvas.id);
  const oldMarkdown = host.state.markdown!.key;
  host.resolvable.delete(oldMarkdown);
  host.items.delete("markdown");
  const restored = await host.run();
  assert.notEqual(restored.canvas.id, first.canvas.id);
  assert.notEqual(host.state.markdown?.key, oldMarkdown);
  assert.equal(host.files.get(first.canvas.id), oldCanvasText);
  assert.equal(
    attachmentNode(host.readCanvas()).data.source?.attachmentKey,
    host.state.markdown?.key,
  );
  assert.deepEqual(host.writes, []);
});

test("explicit recovery of a deleted Canvas reuses the surviving current Markdown", async () => {
  const host = fixture();
  await host.run();
  const markdown = host.state.markdown!.key;
  const canvas = host.state.canvas!.key;
  host.resolvable.delete(canvas);
  host.items.delete("canvas");
  await host.run();
  assert.equal(host.state.markdown?.key, markdown);
  assert.notEqual(host.state.canvas?.key, canvas);
  assert.deepEqual(host.created, ["markdown", "canvas", "canvas"]);
});

test("legacy completion prevents resurrecting a removed tutorial but adopts a surviving Canvas", async () => {
  const host = fixture();
  assert.equal(await tutorialStartupIsCurrent(true, host.deps), true);
  assert.equal(await tutorialStartupIsCurrent(false, host.deps), false);
  host.add("canvas", null);
  assert.equal(await tutorialStartupIsCurrent(true, host.deps), false);
  assert.deepEqual(host.created, []);
});

test("future tutorial versions are reused without being downgraded", async () => {
  const host = fixture();
  await host.run(example(), TUTORIAL_VERSION + 1);
  const before = host.contents();
  assert.equal(await tutorialStartupIsCurrent(true, host.deps), true);
  await host.run();
  assert.equal(host.state.canvas?.version, TUTORIAL_VERSION + 1);
  assert.equal(host.state.markdown?.version, TUTORIAL_VERSION + 1);
  assert.deepEqual(host.contents(), before);
});

test("saved identity lookup failure is not treated as deletion", async () => {
  const host = fixture();
  await host.run();
  host.deps.resolve = async () => {
    throw new Error("metadata unavailable");
  };
  await assert.rejects(
    tutorialStartupIsCurrent(true, host.deps),
    /metadata unavailable/,
  );
  await assert.rejects(host.run(), /metadata unavailable/);
  assert.equal(host.created.length, 2);
});

test("legacy local-ID migration changes only the demo link and preserves user content", async () => {
  const host = fixture();
  const document = example({ welcomeBody: "My custom body" });
  attachmentNode(document).data.attachmentID = 913;
  host.add("canvas", serializeCanvasDocument(document));
  host.add("markdown", "# Existing practice");
  await host.run();
  const markdown = host.items.get("markdown")!;
  const expected = structuredClone(document);
  attachmentNode(expected).data.source = {
    library: { type: "user" },
    attachmentKey: markdown.key,
  };
  delete attachmentNode(expected).data.attachmentID;
  const actual = host.readCanvas();
  delete actual.metadata;
  assert.deepEqual(actual, expected);
  assert.equal(host.writes.length, 1);
});

test("a stale legacy-link update keeps the external edit and does not retry blindly", async () => {
  const host = fixture();
  const canvas = host.add("canvas", serializeCanvasDocument(example()));
  host.add("markdown", "# Existing practice");
  host.deps.updateCanvas = async () => {
    host.files.set(canvas.id, "External edit");
    throw new Error("stale revision");
  };
  await assert.rejects(host.run(), /stale revision/);
  assert.equal(host.files.get(canvas.id), "External edit");
  assert.deepEqual(host.created, []);
  assert.deepEqual(host.state, {});
  assert.equal(await tutorialStartupIsCurrent(true, host.deps), false);
});

test("portable lookup failure aborts adoption without creating or modifying files", async () => {
  const host = fixture();
  const document = example();
  attachmentNode(document).data.source = {
    library: { type: "user" },
    attachmentKey: "RENAMED2",
  };
  host.add("canvas", serializeCanvasDocument(document));
  host.deps.resolve = async () => {
    throw new Error("portable lookup failed");
  };
  const before = host.contents();
  await assert.rejects(host.run(), /portable lookup failed/);
  assert.deepEqual(host.contents(), before);
  assert.deepEqual(host.created, []);
});

test("local tutorial preference validates keys and versions without accepting malformed records", () => {
  assert.deepEqual(parseTutorialAttachmentState(""), {});
  assert.deepEqual(parseTutorialAttachmentState(undefined), {});
  const state = {
    markdown: { key: "START267", version: 1 },
    canvas: { key: "START268", version: 2 },
  };
  assert.deepEqual(parseTutorialAttachmentState(JSON.stringify(state)), state);
  for (const invalid of [
    "{bad",
    "null",
    "[]",
    { canvas: { key: "../x", version: 1 } },
    { markdown: { key: "START267", version: 0 } },
    { canvas: { key: "START268", version: 1.5 } },
  ]) {
    assert.throws(() => parseTutorialAttachmentState(invalid));
  }
});

test("restoring a deleted Markdown retries the new Canvas after a partial failure", async () => {
  const host = fixture();
  const first = await host.run();
  const oldCanvasText = host.files.get(first.canvas.id);
  host.resolvable.delete(host.state.markdown!.key);
  const createCanvas = host.deps.createCanvas;
  host.deps.createCanvas = async () => null;
  await assert.rejects(host.run(), /Could not create tutorial whiteboard/);
  const newMarkdown = host.state.markdown!.key;
  assert.equal(host.state.canvas, undefined);
  assert.equal(await tutorialStartupIsCurrent(true, host.deps), false);
  host.deps.createCanvas = createCanvas;
  const result = await ensureTutorialAttachments(
    example(),
    labels.title,
    host.deps,
  );
  assert.ok(!("deleted" in result));
  assert.notEqual(result.canvas.id, first.canvas.id);
  assert.equal(host.files.get(first.canvas.id), oldCanvasText);
  assert.equal(
    attachmentNode(host.readCanvas()).data.source?.attachmentKey,
    newMarkdown,
  );
  assert.deepEqual(host.created, ["markdown", "canvas", "markdown", "canvas"]);
});

for (const portable of [false, true]) {
  test(`automatic legacy adoption never recreates a missing ${portable ? "portable" : "machine-local"} Markdown target`, async () => {
    const host = fixture();
    const document = example();
    if (portable)
      attachmentNode(document).data.source = {
        library: { type: "user" },
        attachmentKey: "DELETED2",
      };
    else attachmentNode(document).data.attachmentID = 77;
    const canvas = host.add("canvas", serializeCanvasDocument(document));
    if (portable) host.add("markdown", "# An unrelated same-title note");
    const before = host.contents();
    const result = await ensureTutorialAttachments(
      example(),
      labels.title,
      host.deps,
    );
    assert.deepEqual(result, { canvas, created: false });
    assert.deepEqual(host.created, []);
    assert.deepEqual(host.contents(), before);
    assert.equal(await tutorialStartupIsCurrent(true, host.deps), true);
    if (portable) assert.equal(host.state.markdown?.key, "DELETED2");
    await host.run();
    assert.equal(host.created.filter((kind) => kind === "canvas").length, 1);
    assert.equal(
      attachmentNode(host.readCanvas()).data.source?.attachmentKey,
      host.state.markdown?.key,
    );
  });
}

test("automatic creation rechecks deletion after the initial startup check", async () => {
  const host = fixture();
  await host.run();
  assert.equal(
    await tutorialStartupIsCurrent(true, host.deps, TUTORIAL_VERSION + 1),
    false,
  );
  host.resolvable.delete(host.state.canvas!.key);
  const before = host.contents();
  assert.deepEqual(
    await ensureTutorialAttachments(
      example(),
      labels.title,
      host.deps,
      TUTORIAL_VERSION + 1,
    ),
    { deleted: true },
  );
  assert.deepEqual(host.contents(), before);
  assert.deepEqual(host.created, ["markdown", "canvas"]);
});

test("legacy link repair retries after an IO failure before recording the pair as current", async () => {
  const host = fixture();
  const markdown = host.add("markdown", "# Existing notes");
  const document = example();
  attachmentNode(document).data.attachmentID = 99;
  const canvas = host.add("canvas", serializeCanvasDocument(document));
  const before = host.contents();
  const update = host.deps.updateCanvas;
  host.deps.updateCanvas = async () => {
    throw new Error("Disk write failed");
  };
  await assert.rejects(host.run(), /Disk write failed/);
  assert.deepEqual(host.state, {});
  assert.deepEqual(host.contents(), before);
  assert.equal(await tutorialStartupIsCurrent(true, host.deps), false);
  host.deps.updateCanvas = update;
  assert.deepEqual(await host.run(), { canvas, created: false });
  assert.equal(
    attachmentNode(host.readCanvas()).data.source?.attachmentKey,
    markdown.key,
  );
  assert.equal(await tutorialStartupIsCurrent(true, host.deps), true);
  assert.deepEqual(host.created, []);
});

test("production adoption writes local preferences and never calls SyncedSettings", async (t) => {
  const host = fixture();
  const markdown = host.add("markdown", "# Existing notes");
  const document = example();
  attachmentNode(document).data.source = {
    library: { type: "user" },
    attachmentKey: markdown.key,
  };
  const canvas = host.add("canvas", serializeCanvasDocument(document));
  const items = [markdown, canvas];
  for (const item of items) {
    Object.assign(item, {
      libraryID: 1,
      deleted: false,
      attachmentFilename: item === markdown ? "note.md" : "board.canvas",
      attachmentContentType: "",
      attachmentLinkMode: 0,
      isAttachment: () => true,
      getFilePathAsync: async () => String(item.id),
      hasTag: () => true,
    });
  }
  let pref = "";
  let writes = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Libraries: { userLibraryID: 1 },
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      Utilities: {
        isValidObjectKey: (key: string) => /^[A-Z0-9]{8}$/.test(key),
      },
      Prefs: {
        get(key: string, global: boolean) {
          assert.equal(key, "extensions.zotero.bamboo.tutorialAttachments");
          assert.equal(global, true);
          return pref;
        },
        set(key: string, value: string, global: boolean) {
          assert.equal(key, "extensions.zotero.bamboo.tutorialAttachments");
          assert.equal(global, true);
          pref = value;
          writes++;
        },
      },
      get SyncedSettings() {
        assert.fail("Tutorial configuration must not access synced settings");
      },
      Search: class {
        addCondition() {}
        async search() {
          return items.map((item) => item.id);
        }
      },
      Items: {
        getAsync: async (ids: number[]) =>
          items.filter((item) => ids.includes(item.id)),
        getByLibraryAndKeyAsync: async (_library: number, key: string) =>
          items.find((item) => item.key === key) ?? null,
        loadDataTypes: async () => {},
      },
      File: {
        getContentsAsync: async (path: string) => host.files.get(Number(path)),
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Zotero", previous);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  assert.deepEqual(await ensureTutorialAttachments(example(), labels.title), {
    canvas,
    created: false,
  });
  assert.deepEqual(JSON.parse(pref), {
    markdown: { key: markdown.key, version: TUTORIAL_VERSION },
    canvas: { key: canvas.key, version: TUTORIAL_VERSION },
  });
  assert.equal(writes, 1);
  assert.equal(await tutorialStartupIsCurrent(true), true);
  await ensureTutorialAttachments(example(), labels.title);
  assert.equal(
    writes,
    1,
    "unchanged local preferences do not need another write",
  );
});
