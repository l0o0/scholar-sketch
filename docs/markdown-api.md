# Markdown API

Scholar Sketch exposes its in-process API at `Zotero.ScholarSketch.api.markdown`
for other plugins / MCP bridges to create and edit `.md` documents inside Zotero.
All methods are async, JSON-friendly, and reject with `MarkdownApiError`
(`error.code` is stable).

```js
const md = Zotero.ScholarSketch.api.markdown;

// List markdown attachments in the user library
const docs = await md.list({ q: "note" });

// Read one
const { content } = await md.read(docs[0].itemID);

// Create under a literature item, then edit
const created = await md.create({
  parentItemID: 123,
  initialContent: "# Title",
});
await md.update(created.itemID, { content: "# New\n\nupdated" });

// Patch frontmatter only
await md.patchFrontmatter(created.itemID, {
  set: { tags: ["ai", "draft"] },
  delete: ["old-key"],
});

// Open / flush / close editor tabs
await md.openTab(created.itemID);
await md.flush(created.itemID);
await md.closeTab(tabID);
```

Methods: `list`, `stat`, `read`, `create`, `createLinked`, `update`,
`patchFrontmatter`, `rename`, `trash`, `openTab`, `closeTab`, `sessions`,
`flush`, `toHtml`, `render`, `documentTitle`.

Error codes: `ITEM_NOT_FOUND`, `NOT_MARKDOWN`, `WRITE_CONFLICT`,
`WRITE_FAILED`, `INVALID_ARGUMENT`, `NOT_OPEN`.

Notes:

- All writes go through the same persistence path as the editor (file write,
  image-asset cleanup, item-title sync, Zotero file-sync marking).
- `update` rejects with `WRITE_CONFLICT` when an open editor tab has unsaved
  changes — `force: true` permits that API update, but does not bypass external file conflict checks.
- `rename` renames the underlying file; for linked attachments this renames
  the file on disk.
- API version: `Zotero.ScholarSketch.api.version` (currently `3`).

See also the [Canvas API](canvas-api.md).
