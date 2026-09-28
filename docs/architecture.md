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
Zotero Items / Notes / PDF Annotations
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
parent Item key. Supported non-empty PDF highlights and underlines are listed
on demand from a Literature node and batch-added as Quote nodes. Attachments are
not accepted as new academic nodes.

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
chain. A multi-Quote acquisition is one undoable edit and creates no automatic
connections. Background snapshot and availability updates add no undo entry
and do not independently dirty the document; explicit source refreshes persist
changed snapshots without altering graph geometry or semantic relationships.
Saving serializes only the canonical schema-v2 canvas.

## First-run tutorial

After locale, menus, windows, and the sidebar are initialized, startup
schedules a one-time tutorial without waiting for it. The host inspects a
bounded set of recent Regular Items from the user library, while the pure
whiteboard model builds the canonical tutorial document from localized labels
and an optional validated sample.

The result is an ordinary standalone attachment in the user-library root. Its
completion marker is written after attachment creation succeeds and before the
attachment opens. The marker prevents recreation even if the user later
deletes the tutorial, and sample discovery never mutates source Zotero Items.

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
its Zotero Item, while Quote navigation asks the Zotero Reader for the exact PDF
annotation and falls back to the resolved page when exact navigation is not
available. This workflow does not provide Reader **Add to current canvas**
commands or cross-tab annotation drag-and-drop.

## Follow-ups

Preview is a read-only HTML document page, not an editor mode. The same `buildStandaloneDocument()` renderer feeds the in-app preview, HTML export, and print-to-PDF. Parser unification (Live decorations vs markdown-it export) remains open.
