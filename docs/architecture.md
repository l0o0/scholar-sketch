# Architecture

Scholar Sketch is a Zotero chrome plugin with isolated `chrome://bamboo` CodeMirror and
whiteboard iframes. The active iframe owns its canonical document; Zotero-side
code owns sessions, files, chrome UI, and all access to Zotero data.

```
Main window shell (toolbar / status / preview)
  └─ SessionView (typed DOM refs)
SessionRegistry (window → itemID → Session)
  └─ SaveCoordinator (revision + single write queue)
     ├─ persistSession (Zotero.File + title + image cleanup)
     └─ Image asset helpers
EditorHandle (postMessage client, cached value)
  ║ postMessage
  ▼
iframe CM6 (decorations, widgets, commands)
```

The research canvas follows the same host/iframe split:

```text
Zotero Items / Notes / Attachment Annotations
  -> Academic Source Gateway (native-key lookup, validation, snapshots)
  -> Progressive Source Scheduler (priority, cache, cancellation)
  ║ typed postMessage protocol v2
  ▼
whiteboard iframe (canonical Zotero-free canvas + transient source state)
```

## Boundaries

- `editor-protocol.ts` and Markdown parse helpers stay pure: no Zotero or chrome DOM.
- `src/editor/` talks only to DOM + CodeMirror. It must not call Zotero APIs.
- The whiteboard package is also Zotero-free. Academic source descriptors and
  protocol payloads store portable native keys and display snapshots, never
  Zotero objects or local integer item IDs.
- The host academic source gateway is the single owner of user/group library
  mapping, native-key resolution, item-kind and parent-chain validation, Note
  conversion, annotation listing, snapshot creation, and source navigation.
- File writes go through `SaveCoordinator`. UI code requests a save; it does not call `Zotero.File.putContentsAsync` directly.
- Sessions are isolated per window. Closing a window flushes only that window's editors.

## Save model

Each session has `currentRev` / `savedRev`. Typing increments `currentRev`. Autosave, Ctrl+S, and tab close enqueue a write. The writer snapshots the latest editor value; if a newer rev appears during I/O, another write follows. `flush()` waits until the queue is empty.

## Markdown reference index

`NoteIndex` owns the existing local SQLite cache at
`<Zotero.DataDirectory>/scholar-canvas/scholar-canvas.sqlite`. Its `notes` table
stores note metadata, file stamps and saved text; `links` stores each parsed
reference and its source range. Markdown files remain authoritative. The cache
can be rebuilt and is not part of Zotero file synchronization. Saves update the
index; library scans reconcile metadata and read changed files. Backlinks match
parsed references in the in-memory library cache populated from this index.
They are not yet a direct SQL query by target key.

The host reference sidebar uses saved content in both directions. Incoming
references cover Markdown notes in the same library. Outgoing references read
only the current note and resolve explicit Zotero keys in metadata batches for
type, icon and first creator; title-only legacy links resolve through the normal
link chooser when clicked. Categories and repeated-reference groups are derived
from that result, without another document scan on filter changes. Source ranges
remain per occurrence, and outgoing destinations retain their headings or PDF
locations. Direction, filters, group expansion and width belong to the mounted
view; stale asynchronous responses cannot replace a newer view result.
PDF links use the current Zotero process's native URI handler, preserving page
and annotation locations. Dispatch does not imply the asynchronous file open
succeeded; Zotero owns that operation and its error feedback.

## Protocol

High-frequency `change` messages carry `{ rev, changes }` instead of the full document. The parent applies those ranges to its shadow copy. Save/flush calls `requestSnapshot` so the written file is the latest iframe document. Image widgets request a single `resolveAsset`; the parent answers with a cached data URL.

The whiteboard uses a separate, discriminated version-2 protocol. Academic
requests and responses carry the session channel and request ID; source
resolution batches also carry the document generation so results from a closed
or replaced session cannot mutate the active canvas. Protocol payloads contain
validated library references, native keys, and snapshots rather than open-ended
Zotero object bags.

