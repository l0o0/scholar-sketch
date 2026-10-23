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
  canvasDocumentToFlow,
  flowToCanvasDocument,
} from "../packages/whiteboard/src/whiteboard/document.ts";
import {
  ensureTutorialAttachments,
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
  const resolvable = new Map<string, Zotero.Item>();
  const files = new Map<number, string | null>();
  const baselines = new Map<number, string>();
  const searches: Array<{ kind: TutorialKind; titles: readonly string[] }> = [];
  const marks: Array<{ id: number; kind: TutorialKind }> = [];
  const created: TutorialKind[] = [];
  const writes: Array<{ id: number; revision: string }> = [];
  const remembered: Array<{ id: number; fingerprint: string }> = [];
  const logs: string[] = [];
  const resolvedKeys: string[] = [];
  let nextID = 40;
  const add = (kind: TutorialKind, content: string | null) => {
    const id = nextID++;
    let title = kind === "markdown" ? labels.attachmentTitle : labels.title;
    const item = {
      id,
      key: `START${id + 222}`,
      getField(field: string) {
        assert.equal(field, "title");
        return title;
      },
      setField(field: string, value: unknown) {
        assert.equal(field, "title");
        title = String(value);
        return true;
      },
    } as Zotero.Item;
    items.set(kind, item);
    if (kind === "markdown") resolvable.set(item.key, item);
    files.set(id, content);
    return item;
  };
  const write = (item: Zotero.Item, content: string, revision: string) => {
    assert.equal(
      files.get(item.id),
      revision,
      "a stale revision must not write",
    );
    files.set(item.id, content);
    writes.push({ id: item.id, revision });
  };
  const deps: TutorialAttachmentDependencies = {
    find: async (kind, titles) => {
      searches.push({ kind, titles });
      return items.get(kind) ?? null;
    },
    resolveMarkdown: async (key) => {
      assert.match(key, /^[A-Z2-9]{8}$/);
      resolvedKeys.push(key);
      return resolvable.get(key) ?? null;
    },
    mark: async (item, kind) => {
      marks.push({ id: item.id, kind });
    },
    read: async (item) => {
      assert.ok(files.has(item.id));
      return files.get(item.id)!;
    },
    fingerprint: (content) => createHash("md5").update(content).digest("hex"),
    baseline: (item) => baselines.get(item.id),
    remember: async (item, fingerprint) => {
      baselines.set(item.id, fingerprint);
      remembered.push({ id: item.id, fingerprint });
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
    updateMarkdown: async (item, content, revision) =>
      write(item, content, revision),
    updateCanvas: async (item, document, revision) =>
      write(item, serializeCanvasDocument(document), revision),
    log: (message) => logs.push(message),
  };
  const run = (document = example()) =>
    ensureTutorialAttachments(document, labels.title, deps);
  const readCanvas = () => {
    const item = items.get("canvas")!;
    const parsed = parseStoredCanvas(files.get(item.id));
    assert.deepEqual(parsed.issues, []);
    return parsed.document;
  };
  return {
    items,
    resolvable,
    files,
    baselines,
    searches,
    marks,
    created,
    writes,
    remembered,
    logs,
    resolvedKeys,
    add,
    deps,
    run,
    readCanvas,
  };
}

test("repeated onboarding searches reuse the same pair without a local completion marker", async () => {
  const host = fixture();
  const source = example();
  attachmentNode(source).data.attachmentID = 912;
  const original = structuredClone(source);
  const first = await host.run(source);
  const markdown = host.items.get("markdown")!;
  const firstFiles = new Map(host.files);

  assert.equal(await host.run(source), first);
  assert.equal(await host.run(source), first);

  assert.deepEqual(host.created, ["markdown", "canvas"]);
  assert.equal(host.items.size, 2);
  assert.deepEqual(host.files, firstFiles);
  assert.deepEqual(host.writes, []);
  assert.equal(host.searches.length, 6);
  assert.deepEqual(attachmentNode(host.readCanvas()).data.source, {
    library: { type: "user" },
    attachmentKey: markdown.key,
  });
  assert.equal(attachmentNode(host.readCanvas()).data.attachmentID, undefined);
  assert.deepEqual(source, original, "the caller's document is not mutated");
  assert.equal(
    host.baselines.get(markdown.id),
    host.deps.fingerprint(labels.attachmentContent),
  );
});

test("existing Markdown and Canvas keep their IDs and contents while establishing a safe baseline", async () => {
  const host = fixture();
  const markdown = host.add("markdown", labels.attachmentContent);
  const document = example();
  attachmentNode(document).data.source = {
    library: { type: "user" },
    attachmentKey: markdown.key,
  };
  const canvas = host.add("canvas", serializeCanvasDocument(document));
  const files = new Map(host.files);

  assert.equal(await host.run(), canvas);
  assert.deepEqual(host.created, []);
  assert.deepEqual(host.files, files);
  assert.deepEqual(host.writes, []);
  assert.ok(host.baselines.has(markdown.id));
  assert.ok(host.baselines.has(canvas.id));
});

test("an existing Markdown is reused when only its Canvas partner is missing", async () => {
  const host = fixture();
  const markdown = host.add("markdown", "# My notes\n\nKeep this text.");

  await host.run();

  assert.deepEqual(host.created, ["canvas"]);
  assert.equal(host.files.get(markdown.id), "# My notes\n\nKeep this text.");
  assert.equal(
    attachmentNode(host.readCanvas()).data.source?.attachmentKey,
    markdown.key,
  );
  assert.equal(host.baselines.has(markdown.id), false);
});

test("a missing Markdown partner is recreated and linked from the existing managed Canvas", async () => {
  const host = fixture();
  const canvas = await host.run();
  const oldMarkdown = host.items.get("markdown")!;
  host.items.delete("markdown");
  host.resolvable.delete(oldMarkdown.key);
  host.files.delete(oldMarkdown.id);

  assert.equal(await host.run(), canvas);

  const markdown = host.items.get("markdown")!;
  assert.notEqual(markdown.id, oldMarkdown.id);
  assert.deepEqual(host.created, ["markdown", "canvas", "markdown"]);
  assert.equal(
    attachmentNode(host.readCanvas()).data.source?.attachmentKey,
    markdown.key,
  );
  assert.equal(host.writes.length, 1);
  assert.equal(host.writes[0].id, canvas.id);
});

test("a Canvas creation failure leaves the created Markdown available for retry", async () => {
  const host = fixture();
  const createCanvas = host.deps.createCanvas;
  host.deps.createCanvas = async () => null;

  await assert.rejects(host.run(), /Could not create tutorial whiteboard/);
  const markdown = host.items.get("markdown")!;
  assert.ok(markdown);
  assert.equal(host.files.get(markdown.id), labels.attachmentContent);
  host.deps.createCanvas = createCanvas;

  await host.run();

  assert.equal(host.items.get("markdown"), markdown);
  assert.deepEqual(host.created, ["markdown", "canvas"]);
  assert.equal(
    attachmentNode(host.readCanvas()).data.source?.attachmentKey,
    markdown.key,
  );
});

for (const kind of ["markdown", "canvas"] as const) {
  test(`${kind} search failure aborts before creating or changing either attachment`, async () => {
    const host = fixture();
    const find = host.deps.find;
    const failure = new Error("Zotero search unavailable");
    host.deps.find = async (requested, titles) => {
      if (requested === kind) throw failure;
      return find(requested, titles);
    };

    await assert.rejects(host.run(), failure);

    assert.deepEqual(host.created, []);
    assert.deepEqual(host.marks, []);
    assert.deepEqual(host.writes, []);
    assert.equal(host.files.size, 0);
  });
}

test("synced attachments with unavailable local files are reused without writes or new baselines", async () => {
  const host = fixture();
  const markdown = host.add("markdown", null);
  const canvas = host.add("canvas", null);

  assert.equal(await host.run(), canvas);
  assert.equal(await host.run(), canvas);

  assert.deepEqual(host.created, []);
  assert.deepEqual(host.writes, []);
  assert.deepEqual(host.remembered, []);
  assert.equal(host.files.get(markdown.id), null);
  assert.equal(host.files.get(canvas.id), null);
});

test("a renamed Markdown absent from title search is reused through its existing Canvas key", async () => {
  const host = fixture();
  const markdown = host.add(
    "markdown",
    "# Renamed research notes\n\nKeep these edits.",
  );
  markdown.setField("title", "Renamed research notes");
  host.items.delete("markdown");
  const document = example();
  attachmentNode(document).data.source = {
    library: { type: "user" },
    attachmentKey: markdown.key,
  };
  welcomeNode(document).content = "My edited tutorial";
  const canvas = host.add("canvas", serializeCanvasDocument(document));
  const before = new Map(host.files);

  assert.equal(await host.run(), canvas);

  assert.deepEqual(host.resolvedKeys, [markdown.key]);
  assert.deepEqual(host.created, []);
  assert.deepEqual(host.files, before);
  assert.deepEqual(host.writes, []);
  assert.deepEqual(host.marks, [
    { id: markdown.id, kind: "markdown" },
    { id: canvas.id, kind: "canvas" },
  ]);
});

test("the existing Canvas link takes priority over a separate same-title Markdown match", async () => {
  const host = fixture();
  const original = host.add(
    "markdown",
    "# Original renamed tutorial\n\nUser content.",
  );
  original.setField("title", "Original renamed tutorial");
  const unrelated = host.add(
    "markdown",
    "# Unrelated document with the same title",
  );
  const document = example();
  attachmentNode(document).data.source = {
    library: { type: "user" },
    attachmentKey: original.key,
  };
  const canvas = host.add("canvas", serializeCanvasDocument(document));
  const before = new Map(host.files);

  assert.equal(await host.run(), canvas);

  assert.deepEqual(host.resolvedKeys, [original.key]);
  assert.deepEqual(host.created, []);
  assert.deepEqual(host.files, before);
  assert.ok(host.marks.some((entry) => entry.id === original.id));
  assert.equal(
    host.marks.some((entry) => entry.id === unrelated.id),
    false,
  );
  assert.equal(host.baselines.has(unrelated.id), false);
  assert.equal(
    attachmentNode(host.readCanvas()).data.source?.attachmentKey,
    original.key,
  );
});

test("a linked Markdown lookup failure aborts before creating or modifying attachments", async () => {
  const host = fixture();
  const document = example();
  attachmentNode(document).data.source = {
    library: { type: "user" },
    attachmentKey: "ABCD2345",
  };
  host.add("canvas", serializeCanvasDocument(document));
  const before = new Map(host.files);
  const failure = new Error("Linked item lookup unavailable");
  host.deps.resolveMarkdown = async () => {
    throw failure;
  };

  await assert.rejects(host.run(), failure);

  assert.deepEqual(host.created, []);
  assert.deepEqual(host.files, before);
  assert.deepEqual(host.writes, []);
  assert.deepEqual(host.marks, []);
  assert.deepEqual(host.remembered, []);
});

test("an unavailable Canvas file defers Markdown creation until its existing link can be inspected", async () => {
  const host = fixture();
  const canvas = host.add("canvas", null);

  await assert.rejects(host.run());

  assert.deepEqual(host.created, []);
  assert.equal(host.files.get(canvas.id), null);
  assert.equal(host.items.has("markdown"), false);
  assert.deepEqual(host.writes, []);
  assert.deepEqual(host.remembered, []);
});

test("an untouched generated pair updates in place while preserving Canvas viewing state", async () => {
  const host = fixture();
  const canvas = await host.run();
  const markdown = host.items.get("markdown")!;
  const viewed = host.readCanvas();
  const viewport = { x: 184, y: -252, zoom: 0.8 };
  viewed.viewport = viewport;
  const createdAt = viewed.metadata?.createdAt;
  host.files.set(
    canvas.id,
    serializeCanvasDocument(viewed, { now: "2026-10-22T08:00:00Z" }),
  );
  const before = new Map(host.files);
  const revised = example({
    welcomeBody: "New whiteboard instructions",
    attachmentContent: "# Start writing\n\nNew Markdown instructions",
  });

  assert.equal(await host.run(revised), canvas);

  assert.deepEqual(host.created, ["markdown", "canvas"]);
  assert.equal(host.items.get("markdown"), markdown);
  assert.equal(
    host.files.get(markdown.id),
    attachmentNode(revised).data.preview,
  );
  const updated = host.readCanvas();
  assert.equal(welcomeNode(updated).content, "New whiteboard instructions");
  assert.deepEqual(updated.viewport, viewport);
  assert.equal(updated.metadata?.createdAt, createdAt);
  assert.deepEqual(host.writes, [
    { id: markdown.id, revision: before.get(markdown.id) },
    { id: canvas.id, revision: before.get(canvas.id) },
  ]);
  const written = new Map(host.files);
  await host.run(revised);
  assert.deepEqual(host.files, written);
  assert.equal(
    host.writes.length,
    2,
    "a second refresh has no redundant writes",
  );
});

test("saving an unchanged Canvas through the real editor preserves eligibility for tutorial updates", async () => {
  const host = fixture();
  const canvas = await host.run();
  const flow = canvasDocumentToFlow(host.readCanvas());
  const viewport = { x: 196, y: -142, zoom: 0.9 };
  const viewed = flowToCanvasDocument(
    flow.nodes,
    flow.edges,
    viewport,
    flow.shell,
  );
  const saved = serializeCanvasDocument(viewed);
  host.files.set(canvas.id, saved);

  assert.equal(
    await host.run(example({ welcomeBody: "Updated after viewing" })),
    canvas,
  );

  const updated = host.readCanvas();
  assert.equal(welcomeNode(updated).content, "Updated after viewing");
  assert.deepEqual(updated.viewport, viewport);
  assert.deepEqual(host.writes, [{ id: canvas.id, revision: saved }]);
  assert.deepEqual(host.created, ["markdown", "canvas"]);
});

test("a custom connection handle saved by the editor remains a user edit", async () => {
  const host = fixture();
  const canvas = await host.run();
  const baseline = host.baselines.get(canvas.id);
  const flow = canvasDocumentToFlow(host.readCanvas());
  assert.ok(flow.edges.length > 0);
  flow.edges[0].sourceHandle = "top";
  const edited = flowToCanvasDocument(
    flow.nodes,
    flow.edges,
    { x: 0, y: 0, zoom: 1 },
    flow.shell,
  );
  const saved = serializeCanvasDocument(edited);
  host.files.set(canvas.id, saved);

  assert.equal(
    await host.run(
      example({ welcomeBody: "New guide should not replace this" }),
    ),
    canvas,
  );

  assert.equal(host.files.get(canvas.id), saved);
  assert.equal(host.readCanvas().connections[0].sourceHandle, "top");
  assert.equal(host.baselines.get(canvas.id), baseline);
  assert.deepEqual(host.writes, []);
});

test("renaming a pristine Markdown preserves its body, title, and baseline on template refresh", async () => {
  const host = fixture();
  const canvas = await host.run();
  const markdown = host.items.get("markdown")!;
  const originalBody = host.files.get(markdown.id);
  const baseline = host.baselines.get(markdown.id);
  const remembered = host.remembered.filter(
    (entry) => entry.id === markdown.id,
  ).length;
  markdown.setField("title", "My reading notebook");

  assert.equal(
    await host.run(
      example({ attachmentContent: "# Updated starter instructions" }),
    ),
    canvas,
  );

  assert.equal(markdown.getField("title"), "My reading notebook");
  assert.equal(host.files.get(markdown.id), originalBody);
  assert.equal(host.baselines.get(markdown.id), baseline);
  assert.equal(
    host.remembered.filter((entry) => entry.id === markdown.id).length,
    remembered,
  );
  assert.equal(
    host.writes.some((entry) => entry.id === markdown.id),
    false,
  );
  assert.deepEqual(host.created, ["markdown", "canvas"]);
});

test("user edits to either generated attachment survive later template changes", async () => {
  const host = fixture();
  const canvas = await host.run();
  const markdown = host.items.get("markdown")!;
  host.files.set(markdown.id, "# Personal research\n\nDo not replace me.");
  const edited = host.readCanvas();
  welcomeNode(edited).content = "My own explanation";
  edited.viewport = { x: -120, y: 64, zoom: 0.6 };
  edited.nodes.push({
    ...structuredClone(edited.nodes[0]),
    id: "user-added-card",
  });
  host.files.set(canvas.id, serializeCanvasDocument(edited));
  const before = new Map(host.files);
  const baselines = new Map(host.baselines);
  const remembered = host.remembered.length;

  assert.equal(
    await host.run(
      example({
        welcomeBody: "Updated guide",
        attachmentContent: "# Updated starter note",
      }),
    ),
    canvas,
  );

  assert.deepEqual(host.files, before);
  assert.deepEqual(host.baselines, baselines);
  assert.equal(host.remembered.length, remembered);
  assert.deepEqual(host.writes, []);
  assert.deepEqual(host.created, ["markdown", "canvas"]);
});

for (const kind of ["markdown", "canvas"] as const) {
  test(`a stale ${kind} update preserves the external edit and does not advance its baseline`, async () => {
    const host = fixture();
    await host.run();
    const item = host.items.get(kind)!;
    const oldBaseline = host.baselines.get(item.id);
    const failure = new Error("Attachment changed after reading");
    const external =
      kind === "markdown"
        ? "# External Markdown edit"
        : serializeCanvasDocument(
            example({ welcomeBody: "External Canvas edit" }),
          );
    if (kind === "markdown") {
      host.deps.updateMarkdown = async () => {
        host.files.set(item.id, external);
        throw failure;
      };
    } else {
      host.deps.updateCanvas = async () => {
        host.files.set(item.id, external);
        throw failure;
      };
    }
    const remembersBefore = host.remembered.filter(
      (entry) => entry.id === item.id,
    ).length;

    await assert.rejects(
      host.run(
        example({
          welcomeBody: "Updated Canvas guide",
          attachmentContent: "# Updated Markdown guide",
        }),
      ),
      failure,
    );

    assert.equal(host.files.get(item.id), external);
    assert.equal(host.baselines.get(item.id), oldBaseline);
    assert.equal(
      host.remembered.filter((entry) => entry.id === item.id).length,
      remembersBefore,
    );
    assert.deepEqual(host.created, ["markdown", "canvas"]);
  });
}

test("legacy Canvas migration repairs only its machine-local Markdown link and keeps edits", async () => {
  const host = fixture();
  const markdown = host.add("markdown", "# My changed starter note");
  const legacy = example();
  welcomeNode(legacy).content = "A user's edited welcome card";
  legacy.viewport = { x: 77, y: -330, zoom: 1.25 };
  attachmentNode(legacy).data.attachmentID = 8901;
  legacy.nodes.push({ ...structuredClone(legacy.nodes[0]), id: "user-note" });
  const originalFile = serializeCanvasDocument(legacy);
  const canvas = host.add("canvas", originalFile);
  const expected = parseStoredCanvas(originalFile).document;
  attachmentNode(expected).data.source = {
    library: { type: "user" },
    attachmentKey: markdown.key,
  };
  delete attachmentNode(expected).data.attachmentID;

  assert.equal(await host.run(), canvas);

  assert.deepEqual(host.created, []);
  assert.equal(host.files.get(markdown.id), "# My changed starter note");
  // Saving legitimately changes updatedAt; every other persisted field stays intact.
  assert.equal(
    serializeCanvasDocument(host.readCanvas(), { now: "2026-10-22T00:00:00Z" }),
    serializeCanvasDocument(expected, { now: "2026-10-22T00:00:00Z" }),
  );
  assert.deepEqual(host.writes, [{ id: canvas.id, revision: originalFile }]);
  assert.deepEqual(
    host.remembered,
    [],
    "edited legacy content is never made a generated baseline",
  );
  const migrated = host.files.get(canvas.id);
  await host.run();
  assert.equal(host.files.get(canvas.id), migrated);
  assert.equal(host.writes.length, 1);
});

test("legacy canvases with a user-selected portable link retain it", async () => {
  const host = fixture();
  host.add("markdown", labels.attachmentContent);
  const legacy = example();
  const source = {
    library: { type: "user" as const },
    attachmentKey: "ABCD2345",
  };
  attachmentNode(legacy).data.source = source;
  welcomeNode(legacy).content = "Edited guide";
  const content = serializeCanvasDocument(legacy);
  const canvas = host.add("canvas", content);

  assert.equal(await host.run(), canvas);

  assert.equal(host.files.get(canvas.id), content);
  assert.deepEqual(attachmentNode(host.readCanvas()).data.source, source);
  assert.deepEqual(host.writes, []);
  assert.equal(host.baselines.has(canvas.id), false);
});
