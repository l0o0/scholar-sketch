import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseVersion(version) {
  const match = typeof version === "string" && version.match(versionPattern);
  assert.ok(match, `Unsupported release version: ${version}`);
  const prerelease = match[4]?.split(".") ?? [];
  assert.ok(
    prerelease.every((part) => !/^0\d+$/.test(part)),
    "Invalid prerelease number",
  );
  return { numbers: match.slice(1, 4).map(BigInt), prerelease };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i])
      return a.numbers[i] > b.numbers[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function sha512(bytes) {
  return `sha512:${createHash("sha512").update(bytes).digest("hex")}`;
}

export function channelNames(version) {
  parseVersion(version);
  return version.includes("-")
    ? ["update-beta.json"]
    : ["update.json", "update-beta.json"];
}

export function readXpiManifest(path) {
  return JSON.parse(
    execFileSync("unzip", ["-p", path, "manifest.json"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }),
  );
}

function validateIdentity(candidate) {
  assert.equal(candidate.schemaVersion, 1, "Unknown candidate schema");
  assert.match(candidate.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(candidate.commit, /^[a-f0-9]{40}$/);
  assert.match(candidate.runId, /^[1-9]\d*$/);
  assert.match(candidate.runAttempt, /^[1-9]\d*$/);
  parseVersion(candidate.version);
  assert.equal(candidate.xpi, `scholarsketch-v${candidate.version}.xpi`);
  assert.ok(candidate.addonId, "Missing add-on ID");
}

export async function verifyCandidate(directory, expected = {}) {
  const candidate = JSON.parse(
    await readFile(join(directory, "candidate.json"), "utf8"),
  );
  validateIdentity(candidate);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(
      candidate[key],
      value,
      `Candidate ${key} does not match expected value`,
    );
  }
  const names = [candidate.xpi, ...channelNames(candidate.version)].sort();
  assert.deepEqual(
    Object.keys(candidate.files).sort(),
    names,
    "Unexpected candidate files",
  );
  assert.deepEqual(
    (await readdir(directory)).sort(),
    ["candidate.json", ...names].sort(),
    "Unexpected artifact contents",
  );
  for (const name of names) {
    assert.equal(
      sha512(await readFile(join(directory, name))),
      candidate.files[name],
      `Candidate checksum mismatch: ${name}`,
    );
  }
  const manifest = readXpiManifest(join(directory, candidate.xpi));
  const zotero = manifest.applications?.zotero;
  assert.equal(manifest.version, candidate.version, "XPI version mismatch");
  assert.equal(zotero?.id, candidate.addonId, "XPI add-on ID mismatch");
  const channel = candidate.version.includes("-")
    ? "update-beta.json"
    : "update.json";
  assert.equal(
    zotero.update_url,
    `https://github.com/${candidate.repository}/releases/download/release/${channel}`,
    "XPI update URL mismatch",
  );
  assert.ok(
    zotero.strict_min_version && zotero.strict_max_version,
    "Missing Zotero compatibility bounds",
  );
  const compatibility = {
    strict_min_version: zotero.strict_min_version,
    strict_max_version: zotero.strict_max_version,
  };
  const updates = {};
  for (const name of channelNames(candidate.version)) {
    const data = JSON.parse(await readFile(join(directory, name), "utf8"));
    const matches = data.addons?.[candidate.addonId]?.updates?.filter(
      (entry) => entry.version === candidate.version,
    );
    assert.equal(matches?.length, 1, `Expected one version entry in ${name}`);
    const entry = matches[0];
    assert.equal(
      entry.update_link,
      `https://github.com/${candidate.repository}/releases/download/v${candidate.version}/${candidate.xpi}`,
      "Update download URL mismatch",
    );
    assert.equal(
      entry.update_hash,
      candidate.files[candidate.xpi],
      "Update XPI hash mismatch",
    );
    assert.deepEqual(
      entry.applications?.zotero,
      compatibility,
      "Update compatibility mismatch",
    );
    updates[name] = entry;
  }
  return { candidate, updates, manifest };
}

export async function createCandidate({
  buildDirectory,
  directory,
  packageInfo,
  context,
}) {
  const candidate = {
    schemaVersion: 1,
    repository: context.repository,
    commit: context.commit,
    runId: context.runId,
    runAttempt: context.runAttempt,
    event: context.event,
    ref: context.ref,
    version: packageInfo.version,
    addonId: packageInfo.config.addonID,
    xpi: `scholarsketch-v${packageInfo.version}.xpi`,
    files: {},
  };
  validateIdentity(candidate);
  await mkdir(directory, { recursive: true });
  assert.equal(
    (await readdir(directory)).length,
    0,
    "Candidate output must be empty",
  );
  for (const name of [candidate.xpi, ...channelNames(candidate.version)]) {
    await copyFile(join(buildDirectory, name), join(directory, name));
    candidate.files[name] = sha512(await readFile(join(directory, name)));
  }
  await writeFile(
    join(directory, "candidate.json"),
    `${JSON.stringify(candidate, null, 2)}\n`,
  );
  return verifyCandidate(directory);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.equal(
    process.argv[2],
    "create",
    "Usage: node scripts/release-candidate.mjs create (in CI)",
  );
  await createCandidate({
    buildDirectory: ".scaffold/build",
    directory: ".scaffold/candidate",
    packageInfo: JSON.parse(await readFile("package.json", "utf8")),
    context: {
      repository: process.env.GITHUB_REPOSITORY,
      commit: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
    },
  });
  console.log(
    "Candidate XPI and update manifests verified; no release was published.",
  );
}
