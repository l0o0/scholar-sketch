import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import { createMarkdownEditor } from "../src/modules/markdown/editor.ts";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  type LinkHoverTarget,
} from "../src/modules/markdown/editor-protocol.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("link hover crosses the real editor bridge without changing editor state", async (t) => {
  const globals = globalThis as any;
  const previous = new Map(
    Object.getOwnPropertyNames(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key)!,
    ]),
  );
  const fake = createFakeZotero();
  const restoreZotero = fake.install(globals);
  globals.ztoolkit = { log() {} };
  const browser = new Window({ url: "https://host.example/" });
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const received: (LinkHoverTarget | null)[] = [];
  const source = "[[Target--ABCDEFGH]]";
  const editor = createMarkdownEditor(container, {
    win: browser as unknown as Window,
    channel: "hover-editor",
    doc: source,
    pageURL: "https://host.example/editor.html",
    onLinkHover: (target) => received.push(target),
  });
  const iframe = container.querySelector("iframe")!;
  const frame = iframe.contentWindow!;
  frame.document.body.innerHTML = '<div id="editor-root"></div>';
  (frame as any).postMessage = (data: unknown) =>
    queueMicrotask(() =>
      frame.dispatchEvent(
        new frame.MessageEvent("message", { data, source: browser }),
      ),
    );
  (browser as any).postMessage = (data: unknown) =>
    queueMicrotask(() =>
      browser.dispatchEvent(
        new browser.MessageEvent("message", { data, source: frame }),
      ),
    );
  const destroyFrame = () =>
    frame.dispatchEvent(
      new frame.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "hover-editor",
          type: "destroy",
        },
      }),
    );
  t.after(async () => {
    destroyFrame();
    editor.destroy();
    await tick();
    await browser.happyDOM.close();
    restoreZotero();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  ensureDOMGlobals(frame as unknown as Window);
  globals.Window = frame.Window;
  await import("../src/editor/bootstrap.ts");
  frame.document.dispatchEvent(new frame.Event("DOMContentLoaded"));
  await editor.ready;
  await tick();
  const view = EditorView.findFromDOM(
    frame.document.querySelector(".cm-editor") as HTMLElement,
  )!;
  assert.ok(view);
  const rect = { left: 10, top: 20, right: 80, bottom: 44 };
  Object.defineProperty(iframe, "getBoundingClientRect", {
    value: () => ({ left: 200, top: 100 }),
  });
  // Happy DOM has no layout. These are the browser geometry boundaries; the
  // production parser, ViewPlugin, protocol and both bridge handlers are real.
  t.mock.method(view, "posAtCoords", () => 2);
  t.mock.method(view, "coordsAtPos", () => rect as DOMRect);
  const timers = new Map<number, () => void>();
  let nextTimer = 1_000_000;
  const originalTimeout = frame.setTimeout.bind(frame);
  const originalClear = frame.clearTimeout.bind(frame);
  t.mock.method(
    frame,
    "setTimeout",
    (callback: any, delay?: number, ...args) => {
      if (delay !== 300) return originalTimeout(callback, delay, ...args);
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
  );
  t.mock.method(frame, "clearTimeout", (id: number) => {
    if (!timers.delete(id)) originalClear(id);
  });
  const hover = (element: Element) => {
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => rect,
    });
    element.dispatchEvent(
      new frame.MouseEvent("mousemove", {
        bubbles: true,
        clientX: 15,
        clientY: 25,
      }),
    );
  };
  const settleHover = async () => {
    assert.equal(timers.size, 1);
    const [id, callback] = [...timers][0];
    timers.delete(id);
    callback();
    await tick();
  };
  const leave = async () => {
    view.dom.dispatchEvent(new frame.MouseEvent("mouseleave"));
    await tick();
  };
  const measured = () =>
    new Promise<void>((resolve) => {
      view.requestMeasure({ read() {}, write: () => resolve() });
    });

  for (const mode of ["live", "source"] as const) {
    await t.test(
      `${mode}: waits for dwell, deduplicates and clears on leave`,
      async () => {
        editor.setMode(mode);
        await tick();
        const element =
          frame.document.querySelector("[data-zmd-link]") ||
          frame.document.querySelector(".cm-line")!;
        const count = received.length;
        const selection = view.state.selection;
        hover(element);
        assert.equal(received.length, count);
        await settleHover();
        assert.deepEqual(received.at(-1), {
          href: source,
          rect: { left: 210, top: 120, right: 280, bottom: 144 },
        });
        hover(element);
        await tick();
        assert.equal(received.length, count + 1);
        assert.equal(timers.size, 0);
        assert.equal(editor.getValue(), source);
        assert.equal(view.state.selection, selection);
        await leave();
        assert.equal(received.at(-1), null);
        hover(element);
        view.contentDOM.dispatchEvent(
          new frame.KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
          }),
        );
        assert.equal(
          timers.size,
          0,
          "keyboard navigation cancels pending hover",
        );
        hover(element);
        await settleHover();
        const escape = new frame.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        view.contentDOM.dispatchEvent(escape);
        await tick();
        assert.equal(
          received.at(-1),
          null,
          "iframe Escape dismisses the host card",
        );
        assert.equal(escape.defaultPrevented, false);
      },
    );
  }

  await t.test(
    "editing cancels pending work and invalidates an open hover",
    async () => {
      const line = () => frame.document.querySelector(".cm-line")!;
      hover(line());
      view.dispatch({ changes: { from: 0, insert: "x" } });
      assert.equal(timers.size, 0);
      editor.setValue(source);
      await tick();
      hover(line());
      await settleHover();
      assert.ok(received.at(-1));
      view.dispatch({ changes: { from: 0, insert: "x" } });
      await tick();
      assert.equal(received.at(-1), null);
    },
  );

  await t.test(
    "HTML table widget links publish through their owned DOM",
    async () => {
      editor.setValue(`<table><tr><td>${source}</td></tr></table>\n\nEnd`);
      editor.setMode("live");
      await tick();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      await measured();
      const link = frame.document.querySelector(
        ".zmd-lp-html-table [data-zmd-wikilink]",
      );
      assert.ok(link);
      hover(link);
      await settleHover();
      assert.equal(received.at(-1)?.href, source);
      view.scrollDOM.dispatchEvent(new frame.Event("scroll"));
      await tick();
      assert.equal(received.at(-1), null);
    },
  );

  await t.test(
    "GFM cells distinguish two links and resolve titles from their current source",
    async () => {
      const first = "[[First--AAAA1111]]";
      const second =
        '[Second](zotero://select/library/items/BBBB2222 "A title")';
      for (const formatted of [false, true]) {
        editor.setValue(
          `| Ref |\n| --- |\n| ${first} ${formatted ? `<sup>${second}</sup>` : second} |\n\nEnd`,
        );
        await tick();
        view.dispatch({ selection: { anchor: view.state.doc.length } });
        await measured();
        const links = frame.document.querySelectorAll(
          ".zmd-lp-table-cell [data-zmd-link]",
        );
        assert.equal(links.length, 2);
        for (const [index, expected] of [
          first,
          "zotero://select/library/items/BBBB2222",
        ].entries()) {
          hover(links[index]);
          await settleHover();
          assert.equal(received.at(-1)?.href, expected);
          await leave();
        }
      }
    },
  );

  await t.test(
    "destroy clears the host card and releases pending timers",
    async () => {
      const link = frame.document.querySelector(
        ".zmd-lp-table-cell [data-zmd-link]",
      )!;
      hover(link);
      destroyFrame();
      editor.destroy();
      await tick();
      assert.equal(received.at(-1), null);
      assert.equal(timers.size, 0);
      const count = received.length;
      browser.dispatchEvent(
        new browser.MessageEvent("message", {
          source: frame,
          data: {
            source: EDITOR_MESSAGE_SOURCE,
            channel: "hover-editor",
            type: "linkHover",
            payload: { href: source, rect },
          },
        }),
      );
      assert.equal(received.length, count);
    },
  );
});
