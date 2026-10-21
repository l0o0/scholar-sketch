import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  normalizeAttachmentUploadZip,
  planZipAssetPathRepair,
  registerAttachmentZipCompatibility,
  unregisterAttachmentZipCompatibility,
} from "../src/modules/attachment-zip-compat.ts";

const item = (filename = "note.md", stored = true) =>
  ({
    key: "ABCDEFGH",
    attachmentFilename: filename,
    attachmentLinkMode: stored ? 0 : 2,
    isAttachment: () => true,
    isStoredFileAttachment: () => stored,
  }) as Zotero.Item;

type Entry = {
  isDirectory: boolean;
  isSynthetic?: boolean;
  lastModifiedTime: number;
  CRC32: number;
  realSize: number;
  data: string;
};

function fixture(context: TestContext, source: Record<string, string>) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(
    ["Zotero", "Components", "IOUtils"].map((key) => [key, globals[key]]),
  );
  context.after(() => {
    unregisterAttachmentZipCompatibility();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  });

  const zipPath = "/tmp/zotero/ABCDEFGH.zip";
  const archives = new Map<string, Map<string, Entry>>();
  const initial = new Map(
    Object.entries(source).map(([name, data]) => [
      name,
      {
        isDirectory: name.endsWith("/"),
        lastModifiedTime: 123456789,
        CRC32: [...data].reduce((sum, char) => sum + char.charCodeAt(0), 0),
        realSize: Buffer.byteLength(data),
        data,
      },
    ]),
  );
  archives.set(zipPath, initial);
  const events: string[] = [];
  const settings = {
    failWrite: false,
    failMove: false,
    corrupt: false,
    legacyObserver: false,
  };
  const openedReaders = new Set<string>();
  const streams = new Set<{ closed: boolean }>();
  let selected = item();
  let unique = 0;
  class File {
    constructor(public path: string) {}
    append(leaf: string) {
      assert.doesNotMatch(leaf, /[/\\]/);
      this.path += `/${leaf}`;
    }
    clone() {
      return new File(this.path);
    }
    createUnique(_type: number, mode: number) {
      assert.equal(mode, 0o600);
      this.path += `-${++unique}`;
      archives.set(this.path, new Map());
      events.push("create-staging");
    }
  }
  class Reader {
    path = "";
    open(file: File) {
      assert.ok(archives.has(file.path));
      this.path = file.path;
      openedReaders.add(this.path);
    }
    close() {
      openedReaders.delete(this.path);
    }
    findEntries() {
      const names = [...archives.get(this.path)!.keys()];
      let index = 0;
      return {
        hasMore: () => index < names.length,
        getNext: () => names[index++],
      };
    }
    getEntry(name: string) {
      const entry = archives.get(this.path)!.get(name);
      assert.ok(entry, name);
      return entry;
    }
    getInputStream(name: string) {
      const entry = this.getEntry(name);
      const stream = {
        entry,
        closed: false,
        close() {
          this.closed = true;
        },
      };
      streams.add(stream);
      return stream;
    }
    test() {
      events.push("verify");
    }
  }
  class Writer {
    path = "";
    queue: Array<() => void> = [];
    open(file: File) {
      this.path = file.path;
    }
    addEntryDirectory(name: string, time: number, queued: boolean) {
      assert.equal(queued, true);
      this.queue.push(() => {
        archives.get(this.path)!.set(name, {
          isDirectory: true,
          lastModifiedTime: time,
          CRC32: 0,
          realSize: 0,
          data: "",
        });
      });
    }
    addEntryStream(
      name: string,
      time: number,
      compression: number,
      stream: { entry: Entry; closed: boolean },
      queued: boolean,
    ) {
      assert.equal(queued, true);
      assert.equal(compression, 6);
      this.queue.push(() => {
        assert.equal(stream.closed, false);
        const entry = { ...stream.entry, lastModifiedTime: time };
        if (settings.corrupt) entry.CRC32 += 1;
        archives.get(this.path)!.set(name, entry);
      });
    }
    processQueue(observer: {
      onStopRequest(
        request: unknown,
        contextOrStatus: unknown,
        status?: number,
      ): void;
    }) {
      queueMicrotask(() => {
        for (const action of this.queue) action();
        const status = settings.failWrite ? 1 : 0;
        if (settings.legacyObserver) observer.onStopRequest(null, null, status);
        else observer.onStopRequest(null, status);
      });
    }
    close() {
      events.push("writer-close");
    }
  }
  const utilities = {
    getItemFromRequest: (_request: unknown) => selected,
    async createUploadFile(this: unknown, ...args: unknown[]) {
      assert.equal(this, utilities);
      events.push("host-create");
      assert.deepEqual(args, ["request", "preserved-extra-argument"]);
      return true;
    },
  };
  globals.Zotero = {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Sync: { Storage: { Utilities: utilities } },
    getTempDirectory: () => new File("/tmp/zotero"),
    logError() {},
  };
  globals.Components = {
    classes: {
      "@mozilla.org/libjar/zip-reader;1": {
        createInstance: () => new Reader(),
      },
      "@mozilla.org/zipwriter;1": { createInstance: () => new Writer() },
    },
    interfaces: {
      nsIZipReader: {},
      nsIZipWriter: { COMPRESSION_DEFAULT: 6 },
      nsIFile: { NORMAL_FILE_TYPE: 0 },
    },
    isSuccessCode: (status: number) => status === 0,
  };
  globals.IOUtils = {
    async move(from: string, to: string, options: { noOverwrite: boolean }) {
      assert.equal(options.noOverwrite, false);
      assert.equal(openedReaders.size, 0, "all handles close before replacing");
      if (settings.failMove) throw new Error("move failed");
      events.push("replace");
      archives.set(to, archives.get(from)!);
      archives.delete(from);
    },
    async remove(path: string) {
      archives.delete(path);
      events.push("cleanup");
    },
  };
  return {
    archives,
    zipPath,
    initial,
    events,
    settings,
    utilities,
    openedReaders,
    streams,
    select: (next: Zotero.Item) => (selected = next),
  };
}

