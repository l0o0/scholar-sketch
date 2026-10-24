import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package release entry refuses local publication before contacting GitHub", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.scripts.release, "node scripts/release-promote.mjs");
  const result = spawnSync(process.execPath, ["scripts/release-promote.mjs"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_ACTIONS: "false" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Promotion only runs in GitHub Actions/);
});
