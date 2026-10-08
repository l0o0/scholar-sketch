import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  markAttachmentForUpload,
  withAttachmentWrite,
} from "../src/modules/attachment-sync.ts";

const states = {
  SYNC_STATE_TO_UPLOAD: 0,
  SYNC_STATE_TO_DOWNLOAD: 1,
  SYNC_STATE_IN_SYNC: 2,
  SYNC_STATE_FORCE_UPLOAD: 3,
  SYNC_STATE_FORCE_DOWNLOAD: 4,
  SYNC_STATE_IN_CONFLICT: 5,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fixture(
  context: TestContext,
  options: {
    state?: number;
    linked?: boolean;
    withoutRunner?: boolean;
    mtime?: number;
    syncedMtime?: number;
  } = {},
) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousZotero = globals.Zotero;
  const previousIOUtils = globals.IOUtils;
  context.after(() => {
    if (previousZotero === undefined) delete globals.Zotero;
    else globals.Zotero = previousZotero;
    if (previousIOUtils === undefined) delete globals.IOUtils;
    else globals.IOUtils = previousIOUtils;
  });

  let state = options.state ?? states.SYNC_STATE_IN_SYNC;
  let mtime = options.mtime ?? 1_600_000_000_000;
  const syncedMtime = options.syncedMtime ?? mtime;
  const syncedHash = "11111111111111111111111111111111";
  let busy = false;
  let heldDelays = 0;
  let pauses = 0;
  let releases = 0;
  const events: string[] = [];
  const saveOptions: Record<string, unknown>[] = [];
  const touched: Array<{ path: string; mtime: number }> = [];
  const waits: number[] = [];
  let wait: (ms: number) => Promise<void> = async () => {
    throw new Error("Unexpected wait while holding the sync delay");
  };
  const path = "/mock/storage/ABCDEFGH/note.md";
  const item = {
    id: 42,
    libraryID: 1,
    key: "ABCDEFGH",
    attachmentLinkMode: options.linked ? 2 : 0,
    isStoredFileAttachment: () => !options.linked,
    get attachmentSyncState() {
      return state;
    },
    set attachmentSyncState(value: number | string) {
      // Match Zotero: the setter accepts strings, but the getter returns numbers.
      const normalized =
        typeof value === "string"
          ? states[`SYNC_STATE_${value.toUpperCase()}` as keyof typeof states]
          : value;
      assert.equal(typeof normalized, "number");
      state = normalized;
    },
    get attachmentModificationTime() {
      return Promise.resolve(mtime);
    },
    attachmentSyncedModificationTime: syncedMtime,
    attachmentSyncedHash: syncedHash,
    getFilePath: () => path,
    getFilePathAsync: async () => path,
    saveTx: async (options: Record<string, unknown>) => {
      events.push("save-item");
      saveOptions.push(options);
    },
  } as unknown as Zotero.Item;

  const runner = {
    get syncInProgress() {
      return busy;
    },
    delayIndefinite() {
      events.push("pause-sync");
      pauses += 1;
      heldDelays += 1;
      let released = false;
      return () => {
        assert.equal(released, false, "release must be called exactly once");
        released = true;
        events.push("release-sync");
        releases += 1;
        heldDelays -= 1;
      };
    },
  };
  globals.Zotero = {
    Attachments: {
      LINK_MODE_IMPORTED_FILE: 0,
      LINK_MODE_IMPORTED_URL: 1,
      LINK_MODE_LINKED_FILE: 2,
    },
    Promise: {
      delay(ms: number) {
        waits.push(ms);
        events.push("wait-sync");
        return wait(ms);
      },
    },
    Sync: {
      Storage: { Local: states },
      ...(options.withoutRunner ? {} : { Runner: runner }),
    },
  };
  const io = {
    stat: async () => ({ lastModified: mtime, size: 24, type: "regular" }),
    setModificationTime: async (target: string, value: number) => {
      touched.push({ path: target, mtime: value });
      mtime = value;
    },
  };
  globals.IOUtils = io;

  return {
    item,
    path,
    events,
    waits,
    touched,
    saveOptions,
    io,
    syncedMtime,
    syncedHash,
    setBusy(value: boolean) {
      busy = value;
    },
    setWait(callback: (ms: number) => Promise<void>) {
      wait = callback;
    },
    get heldDelays() {
      return heldDelays;
    },
    get pauses() {
      return pauses;
    },
    get releases() {
      return releases;
    },
  };
}

