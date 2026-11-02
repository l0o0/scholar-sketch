import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importExternalImages,
  isSafeExternalImageUrl,
  readResponseBytes,
  type ExternalImageImportProgress,
} from "../src/modules/markdown/images/service.ts";
import {
  MAX_IMAGE_BYTES,
  parseMarkdownImages,
} from "../src/modules/markdown/images/model.ts";

function fixture(t: TestContext) {
  const names = [
    "Zotero",
    "IOUtils",
    "PathUtils",
    "ztoolkit",
    "fetch",
    "AbortController",
  ];
  const BrowserAbortController = globalThis.AbortController;
  const previous = names.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  });
  const state = {
    requests: [] as string[],
    signals: [] as Array<AbortSignal | null | undefined>,
    controllers: [] as AbortController[],
    writes: [] as Array<{ path: string; bytes: Uint8Array }>,
    busy: false,
    failWrite: false,
    afterDirectory: () => {},
    wait: async () => {
      state.busy = false;
    },
    fetch: async (_source: string) =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
  };
  Object.assign(globalThis, {
    Zotero: {
      getMainWindow: () => null,
      Attachments: { getStorageDirectory: () => ({ path: "/storage/IMAGES" }) },
      Sync: {
        Runner: {
          get syncInProgress() {
            return state.busy;
          },
        },
      },
      Promise: { delay: () => state.wait() },
    },
    PathUtils: { join: (...parts: string[]) => parts.join("/") },
    IOUtils: {
      makeDirectory: async () => state.afterDirectory(),
      write: async (path: string, bytes: Uint8Array) => {
        if (state.failWrite) throw new Error("Disk full");
        state.writes.push({ path, bytes });
      },
    },
    ztoolkit: { log: () => {} },
    fetch: async (source: string, init?: RequestInit) => {
      state.requests.push(source);
      state.signals.push(init?.signal);
      return state.fetch(source);
    },
  });
  const item = {
    id: 1,
    key: "IMAGES",
    libraryID: 1,
    attachmentContentType: "text/markdown",
    attachmentSyncState: 2,
    isStoredFileAttachment: () => true,
    isEditable: () => true,
  } as unknown as Zotero.Item;
  return {
    state,
    item,
    options: {
      createAbortController: () => {
        const controller = new BrowserAbortController();
        state.controllers.push(controller);
        return controller;
      },
    },
  };
}

test("allows public http(s) image URLs", () => {
  assert.equal(isSafeExternalImageUrl("https://example.com/a.png"), true);
  assert.equal(isSafeExternalImageUrl("http://example.com/a.png"), true);
  assert.equal(isSafeExternalImageUrl("https://cdn.example.org/x?y=1"), true);
  assert.equal(
    isSafeExternalImageUrl("https://sub.domain.com:8443/a.png"),
    true,
  );
});

test("rejects non-http(s) schemes and malformed URLs", () => {
  assert.equal(isSafeExternalImageUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalImageUrl("file:///etc/passwd"), false);
  assert.equal(isSafeExternalImageUrl("data:image/png;base64,xx"), false);
  assert.equal(isSafeExternalImageUrl("ftp://example.com/a.png"), false);
  assert.equal(isSafeExternalImageUrl("not a url"), false);
  assert.equal(isSafeExternalImageUrl(""), false);
});

test("blocks loopback and private network hosts (SSRF guard)", () => {
  for (const blocked of [
    "http://localhost/a.png",
    "http://localhost:8080/a.png",
    "http://sub.localhost/a.png",
    "http://127.0.0.1/a.png",
    "http://127.0.0.2:3000/a.png",
    "http://10.0.0.1/a.png",
    "http://172.16.0.1/a.png",
    "http://172.31.255.255/a.png",
    "http://192.168.1.1/a.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/a.png",
    "http://255.255.255.255/a.png",
    "http://224.0.0.1/a.png",
    "http://[::1]/a.png",
    "http://[0:0:0:0:0:0:0:1]/a.png",
  ]) {
    assert.equal(isSafeExternalImageUrl(blocked), false, blocked);
  }
  // Public IPv4 and IPv6 pass.
  assert.equal(isSafeExternalImageUrl("http://8.8.8.8/a.png"), true);
  assert.equal(
    isSafeExternalImageUrl("http://[2001:4860:4860::8888]/a.png"),
    true,
  );
});