Academic field rules are owned by `packages/whiteboard/src/model/document.ts`.
The protocol reuses those parsers but rejects non-own data, unexpected fields,
and any other normalization at the message boundary. File parsing can still
recover valid nodes from a partially malformed document. The iframe sender
uses the protocol's discriminated message body type; only the bridge adds the
channel/version envelope.

## Academic source workflow

Regular Zotero Items become Literature nodes. Standalone and child Zotero Notes
are imported as source-backed Note nodes; a child Note additionally records its
parent Item key. Zotero file attachments become source-backed Attachment nodes.
Annotation lists can be requested from either a Literature node, aggregating its
supported child attachments, or an Attachment node, scoped to that file. PDF,
EPUB and HTML snapshot attachments are supported, including standalone files
without a parent Literature item. URL-only attachments are not annotatable.

Highlights, underlines, notes, text boxes, image selections and ink annotations
become Quote nodes with their type, tags, color, comment and location metadata.
Text is allowed to be empty; notes and text boxes use their comment as content.
Image and ink annotations retain a type label, comment and source navigation.
The host reads Zotero’s cached PNG crop for these annotations, including the page
background and marks. Bounded safe image data is included in the Quote snapshot
for the picker, card and properties panel and survives saving/reopening. Missing
cache files leave source navigation usable; resolution retains the last saved
preview until a replacement is available. The iframe never reads Zotero cache paths.
Quote snapshots also retain the source attachment title for the compact properties
panel. Older snapshots fall back to their citation or attachment key until resolved.
The panel clamps quotes to five lines; expanding scrolls the content while keeping
source navigation and grouping actions visible.

The host verifies the library and attachment/annotation key chain. Existing
Quotes that record a Literature key also require that parent to remain unchanged.
A Quote imported from a standalone attachment keeps its original attachment-based
identity if that file is later assigned a Literature parent. Picker selection,
already-added detection and focus use the native library/attachment/annotation
identity so reparenting cannot import the same annotation twice.

Picker and drop acquisitions share one batch response (`academicSourcesAcquired`),
including a picker result containing just one item. The runtime correlates that
batch with its pending placeholder and commits successful nodes as one undoable
edit. Failed or cancelled requests do not create history entries.

Opening a canvas parses and renders every persisted snapshot before scheduling
Zotero lookups. Selected and visible sources take priority over idle sources,
with at most four host lookups active. Resolution failures affect only the
transient availability of that node: its snapshot, geometry, styling,
connections, export, and editing behavior remain usable. Availability,
resolution generations, scheduler state, local Zotero IDs, and caches are
runtime-only and are never serialized.

Imported Note text is an independent canvas copy. Background resolution cannot
overwrite it, and canvas edits never write back to Zotero. **Refresh from
Zotero** requires an overwrite confirmation and replaces the local content as
one undoable edit. A cancelled or failed refresh leaves the local Note intact.

Literature and Quote snapshots may be refreshed from their verified native-key
chain. Importing annotations from the annotation picker creates new Quote nodes
and connections to the selected source card in one undoable edit. Background
snapshot and availability updates add no undo entry
and do not independently dirty the document; explicit source refreshes persist
changed snapshots without altering graph geometry or semantic relationships.
Saving serializes only the canonical schema-v2 canvas.

## First-run tutorial

After locale, menus, windows, and the sidebar are initialized, startup checks
local tutorial records without waiting for them. The host inspects a bounded set
of recent Regular Items from the user library, while the pure whiteboard model
builds the tutorial from localized labels and an optional validated sample.

The tutorial consists of ordinary Markdown and Canvas attachments in the
user-library root. The local `tutorialAttachments` preference stores only each
asset's item key and tutorial version. `TUTORIAL_VERSION` changes when the bundled
tutorial changes, independently of the plugin version. Resolve the saved key in
the personal library first: deleted or missing items are not automatically
recreated. If both assets still exist, reuse the same or newer version; a known
older version creates a new pair and preserves the old content. Attachment
metadata awaiting file download is not considered deleted.

