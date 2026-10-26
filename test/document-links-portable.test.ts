import assert from "node:assert/strict";
import test from "node:test";
import MarkdownIt from "markdown-it";
import {
  extractNoteLinks,
  formatNoteLink,
  noteHeadingPosition,
  noteHeadings,
  noteIgnoredRanges,
  noteLinkExcerpt,
  noteLinkLabel,
  parseNoteLink,
  portableNoteFilename,
  resolveNoteLink,
  type PortableNote,
} from "../src/modules/markdown/note-links.ts";

const note: PortableNote = {
  libraryID: 1,
  key: "AB12CD34",
  filename: "zmd-Research Notes.md",
  title: "Research Notes",
};

test("portable names and links always carry the attachment key", () => {
  assert.equal(portableNoteFilename(note), "Research-Notes--AB12CD34.md");
  assert.equal(
    formatNoteLink(note),
    "[[Research-Notes--AB12CD34|Research Notes]]",
  );
  assert.equal(
    formatNoteLink(note, { format: "markdown", heading: "Results" }),
    "[Research Notes](Research-Notes--AB12CD34.md#Results)",
  );
  assert.equal(
    formatNoteLink(note, { heading: "方法 Results", label: "方法" }),
    "[[Research-Notes--AB12CD34#方法 Results|方法]]",
  );
  assert.equal(parseNoteLink("[[#100%]]")?.heading, "100%");
  assert.deepEqual(
    parseNoteLink("Research-Notes--AB12CD34.md#Results%20Table"),
    {
      target: "Research-Notes--AB12CD34.md",
      heading: "Results Table",
      syntax: "markdown",
    },
  );
  assert.deepEqual(parseNoteLink("[[#Results]]"), {
    target: "",
    heading: "Results",
    syntax: "wiki",
  });
  const labelled = formatNoteLink(note, { label: "A|B]" });
  assert.deepEqual(parseNoteLink(labelled)?.label, "A|B]");
  assert.match(
    formatNoteLink({ ...note, filename: "zmd-A#^[]%.md" }),
    /^\[\[A--AB12CD34\|Research Notes\]\]$/,
  );
});

test("resolves renamed stable links and rejects unsafe destinations", () => {
  const renamed = { ...note, filename: "zmd-Renamed.md", title: "Renamed" };
  assert.deepEqual(resolveNoteLink("[[Old Name--AB12CD34]]", note, [renamed]), {
    status: "resolved",
    note: renamed,
  });
  assert.equal(
    resolveNoteLink("[[renamed]]", note, [renamed]).status,
    "resolved",
  );
  assert.deepEqual(resolveNoteLink("#Results", note, [renamed]), {
    status: "resolved",
    note,
    heading: "Results",
  });
  assert.equal(
    resolveNoteLink("[[Note#^block]]", note, [renamed]).status,
    "unsupported",
  );
  assert.equal(
    resolveNoteLink("[[Note#%5Eblock]]", note, [renamed]).status,
    "unsupported",
  );
  assert.equal(
    resolveNoteLink("https://example.com", note, [renamed]).status,
    "unsupported",
  );
  assert.equal(
    resolveNoteLink("zotero://select/library/items/AB12CD34", note, [note])
      .status,
    "resolved",
  );
});

test("extracts only real links and preserves source offsets", () => {
  const source = [
    "---",
    "title: hidden",
    "---",
    "",
    "`[[inline]]` [[Visible|label]] [old](zotero://select/library/items/AB12CD34)",
    "![[image.png]] ![image](image.png) \\[[escaped]]",
    "```md",
    "[[fenced]] [fenced](fenced.md)",
    "```",
    "    [[indented]]",
  ].join("\n");
  const links = extractNoteLinks(source);
  assert.deepEqual(
    links.map(({ href, label, syntax, from, to }) => ({
      href,
      label,
      syntax,
      text: source.slice(from, to),
    })),
    [
      {
        href: "[[Visible|label]]",
        label: "label",
        syntax: "wiki",
        text: "[[Visible|label]]",
      },
      {
        href: "zotero://select/library/items/AB12CD34",
        label: "old",
        syntax: "markdown",
        text: "[old](zotero://select/library/items/AB12CD34)",
      },
    ],
  );
  assert.deepEqual(
    noteIgnoredRanges(source).map(({ from, to }) => source.slice(from, to)),
    [
      "---\ntitle: hidden\n---",
      "`[[inline]]`",
      "```md\n[[fenced]] [fenced](fenced.md)\n```",
      "[[indented]]",
    ],
  );
  assert.deepEqual(extractNoteLinks("<!-- [[hidden]] -->"), []);
  assert.deepEqual(extractNoteLinks("[outer [inner](Note.md)](missing.md)"), [
    {
      from: 7,
      to: 23,
      href: "Note.md",
      label: "inner",
      syntax: "markdown",
    },
  ]);
});

