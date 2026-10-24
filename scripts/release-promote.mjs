import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  channelNames,
  compareVersions,
  parseVersion,
  sha512,
  verifyCandidate,
} from "./release-candidate.mjs";

export function validateRun(run, workflowId, options) {
  assert.equal(run.id.toString(), options.runId, "Wrong candidate run");
  assert.equal(run.workflow_id, workflowId, "Candidate must come from CI");
  assert.equal(run.path, ".github/workflows/ci.yml", "Wrong workflow path");
  assert.equal(
    run.repository.full_name,
    options.repository,
    "Wrong run repository",
  );
  assert.equal(
    run.head_repository.full_name,
    options.repository,
    "Fork candidates cannot be promoted",
  );
  assert.equal(run.event, "push", "Only main push candidates can be promoted");
  assert.equal(run.head_branch, "main", "Only main candidates can be promoted");
  assert.equal(run.status, "completed", "CI is still running");
  assert.equal(run.conclusion, "success", "The complete CI run must pass");
  assert.equal(
    run.head_sha,
    options.expectedSha,
    "CI commit differs from the reviewed commit",
  );
}

export function prepareChannel(previousBytes, addonId, entry) {
  const previous = JSON.parse(previousBytes.toString());
  const updates = previous.addons?.[addonId]?.updates;
  assert.ok(
    Array.isArray(updates) && updates.length,
    "Existing channel must contain updates",
  );
  for (const update of updates) {
    assert.ok(
      compareVersions(entry.version, update.version) >= 0,
      `Refusing channel downgrade from ${update.version} to ${entry.version}`,
    );
    if (update.version === entry.version) {
      assert.deepEqual(
        update,
        entry,
        "Existing version has different update metadata",
      );
    }
  }
  // Keep historical compatibility routes and unrelated add-ons intact.
  previous.addons[addonId].updates = [
    ...updates.filter((update) => update.version !== entry.version),
    entry,
  ];
  return Buffer.from(`${JSON.stringify(previous, null, 2)}\n`);
}

