import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserDemo,
  DEMO_STORAGE_KEY,
} from "../packages/whiteboard/src/devHost.ts";
import { emptyCanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import type { WhiteboardRuntime } from "../packages/whiteboard/src/whiteboard/app.tsx";
import type { IndexedAcademicAcquisition } from "../packages/whiteboard/src/model/protocol.ts";

test("browser transfer adapter preserves annotation identity through the production gateway", async () => {
  const demo = createBrowserDemo();
  const received: IndexedAcademicAcquisition[] = [];
  demo.callbacks.onReady({
    resolveAcademicAcquisitionBatch: (
      _requestId,
      _nodeId,
      successes,
      failures,
    ) => {
      assert.deepEqual(failures, []);
      received.push(...successes);
    },
  } as WhiteboardRuntime);
  const source = {
    library: { type: "user" as const },
    attachmentKey: "PDF00001",
    annotationKey: "QUOTE001",
    itemKey: "PAPER001",
  };
  try {
    await demo.callbacks.onDropAcademicSources("paste", "quote", [source]);
    assert.equal(received.length, 1);
    const acquired = received[0].acquisition;
    assert.equal(acquired.kind, "quote");
    assert.deepEqual(acquired.source, source);
    assert.match(acquired.snapshot.text, /reproducible fixture/);
  } finally {
    demo.dispose();
  }
});

test("fake library runs the production gateway, including note mutation and reader calls", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  const demo = createBrowserDemo();
  try {
    const source = { library: { type: "user" as const }, itemKey: "PAPER001" };
    const literature = await demo.gateway.resolve("paper", 1, {
      kind: "literature",
      source,
    });
    assert.equal(literature.status, "resolved");
    assert.equal(
      (await demo.gateway.listAnnotations(source)).candidates.length,
      1,
    );
    const { candidates } = await demo.gateway.listAnnotations(source);
    await demo.gateway.open({
      kind: "quote",
      source: candidates[0].acquisition.source,
    });
    assert.deepEqual(
      demo.fake.calls.find((call) => call.method === "Reader.open")?.args,
      [2, { annotationID: "QUOTE001" }],
    );
    const noteSource = {
      library: source.library,
      noteKey: "NOTE0001",
      itemKey: "PAPER001",
    };
    assert.match(
      (await demo.gateway.refreshNote(noteSource)).content,
      /Original note/,
    );
    await demo.updateNote();
    assert.match(
      (await demo.gateway.refreshNote(noteSource)).content,
      /Updated in the fake Zotero library/,
    );
    assert.equal(
      (
        await demo.gateway.resolve("missing", 2, {
          kind: "literature",
          source: { ...source, itemKey: "MISSING1" },
        })
      ).status,
      "unavailable",
    );
    demo.fake.reset();
    assert.match(
      (await demo.gateway.refreshNote(noteSource)).content,
      /Original note/,
    );
    assert.deepEqual(demo.fake.calls, []);
  } finally {
    demo.dispose();
  }
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, "Zotero"),
    previous,
  );
});

test("browser host saves and reloads a board, reports storage failures, and resets", () => {
  const values = new Map<string, string>();
  let failWrite = false;
  const messages: string[] = [];
  const demo = createBrowserDemo({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem(key, value) {
        if (failWrite) throw new Error("quota exceeded");
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    },
    report: (message) => messages.push(message),
  });
  let snapshot = emptyCanvasDocument();
  const states: string[] = [];
  // Only the host persistence boundary is replaced here; UI gets a browser check.
  const runtime = {
    getSnapshot: () => snapshot,
    loadSnapshot: (next: typeof snapshot) => {
      snapshot = next;
    },
    setSaveState: (state: string) => states.push(state),
  } as WhiteboardRuntime;
  try {
    assert.equal(demo.isReady, false);
    demo.callbacks.onReady(runtime);
    assert.equal(demo.isReady, true);
    demo.save();
    assert.deepEqual(states, ["saving", "saved"]);
    const saved = values.get(DEMO_STORAGE_KEY);
    snapshot = { ...snapshot, metadata: { title: "Changed" } };
    demo.reload();
    assert.deepEqual(snapshot, emptyCanvasDocument());
    failWrite = true;
    demo.save();
    assert.equal(states.at(-1), "error");
    assert.match(messages.at(-1)!, /quota exceeded/);
    assert.equal(values.get(DEMO_STORAGE_KEY), saved);
    demo.reset();
    assert.equal(demo.readSaved(), null);
    assert.deepEqual(snapshot, emptyCanvasDocument());
  } finally {
    demo.dispose();
  }
});
