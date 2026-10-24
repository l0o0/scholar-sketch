import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  channelNames,
  compareVersions,
  createCandidate,
  sha512,
  verifyCandidate,
} from "../scripts/release-candidate.mjs";
import {
  GitHub,
  prepareChannel,
  promote,
} from "../scripts/release-promote.mjs";

const repository = "l0o0/scholar-sketch";
const commit = "a".repeat(40);
const addonId = "bamboo@@linxzh.com";
const compatibility = { strict_min_version: "9.0", strict_max_version: "11.*" };

function update(version: string, hash = `sha512:${"f".repeat(128)}`) {
  return {
    version,
    update_link: `https://github.com/${repository}/releases/download/v${version}/scholarsketch-v${version}.xpi`,
    update_hash: hash,
    applications: { zotero: compatibility },
  };
}

function channel(entry = update("0.2.14")) {
  return Buffer.from(
    JSON.stringify({ addons: { [addonId]: { updates: [entry] } } }),
  );
}

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  version = "0.2.15",
) {
  const root = await mkdtemp(join(tmpdir(), "sketch-candidate-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const build = join(root, "build");
  const directory = join(root, "candidate");
  await mkdir(build);
  const packageInfo = { version, config: { addonID: addonId } };
  const xpi = `scholarsketch-v${version}.xpi`;
  const manifest = {
    manifest_version: 2,
    version,
    applications: {
      zotero: {
        id: addonId,
        update_url: `https://github.com/${repository}/releases/download/release/${version.includes("-") ? "update-beta.json" : "update.json"}`,
        ...compatibility,
      },
    },
  };
  // Produce a real ZIP so verification exercises the packaged manifest.
  execFileSync("python3", [
    "-c",
    "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w') as z:\n z.writestr('manifest.json', sys.argv[2])\n z.writestr('bootstrap.js', '// candidate fixture')",
    join(build, xpi),
    JSON.stringify(manifest),
  ]);
  const bytes = await readFile(join(build, xpi));
  for (const name of channelNames(version))
    await writeFile(join(build, name), channel(update(version, sha512(bytes))));
  await createCandidate({
    buildDirectory: build,
    directory,
    packageInfo,
    context: {
      repository,
      commit,
      runId: "101",
      runAttempt: "1",
      event: "push",
      ref: "refs/heads/main",
    },
  });
  const options = {
    repository,
    runId: "101",
    expectedSha: commit,
    expectedXpiHash: sha512(bytes),
    version,
    hostEvidence:
      "Zotero 9.0 / macOS: installed this candidate; edit/save/reopen and restart passed.",
    temporaryDirectory: root,
    backupDirectory: join(root, "backups"),
    context: {
      actions: "true",
      event: "workflow_dispatch",
      ref: "refs/heads/main",
    },
  };
  return { root, directory, packageInfo, options, bytes, xpi };
}

function fakeGitHub(f: Awaited<ReturnType<typeof fixture>>) {
  const run = {
    id: 101,
    workflow_id: 7,
    path: ".github/workflows/ci.yml",
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    event: "push",
    head_branch: "main",
    status: "completed",
    conclusion: "success",
    head_sha: commit,
    run_attempt: 1,
  };
  const floating = { id: 1, tag_name: "release", draft: false };
  const channels = new Map([
    ["update.json", channel()],
    ["update-beta.json", channel()],
  ]);
  const versionAssets = new Map<string, Buffer>();
  const writes: string[] = [];
  const state = {
    run,
    channels,
    versionAssets,
    writes,
    tagCommit: null as string | null,
    release: null as { id: number; tag_name: string; draft: boolean } | null,
    artifact: {
      id: 12,
      name: "scholar-sketch-candidate-101-1",
      expired: false,
    },
    failReplace: "",
    failRestore: false,
    failUpload: false,
  };
  const api = {
    async getRun() {
      return state.run;
    },
    async getCiWorkflowId() {
      return 7;
    },
    async listArtifacts() {
      return [state.artifact];
    },
    async downloadArtifact(_id: number, path: string) {
      await cp(f.directory, path, { recursive: true });
    },
    async getSourcePackage() {
      return f.packageInfo;
    },
    async getTagCommit() {
      return state.tagCommit;
    },
    async getRelease(tag: string) {
      return tag === "release" ? floating : state.release;
    },
    async readAsset(release: { id: number }, name: string) {
      return (release.id === 1 ? channels : versionAssets).get(name) ?? null;
    },
    async createTag() {
      writes.push("tag");
      state.tagCommit = commit;
    },
    async createDraft(tag: string) {
      writes.push("draft");
      state.release = { id: 2, tag_name: tag, draft: true };
      return state.release;
    },
    async uploadAsset(_release: unknown, name: string, bytes: Buffer) {
      writes.push("xpi");
      if (state.failUpload) throw new Error("XPI upload failed");
      versionAssets.set(name, bytes);
    },
    async publishRelease() {
      writes.push("publish");
      state.release!.draft = false;
    },
    async replaceAsset(_release: unknown, name: string, bytes: Buffer) {
      writes.push(name);
      channels.delete(name);
      if (state.failReplace === name) {
        state.failReplace = state.failRestore ? name : "";
        throw new Error("Channel upload failed after delete");
      }
      channels.set(name, bytes);
    },
  };
  return { state, api };
}

test("candidate packaging verifies actual ZIP bytes and both stable update channels", async (t) => {
  const f = await fixture(t);
  const result = await verifyCandidate(f.directory, {
    commit,
    version: "0.2.15",
  });
  assert.equal(result.candidate.files[f.xpi], sha512(f.bytes));
  assert.deepEqual(Object.keys(result.updates).sort(), [
    "update-beta.json",
    "update.json",
  ]);
  await writeFile(
    join(f.directory, f.xpi),
    Buffer.concat([f.bytes, Buffer.from("tampered")]),
  );
  await assert.rejects(verifyCandidate(f.directory), /checksum mismatch/);
});

test("rehashing a wrong update URL cannot bypass semantic validation", async (t) => {
  const f = await fixture(t);
  const path = join(f.directory, "update.json");
  const data = JSON.parse((await readFile(path)).toString());
  data.addons[addonId].updates[0].update_link =
    "https://example.invalid/wrong.xpi";
  const bytes = Buffer.from(JSON.stringify(data));
  await writeFile(path, bytes);
  const metadataPath = join(f.directory, "candidate.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  metadata.files["update.json"] = sha512(bytes);
  await writeFile(metadataPath, JSON.stringify(metadata));
  await assert.rejects(verifyCandidate(f.directory), /download URL mismatch/);
});

test("promotion preserves exact candidate bytes and historical compatibility entries", async (t) => {
  const f = await fixture(t);
  const { state, api } = fakeGitHub(f);
  const result = await promote(f.options, api);
  assert.equal(result.commit, commit);
  assert.deepEqual(state.versionAssets.get(f.xpi), f.bytes);
  assert.deepEqual(state.writes, [
    "tag",
    "draft",
    "xpi",
    "publish",
    "update.json",
    "update-beta.json",
  ]);
  const updates = JSON.parse(state.channels.get("update.json")!.toString())
    .addons[addonId].updates;
  assert.deepEqual(
    updates.map((entry: { version: string }) => entry.version),
    ["0.2.14", "0.2.15"],
  );
  assert.deepEqual(
    await readFile(join(f.options.backupDirectory, "update.json")),
    channel(),
  );
  assert.match(
    await readFile(join(f.options.backupDirectory, "promotion.json"), "utf8"),
    /Zotero 9.0/,
  );
});

test("beta promotion changes only beta, retaining stable channel bytes", async (t) => {
  const f = await fixture(t, "0.2.15-beta.1");
  const { state, api } = fakeGitHub(f);
  const stable = state.channels.get("update.json");
  await promote(f.options, api);
  assert.deepEqual(state.channels.get("update.json"), stable);
  assert.ok(!state.writes.includes("update.json"));
});

test("untrusted, incomplete and stale CI evidence cannot cause any writes", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { event: "pull_request" },
    { head_branch: "feature" },
    { conclusion: "failure" },
    { status: "in_progress" },
    { head_sha: "b".repeat(40) },
    { workflow_id: 99 },
    { head_repository: { full_name: "other/fork" } },
    { run_attempt: 2 },
  ]) {
    const { state, api } = fakeGitHub(f);
    Object.assign(state.run, patch);
    await assert.rejects(promote(f.options, api));
    assert.deepEqual(state.writes, []);
  }
  const { state, api } = fakeGitHub(f);
  state.artifact.expired = true;
  await assert.rejects(promote(f.options, api), /expired/);
  assert.deepEqual(state.writes, []);
});