test("finds headings outside frontmatter and code, including slug anchors", () => {
  const source = [
    "---",
    "# hidden",
    "---",
    "```md",
    "# hidden code",
    "```",
    "# Visible **Heading**",
    "",
    "Setext heading",
    "--------------",
    "# Visible Heading",
  ].join("\n");
  assert.deepEqual(noteHeadings(source), [
    {
      text: "Visible Heading",
      from: source.indexOf("# Visible **Heading**"),
      level: 1,
    },
    {
      text: "Setext heading",
      from: source.indexOf("Setext heading"),
      level: 2,
    },
    {
      text: "Visible Heading",
      from: source.lastIndexOf("# Visible Heading"),
      level: 1,
    },
  ]);
  assert.equal(
    noteHeadingPosition(source, "visible-heading"),
    source.indexOf("# Visible **Heading**"),
  );
  assert.equal(
    noteHeadingPosition(source, "visible-heading-1"),
    source.lastIndexOf("# Visible Heading"),
  );
});

test("reference labels keep aliases and hide portable storage identifiers", () => {
  const links = extractNoteLinks(
    "[[folder/zmd-Research%20Notes--AB12CD34.md#Results]] " +
      "[[Research--AB12CD34|**Preferred** label]] " +
      "[Paper **title**](zotero://select/library/items/CD34EF56) " +
      "[zotero://select/library/items/CD34EF56](zotero://select/library/items/CD34EF56) " +
      "[[#Methods]]",
  );
  assert.deepEqual(links.map(noteLinkLabel), [
    "Research Notes › Results",
    "Preferred label",
    "Paper title",
    "",
    "Methods",
  ]);
});

test("reference excerpts stay centered on a late mention and hide nearby link destinations", () => {
  const source =
    "前文".repeat(200) +
    " 参见 [[zmd-Related--CD34EF56|相关笔记]]，本节讨论 " +
    "[[zmd-Research--AB12CD34.md#Results]] 与 " +
    "[论文 **分析**](zotero://select/library/items/EF56GH78) 的联系。" +
    "后文".repeat(200);
  const links = extractNoteLinks(source);
  const originalPosition = links[1].from;
  const excerpt = noteLinkExcerpt(source, links[1], links);
  assert.match(
    excerpt,
    /相关笔记，本节讨论 Research › Results 与 论文 分析 的联系/,
  );
  assert.doesNotMatch(
    excerpt,
    /\[\[|\]\]|zmd-|AB12CD34|CD34EF56|EF56GH78|zotero:\/\/|\*\*/,
  );
  assert.equal(excerpt.startsWith("…"), true);
  assert.equal(excerpt.endsWith("…"), true);
  assert.ok(Array.from(excerpt).length <= 240);
  assert.equal(links[1].from, originalPosition);
  assert.equal(
    source.slice(links[1].from, links[1].to),
    "[[zmd-Research--AB12CD34.md#Results]]",
  );
});

test("reference excerpts preserve readable Markdown and an alias without adding unrelated lines", () => {
  const source =
    "Previous line is unrelated\n**See [[Research--AB12CD34|this result]]** and `x + y`.\nNext line";
  const links = extractNoteLinks(source);
  assert.equal(
    noteLinkExcerpt(source, links[0], links),
    "See this result and x + y.",
  );
});

test("keeps literal heading punctuation while applying Markdown semantics", () => {
  assert.deepEqual(noteHeadings("# api_version\n# a\\*b\n"), [
    { text: "api_version", from: 0, level: 1 },
    { text: "a*b", from: 14, level: 1 },
  ]);
});

test("keeps all visible Setext heading lines", () => {
  const source = "first **line**\nsecond [line](target.md)\n-----------\n";
  assert.deepEqual(noteHeadings(source), [
    { text: "first line second line", from: 0, level: 2 },
  ]);
  assert.equal(noteHeadingPosition(source, "first-line-second-line"), 0);
});

test("serializes reserved headings, labels, and paths into valid links", () => {
  const markdown = new MarkdownIt();
  for (const heading of ["100%", "A|B", "A]B"]) {
    const wiki = formatNoteLink(note, { heading });
    const parsed = parseNoteLink(wiki);
    assert.equal(parsed?.heading, heading);
  }

  const special: PortableNote = {
    ...note,
    filename: "zmd-A).md",
    title: "A [B]",
  };
  const formatted = formatNoteLink(special, { format: "markdown" });
  const extracted = extractNoteLinks(formatted);
  assert.equal(extracted.length, 1);
  assert.deepEqual(parseNoteLink(extracted[0].href), {
    target: "A)--AB12CD34.md",
    syntax: "markdown",
  });
  assert.match(
    markdown.render(formatted),
    /<a href="A%29--AB12CD34\.md">A \[B\]<\/a>/,
  );
});
