import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SourceResolutionResult } from "../packages/whiteboard/src/model/protocol.ts";
import { sourceCacheKey } from "../packages/whiteboard/src/whiteboard/sourceState.ts";
import {
  ProgressiveSourceScheduler,
  type SourceResolutionJob,
} from "../src/modules/whiteboard/source-scheduler.ts";

const tabSource = readFileSync(
  new URL("../src/modules/whiteboard/tab.ts", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../src/modules/whiteboard/editor.ts", import.meta.url),
  "utf8",
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

function job(
  cacheKey: string,
  priority: SourceResolutionJob["priority"],
  values: Partial<SourceResolutionJob> = {},
): SourceResolutionJob {
  return {
    nodeId: values.nodeId ?? `${cacheKey}-node`,
    generation: values.generation ?? 1,
    priority,
    descriptor: values.descriptor ?? {
      kind: "literature",
      source: { library: { type: "user" }, itemKey: cacheKey },
    },
    cacheKey,
  };
}

function resolved(value: SourceResolutionJob): SourceResolutionResult {
  return {
    nodeId: value.nodeId,
    generation: value.generation,
    status: "resolved",
    acquisition: {
      kind: "literature",
      source: { library: { type: "user" }, itemKey: value.cacheKey },
      snapshot: { title: value.cacheKey },
    },
  };
}

function resolvedNote(
  value: SourceResolutionJob,
  content: string,
): SourceResolutionResult {
  return {
    nodeId: value.nodeId,
    generation: value.generation,
    status: "resolved",
    acquisition: {
      kind: "note",
      source: { library: { type: "user" }, noteKey: value.cacheKey },
      content,
    },
  };
}

test("starts selected, visible, then idle jobs with FIFO ordering", async () => {
  const gates = new Map(
    ["idle-1", "visible-1", "selected-1", "selected-2"].map((key) => [
      key,
      deferred<SourceResolutionResult>(),
    ]),
  );
  const started: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    concurrency: 1,
    run: (next) => {
      started.push(next.cacheKey);
      return gates.get(next.cacheKey)!.promise;
    },
    emit: () => undefined,
  });

  scheduler.enqueue(job("idle-1", "idle"));
  scheduler.enqueue(job("visible-1", "visible"));
  scheduler.enqueue(job("selected-1", "selected"));
  scheduler.enqueue(job("selected-2", "selected"));
  await flushMicrotasks();
  assert.deepEqual(started, ["selected-1"]);

  for (const key of ["selected-1", "selected-2", "visible-1", "idle-1"]) {
    gates.get(key)!.resolve(resolved(job(key, "idle")));
    await flushMicrotasks();
  }
  assert.deepEqual(started, [
    "selected-1",
    "selected-2",
    "visible-1",
    "idle-1",
  ]);
});

test("defaults to four concurrent lookups", async () => {
  const gates = Array.from({ length: 9 }, () =>
    deferred<SourceResolutionResult>(),
  );
  let active = 0;
  let maxObserved = 0;
  let started = 0;
  const scheduler = new ProgressiveSourceScheduler({
    run: async (next) => {
      const index = Number(next.cacheKey.slice(4));
      started += 1;
      active += 1;
      maxObserved = Math.max(maxObserved, active);
      const result = await gates[index].promise;
      active -= 1;
      return result;
    },
    emit: () => undefined,
  });

  for (let index = 0; index < gates.length; index += 1) {
    scheduler.enqueue(job(`job-${index}`, "idle"));
  }
  await flushMicrotasks();
  assert.equal(started, 4);
  assert.equal(maxObserved, 4);

  for (let index = 0; index < gates.length; index += 1) {
    gates[index].resolve(resolved(job(`job-${index}`, "idle")));
    await flushMicrotasks();
  }
  assert.equal(started, 9);
  assert.ok(maxObserved <= 4);
});

