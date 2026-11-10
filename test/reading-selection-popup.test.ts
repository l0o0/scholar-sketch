import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { mountReadingSelectionPopup } from "../src/modules/markdown/reading-selection-popup.ts";
import type {
  ReadingTranslationResult,
  ReadingTranslationServices,
} from "../src/modules/markdown/reading-translation.ts";
import type { EditorTextSelection } from "../src/modules/markdown/editor-protocol.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(
  t: TestContext,
  translate: (
    text: string,
    serviceID?: string,
  ) => Promise<ReadingTranslationResult>,
  getServices: () => ReadingTranslationServices = () => ({
    status: "available",
    services: [
      { id: "A", name: "Service A" },
      { id: "B", name: "Service B" },
      { id: "C", name: "Service C" },
    ],
  }),
) {
  const win = new Window({ url: "https://reading.example/" });
  const doc = win.document;
  const root = doc.createElement("main");
  root.innerHTML =
    '<header>Reading toolbar</header><article class="zotero-markdown-preview-inner"><p>  Alpha text  </p><p>Beta text</p><p>Gamma text</p></article>';
  const outside = doc.createElement("article");
  outside.className = "zotero-markdown-preview-inner";
  outside.textContent = "Another reading surface";
  doc.body.append(root, outside);
  let geometry = {
    left: 80,
    top: 100,
    right: 190,
    bottom: 120,
    width: 110,
    height: 20,
  };
  Object.defineProperties(win.Range.prototype, {
    getClientRects: { configurable: true, value: () => [geometry] },
    getBoundingClientRect: { configurable: true, value: () => geometry },
  });
  let active = true;
  let source: "preview" | "editor" = "preview";
  let shows = 0;
  const controller = mountReadingSelectionPopup({
    root: root as unknown as HTMLElement,
    isActive: (kind) => active && kind === source,
    translate,
    getServices,
    onShow: () => {
      shows++;
    },
    labels: {
      translate: "Translate",
      loading: "Loading",
      retry: "Retry",
      unavailable: "Unavailable",
      failed: "Failed",
      close: "Close",
      region: "Selection translation",
      services: "Translation service",
      defaultService: "Follow plugin default",
      servicesUnavailable: "Services unavailable",
      servicesFailed: "Failed to load services",
      servicesEmpty: "No services",
    },
  });
  const panel = doc.querySelector<HTMLElement>(".zmd-reading-selection-popup")!;
  const action = panel.querySelector<HTMLButtonElement>(
    ".zmd-reading-selection-translate",
  )!;
  const close = panel.querySelector<HTMLButtonElement>(
    ".zmd-reading-selection-close",
  )!;
  const result = panel.querySelector<HTMLElement>(
    ".zmd-reading-selection-result",
  )!;
  t.mock.method(
    panel,
    "getBoundingClientRect",
    () =>
      ({
        width: result.hidden ? 120 : 320,
        height: result.hidden ? 40 : 160,
      }) as DOMRect,
  );
  const paragraphs = root.querySelectorAll("p");
  const select = (
    element = paragraphs[0],
    from = 0,
    to = element.textContent.length,
    notify = true,
  ) => {
    const range = doc.createRange();
    range.setStart(element.firstChild!, from);
    range.setEnd(element.firstChild!, to);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    if (notify) doc.dispatchEvent(new win.Event("selectionchange"));
    return range;
  };
  t.after(async () => {
    controller.dispose();
    await win.happyDOM.close();
  });
  return {
    win,
    doc,
    root,
    outside,
    paragraphs,
    controller,
    panel,
    action,
    close,
    result,
    services: () =>
      panel.querySelector<HTMLButtonElement>(
        ".zmd-reading-selection-services",
      )!,
    serviceMenu: () =>
      panel.querySelector<HTMLElement>(".zmd-reading-selection-service-menu")!,
    service: (id: string) =>
      [...panel.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (entry) => entry.dataset.serviceId === id,
      )!,
    select,
    deactivate: () => {
      active = false;
    },
    useSource: (kind: typeof source) => {
      source = kind;
      root.style.display = kind === "editor" ? "none" : "block";
    },
    moveGeometry: (value: typeof geometry) => {
      geometry = value;
    },
    shows: () => shows,
  };
}

