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
  const childWindows: Window[] = [];
  const pdfViewer = { scrollMode: 3, currentScaleValue: "page-height" };
  let pdfWindow: Window;
  let nativeLayouts = 0;
  const globals = globalThis as any;
  const previous = globals.Zotero;
  globals.Zotero = {
    Reader: readers,
    logError: (error: unknown) => assert.fail(String(error)),
  };
  const nativeAPI = readers as { openPreview?: (...args: any[]) => any };
  if (nativeAPI.openPreview) {
    globals.Zotero.Reader = {
      ...readers,
      async openPreview(...args: any[]) {
        const preview = await nativeAPI.openPreview!.apply(readers, args);
        const updatePDFAttr = () => {
          nativeLayouts++;
          pdfViewer.scrollMode = 3;
          pdfViewer.currentScaleValue = "page-height";
        };
        return {
          ...preview,
          updatePDFAttr,
          async _open(options: unknown) {
            const success = await preview._open(options);
            if (success) {
              // Native ReaderPreview owns this thumbnail layout until the
              // production adapter takes over its continuous scrolling view.
              pdfWindow.addEventListener("resize", updatePDFAttr);
              updatePDFAttr();
            }
            return success;
          },
          uninit() {
            pdfWindow.removeEventListener("resize", updatePDFAttr);
            preview.uninit();
          },
        };
      },
    };
  }
  t.after(() => {
    globals.Zotero = previous;
    for (const child of childWindows) child.close();
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
        get: () => (frame.isConnected ? readerDocument : null),
      });
      return frame;
    },
  });
  const loaded = () => {
    const readerWindow = new Window();
    childWindows.push(readerWindow);
    readerDocument = readerWindow.document;
    Object.defineProperties(readerDocument, {
      documentURI: { value: "resource://zotero/reader/reader.html" },
      readyState: { value: "interactive" },
    });
    const primary = readerDocument.createElement("div");
    primary.id = "primary-view";
    const pdfFrame = readerDocument.createElement("iframe");
    primary.append(pdfFrame);
    readerDocument.body.append(primary);
    pdfWindow = pdfFrame.contentWindow!;
    // Gecko chrome sees a DOM Window; script-owned globals are exposed only
    // by the trusted content window's wrappedJSObject, not by its Xray.
    Object.assign(pdfWindow, {
      wrappedJSObject: { PDFViewerApplication: { pdfViewer } },
    });
    const viewport = pdfWindow.document.createElement("div");
    viewport.id = "viewerContainer";
    pdfWindow.document.body.append(viewport);
    const event = new win.Event("DOMContentLoaded");
    Object.defineProperty(event, "target", { value: readerDocument });
    frame.dispatchEvent(event);
  };
  return {
    container: container as unknown as HTMLElement,
    win,
    input,
    loaded,
    pdfViewer,
    get pdfWindow() {
      return pdfWindow;
    },
    get readerDocument() {
      return readerDocument!;
    },
    get nativeLayouts() {
      return nativeLayouts;
    },
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
  assert.deepEqual(opened, [
    [42, h.frame],
    {},
    ["navigate", { pageIndex: 4 }],
    ["navigate", { annotationID: "ANNO0001" }],
  ]);
  assert.equal(h.win.document.activeElement, h.input);
  assert.equal(h.frame.getAttribute("tabindex"), "-1");
  preview.dispose();
  preview.dispose();
  assert.equal(released, 1);
  assert.equal(h.container.childElementCount, 0);
});

