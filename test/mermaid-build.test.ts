import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import config from "../zotero-plugin.config.ts";

const templateURL = new URL(
  "../addon/content/mermaid/index.html",
  import.meta.url,
);

function rendererBuild() {
  const options = config.build?.esbuildOptions;
  assert.ok(Array.isArray(options));
  const renderer = options.find((option) =>
    Array.isArray(option.entryPoints)
      ? option.entryPoints.includes("src/mermaid/bootstrap.ts")
      : false,
  );
  assert.ok(renderer, "Mermaid must have its own lazy renderer build");
  return renderer;
}

test("Mermaid build emits a self-contained sandbox document and preserves JavaScript containing HTML terminators", async (t) => {
  const originalDirectory = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "scholar-mermaid-build-"));
  const window = new Window({
    settings: { disableJavaScriptEvaluation: true },
  });
  t.after(async () => {
    process.chdir(originalDirectory);
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  });
  const template = await readFile(templateURL, "utf8");
  await mkdir(join(directory, "addon/content/mermaid"), { recursive: true });
  await writeFile(
    join(directory, "addon/content/mermaid/index.html"),
    template,
  );
  process.chdir(directory);

  const renderer = rendererBuild();
  assert.equal(renderer.bundle, true);
  assert.equal(
    renderer.write,
    false,
    "do not emit an inaccessible chrome script",
  );
  const plugin = renderer.plugins?.find(
    (entry) => entry.name === "isolated-mermaid-document",
  );
  assert.ok(plugin);
  type BuildResult = {
    errors: unknown[];
    outputFiles?: Array<{ path: string; text: string }>;
  };
  let finish: ((result: BuildResult) => unknown) | undefined;
  plugin.setup({
    onEnd(callback) {
      finish = callback as typeof finish;
    },
  } as Parameters<typeof plugin.setup>[0]);
  assert.ok(finish);

  const value = '</ScRiPt><img src="https://example.test/remote"> $& 甲 → 乙';
  const code = `globalThis.rendererTestValue = ${JSON.stringify(value)};`;
  await finish({
    errors: [],
    outputFiles: [
      { path: "/bundled/mermaid.js.map", text: "{}" },
      { path: "/bundled/mermaid.js", text: code },
    ],
  });
  const outputDirectory = join(
    directory,
    ".scaffold/build/addon/content/mermaid",
  );
  assert.deepEqual(await readdir(outputDirectory), ["index.html"]);
  const html = await readFile(join(outputDirectory, "index.html"), "utf8");
  window.document.write(html);
  const scripts = window.document.querySelectorAll("script");
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].hasAttribute("src"), false);
  assert.equal(window.document.querySelector("img"), null);
  const context: Record<string, unknown> = {};
  runInNewContext(scripts[0].textContent, context);
  assert.equal(context.rendererTestValue, value);

  const csp = window.document
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute("content");
  assert.ok(csp);
  const directives = new Map(
    csp.split(";").map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }),
  );
  assert.deepEqual(directives.get("default-src"), ["'none'"]);
  assert.deepEqual(directives.get("script-src"), ["'unsafe-inline'"]);
  assert.deepEqual(directives.get("connect-src"), ["'none'"]);
  assert.deepEqual(directives.get("img-src"), ["data:"]);
});

test("failed or empty Mermaid builds do not publish a renderer document", async (t) => {
  const originalDirectory = process.cwd();
  const directory = await mkdtemp(
    join(tmpdir(), "scholar-mermaid-build-fail-"),
  );
  t.after(async () => {
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  });
  process.chdir(directory);
  const plugin = rendererBuild().plugins?.find(
    (entry) => entry.name === "isolated-mermaid-document",
  );
  assert.ok(plugin);
  type BuildResult = {
    errors: unknown[];
    outputFiles?: Array<{ path: string; text: string }>;
  };
  let finish: ((result: BuildResult) => unknown) | undefined;
  plugin.setup({
    onEnd(callback) {
      finish = callback as typeof finish;
    },
  } as Parameters<typeof plugin.setup>[0]);
  assert.ok(finish);

  await finish({ errors: [new Error("Synthetic bundling failure")] });
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(
    async () => finish!({ errors: [], outputFiles: [] }),
    /Missing Mermaid renderer bundle/,
  );
  assert.deepEqual(await readdir(directory), []);
});
