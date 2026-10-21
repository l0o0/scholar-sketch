import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { version } from "../package.json";
import {
  RELEASE_HIGHLIGHTS,
  releaseHighlights,
} from "../src/modules/release-highlights.ts";

test("the published package version has an explicit concise highlights entry", () => {
  const current = releaseHighlights(version);
  assert.ok(
    current,
    "Add this release to src/modules/release-highlights.ts when bumping package.json",
  );
  for (const entry of RELEASE_HIGHLIGHTS) {
    assert.ok(
      entry.features.length <= 4,
      `Keep ${entry.version} to at most 4 highlights`,
    );
  }
  assert.equal(
    new Set(RELEASE_HIGHLIGHTS.map((entry) => entry.version)).size,
    RELEASE_HIGHLIGHTS.length,
    "Release versions must be unique",
  );
});

test("all bundled highlight headings and descriptions have Chinese and English translations", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const text = readFileSync(
      new URL(`../addon/locale/${locale}/addon.ftl`, import.meta.url),
      "utf8",
    );
    const keys = new Set(
      [...text.matchAll(/^([a-z0-9-]+)\s*=\s*\S/gm)].map((match) => match[1]),
    );
    for (const release of RELEASE_HIGHLIGHTS) {
      for (const feature of release.features) {
        assert.ok(keys.has(feature.title), `${locale}: ${feature.title}`);
        assert.ok(keys.has(feature.body), `${locale}: ${feature.body}`);
      }
    }
  }
});

test("the introductory overview does not claim existing features are newly added", () => {
  assert.equal(releaseHighlights("0.2.11")?.overview, true);
  assert.equal(releaseHighlights("unpublished"), undefined);
});