test("coalesces a cache key and fans the result out to every node", async () => {
  const gate = deferred<SourceResolutionResult>();
  const emitted: SourceResolutionResult[][] = [];
  const runs: SourceResolutionJob[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    run: (next) => {
      runs.push(next);
      return gate.promise;
    },
    emit: (results) => emitted.push(results),
  });
  const first = job("shared", "visible", { nodeId: "literature-a" });
  const second = job("shared", "idle", { nodeId: "literature-b" });

  scheduler.enqueue(first);
  scheduler.enqueue(second);
  await flushMicrotasks();
  assert.equal(runs.length, 1);

  gate.resolve(resolved(first));
  await flushMicrotasks();
  assert.deepEqual(
    emitted.flat().map(({ nodeId }) => nodeId),
    ["literature-a", "literature-b"],
  );
});

test("parser-valid delimiter collisions schedule separately while identical sources coalesce", async () => {
  const firstDescriptor = {
    kind: "quote" as const,
    source: {
      library: { type: "user" as const },
      itemKey: "PARENT",
      attachmentKey: "PDF:SECTION",
      annotationKey: "ANNOTATION",
    },
  };
  const secondDescriptor = {
    kind: "quote" as const,
    source: {
      library: { type: "user" as const },
      itemKey: "PARENT:PDF",
      attachmentKey: "SECTION",
      annotationKey: "ANNOTATION",
    },
  };
  const runs: SourceResolutionJob[] = [];
  const emitted: SourceResolutionResult[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    run: async (next) => {
      runs.push(next);
      if (next.descriptor.kind !== "quote") {
        throw new Error("expected Quote descriptor");
      }
      return {
        nodeId: next.nodeId,
        generation: next.generation,
        status: "resolved",
        acquisition: {
          kind: "quote",
          source: next.descriptor.source,
          snapshot: { text: next.nodeId },
        },
      };
    },
    emit: (results) => emitted.push(...results),
  });
  const firstKey = sourceCacheKey(firstDescriptor);
  const secondKey = sourceCacheKey(secondDescriptor);
  scheduler.enqueue(
    job(firstKey, "visible", {
      nodeId: "quote-a",
      descriptor: firstDescriptor,
    }),
  );
  scheduler.enqueue(
    job(secondKey, "visible", {
      nodeId: "quote-b",
      descriptor: secondDescriptor,
    }),
  );
  scheduler.enqueue(
    job(firstKey, "idle", {
      nodeId: "quote-a-copy",
      descriptor: firstDescriptor,
    }),
  );
  await flushMicrotasks(16);

  assert.notEqual(firstKey, secondKey);
  assert.equal(runs.length, 2);
  assert.deepEqual(emitted.map(({ nodeId }) => nodeId).sort(), [
    "quote-a",
    "quote-a-copy",
    "quote-b",
  ]);
});

test("emits same-turn completions as one micro-batch", async () => {
  const emitted: SourceResolutionResult[][] = [];
  const scheduler = new ProgressiveSourceScheduler({
    run: async (next) => resolved(next),
    emit: (results) => emitted.push(results),
  });

  scheduler.enqueue(job("batch-a", "visible"));
  scheduler.enqueue(job("batch-b", "visible"));
  await flushMicrotasks(16);

  assert.equal(emitted.length, 1);
  assert.deepEqual(
    emitted[0].map(({ nodeId }) => nodeId),
    ["batch-a-node", "batch-b-node"],
  );
});

test("promotes queued cache keys without disturbing priority FIFO", async () => {
  const gates = new Map(
    ["blocker", "older", "promoted"].map((key) => [
      key,
      deferred<SourceResolutionResult>(),
    ]),
  );
  const started: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    concurrency: 1,
    run: (next) => {
      started.push(next.cacheKey);
      return gates.get(next.cacheKey)!.promise;
    },
    emit: () => undefined,
  });

  scheduler.enqueue(job("blocker", "selected"));
  scheduler.enqueue(job("older", "idle"));
  scheduler.enqueue(job("promoted", "idle"));
  await flushMicrotasks();
  scheduler.promote("promoted", "selected");
  gates.get("blocker")!.resolve(resolved(job("blocker", "selected")));
  await flushMicrotasks();

  assert.deepEqual(started, ["blocker", "promoted"]);
});

