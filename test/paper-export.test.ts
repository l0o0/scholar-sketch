import assert from "node:assert/strict";
import test from "node:test";
import {
  citationKey,
  parseCitationKey,
  convertPaper,
  publishPaper,
  PaperExportError,
  type PaperPorts,
} from "../src/modules/markdown/paper/export.ts";

const png = "data:image/png;base64,aGVsbG8=";
function fixture() {
  const citation = {
    citationId: "zotero-user-ABCD1234",
    citationPrefix: [],
    citationSuffix: [{ t: "Str", c: "p. 23" }],
    citationMode: { t: "NormalCitation" },
    citationNoteNum: 0,
    citationHash: 0,
  };
  const ast = {
    "pandoc-api-version": [1, 23, 1],
    meta: {
      title: { t: "MetaString", c: "Paper" },
      bibliography: {
        t: "MetaString",
        c: "https://unrequested.invalid/library.json",
      },
    },
    blocks: [
      {
        t: "Para",
        c: [
          { t: "Cite", c: [[citation], []] },
          { t: "Math", c: [{ t: "InlineMath" }, "x^2"] },
        ],
      },
      {
        t: "Para",
        c: [{ t: "Image", c: [["", [], []], [], ["assets/figure.png", ""]] }],
      },
      { t: "CodeBlock", c: [["", ["mermaid"], []], "graph LR; A-->B"] },
    ],
  };
  const files = new Map<string, string>();
  const runs: string[][] = [];
  const controller = new AbortController();
  const ports: PaperPorts = {
    path: (...names) => `/job with spaces/${names.join("/")}`,
    writeText: async (path, source) => {
      files.set(path, source);
    },
    readText: async (path) => files.get(path)!,
    readBytes: async () => new Uint8Array([0x50, 0x4b, 3, 4, 1]),
    run: async (args) => {
      runs.push(args);
      if (runs.length === 1)
        files.set(ports.path("manuscript.json"), JSON.stringify(ast));
    },
    reference: async (id) => ({
      id,
      type: "article-journal",
      title: "A reference",
    }),
    image: async () => png,
    diagram: async () => png,
  };
  return { ports, controller, runs, files, ast };
}

test("paper conversion preserves citations and math, embeds prepared figures and uses explicit styles", async () => {
  const { ports, controller, files, runs } = fixture();
  const bytes = await convertPaper(
    {
      source: "Latest unsaved manuscript",
      csl: "/styles/apa.csl",
      referenceDoc: "/styles/School template.docx",
      signal: controller.signal,
    },
    ports,
  );
  assert.equal(bytes[0], 0x50);
  assert.equal(
    files.get(ports.path("manuscript.md")),
    "Latest unsaved manuscript",
  );
  const prepared = JSON.parse(files.get(ports.path("manuscript.json"))!);
  assert.deepEqual(Object.keys(prepared.meta), ["title"]);
  assert.equal(prepared.blocks[0].c[0].c[0][0].citationSuffix[0].c, "p. 23");
  assert.equal(prepared.blocks[0].c[1].c[1], "x^2");
  assert.equal(prepared.blocks[1].c[0].c[2][0], png);
  assert.equal(prepared.blocks[2].c[0].t, "Image");
  assert.equal(
    JSON.parse(files.get(ports.path("references.json"))!)[0].id,
    "zotero-user-ABCD1234",
  );
  assert.ok(runs[1].includes("--citeproc"));
  assert.equal(
    runs[1][runs[1].indexOf("--reference-doc") + 1],
    "/styles/School template.docx",
  );
});

test("unresolved references or missing figures stop conversion instead of producing incomplete papers", async () => {
  for (const kind of ["citation", "image"] as const) {
    const { ports, controller, runs } = fixture();
    if (kind === "citation") ports.reference = async () => null;
    else
      ports.image = async () => {
        throw new Error("Missing file");
      };
    await assert.rejects(
      convertPaper({ source: "draft", signal: controller.signal }, ports),
      (error: unknown) =>
        error instanceof PaperExportError && error.code === kind,
    );
    assert.equal(runs.length, 1);
  }
});

test("cancellation during figure preparation never starts DOCX conversion", async () => {
  const { ports, controller, runs } = fixture();
  ports.image = async () => {
    controller.abort();
    return png;
  };
  await assert.rejects(
    convertPaper({ source: "draft", signal: controller.signal }, ports),
    { name: "AbortError" },
  );
  assert.equal(runs.length, 1);
});

test("failed Pandoc output cannot masquerade as a completed DOCX", async () => {
  const { ports, controller } = fixture();
  ports.readBytes = async () => new Uint8Array();
  await assert.rejects(
    convertPaper({ source: "draft", signal: controller.signal }, ports),
    (error: unknown) =>
      error instanceof PaperExportError && error.code === "conversion",
  );
});

test("publication keeps an externally changed Word file and refuses a cancelled session", async () => {
  let target = new Uint8Array([2]);
  const baseline = new Uint8Array([1]);
  const write = async (bytes: Uint8Array) => {
    target = bytes;
  };
  await assert.rejects(
    publishPaper(new Uint8Array([3]), baseline, {
      read: async () => target,
      write,
      assertCurrent() {},
    }),
    (error: unknown) =>
      error instanceof PaperExportError && error.code === "conflict",
  );
  assert.deepEqual([...target], [2]);
  await assert.rejects(
    publishPaper(new Uint8Array([3]), target, {
      read: async () => target,
      write,
      assertCurrent() {
        throw new Error("Closed");
      },
    }),
    /Closed/,
  );
  assert.deepEqual([...target], [2]);
  await publishPaper(new Uint8Array([3]), target, {
    read: async () => target,
    write,
    assertCurrent() {},
  });
  assert.deepEqual([...target], [3]);
});

test("portable citation keys distinguish the personal library and groups", () => {
  assert.deepEqual(parseCitationKey(citationKey("user", "ABCD1234")), {
    library: "user",
    key: "ABCD1234",
  });
  assert.deepEqual(parseCitationKey(citationKey(42, "ABCD1234")), {
    library: 42,
    key: "ABCD1234",
  });
  assert.equal(parseCitationKey("ordinary-citekey"), null);
  assert.equal(parseCitationKey("zotero-group-0-ABCD1234"), null);
});

test("editor HTML and wiki figures normalize while code examples stay literal", async () => {
  const { paperMarkdown } =
    await import("../src/modules/markdown/paper/export.ts");
  const source =
    '<img src="assets/plot.png" alt="A plot" width="300">\n\n![[plot.png|200]]\n\n```html\n<img src="example.png">\n```';
  const result = paperMarkdown(source);
  assert.ok(result.startsWith("![A plot](<assets/plot.png>){width=300px}"));
  assert.match(result, /!\[plot.png\]\(<assets\/plot.png>\)\{width=200px\}/);
  assert.ok(result.endsWith('```html\n<img src="example.png">\n```'));
});

test("unsupported raw HTML is reported instead of silently dropping manuscript content", async () => {
  const { ports, controller, ast, runs } = fixture();
  ast.blocks.push({
    t: "RawBlock",
    c: ["html", "<table><tr><td>Important result</td></tr></table>"],
  } as never);
  await assert.rejects(
    convertPaper({ source: "draft", signal: controller.signal }, ports),
    (error: unknown) =>
      error instanceof PaperExportError && error.code === "unsupported",
  );
  assert.equal(runs.length, 1);
});