test("bounds streamed external image responses", async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4]));
  await assert.rejects(
    readResponseBytes(response, 3),
    /exceeds the maximum allowed size/,
  );
});

test("reports an empty download without reading or writing assets", async (t) => {
  const { item, state, options } = fixture(t);
  const progress: ExternalImageImportProgress[] = [];
  const markdown = "![local](assets/a.png)\nPlain text";
  const result = await importExternalImages(item, markdown, {
    ...options,
    onProgress: (value) => progress.push(value),
  });
  assert.deepEqual(result, {
    markdown,
    total: 0,
    completed: 0,
    imported: 0,
    failed: 0,
    skipped: 0,
    cancelled: false,
  });
  assert.equal(progress.length, 1);
  assert.equal(state.requests.length, 0);
  assert.equal(state.writes.length, 0);
});

test("downloads with the owning window's controller when the plugin sandbox and main window cannot supply one", async (t) => {
  const { item, state, options } = fixture(t);
  const directory = await mkdtemp(join(tmpdir(), "sketch-image-download-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV2cAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const response = new Response(bytes, {
    headers: { "content-type": "image/png" },
  });
  state.fetch = async () => response;
  Object.assign(Zotero.Attachments, {
    getStorageDirectory: () => ({ path: directory }),
  });
  Object.assign(IOUtils, {
    makeDirectory: (path: string) => mkdir(path, { recursive: true }),
    write: (path: string, value: Uint8Array) => writeFile(path, value),
  });
  // Zotero's plugin loader exposes fetch but does not request this constructor.
  Reflect.deleteProperty(globalThis, "AbortController");
  const result = await importExternalImages(
    item,
    "Before\n![remote](https://example.org/figure.png)\nAfter",
    options,
  );
  assert.equal(result.imported, 1);
  assert.equal(result.failed, 0);
  const reference = parseMarkdownImages(result.markdown)[0].source;
  assert.match(reference, /^assets\/[^/]+\.png$/);
  assert.deepEqual(
    new Uint8Array(await readFile(join(directory, reference))),
    bytes,
  );
  assert.equal(result.markdown, `Before\n![remote](${reference})\nAfter`);
  assert.deepEqual(state.requests, ["https://example.org/figure.png"]);
  assert.equal(state.signals[0], state.controllers[0].signal);
  assert.equal(state.signals[0]?.aborted, false);
});

test("reports partial success, failures and blocked URLs after actual processing", async (t) => {
  const { item, state, options } = fixture(t);
  const markdown = [
    "![ok](https://example.org/ok.png)",
    "![missing](https://example.org/missing.png)",
    "![large](https://example.org/large.png)",
    "![invalid](https://example.org/invalid.png)",
    "![network](https://example.org/network.png)",
    "![blocked](http://127.0.0.1/private.png)",
  ].join("\n");
  state.fetch = async (source) => {
    if (source.includes("missing")) return new Response(null, { status: 404 });
    if (source.includes("network")) throw new Error("Offline");
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "content-type": source.includes("invalid")
          ? "text/html"
          : "image/png; charset=binary",
        "content-length": source.includes("large")
          ? String(MAX_IMAGE_BYTES + 1)
          : "3",
      },
    });
  };
  const progress: ExternalImageImportProgress[] = [];
  const result = await importExternalImages(item, markdown, {
    ...options,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.total, 6);
  assert.equal(result.completed, 6);
  assert.equal(result.imported, 1);
  assert.equal(result.failed, 4);
  assert.equal(result.skipped, 1);
  assert.equal(result.cancelled, false);
  assert.equal(state.requests.length, 5);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(
    progress.map((value) => value.completed),
    [0, 1, 2, 3, 4, 5, 6],
  );
  for (const value of progress) {
    assert.equal(
      value.completed,
      value.imported + value.failed + value.skipped,
    );
  }
  assert.match(result.markdown, /^!\[ok\]\(assets\//);
  assert.ok(
    result.markdown.endsWith(markdown.slice(markdown.indexOf("\n") + 1)),
  );
});

test("preserves reference titles and HTML image sizes when replacing URLs", async (t) => {
  const { item, state, options } = fixture(t);
  const markdown = [
    'before ![inline](https://example.org/a.png "A") after',
    '<img src="https://example.org/b.png" alt="B &amp; C" title="HTML title" width="240">',
    "![reference][figure]",
    '[figure]: https://example.org/c.png "Reference title"',
  ].join("\n\n");
  const result = await importExternalImages(item, markdown, options);
  assert.equal(result.imported, 3);
  assert.equal(state.writes.length, 3);
  assert.match(result.markdown, /!\[inline\]\(assets\/[^)]+ "A"\)/);
  assert.match(
    result.markdown,
    /alt="B &amp; C" title="HTML title" width="240"/,
  );
  assert.match(
    result.markdown,
    /!\[reference\]\(assets\/[^)]+ "Reference title"\)/,
  );
  assert.ok(
    result.markdown.endsWith(
      '[figure]: https://example.org/c.png "Reference title"',
    ),
  );
});