test("invalidating a completed source makes explicit refresh perform a fresh lookup", async () => {
  let runs = 0;
  const emitted: SourceResolutionResult[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    run: async (next) => {
      runs += 1;
      return resolved(next);
    },
    emit: (results) => emitted.push(...results),
  });

  scheduler.enqueue(job("refresh-me", "visible"));
  await flushMicrotasks();
  scheduler.invalidate("refresh-me");
  scheduler.enqueue(job("refresh-me", "selected"));
  await flushMicrotasks();

  assert.equal(runs, 2);
  assert.equal(emitted.length, 2);
});

test("LRU eviction keeps recently reused sources and refetches the oldest entry", async () => {
  const runs: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    cacheMaxEntries: 2,
    run: async (next) => {
      runs.push(next.cacheKey);
      return resolved(next);
    },
    emit: () => undefined,
  });
  for (const key of ["a", "b", "a", "c", "a", "b"]) {
    scheduler.enqueue(job(key, "visible"));
    await flushMicrotasks();
  }
  assert.deepEqual(runs, ["a", "b", "c", "b"]);
});

test("the default cache holds at most 128 source entries", async () => {
  const runs: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    run: async (next) => {
      runs.push(next.cacheKey);
      return resolved(next);
    },
    emit: () => undefined,
  });
  for (let index = 0; index < 129; index++) {
    scheduler.enqueue(job(`source-${index}`, "visible"));
    await flushMicrotasks();
  }
  scheduler.enqueue(job("source-128", "selected"));
  await flushMicrotasks();
  assert.equal(runs.length, 129);
  scheduler.enqueue(job("source-0", "selected"));
  await flushMicrotasks();
  assert.equal(runs.length, 130);
  assert.equal(runs.at(-1), "source-0");
});

test("UTF16 note content evicts entries when the text budget fills", async () => {
  const runs: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    cacheMaxBytes: 400,
    run: async (next) => {
      runs.push(next.cacheKey);
      // Each result fits individually; two 100-character notes exceed 400 bytes.
      return resolvedNote(next, "中文".repeat(50));
    },
    emit: () => undefined,
  });
  for (const key of ["a", "b", "b", "a"]) {
    scheduler.enqueue(job(key, "visible"));
    await flushMicrotasks();
  }
  assert.deepEqual(runs, ["a", "b", "a"]);
});

test("nested metadata arrays count toward the cache text budget", async () => {
  const runs: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    cacheMaxBytes: 400,
    run: async (next) => {
      runs.push(next.cacheKey);
      const result = resolved(next);
      if (
        result.status === "resolved" &&
        result.acquisition.kind === "literature"
      ) {
        result.acquisition.snapshot.tags = ["标签".repeat(50)];
      }
      return result;
    },
    emit: () => undefined,
  });
  for (const key of ["a", "b", "b", "a"]) {
    scheduler.enqueue(job(key, "visible"));
    await flushMicrotasks();
  }
  assert.deepEqual(runs, ["a", "b", "a"]);
});

test("oversized results bypass the default 2MiB cache without evicting small sources", async () => {
  const runs: string[] = [];
  const largeText = "文".repeat(1024 * 1024 + 1);
  const scheduler = new ProgressiveSourceScheduler({
    run: async (next) => {
      runs.push(next.cacheKey);
      return next.cacheKey === "large"
        ? resolvedNote(next, largeText)
        : resolved(next);
    },
    emit: () => undefined,
  });
  for (const key of ["small", "large", "small", "large", "small"]) {
    scheduler.enqueue(job(key, "visible"));
    await flushMicrotasks();
  }
  assert.deepEqual(runs, ["small", "large", "large"]);
});

