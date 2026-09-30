import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEMIRROR_CODE_LANGUAGES,
  resolveCodeMirrorLanguage,
} from "../src/editor/code-languages.ts";
import {
  fenceLanguageToken,
  normalizeFenceLanguage,
} from "../src/modules/markdown/code-language-aliases.ts";

test("normalizes supported fenced-code language aliases", () => {
  assert.equal(normalizeFenceLanguage("js"), "javascript");
  assert.equal(normalizeFenceLanguage("TSX"), "typescript");
  assert.equal(normalizeFenceLanguage("xml"), "html");
  assert.equal(normalizeFenceLanguage("sh"), "bash");
  assert.equal(normalizeFenceLanguage("c++"), "cpp");
  assert.equal(normalizeFenceLanguage("rs"), "rust");
});

test("uses only the first fence info token", () => {
  assert.equal(fenceLanguageToken('  js title="demo"  '), "js");
  assert.equal(normalizeFenceLanguage('js title="demo"'), "javascript");
});

test("returns null for empty and unsupported languages", () => {
  assert.equal(normalizeFenceLanguage(""), null);
  assert.equal(normalizeFenceLanguage("brainfuck"), null);
});

test("resolves CodeMirror descriptions from aliases", () => {
  assert.match(resolveCodeMirrorLanguage("js")?.name || "", /javascript/i);
  assert.match(resolveCodeMirrorLanguage("py")?.name || "", /python/i);
  assert.equal(resolveCodeMirrorLanguage("brainfuck"), null);
});

test("registers only the supported CodeMirror language descriptions", () => {
  assert.deepEqual(
    CODEMIRROR_CODE_LANGUAGES.map((language) => language.name),
    [
      "JavaScript",
      "JSX",
      "TypeScript",
      "TSX",
      "JSON",
      "HTML",
      "CSS",
      "YAML",
      "Markdown",
      "Shell",
      "SQL",
      "Python",
      "Java",
      "C",
      "C++",
      "Go",
      "Rust",
    ],
  );
});

test("loads a parser for a supported fenced language", async () => {
  const language = resolveCodeMirrorLanguage("js");
  assert.ok(language);
  const support = await language.load();
  const tree = support.language.parser.parse("const answer = 42;");

  assert.match(tree.toString(), /Variable(Definition|Name)/);
  assert.match(tree.toString(), /Number/);
});

test("highlights a JavaScript fence inside the Markdown syntax tree", async () => {
  const { EditorState } = await import("@codemirror/state");
  const { markdown } = await import("@codemirror/lang-markdown");
  const { ensureSyntaxTree, highlightingFor } =
    await import("@codemirror/language");
  const { highlightTree } = await import("@lezer/highlight");
  const { codeSyntaxHighlighting } = await import("../src/editor/theme.ts");
  await resolveCodeMirrorLanguage("js")!.load();
  const doc =
    '```js\nimport { Crepe } from "@milkdown/crepe";\n// Test syntax\nconst answer = 42;\n```';
  for (const theme of ["light", "dark"] as const) {
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ codeLanguages: resolveCodeMirrorLanguage }),
        codeSyntaxHighlighting(theme),
      ],
    });
    const tree = ensureSyntaxTree(state, doc.length, 1000);
    assert.ok(tree);
    const colored: string[] = [];
    highlightTree(
      tree,
      {
        style: (tags) => highlightingFor(state, tags),
      },
      (from, to) => colored.push(doc.slice(from, to)),
    );
    for (const token of [
      "import",
      '"@milkdown/crepe"',
      "// Test syntax",
      "42",
    ]) {
      assert.ok(
        colored.includes(token),
        `${theme}: missing color for ${token}`,
      );
    }
  }
});
