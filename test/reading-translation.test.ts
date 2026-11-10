import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { config } from "../package.json";
import { translateReadingSelection } from "../src/modules/markdown/reading-translation.ts";

function install(t: TestContext, api?: object) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["Zotero", "ztoolkit"];
  const previous = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globals, key),
  );
  const logs: unknown[][] = [];
  const zotero: { PDFTranslate?: { api: object } } = {};
  if (api) zotero.PDFTranslate = { api };
  globals.Zotero = zotero;
  globals.ztoolkit = { log: (...args: unknown[]) => logs.push(args) };
  t.after(() => {
    keys.forEach((key, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else delete globals[key];
    });
  });
  return { zotero, logs };
}

test("uses the current public API with caller identity and leaves service, language and item context to custom-text defaults", async (t) => {
  const calls: unknown[][] = [];
  const api = {
    async translate(this: object, ...args: unknown[]) {
      assert.equal(this, api);
      calls.push(args);
      return {
        status: "success",
        result: "译文\n第二行",
        raw: "Selected text",
        secret: "provider-secret",
      };
    },
  };
  const app = install(t, api);
  assert.deepEqual(await translateReadingSelection("Selected text"), {
    status: "translated",
    text: "译文\n第二行",
  });
  // Supplying itemID would allow the provider to modify item language fields.
  assert.deepEqual(calls, [["Selected text", { pluginID: config.addonID }]]);
  assert.deepEqual(app.logs, []);
});

test("detects plugin availability again after it is enabled or disabled", async (t) => {
  const app = install(t);
  assert.deepEqual(await translateReadingSelection("Text"), {
    status: "unavailable",
  });
  app.zotero.PDFTranslate = {
    api: { translate: async () => ({ status: "success", result: "译文" }) },
  };
  assert.deepEqual(await translateReadingSelection("Text"), {
    status: "translated",
    text: "译文",
  });
  delete app.zotero.PDFTranslate;
  assert.deepEqual(await translateReadingSelection("Text"), {
    status: "unavailable",
  });
});

test("provider failures and invalid results do not expose raw text, credentials or error content as translations", async (t) => {
  let result: unknown = {
    status: "fail",
    result: "Request failed: secret=provider-secret",
    raw: "Private selection",
  };
  const app = install(t, { translate: async () => result });
  assert.deepEqual(await translateReadingSelection("Private selection"), {
    status: "failed",
  });
  result = { status: "success", result: { html: "unexpected" } };
  assert.deepEqual(await translateReadingSelection("Private selection"), {
    status: "failed",
  });
  assert.deepEqual(app.logs, [
    ["Reading selection translation failed", { reason: "provider-result" }],
    ["Reading selection translation failed", { reason: "provider-result" }],
  ]);
});

test("rejected public API requests produce actionable failure without logging provider exceptions", async (t) => {
  const app = install(t, {
    translate: async () => {
      throw new Error("https://provider.invalid?key=provider-secret");
    },
  });
  assert.deepEqual(await translateReadingSelection("Private selection"), {
    status: "failed",
  });
  assert.deepEqual(app.logs, [
    ["Reading selection translation failed", { reason: "provider-request" }],
  ]);
});
