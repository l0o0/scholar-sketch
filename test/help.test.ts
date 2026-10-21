import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

function fixture(request: () => Promise<{ status: number }>) {
  const launched: string[] = [];
  let requests = 0;
  const api = {} as typeof import("../src/modules/help.ts");
  const { outputText } = transpileModule(
    readFileSync(new URL("../src/modules/help.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
      },
    },
  );
  runInNewContext(outputText, {
    exports: api,
    __buildVersion__: "0.2.10",
    ztoolkit: { log() {} },
    Zotero: {
      HTTP: {
        request: async (
          method: string,
          url: string,
          options: { timeout: number; errorDelayMax: number },
        ) => {
          requests++;
          assert.equal(method, "HEAD");
          assert.equal(url, api.USER_GUIDE_URL);
          assert.equal(options.timeout, 1500);
          assert.equal(options.errorDelayMax, 0);
          return request();
        },
      },
      launchURL: (url: string) => launched.push(url),
    },
  });
  return { api, launched, requests: () => requests };
}

test("guide checks only on request, opens Wiki, and caches availability", async () => {
  const f = fixture(async () => ({ status: 200 }));
  assert.equal(f.requests(), 0);
  await f.api.openUserGuide();
  await f.api.openUserGuide();
  assert.equal(f.requests(), 1);
  assert.deepEqual(f.launched, [f.api.USER_GUIDE_URL, f.api.USER_GUIDE_URL]);
});

test("unpublished Wiki or a timeout opens the repository guide", async () => {
  for (const request of [
    async () => ({ status: 404 }),
    async () => {
      throw new Error("timeout");
    },
  ]) {
    const f = fixture(request);
    await f.api.openUserGuide();
    assert.deepEqual(f.launched, [f.api.USER_GUIDE_FALLBACK_URL]);
  }
});

test("repeated clicks share the pending check; later clicks retry publication", async () => {
  let resolve!: (response: { status: number }) => void;
  const f = fixture(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = f.api.openUserGuide();
  const second = f.api.openUserGuide();
  assert.equal(first, second);
  resolve({ status: 404 });
  await first;
  assert.equal(f.launched.length, 1);
  const third = f.api.openUserGuide();
  resolve({ status: 200 });
  await third;
  assert.equal(f.requests(), 2);
  assert.equal(f.launched[1], f.api.USER_GUIDE_URL);
});

test("release notes target the installed version", () => {
  const f = fixture(async () => ({ status: 200 }));
  f.api.openReleaseNotes();
  assert.deepEqual(f.launched, [
    "https://github.com/l0o0/scholar-sketch/releases/tag/v0.2.10",
  ]);
  assert.equal(f.requests(), 0);
});