Automatic initialization and the Help menu share an in-flight operation.
Without local records, `Zotero.Search` discovers examples by automatic tags, then
exact Chinese/English titles including previous product names. A recognized
Canvas's portable Markdown reference takes precedence over a title match.
Unknown-version examples are adopted unchanged at the current tutorial version.
An unsuccessful search aborts creation. Each successfully created asset's key is
remembered before the next asynchronous step, so a partial retry can reuse it.
A legacy machine-local Markdown link may be repaired through the revision-checked
Canvas API without replacing the remaining cards. Existing duplicates are never
automatically deleted or merged.

The legacy `whiteboardTutorialCreated` marker prevents recreating deleted
examples from older installations. The Help command explicitly restores or opens
the tutorial; startup opens only newly created examples. On another computer,
sync library metadata before installation: local search cannot discover items
that have not arrived yet or coordinate offline first creation. Sample discovery
never mutates source literature Items. Tutorial state is local, not a Zotero
synchronized setting; obsolete fingerprints are disposable and are removed as
specified in [file safety](file-safety.md#旧版同步设置迁移).

## Note templates

Note remains the persisted user-authored academic node kind. Its optional
`noteType` records Note, Question, Viewpoint (`claim` for compatibility), Evidence,
or Summary. A missing type is interpreted from recognized legacy badges, otherwise
as Note; custom badges serve as optional titles. Switching type preserves body,
source, geometry, and explicit styles. Default appearance and localized prompts
follow the type, with prompts never stored as body text.

Built-in templates create typed Notes. Custom templates can retain a type, title,
style, dimensions, and optional starter body. Applying a custom template is a
one-time action, not an ongoing binding, and never replaces existing body text.

The iframe owns selection and editing UI, while a host repository stores custom
templates as JSON in the local `noteTemplates` plugin preference. These templates
do not sync across computers. Template messages cross the validated version-2
protocol. Open sessions subscribe to the shared repository and release that
subscription when closed. The startup migration completes before any template
consumer initializes. It transfers existing custom templates into local preferences
and verifies the saved value before removing the unsupported legacy synced setting.
On failure the original templates remain available for a retry; an error notification
is shown while Markdown and Canvas initialization continues.

Canvas nodes never reference the registry at render time: creation and Apply
template both materialize final values into canvas JSON. Applying a template is
undoable and preserves existing content, Zotero source identity, position,
frame membership, connections, and extensions.

**Open source** resolves the complete key chain in the host. Literature selects
its Zotero Item, while Quote navigation asks the Zotero Reader for the exact
annotation. If exact navigation is unavailable, PDF Quotes fall back to the
resolved page; EPUB and HTML Quotes open their attachment without claiming a PDF
page location. This workflow does not provide Reader **Add to current canvas**
commands or cross-tab annotation drag-and-drop.

## Follow-ups

Preview is a read-only HTML document page, not an editor mode. The same `buildStandaloneDocument()` renderer feeds the in-app preview, HTML export, and print-to-PDF. Parser unification (Live decorations vs markdown-it export) remains open.

## Experimental manuscript export

The Markdown host owns citation selection, portable user/group citation identities,
CSL data access and local Pandoc execution. `markdown/paper/export.ts` prepares the
Pandoc document through explicit file/process/image/reference ports; it retains
native math and citations, normalizes existing image syntax and rejects unsupported
raw content. Only display metadata is retained. The host reuses the image resolver
and Mermaid renderer, converts vector/WebP figures when necessary, and publishes a
complete DOCX after session and destination checks. Temporary workspaces and
subprocesses belong to the export operation and are cancelled on session close.
Markdown remains authoritative; Word citations are static. See the
[accepted trial design](superpowers/specs/2026-10-29-paper-writing-design.md).