test("invalidation releases the text budget for new cache entries", async () => {
  const runs: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    cacheMaxBytes: 400,
    run: async (next) => {
      runs.push(next.cacheKey);
      return resolvedNote(next, "文".repeat(100));
    },
    emit: () => undefined,
  });
  scheduler.enqueue(job("a", "visible"));
  await flushMicrotasks();
  scheduler.invalidate("a");
  scheduler.invalidate("a");
  for (const key of ["b", "b", "a"]) {
    scheduler.enqueue(job(key, "visible"));
    await flushMicrotasks();
  }
  assert.deepEqual(runs, ["a", "b", "a"]);
});

test("cache limits accept zero to disable caching and reject invalid values", async () => {
  for (const limit of [-1, 0.5, NaN, Infinity]) {
    for (const name of ["cacheMaxEntries", "cacheMaxBytes"] as const) {
      assert.throws(
        () =>
          new ProgressiveSourceScheduler({
            [name]: limit,
            run: async (next) => resolved(next),
            emit: () => undefined,
          }),
        /cache limits/,
      );
    }
  }
  for (const name of ["cacheMaxEntries", "cacheMaxBytes"] as const) {
    let runs = 0;
    const scheduler = new ProgressiveSourceScheduler({
      [name]: 0,
      run: async (next) => {
        runs += 1;
        return resolved(next);
      },
      emit: () => undefined,
    });
    for (let index = 0; index < 2; index++) {
      scheduler.enqueue(job("uncached", "selected"));
      await flushMicrotasks();
    }
    assert.equal(runs, 2);
  }
});

test("pause preserves and coalesces pending jobs, then resumes priority FIFO", async () => {
  const started: string[] = [];
  const emitted: SourceResolutionResult[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    concurrency: 1,
    run: async (next) => {
      started.push(next.cacheKey);
      return resolved(next);
    },
    emit: (results) => emitted.push(...results),
  });
  scheduler.setPaused(true);
  scheduler.enqueue(job("idle", "idle"));
  scheduler.enqueue(job("visible", "visible"));
  scheduler.enqueue(job("selected-1", "selected"));
  scheduler.enqueue(job("selected-2", "selected"));
  scheduler.enqueue(job("selected-1", "visible", { nodeId: "shared-copy" }));
  await flushMicrotasks();
  assert.deepEqual(started, []);
  scheduler.setPaused(false);
  scheduler.setPaused(false);
  await flushMicrotasks(32);
  assert.deepEqual(started, ["selected-1", "selected-2", "visible", "idle"]);
  assert.equal(emitted.length, 5);
  assert.ok(emitted.some(({ nodeId }) => nodeId === "shared-copy"));
});

test("pausing lets in-flight results finish and cached replies arrive without starting queued work", async () => {
  const gate = deferred<SourceResolutionResult>();
  const started: string[] = [];
  const emitted: SourceResolutionResult[] = [];
  const active = job("active", "selected");
  const scheduler = new ProgressiveSourceScheduler({
    concurrency: 1,
    run: (next) => {
      started.push(next.cacheKey);
      return next.cacheKey === "active"
        ? gate.promise
        : Promise.resolve(resolved(next));
    },
    emit: (results) => emitted.push(...results),
  });
  scheduler.enqueue(active);
  scheduler.enqueue(job("queued", "visible"));
  await flushMicrotasks();
  scheduler.setPaused(true);
  gate.resolve(resolved(active));
  await flushMicrotasks();
  assert.deepEqual(started, ["active"]);
  assert.deepEqual(
    emitted.map(({ nodeId }) => nodeId),
    ["active-node"],
  );
  scheduler.enqueue(job("active", "visible", { nodeId: "cached-copy" }));
  await flushMicrotasks();
  assert.deepEqual(started, ["active"]);
  assert.equal(emitted.at(-1)?.nodeId, "cached-copy");
  scheduler.setPaused(false);
  await flushMicrotasks();
  assert.deepEqual(started, ["active", "queued"]);
  assert.equal(emitted.at(-1)?.nodeId, "queued-node");
});