test("a stored write delays new syncs and releases after the write finishes", async (context) => {
  const mock = fixture(context);
  const result = await withAttachmentWrite(mock.item, async () => {
    assert.equal(mock.heldDelays, 1);
    mock.events.push("write-file");
    return "saved";
  });

  assert.equal(result, "saved");
  assert.deepEqual(mock.events, ["pause-sync", "write-file", "release-sync"]);
  assert.equal(mock.heldDelays, 0);
  assert.equal(mock.releases, 1);
});

test("an active sync finishes before a write acquires its delay", async (context) => {
  const mock = fixture(context);
  const syncFinished = deferred();
  const waiting = deferred();
  mock.setBusy(true);
  mock.setWait(async (ms) => {
    assert.equal(ms, 100);
    waiting.resolve();
    await syncFinished.promise;
  });
  let writes = 0;
  const save = withAttachmentWrite(mock.item, async () => {
    writes += 1;
    assert.equal(mock.heldDelays, 1);
  });

  await waiting.promise;
  assert.equal(writes, 0);
  assert.equal(mock.pauses, 0);
  mock.setBusy(false);
  syncFinished.resolve();
  await save;
  assert.equal(writes, 1);
  assert.equal(mock.releases, 1);
});

test("waiting preserves a draft once before waiting through several sync polls", async (context) => {
  const mock = fixture(context);
  mock.setBusy(true);
  let polls = 0;
  let backups = 0;
  mock.setWait(async () => {
    polls += 1;
    assert.equal(backups, 1);
    assert.equal(mock.heldDelays, 0);
    if (polls === 2) mock.setBusy(false);
  });
  await withAttachmentWrite(
    mock.item,
    async () => {
      assert.equal(polls, 2);
      assert.equal(mock.heldDelays, 1);
    },
    async () => {
      backups += 1;
    },
  );
  assert.equal(backups, 1);
  assert.equal(mock.releases, 1);
});

test("a manual sync may become busy while delayed without blocking the internal upload marker", async (context) => {
  const mock = fixture(context);
  await withAttachmentWrite(mock.item, async () => {
    // Zotero sets syncInProgress before awaiting delayIndefinite promises.
    mock.setBusy(true);
    assert.equal(mock.heldDelays, 1);
    await markAttachmentForUpload(mock.item);
    assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_TO_UPLOAD);
  });

  assert.deepEqual(mock.waits, []);
  assert.equal(mock.pauses, 1);
  assert.equal(mock.releases, 1);
  assert.equal(mock.saveOptions.length, 1);
});

test("a rejected disk write releases the sync delay and preserves the original error", async (context) => {
  const mock = fixture(context);
  const diskError = new Error("disk full");
  await assert.rejects(
    withAttachmentWrite(mock.item, async () => {
      throw diskError;
    }),
    (error) => error === diskError,
  );
  assert.equal(mock.heldDelays, 0);
  assert.equal(mock.releases, 1);
  assert.equal(mock.saveOptions.length, 0);
});