test("normalizes only explicit assets backslash hierarchy", () => {
  const plan = planZipAssetPathRepair(
    [
      "note.md",
      "assets\\图.png",
      "assets\\nested\\b.png",
      "assets/c.png",
      "unrelated\\literal.png",
    ].map((name) => ({ name, isDirectory: false })),
  );
  assert.deepEqual(
    plan.map((entry) => entry.target),
    [
      "note.md",
      "assets/图.png",
      "assets/nested/b.png",
      "assets/c.png",
      "unrelated\\literal.png",
    ],
  );
});

test("rejects traversal, invalid components and target collisions", () => {
  for (const name of [
    "assets\\..\\secret.png",
    "assets\\.\\a.png",
    "assets\\\\a.png",
    "assets\\C:\\a.png",
    "assets\\a?.png",
    "assets\\trailing.\\a.png",
    "assets\\CON.png",
    "assets\\nested\\LPT1",
  ]) {
    assert.throws(() => planZipAssetPathRepair([{ name, isDirectory: false }]));
  }
  for (const names of [
    ["assets\\a.png", "assets/a.png"],
    ["assets\\A.png", "assets/a.png"],
    ["assets\\nested\\a.png", "assets/nested"],
  ]) {
    assert.throws(() =>
      planZipAssetPathRepair(
        names.map((name) => ({ name, isDirectory: false })),
      ),
    );
  }
});

test("ignores synthetic directories generated by ZIP reader", () => {
  assert.deepEqual(
    planZipAssetPathRepair([
      { name: "assets/", isDirectory: true, isSynthetic: true },
      { name: "assets\\a.png", isDirectory: false },
    ]).map((entry) => entry.target),
    ["assets/a.png"],
  );
});

test("copies original bytes, timestamps and all unrelated entries before replacement", async (context) => {
  const mock = fixture(context, {
    "note.md": "![图](assets/图.png)",
    "assets\\图.png": "binary-image-contents",
    "assets\\nested\\b.png": "nested-image-contents",
    "other.txt": "unchanged",
  });
  assert.equal(await normalizeAttachmentUploadZip(item()), true);
  const repaired = mock.archives.get(mock.zipPath)!;
  for (const [name, entry] of mock.initial) {
    const target = name.startsWith("assets\\")
      ? name.replaceAll("\\", "/")
      : name;
    assert.deepEqual(repaired.get(target), entry);
  }
  assert.equal(mock.archives.size, 1);
  assert.equal(mock.openedReaders.size, 0);
  assert.ok([...mock.streams].every((stream) => stream.closed));
  assert.ok(mock.events.indexOf("verify") < mock.events.indexOf("replace"));
});

