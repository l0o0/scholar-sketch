import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release bump updates package.json", async () => {
  const config = await readFile("zotero-plugin.config.ts", "utf8");
  const files = config.match(/files:\s*\[([^\]]+)\]/s)?.[1] ?? "";

  assert.match(files, /["']package\.json["']/);
});

test("release download uses the configured versioned XPI name", async () => {
  const config = await readFile("zotero-plugin.config.ts", "utf8");

  assert.match(config, /xpiName:\s*`scholarsketch-v\$\{pkg\.version\}`/);
  assert.match(config, /\{\{xpiName\}\}\.xpi/);
});

test("release entry refuses local publication before contacting GitHub", () => {
  const result = spawnSync(process.execPath, ["scripts/release-promote.mjs"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_ACTIONS: "false" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Promotion only runs in GitHub Actions/);
});