test("queued writes remain serial and a failed writer does not poison its successor", async (context) => {
  const mock = fixture(context);
  const started = deferred();
  const finishFirst = deferred();
  const firstError = new Error("first write failed");
  const calls: string[] = [];
  const first = withAttachmentWrite(mock.item, async () => {
    calls.push("first");
    started.resolve();
    await finishFirst.promise;
    throw firstError;
  });
  const rejected = assert.rejects(first, (error) => error === firstError);
  await started.promise;
  const second = withAttachmentWrite(mock.item, async () => {
    calls.push("second");
    assert.equal(mock.heldDelays, 1);
    return "recovered";
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["first"]);
  assert.equal(mock.pauses, 1);
  finishFirst.resolve();
  await rejected;
  assert.equal(await second, "recovered");
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(mock.pauses, 2);
  assert.equal(mock.releases, 2);
  assert.equal(mock.heldDelays, 0);
});

for (const state of [
  states.SYNC_STATE_TO_DOWNLOAD,
  states.SYNC_STATE_FORCE_DOWNLOAD,
  states.SYNC_STATE_IN_CONFLICT,
]) {
  test(`state ${state} blocks disk mutation without overriding Zotero's resolution`, async (context) => {
    const mock = fixture(context, { state });
    let writes = 0;
    await assert.rejects(
      withAttachmentWrite(mock.item, async () => {
        writes += 1;
      }),
      (error: unknown) =>
        (error as { code?: string }).code === "ATTACHMENT_SYNC_CONFLICT",
    );
    assert.equal(writes, 0);
    assert.equal(mock.item.attachmentSyncState, state);
    assert.equal(mock.saveOptions.length, 0);
    assert.equal(mock.heldDelays, 0);
    assert.equal(mock.releases, mock.pauses);
  });
}

test("a remote download selected during the wait blocks the subsequent write", async (context) => {
  const mock = fixture(context);
  mock.setBusy(true);
  mock.setWait(async () => {
    mock.item.attachmentSyncState = states.SYNC_STATE_FORCE_DOWNLOAD;
    mock.setBusy(false);
  });
  let writes = 0;
  await assert.rejects(
    withAttachmentWrite(mock.item, async () => {
      writes += 1;
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "ATTACHMENT_SYNC_CONFLICT",
  );
  assert.equal(writes, 0);
  assert.equal(mock.heldDelays, 0);
  assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_FORCE_DOWNLOAD);
});

test("in-sync becomes numeric to-upload once without changing the synced baseline", async (context) => {
  const mock = fixture(context);
  await markAttachmentForUpload(mock.item);
  await markAttachmentForUpload(mock.item);

  assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_TO_UPLOAD);
  assert.equal(mock.saveOptions.length, 1);
  assert.equal(mock.saveOptions[0].skipSelect, true);
  assert.deepEqual(mock.touched, []);
  assert.equal(mock.item.attachmentSyncedModificationTime, mock.syncedMtime);
  assert.equal(mock.item.attachmentSyncedHash, mock.syncedHash);
});

for (const state of [
  states.SYNC_STATE_TO_UPLOAD,
  states.SYNC_STATE_FORCE_UPLOAD,
]) {
  test(`numeric state ${state} survives ordinary saves without resetting a local choice`, async (context) => {
    const mock = fixture(context, { state });
    await withAttachmentWrite(mock.item, async () => {
      await markAttachmentForUpload(mock.item);
    });
    assert.equal(mock.item.attachmentSyncState, state);
    assert.equal(mock.saveOptions.length, 0);
    assert.equal(mock.releases, 1);
  });
}

for (const change of ["image cleanup", "multi-file Markdown rename"]) {
  test(`${change} marks a new package via the main-file mtime without faking a synced hash`, async (context) => {
    const mock = fixture(context);
    const before = Date.now();
    await withAttachmentWrite(mock.item, async () => {
      await markAttachmentForUpload(mock.item, { packageChanged: true });
    });

    assert.equal(mock.touched.length, 1);
    assert.equal(mock.touched[0].path, mock.path);
    assert.ok(mock.touched[0].mtime >= before);
    assert.ok(mock.touched[0].mtime <= Date.now());
    assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_TO_UPLOAD);
    assert.equal(mock.item.attachmentSyncedModificationTime, mock.syncedMtime);
    assert.equal(mock.item.attachmentSyncedHash, mock.syncedHash);
    assert.equal(mock.saveOptions.length, 1);
  });
}

