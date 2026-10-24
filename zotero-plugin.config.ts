import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const scriptBuildTime = new Date().toISOString();

export default defineConfig({
  source: ["src", "addon", "packages/whiteboard/src"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: `scholarsketch-v${pkg.version}`,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
          __buildVersion__: JSON.stringify(pkg.version),
          __buildTime__: JSON.stringify(scriptBuildTime),
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
      // CodeMirror runs inside chrome:// iframe (stable Web document)
      {
        entryPoints: ["src/editor/bootstrap.ts"],
        bundle: true,
        minify: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/editor/editor.js`,
      },
      {
        entryPoints: ["packages/whiteboard/src/bootstrap.tsx"],
        bundle: true,
        minify: true,
        target: "firefox115",
        jsx: "automatic",
        loader: { ".css": "css", ".woff2": "dataurl", ".woff": "dataurl" },
        outfile: `.scaffold/build/addon/content/whiteboard/whiteboard.js`,
      },
      {
        entryPoints: ["src/workers/preview-worker.ts"],
        bundle: true,
        minify: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/workers/preview-worker.js`,
      },
      // Loaded only when a Mermaid block is visible or exported.
      {
        entryPoints: ["src/mermaid/bootstrap.ts"],
        bundle: true,
        minify: true,
        target: "firefox115",
        write: false,
        outfile: `.scaffold/build/addon/content/mermaid/mermaid.js`,
        plugins: [
          {
            name: "isolated-mermaid-document",
            setup(build) {
              build.onEnd(async (result) => {
                if (result.errors.length) return;
                const script = result.outputFiles?.find((file) =>
                  file.path.endsWith(".js"),
                )?.text;
                if (!script) throw new Error("Missing Mermaid renderer bundle");
                const template = await readFile(
                  "addon/content/mermaid/index.html",
                  "utf8",
                );
                // A sandboxed chrome document has an opaque origin. Inline
                // the packaged code so it needs no access to privileged URLs.
                const html = template.replace("/*__MERMAID_BUNDLE__*/", () =>
                  script.replace(/<\/script/gi, (match) =>
                    match.replace("/", "\\/"),
                  ),
                );
                await mkdir(".scaffold/build/addon/content/mermaid", {
                  recursive: true,
                });
                await writeFile(
                  ".scaffold/build/addon/content/mermaid/index.html",
                  html,
                );
              });
            },
          },
        ],
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
