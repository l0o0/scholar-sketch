/** Run explicitly with PANDOC_PATH=... node --import tsx scripts/paper-export-smoke.ts. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { convertPaper } from "../src/modules/markdown/paper/export.ts";

const sample = resolve("examples/paper-writing");
const destination = resolve(process.argv[2] || ".scaffold/paper-smoke");
const references = JSON.parse(
  await readFile(join(sample, "references.json"), "utf8"),
) as Array<Record<string, unknown>>;
const work = await mkdtemp(join(tmpdir(), "scholar-paper-smoke-"));
const execute = promisify(execFile);
try {
  const bytes = await convertPaper(
    {
      source: await readFile(join(sample, "manuscript.md"), "utf8"),
      referenceDoc: join(sample, "reference.docx"),
      bibliographyTitle: "参考文献",
      signal: new AbortController().signal,
    },
    {
      path: (...names) => join(work, ...names),
      writeText: async (path, content) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      },
      readText: (path) => readFile(path, "utf8"),
      readBytes: (path) => readFile(path),
      run: async (args, signal) => {
        await execute(process.env.PANDOC_PATH || "pandoc", args, {
          cwd: work,
          signal,
        });
      },
      reference: async (id) =>
        references.find((reference) => reference.id === id) || null,
      image: async (reference) =>
        `data:image/png;base64,${(await readFile(join(sample, decodeURIComponent(reference)))).toString("base64")}`,
      // This smoke sample contains a PNG figure. Mermaid uses the browser renderer,
      // tested separately; do not pretend a fixture proves a real diagram render.
      diagram: async () => {
        throw new Error("This sample has no Mermaid diagram");
      },
    },
  );
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "manuscript.docx"), bytes);
  console.log(join(destination, "manuscript.docx"));
} finally {
  await rm(work, { recursive: true, force: true });
}