test("promotion requires manual main dispatch and native host evidence", async (t) => {
  const f = await fixture(t);
  for (const options of [
    { ...f.options, hostEvidence: " " },
    { ...f.options, context: { ...f.options.context, actions: "false" } },
    { ...f.options, context: { ...f.options.context, event: "push" } },
    {
      ...f.options,
      context: { ...f.options.context, ref: "refs/heads/feature" },
    },
    { ...f.options, expectedSha: "main" },
    { ...f.options, expectedXpiHash: `sha512:${"b".repeat(128)}` },
    { ...f.options, version: "0.2.16" },
  ]) {
    const { state, api } = fakeGitHub(f);
    await assert.rejects(promote(options, api));
    assert.deepEqual(state.writes, []);
  }
});

test("wrong existing tag or version bytes never get overwritten", async (t) => {
  const f = await fixture(t);
  for (const wrongTag of [true, false]) {
    const { state, api } = fakeGitHub(f);
    state.tagCommit = wrongTag ? "b".repeat(40) : commit;
    state.release = { id: 2, tag_name: "v0.2.15", draft: false };
    state.versionAssets.set(f.xpi, Buffer.from("different published XPI"));
    await assert.rejects(
      promote(f.options, api),
      wrongTag ? /another commit/ : /never overwrite/,
    );
    assert.deepEqual(state.writes, []);
  }
});