test("PDF scrolling uses the native continuous viewport and retains its layout after resize", async (t) => {
  const h = host(t, {
    async openPreview() {
      return {
        async _open() {
          return true;
        },
        async navigate(location: unknown) {
          assert.equal(h.pdfViewer.scrollMode, 0);
          assert.equal(h.pdfViewer.currentScaleValue, "page-width");
          assert.deepEqual(location, { pageIndex: 1 });
        },
        uninit() {},
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
  await preview.ready;
  const viewport = h.pdfWindow.document.getElementById("viewerContainer")!;
  assert.equal("PDFViewerApplication" in h.pdfWindow, false);
  assert.equal(viewport.style.overflow, "auto");
  assert.equal(viewport.style.overscrollBehavior, "contain");
  assert.notEqual(h.frame.style.pointerEvents, "none");
  assert.equal(h.win.document.activeElement, h.input);
  assert.equal(h.nativeLayouts, 1);
  viewport.scrollTop = 420;
  viewport.dispatchEvent(new h.pdfWindow.Event("scroll"));
  h.pdfWindow.dispatchEvent(new h.pdfWindow.Event("resize"));
  assert.equal(h.pdfViewer.scrollMode, 0);
  assert.equal(h.pdfViewer.currentScaleValue, "page-width");
  assert.equal(h.nativeLayouts, 1, "the thumbnail resize handler is detached");
  assert.equal(viewport.scrollTop, 420);
  preview.dispose();
  h.pdfViewer.scrollMode = 3;
  h.pdfViewer.currentScaleValue = "page-height";
  h.pdfWindow.dispatchEvent(new h.pdfWindow.Event("resize"));
  assert.equal(
    h.pdfViewer.scrollMode,
    3,
    "disposed layout listeners are removed",
  );
  assert.equal(h.nativeLayouts, 1);
});

test("PDF pointer presence and event ownership cover both documents without outliving the preview", async (t) => {
  const opening = deferred<void>();
  const complete = deferred<boolean>();
  const presence: boolean[] = [];
  const h = host(t, {
    async openPreview() {
      return {
        async _open() {
          opening.resolve();
          return complete.promise;
        },
        uninit() {},
      };
    },
  });
  const preview = mountPdfLinkPreview({
    container: h.container,
    itemID: 42,
    isCurrent: () => true,
    onPointerPresence: (inside) => presence.push(inside),
  });
  h.loaded();
  await opening.promise;
  const readerDocument = h.readerDocument;
  const outerNode = readerDocument.body;
  outerNode.dispatchEvent(
    new h.win.MouseEvent("pointerover", { bubbles: true }),
  );
  assert.deepEqual(
    presence,
    [true],
    "outer reader is owned while the PDF loads",
  );
  assert.equal(preview.containsEventTarget(h.frame), true);
  assert.equal(preview.containsEventTarget(readerDocument as never), true);
  assert.equal(
    preview.containsEventTarget(readerDocument.defaultView as never),
    true,
  );
  assert.equal(preview.containsEventTarget(outerNode as never), true);
  assert.equal(preview.containsEventTarget(h.win as never), false);
  complete.resolve(true);
  await preview.ready;
  const innerDocument = h.pdfWindow.document;
  const innerNode = innerDocument.getElementById("viewerContainer")!;
  assert.equal(preview.containsEventTarget(innerDocument as never), true);
  assert.equal(preview.containsEventTarget(h.pdfWindow as never), true);
  assert.equal(preview.containsEventTarget(innerNode as never), true);
  assert.equal(preview.containsEventTarget(h.input as never), false);
  outerNode.dispatchEvent(
    new h.win.MouseEvent("pointerout", {
      bubbles: true,
      relatedTarget: innerNode,
    }),
  );
  assert.deepEqual(
    presence,
    [true],
    "moving between owned documents stays inside",
  );
  innerNode.dispatchEvent(
    new h.pdfWindow.MouseEvent("pointerover", { bubbles: true }),
  );
  innerNode.dispatchEvent(
    new h.pdfWindow.MouseEvent("pointerout", {
      bubbles: true,
      relatedTarget: h.input,
    }),
  );
  assert.deepEqual(presence, [true, true, false]);
  preview.dispose();
  const count = presence.length;
  outerNode.dispatchEvent(
    new h.win.MouseEvent("pointerover", { bubbles: true }),
  );
  innerNode.dispatchEvent(
    new h.pdfWindow.MouseEvent("pointerover", { bubbles: true }),
  );
  assert.equal(presence.length, count);
  assert.equal(preview.containsEventTarget(innerNode as never), false);
  assert.equal(preview.containsEventTarget(readerDocument as never), false);
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

test("native annotation announcements have an owned accessible live region", async (t) => {
  for (const existing of [false, true]) {
    await t.test(
      existing
        ? "reuses the native region"
        : "creates the missing preview region",
      async (t) => {
        let region: HTMLElement | null = null;
        let nativeDocument: Document;
        let nativeFrame: { contentDocument: Document | null };
        const h = host(t, {
          async openPreview(_itemID: number, frame: unknown) {
            nativeFrame = frame as typeof nativeFrame;
            nativeDocument = nativeFrame.contentDocument!;
            return {
              async _open() {
                if (existing) {
                  region = nativeDocument.createElement("div");
                  region.id = "a11yAnnouncement";
                  region.setAttribute("aria-live", "polite");
                  region.dataset.nativeRegion = "retained";
                  region.innerText = "Previous native announcement";
                  nativeDocument.body.append(region);
                }
                return true;
              },
              async navigate(location: { annotationID?: string }) {
                if (!location.annotationID) return;
                const announcement =
                  nativeDocument.getElementById("a11yAnnouncement")!;
                assert.ok(announcement);
                assert.equal(announcement.ownerDocument, nativeDocument);
                assert.equal(announcement.getAttribute("aria-live"), "polite");
                assert.equal(announcement.hidden, false);
                if (existing) {
                  assert.equal(announcement, region);
                  assert.equal(announcement.dataset.nativeRegion, "retained");
                  assert.equal(
                    announcement.innerText,
                    "Previous native announcement",
                  );
                }
                // Zotero's native setA11yMessage uses this exact DOM operation.
                announcement.innerText = "Highlight annotation selected";
                region = announcement;
              },
              uninit() {},
            };
          },
        });
        const preview = mountPdfLinkPreview({
          container: h.container,
          itemID: 42,
          location: { pageIndex: 1, annotationID: "ANNO0001" },
          isCurrent: () => true,
        });
        h.loaded();
        await preview.ready;
        assert.equal(region!.innerText, "Highlight annotation selected");
        assert.equal(
          h.container.ownerDocument.getElementById("a11yAnnouncement"),
          null,
        );
        preview.dispose();
        assert.equal(h.container.childElementCount, 0);
        assert.equal(nativeFrame!.contentDocument, null);
      },
    );
  }
});

test("closing between PDF page and annotation navigation releases the reader without selecting an old annotation", async (t) => {
  const navigating = deferred<void>();
  const complete = deferred<void>();
  const released = deferred<void>();
  let loaded = false;
  let uninitializations = 0;
  const locations: unknown[] = [];
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
          locations.push(location);
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
    location: { pageIndex: 1, annotationID: "ANNO0001" },
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
  assert.deepEqual(locations, [{ pageIndex: 1 }]);
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