test("package mtime advances past both local and synced timestamps with second precision", async (context) => {
  const future = Date.now() + 60_000;
  const mock = fixture(context, {
    mtime: future,
    syncedMtime: future + 10_000,
    state: states.SYNC_STATE_FORCE_UPLOAD,
  });
  await markAttachmentForUpload(mock.item, { packageChanged: true });

  assert.deepEqual(mock.touched, [{ path: mock.path, mtime: future + 12_000 }]);
  assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_FORCE_UPLOAD);
  assert.equal(mock.saveOptions.length, 0);
  assert.equal(mock.item.attachmentSyncedModificationTime, future + 10_000);
});

for (const scenario of [
  {
    name: "an exact one-hour clock difference",
    localOffset: 3_600_000,
    syncedOffset: 3_600_000,
    advance: 2000,
  },
  {
    name: "one-hour tolerance after flooring fractional seconds",
    localOffset: 3_599_500,
    syncedOffset: 3_599_500,
    advance: 2000,
  },
  {
    name: "consecutive one-hour tolerances against different baselines",
    localOffset: 3_598_000,
    syncedOffset: 3_600_000,
    advance: 4000,
  },
]) {
  test(`package mtime avoids ${scenario.name} without changing synced metadata`, async (context) => {
    const now = 1_800_000_000_100;
    context.mock.method(Date, "now", () => now);
    const localMtime = now - scenario.localOffset;
    const syncedMtime = now - scenario.syncedOffset;
    const mock = fixture(context, { mtime: localMtime, syncedMtime });
    await markAttachmentForUpload(mock.item, { packageChanged: true });

    const mtime = mock.touched[0].mtime;
    assert.equal(mtime, now + scenario.advance);
    for (const baseline of [localMtime, syncedMtime]) {
      const difference = Math.abs(
        Math.floor(mtime / 1000) - Math.floor(baseline / 1000),
      );
      assert.ok(difference > 1);
      assert.notEqual(difference, 3600);
    }
    assert.equal(mock.item.attachmentSyncedModificationTime, syncedMtime);
    assert.equal(mock.item.attachmentSyncedHash, mock.syncedHash);
    assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_TO_UPLOAD);
  });
}

test("a failed package timestamp update keeps the sync baseline and releases the write delay for retry", async (context) => {
  const mock = fixture(context);
  const touchError = new Error("timestamp permission denied");
  const originalTouch = mock.io.setModificationTime;
  mock.io.setModificationTime = async () => {
    throw touchError;
  };
  await assert.rejects(
    withAttachmentWrite(mock.item, async () => {
      await markAttachmentForUpload(mock.item, { packageChanged: true });
    }),
    (error) => error === touchError,
  );
  assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_IN_SYNC);
  assert.equal(mock.item.attachmentSyncedModificationTime, mock.syncedMtime);
  assert.equal(mock.item.attachmentSyncedHash, mock.syncedHash);
  assert.deepEqual(mock.saveOptions, []);
  assert.equal(mock.releases, 1);

  mock.io.setModificationTime = originalTouch;
  await withAttachmentWrite(mock.item, async () => {
    await markAttachmentForUpload(mock.item, { packageChanged: true });
  });
  assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_TO_UPLOAD);
  assert.equal(mock.touched.length, 1);
  assert.equal(mock.releases, 2);
});

test("a linked file bypasses storage delays and never acquires upload metadata", async (context) => {
  const mock = fixture(context, { linked: true });
  mock.setBusy(true);
  const result = await withAttachmentWrite(mock.item, async () => {
    await markAttachmentForUpload(mock.item, { packageChanged: true });
    return "linked saved";
  });

  assert.equal(result, "linked saved");
  assert.deepEqual(mock.events, []);
  assert.deepEqual(mock.waits, []);
  assert.deepEqual(mock.touched, []);
  assert.deepEqual(mock.saveOptions, []);
});

test("a host without Runner still supports a stored write", async (context) => {
  const mock = fixture(context, { withoutRunner: true });
  const result = await withAttachmentWrite(mock.item, async () => {
    await markAttachmentForUpload(mock.item);
    return 42;
  });

  assert.equal(result, 42);
  assert.deepEqual(mock.waits, []);
  assert.equal(mock.pauses, 0);
  assert.equal(mock.item.attachmentSyncState, states.SYNC_STATE_TO_UPLOAD);
});
