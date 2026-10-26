# Unified Note Templates Implementation Plan

> Storage revision (2026-10-26): the SyncedSettings design below is superseded. Zotero rejects custom setting keys; templates now use local plugin preferences, with existing templates transferred before the old setting is removed. See [current architecture](../../architecture.md#note-templates) and [migration safety](../../file-safety.md#旧版同步设置迁移). The remaining card/template design is unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace persisted Question and Claim nodes with styled Note templates, add reusable custom Note templates, and synchronize the custom template registry through Zotero.

**Architecture:** The pure whiteboard model owns Note badge validation, built-in templates, custom-template validation, and copy-on-create/apply functions. The iframe owns template selection and editing UI but persists no registry state; a typed postMessage bridge delegates registry mutations to a host-owned Zotero `SyncedSettings` adapter. Canvas nodes always contain resolved style, badge, content, and size, so rendering never depends on the template registry.

**Tech Stack:** TypeScript, React, `@xyflow/react`, Node test runner through `tsx`, Zotero 7 `SyncedSettings`, Fluent localization, pnpm.

## Global Constraints

- Keep `literature`, `quote`, `note`, and `frame` as the academic node kinds, plus retained basic drawing objects.
- Question and Claim are built-in Note templates, never persisted node kinds.
- Existing experimental `question` and `claim` records are rejected; no migration or compatibility parser is added.
- Applying a template to an existing Note preserves content, source identity, source snapshot, position, frame membership, connections, and extensions.
- A canvas can parse, render, edit, and save without a template registry.
- Templates accept typed canvas styles only; no arbitrary CSS, HTML, scripts, URLs, variables, or executable content.
- Custom templates are scoped to the current Zotero user library and continue to work locally when sync is disabled.
- Preserve all pre-existing uncommitted academic-source workflow changes in this worktree.

---

### Task 1: Collapse the persisted academic schema to Note

**Files:**

- Modify: `packages/whiteboard/src/model/academic.ts`
- Modify: `packages/whiteboard/src/model/document.ts`
- Modify: `packages/whiteboard/src/model/canvas-file.ts`
- Modify: `packages/whiteboard/src/nodes/academic.tsx`
- Modify: `packages/whiteboard/src/nodes/registry.ts`
- Modify: `packages/whiteboard/src/whiteboard/document.ts`
- Modify: `packages/whiteboard/src/whiteboard/export.ts`
- Test: `test/whiteboard-academic-model.test.ts`
- Test: `test/whiteboard-academic-document.test.ts`
- Test: `test/whiteboard-canvas-file.test.ts`
- Test: `test/whiteboard-node-registry.test.ts`
- Test: `test/whiteboard-export.test.ts`

**Interfaces:**

- Produces: `NoteNode.badge?: string`, `AcademicNodeKind = "literature" | "quote" | "note" | "frame"`.
- Produces: `createAcademicNode("note", position, id, options?: NoteNodeOptions): NoteNode`.
- Consumes: existing `CanvasNodeStyle`, canvas parser, JSON Canvas codec, React node registry, and export adapters.

- [ ] **Step 1: Write failing model and parser tests**

Add assertions that `createAcademicNode("note", ..., { badge: "问题", content: "Why?" })` returns a Note with the badge, parsing preserves a string badge, malformed badge values drop the node, and persisted `question`/`claim` nodes are reported as malformed.

```ts
const note = createAcademicNode("note", { x: 10, y: 20 }, "note-1", {
  badge: "问题",
  content: "Why?",
});
assert.equal(note.kind, "note");
assert.equal(note.badge, "问题");
assert.equal(note.content, "Why?");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec tsx --test test/whiteboard-academic-model.test.ts test/whiteboard-academic-document.test.ts test/whiteboard-canvas-file.test.ts test/whiteboard-node-registry.test.ts test/whiteboard-export.test.ts
```

Expected: typecheck/runtime failures because `NoteNodeOptions` and `badge` support do not exist and Question/Claim are still accepted.

- [ ] **Step 3: Implement the minimal schema collapse**

Remove `QuestionNode`, `ClaimNode`, their parser/codec/renderer/registry cases, and their text/export branches. Add a closed optional badge parser and Note factory options:

```ts
export interface NoteNodeOptions {
  content?: string;
  badge?: string;
  style?: CanvasNodeStyle;
  width?: number;
  height?: number;
}
```

The Note parser copies only an own string badge. Update demo data and tests that merely need generic movable nodes to use styled Notes rather than preserving retired kinds.

- [ ] **Step 4: Render a badge as plain text**

Render `model.badge` inside the existing Note card header, with a dedicated class and no behavioral branch. Add restrained CSS using the current surface/text tokens and ensure the Note kind remains available to screen readers.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all listed tests pass with zero failures.

### Task 2: Add a pure Note-template domain module

**Files:**

- Create: `packages/whiteboard/src/model/note-template.ts`
- Modify: `packages/whiteboard/src/model/index.ts`
- Modify: `packages/whiteboard/src/index.ts`
- Test: `test/whiteboard-note-template.test.ts`
- Test: `test/whiteboard-public-api.typecheck.ts`

**Interfaces:**

- Produces: `NoteTemplate`, `BUILTIN_NOTE_TEMPLATES`, `parseNoteTemplate`, `parseNoteTemplateRegistry`, `materializeNoteTemplate`, `applyNoteTemplate`, `createCustomNoteTemplate`.
- Consumes: `CanvasNodeStyle`, `CanvasPoint`, `NoteNode`, and the Note factory from Task 1.

- [ ] **Step 1: Write failing template behavior tests**

Cover the three stable built-ins, defensive parsing, style allowlisting, size validation, starter content on creation, content/source preservation on apply, fresh object copies, and custom-template capture.

```ts
const next = applyNoteTemplate(sourceBackedNote, questionTemplate);
assert.equal(next.content, sourceBackedNote.content);
assert.deepEqual(next.source, sourceBackedNote.source);
assert.equal(next.badge, "问题");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec tsx --test test/whiteboard-note-template.test.ts test/whiteboard-public-api.typecheck.ts
```

Expected: module import failure for `model/note-template`.

- [ ] **Step 3: Implement the minimal pure template module**

Use this public shape:

```ts
export interface NoteTemplate {
  id: string;
  name: string;
  badge?: string;
  initialContent?: string;
  style: CanvasNodeStyle;
  defaultSize?: { width: number; height: number };
  sortOrder?: number;
  updatedAt: string;
}
```

Clamp badge/name/content lengths at the module boundary, accept only known style keys and enum values, and deep-copy all returned style/size records. Built-ins use IDs `bamboo.note`, `bamboo.question`, and `bamboo.claim` with Note as the neutral default.

- [ ] **Step 4: Implement copy-on-create and safe apply**

`materializeNoteTemplate(template, position, id)` creates a standalone Note with copied final properties. `applyNoteTemplate(note, template)` replaces only badge, supported style, width, and height while spreading all other Note fields unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass with zero failures.

### Task 3: Replace type buttons with a Note-template workflow

**Files:**

- Modify: `packages/whiteboard/src/chrome/tools.ts`
- Modify: `packages/whiteboard/src/chrome/TopIsland.tsx`
- Create: `packages/whiteboard/src/chrome/NoteTemplateControls.tsx`
- Modify: `packages/whiteboard/src/chrome/PropertiesPanel.tsx`
- Modify: `packages/whiteboard/src/whiteboard/app.tsx`
- Modify: `packages/whiteboard/src/whiteboard/icons.tsx`
- Modify: `packages/whiteboard/src/whiteboard/board.css`
- Modify: `packages/whiteboard/src/chrome/shortcuts.ts`
- Test: `test/whiteboard-draw.test.ts`
- Test: `test/whiteboard-toolbar.test.ts`
- Test: `test/whiteboard-node-registry.test.ts`
- Test: `test/whiteboard-app-state.test.ts`

**Interfaces:**

- Consumes: `NoteTemplate[]`, `materializeNoteTemplate`, and `applyNoteTemplate` from Task 2.
- Produces: `WhiteboardAppProps.templates`, `onSaveNoteTemplate`, `onDeleteNoteTemplate`; `WhiteboardRuntime.setTemplates`.

- [ ] **Step 1: Write failing toolbar and runtime tests**

Assert that the toolbar has one Note creation control, its menu lists Note/Question/Claim templates, Q and C select templates rather than node kinds, template placement persists a Note, and applying a template is one history mutation that preserves content/source.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec tsx --test test/whiteboard-draw.test.ts test/whiteboard-toolbar.test.ts test/whiteboard-node-registry.test.ts test/whiteboard-app-state.test.ts
```

Expected: failures because the toolbar still exposes Question/Claim tools and the runtime has no template state.

- [ ] **Step 3: Implement template-aware Note placement**

Keep `activeTool` equal to `"note"` and store a separate `activeNoteTemplateId`. Q and C shortcuts select `bamboo.question` and `bamboo.claim`. Canvas placement resolves the selected template and calls `materializeNoteTemplate`; unknown IDs fall back to `bamboo.note`.

- [ ] **Step 4: Implement compact creation and selected-Note controls**

The toolbar Note button remains the primary placement action and has an adjacent menu trigger. The anchored menu lists built-ins first and custom templates after them. The selected-Note properties panel exposes badge editing, an Apply template select, and an inline Save as template form with name and Include current content checkbox. Custom rows expose rename/duplicate/delete only inside the same progressive panel, with keyboard focus and visible labels.

- [ ] **Step 5: Implement canvas mutations and optimistic registry requests**

Applying a template routes through the existing `updateNode` history boundary. Saving captures only supported Note style, current rendered dimensions, optional content, badge, generated UUID, and ISO timestamp. Deleting or saving updates local template UI immediately and invokes the host callbacks; host updates later replace the custom portion through `setTemplates`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass with zero failures.

### Task 4: Add a typed Zotero-synced template repository

**Files:**

- Create: `src/modules/whiteboard/template-repository.ts`
- Modify: `packages/whiteboard/src/model/protocol.ts`
- Modify: `packages/whiteboard/src/bootstrap.tsx`
- Modify: `packages/whiteboard/src/bootstrapState.ts`
- Modify: `src/modules/whiteboard/protocol.ts`
- Modify: `src/modules/whiteboard/editor.ts`
- Modify: `src/modules/whiteboard/tab.ts`
- Modify: `src/modules/whiteboard/session-registry.ts`
- Test: `test/whiteboard-template-repository.test.ts`
- Test: `test/whiteboard-protocol.test.ts`
- Test: `test/whiteboard-bootstrap.test.ts`
- Test: `test/whiteboard-session-registry.test.ts`

**Interfaces:**

- Consumes: validated custom `NoteTemplate` records from Task 2.
- Produces: host `NoteTemplateRepository` with `list`, `save`, `remove`, `subscribe`; protocol arms `noteTemplatesChanged`, `saveNoteTemplate`, and `deleteNoteTemplate`.

- [ ] **Step 1: Write failing repository and bridge tests**

Use injected fake synced-settings dependencies. Cover local list/save/delete, malformed record filtering, per-ID merge, newer same-ID selection, conflict-copy retention for equal-time divergent records, notification fan-out, init payloads, and strict rejection of malformed protocol data.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec tsx --test test/whiteboard-template-repository.test.ts test/whiteboard-protocol.test.ts test/whiteboard-bootstrap.test.ts test/whiteboard-session-registry.test.ts
```

Expected: module import and missing protocol-arm failures.

- [ ] **Step 3: Implement the repository over one Zotero setting**

Use setting name `bamboo.noteTemplates.v1` in `Zotero.Libraries.userLibraryID`. Store a versioned registry whose `records` map is keyed by template UUID; deletion writes a timestamped tombstone. `onSyncDownload` merges old and remote registries per ID, writes a merged unsynced value only when needed, and notifies subscribers. The production adapter accesses `Zotero.SyncedSettings` through a narrow local structural type because current `zotero-types` does not declare it.

- [ ] **Step 4: Add strict protocol messages**

Include validated templates in init, forward synchronized updates to `runtime.setTemplates`, and route save/delete requests from iframe to host callbacks. Keep every new message in the protocol's exhaustive active-type maps and strict own-field validators.

- [ ] **Step 5: Wire repository lifecycle to whiteboard sessions**

Create one shared repository service, subscribe each open session, send current templates in init, and unsubscribe on session disposal. Save/delete failures log diagnostics and send the prior authoritative template list back to the iframe without affecting canvas state.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass with zero failures.

### Task 5: Localize, document, and verify the complete feature

**Files:**

- Modify: `addon/locale/en-US/zotero-markdown.ftl`
- Modify: `addon/locale/zh-CN/zotero-markdown.ftl`
- Modify: `packages/whiteboard/src/model/protocol.ts`
- Modify: `src/modules/whiteboard/tab.ts`
- Modify: `test/whiteboard-localization.test.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/superpowers/specs/2026-09-03-academic-canvas-schema-design.md`
- Modify: `docs/superpowers/specs/2026-09-04-zotero-academic-source-workflows-design.md`
- Modify: `docs/superpowers/specs/2026-08-28-bamboo-research-canvas-free-design.md`
- Create: `docs/superpowers/specs/2026-09-06-unified-note-templates-design.md`

**Interfaces:**

- Consumes: all feature labels and public behavior from Tasks 1 through 4.
- Produces: complete English/Chinese UI copy and current architecture documentation.

- [ ] **Step 1: Write failing localization coverage**

Require labels for template menu, built-in names, badge, apply, save as template, include content, rename, duplicate, delete confirmation, empty custom list, sync unavailable, and conflict copy.

- [ ] **Step 2: Run localization tests and verify RED**

Run:

```bash
pnpm exec tsx --test test/whiteboard-localization.test.ts
```

Expected: missing Fluent keys and label mapping failures.

- [ ] **Step 3: Add concise bilingual copy and update architecture docs**

Remove retired Question/Claim node-kind labels and describe them as templates. Record that template definitions sync separately while canvas Notes remain self-contained. Copy the confirmed design spec into this feature branch and add revision pointers to superseded documents.

- [ ] **Step 4: Run all whiteboard tests**

Run:

```bash
pnpm exec tsx --test test/whiteboard-*.test.ts
```

Expected: zero failures.

- [ ] **Step 5: Run typecheck, production build, lint, and diff checks**

Run:

```bash
pnpm exec tsc --noEmit
pnpm whiteboard:build
pnpm lint:check
git diff --check
```

Expected: all commands exit 0. If repository-wide formatting reports pre-existing changes, format only files touched by this plan and rerun the focused checks plus `git diff --check`.