test("cancelling a generation while paused preserves a shared in-flight lookup for current waiters", async () => {
  const gate = deferred<SourceResolutionResult>();
  const old = job("shared", "selected", { generation: 1 });
  const started: string[] = [];
  const emitted: SourceResolutionResult[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    concurrency: 1,
    run: (next) => {
      started.push(next.cacheKey);
      return next.cacheKey === "shared"
        ? gate.promise
        : Promise.resolve(resolved(next));
    },
    emit: (results) => emitted.push(...results),
  });
  scheduler.enqueue(old);
  scheduler.enqueue(job("old-queued", "visible", { generation: 1 }));
  await flushMicrotasks();
  scheduler.setPaused(true);
  scheduler.enqueue(
    job("shared", "selected", { nodeId: "current-copy", generation: 2 }),
  );
  scheduler.enqueue(job("current", "idle", { generation: 2 }));
  scheduler.cancelGeneration(1);
  gate.resolve(resolved(old));
  await flushMicrotasks();
  assert.deepEqual(started, ["shared"]);
  assert.deepEqual(
    emitted.map(({ nodeId, generation }) => [nodeId, generation]),
    [["current-copy", 2]],
  );
  scheduler.setPaused(false);
  await flushMicrotasks();
  assert.deepEqual(started, ["shared", "current"]);
  assert.equal(emitted.at(-1)?.nodeId, "current-node");
});

test("disposing a paused scheduler releases its queue and cannot resume it", async () => {
  const started: string[] = [];
  const emitted: SourceResolutionResult[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    run: async (next) => {
      started.push(next.cacheKey);
      return resolved(next);
    },
    emit: (results) => emitted.push(...results),
  });
  scheduler.setPaused(true);
  scheduler.enqueue(job("pending", "selected"));
  scheduler.dispose();
  scheduler.setPaused(false);
  scheduler.enqueue(job("after-dispose", "selected"));
  await flushMicrotasks();
  assert.deepEqual(started, []);
  assert.deepEqual(emitted, []);
});

test("a rejected lookup fans out unavailable results and continues the queue", async () => {
  const emitted: SourceResolutionResult[] = [];
  const started: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    concurrency: 1,
    run: async (next) => {
      started.push(next.cacheKey);
      if (next.cacheKey === "broken") throw new Error("lookup failed");
      return resolved(next);
    },
    emit: (results) => emitted.push(...results),
  });

  scheduler.enqueue(job("broken", "selected", { nodeId: "broken-a" }));
  scheduler.enqueue(job("broken", "visible", { nodeId: "broken-b" }));
  scheduler.enqueue(job("healthy", "visible"));
  await flushMicrotasks(16);

  assert.deepEqual(started, ["broken", "healthy"]);
  assert.deepEqual(emitted, [
    {
      nodeId: "broken-a",
      generation: 1,
      status: "unavailable",
      code: "resolution-failed",
      message: "lookup failed",
    },
    {
      nodeId: "broken-b",
      generation: 1,
      status: "unavailable",
      code: "resolution-failed",
      message: "lookup failed",
    },
    resolved(job("healthy", "visible")),
  ]);
});

