import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { createFakeZotero } from "../packages/fake-zotero/dist/index.js";
import { createMarkdownEditor } from "../src/modules/markdown/editor.ts";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  isEditorProtocolMessage,
} from "../src/modules/markdown/editor-protocol.ts";
import {
  MARKDOWN_IMAGE_SHORTCUT,
  markdownImageShortcutLabel,
} from "../src/modules/markdown/shortcut.ts";

const macKeymap = /Mac/.test(globalThis.navigator?.platform ?? "");
const windowsKeymap = /Win/.test(globalThis.navigator?.platform ?? "");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("local image shortcut crosses the real editor bridge and owns its picker lifecycle", async (t) => {
  const globals = globalThis as any;
  const previous = new Map(
    Object.getOwnPropertyNames(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key)!,
    ]),
  );
  const fake = createFakeZotero();
  const restoreZotero = fake.install(globals);
  globals.addon = { data: { config: { addonName: "Scholar Sketch" } } };
  const errors: string[] = [];
  globals.ztoolkit = {
    log() {},
    ProgressWindow: class {
      createLine({ text }: { text: string }) {
        errors.push(text);
        return this;
      }
      show() {}
    },
  };
  const browser = new Window({ url: "https://host.example/" });
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const images: { bytes: ArrayBuffer; mimeType: string; name: string }[] = [];
  let holdWrite: Promise<void> | undefined;
  const editor = createMarkdownEditor(container, {
    win: browser as unknown as Window,
    channel: "image-import-test",
    doc: "A note",
    pageURL: "https://host.example/editor.html",
    onResolveAsset: async () => ({ error: "Test image preview unavailable" }),
    onPasteImage: async (payload) => {
      images.push(payload);
      await holdWrite;
      editor.insertText("![](assets/local.png)", 2, 2);
    },
  });
  const frame = container.querySelector("iframe")!.contentWindow!;
  frame.document.body.innerHTML = '<div id="editor-root"></div>';
  (frame as any).postMessage = (data: unknown) =>
    queueMicrotask(() =>
      frame.dispatchEvent(
        new frame.MessageEvent("message", { data, source: browser }),
      ),
    );
  const replies: any[] = [];
  (browser as any).postMessage = (data: unknown) => {
    replies.push(data);
    queueMicrotask(() =>
      browser.dispatchEvent(
        new browser.MessageEvent("message", { data, source: frame }),
      ),
    );
  };
  // Happy DOM cannot tear down timers scheduled on Node's global clock when an
  // iframe is removed. Release the actual iframe runtime before removing it.
  const destroyFrame = () =>
    frame.dispatchEvent(
      new frame.MessageEvent("message", {
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "image-import-test",
          type: "destroy",
        },
        source: browser,
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
  const picker = () =>
    container.querySelector<HTMLInputElement>('input[type="file"]');
  const shortcut = (
    options: {
      repeat?: boolean;
      isComposing?: boolean;
      altGraph?: boolean;
      shiftKey?: boolean;
      key?: string;
      keyCode?: number;
      ctrlKey?: boolean;
      metaKey?: boolean;
      altKey?: boolean;
    } = {},
  ) => {
    view.focus();
    const event = new frame.KeyboardEvent("keydown", {
      key: options.shiftKey ? "I" : "i",
      code: "KeyI",
      keyCode: 73,
      ctrlKey: !macKeymap,
      metaKey: macKeymap,
      altKey: true,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    // Firefox reports AltGraph for ordinary Cmd+Option on macOS and Ctrl+Alt
    // on Windows. GTK reserves it for the actual Level 3/5 shift modifier.
    Object.defineProperty(event, "getModifierState", {
      value: (key: string) =>
        key === "AltGraph" &&
        (options.altGraph ??
          (macKeymap
            ? event.altKey
            : windowsKeymap && event.ctrlKey && event.altKey)),
    });
    view.contentDOM.dispatchEvent(event);
    return event;
  };
  const select = (arrayBuffer: () => Promise<ArrayBuffer>) => {
    const input = picker();
    assert.ok(input);
    Object.defineProperty(input, "files", {
      value: [{ name: "local.png", type: "image/png", arrayBuffer }],
    });
    input.dispatchEvent(new browser.Event("change"));
  };

  for (const mode of ["live", "source"] as const) {
    await t.test(
      `${mode}: opens one picker and inserts the chosen image at the selection`,
      async () => {
        editor.setMode(mode);
        editor.setValue("A note");
        await tick();
        view.dispatch({ selection: { anchor: 2, head: 6 } });
        const event = shortcut();
        assert.equal(
          event.getModifierState("AltGraph"),
          macKeymap || windowsKeymap,
        );
        assert.equal(event.defaultPrevented, true);
        await tick();
        const first = picker();
        assert.ok(first);
        assert.equal(first.accept, "image/png,image/jpeg,image/gif,image/webp");
        shortcut();
        await tick();
        assert.equal(
          picker(),
          first,
          "a repeated request keeps the existing picker",
        );
        const bytes = new Uint8Array([1, 2, 3]).buffer;
        select(async () => bytes);
        await tick();
        assert.deepEqual(images.at(-1), {
          bytes,
          mimeType: "image/png",
          name: "local.png",
        });
        assert.equal(editor.getValue(), "A ![](assets/local.png)");
        assert.equal(!!picker(), false);
        editor.command("undo");
        await tick();
        assert.equal(editor.getValue(), "A note");
      },
    );
  }

  await t.test(
    "repeat, IME, read-only and extra modifiers do not open a picker",
    async () => {
      for (const options of [
        { repeat: true },
        { isComposing: true },
        { keyCode: 229 },
        { shiftKey: true },
      ]) {
        const before = replies.filter(
          (message) => message.type === "importImage",
        ).length;
        shortcut(options);
        await tick();
        assert.equal(!!picker(), false);
        assert.equal(
          replies.filter((message) => message.type === "importImage").length,
          before,
        );
      }
      view.contentDOM.dispatchEvent(
        new frame.CompositionEvent("compositionstart", { bubbles: true }),
      );
      shortcut();
      await tick();
      assert.equal(!!picker(), false);
      view.contentDOM.dispatchEvent(
        new frame.CompositionEvent("compositionend", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      editor.setReadOnly(true);
      await tick();
      shortcut();
      editor.importImage();
      await tick();
      assert.equal(!!picker(), false);
      editor.setReadOnly(false);
      await tick();
    },
  );

  await t.test(
    "native character-entry modifiers do not turn their physical I key into image import",
    async () => {
      const before = replies.filter(
        (message) => message.type === "importImage",
      ).length;
      const event = shortcut({
        key: "ı",
        ctrlKey: windowsKeymap,
        metaKey: false,
        altKey: windowsKeymap || macKeymap,
        altGraph: true,
      });
      assert.equal(event.defaultPrevented, false);
      await tick();
      assert.equal(!!picker(), false);
      assert.equal(
        replies.filter((message) => message.type === "importImage").length,
        before,
      );
    },
  );

  if (macKeymap) {
    await t.test(
      "Cmd+Option handles the layout's generated character through CodeMirror",
      async () => {
        assert.equal(shortcut({ key: "ˆ" }).defaultPrevented, true);
        await tick();
        assert.ok(picker());
        picker()!.dispatchEvent(new browser.Event("cancel"));
      },
    );
  }

  await t.test(
    "cancel permits another attempt, and import remains locked through the asynchronous writer",
    async () => {
      editor.importImage();
      picker()!.dispatchEvent(new browser.Event("cancel"));
      assert.equal(!!picker(), false);
      editor.importImage();
      let finishWrite!: () => void;
      holdWrite = new Promise((resolve) => {
        finishWrite = resolve;
      });
      select(async () => new ArrayBuffer(1));
      await tick();
      editor.importImage();
      assert.equal(
        !!picker(),
        false,
        "no second picker while the writer is pending",
      );
      finishWrite();
      await tick();
      holdWrite = undefined;
      editor.importImage();
      assert.ok(picker());
      picker()!.dispatchEvent(new browser.Event("cancel"));
    },
  );

  await t.test("read failures are reported and permit a retry", async () => {
    editor.importImage();
    select(async () => {
      throw new Error("Image could not be read");
    });
    await tick();
    assert.deepEqual(errors, ["Image could not be read"]);
    editor.importImage();
    assert.ok(picker());
    picker()!.dispatchEvent(new browser.Event("cancel"));
  });

  await t.test(
    "changing permissions invalidates an outstanding file read even when editing is re-enabled",
    async () => {
      editor.importImage();
      let finishRead!: (value: ArrayBuffer) => void;
      select(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          }),
      );
      const count = images.length;
      editor.setReadOnly(true);
      editor.setReadOnly(false);
      finishRead(new ArrayBuffer(2));
      await tick();
      assert.equal(images.length, count);
      assert.equal(!!picker(), false);
    },
  );

  await t.test(
    "destroying the editor drops a pending read without delivering to a replacement",
    async () => {
      editor.importImage();
      let finishRead!: (value: ArrayBuffer) => void;
      select(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          }),
      );
      const count = images.length;
      destroyFrame();
      editor.destroy();
      finishRead(new ArrayBuffer(2));
      await tick();
      assert.equal(images.length, count);
      assert.equal(!!picker(), false);
      editor.importImage();
      assert.equal(!!picker(), false);
    },
  );
});

