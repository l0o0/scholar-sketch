import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import * as ts from "typescript";
import { choosePaperSettings } from "../src/modules/markdown/paper/dialog.ts";
import {
  SessionRegistry,
  type OpenSession,
} from "../src/modules/markdown/session-registry.ts";
import { getString } from "../src/utils/locale.ts";

test("paper export starts in the host sandbox using its session window and releases cancelled operations", async (t) => {
  const window = new Window();
  const mount = window.document.createElement("main");
  window.document.body.append(mount);
  const session = {
    tabID: "paper-host",
    surface: "tab",
    itemID: 1,
    win: window,
    editor: {},
    view: { root: mount },
  } as unknown as OpenSession;
  const registry = new SessionRegistry();
  registry.register(session);
  const source = readFileSync(
    new URL("../src/modules/markdown/paper/session.ts", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });
  const module = { exports: {} };
  // Like the plugin sandbox, this context has no global AbortController.
  // The production entry and settings dialog run until the user cancels;
  // file, image and Pandoc dependencies are not reached by that operation.
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    Zotero: {
      Styles: { init: async () => {}, getVisible: () => [] },
    },
    require: (name: string) => {
      if (name === "../../../utils/prefs")
        return {
          getPref: (key: string) =>
            key === "paperPandocPath" ? "/usr/local/bin/pandoc" : "",
        };
      if (name === "../../../utils/locale") return { getString };
      if (name === "../session-registry") return { sessionRegistry: registry };
      if (name === "./dialog") return { choosePaperSettings };
      return {};
    },
  });
  const api = module.exports as {
    exportSessionPaper(session: OpenSession): Promise<string | null>;
    cancelPaperExport(session: OpenSession): void;
  };
  t.after(async () => {
    api.cancelPaperExport(session);
    registry.unregister(session.tabID);
    await window.happyDOM.close();
  });
  const begin = () => {
    const opened = new Promise<void>((resolve) => {
      const observer = new window.MutationObserver(() => {
        if (mount.querySelector("dialog[open]")) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(mount, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["open"],
      });
      t.after(() => observer.disconnect());
    });
    return { opened, result: api.exportSessionPaper(session) };
  };

  const first = begin();
  await Promise.race([first.opened, first.result]);
  assert.equal(mount.querySelector("dialog")?.open, true);
  mount
    .querySelector<HTMLButtonElement>('footer button[type="button"]')!
    .click();
  assert.equal(await first.result, null);
  assert.equal(mount.querySelector("dialog"), null);

  const second = begin();
  await Promise.race([second.opened, second.result]);
  assert.equal(mount.querySelector("dialog")?.open, true);
  api.cancelPaperExport(session);
  assert.equal(await second.result, null);
  assert.equal(mount.querySelector("dialog"), null);
});