test("unavailable and thrown failures are retried by later generations", async () => {
  let runs = 0;
  const emitted: SourceResolutionResult[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    run: async (next) => {
      runs += 1;
      if (runs === 1) {
        return {
          nodeId: next.nodeId,
          generation: next.generation,
          status: "unavailable",
          code: "item-missing",
          message: "Missing",
        };
      }
      if (runs === 2) throw new Error("Temporary failure");
      return resolved(next);
    },
    emit: (results) => emitted.push(...results),
  });

  scheduler.enqueue(job("retry", "selected", { generation: 1 }));
  await flushMicrotasks();
  scheduler.enqueue(job("retry", "selected", { generation: 2 }));
  await flushMicrotasks();
  scheduler.enqueue(job("retry", "selected", { generation: 3 }));
  await flushMicrotasks();

  assert.equal(runs, 3);
  assert.deepEqual(
    emitted.map(({ generation, status }) => [generation, status]),
    [
      [1, "unavailable"],
      [2, "unavailable"],
      [3, "resolved"],
    ],
  );
});

test("cancels queued and late results for one document generation", async () => {
  const oldGate = deferred<SourceResolutionResult>();
  const emitted: SourceResolutionResult[] = [];
  const started: string[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    concurrency: 1,
    run: (next) => {
      started.push(next.nodeId);
      return next.generation === 1
        ? oldGate.promise
        : Promise.resolve(resolved(next));
    },
    emit: (results) => emitted.push(...results),
  });
  const activeOld = job("old-active", "selected", {
    nodeId: "old-active-node",
    generation: 1,
  });
  scheduler.enqueue(activeOld);
  scheduler.enqueue(
    job("old-queued", "visible", {
      nodeId: "old-queued-node",
      generation: 1,
    }),
  );
  scheduler.enqueue(
    job("current", "idle", { nodeId: "current-node", generation: 2 }),
  );
  await flushMicrotasks();

  scheduler.cancelGeneration(1);
  oldGate.resolve(resolved(activeOld));
  await flushMicrotasks(16);

  assert.deepEqual(started, ["old-active-node", "current-node"]);
  assert.deepEqual(
    emitted.map(({ nodeId }) => nodeId),
    ["current-node"],
  );
});

test("does not cache a completion owned only by a cancelled generation", async () => {
  const stale = deferred<SourceResolutionResult>();
  let runs = 0;
  const emitted: SourceResolutionResult[] = [];
  const scheduler = new ProgressiveSourceScheduler({
    run: (next) => {
      runs += 1;
      return runs === 1 ? stale.promise : Promise.resolve(resolved(next));
    },
    emit: (results) => emitted.push(...results),
  });
  const old = job("same-source", "selected", { generation: 1 });

  scheduler.enqueue(old);
  await flushMicrotasks();
  scheduler.cancelGeneration(1);
  stale.resolve(resolved(old));
  await flushMicrotasks();
  scheduler.enqueue(job("same-source", "selected", { generation: 2 }));
  await flushMicrotasks();

  assert.equal(runs, 2);
  assert.deepEqual(
    emitted.map(({ generation }) => generation),
    [2],
  );
});

test("disposal ignores in-flight completion callbacks", async () => {
  const gate = deferred<SourceResolutionResult>();
  const emitted: SourceResolutionResult[] = [];
  const current = job("dispose", "selected");
  const scheduler = new ProgressiveSourceScheduler({
    run: () => gate.promise,
    emit: (results) => emitted.push(...results),
  });

  scheduler.enqueue(current);
  await flushMicrotasks();
  scheduler.dispose();
  gate.resolve(resolved(current));
  await flushMicrotasks();

  assert.deepEqual(emitted, []);
});

test("the host session composes gateway, scheduler, and resolution bridge", () => {
  assert.match(tabSource, /new ProgressiveSourceScheduler/);
  assert.match(tabSource, /gateway\.resolve\(/);
  assert.match(tabSource, /cancelGeneration\(/);
  assert.match(tabSource, /applySourceResolutionBatch\(/);
  assert.match(editorSource, /case "resolveAcademicSources"/);
  assert.match(editorSource, /data\.payload\.priority/);
  assert.doesNotMatch(tabSource, /sourceRequestPriority/);
  assert.match(editorSource, /applySourceResolutionBatch:/);
  assert.match(editorSource, /type: "sourceResolutionBatch"/);
});
