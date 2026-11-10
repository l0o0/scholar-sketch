import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { mountReadingSelectionPopup } from "../src/modules/markdown/reading-selection-popup.ts";
import type { ReadingTranslationResult } from "../src/modules/markdown/reading-translation.ts";

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
  translate: (text: string) => Promise<ReadingTranslationResult>,
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
  let shows = 0;
  const controller = mountReadingSelectionPopup({
    root: root as unknown as HTMLElement,
    isActive: () => active,
    translate,
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
    select,
    deactivate: () => {
      active = false;
    },
    moveGeometry: (value: typeof geometry) => {
      geometry = value;
    },
    shows: () => shows,
  };
}

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
  assert.equal(app.action.textContent, "Translate");
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
      app.action.textContent,
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
