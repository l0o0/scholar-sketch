import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { mountPdfLinkPreview } from "../src/modules/markdown/link-preview-pdf.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function host(t: TestContext, readers: object) {
  const win = new Window();
  const globals = globalThis as any;
  const previous = globals.Zotero;
  globals.Zotero = {
    Reader: readers,
    logError: (error: unknown) => assert.fail(String(error)),
  };
  t.after(() => {
    globals.Zotero = previous;
    win.close();
  });
  const container = win.document.createElement("div");
  const input = win.document.createElement("input");
  win.document.body.append(input, container);
  input.focus();
  let frame: ReturnType<typeof win.document.createElement>;
  let readerDocument: ReturnType<
    typeof win.document.implementation.createHTMLDocument
  > | null = null;
  Object.defineProperty(win.document, "createXULElement", {
    value: (name: string) => {
      assert.equal(name, "browser");
      frame = win.document.createElement("div");
      Object.defineProperty(frame, "contentDocument", {
        get: () => readerDocument,
      });
      return frame;
    },
  });
  const loaded = () => {
    readerDocument = win.document.implementation.createHTMLDocument();
    Object.defineProperties(readerDocument, {
      documentURI: { value: "resource://zotero/reader/reader.html" },
      readyState: { value: "interactive" },
    });
    const event = new win.Event("DOMContentLoaded");
    Object.defineProperty(event, "target", { value: readerDocument });
    frame.dispatchEvent(event);
  };
  return {
    container: container as unknown as HTMLElement,
    win,
    input,
    loaded,
    get frame() {
      return frame;
    },
  };
}

test("PDF hover mounts a read-only native preview at its location without changing focus", async (t) => {
  const opened: unknown[] = [];
  let released = 0;
  const h = host(t, {
    open() {
      assert.fail("hover must not open a reader tab");
    },
    async openPreview(itemID: number, frame: unknown) {
      opened.push([itemID, frame]);
      return {
        async _open(options: unknown) {
          opened.push(options);
          return true;
        },
        async navigate(location: unknown) {
          opened.push(["navigate", location]);
        },
        uninit() {
          released++;
        },
      };
    },
  });
  const location = { pageIndex: 4, annotationID: "ANNO0001" };
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    location,
    isCurrent: () => true,
  });
  assert.equal(opened.length, 0, "Reader waits for its own document");
  assert.equal(h.frame.getAttribute("type"), "content");
  assert.equal(
    h.frame.getAttribute("src"),
    "resource://zotero/reader/reader.html",
  );
  h.frame.dispatchEvent(new h.win.Event("DOMContentLoaded"));
  assert.equal(opened.length, 0, "unrelated load events are ignored");
  h.loaded();
  await preview.ready;
  assert.deepEqual(opened, [[42, h.frame], {}, ["navigate", location]]);
  assert.equal(h.win.document.activeElement, h.input);
  assert.equal(h.frame.getAttribute("tabindex"), "-1");
  preview.dispose();
  preview.dispose();
  assert.equal(released, 1);
  assert.equal(h.container.childElementCount, 0);
});

test("closing a PDF preview before reader.html loads removes its listener and settles ready", async (t) => {
  let opened = 0;
  const h = host(t, {
    openPreview() {
      opened++;
      assert.fail("disposed browser must not initialize a reader");
    },
  });
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    isCurrent: () => true,
  });
  preview.dispose();
  await preview.ready;
  h.loaded();
  assert.equal(opened, 0);
  assert.equal(h.container.childElementCount, 0);
});

test("a reader returned after the hover closes is released without opening", async (t) => {
  const acquisition = deferred<{
    _open(): Promise<boolean>;
    uninit(): void;
  }>();
  const requested = deferred<void>();
  const released = deferred<void>();
  let current = true;
  const h = host(t, {
    openPreview() {
      requested.resolve();
      return acquisition.promise;
    },
  });
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    isCurrent: () => current,
  });
  h.loaded();
  await requested.promise;
  current = false;
  preview.dispose();
  await preview.ready;
  acquisition.resolve({
    async _open() {
      assert.fail("outdated hover must not open");
      return false;
    },
    uninit() {
      released.resolve();
    },
  });
  await released.promise;
  await preview.ready;
  assert.equal(h.container.childElementCount, 0);
});

test("closing during native initialization releases resources after initialization settles", async (t) => {
  const opening = deferred<void>();
  const complete = deferred<boolean>();
  const released = deferred<void>();
  let initialized = false;
  let uninitializations = 0;
  const h = host(t, {
    async openPreview() {
      return {
        async _open() {
          opening.resolve();
          const result = await complete.promise;
          initialized = true;
          return result;
        },
        uninit() {
          assert.equal(initialized, true);
          uninitializations++;
          released.resolve();
        },
      };
    },
  });
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    isCurrent: () => true,
  });
  h.loaded();
  await opening.promise;
  preview.dispose();
  await preview.ready;
  assert.equal(h.container.childElementCount, 0);
  assert.equal(uninitializations, 0);
  complete.resolve(true);
  await released.promise;
  preview.dispose();
  assert.equal(uninitializations, 1);
});

test("native PDF failures reject ready and release the browser and reader", async (t) => {
  let released = 0;
  const h = host(t, {
    async openPreview() {
      return {
        async _open() {
          return false;
        },
        uninit() {
          released++;
        },
      };
    },
  });
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    isCurrent: () => true,
  });
  h.loaded();
  await assert.rejects(preview.ready, /could not be loaded/);
  assert.equal(released, 1);
  assert.equal(h.container.childElementCount, 0);
});

test("PDF readiness waits for post-load navigation and closes a reader released during navigation", async (t) => {
  const navigating = deferred<void>();
  const complete = deferred<void>();
  const released = deferred<void>();
  let loaded = false;
  let uninitializations = 0;
  const h = host(t, {
    async openPreview() {
      return {
        async _open(options: unknown) {
          assert.deepEqual(options, {});
          loaded = true;
          return true;
        },
        async navigate(location: unknown) {
          assert.equal(loaded, true);
          assert.deepEqual(location, { pageIndex: 1 });
          navigating.resolve();
          await complete.promise;
        },
        uninit() {
          uninitializations++;
          released.resolve();
        },
      };
    },
  });
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    location: { pageIndex: 1 },
    isCurrent: () => true,
  });
  let ready = false;
  void preview.ready.then(() => {
    ready = true;
  });
  h.loaded();
  await navigating.promise;
  assert.equal(ready, false, "loaded iframe is not a positioned PDF preview");
  preview.dispose();
  await preview.ready;
  assert.equal(h.container.childElementCount, 0);
  assert.equal(uninitializations, 0);
  complete.resolve();
  await released.promise;
  assert.equal(uninitializations, 1);
});

test("a requested PDF location fails accurately when native navigation is unavailable", async (t) => {
  let released = 0;
  const h = host(t, {
    async openPreview() {
      return {
        async _open() {
          return true;
        },
        uninit() {
          released++;
        },
      };
    },
  });
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    location: { pageIndex: 1 },
    isCurrent: () => true,
  });
  h.loaded();
  await assert.rejects(preview.ready, /navigation is unavailable/);
  assert.equal(released, 1);
  assert.equal(h.container.childElementCount, 0);
});

test("a Zotero version without native preview reports unavailable without opening a tab", async (t) => {
  const h = host(t, {
    open() {
      assert.fail("missing preview capability must not fall back to a tab");
    },
  });
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    isCurrent: () => true,
  });
  await assert.rejects(preview.ready, /unavailable/);
  assert.equal(h.container.childElementCount, 0);
});
