# Unified Academic Note and Templates Design

> Storage revision (2026-10-26): the SyncedSettings design below is superseded. Zotero rejects custom setting keys; templates now use local plugin preferences, with existing templates transferred before the old setting is removed. See [current architecture](../../architecture.md#note-templates) and [migration safety](../../file-safety.md#旧版同步设置迁移). The remaining card/template design is unchanged.

- Date: 2026-09-06
- Status: Confirmed
- Scope: Simplify academic authoring objects and add reusable Note templates
- Supersedes:
  - The separate `question` and `claim` node kinds in
    `2026-09-03-academic-canvas-schema-design.md`
  - The Question and Claim creation workflow described in
    `2026-08-28-bamboo-research-canvas-free-design.md`
- Product state: Unreleased; experimental canvas files do not require migration

## 1. Goal

Reduce the number of concepts a user must understand before writing on an
academic canvas, while preserving the ability to visually distinguish research
questions, claims, observations, hypotheses, and other user-defined meanings.

The canvas has one editable academic thought object, Note. Question and Claim
become built-in creation templates for Note instead of persisted node kinds.
Users can create reusable templates from any Note and use them across canvases
and devices connected to the same Zotero account.

Templates are creation shortcuts. They are not classes, schemas, or live style
dependencies.

## 2. Product Decisions

- Keep `literature`, `quote`, `note`, and `frame` as the academic node kinds.
- Keep the existing basic drawing objects.
- Remove `question` and `claim` from the persisted node union and creation API.
- Represent Question, Claim, and other user meanings through ordinary Notes
  with a short badge and visual style.
- Ship a small set of built-in templates: Note, Question, and Claim.
- Let users save a styled Note as a custom template.
- Make custom templates reusable across canvases and synchronize them across
  devices through the current Zotero user account.
- Copy all resolved template values into a node when creating or applying it.
- Never require a template registry to render an existing canvas.
- Allow optional template starter content for newly created Notes.
- Never overwrite an existing Note's content or Zotero source when applying a
  template.
- Expose a constrained style model rather than arbitrary CSS.
- Treat AI constraints as command validation and guidance, not additional
  persisted node types.

## 3. Simplified Academic Vocabulary

The authoring vocabulary is:

```text
Literature  source record from a Zotero Regular Item
Quote       source excerpt from a supported Zotero PDF Annotation
Note        any user-authored thought, including a question or claim
Frame       a spatial grouping region
```

Basic text, shape, line, and arrow objects remain available. Academic
relationships such as `related`, `supports`, and `contradicts` are unchanged.

The distinction between source material and user thinking remains structural:
Literature and Quote are source-backed; Note is user-authored. The distinction
between different forms of user thinking is intentionally lightweight and
user-controlled.

## 4. Note Model

The canonical Note model is:

```ts
interface NoteNode extends CanvasNodeBase {
  kind: "note";
  content: string;
  badge?: string;
  source?: NoteSource;
  sourceSnapshot?: NoteSourceSnapshot;
}
```

The existing `CanvasNodeBase.style` and geometry fields store the complete
appearance and size. `badge` is an optional, short visual label rendered near
the upper-left corner of the card.

The model does not persist a semantic subtype such as `question`, `claim`, or
`hypothesis`. It also does not require `templateId`. A producer may retain
nonessential provenance in an extension namespace in the future, but rendering,
editing, export, and validation must never depend on it.

### 4.1 Badge semantics

- A badge is display text, not a taxonomy or behavior switch.
- Notes without a badge are normal and fully supported.
- The first version renders at most one badge per Note.
- Badge text is length-limited and rendered as plain text.
- Changing or removing a badge does not change the Note's identity or content.

This avoids introducing a second tag system beside Zotero tags and avoids
encoding user research methodology into the core schema.

### 4.2 Zotero-backed Notes

A Zotero Note still imports as an ordinary Note with optional `source` and
`sourceSnapshot`. Import and explicit refresh behavior remain unchanged:

- content is copied into the canvas;
- later Zotero changes do not update it automatically;
- manual refresh warns that it will overwrite local content;
- styles, badge, layout, and connections survive a source refresh.

## 5. Template Model

Templates live outside canvas documents:

```ts
interface NoteTemplate {
  id: string;
  name: string;
  badge?: string;
  initialContent?: string;
  style: CanvasNodeStyle;
  defaultSize?: {
    width: number;
    height: number;
  };
  sortOrder?: number;
  updatedAt: string;
}
```

Built-in templates use stable product-owned IDs. Custom templates use UUIDs.
Template names need not be unique; identity is always the ID.

Only values supported by the canonical Note model may be stored. Templates
cannot contain scripts, arbitrary CSS, source references, node IDs, positions,
connections, or extension payloads.

`initialContent` is optional. It is copied only when a template creates a new
Note. It may contain Markdown-compatible text but does not execute commands or
resolve variables in the first version.

## 6. Copy-on-Create Semantics

Creating a Note from a template performs one materialization step:

```text
template values + creation position + new node ID
  -> complete standalone NoteNode
  -> persisted in canvas JSON
```

The canvas stores the final `badge`, `content`, `style`, `width`, and `height`.
It does not need the template to open or render later.

Consequences:

- editing a template affects only future creations;
- deleting a template does not affect existing Notes;
- opening a canvas on a device without that template produces the same display;
- sharing a canvas does not require sharing the template library;
- built-in template changes in a later plugin version do not restyle old Notes.

## 7. Applying a Template to an Existing Note

Applying a template to an existing Note is one undoable canvas operation. It
copies:

- badge;
- supported style properties;
- default width and height when present.

It preserves:

- content;
- node ID and position;
- Zotero source and source snapshot;
- Frame membership;
- connections and extensions.

`initialContent` is never applied to an existing Note. This rule avoids both
silent data loss and confirmation-dialog fatigue.

## 8. Template Library and Synchronization

### 8.1 Ownership

The plugin host owns a `TemplateRepository` boundary. Whiteboard UI code
requests a template list and template mutations through the host protocol; it
does not call Zotero persistence APIs directly.

Conceptually, the repository provides:

```ts
interface TemplateRepository {
  list(): Promise<NoteTemplate[]>;
  save(template: NoteTemplate): Promise<void>;
  remove(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}
```

Built-in templates come from code and are merged with repository results at
read time. They are not copied into synchronized storage. Editing a built-in
template creates a custom copy instead of mutating the built-in definition.

### 8.2 Account scope

Custom templates belong to the current Zotero user library, not to a canvas,
collection, or group library. Devices using the same synchronized Zotero
account receive the same custom template library.

When Zotero sync is unavailable or disabled, local custom templates continue to
work. Canvas editing and display never wait for template synchronization.

The concrete Zotero storage API remains behind the repository adapter. The
implementation must verify its availability and lifecycle in the supported
Zotero versions before coupling product behavior to it.

### 8.3 Storage and conflicts

Custom templates are synchronized as independent logical records rather than
one monolithic registry value. This prevents an edit to one template from
overwriting an unrelated template changed on another device.

Conflict behavior is deliberately conservative:

- records with different IDs merge independently;
- the same record edited concurrently keeps the selected newer version;
- the losing nonidentical version is preserved as a custom template named with
  a localized conflict-copy suffix;
- deletion is synchronized through the repository and never deletes canvas
  nodes created from that template;
- malformed remote records are ignored and reported without preventing valid
  templates from loading.

If the selected Zotero synchronization primitive cannot expose enough state to
implement loss-preserving conflicts, the implementation must prefer a simpler
documented last-write-wins behavior over inventing a parallel cloud service.
That limitation must be made visible in the template management UI and tests.

## 9. User Experience

### 9.1 Creation

The Note creation control exposes the built-in templates first, followed by a
small custom-template section. Choosing a template immediately creates a Note;
it does not open a required configuration dialog.

The default Note action remains prominent so users can begin without learning
templates. Question and Claim appear as convenient presets rather than peer
object types.

### 9.2 Save from canvas

A Note context-menu command, **Save as template**, opens a compact form for:

- template name;
- badge;
- whether to include the current content as starter content.

The preview is the selected Note itself. Its supported style and current size
are captured on save, so the first version does not need a separate visual
template designer.

### 9.3 Management

Template management supports:

- rename;
- edit supported values;
- duplicate;
- reorder;
- delete.

Deleting a template requires lightweight confirmation but does not warn about
existing canvas nodes, because those nodes are independent copies.

## 10. Style Boundary

Templates use the existing typed canvas style properties. The first version may
expose only a useful subset in the UI, such as:

- fill and text colors;
- stroke color, width, and solid or dashed style;
- corner radius;
- font size, weight, style, decoration, and alignment;
- opacity;
- default width and height.

The template UI must clamp numeric ranges, validate colors, limit text fields,
and discard unsupported properties. It must not accept arbitrary CSS class
names, selectors, HTML, JavaScript, URLs, or renderer-specific component props.

## 11. AI Boundary

Humans remain free to create and restyle Notes without assigning semantic
meaning. A future AI integration uses a narrower command surface:

```ts
type CreateNoteCommand = {
  templateId?: string;
  content: string;
  position?: CanvasPosition;
};
```

The host resolves a valid `templateId`, materializes the same standalone Note
used by human creation, and validates the final node. If a template is missing,
the command falls back to the default Note template or fails explicitly; it
never writes an unresolved runtime dependency into the canvas.

AI commands are constrained by:

- an allowlist of node and style fields;
- content and badge length limits;
- numeric size and style ranges;
- safe color parsing;
- rejection of unknown fields and executable content.

These constraints guide AI output without reducing human editing freedom or
adding AI-only data to the persisted schema.

## 12. Validation and Failure Behavior

- A canvas parser validates Note fields independently of any template library.
- Unknown template records cannot make a canvas document invalid.
- Template-loading failure shows built-in templates and keeps ordinary Note
  creation available.
- Template-save failure leaves the source Note unchanged and reports a retryable
  error.
- Applying a template participates in normal Undo and Redo.
- Synchronization callbacks update creation menus and management UI only; they
  do not scan or mutate open canvases.

## 13. Schema and Compatibility

Because the product is unreleased, the canonical schema-v2 definition is
revised in place:

- remove `QuestionNode` and `ClaimNode`;
- remove `question` and `claim` from `AcademicNode` and `CanvasNode` unions;
- add optional `badge` to `NoteNode`;
- reject `question` and `claim` as persisted node kinds;
- do not add a migration path or compatibility parser for experimental files.

Template-library storage has its own record validation and evolution boundary.
It is not part of the canvas schema version.

## 14. Non-goals

This design does not add:

- live links between templates and canvas nodes;
- cascading styles or automatic bulk restyling;
- multiple badges or a formal user taxonomy;
- arbitrary CSS or custom renderer code;
- template variables, formulas, or scripting;
- group-shared template libraries;
- a Bamboo account or independent cloud service;
- automatic semantic conversion of existing free text;
- AI-generated templates in the first implementation.

## 15. Acceptance Criteria

The design is satisfied when:

1. Question and Claim are absent from the canonical persisted node union.
2. Built-in Question and Claim actions create valid standalone Notes.
3. A user can style a Note, save it as a custom template, and use it on another
   canvas.
4. A custom template becomes available on another device using the same synced
   Zotero account when the selected Zotero API supports that synchronization.
5. Editing or deleting a template does not alter any existing canvas node.
6. Applying a template to an existing Note preserves content and source data and
   is undoable.
7. A canvas renders identically when its originating template is unavailable.
8. Invalid or unavailable template storage does not prevent opening, editing,
   or saving a canvas.
9. Template input cannot introduce arbitrary CSS or executable content.
10. The same validated materialization path can serve human and future AI
    creation commands.
