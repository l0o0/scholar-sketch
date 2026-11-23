import assert from "node:assert/strict";
import test from "node:test";
import MarkdownIt from "markdown-it";
import { defaultMarkdownCommandShortcuts } from "../src/modules/markdown/markdown-command-shortcuts.ts";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { SearchQuery, setSearchQuery } from "@codemirror/search";
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
  const init = (doc: string, readOnly = false, mode = "source") => {
    send("init", {
      doc,
      readOnly,
      fontSize: 14,
      theme: "light",
      mode,
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

  await t.test(
    "annotation and table bindings stay free when their host has no picker",
    () => {
      const view = init("A note");
      assert.equal(keydown(view, "a", true).defaultPrevented, false);
      const table = new browser.KeyboardEvent("keydown", {
        key: "T",
        code: "KeyT",
        keyCode: 84,
        ctrlKey: !macKeymap,
        metaKey: macKeymap,
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(table);
      assert.equal(table.defaultPrevented, false);
      assert.equal(
        messages.some(
          (message) =>
            message.type === "insertAnnotations" ||
            message.type === "insertTable",
        ),
        false,
      );
      assert.equal(view.state.doc.toString(), "A note");
    },
  );

  await t.test(
    "task and inline-code insertion use the existing formatting transactions",
    () => {
      let view = init("A note");
      assert.equal(keydown(view, "x", true).defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "- [ ] A note");
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), "A note");
      view = init("A note");
      view.dispatch({ selection: { anchor: 2, head: 6 } });
      assert.equal(keydown(view, "c", true).defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "A `note`");
      assert.equal(keydown(view, "c", true).defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "A note");
      for (const readOnly of [false, true]) {
        view = init("Keep this", readOnly);
        for (const key of ["x", "c"]) {
          const event = new browser.KeyboardEvent("keydown", {
            key,
            code: `Key${key.toUpperCase()}`,
            ctrlKey: !macKeymap,
            metaKey: macKeymap,
            altKey: true,
            repeat: !readOnly,
            bubbles: true,
            cancelable: true,
          });
          view.contentDOM.dispatchEvent(event);
          assert.equal(event.defaultPrevented, false);
          assert.equal(view.state.doc.toString(), "Keep this");
        }
      }
    },
  );

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
    "inline commands toggle content and whole syntax selections",
    () => {
      for (const marker of ["**", "*", "`"]) {
        const view = init("text");
        view.dispatch({ selection: { anchor: 4, head: 0 } });
        send("wrapSelection", { before: marker });
        assert.equal(view.state.doc.toString(), `${marker}text${marker}`);
        assert.equal(
          view.state.sliceDoc(
            view.state.selection.main.from,
            view.state.selection.main.to,
          ),
          "text",
        );
        send("wrapSelection", { before: marker });
        assert.equal(view.state.doc.toString(), "text");
        assert.deepEqual(
          [view.state.selection.main.anchor, view.state.selection.main.head],
          [4, 0],
        );
        send("wrapSelection", { before: marker });
        view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length },
        });
        send("wrapSelection", { before: marker });
        assert.equal(view.state.doc.toString(), "text");
      }
    },
  );

  await t.test(
    "inline toggles preserve other nested formatting and literal delimiters",
    () => {
      for (const [doc, marker, expected] of [
        ["***both***", "**", "*both*"],
        ["***both***", "*", "**both**"],
        ["**bold *italic* end**", "**", "bold *italic* end"],
        ["__bold__", "**", "bold"],
        ["``a ` b``", "`", "a ` b"],
      ]) {
        const view = init(doc);
        view.dispatch({ selection: { anchor: 0, head: doc.length } });
        send("wrapSelection", { before: marker });
        assert.equal(view.state.doc.toString(), expected);
      }
      const view = init("a ` b");
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      send("wrapSelection", { before: "`" });
      assert.equal(view.state.doc.toString(), "``a ` b``");
      send("wrapSelection", { before: "`" });
      assert.equal(view.state.doc.toString(), "a ` b");
    },
  );

  await t.test(
    "multiline inline formatting preserves blank lines and block prefixes",
    () => {
      const doc = "# Heading\n\n- first\n  - second";
      const view = init(doc);
      view.dispatch({ selection: { anchor: 0, head: doc.length } });
      send("wrapSelection", { before: "**" });
      assert.equal(
        view.state.doc.toString(),
        "# **Heading**\n\n- **first**\n  - **second**",
      );
      send("wrapSelection", { before: "**" });
      assert.equal(view.state.doc.toString(), doc);
    },
  );

  await t.test(
    "line commands replace selected prefixes and leave the trailing boundary line alone",
    () => {
      const view = init("# one\n- [x] two\n  3. three\nuntouched");
      const boundary = view.state.doc.line(4).from;
      view.dispatch({ selection: { anchor: boundary, head: 0 } });
      send("prefixLine", { prefix: "- " });
      assert.equal(
        view.state.doc.toString(),
        "- one\n- two\n  - three\nuntouched",
      );
      assert.deepEqual(
        [view.state.selection.main.anchor, view.state.selection.main.head],
        [view.state.doc.line(4).from, 0],
      );
      send("prefixLine", { prefix: "- " });
      assert.equal(view.state.doc.toString(), "one\ntwo\n  three\nuntouched");
      send("command", { command: "undo" });
      assert.equal(
        view.state.doc.toString(),
        "- one\n- two\n  - three\nuntouched",
      );
      send("command", { command: "redo" });
      assert.equal(view.state.doc.toString(), "one\ntwo\n  three\nuntouched");
    },
  );

  await t.test(
    "task and heading commands convert every selected line without losing quote nesting",
    () => {
      const view = init("> # one\n> - two\n>   - [x] three");
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      send("prefixLine", { prefix: "- [ ] " });
      assert.equal(
        view.state.doc.toString(),
        "> - [ ] one\n> - [ ] two\n>   - [x] three",
      );
      keydown(view, "2", true);
      assert.equal(
        view.state.doc.toString(),
        "> ## one\n> ## two\n>   ## three",
      );
      send("prefixLine", { prefix: "## " });
      assert.equal(view.state.doc.toString(), "> one\n> two\n>   three");
    },
  );

  await t.test(
    "links select the URL placeholder for immediate replacement and undo restores the text",
    () => {
      const view = init("A note");
      view.dispatch({ selection: { anchor: 0, head: 6 } });
      keydown(view, "k");
      assert.equal(view.state.doc.toString(), "[A note](url)");
      assert.equal(
        view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        ),
        "url",
      );
      view.dispatch(view.state.replaceSelection("https://example.test/"));
      assert.equal(
        view.state.doc.toString(),
        "[A note](https://example.test/)",
      );
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), "[A note](url)");
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), "A note");
    },
  );

  await t.test(
    "parent formatting messages cannot change a read-only document",
    () => {
      const view = init("A note", true);
      view.dispatch({ selection: { anchor: 0, head: 6 } });
      send("wrapSelection", { before: "**" });
      send("prefixLine", { prefix: "- " });
      send("wrapSelection", { before: "[", after: "](url)" });
      assert.equal(view.state.doc.toString(), "A note");
    },
  );

  await t.test(
    "empty inline commands can be cancelled and mixed inline formatting is not nested twice",
    () => {
      for (const marker of ["**", "*", "`"]) {
        const view = init("");
        send("wrapSelection", { before: marker });
        assert.equal(view.state.doc.toString(), marker + marker);
        assert.equal(view.state.selection.main.head, marker.length);
        send("wrapSelection", { before: marker });
        assert.equal(view.state.doc.toString(), "");
        assert.equal(view.state.selection.main.head, 0);
      }
      const view = init("**bold** and *italic*");
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      keydown(view, "b");
      assert.equal(view.state.doc.toString(), "**bold and *italic***");
      keydown(view, "b");
      assert.equal(view.state.doc.toString(), "bold and *italic*");
    },
  );

  await t.test(
    "formatting leaves literal code blocks and partial code spans untouched",
    () => {
      const view = init("`a * b`\n\n```\n# code\n```");
      const doc = view.state.doc.toString();
      view.dispatch({ selection: { anchor: 2, head: 5 } });
      keydown(view, "b");
      assert.equal(view.state.doc.toString(), doc);
      view.dispatch({ selection: { anchor: doc.indexOf("# code") + 1 } });
      keydown(view, "i");
      send("prefixLine", { prefix: "- " });
      assert.equal(view.state.doc.toString(), doc);
      view.dispatch({ selection: { anchor: 0, head: 7 } });
      keydown(view, "b");
      assert.equal(
        view.state.doc.toString(),
        "**`a * b`**\n\n```\n# code\n```",
      );
    },
  );

  await t.test(
    "a caret inside formatting cancels its enclosing marks without losing nested content",
    () => {
      const view = init("**bold *italic* text**");
      const caret = view.state.doc.toString().indexOf("italic") + 2;
      view.dispatch({ selection: { anchor: caret } });
      keydown(view, "b");
      assert.equal(view.state.doc.toString(), "bold *italic* text");
      assert.equal(view.state.selection.main.head, caret - 2);
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), "**bold *italic* text**");
      assert.equal(view.state.selection.main.head, caret);
    },
  );

  await t.test(
    "formatting protects fenced and indented code inside quote and list containers",
    () => {
      const docs = [
        "> ```\n> # literal\n> ```",
        ">     # literal\n>     code",
        "- item\n  ```\n  # literal\n  ```",
        "- item\n    - nested\n      ```\n      # literal\n      ```",
      ];
      for (const doc of docs) {
        const start = doc.startsWith(">")
          ? 0
          : doc.indexOf(
              "\n",
              doc.indexOf("nested") >= 0 ? doc.indexOf("nested") : 0,
            ) + 1;
        const view = init(doc);
        view.dispatch({ selection: { anchor: start, head: doc.length } });
        for (const marker of ["**", "*", "`"]) {
          send("wrapSelection", { before: marker });
          assert.equal(view.state.doc.toString(), doc, `${marker}: ${doc}`);
        }
        for (const prefix of ["- ", "- [ ] ", "## "]) {
          send("prefixLine", { prefix });
          assert.equal(view.state.doc.toString(), doc, `${prefix}: ${doc}`);
        }
        view.dispatch({ selection: { anchor: start } });
        send("wrapSelection", { before: "**" });
        assert.equal(
          view.state.doc.toString(),
          doc,
          "a caret before the container mark must not corrupt the code fence",
        );
      }
      const doc = "before\n\n> ```\n> # literal\n> ```\n\nafter";
      const view = init(doc);
      view.dispatch({ selection: { anchor: 0, head: doc.length } });
      send("wrapSelection", { before: "**" });
      assert.equal(
        view.state.doc.toString(),
        "**before**\n\n> ```\n> # literal\n> ```\n\n**after**",
      );
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), doc);
    },
  );

  await t.test(
    "nonempty partial toggles preserve the unselected text's formatting",
    () => {
      for (const marker of ["**", "*", "`"]) {
        const doc = `${marker}alpha beta${marker}`;
        const view = init(doc);
        const start = doc.indexOf("beta");
        view.dispatch({ selection: { anchor: start + 4, head: start } });
        send("wrapSelection", { before: marker });
        assert.equal(view.state.doc.toString(), `${marker}alpha${marker} beta`);
        assert.equal(
          view.state.sliceDoc(
            view.state.selection.main.from,
            view.state.selection.main.to,
          ),
          "beta",
        );
        assert.ok(
          view.state.selection.main.anchor > view.state.selection.main.head,
        );
        send("command", { command: "undo" });
        assert.equal(view.state.doc.toString(), doc);
      }
    },
  );

  await t.test(
    "formatting merges a partially overlapping existing span without unmatched delimiters",
    () => {
      const view = init("before **bold** after");
      view.dispatch({ selection: { anchor: 4, head: 11 } });
      send("wrapSelection", { before: "**" });
      assert.equal(view.state.doc.toString(), "befo**re bold** after");
      assert.equal(
        view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        ),
        "re bo",
      );
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), "before **bold** after");
    },
  );

  await t.test(
    "inline formatting leaves only actual closing ATX heading marks outside",
    () => {
      for (const [doc, expected] of [
        ["## heading ##", "## **heading** ##"],
        ["> ## heading ##", "> ## **heading** ##"],
        ["## heading###", "## **heading###**"],
        ["text # literal #", "**text # literal #**"],
      ]) {
        const view = init(doc);
        view.dispatch({ selection: { anchor: 0, head: doc.length } });
        send("wrapSelection", { before: "**" });
        assert.equal(view.state.doc.toString(), expected);
        send("wrapSelection", { before: "**" });
        assert.equal(view.state.doc.toString(), doc);
      }
    },
  );

  await t.test(
    "partial removal keeps nested styles in both editing and exported Markdown",
    () => {
      const renderer = new MarkdownIt();
      for (const [doc, selected, marker, expectedHtml] of [
        [
          "**alpha *beta gamma* delta**",
          "beta",
          "**",
          "<strong>alpha</strong> <em>beta</em> <strong><em>gamma</em> delta</strong>",
        ],
        [
          "**alpha *beta gamma* delta**",
          "gamma",
          "**",
          "<strong>alpha <em>beta</em></strong> <em>gamma</em> <strong>delta</strong>",
        ],
        [
          "**bold *italic* text**",
          "ali",
          "**",
          "<strong>bold <em>it</em></strong><em>ali</em><strong><em>c</em> text</strong>",
        ],
        ["``a ` b``", "b", "`", "<code>a `</code> b"],
      ]) {
        const view = init(doc);
        const from = doc.indexOf(selected);
        view.dispatch({
          selection: { anchor: from, head: from + selected.length },
        });
        send("wrapSelection", { before: marker });
        assert.equal(
          renderer.renderInline(view.state.doc.toString()),
          expectedHtml,
        );
        send("command", { command: "undo" });
        assert.equal(view.state.doc.toString(), doc);
      }
      const doc = "**alpha `code` beta**";
      const view = init(doc);
      const from = doc.indexOf("od");
      view.dispatch({ selection: { anchor: from, head: from + 2 } });
      send("wrapSelection", { before: "**" });
      assert.equal(
        view.state.doc.toString(),
        doc,
        "formatting cannot inject literal markers into part of a code span",
      );
    },
  );

  await t.test(
    "multiline partial removal preserves unselected ends of different styled spans",
    () => {
      const doc = "**alpha\nbeta**\n\n**gamma delta**";
      const view = init(doc);
      view.dispatch({
        selection: {
          anchor: doc.indexOf("beta"),
          head: doc.indexOf("gamma") + 5,
        },
      });
      send("wrapSelection", { before: "**" });
      assert.equal(
        view.state.doc.toString(),
        "**alpha**\nbeta\n\ngamma **delta**",
      );
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), doc);
    },
  );

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

  const press = (
    target: Element,
    key: string,
    options: Record<string, unknown> = {},
  ) => {
    const event = new browser.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    target.dispatchEvent(event);
    return event;
  };
  const primary = { ctrlKey: !macKeymap, metaKey: macKeymap };
  const defaults = () =>
    defaultMarkdownCommandShortcuts(macKeymap ? "MacIntel" : "Win32");

  await t.test(
    "custom command bindings replace defaults immediately and preserve the live history",
    () => {
      const view = init("A note");
      view.dispatch({
        changes: { from: 6, insert: "!" },
        selection: { anchor: 0, head: 6 },
      });
      send("setCommandShortcuts", {
        ...defaults(),
        bold: "accel,alt,J",
        save: "accel,alt,S",
        italic: "",
        h1: "accel,alt,H",
      });
      assert.equal(view.state.doc.toString(), "A note!");
      assert.deepEqual(
        [view.state.selection.main.from, view.state.selection.main.to],
        [0, 6],
      );
      assert.equal(keydown(view, "b").defaultPrevented, false);
      assert.equal(keydown(view, "i").defaultPrevented, false);
      keydown(view, "s");
      assert.equal(
        messages.some((message) => message.type === "save"),
        false,
      );
      assert.equal(keydown(view, "j", true).defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "**A note**!");
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), "A note!");
      assert.equal(keydown(view, "s", true).defaultPrevented, true);
      assert.ok(messages.some((message) => message.type === "save"));
      assert.equal(keydown(view, "1", true).defaultPrevented, false);
      assert.equal(keydown(view, "h", true).defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "# A note!");
    },
  );

  await t.test(
    "cleared commands release their former CodeMirror defaults and aliases",
    () => {
      const view = init("match match");
      view.dispatch({ changes: { from: 11, insert: "!" } });
      send(
        "setCommandShortcuts",
        Object.fromEntries(
          Object.keys(defaults()).map((action) => [action, ""]),
        ),
      );
      const before = view.state.doc.toString();
      for (const key of ["s", "f", "g", "z", "y", "i", "]", "["])
        keydown(view, key);
      press(view.contentDOM, "F3");
      press(view.contentDOM, "F3", { shiftKey: true });
      press(view.contentDOM, "Z", { ...primary, shiftKey: true });
      press(view.contentDOM, "Tab");
      assert.equal(view.state.doc.toString(), before);
      assert.equal(view.dom.querySelector(".cm-search"), null);
    },
  );

  await t.test(
    "search aliases follow their command and custom navigation uses the search query",
    () => {
      const view = init("hit one hit two hit");
      send("command", { command: "find" });
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: "hit" })),
        selection: { anchor: 0, head: 3 },
      });
      assert.equal(press(view.contentDOM, "F3").defaultPrevented, true);
      assert.deepEqual(
        [view.state.selection.main.from, view.state.selection.main.to],
        [8, 11],
      );
      send("setCommandShortcuts", {
        ...defaults(),
        findNext: "accel,alt,N",
        findPrevious: "accel,alt,P",
      });
      assert.equal(press(view.contentDOM, "F3").defaultPrevented, false);
      assert.equal(keydown(view, "g").defaultPrevented, false);
      assert.deepEqual(
        [view.state.selection.main.from, view.state.selection.main.to],
        [8, 11],
      );
      assert.equal(keydown(view, "n", true).defaultPrevented, true);
      assert.deepEqual(
        [view.state.selection.main.from, view.state.selection.main.to],
        [16, 19],
      );
      assert.equal(keydown(view, "p", true).defaultPrevented, true);
      assert.deepEqual(
        [view.state.selection.main.from, view.state.selection.main.to],
        [8, 11],
      );
    },
  );

  await t.test(
    "search and replace inputs keep formatting and undo within their own selection",
    () => {
      const view = init("Before paragraph");
      view.dispatch({
        changes: { from: 16, insert: "!" },
        selection: { anchor: 0 },
      });
      send("command", { command: "find" });
      const expected = view.state.doc.toString();
      for (const name of ["search", "replace"]) {
        const input = view.dom.querySelector<HTMLInputElement>(
          `.cm-search input[name="${name}"]`,
        )!;
        assert.ok(input);
        input.focus();
        press(input, "b", primary);
        assert.equal(view.state.doc.toString(), expected);
        assert.equal(browser.document.activeElement, input);
        send("setCommandShortcuts", {
          ...defaults(),
          bold: "accel,alt,B",
          h1: "accel,alt,H",
        });
        for (const key of ["b", "h"]) {
          press(input, key, { ...primary, altKey: true });
          assert.equal(view.state.doc.toString(), expected);
          assert.equal(browser.document.activeElement, input);
        }
        press(input, "z", primary);
        assert.equal(view.state.doc.toString(), expected);
        assert.equal(browser.document.activeElement, input);
        send("setCommandShortcuts", defaults());
      }
      send("command", { command: "undo" });
      assert.equal(view.state.doc.toString(), "Before paragraph");
    },
  );

  await t.test(
    "table and indentation bindings use their own context, including live cell editing",
    () => {
      let view = init("plain");
      assert.equal(press(view.contentDOM, "Tab").defaultPrevented, true);
      assert.equal(view.state.doc.toString(), "  plain");
      const doc = "| One | Two |\n| --- | --- |\n| a | b |";
      view = init(doc);
      view.dispatch({ selection: { anchor: 2 } });
      assert.equal(press(view.contentDOM, "Tab").defaultPrevented, true);
      assert.equal(view.state.selection.main.from, 8);
      send("setCommandShortcuts", {
        ...defaults(),
        tableNext: "accel,alt,N",
        tablePrevious: "",
      });
      const anchor = view.state.selection.main.anchor;
      assert.equal(press(view.contentDOM, "Tab").defaultPrevented, false);
      assert.equal(view.state.selection.main.anchor, anchor);
      assert.equal(keydown(view, "n", true).defaultPrevented, true);
      assert.ok(view.state.selection.main.anchor > anchor);
      view = init(`Before paragraph\n\n${doc}`, false, "live");
      view.dispatch({ selection: { anchor: 0 } });
      const cell = view.dom.querySelector(".zmd-lp-table-cell")!;
      assert.ok(cell);
      cell.dispatchEvent(
        new browser.MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
        }),
      );
      let editing = view.dom.querySelector(".zmd-lp-table-cell-editing")!;
      assert.ok(editing);
      const beforeFormatting = view.state.doc.toString();
      press(editing, "b", primary);
      assert.equal(view.state.doc.toString(), beforeFormatting);
      assert.ok(view.state.doc.toString().startsWith("Before paragraph\n\n"));
      send("setCommandShortcuts", { ...defaults(), bold: "accel,alt,B" });
      press(editing, "b", { ...primary, altKey: true });
      assert.equal(view.state.doc.toString(), beforeFormatting);
      assert.equal(press(editing, "Tab").defaultPrevented, true);
      assert.equal(
        view.dom.querySelector(".zmd-lp-table-cell-editing")!.textContent,
        "Two",
      );
      send("setCommandShortcuts", {
        ...defaults(),
        tableNext: "accel,alt,N",
        tablePrevious: "",
      });
      editing = view.dom.querySelector(".zmd-lp-table-cell-editing")!;
      assert.equal(press(editing, "Tab").defaultPrevented, false);
      assert.equal(
        view.dom.querySelector(".zmd-lp-table-cell-editing")!.textContent,
        "Two",
      );
      assert.equal(
        press(editing, "n", { ...primary, altKey: true }).defaultPrevented,
        true,
      );
      assert.equal(
        view.dom.querySelector(".zmd-lp-table-cell-editing")!.textContent,
        "a",
      );
    },
  );

  await t.test(
    "read-only editors retain custom save and search while disabling formatting",
    () => {
      const view = init("Keep this", true);
      send("setCommandShortcuts", {
        ...defaults(),
        save: "accel,alt,S",
        find: "accel,alt,F",
        bold: "accel,alt,B",
      });
      keydown(view, "b", true);
      assert.equal(view.state.doc.toString(), "Keep this");
      assert.equal(keydown(view, "s", true).defaultPrevented, true);
      assert.ok(messages.some((message) => message.type === "save"));
      assert.equal(keydown(view, "f", true).defaultPrevented, true);
      assert.ok(view.dom.querySelector(".cm-search"));
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
