import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { collectTests, resolveTestSuites } from "../scripts/test-suites.mjs";

const nodeSource = 'import test from "node:test"; test("example", () => {});';
const hostSource =
  'describe("host", () => { it("runs", () => Zotero.debug("ok")); });';
const suites = {
  unit: { runtime: "node", patterns: ["test/editor-*.test.ts"] },
  fake: { runtime: "node", patterns: ["test/fake-*.test.ts"] },
  zotero: { runtime: "zotero", patterns: ["test/startup.test.ts"] },
};
const files = [
  { path: "test/editor-table.test.ts", source: nodeSource },
  { path: "test/fake-window.test.ts", source: nodeSource },
  { path: "test/startup.test.ts", source: hostSource },
];

test("registry resolves the same explicit file lists used by the runner", () => {
  assert.deepEqual(resolveTestSuites(files, suites), {
    unit: ["test/editor-table.test.ts"],
    fake: ["test/fake-window.test.ts"],
    zotero: ["test/startup.test.ts"],
  });
});

test("new tests cannot silently disappear from all suites", () => {
  assert.throws(
    () =>
      resolveTestSuites(
        [...files, { path: "test/new-feature.test.ts", source: nodeSource }],
        suites,
      ),
    /new-feature\.test\.ts: no test suite owns/,
  );
});

test("duplicate ownership fails within one suite and across suites", () => {
  for (const name of ["unit", "fake"]) {
    const conflicting = {
      ...suites,
      [name]: {
        ...suites[name],
        patterns: [...suites[name].patterns, "test/editor-table.test.ts"],
      },
    };
    assert.throws(
      () => resolveTestSuites(files, conflicting),
      /editor-table\.test\.ts: duplicate ownership/,
    );
  }
});

test("deleted or renamed tests require registry maintenance", () => {
  assert.throws(
    () =>
      resolveTestSuites(
        files.filter((file) => !file.path.includes("fake")),
        suites,
      ),
    /stale pattern test\/fake-\*\.test\.ts/,
  );
});

test("a broad Node pattern cannot absorb a host test", () => {
  assert.throws(
    () =>
      resolveTestSuites(files, {
        unit: { runtime: "node", patterns: ["test/*.test.ts"] },
      }),
    /startup\.test\.ts: unit requires a direct node:test import/,
  );
});

test("comments mentioning node:test do not disguise a host test", () => {
  assert.throws(
    () =>
      resolveTestSuites(
        [
          {
            path: "test/host.test.ts",
            source: `// import test from "node:test";\n${hostSource}`,
          },
        ],
        { unit: { runtime: "node", patterns: ["test/host.test.ts"] } },
      ),
    /requires a direct node:test import/,
  );
});

test("a Node test cannot be hidden in the unrun Zotero suite", () => {
  assert.throws(
    () =>
      resolveTestSuites(
        [{ path: "test/startup.test.ts", source: nodeSource }],
        { zotero: suites.zotero },
      ),
    /node:test cannot belong to the Zotero suite/,
  );
});

test("inventory finds nested and package tests without treating helpers as tests", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sketch-test-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["test/nested", "packages/fake-zotero/test"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, "test/nested/new.test.ts"), nodeSource);
  writeFileSync(join(root, "test/helper.ts"), "export const fixture = 1;");
  writeFileSync(
    join(root, "packages/fake-zotero/test/new.test.js"),
    nodeSource,
  );
  const inventory = collectTests(root);
  assert.deepEqual(
    inventory.map((file) => file.path),
    ["packages/fake-zotero/test/new.test.js", "test/nested/new.test.ts"],
  );
  assert.throws(
    () =>
      resolveTestSuites(inventory, {
        unit: { runtime: "node", patterns: ["test/*.test.ts"] },
      }),
    /test\/nested\/new\.test\.ts: no test suite owns/,
  );
});

async function runFixture(
  t: TestContext,
  source: string,
  interrupt?: "SIGINT" | "SIGTERM",
) {
  const directory = mkdtempSync(join(tmpdir(), "sketch-test-runner-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "fixture.test.mjs");
  writeFileSync(file, `import test from "node:test";\n${source}`);
  // Run the real CLI in isolation with a one-file registry, without rerunning
  // the repository's full suite or depending on a test selection escape hatch.
  writeFileSync(
    join(directory, "test-runner.mjs"),
    readFileSync(new URL("../scripts/test-runner.mjs", import.meta.url)),
  );
  writeFileSync(
    join(directory, "test-suites.mjs"),
    `export const testSuites = { fake: { runtime: "node" } };
export const collectTests = () => [];
export const resolveTestSuites = () => ({ fake: [${JSON.stringify(file)}] });`,
  );
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    [join(directory, "test-runner.mjs"), "fake"],
    { stdio: ["ignore", "pipe", "pipe"], env },
  );
  let output = "";
  let interrupted = false;
  const read = (data: Buffer) => {
    output += data.toString();
    if (interrupt && !interrupted && output.includes("fixture-ready")) {
      interrupted = true;
      child.kill(interrupt);
    }
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  t.after(() => child.kill("SIGTERM"));
  const result = await new Promise<{
    code: number | null;
    signal: string | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return { ...result, output };
}

test(
  "runner preserves a passing or failing test process exit status",
  { timeout: 15_000 },
  async (t) => {
    const passed = await runFixture(t, 'test("passes", () => {});');
    assert.equal(passed.code, 0, passed.output);
    const failed = await runFixture(
      t,
      'test("fails", () => { throw new Error("fixture failure"); });',
    );
    assert.equal(failed.code, 1, failed.output);
  },
);

for (const [signal, expected] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(
    `runner propagates ${signal} and reports cancellation as failure`,
    { timeout: 15_000 },
    async (t) => {
      const result = await runFixture(
        t,
        `
process.on(${JSON.stringify(signal)}, () => process.exit(0));
test("waits", async () => {
  console.log("fixture-ready");
  await new Promise(() => { setInterval(() => {}, 1000); });
});`,
        signal,
      );
      assert.equal(result.code, expected, result.output);
      assert.match(
        result.output,
        new RegExp(`Test run interrupted by ${signal}`),
      );
    },
  );
}