test("image shortcut labels and the request boundary match the public binding", () => {
  assert.equal(MARKDOWN_IMAGE_SHORTCUT, "Mod-Alt-i");
  assert.equal(markdownImageShortcutLabel("MacIntel"), "Cmd + Option + I");
  assert.equal(markdownImageShortcutLabel("Win32"), "Ctrl + Alt + I");
  const request = { source: EDITOR_MESSAGE_SOURCE, type: "importImage" };
  assert.equal(isEditorProtocolMessage(request), true);
  assert.equal(
    isEditorProtocolMessage({
      ...request,
      payload: { path: "/tmp/image.png" },
    }),
    false,
  );
});

if (!process.env.SCHOLAR_IMAGE_SHORTCUT_PLATFORM) {
  test("the actual image shortcut runs under Firefox's Mac, Windows and Linux platform models", async (t) => {
    const run = promisify(execFile);
    for (const platform of ["MacIntel", "Win32", "Linux x86_64"]) {
      await t.test(platform, async () => {
        const script = `
          Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: {
              platform: ${JSON.stringify(platform)},
              userAgent: "Mozilla/5.0 Gecko/20100101 Firefox/140.0",
              vendor: "",
              maxTouchPoints: 0
            }
          });
          await import(${JSON.stringify(import.meta.url)});
        `;
        const env = {
          ...process.env,
          SCHOLAR_IMAGE_SHORTCUT_PLATFORM: platform,
        };
        delete env.NODE_TEST_CONTEXT;
        const result = await run(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", script],
          {
            env,
            timeout: 15000,
            maxBuffer: 1024 * 1024,
          },
        );
        assert.match(result.stdout, /# fail 0|ℹ fail 0/);
      });
    }
  });
}
