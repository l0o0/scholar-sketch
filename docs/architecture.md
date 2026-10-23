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
Image and ink annotations retain a type label, comment and source navigation;
their cached image previews are not copied into the canvas.

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

After locale, menus, windows, and the sidebar are initialized, startup
schedules a one-time tutorial without waiting for it. The host inspects a
bounded set of recent Regular Items from the user library, while the pure
whiteboard model builds the canonical tutorial document from localized labels
and an optional validated sample.

The tutorial consists of ordinary Markdown and Canvas attachments in the
user-library root. Automatic initialization and the Help menu share an in-flight
operation and reconcile both assets through `Zotero.Search` before creating
anything. Synced automatic tags identify each role across profiles and renames;
older installations fall back to exact Chinese/English tutorial titles, including
previous product names. A recognized Canvas's portable Markdown reference takes
precedence over an independent title match, preserving pairs after renames.
A matching item waiting for file download is still reused.
An unsuccessful search aborts creation. If only one asset exists, only its missing
partner is created; a successful partial creation remains available for retry.

Per-item content fingerprints in `Zotero.SyncedSettings` allow an unchanged
generated example to be updated through the regular, revision-checked file APIs.
Edited or unverified legacy content, including renamed Markdown, is preserved.
Canvas comparison normalizes serialization timestamps, viewport and equivalent
default connection properties; updates preserve the saved viewport.
The demo Markdown link uses a portable item key. Legacy tutorials can repair that
link without replacing their cards or granting edited contents a clean baseline.
Existing duplicates are not deleted or merged automatically. When multiple search
matches exist, tagged items take priority, then the oldest local item ID is reused.

The local completion marker is written after reconciliation succeeds and before
opening. It still prevents repeated onboarding on the same profile, including
recreation after the user deletes a tutorial. The Help command can explicitly
reconcile/open it again. On another computer, sync the library metadata before
installation: local search cannot discover items that have not arrived yet, or
coordinate simultaneous first creation on offline computers. Sample discovery
never mutates source literature Items.

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
templates in the current Zotero user library through `SyncedSettings`. Template
messages cross the validated version-2 protocol. Open sessions subscribe to the
shared repository and release that subscription when closed.

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
