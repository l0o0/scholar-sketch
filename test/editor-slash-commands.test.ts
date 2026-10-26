import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import { EDITOR_MESSAGE_SOURCE } from "../src/modules/markdown/editor-protocol.ts";
import { tableInsertTemplate } from "../src/modules/markdown/insert-template.ts";
import {
  normalizeSlashSearchLanguage,
  resolveSlashSearchLanguage,
} from "../src/modules/markdown/preferences.ts";

test("slash search defaults follow Zotero locale while explicit choices remain stable", () => {
  for (const locale of ["zh", "zh-CN", "zh-TW", "zh_Hant", "ZH-hk"]) {
    assert.equal(resolveSlashSearchLanguage("auto", locale), "pinyin");
    assert.equal(resolveSlashSearchLanguage(undefined, locale), "pinyin");
    assert.equal(resolveSlashSearchLanguage("english", locale), "english");
  }
  for (const locale of ["en-US", "de-DE", "ja-JP", "", "zhx"]) {
    assert.equal(resolveSlashSearchLanguage("auto", locale), "english");
    assert.equal(resolveSlashSearchLanguage("pinyin", locale), "pinyin");
  }
  for (const value of [undefined, null, "invalid", {}, 1])
    assert.equal(normalizeSlashSearchLanguage(value), "auto");
});

