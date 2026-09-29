import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TopIsland } from "../packages/whiteboard/src/chrome/TopIsland.tsx";
import { libraryTools } from "../packages/whiteboard/src/chrome/tools.ts";
import type { WhiteboardLabels } from "../packages/whiteboard/src/model/protocol.ts";
import { createBuiltinNoteTemplates } from "../packages/whiteboard/src/model/note-template.ts";

const css = readFileSync(
  new URL("../packages/whiteboard/src/whiteboard/board.css", import.meta.url),
  "utf8",
);

const labels = new Proxy({} as WhiteboardLabels, {
  get: (_target, property) => String(property),
});

function renderToolbar(selectedNodeCount: number, selectedEdgeCount: number) {
  return renderToStaticMarkup(
    createElement(TopIsland, {
      labels,
      activeTool: "select",
      onSelectTool: () => {},
      noteTemplates: createBuiltinNoteTemplates({
        note: "Note",
        question: "Question",
        claim: "Claim",
        evidence: "Evidence",
        summary: "Summary",
      }),
      activeNoteTemplateId: "bamboo.note",
      onSelectNoteTemplate: () => {},
      saveState: "saved",
      selectedNodeCount,
      selectedEdgeCount,
      onUndo: () => {},
      onRedo: () => {},
      onAddFile: () => {},
      onSave: () => {},
      onFitView: () => {},
      onAutoLayout: () => {},
      onAlign: () => {},
      onDistribute: () => {},
      onOpenShortcuts: () => {},
    }),
  );
}

function commandGroup(markup: string, command: string) {
  return markup
    .match(/<div class="zmd-board-top-group(?: [^"]+)?">[\s\S]*?<\/div>/g)
    ?.find((group) => group.includes(`title="${command}"`));
}

test("toolbar keeps resident tools compact and conditional commands reachable", () => {
  const base = css.match(/\.zmd-board-top-island\s*\{([^}]*)\}/)?.[1];
  assert.ok(base, "missing base toolbar rule");
  assert.match(base, /flex-wrap:\s*nowrap/);

  const compact = css.match(
    /@media \(max-width: 640px\) \{([\s\S]+)\}\s*$/,
  )?.[1];
  assert.ok(compact, "missing narrow-toolbar media query");
  assert.match(
    compact,
    /\.zmd-board-top-island\s*\{[^}]*max-width:\s*calc\(100% - 16px\)/s,
  );
  assert.match(compact, /\.zmd-board-top-island\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(compact, /\.zmd-board-top-group\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(compact, /\.zmd-board-properties\s*\{[^}]*top:\s*56px/s);
  assert.match(
    compact,
    /\.zmd-board-properties\s*\{[^}]*left:\s*8px[^}]*right:\s*8px/s,
  );
  assert.match(
    compact,
    /\.zmd-board-properties\s*\{[^}]*width:\s*auto[^}]*max-height:\s*calc\(100% - 64px\)[^}]*overflow-y:\s*auto/s,
  );

  assert.doesNotMatch(renderToolbar(3, 1), /title="alignLeft"/);
  assert.doesNotMatch(renderToolbar(3, 1), /title="edgeColor"/);
  assert.doesNotMatch(renderToolbar(0, 0), /zmd-board-side-island/);
  assert.match(renderToolbar(0, 0), /zmd-board-draw-tools/);
});

test("toolbar groups file creation with a single note picker", () => {
  const markup = renderToolbar(0, 0);
  const academicGroup = commandGroup(markup, "addNote");
  assert.ok(academicGroup, "local academic tools need one toolbar group");
  assert.ok(academicGroup.includes('title="addFile"'));
  assert.equal(markup.match(/title="addNote"/g)?.length, 1);
  assert.equal(markup.match(/title="addFile"/g)?.length, 1);
  assert.match(markup, /title="addFrame \(F\)"/);
  assert.doesNotMatch(academicGroup, /addQuestion \(Q\)|addClaim \(C\)/);
  assert.doesNotMatch(academicGroup, /<select/);
  assert.match(academicGroup, /class="zmd-board-template-trigger"/);
  assert.match(academicGroup, /aria-haspopup="menu"/);
  assert.match(academicGroup, />Note</);
  assert.doesNotMatch(markup, /kindLiterature|kindQuote/);
});

