import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import { EDITOR_MESSAGE_SOURCE } from "../src/modules/markdown/editor-protocol.ts";

// CodeMirror selects its platform at module load, before the test DOM is installed.
const macKeymap = /Mac/.test(globalThis.navigator?.platform ?? "");

test("the real editor keeps host tab keys free and applies its documented formatting keys", async (t) => {
  const browser = new Window({
    url: "https://editor.test/?channel=shortcut-test",
  });
  const globals = globalThis as any;
  const previous = new Map(
    Object.getOwnPropertyNames(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key)!,
    ]),
  );
  globals.ztoolkit = { log() {} };
  ensureDOMGlobals(browser as any);
  globals.Window = browser.Window;
  browser.document.body.innerHTML = '<div id="editor-root"></div>';
  const messages: { type: string; payload?: any }[] = [];
  browser.postMessage = (message: any) => messages.push(message);
  const send = (type: string, payload?: unknown) =>
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "shortcut-test",
          type,
          payload,
        },
      }),
    );
  t.after(async () => {
    send("destroy");
    await browser.happyDOM.close();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  await import("../src/editor/bootstrap.ts");
  browser.document.dispatchEvent(new browser.Event("DOMContentLoaded"));
  const init = (doc: string, readOnly = false) => {
    send("init", {
      doc,
      readOnly,
      fontSize: 14,
      theme: "light",
      mode: "source",
    });
    const view = EditorView.findFromDOM(
      browser.document.querySelector(".cm-editor") as unknown as HTMLElement,
    )!;
    assert.ok(view);
    view.focus();
    messages.length = 0;
    return view;
  };
  const keydown = (view: EditorView, key: string, altKey = false) => {
    const event = new browser.KeyboardEvent("keydown", {
      key,
      code: /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`,
      ctrlKey: !macKeymap,
      metaKey: macKeymap,
      altKey,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    return event;
  };

  await t.test("Ctrl+1…9 are not consumed or turned into headings", () => {
    const view = init("A note");
    for (let digit = 1; digit <= 9; digit++) {
      assert.equal(keydown(view, String(digit)).defaultPrevented, false);
      assert.equal(view.state.doc.toString(), "A note");
    }
  });

  await t.test("Ctrl+Alt+1/2/3 set and replace headings", () => {
    const view = init("A note");
    for (let level = 1; level <= 3; level++) {
      assert.equal(keydown(view, String(level), true).defaultPrevented, true);
      assert.equal(view.state.doc.toString(), `${"#".repeat(level)} A note`);
    }
  });

  await t.test(
    "macOS Option-generated characters still match their physical heading digits",
    { skip: !macKeymap },
    () => {
      const view = init("A note");
      for (const [index, key] of ["¡", "™", "£"].entries()) {
        const level = index + 1;
        const event = new browser.KeyboardEvent("keydown", {
          key,
          code: `Digit${level}`,
          keyCode: 48 + level,
          metaKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        });
        view.contentDOM.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
        assert.equal(view.state.doc.toString(), `${"#".repeat(level)} A note`);
      }
    },
  );

  await t.test(
    "italic wins over the built-in select-parent-syntax binding",
    () => {
      const view = init("A note");
      view.dispatch({ selection: { anchor: 0, head: 6 } });
      assert.equal(keydown(view, "i").defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "*A note*");
    },
  );

  await t.test("bold, links and save remain available", () => {
    let view = init("A note");
    view.dispatch({ selection: { anchor: 0, head: 6 } });
    assert.equal(keydown(view, "b").defaultPrevented, true);
    assert.equal(view.state.doc.toString(), "**A note**");
    view = init("A note");
    view.dispatch({ selection: { anchor: 0, head: 6 } });
    assert.equal(keydown(view, "k").defaultPrevented, true);
    assert.equal(view.state.doc.toString(), "[A note](url)");
    assert.equal(keydown(view, "s").defaultPrevented, true);
    assert.ok(messages.some((message) => message.type === "save"));
  });

  await t.test(
    "formatting shortcuts leave a read-only document untouched",
    () => {
      const view = init("A note", true);
      view.dispatch({ selection: { anchor: 0, head: 6 } });
      for (const key of ["b", "i", "k"]) keydown(view, key);
      for (const digit of ["1", "2", "3"]) keydown(view, digit, true);
      assert.equal(view.state.doc.toString(), "A note");
    },
  );

  await t.test(
    "the advertised platform redo shortcut restores an undone edit",
    () => {
      const view = init("A note");
      view.dispatch({ selection: { anchor: 0, head: 6 } });
      keydown(view, "b");
      assert.equal(view.state.doc.toString(), "**A note**");
      assert.equal(keydown(view, "z").defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "A note");
      const redo = new browser.KeyboardEvent("keydown", {
        key: macKeymap ? "z" : "y",
        code: macKeymap ? "KeyZ" : "KeyY",
        metaKey: macKeymap,
        ctrlKey: !macKeymap,
        shiftKey: macKeymap,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(redo);
      assert.equal(redo.defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "**A note**");
    },
  );
});