function editorSelection(
  text = "  Live selection  ",
  rev = 1,
  from = 2,
): EditorTextSelection {
  return {
    rev,
    from,
    to: from + text.length,
    text,
    rect: { left: 80, top: 100, right: 190, bottom: 120 },
  };
}

test("the service menu exposes the checked service and supports keyboard navigation, Escape and an untrapped Tab exit", async (t) => {
  const calls: (string | undefined)[] = [];
  const app = setup(t, async (_text, serviceID) => {
    calls.push(serviceID);
    return { status: "translated", text: "Translated" };
  });
  app.select();
  const trigger = app.services();
  assert.equal(trigger.getAttribute("aria-label"), "Translation service");
  assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  const key = (value: string) => {
    const focused = app.doc.activeElement!;
    const event = new app.win.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    });
    focused.dispatchEvent(event);
    // Happy DOM does not synthesize a button's native Enter click. Emulate
    // only that browser default when the real handler has not consumed it.
    if (
      value === "Enter" &&
      !event.defaultPrevented &&
      focused.tagName === "BUTTON"
    )
      (focused as HTMLButtonElement).click();
    return event;
  };
  trigger.focus();
  key("ArrowDown");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(app.serviceMenu().getAttribute("role"), "menu");
  assert.equal(app.doc.activeElement, app.service(""));
  assert.equal(app.service("").getAttribute("aria-checked"), "true");
  key("End");
  assert.equal(app.doc.activeElement, app.service("C"));
  key("Home");
  key("ArrowDown");
  assert.equal(app.doc.activeElement, app.service("A"));
  key("Enter");
  await flush();
  assert.deepEqual(calls, ["A"]);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(app.doc.activeElement, trigger);
  trigger.click();
  assert.equal(app.service("A").getAttribute("aria-checked"), "true");
  const escape = key("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(app.doc.activeElement, trigger);
  assert.equal(
    app.controller.isOpen(),
    true,
    "the first Escape closes only the menu",
  );
  trigger.click();
  const tab = key("Tab");
  assert.equal(tab.defaultPrevented, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(app.controller.isOpen(), true);
  trigger.click();
  trigger.dispatchEvent(
    new app.win.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(
    app.doc.activeElement === trigger,
    true,
    "mouse toggle restores focus",
  );
  trigger.click();
  app.outside.dispatchEvent(
    new app.win.PointerEvent("pointerdown", { bubbles: true }),
  );
  assert.equal(app.controller.isOpen(), false);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
});

test("service choices preserve preview and editor snapshots, persist per surface, and refresh the menu on every opening", async (t) => {
  for (const source of ["preview", "editor"] as const) {
    await t.test(source, async (t) => {
      const calls: { text: string; serviceID?: string }[] = [];
      let reads = 0;
      const app = setup(
        t,
        async (text, serviceID) => {
          calls.push({ text, serviceID });
          return { status: "translated", text: "Translated" };
        },
        () => ({
          status: "available",
          services:
            ++reads === 1
              ? [
                  { id: "A", name: "Service A" },
                  { id: "B", name: "Service B" },
                ]
              : [
                  { id: "B", name: "Service B" },
                  { id: "C", name: "New service C" },
                ],
        }),
      );
      const first =
        source === "preview" ? "  Alpha text  " : "  Live selection  ";
      if (source === "preview") app.select();
      else {
        app.useSource("editor");
        app.controller.showEditorSelection(editorSelection());
      }
      app.services().click();
      const down = new app.win.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      app.service("B").dispatchEvent(down);
      assert.equal(down.defaultPrevented, true);
      app.service("B").focus();
      app.doc.getSelection()!.removeAllRanges();
      app.doc.dispatchEvent(new app.win.Event("selectionchange"));
      assert.equal(app.controller.isOpen(), true);
      app.service("B").click();
      await flush();
      assert.deepEqual(calls, [{ text: first, serviceID: "B" }]);
      assert.equal(app.doc.activeElement, app.services());
      if (source === "preview") app.select(app.paragraphs[1]);
      else app.controller.showEditorSelection(editorSelection("Beta text", 2));
      app.services().click();
      assert.equal(reads, 2);
      assert.equal(app.service("B").getAttribute("aria-checked"), "true");
      assert.equal(app.service("A"), undefined);
      assert.equal(app.service("C").textContent, "New service C");
      app.service("B").click();
      await flush();
      assert.deepEqual(calls[1], { text: "Beta text", serviceID: "B" });
      app.services().click();
      app.service("").click();
      await flush();
      assert.deepEqual(calls[2], { text: "Beta text", serviceID: undefined });
    });
  }
});

test("switching services replaces pending work and cannot display results from the old service or a closed menu", async (t) => {
  const calls: string[] = [];
  const jobs: ReturnType<typeof deferred<ReadingTranslationResult>>[] = [];
  const app = setup(t, (_text, serviceID) => {
    calls.push(serviceID!);
    const job = deferred<ReadingTranslationResult>();
    jobs.push(job);
    return job.promise;
  });
  app.select();
  for (const id of ["A", "B", "C"]) {
    app.services().click();
    app.service(id).click();
  }
  assert.deepEqual(calls, ["A"]);
  jobs[0].resolve({ status: "translated", text: "Old service A result" });
  await flush();
  assert.deepEqual(calls, ["A", "C"]);
  assert.equal(app.result.textContent, "Loading");
  jobs[1].resolve({ status: "translated", text: "Current service C result" });
  await flush();
  assert.equal(app.result.textContent, "Current service C result");
  app.services().click();
  app.service("A").click();
  app.services().click();
  app.service("B").click();
  app.controller.dispose();
  jobs[2].resolve({ status: "translated", text: "After disposal" });
  await flush();
  assert.deepEqual(calls, ["A", "C", "A"]);
  assert.equal(app.panel.isConnected, false);
  assert.doesNotMatch(app.panel.textContent, /After disposal/);
});

test("service-list errors and empty lists leave the plugin-default translation available", async (t) => {
  for (const [state, label] of [
    [{ status: "unavailable" }, "Services unavailable"],
    [{ status: "failed" }, "Failed to load services"],
    [{ status: "available", services: [] }, "No services"],
  ] as const) {
    await t.test(
      state.status + ("services" in state ? " empty" : ""),
      async (t) => {
        const calls: (string | undefined)[] = [];
        const app = setup(
          t,
          async (_text, serviceID) => {
            calls.push(serviceID);
            return { status: "translated", text: "Default result" };
          },
          () => state as ReadingTranslationServices,
        );
        app.select();
        app.services().click();
        assert.ok(app.serviceMenu().textContent.includes(label));
        assert.deepEqual(calls, []);
        app.service("").click();
        await flush();
        assert.deepEqual(calls, [undefined]);
        assert.equal(app.result.textContent, "Default result");
      },
    );
  }
});

test("Live selection uses the raw iframe snapshot while its reading root is hidden, and rectangle updates retain the translation", async (t) => {
  const calls: string[] = [];
  const app = setup(t, async (text) => {
    calls.push(text);
    return { status: "translated", text: "Live translated" };
  });
  app.useSource("editor");
  const selection = editorSelection();
  app.controller.showEditorSelection(selection);
  assert.equal(app.root.style.display, "none");
  assert.equal(app.controller.isOpen(), true);
  assert.equal(app.result.hidden, true);
  assert.deepEqual(calls, []);
  app.doc.getSelection()!.removeAllRanges();
  app.doc.dispatchEvent(new app.win.Event("selectionchange"));
  app.doc.body.dispatchEvent(
    new app.win.KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
  );
  assert.equal(
    app.controller.isOpen(),
    true,
    "host DOM selection events cannot clear the iframe snapshot",
  );
  const down = new app.win.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  app.action.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  app.action.click();
  await flush();
  assert.deepEqual(calls, [selection.text]);
  assert.equal(app.result.textContent, "Live translated");
  const previousTop = app.panel.style.top;
  app.controller.showEditorSelection({
    ...selection,
    rect: { left: 80, top: 200, right: 190, bottom: 220 },
  });
  assert.notEqual(app.panel.style.top, previousTop);
  assert.equal(app.result.textContent, "Live translated");
  assert.equal(app.result.hidden, false);
  assert.deepEqual(calls, [selection.text]);
});

test("editor revisions invalidate old results and keep only the latest pending selection", async (t) => {
  const calls: string[] = [];
  const jobs: ReturnType<typeof deferred<ReadingTranslationResult>>[] = [];
  const app = setup(t, (text) => {
    calls.push(text);
    const job = deferred<ReadingTranslationResult>();
    jobs.push(job);
    return job.promise;
  });
  app.useSource("editor");
  const first = editorSelection("First text");
  app.controller.showEditorSelection(first);
  app.action.click();
  app.controller.showEditorSelection({ ...first, rev: 2 });
  assert.equal(app.result.hidden, true);
  assert.equal(app.action.disabled, false);
  app.action.click();
  app.controller.showEditorSelection(editorSelection("Latest text", 2, 30));
  app.action.click();
  assert.deepEqual(calls, ["First text"]);
  jobs[0].resolve({ status: "translated", text: "Outdated" });
  await flush();
  assert.deepEqual(calls, ["First text", "Latest text"]);
  assert.equal(app.result.textContent, "Loading");
  app.controller.showEditorSelection(null);
  jobs[1].resolve({ status: "translated", text: "Cleared selection" });
  await flush();
  assert.equal(app.controller.isOpen(), false);
  assert.doesNotMatch(app.panel.textContent, /Cleared selection|Outdated/);
  app.controller.showEditorSelection(first);
  assert.equal(
    app.controller.isOpen(),
    true,
    "clearing allows the same selection to be selected again",
  );
  app.action.click();
  app.controller.dispose();
  jobs[2].resolve({ status: "translated", text: "Disposed selection" });
  await flush();
  app.controller.showEditorSelection(editorSelection("After dispose", 3));
  assert.equal(app.panel.isConnected, false);
  assert.equal(app.controller.isOpen(), false);
});

test("editor clears stay source-scoped and editor Escape does not consume native shortcuts", (t) => {
  const app = setup(t, async () => ({ status: "unavailable" }));
  app.select();
  app.controller.showEditorSelection(null);
  assert.equal(app.controller.isOpen(), true);
  app.controller.showEditorSelection(editorSelection());
  assert.equal(
    app.controller.isOpen(),
    true,
    "inactive editor messages cannot replace a preview selection",
  );
  app.controller.hide();
  app.useSource("editor");
  app.controller.showEditorSelection(editorSelection());
  const escape = new app.win.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  let received = false;
  app.doc.body.addEventListener("keydown", () => {
    received = true;
  });
  app.doc.body.dispatchEvent(escape);
  assert.equal(app.controller.isOpen(), false);
  assert.equal(escape.defaultPrevented, false);
  assert.equal(received, true);
  app.controller.showEditorSelection(editorSelection("New selection", 2));
  app.outside.dispatchEvent(
    new app.win.PointerEvent("pointerdown", { bubbles: true }),
  );
  assert.equal(app.controller.isOpen(), false);
});

test("only nonempty selections in this reading article show an idle popup outside the exportable article", (t) => {
  const calls: string[] = [];
  const app = setup(t, async (text) => {
    calls.push(text);
    return { status: "translated", text };
  });
  for (const element of [app.root.querySelector("header")!, app.outside]) {
    app.select(element);
    assert.equal(app.controller.isOpen(), false);
  }
  app.select(app.paragraphs[0], 0, 2);
  assert.equal(app.controller.isOpen(), false);
  app.select();
  assert.equal(app.controller.isOpen(), true);
  assert.equal(app.action.getAttribute("aria-label"), "Translate");
  assert.equal(app.action.title, "Translate");
  assert.equal(app.action.textContent, "");
  assert.equal(
    app.action.querySelector(".zmd-icon")?.getAttribute("aria-hidden"),
    "true",
  );
  assert.equal(app.close.hidden, true);
  assert.equal(
    [
      ...app.panel.querySelectorAll(".zmd-reading-selection-actions > button"),
    ].filter((button) => !button.hidden).length,
    2,
  );
  assert.equal(app.result.hidden, true);
  assert.deepEqual(calls, []);
  assert.equal(app.root.querySelector("article")!.contains(app.panel), false);
  assert.equal(app.panel.getAttribute("aria-label"), "Selection translation");
  assert.ok(app.shows() > 0);
  app.action.focus();
  app.select(app.outside);
  assert.equal(
    app.controller.isOpen(),
    false,
    "a noncollapsed outside selection wins over popup focus",
  );
  app.select(app.paragraphs[0]);
  app.controller.hide();
  app.doc.dispatchEvent(new app.win.Event("selectionchange"));
  assert.equal(
    app.controller.isOpen(),
    false,
    "the dismissed selection does not immediately reopen",
  );
  app.select(app.paragraphs[1]);
  const toolbar = app.root.querySelector("header")!;
  toolbar.dispatchEvent(
    new app.win.PointerEvent("pointerdown", { bubbles: true }),
  );
  toolbar.dispatchEvent(
    new app.win.PointerEvent("pointerup", { bubbles: true }),
  );
  assert.equal(
    app.controller.isOpen(),
    false,
    "toolbar clicks cannot reopen the previous body selection",
  );
});

test("pointer selection waits until release and keyboard selection shows the same actions", (t) => {
  const app = setup(t, async () => ({ status: "unavailable" }));
  app.paragraphs[0].dispatchEvent(
    new app.win.PointerEvent("pointerdown", { bubbles: true }),
  );
  app.select();
  assert.equal(app.controller.isOpen(), false);
  app.paragraphs[0].dispatchEvent(
    new app.win.PointerEvent("pointerup", { bubbles: true }),
  );
  assert.equal(app.controller.isOpen(), true);
  app.paragraphs[0].dispatchEvent(
    new app.win.PointerEvent("pointerdown", { bubbles: true }),
  );
  app.paragraphs[0].dispatchEvent(
    new app.win.PointerEvent("pointercancel", { bubbles: true }),
  );
  assert.equal(app.controller.isOpen(), false);
  app.controller.hide();
  app.select(app.paragraphs[1], 0, 4, false);
  app.paragraphs[1].dispatchEvent(
    new app.win.KeyboardEvent("keyup", {
      key: "ArrowRight",
      shiftKey: true,
      bubbles: true,
    }),
  );
  assert.equal(app.controller.isOpen(), true);
  assert.equal(app.action.disabled, false);
});

test("popup button focus preserves the raw selection snapshot and renders translated output as text", async (t) => {
  const calls: string[] = [];
  const app = setup(t, async (text) => {
    calls.push(text);
    return { status: "translated", text: "<img src=x>\nTranslation" };
  });
  app.select();
  const down = new app.win.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  app.action.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  app.action.focus();
  app.doc.getSelection()!.removeAllRanges();
  app.doc.dispatchEvent(new app.win.Event("selectionchange"));
  assert.equal(app.controller.isOpen(), true);
  app.action.click();
  assert.equal(app.result.textContent, "Loading");
  assert.equal(app.close.hidden, false);
  await flush();
  assert.deepEqual(calls, ["  Alpha text  "]);
  assert.equal(app.result.textContent, "<img src=x>\nTranslation");
  assert.equal(app.result.querySelector("img"), null);
  assert.equal(app.controller.isOpen(), true);
});

test("a new selection remains responsive and replaces pending translation without committing old results", async (t) => {
  const calls: string[] = [];
  const jobs = new Map<
    string,
    ReturnType<typeof deferred<ReadingTranslationResult>>
  >();
  const app = setup(t, (text) => {
    calls.push(text);
    const job = deferred<ReadingTranslationResult>();
    jobs.set(text, job);
    return job.promise;
  });
  app.select();
  app.action.click();
  app.select(app.paragraphs[1]);
  assert.equal(app.action.disabled, false);
  assert.equal(app.result.hidden, true);
  app.action.click();
  app.select(app.paragraphs[2]);
  app.action.click();
  assert.deepEqual(calls, ["  Alpha text  "]);
  jobs
    .get(calls[0])!
    .resolve({ status: "translated", text: "Old translation" });
  await flush();
  assert.deepEqual(calls, ["  Alpha text  ", "Gamma text"]);
  assert.equal(app.result.textContent, "Loading");
  jobs
    .get("Gamma text")!
    .resolve({ status: "translated", text: "Latest translation" });
  await flush();
  assert.equal(app.result.textContent, "Latest translation");
});

test("selection clearing, outside clicks and Escape invalidate a running result", async (t) => {
  for (const dismissal of ["clear", "outside", "Escape"] as const) {
    await t.test(dismissal, async (t) => {
      const job = deferred<ReadingTranslationResult>();
      const app = setup(t, () => job.promise);
      app.select();
      app.action.click();
      if (dismissal === "clear") {
        app.doc.getSelection()!.removeAllRanges();
        app.doc.dispatchEvent(new app.win.Event("selectionchange"));
      } else if (dismissal === "outside") {
        app.outside.dispatchEvent(
          new app.win.PointerEvent("pointerdown", { bubbles: true }),
        );
      } else {
        app.action.dispatchEvent(
          new app.win.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      assert.equal(app.controller.isOpen(), false);
      job.resolve({ status: "translated", text: "Late response" });
      await flush();
      assert.equal(app.controller.isOpen(), false);
      assert.doesNotMatch(app.panel.textContent, /Late response/);
    });
  }
});

test("unavailable and failed translations expose an explicit retry action", async (t) => {
  const results: ReadingTranslationResult[] = [
    { status: "failed" },
    { status: "unavailable" },
    { status: "translated", text: "Recovered" },
  ];
  const app = setup(t, async () => results.shift()!);
  app.select();
  for (const expected of ["Failed", "Unavailable", "Recovered"]) {
    app.action.click();
    await flush();
    assert.equal(app.result.textContent, expected);
    assert.equal(app.action.disabled, false);
    assert.equal(
      app.action.getAttribute("aria-label"),
      expected === "Recovered" ? "Translate" : "Retry",
    );
  }
});

test("scroll and resize reposition only a valid current article selection", (t) => {
  const app = setup(t, async () => ({ status: "unavailable" }));
  app.select();
  const original = app.panel.style.top;
  app.moveGeometry({
    left: 100,
    top: 220,
    right: 210,
    bottom: 240,
    width: 110,
    height: 20,
  });
  app.root.dispatchEvent(new app.win.Event("scroll", { bubbles: true }));
  assert.notEqual(app.panel.style.top, original);
  const moved = app.panel.style.top;
  app.moveGeometry({
    left: 120,
    top: 250,
    right: 230,
    bottom: 270,
    width: 110,
    height: 20,
  });
  app.win.dispatchEvent(new app.win.Event("resize"));
  assert.notEqual(app.panel.style.top, moved);
  app.root.querySelector("article")!.replaceChildren();
  app.win.dispatchEvent(new app.win.Event("resize"));
  assert.equal(app.controller.isOpen(), false);
});

test("foreign document selections, hidden surfaces and disposal cannot resurrect the popup", async (t) => {
  const job = deferred<ReadingTranslationResult>();
  const app = setup(t, () => job.promise);
  app.select();
  app.action.click();
  app.controller.hide();
  const foreign = new Window();
  t.after(() => foreign.happyDOM.close());
  const event = new app.win.Event("selectionchange");
  Object.defineProperty(event, "target", { value: foreign.document });
  app.doc.dispatchEvent(event);
  assert.equal(app.controller.isOpen(), false);
  app.deactivate();
  app.select(app.paragraphs[1]);
  assert.equal(app.controller.isOpen(), false);
  app.controller.dispose();
  job.resolve({ status: "translated", text: "Disposed response" });
  await flush();
  assert.equal(app.panel.isConnected, false);
  const shows = app.shows();
  app.select(app.paragraphs[2]);
  app.win.dispatchEvent(new app.win.Event("resize"));
  app.action.click();
  assert.equal(app.shows(), shows);
  assert.equal(app.panel.isConnected, false);
});