test("reports failed asset writes without replacing the source", async (t) => {
  const { item, state, options } = fixture(t);
  state.failWrite = true;
  const markdown = "![image](https://example.org/a.png)";
  const result = await importExternalImages(item, markdown, options);
  assert.equal(result.markdown, markdown);
  assert.equal(result.failed, 1);
  assert.equal(result.imported, 0);
});

test("progress observers receive snapshots and cannot break successful downloads", async (t) => {
  const { item, options } = fixture(t);
  let calls = 0;
  const result = await importExternalImages(
    item,
    "![image](https://example.org/a.png)",
    {
      ...options,
      onProgress: (progress) => {
        calls++;
        progress.imported = 999;
        throw new Error("View closed");
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.imported, 1);
  assert.equal(result.failed, 0);
});

test("cancels stale operations before downloading without counting unfinished work as failures", async (t) => {
  const { item, state, options } = fixture(t);
  const markdown = "![image](https://example.org/a.png)";
  const result = await importExternalImages(item, markdown, {
    ...options,
    shouldContinue: () => false,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.total, 1);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.markdown, markdown);
  assert.equal(state.requests.length, 0);
  assert.equal(state.writes.length, 0);
});

test("cancels after a pending download when the document changes", async (t) => {
  const { item, state, options } = fixture(t);
  let current = true;
  state.fetch = async () => {
    current = false;
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    });
  };
  const result = await importExternalImages(
    item,
    "![image](https://example.org/a.png)",
    {
      ...options,
      shouldContinue: () => current,
    },
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 0);
  assert.equal(state.requests.length, 1);
  assert.equal(state.writes.length, 0);
});

test("checks the source again after waiting for Zotero sync", async (t) => {
  const { item, state, options } = fixture(t);
  let current = true;
  state.busy = true;
  state.wait = async () => {
    state.busy = false;
    current = false;
  };
  const result = await importExternalImages(
    item,
    "![image](https://example.org/a.png)",
    {
      ...options,
      shouldContinue: () => current,
    },
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 0);
  assert.equal(state.writes.length, 0);
});

test("checks cancellation immediately before writing image bytes", async (t) => {
  const { item, state, options } = fixture(t);
  let current = true;
  state.afterDirectory = () => {
    current = false;
  };
  const result = await importExternalImages(
    item,
    "![image](https://example.org/a.png)",
    {
      ...options,
      shouldContinue: () => current,
    },
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.failed, 0);
  assert.equal(state.writes.length, 0);
});

test("keeps completed downloads when a later image is cancelled", async (t) => {
  const { item, state, options } = fixture(t);
  let current = true;
  const result = await importExternalImages(
    item,
    [
      "![first](https://example.org/a.png)",
      "![last](https://example.org/b.png)",
    ].join("\n"),
    {
      ...options,
      shouldContinue: () => current,
      onProgress: (progress) => {
        if (progress.completed === 1) current = false;
      },
    },
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.total, 2);
  assert.equal(result.completed, 1);
  assert.equal(result.imported, 1);
  assert.equal(result.failed, 0);
  assert.equal(state.requests.length, 1);
  assert.equal(state.writes.length, 1);
});