test("optional selection actions stay hidden until wired and then expose labels", () => {
  const base = renderToolbar(2, 0);
  assert.doesNotMatch(base, /title="groupSelection"/);
  assert.doesNotMatch(base, /title="fitSelection"/);
  const wired = renderToStaticMarkup(
    createElement(TopIsland, {
      labels,
      activeTool: "select",
      onSelectTool: () => {},
      noteTemplates: createBuiltinNoteTemplates({
        note: "Note",
        question: "Question",
        claim: "Claim",
        evidence: "Evidence",
        summary: "Summary",
      }),
      activeNoteTemplateId: "bamboo.note",
      onSelectNoteTemplate: () => {},
      saveState: "saved",
      selectedNodeCount: 2,
      selectedEdgeCount: 0,
      onUndo: () => {},
      onRedo: () => {},
      onAddFile: () => {},
      onSave: () => {},
      onFitView: () => {},
      onFitSelection: () => {},
      onGroupSelection: () => {},
      onAutoLayout: () => {},
      onAlign: () => {},
      onDistribute: () => {},
      onOpenShortcuts: () => {},
    }),
  );
  assert.match(wired, /title="groupSelection"/);
  assert.match(wired, /title="fitSelection"/);
});

test("template picker uses the toolbar menu vocabulary", () => {
  assert.doesNotMatch(css, /\.zmd-board-template-picker\s*\{/);
  assert.match(
    css,
    /\.zmd-board-top-island \.zmd-board-template-trigger\s*\{[^}]*background:\s*transparent[^}]*color:\s*var\(--zmd-board-text/s,
  );
  assert.match(
    css,
    /\.zmd-board-template-trigger:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--zmd-board-accent/s,
  );
  assert.match(
    css,
    /\.zmd-board-template-menu,\s*\.zmd-board-more-menu,\s*\.zmd-board-draw-menu\s*\{[^}]*background:\s*var\(--zmd-board-surface[^}]*border:\s*1px solid var\(--zmd-board-border/s,
  );
  assert.match(
    css,
    /\.zmd-board-template-menu button\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--zmd-board-accent-soft/s,
  );
});

test("toolbar exposes a red Zotero entry for library materials", () => {
  const renderedToolbar = renderToStaticMarkup(
    createElement(TopIsland, {
      ...{
        labels: new Proxy({} as WhiteboardLabels, {
          get: (_target, property) =>
            property === "addItem"
              ? "Add Zotero materials"
              : property === "addPdf"
                ? "Add PDF"
                : property === "addFile"
                  ? "Add file"
                  : String(property),
        }),
      },
      activeTool: "select",
      onSelectTool: () => {},
      noteTemplates: createBuiltinNoteTemplates({
        note: "Note",
        question: "Question",
        claim: "Claim",
        evidence: "Evidence",
        summary: "Summary",
      }),
      activeNoteTemplateId: "bamboo.note",
      onSelectNoteTemplate: () => {},
      saveState: "saved",
      selectedNodeCount: 0,
      selectedEdgeCount: 0,
      onUndo: () => {},
      onRedo: () => {},
      onAddFile: () => {},
      onSave: () => {},
      onFitView: () => {},
      onAutoLayout: () => {},
      onAlign: () => {},
      onDistribute: () => {},
      onOpenShortcuts: () => {},
    }),
  );
  assert.deepEqual(libraryTools(), ["literature"]);
  assert.match(renderedToolbar, /title="Add Zotero materials"/);
  assert.match(renderedToolbar, /stroke="#cc2936"/);
  assert.doesNotMatch(renderedToolbar, /Add PDF/);
  assert.match(renderedToolbar, /Add file/);
});
