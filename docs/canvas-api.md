# Canvas API

The in-process namespace is `Zotero.ScholarSketch.api.canvas` (Canvas API version `1`; aggregate API version `3`). Available after plugin initialization. This API requires execution inside Zotero; it does not start a network or MCP service. Available starting with Scholar Sketch v0.2.2.

Methods are asynchronous and return JSON-friendly values. Canvas inputs accept a JSON Canvas object or its JSON string. The standard is [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), not the internal editor snapshot format. Normalized output includes the plugin's existing `bamboo` extensions, preserving Zotero source identities.

| Method                                                      | Result                                                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate(canvas)`                                          | Normalized Canvas JSON; rejects malformed data and recoverable issues rather than silently deleting content. Does not write files.                                                      |
| `list({ libraryID?, parentItemID? })`                       | Canvas attachment metadata. Defaults to the personal library; excludes deleted items.                                                                                                   |
| `read(itemID)`                                              | Metadata, `canvas`, opaque `revision`, parser `issues`, `open`, and `dirty`. Reads saved contents, not unsaved editor changes.                                                          |
| `create({ canvas?, parentItemID?, libraryID?, filename? })` | New imported `.canvas` attachment metadata. Defaults to an empty canvas in the personal library. Parent must be a regular item in the same library. Does not select or open the result. |
| `update(itemID, canvas, { expectedRevision })`              | Replace a closed canvas, with file history and content conflict checking; mark imported attachment for sync. Returns metadata.                                                          |
| `open(itemID)`                                              | `{ opened: boolean }`.                                                                                                                                                                  |
| `getSelection()`                                            | Selected Zotero item IDs, keys, library IDs, types and titles.                                                                                                                          |
| `fromItems(itemIDs)`                                        | A standalone canvas containing source cards for actual items, notes, supported PDF annotations or attachments. Does not save. Deduplicates IDs; accepts at most 500 IDs.                |
| `listAnnotations(itemID)`                                   | `{ candidates, failures }` for a literature item; candidates contain source identities and snapshots. Inspect failures for incomplete results.                                          |
| `resolveItem({ library, key })`                             | Resolve a persistent source identity to `{ itemID, libraryID, key }`. `library` is `{ type: "user" }` or `{ type: "group", groupID }`.                                                  |

## Create a canvas from the current selection

```js
const api = Zotero.ScholarSketch.api.canvas;
const selected = await api.getSelection();
const canvas = await api.fromItems(selected.map((item) => item.itemID));
const created = await api.create({ canvas, filename: "Reading.canvas" });
await api.open(created.itemID);
```

For group libraries, pass the destination `libraryID` explicitly. Source references can point to a different library; creating the destination requires editable items and files in its library.

## Import and export

Pass parsed `.canvas` JSON to `create` to import a new attachment. To export, serialize `(await api.read(itemID)).canvas` using `JSON.stringify`. The API returns content rather than accepting arbitrary export filesystem paths. The caller handles reading/writing external files and copying relative assets. Export does not bundle local files or remove Zotero extensions.

## Modify a saved canvas

```js
const saved = await api.read(itemID);
if (saved.issues.length)
  throw new Error("Resolve existing format issues first");
// Standard geometry fields remain authoritative for positions and dimensions.
saved.canvas.nodes[0].x += 120;
await api.update(itemID, saved.canvas, {
  expectedRevision: saved.revision,
});
```

Use `revision` unchanged; it is an exact saved-content token, not an mtime. Close an open canvas first. Do not automatically retry a conflict by replacing the revision: reread and reconcile the changes. History and atomic writes are shared with the editor. A later sync-metadata failure may occur after the file was saved; reread before retrying.

`update` replaces the entire document, so preserve IDs, unmodified nodes, edges, array order and unknown extension fields. Remove affected edges when deleting nodes. A normalized node's standard fallback text and `bamboo.node` can both contain content: editing fallback `text` alone does not modify its authoritative plugin payload. Preserve source cards, or use a standard-only document for newly authored content. Live editor mutations and high-level node-content patching are not exposed in this version.

## Import selected PDF annotations

```js
const result = await api.listAnnotations(paperItemID);
const ids = [];
for (const candidate of result.candidates) {
  const source = candidate.acquisition.source;
  const item = await api.resolveItem({
    library: source.library,
    key: source.annotationKey,
  });
  ids.push(item.itemID);
}
const canvas = await api.fromItems(ids);
// Inspect result.failures before treating this as a complete import.
```

Supported quotations are nonempty highlight/underline annotations. Notes are imported as content snapshots with source references; this does not enable write-back. Attachments keep Zotero references, not embedded copies of their bytes. Source identities always come from actual Zotero objects.

## Errors

Failures throw `CanvasApiError` with a stable `code`: `INVALID_ARGUMENT`, `ITEM_NOT_FOUND`, `NOT_CANVAS`, `CANVAS_OPEN`, `WRITE_CONFLICT`, `READ_ONLY`, or `OPERATION_FAILED`. Annotation listing can also return per-source failures without rejecting the entire call. This is a trusted in-process API; a future remote bridge must provide its own authentication and authorization.
