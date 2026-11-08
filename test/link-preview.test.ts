import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { createLinkPreviewController } from "../src/modules/markdown/link-preview.ts";
import type { LinkPreviewContent } from "../src/modules/markdown/link-preview-content.ts";
import type { LinkHoverTarget } from "../src/modules/markdown/editor-protocol.ts";
import type { PdfLinkPreviewOptions } from "../src/modules/markdown/link-preview-pdf.ts";
import { invalidateNoteLibrary } from "../src/modules/markdown/note-library.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const href = (key: string) => `[[${key}]]`;
const target = (name: string): LinkHoverTarget => ({
  href: href(name),
  rect: { left: 40, top: 50, right: 100, bottom: 72 },
});
const item = (name: string): LinkPreviewContent => ({
  status: "resolved",
  kind: "item",
  href: href(name),
  sourceItemID: 2,
  title: name,
  text: `Abstract ${name}`,
});

test("an asynchronously enlarged PDF card keeps the pointer inside the card near the viewport bottom", async (t) => {
  const content = deferred<LinkPreviewContent>();
  const ready = deferred<void>();
  const app = setup(
    t,
    () => content.promise,
    () => ({
      ready: ready.promise,
      containsEventTarget: () => false,
      dispose() {},
    }),
  );
  Object.defineProperty(app.win, "innerHeight", { value: 768 });
  // Happy DOM supplies no layout. Model only the browser's measured height;
  // the controller still chooses and updates its own viewport position.
  t.mock.method(app.panel, "getBoundingClientRect", () => {
    const top = Number.parseFloat(app.panel.style.top) || 0;
    const left = Number.parseFloat(app.panel.style.left) || 0;
    const height = app.body().querySelector(".zmd-link-preview-pdf")
      ? 400
      : 100;
    return {
      left,
      top,
      right: left + 380,
      bottom: top + height,
      height,
      width: 380,
    } as DOMRect;
  });
  app.controller.show({
    href: "zotero://open-pdf/library/items/ABCDEFGH?page=2",
    rect: { left: 40, top: 500, right: 200, bottom: 524 },
  });
  const loadingRect = app.panel.getBoundingClientRect();
  const pointer = { x: loadingRect.left + 20, y: loadingRect.top + 50 };
  app.panel.dispatchEvent(
    new app.win.MouseEvent("mouseenter", {
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  );
  // The iframe's delayed leave message follows entry into the host-owned card.
  app.controller.show(null);
  content.resolve({
    status: "resolved",
    kind: "pdf",
    sourceItemID: 42,
    attachmentID: 42,
    href: "zotero://open-pdf/library/items/ABCDEFGH?page=2",
    title: "PDF",
    location: { pageIndex: 1 },
  });
  await flush();
  const pdfRect = app.panel.getBoundingClientRect();
  assert.ok(
    pointer.y >= pdfRect.top && pointer.y <= pdfRect.bottom,
    `loading card at ${loadingRect.top} moved away from pointer ${pointer.y} to PDF card at ${pdfRect.top}`,
  );
  app.advance(150);
  assert.equal(app.panel.style.display, "flex");
});

test("native PDF subdocument layout events keep their owning card open", async (t) => {
  const app = setup(t, async () => item("PDF"));
  app.controller.show(target("PDF"));
  await flush();
  const pdfWindow = new Window();
  t.after(() => pdfWindow.happyDOM.close());
  const viewer = pdfWindow.document.createElement("div");
  // Gecko forwards this subdocument event to chrome; Happy DOM needs that
  // browser boundary supplied explicitly while the controller remains real.
  const event = new app.win.Event("scroll");
  Object.defineProperty(event, "target", { value: viewer });
  app.win.document.dispatchEvent(event);
  assert.equal(app.panel.style.display, "flex");
  for (const type of ["resize", "blur", "focus"]) {
    const layout = new app.win.Event(type);
    Object.defineProperty(layout, "target", { value: pdfWindow });
    app.win.dispatchEvent(layout);
    assert.equal(app.panel.style.display, "flex");
  }
  app.root.dispatchEvent(new app.win.Event("scroll", { bubbles: true }));
  assert.equal(app.panel.style.display, "none");
});

test("PDF canvas focus keeps the popup open until its chrome window deactivates", async (t) => {
  const app = setup(t, async () => item("PDF"));
  app.controller.show(target("PDF"));
  await flush();
  // Native PDF canvas focus blurs the top window and makes hasFocus false
  // without deactivating its chrome window.
  t.mock.method(app.win.document, "hasFocus", () => false);
  app.win.dispatchEvent(new app.win.Event("blur"));
  assert.equal(app.panel.style.display, "flex");
  const pdfWindow = new Window();
  t.after(() => pdfWindow.happyDOM.close());
  const foreign = new app.win.Event("deactivate");
  Object.defineProperty(foreign, "target", { value: pdfWindow });
  app.win.dispatchEvent(foreign);
  assert.equal(app.panel.style.display, "flex");
  app.win.dispatchEvent(new app.win.Event("deactivate"));
  assert.equal(app.panel.style.display, "none");
});

test("background note-index completion invalidates cache without closing the current card", async (t) => {
  let loads = 0;
  const app = setup(t, async () => {
    loads++;
    return item("Target");
  });
  app.controller.show(target("Target"));
  await flush();
  invalidateNoteLibrary(1);
  assert.equal(app.panel.style.display, "flex");
  app.controller.hide();
  app.controller.show(target("Target"));
  await flush();
  assert.equal(loads, 2);
});

test("unrelated item modifications and refreshes clear cached metadata without dismissing the card", async (t) => {
  let loads = 0;
  const app = setup(t, async () => {
    loads++;
    return item("Target");
  });
  app.controller.show(target("Target"));
  await flush();
  for (const event of ["modify", "refresh"]) {
    app.notify(event, "item", [999]);
    assert.equal(app.panel.style.display, "flex", event);
  }
  app.controller.hide();
  app.controller.show(target("Target"));
  await flush();
  assert.equal(loads, 2);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(
  t: TestContext,
  load: (value: string) => Promise<LinkPreviewContent>,
  mountPdf?: (options: PdfLinkPreviewOptions) => {
    ready: Promise<void>;
    containsEventTarget(target: EventTarget | null): boolean;
    dispose(): void;
  },
) {
  const globals = globalThis as any;
  const previous = new Map(
    ["Zotero", "ztoolkit"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key),
    ]),
  );
  let observer:
    { notify(event?: string, type?: string, ids?: number[]): void } | undefined;
  let unregisters = 0;
  globals.Zotero = {
    Notifier: {
      registerObserver(value: typeof observer) {
        observer = value;
        return 7;
      },
      unregisterObserver(id: number) {
        assert.equal(id, 7);
        observer = undefined;
        unregisters++;
      },
    },
  };
  globals.ztoolkit = { log() {} };
  const win = new Window({ url: "https://preview.example/" });
  const root = win.document.createElement("main");
  win.document.body.append(root);
  let now = 0;
  let sequence = 1;
  const timers = new Map<number, { at: number; run(): void }>();
  t.mock.method(win, "setTimeout", (callback: any, delay = 0) => {
    const id = sequence++;
    timers.set(id, { at: now + delay, run: callback });
    return id;
  });
  t.mock.method(win, "clearTimeout", (id: number) => {
    timers.delete(id);
  });
  const advance = (duration: number) => {
    const end = now + duration;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      timer.run();
    }
    now = end;
  };
  let disposed = 0;
  let active = true;
  const opened: string[] = [];
  const openedSources: (number | undefined)[] = [];
  const controller = createLinkPreviewController({
    root: root as unknown as HTMLElement,
    currentItem: { id: 1, key: "SOURCE01", libraryID: 1 } as Zotero.Item,
    win: win as unknown as Window,
    isActive: () => active,
    onOpen: (value, sourceItemID) => {
      opened.push(value);
      openedSources.push(sourceItemID);
    },
    loader: { load, dispose: () => disposed++ },
    mountPdf,
    labels: {
      loading: "Loading",
      empty: "Empty",
      unavailable: "Unavailable",
      unresolved: "Unresolved",
      ambiguous: "Ambiguous",
      failed: "Failed",
      open: "Open",
    },
  });
  const panel = win.document.querySelector<HTMLElement>(".zmd-link-preview")!;
  const title = () =>
    panel.querySelector(".zmd-link-preview-title")!.textContent;
  const body = () => panel.querySelector(".zmd-link-preview-body")!;
  t.after(async () => {
    controller.dispose();
    await win.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  return {
    win,
    root,
    controller,
    panel,
    title,
    body,
    advance,
    opened,
    openedSources,
    notify: (event?: string, type?: string, ids?: number[]) =>
      observer?.notify(event, type, ids),
    deactivate: () => {
      active = false;
    },
    disposed: () => disposed,
    unregisters: () => unregisters,
  };
}

test("rapid hover changes load only the running and latest target, showing only the latest", async (t) => {
  const requests = new Map<
    string,
    ReturnType<typeof deferred<LinkPreviewContent>>
  >();
  const loaded: string[] = [];
  const app = setup(t, (value) => {
    loaded.push(value);
    const request = deferred<LinkPreviewContent>();
    requests.set(value, request);
    return request.promise;
  });
  app.controller.show(target("A"));
  app.controller.show(target("B"));
  app.controller.show(target("C"));
  assert.deepEqual(loaded, [href("A")]);
  requests.get(href("A"))!.resolve(item("A"));
  await flush();
  assert.deepEqual(loaded, [href("A"), href("C")]);
  assert.equal(app.title(), "Loading");
  assert.doesNotMatch(app.panel.textContent, /Abstract A/);
  requests.get(href("C"))!.resolve(item("C"));
  await flush();
  assert.equal(app.title(), "C");
  assert.equal(app.body().textContent, "Abstract C");
  app.controller.show({
    ...target("C"),
    rect: { left: 70, top: 80, right: 90, bottom: 100 },
  });
  await flush();
  assert.deepEqual(loaded, [href("A"), href("C")]);
  assert.equal(app.panel.style.left, "70px");
});

test("late content cannot restore a preview after leaving, hiding, disposal or surface closure", async (t) => {
  for (const reason of [
    "leave",
    "hide",
    "dispose",
    "inactive",
    "detached",
  ] as const) {
    await t.test(reason, async (t) => {
      const pending = deferred<LinkPreviewContent>();
      const app = setup(t, () => pending.promise);
      app.controller.show(target("Old"));
      if (reason === "leave") {
        app.controller.leave();
        app.advance(150);
      }
      if (reason === "hide") app.controller.hide();
      if (reason === "dispose") app.controller.dispose();
      if (reason === "inactive") app.deactivate();
      if (reason === "detached") app.root.remove();
      pending.resolve(item("Old"));
      await flush();
      assert.doesNotMatch(app.panel.textContent, /Abstract Old/);
      assert.notEqual(app.title(), "Old");
      if (reason === "leave" || reason === "hide")
        assert.equal(app.panel.style.display, "none");
      if (reason === "dispose") {
        assert.equal(app.panel.isConnected, false);
        assert.equal(app.disposed(), 1);
        assert.equal(app.unregisters(), 1);
        app.controller.show(target("New"));
        assert.equal(app.panel.isConnected, false);
      }
    });
  }
});

test("PDF previews own their mounts and ignore readiness from released readers", async (t) => {
  const mounts: {
    options: PdfLinkPreviewOptions;
    result: ReturnType<typeof deferred<void>>;
    disposed: number;
  }[] = [];
  const app = setup(
    t,
    async (value) =>
      value === href("Text")
        ? item("Text")
        : {
            status: "resolved",
            kind: "pdf",
            sourceItemID: 42,
            href: value,
            title: value,
            attachmentID: 42,
            location: { pageIndex: 8, annotationID: "ANNOT001" },
          },
    (options) => {
      const mount = { options, result: deferred<void>(), disposed: 0 };
      mounts.push(mount);
      return {
        ready: mount.result.promise,
        containsEventTarget: () => false,
        dispose: () => mount.disposed++,
      };
    },
  );
  app.controller.show(target("PDF"));
  await flush();
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0].options.itemID, 42);
  assert.deepEqual(mounts[0].options.location, {
    pageIndex: 8,
    annotationID: "ANNOT001",
  });
  assert.equal(mounts[0].options.isCurrent(), true);
  assert.ok(app.body().querySelector(".zmd-link-preview-pdf"));
  app.controller.show(target("Text"));
  await flush();
  assert.equal(mounts[0].disposed, 1);
  assert.equal(mounts[0].options.isCurrent(), false);
  mounts[0].result.resolve();
  await flush();
  assert.equal(app.body().textContent, "Abstract Text");
  app.controller.show(target("PDF"));
  await flush();
  mounts[1].result.reject(new Error("Unavailable reader"));
  await flush();
  assert.equal(app.body().textContent, "Failed");
  assert.equal(mounts[1].disposed, 1);
  app.controller.show(target("Another PDF"));
  await flush();
  app.controller.dispose();
  assert.equal(mounts[2].disposed, 1);
  mounts[2].result.resolve();
  await flush();
  assert.equal(app.panel.isConnected, false);
});

test("PDF pointer handoff and owned subdocument input preserve the card until exit or Escape", async (t) => {
  const pdfWindow = new Window();
  t.after(() => pdfWindow.happyDOM.close());
  const viewer = pdfWindow.document.createElement("div");
  pdfWindow.document.body.append(viewer);
  const owned = new Set<EventTarget>([viewer]);
  let presence: PdfLinkPreviewOptions["onPointerPresence"];
  const app = setup(
    t,
    async (value) => ({
      status: "resolved",
      kind: "pdf",
      sourceItemID: 42,
      href: value,
      title: "PDF",
      attachmentID: 42,
    }),
    (options) => {
      presence = options.onPointerPresence;
      return {
        ready: Promise.resolve(),
        containsEventTarget: (target) => target !== null && owned.has(target),
        dispose() {},
      };
    },
  );
  const forward = (type: "pointerdown" | "keydown", key?: string) => {
    const event =
      type === "keydown"
        ? new app.win.KeyboardEvent(type, { key, bubbles: true })
        : new app.win.Event(type, { bubbles: true });
    Object.defineProperty(event, "target", { value: viewer });
    app.win.document.dispatchEvent(event);
  };
  app.controller.show(target("PDF"));
  await flush();
  assert.equal(typeof presence, "function");
  app.controller.leave();
  app.advance(100);
  presence!(true);
  app.advance(100);
  assert.equal(app.panel.style.display, "flex");
  forward("pointerdown");
  forward("keydown", "PageDown");
  assert.equal(app.panel.style.display, "flex");
  presence!(false);
  app.advance(150);
  assert.equal(app.panel.style.display, "none");
  app.controller.show(target("PDF"));
  await flush();
  presence!(true);
  forward("keydown", "Escape");
  assert.equal(app.panel.style.display, "none");
});

test("metadata is reused until invalidation while Markdown content is read again", async (t) => {
  const counts = new Map<string, number>();
  const app = setup(t, async (value) => {
    const version = (counts.get(value) ?? 0) + 1;
    counts.set(value, version);
    return value === href("Markdown")
      ? {
          status: "resolved",
          kind: "markdown",
          sourceItemID: 2,
          href: value,
          title: "Markdown",
          bodyHtml: `<p>Draft ${version}</p><img src="https://image.example/remote.png">`,
        }
      : { ...item("Metadata"), title: `Metadata ${version}` };
  });
  app.controller.show(target("Metadata"));
  await flush();
  app.controller.hide();
  app.controller.show(target("Metadata"));
  await flush();
  assert.equal(counts.get(href("Metadata")), 1);
  app.notify();
  assert.equal(app.panel.style.display, "flex");
  assert.equal(app.title(), "Metadata 1");
  app.controller.hide();
  app.controller.show(target("Metadata"));
  await flush();
  assert.equal(app.title(), "Metadata 2");
  for (const version of [1, 2]) {
    app.controller.hide();
    app.controller.show(target("Markdown"));
    await flush();
    assert.equal(app.body().textContent, `Draft ${version}`);
    assert.equal(app.body().querySelector("img"), null);
  }
  assert.equal(counts.get(href("Markdown")), 2);
});

test("links inside another note's snippet navigate from that note while Open retains the original reference", async (t) => {
  const app = setup(t, async (value) => ({
    status: "resolved",
    kind: "markdown",
    href: value,
    sourceItemID: 42,
    title: "Referenced note B",
    bodyHtml:
      '<a href="#Details">Details</a><span data-zmd-wikilink="Same-library note">Other note</span>',
  }));
  for (const [selector, expected] of [
    ["a", "#Details"],
    ["[data-zmd-wikilink]", "[[Same-library note]]"],
  ]) {
    app.controller.show(target("Note B"));
    await flush();
    app
      .body()
      .querySelector(selector)!
      .dispatchEvent(new app.win.MouseEvent("click", { bubbles: true }));
    assert.equal(app.opened.at(-1), expected);
    assert.equal(app.openedSources.at(-1), 42);
  }
  app.controller.show(target("Note B"));
  await flush();
  app.panel
    .querySelector("button")!
    .dispatchEvent(new app.win.MouseEvent("click", { bubbles: true }));
  assert.equal(app.opened.at(-1), "[[Note B]]");
  assert.equal(app.openedSources.at(-1), undefined);
});

test("reading and backlink DOM links share dwell previews that remain open over the card", async (t) => {
  const loaded: string[] = [];
  const app = setup(t, async (value) => {
    loaded.push(value);
    return { ...item("Read"), href: value };
  });
  app.root.innerHTML =
    '<a href="zotero://select/library/items/ABCDEFGH"><span>Read</span></a><span data-zmd-wikilink="Note--ABCDEFGH">Note</span><button data-zmd-preview-href="[[Backlink--ABCDEFGH]]">Backlink</button><a href="https://example.com">External</a>';
  const unbind = app.controller.bindLinks(app.root as unknown as HTMLElement);
  const selectors = [
    "a span",
    "[data-zmd-wikilink]",
    "[data-zmd-preview-href]",
  ];
  for (const selector of selectors) {
    const link = app.root.querySelector(selector)!;
    link.dispatchEvent(new app.win.MouseEvent("mouseover", { bubbles: true }));
    const before = loaded.length;
    app.advance(299);
    assert.equal(loaded.length, before);
    app.advance(1);
    await flush();
    assert.equal(app.panel.style.display, "flex");
    link.dispatchEvent(
      new app.win.MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: app.panel,
      }),
    );
    app.panel.dispatchEvent(new app.win.MouseEvent("mouseenter"));
    app.advance(200);
    assert.equal(app.panel.style.display, "flex");
    app.body().dispatchEvent(new app.win.Event("scroll", { bubbles: true }));
    assert.equal(app.panel.style.display, "flex");
    app.panel
      .querySelector("button")!
      .dispatchEvent(new app.win.MouseEvent("click", { bubbles: true }));
    assert.equal(app.opened.length, selectors.indexOf(selector) + 1);
    assert.equal(app.panel.style.display, "none");
  }
  assert.deepEqual(app.opened, [
    "zotero://select/library/items/ABCDEFGH",
    "[[Note--ABCDEFGH]]",
    "[[Backlink--ABCDEFGH]]",
  ]);
  const external = app.root.querySelector('a[href^="https:"]')!;
  external.dispatchEvent(
    new app.win.MouseEvent("mouseover", { bubbles: true }),
  );
  app.advance(300);
  assert.equal(loaded.length, 3);
  assert.equal(app.panel.style.display, "none");
  const link = app.root.querySelector("a span")!;
  link.dispatchEvent(new app.win.MouseEvent("mouseover", { bubbles: true }));
  unbind();
  app.advance(300);
  assert.equal(app.panel.style.display, "none");
  assert.equal(loaded.length, 3);
});