test("same tag and bytes resume channel repair without republishing the XPI", async (t) => {
  const f = await fixture(t);
  const { state, api } = fakeGitHub(f);
  state.tagCommit = commit;
  state.release = { id: 2, tag_name: "v0.2.15", draft: false };
  state.versionAssets.set(f.xpi, f.bytes);
  await promote(f.options, api);
  assert.deepEqual(state.writes, ["update.json", "update-beta.json"]);
});

test("channel downgrades are refused before creating tags or releases", async (t) => {
  const f = await fixture(t);
  const { state, api } = fakeGitHub(f);
  state.channels.set("update-beta.json", channel(update("0.3.0-beta.1")));
  await assert.rejects(promote(f.options, api), /downgrade/);
  assert.deepEqual(state.writes, []);
});

test("failed second channel upload restores both original channel byte sequences", async (t) => {
  const f = await fixture(t);
  const { state, api } = fakeGitHub(f);
  state.failReplace = "update-beta.json";
  await assert.rejects(
    promote(f.options, api),
    /Previous channel bytes restored/,
  );
  assert.deepEqual(state.channels.get("update.json"), channel());
  assert.deepEqual(state.channels.get("update-beta.json"), channel());
  assert.equal(state.release?.draft, false);
  assert.deepEqual(state.versionAssets.get(f.xpi), f.bytes);
});

test("rollback failure is explicit and leaves the original backups available", async (t) => {
  const f = await fixture(t);
  const { state, api } = fakeGitHub(f);
  state.failReplace = "update-beta.json";
  state.failRestore = true;
  await assert.rejects(promote(f.options, api), /RESTORE FAILED/);
  assert.deepEqual(
    await readFile(join(f.options.backupDirectory, "update-beta.json")),
    channel(),
  );
});

test("XPI upload failure does not publish or update channels", async (t) => {
  const f = await fixture(t);
  const { state, api } = fakeGitHub(f);
  state.failUpload = true;
  await assert.rejects(promote(f.options, api), /XPI upload failed/);
  assert.deepEqual(state.writes, ["tag", "draft", "xpi"]);
  assert.deepEqual(state.channels.get("update.json"), channel());
});