test("already-correct ZIP remains byte-identical without creating a writer", async (context) => {
  const mock = fixture(context, { "note.md": "note", "assets/a.png": "image" });
  assert.equal(await normalizeAttachmentUploadZip(item()), false);
  assert.equal(mock.archives.get(mock.zipPath), mock.initial);
  assert.deepEqual(mock.events, []);
  assert.equal(mock.openedReaders.size, 0);
});

test("also handles older Gecko's three-argument ZIP queue observer", async (context) => {
  const mock = fixture(context, {
    "note.md": "note",
    "assets\\a.png": "image",
  });
  mock.settings.legacyObserver = true;
  assert.equal(await normalizeAttachmentUploadZip(item()), true);
});

test("only stored Markdown or Canvas attachments are inspected", async (context) => {
  const mock = fixture(context, {
    "note.md": "note",
    "assets\\a.png": "image",
  });
  assert.equal(await normalizeAttachmentUploadZip(item("paper.pdf")), false);
  assert.equal(
    await normalizeAttachmentUploadZip(item("note.md", false)),
    false,
  );
  assert.equal(await normalizeAttachmentUploadZip(item("board.canvas")), true);
  assert.equal(mock.archives.size, 1);
});

test("untrusted item keys cannot address files outside the host temp directory", async (context) => {
  const mock = fixture(context, { "note.md": "note" });
  await assert.rejects(
    normalizeAttachmentUploadZip({ ...item(), key: "../other" } as Zotero.Item),
    /Invalid attachment key/,
  );
  assert.equal(mock.openedReaders.size, 0);
  assert.deepEqual(mock.events, []);
});

for (const failure of ["failWrite", "corrupt", "failMove"] as const) {
  test(`${failure} keeps original ZIP and cleans up temporary handles/files`, async (context) => {
    const mock = fixture(context, {
      "note.md": "note",
      "assets\\a.png": "image",
    });
    mock.settings[failure] = true;
    await assert.rejects(normalizeAttachmentUploadZip(item()));
    assert.equal(mock.archives.get(mock.zipPath), mock.initial);
    assert.equal(mock.archives.size, 1);
    assert.equal(mock.openedReaders.size, 0);
    assert.ok([...mock.streams].every((stream) => stream.closed));
  });
}

test("upload hook waits for normalization and is idempotent/reversible", async (context) => {
  const mock = fixture(context, {
    "note.md": "note",
    "assets\\a.png": "image",
  });
  const original = mock.utilities.createUploadFile;
  registerAttachmentZipCompatibility();
  const wrapper = mock.utilities.createUploadFile;
  registerAttachmentZipCompatibility();
  assert.equal(mock.utilities.createUploadFile, wrapper);
  assert.equal(
    await mock.utilities.createUploadFile(
      "request",
      "preserved-extra-argument",
    ),
    true,
  );
  assert.equal(mock.events[0], "host-create");
  assert.ok(mock.archives.get(mock.zipPath)!.has("assets/a.png"));
  unregisterAttachmentZipCompatibility();
  assert.equal(mock.utilities.createUploadFile, original);
});

test("normalization failure rejects the upload rather than passing the broken ZIP", async (context) => {
  const mock = fixture(context, {
    "note.md": "note",
    "assets\\a.png": "image",
  });
  mock.settings.failWrite = true;
  registerAttachmentZipCompatibility();
  await assert.rejects(
    mock.utilities.createUploadFile("request", "preserved-extra-argument"),
  );
  assert.equal(mock.archives.get(mock.zipPath), mock.initial);
});

test("empty host uploads skip ZIP inspection", async (context) => {
  const mock = fixture(context, {});
  mock.utilities.createUploadFile = async () => false;
  registerAttachmentZipCompatibility();
  assert.equal(await mock.utilities.createUploadFile(), false);
  assert.equal(mock.openedReaders.size, 0);
  assert.deepEqual(mock.events, []);
});

test("unregister leaves a later plugin wrapper intact and makes ours a pass-through", async (context) => {
  const mock = fixture(context, {
    "note.md": "note",
    "assets\\a.png": "image",
  });
  registerAttachmentZipCompatibility();
  const ours = mock.utilities.createUploadFile;
  const later = async function (this: unknown, ...args: unknown[]) {
    return ours.apply(this, args);
  };
  mock.utilities.createUploadFile = later;
  unregisterAttachmentZipCompatibility();
  assert.equal(mock.utilities.createUploadFile, later);
  await mock.utilities.createUploadFile("request", "preserved-extra-argument");
  assert.equal(mock.archives.get(mock.zipPath), mock.initial);
  assert.deepEqual(mock.events, ["host-create"]);
});