function validateOptions(options) {
  assert.equal(
    options.context.actions,
    "true",
    "Promotion only runs in GitHub Actions",
  );
  assert.equal(
    options.context.event,
    "workflow_dispatch",
    "Promotion requires a maintainer dispatch",
  );
  assert.equal(
    options.context.ref,
    "refs/heads/main",
    "Dispatch promotion from main",
  );
  assert.match(options.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(options.runId, /^[1-9]\d*$/);
  assert.match(options.expectedSha, /^[a-f0-9]{40}$/);
  assert.match(options.expectedXpiHash, /^sha512:[a-f0-9]{128}$/);
  parseVersion(options.version);
  assert.ok(
    options.hostEvidence?.trim(),
    "Describe the native Zotero check of this candidate and its result",
  );
}

export async function promote(options, api) {
  validateOptions(options);
  const run = await api.getRun(options.runId);
  validateRun(run, await api.getCiWorkflowId(), options);
  const artifactName = `scholar-sketch-candidate-${options.runId}-${run.run_attempt}`;
  const artifacts = (await api.listArtifacts(options.runId)).filter(
    (artifact) => artifact.name === artifactName,
  );
  assert.equal(
    artifacts.length,
    1,
    "Expected exactly one candidate artifact from this run attempt",
  );
  assert.equal(
    artifacts[0].expired,
    false,
    "Candidate artifact expired; create and review a new candidate",
  );
  const directory = await mkdtemp(
    join(options.temporaryDirectory ?? tmpdir(), "sketch-promotion-"),
  );
  const candidateDirectory = join(directory, "candidate");
  await mkdir(candidateDirectory);
  await api.downloadArtifact(artifacts[0].id, candidateDirectory);
  const sourcePackage = await api.getSourcePackage(options.expectedSha);
  assert.equal(
    sourcePackage.version,
    options.version,
    "Source package version differs from requested version",
  );
  const { candidate, updates } = await verifyCandidate(candidateDirectory, {
    repository: options.repository,
    commit: options.expectedSha,
    runId: options.runId,
    runAttempt: run.run_attempt.toString(),
    version: options.version,
    addonId: sourcePackage.config.addonID,
    event: "push",
    ref: "refs/heads/main",
  });
  const tag = `v${candidate.version}`;
  assert.equal(
    candidate.files[candidate.xpi],
    options.expectedXpiHash,
    "Candidate bytes differ from the XPI reviewed by the maintainer",
  );
  const existingCommit = await api.getTagCommit(tag);
  assert.ok(
    existingCommit === null || existingCommit === candidate.commit,
    "Existing tag points at another commit",
  );
  let release = await api.getRelease(tag);
  assert.ok(
    !release || existingCommit === candidate.commit,
    "Existing release requires a matching tag",
  );
  const xpiBytes = await readFile(join(candidateDirectory, candidate.xpi));
  const existingXpi = release && (await api.readAsset(release, candidate.xpi));
  if (existingXpi)
    assert.equal(
      sha512(existingXpi),
      candidate.files[candidate.xpi],
      "Published XPI differs; never overwrite a version package",
    );
  if (release && !release.draft)
    assert.ok(
      existingXpi,
      "Published release has no XPI; manual recovery required",
    );

  const floating = await api.getRelease("release");
  assert.ok(
    floating && !floating.draft,
    "The existing public release manifest channel is required",
  );
  const channels = channelNames(candidate.version);
  const previous = {};
  const next = {};
  // Complete every validation, including downgrade checks, before the first write.
  for (const name of channels) {
    previous[name] = await api.readAsset(floating, name);
    assert.ok(
      previous[name],
      `Missing existing ${name}; manual recovery required`,
    );
    next[name] = prepareChannel(
      previous[name],
      candidate.addonId,
      updates[name],
    );
  }
  await mkdir(options.backupDirectory, { recursive: true });
  for (const name of channels)
    await writeFile(join(options.backupDirectory, name), previous[name]);
  await writeFile(
    join(options.backupDirectory, "promotion.json"),
    `${JSON.stringify(
      {
        repository: options.repository,
        candidate,
        hostEvidence: options.hostEvidence.trim(),
        channels,
      },
      null,
      2,
    )}\n`,
  );

  if (existingCommit === null) await api.createTag(tag, candidate.commit);
  assert.equal(
    await api.getTagCommit(tag),
    candidate.commit,
    "Tag changed during promotion",
  );
  if (!release)
    release = await api.createDraft(
      tag,
      candidate,
      options.hostEvidence.trim(),
    );
  if (!existingXpi) await api.uploadAsset(release, candidate.xpi, xpiBytes);
  const uploadedXpi = await api.readAsset(release, candidate.xpi);
  assert.ok(uploadedXpi, "Uploaded XPI is missing");
  assert.equal(
    sha512(uploadedXpi),
    candidate.files[candidate.xpi],
    "Uploaded XPI verification failed",
  );
  if (release.draft)
    await api.publishRelease(release, candidate.version.includes("-"));

  const touched = [];
  try {
    for (const name of channels) {
      // Also restore an asset whose deletion succeeded but upload failed.
      touched.push(name);
      await api.replaceAsset(floating, name, next[name]);
      assert.deepEqual(
        await api.readAsset(floating, name),
        next[name],
        `${name} upload verification failed`,
      );
    }
  } catch (error) {
    const failures = [];
    for (const name of touched.reverse()) {
      try {
        await api.replaceAsset(floating, name, previous[name]);
        assert.deepEqual(await api.readAsset(floating, name), previous[name]);
      } catch (rollbackError) {
        failures.push(`${name}: ${rollbackError.message}`);
      }
    }
    throw new Error(
      `Channel update failed: ${error.message}. ${
        failures.length
          ? `RESTORE FAILED (${failures.join("; ")}); use the saved channel backups for manual recovery`
          : "Previous channel bytes restored"
      }. The version release may already be public; do not delete or rebuild it.`,
      { cause: error },
    );
  }
  return {
    tag,
    commit: candidate.commit,
    sha512: candidate.files[candidate.xpi],
    artifactName,
  };
}

export class GitHub {
  constructor(repository, execute = execFileSync) {
    this.repository = repository;
    this.base = `repos/${repository}`;
    this.execute = execute;
  }

  request(
    path,
    {
      method = "GET",
      body,
      rawBody,
      binary = false,
      missing = false,
      accept,
    } = {},
  ) {
    const args = ["api", path, "--method", method];
    if (body !== undefined || rawBody !== undefined) args.push("--input", "-");
    if (rawBody !== undefined) {
      args.push(
        "-H",
        "Content-Type: application/octet-stream",
        "-H",
        `Content-Length: ${rawBody.byteLength}`,
      );
    }
    if (accept || binary)
      args.push("-H", `Accept: ${accept ?? "application/octet-stream"}`);
    try {
      const bytes = this.execute("gh", args, {
        input:
          rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        maxBuffer: 100 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return binary
        ? bytes
        : bytes.length
          ? JSON.parse(bytes.toString())
          : null;
    } catch (error) {
      if (missing && error.stderr?.toString().includes("HTTP 404")) return null;
      throw new Error(
        `GitHub ${method} ${path} failed: ${error.stderr?.toString() ?? error.message}`,
        { cause: error },
      );
    }
  }

  async getRun(id) {
    return this.request(`${this.base}/actions/runs/${id}`);
  }
  async getCiWorkflowId() {
    return this.request(`${this.base}/actions/workflows/ci.yml`).id;
  }
  async listArtifacts(id) {
    const result = this.request(
      `${this.base}/actions/runs/${id}/artifacts?per_page=100`,
    );
    assert.ok(
      result.total_count <= 100,
      "Too many artifacts; select a fresh CI run",
    );
    return result.artifacts;
  }
  async downloadArtifact(id, directory) {
    const archive = join(directory, "../artifact.zip");
    await writeFile(
      archive,
      this.request(`${this.base}/actions/artifacts/${id}/zip`, {
        // Actions archives redirect to ZIP bytes but require JSON API negotiation.
        accept: "application/vnd.github+json",
        binary: true,
      }),
    );
    const names = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
      .trim()
      .split("\n");
    assert.ok(
      names.length <= 4 &&
        new Set(names).size === names.length &&
        names.every((name) =>
          /^(candidate\.json|update(?:-beta)?\.json|scholarsketch-v[0-9A-Za-z.-]+\.xpi)$/.test(
            name,
          ),
        ),
      "Unexpected artifact archive entries",
    );
    execFileSync("unzip", ["-q", archive, "-d", directory]);
  }
  async getSourcePackage(sha) {
    const data = this.request(`${this.base}/contents/package.json?ref=${sha}`);
    assert.equal(data.encoding, "base64");
    return JSON.parse(Buffer.from(data.content, "base64").toString());
  }
  async getTagCommit(tag) {
    const ref = this.request(`${this.base}/git/ref/tags/${tag}`, {
      missing: true,
    });
    if (!ref) return null;
    let object = ref.object;
    for (let depth = 0; depth < 8 && object.type === "tag"; depth++)
      object = this.request(`${this.base}/git/tags/${object.sha}`).object;
    assert.equal(
      object.type,
      "commit",
      "Release tag does not resolve to a commit",
    );
    return object.sha;
  }
  async createTag(tag, sha) {
    this.request(`${this.base}/git/refs`, {
      method: "POST",
      body: { ref: `refs/tags/${tag}`, sha },
    });
  }
  async getRelease(tag) {
    // The tag endpoint does not reliably discover unpublished drafts. Listing
    // with the publisher's token includes drafts and detects ambiguous tags.
    const matches = [];
    for (let page = 1; ; page++) {
      const releases = this.request(
        `${this.base}/releases?per_page=100&page=${page}`,
      );
      matches.push(...releases.filter((release) => release.tag_name === tag));
      assert.ok(
        matches.length <= 1,
        `Multiple releases match ${tag}; manual recovery required`,
      );
      if (releases.length < 100) break;
    }
    return matches[0] ?? null;
  }
  async assets(release) {
    const assets = this.request(
      `${this.base}/releases/${release.id}/assets?per_page=100`,
    );
    assert.ok(
      assets.length < 100,
      "Too many release assets for safe promotion",
    );
    return assets;
  }
  async readAsset(release, name) {
    const matches = (await this.assets(release)).filter(
      (asset) => asset.name === name,
    );
    assert.ok(matches.length <= 1, `Duplicate release asset: ${name}`);
    return matches.length
      ? this.request(`${this.base}/releases/assets/${matches[0].id}`, {
          binary: true,
        })
      : null;
  }
  async createDraft(tag, candidate, hostEvidence) {
    return this.request(`${this.base}/releases`, {
      method: "POST",
      body: {
        tag_name: tag,
        target_commitish: candidate.commit,
        name: `Release ${tag}`,
        draft: true,
        prerelease: candidate.version.includes("-"),
        body: `Promoted candidate from https://github.com/${this.repository}/actions/runs/${candidate.runId} (attempt ${candidate.runAttempt}).\n\nCommit: ${candidate.commit}\n\nXPI SHA512: \`${candidate.files[candidate.xpi]}\`\n\nNative Zotero verification:\n${hostEvidence}`,
      },
    });
  }
  async uploadAsset(release, name, bytes) {
    // Address the checked release ID directly, including unpublished drafts.
    // GitHub rejects duplicate names; version assets are never deleted here.
    this.request(
      `https://uploads.github.com/${this.base}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      {
        method: "POST",
        rawBody: bytes,
      },
    );
  }
  async publishRelease(release, prerelease) {
    this.request(`${this.base}/releases/${release.id}`, {
      method: "PATCH",
      body: {
        draft: false,
        prerelease,
        make_latest: prerelease ? "false" : "true",
      },
    });
  }
  async replaceAsset(release, name, bytes) {
    const old = (await this.assets(release)).filter(
      (asset) => asset.name === name,
    );
    assert.ok(old.length <= 1, `Duplicate channel asset: ${name}`);
    if (old.length)
      this.request(`${this.base}/releases/assets/${old[0].id}`, {
        method: "DELETE",
      });
    await this.uploadAsset(release, name, bytes);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.CANDIDATE_RUN_ID,
    expectedSha: process.env.EXPECTED_SHA,
    expectedXpiHash: process.env.EXPECTED_XPI_SHA512,
    version: process.env.RELEASE_VERSION,
    hostEvidence: process.env.HOST_EVIDENCE,
    backupDirectory: ".scaffold/release-backup",
    context: {
      actions: process.env.GITHUB_ACTIONS,
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
    },
  };
  const result = await promote(options, new GitHub(options.repository));
  console.log(JSON.stringify(result, null, 2));
}