test("retry after upload failure reuses the existing draft and tag", async (t) => {
  const f = await fixture(t);
  const { state, api } = fakeGitHub(f);
  state.failUpload = true;
  await assert.rejects(promote(f.options, api), /XPI upload failed/);
  const draft = state.release;
  state.failUpload = false;
  await promote(f.options, api);
  assert.equal(state.release, draft);
  assert.equal(state.writes.filter((write) => write === "draft").length, 1);
  assert.equal(state.writes.filter((write) => write === "tag").length, 1);
  assert.deepEqual(state.versionAssets.get(f.xpi), f.bytes);
  assert.equal(state.release?.draft, false);
});

test("GitHub adapter discovers a draft through paginated release listing", async () => {
  const paths: string[] = [];
  const draft = { id: 991, tag_name: "v0.2.15", draft: true };
  const api = new GitHub(repository, (command: string, args: string[]) => {
    assert.equal(command, "gh");
    assert.equal(args[0], "api");
    paths.push(args[1]);
    // The tag endpoint would return 404 for this draft. Only the second list
    // page exposes it to the authenticated publishing account.
    if (args[1].endsWith("?per_page=100&page=1")) {
      return Buffer.from(
        JSON.stringify(
          Array.from({ length: 100 }, (_, i) => ({
            id: i,
            tag_name: `other-${i}`,
            draft: false,
          })),
        ),
      );
    }
    assert.ok(args[1].endsWith("?per_page=100&page=2"));
    return Buffer.from(JSON.stringify([draft]));
  });
  assert.deepEqual(await api.getRelease("v0.2.15"), draft);
  assert.equal(paths.length, 2);
});

test("GitHub adapter refuses ambiguous drafts instead of choosing by tag", async () => {
  const api = new GitHub(repository, () =>
    Buffer.from(
      JSON.stringify([
        { id: 991, tag_name: "v0.2.15", draft: true },
        { id: 992, tag_name: "v0.2.15", draft: true },
      ]),
    ),
  );
  await assert.rejects(api.getRelease("v0.2.15"), /Multiple releases match/);
});

test("GitHub adapter uploads original binary bytes to the checked release ID", async () => {
  const bytes = Buffer.from([0, 255, 13, 10, 128]);
  let calls = 0;
  const api = new GitHub(
    repository,
    (command: string, args: string[], options: { input: Buffer }) => {
      calls++;
      assert.equal(command, "gh");
      assert.deepEqual(args, [
        "api",
        `https://uploads.github.com/repos/${repository}/releases/991/assets?name=candidate.xpi`,
        "--method",
        "POST",
        "--input",
        "-",
        "-H",
        "Content-Type: application/octet-stream",
        "-H",
        "Content-Length: 5",
      ]);
      assert.deepEqual(options.input, bytes);
      return Buffer.from(
        JSON.stringify({ id: 77, name: "candidate.xpi", state: "uploaded" }),
      );
    },
  );
  await api.uploadAsset(
    { id: 991, tag_name: "ambiguous-tag" },
    "candidate.xpi",
    bytes,
  );
  assert.equal(calls, 1);
});

test("channel merge retains other add-ons and rejects conflicting same-version metadata", () => {
  const previous = JSON.parse(channel().toString());
  previous.addons.other = { updates: [{ version: "1.0.0" }] };
  const result = JSON.parse(
    prepareChannel(
      Buffer.from(JSON.stringify(previous)),
      addonId,
      update("0.2.15"),
    ).toString(),
  );
  assert.deepEqual(result.addons.other, previous.addons.other);
  assert.throws(
    () =>
      prepareChannel(
        channel(),
        addonId,
        update("0.2.14", `sha512:${"a".repeat(128)}`),
      ),
    /different update metadata/,
  );
});

test("version order handles numeric patches and prerelease identifiers", () => {
  assert.ok(compareVersions("0.2.10", "0.2.9") > 0);
  assert.ok(compareVersions("0.2.15", "0.2.15-beta.20") > 0);
  assert.ok(compareVersions("0.2.15-beta.10", "0.2.15-beta.2") > 0);
  assert.ok(compareVersions("0.2.15-beta.1", "0.2.15-alpha.9") > 0);
  assert.equal(compareVersions("0.2.15", "0.2.15"), 0);
  assert.throws(() => compareVersions("0.2.15-beta.01", "0.2.14"));
});