test("slash commands use the real iframe editing and host message paths", async (t) => {
  const browser = new Window({
    url: "https://editor.test/?channel=slash-test",
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
          channel: "slash-test",
          type,
          payload,
        },
      }),
    );
  await import("../src/editor/bootstrap.ts");
  browser.document.dispatchEvent(new browser.Event("DOMContentLoaded"));
  t.after(async () => {
    send("destroy");
    await browser.happyDOM.close();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  const init = (
    doc = "",
    readOnly = false,
    mode = "source",
    position = doc.length,
  ) => {
    send("init", {
      doc,
      readOnly,
      fontSize: 14,
      theme: "dark",
      mode,
      slashSearchLanguage: "pinyin",
      slashLabels: {
        title: "插入",
        reference: "引用文献或笔记",
        h1: "一级标题",
        image: "导入本地图片",
        empty: "没有匹配的命令",
      },
    });
    const view = EditorView.findFromDOM(
      browser.document.querySelector(".cm-editor") as unknown as HTMLElement,
    )!;
    view.focus();
    view.dispatch({ selection: { anchor: position } });
    messages.length = 0;
    return view;
  };
  const type = (view: EditorView, text: string) => {
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
    });
  };
  const key = (
    view: EditorView,
    key: string,
    extra: Record<string, unknown> = {},
  ) => {
    const event = new browser.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    view.contentDOM.dispatchEvent(event as unknown as KeyboardEvent);
    return event;
  };
  const popup = () => browser.document.querySelector(".zmd-slash-completion");
  const rows = () => [
    ...browser.document.querySelectorAll<HTMLButtonElement>(
      "[data-slash-command]",
    ),
  ];
  const choose = (id: string) => {
    const row = browser.document.querySelector<HTMLButtonElement>(
      `[data-slash-command="${id}"]`,
    );
    assert.ok(row, `the ${id} command is available`);
    row.dispatchEvent(
      new browser.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    row.click();
  };

  await t.test(
    "typing / exposes discoverable commands and preserves the native selection",
    () => {
      const view = init();
      type(view, "/");
      assert.ok(popup(), "typing / opens the command menu");
      assert.equal(rows().length, 16);
      assert.equal(rows()[0].dataset.slashCommand, "reference");
      assert.equal(rows()[0].textContent, "[[引用文献或笔记");
      assert.equal(view.state.doc.toString(), "/");
      assert.equal(view.state.selection.main.head, 1);
      assert.equal(view.hasFocus, true);
      assert.equal(view.contentDOM.getAttribute("aria-expanded"), "true");
    },
  );

  await t.test(
    "Chinese, English, pinyin and initials filter the same commands",
    () => {
      for (const query of [
        "文献",
        "reference",
        "wenxian",
        "wx",
        "yinyong wenxian",
      ]) {
        const view = init();
        if (query === "reference")
          send("setSlashSearchLanguage", { language: "english" });
        type(view, `/${query}`);
        assert.deepEqual(
          rows().map((row) => row.dataset.slashCommand),
          ["reference"],
        );
      }
      for (const query of ["图片", "image", "tupian", "tp"]) {
        const view = init();
        if (query === "image")
          send("setSlashSearchLanguage", { language: "english" });
        type(view, `/${query}`);
        assert.deepEqual(
          rows().map((row) => row.dataset.slashCommand),
          ["image"],
        );
      }
      const view = init();
      type(view, "/notacommand");
      assert.equal(rows().length, 0);
      assert.equal(
        popup()?.querySelector('[role="status"]')?.textContent,
        "没有匹配的命令",
      );
      key(view, "Enter");
      assert.equal(view.state.doc.toString(), "/notacommand\n");
      assert.equal(popup(), null);
    },
  );

  await t.test("arrows wrap and Enter inserts one undoable edit", () => {
    const view = init();
    type(view, "/");
    assert.equal(key(view, "ArrowUp").defaultPrevented, true);
    assert.equal(
      view.contentDOM.getAttribute("aria-activedescendant"),
      rows().at(-1)!.id,
    );
    key(view, "ArrowDown");
    key(view, "ArrowDown");
    assert.equal(
      view.contentDOM.getAttribute("aria-activedescendant"),
      rows()[1].id,
    );
    assert.equal(key(view, "Enter").defaultPrevented, true);
    assert.equal(view.state.doc.toString(), "# ");
    assert.equal(view.state.selection.main.head, 2);
    assert.equal(popup(), null);
    assert.equal(undo(view), true);
    assert.equal(
      view.state.doc.toString(),
      "/",
      "one undo restores the slash query",
    );
    assert.equal(redo(view), true);
    assert.equal(view.state.doc.toString(), "# ");
  });

  await t.test(
    "switching search language refreshes an open menu without modifying text",
    () => {
      const view = init();
      type(view, "/wenxian");
      assert.equal(rows()[0]?.dataset.slashCommand, "reference");
      send("setSlashSearchLanguage", { language: "english" });
      assert.equal(rows().length, 0);
      assert.equal(view.state.doc.toString(), "/wenxian");
      send("setSlashSearchLanguage", { language: "pinyin" });
      assert.equal(rows()[0]?.dataset.slashCommand, "reference");
      send("setSlashSearchLanguage", { language: "invalid" });
      assert.equal(rows()[0]?.dataset.slashCommand, "reference");
      for (const language of ["english", "pinyin"]) {
        const current = init();
        send("setSlashSearchLanguage", { language });
        type(current, "/文献");
        assert.equal(rows()[0]?.dataset.slashCommand, "reference");
        const heading = init();
        send("setSlashSearchLanguage", { language });
        type(heading, "/h1");
        assert.equal(rows()[0]?.dataset.slashCommand, "h1");
      }
      const english = init();
      type(english, "/reference");
      assert.equal(
        rows().length,
        0,
        "pinyin mode does not match internal English command IDs",
      );
      send("setSlashSearchLanguage", { language: "english" });
      assert.equal(rows()[0]?.dataset.slashCommand, "reference");
    },
  );

  await t.test(
    "opening CodeMirror search releases its Enter and arrow keys",
    () => {
      const view = init();
      type(view, "/");
      assert.ok(popup());
      send("command", { command: "find" });
      const search = browser.document.querySelector<HTMLInputElement>(
        '.cm-search input[name="search"]',
      );
      assert.ok(search);
      search.focus();
      assert.equal(popup(), null);
      search.value = "text";
      search.dispatchEvent(new browser.Event("input", { bubbles: true }));
      search.dispatchEvent(
        new browser.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
      search.dispatchEvent(
        new browser.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      assert.equal(view.state.doc.toString(), "/");
    },
  );

  await t.test(
    "format commands share insertion behavior in Live Preview and Source",
    () => {
      const cases = [
        ["h2", "## ", 3],
        ["h3", "### ", 4],
        ["list", "- ", 2],
        ["orderedList", "1. ", 3],
        ["task", "- [ ] ", 6],
        ["quote", "> ", 2],
        ["bold", "****", 2],
        ["italic", "**", 1],
        ["code", "``", 1],
        ["codeBlock", "```\n\n```", 4],
        ["link", "[](url)", 6],
        ["divider", "---\n", 4],
      ] as const;
      for (const mode of ["source", "live"])
        for (const [id, text, selection] of cases) {
          const view = init("Paragraph\n\n", false, mode);
          type(view, "/");
          choose(id);
          assert.equal(
            view.state.doc.toString(),
            `Paragraph\n\n${text}`,
            `${mode}: ${id}`,
          );
          assert.equal(view.state.selection.main.head, 11 + selection);
          if (id === "link") {
            assert.equal(
              view.state.sliceDoc(
                view.state.selection.main.from,
                view.state.selection.main.to,
              ),
              "url",
            );
          }
          assert.equal(view.hasFocus, true);
        }
      const view = init();
      type(view, "/table");
      choose("table");
      assert.equal(view.state.doc.toString(), tableInsertTemplate().text);
      assert.equal(
        view.state.selection.main.head,
        tableInsertTemplate().selectionFrom,
      );
    },
  );

  await t.test(
    "reference transfers focus into existing Zotero [[ search and inserts its result",
    () => {
      const view = init();
      type(view, "/wenxian");
      key(view, "Enter");
      assert.equal(view.state.doc.toString(), "[[");
      assert.equal(popup(), null);
      assert.ok(browser.document.querySelector(".zmd-link-completion"));
      type(view, "study");
      const request = messages.findLast(
        (message) => message.type === "linkSearch",
      )!.payload;
      assert.equal(request.query, "study");
      send("linkSearchResults", {
        ...request,
        results: [
          {
            key: "BOOK0001",
            libraryID: 1,
            title: "A study",
            kind: "regular",
            href: "zotero://select/library/items/BOOK0001",
          },
        ],
      });
      key(view, "Enter");
      assert.equal(
        view.state.doc.toString(),
        "[A study](zotero://select/library/items/BOOK0001)",
      );
      assert.equal(view.contentDOM.getAttribute("aria-expanded"), null);
    },
  );

  await t.test(
    "image requests the existing picker once and creates no fabricated image path",
    () => {
      const view = init("Before\n\n");
      type(view, "/tupian");
      key(view, "Enter");
      assert.equal(
        messages.filter((message) => message.type === "importImage").length,
        1,
      );
      assert.equal(view.state.doc.toString(), "Before\n\n");
      assert.equal(popup(), null);
      undo(view);
      assert.equal(view.state.doc.toString(), "Before\n\n/tupian");
    },
  );

  await t.test(
    "Escape leaves text intact, dismisses listeners, and typing can reopen",
    () => {
      const view = init();
      type(view, "/h");
      assert.equal(key(view, "Escape").defaultPrevented, true);
      assert.equal(popup(), null);
      assert.equal(view.state.doc.toString(), "/h");
      view.dispatch({ selection: { anchor: 2 } });
      assert.equal(popup(), null);
      assert.equal(key(view, "Escape").defaultPrevented, false);
      type(view, "1");
      assert.equal(rows().length, 1);
      assert.equal(rows()[0].dataset.slashCommand, "h1");
    },
  );

  await t.test(
    "URLs, paths, prose, code, table cells and frontmatter do not open the menu",
    () => {
      const cases: [string, number?][] = [
        ["https://example.org/"],
        ["/Users/name/"],
        ["./assets/"],
        ["C:\\files\\/"],
        ["ordinary text /"],
        ["\\/"],
        ["    /"],
        ["`/`", 2],
        ["`/", 2],
        ["```md\n/\n```", 7],
        ["~~~\n/\n~~~", 5],
        ["| A | B |\n| --- | --- |\n| / | |", 27],
        ["---\ntitle: Test\n/\n---", 17],
        ["<script>\n/\n</script>", 10],
        [`\`\`\`\n${"code line\n".repeat(1000)}/\n\`\`\``, 10005],
      ];
      for (const [text, position] of cases) {
        init(text, false, "source", position ?? text.length);
        assert.equal(
          popup(),
          null,
          `no command popup in ${JSON.stringify(text)}`,
        );
      }
      const view = init("---\n\n");
      type(view, "/");
      assert.ok(
        popup(),
        "a horizontal rule is not mistaken for unclosed frontmatter",
      );
    },
  );

  await t.test("IME candidate keys do not choose or navigate commands", () => {
    const view = init();
    type(view, "/h");
    const active = view.contentDOM.getAttribute("aria-activedescendant");
    for (const extra of [{ isComposing: true }, { keyCode: 229 }])
      for (const value of ["Enter", "ArrowDown", "ArrowUp", "Escape"]) {
        // Dispatch on the host: this isolates our capture listener from CodeMirror's own IME keymap.
        const event = new browser.KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
          ...extra,
        });
        view.dom.dispatchEvent(event as unknown as KeyboardEvent);
        assert.equal(event.defaultPrevented, false);
        assert.equal(
          view.contentDOM.getAttribute("aria-activedescendant"),
          active,
        );
        assert.equal(view.state.doc.toString(), "/h");
      }
    view.contentDOM.dispatchEvent(
      new browser.CompositionEvent("compositionstart", { bubbles: true }),
    );
    assert.equal(popup(), null);
    assert.equal(view.contentDOM.getAttribute("aria-expanded"), null);
    type(view, "中文");
    assert.equal(popup(), null);
    assert.equal(view.state.doc.toString(), "/h中文");
  });

  await t.test(
    "committing IME text filters commands after composition completes",
    async () => {
      const view = init();
      // happy-dom has no text layout; keep the menu's scheduled positioning alive.
      view.coordsAtPos = () => ({ left: 20, right: 21, top: 30, bottom: 45 });
      type(view, "/");
      view.contentDOM.dispatchEvent(
        new browser.CompositionEvent("compositionstart", { bubbles: true }),
      );
      type(view, "文献");
      assert.equal(popup(), null);
      view.contentDOM.dispatchEvent(
        new browser.CompositionEvent("compositionend", { bubbles: true }),
      );
      const deadline = Date.now() + 1000;
      while (
        !messages.some(
          (message) =>
            message.type === "composition" && !message.payload.active,
        ) &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.ok(
        messages.some(
          (message) =>
            message.type === "composition" && !message.payload.active,
        ),
      );
      assert.deepEqual(
        rows().map((row) => row.dataset.slashCommand),
        ["reference"],
      );
      assert.equal(view.state.doc.toString(), "/文献");
      key(view, "Enter");
      assert.equal(view.state.doc.toString(), "[[");
    },
  );

  await t.test(
    "outside click and window blur dismiss without editing or stealing focus",
    () => {
      const view = init();
      type(view, "/");
      browser.document.body.dispatchEvent(
        new browser.PointerEvent("pointerdown", { bubbles: true }),
      );
      assert.equal(popup(), null);
      assert.equal(view.state.doc.toString(), "/");
      type(view, "h");
      assert.ok(popup());
      browser.dispatchEvent(new browser.Event("blur"));
      assert.equal(popup(), null);
      assert.equal(view.state.doc.toString(), "/h");
      assert.equal(view.contentDOM.getAttribute("aria-activedescendant"), null);
    },
  );

  await t.test(
    "read-only, replacement, reinitialization and teardown remove stale commands",
    () => {
      let view = init();
      type(view, "/");
      const oldRow = rows()[1];
      send("setReadOnly", { readOnly: true });
      assert.equal(popup(), null);
      oldRow.click();
      assert.equal(view.state.doc.toString(), "/");
      view = init();
      type(view, "/");
      const replacedRow = rows()[1];
      send("setValue", { value: "/image" });
      assert.equal(popup(), null);
      replacedRow.click();
      assert.equal(view.state.doc.toString(), "/image");
      init("/");
      const abandoned = rows()[1];
      const current = init("Other note");
      abandoned.click();
      assert.equal(current.state.doc.toString(), "Other note");
      assert.equal(popup(), null);
      view = init();
      type(view, "/");
      send("destroy");
      assert.equal(popup(), null);
      assert.equal(view.contentDOM.getAttribute("aria-expanded"), null);
    },
  );
});
