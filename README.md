<p align="center">
  <img src="docs/icons/scholar-sketch-logo.png" alt="Scholar Sketch — Read · Organize · Think" width="640" />
</p>

<h1 align="center">Scholar Sketch</h1>

<p align="center"><strong>Markdown &amp; Whiteboard for Zotero</strong></p>

<p align="center">
  <a href="https://www.zotero.org"><img src="https://img.shields.io/badge/Zotero-9%2F10%2F11-green?style=flat-square&amp;logo=zotero&amp;logoColor=CC2936" alt="Zotero compatibility" /></a>
  <a href="https://github.com/l0o0/scholar-sketch/releases"><img src="https://img.shields.io/badge/version-0.2.10-blue?style=flat-square" alt="version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square" alt="license" /></a>
</p>

Scholar Sketch extends Zotero with Markdown notes and visual whiteboards, connecting papers, PDF annotations, and ideas in one workspace.

[English](README.md) | [简体中文](doc/README-zhCN.md) · [Download](https://github.com/l0o0/scholar-sketch/releases/latest)

## Features

- **Markdown editing**: Live preview, source editing, and reading preview, with tables, images, math, and footnotes.
- **Flowcharts in Markdown**: write Mermaid flowcharts, sequence diagrams, and mind maps directly in `.md` notes, preview them as you write, and include them in HTML/PDF exports.
- **Linked notes**: `[[Note]]` links, an outline, backlinks, and library-wide full-text search.
- **Research whiteboards**: organize papers, annotations, notes, and attachments with groups, connections, batch styling, and auto layout.
- **Zotero integration**: drag papers onto a board, browse PDF annotations, or turn text annotations into Markdown notes.
- **Portable files**: native `.md` and JSON Canvas `.canvas` files; export notes with images for Obsidian and other tools, or boards as PNG, SVG, and Markdown.
- **Saving and recovery**: autosave, local history, and file conflict checks, with tabs and standalone windows.

## Install

Requires **Zotero 9 / 10 / 11 for desktop**.

1. Download `scholarsketch-v{version}.xpi` from [Releases](https://github.com/l0o0/scholar-sketch/releases/latest).
2. In Zotero, open **Tools → Plugins → gear → Install Plugin From File…** and select the downloaded file.

## Screenshots

**Connect papers, annotations, and ideas on a research whiteboard.**

![Scholar Sketch research whiteboard with literature, annotation, question, viewpoint, and summary cards](docs/screenshots/research-whiteboard.jpg)

**Write Markdown with live preview and linked mentions.**

![Scholar Sketch Markdown editor with tables, linked notes, outline, and backlinks](docs/screenshots/markdown-linked-notes.jpg)

<details>
<summary>Batch styling for cards and connections</summary>

![Scholar Sketch multi-selection style menu](docs/screenshots/canvas-batch-styles.jpg)

</details>

## Quick start

- **Write a note**: click the **Scholar Sketch** toolbar button → **New Markdown Note…**. Select a paper first to attach the note to it, or clear the selection to create a standalone note in the current library or collection. Double-click its `.md` attachment to continue editing. Type `[[` to link another note.
- **Reference literature**: type `[[` and search by title. The picker shows Zotero item icons and filters for **All**, **Regular items**, **Notes/attachments**, and **Open tabs**. Open tabs includes attachments from every open tab in the current Zotero window and their parent items. Tab cycles filters immediately, Shift+Tab cycles backward, ↑/↓ selects a result, Enter inserts it, and Esc closes the picker. You can continue typing without leaving the editor.
- **Create a whiteboard**: click the **Scholar Sketch** toolbar button → **New Whiteboard…**, drag in papers, and connect cards. Hold **Space** and drag to pan.
- **Reuse a style**: select a card or shape and click **Format painter**, then click a target. Double-click the brush for continuous use; press **Esc** to exit. The context menu also offers **Copy style** and **Paste style**, including pasting to multiple selected nodes with one undo step. Contents, references, and dimensions stay intact.
- **Organize a collection or revisit a board**: use **New Whiteboard from Collection…** or **Recent Whiteboards** below the separator in the same toolbar menu.
- **Explore an example**: choose **Help → Scholar Sketch: Create Example Whiteboard**.

Stored attachments follow Zotero file sync; linked attachments need separate syncing. Local history stays on the current device.

### Flowcharts in Markdown

Write flowcharts, sequence diagrams, and mind maps directly in your `.md` notes using Mermaid—no need to draw and import a separate image. Add a fenced `mermaid` block:

````markdown
```mermaid
flowchart LR
  A[Read papers] --> B[Take notes] --> C[Connect ideas]
```
````

Diagrams render in both live preview and reading preview. In live preview, move the cursor outside the block to see the diagram; click it to edit its source. HTML/PDF exports embed the rendered diagram, while the `.md` file keeps the editable Mermaid source.

Mermaid is bundled for offline use and loaded when needed. Invalid or overly complex diagrams retain their source with an explanation.

## Documentation

- [Links and export](docs/obsidian-links.md)
- [Saving and recovery](docs/file-safety.md) (Chinese)
- [Feature guide](docs/markdown-canvas-release-features.md) (Chinese)

<details>
<summary>Development and plugin integration</summary>

```bash
pnpm install
cp .env.example .env  # Configure your Zotero development environment
pnpm start           # Build and launch Zotero
pnpm run build       # Build the XPI
```

[Browser testing](docs/fake-zotero.md) · [Markdown API](docs/markdown-api.md) · [Canvas API](docs/canvas-api.md)

</details>

Feedback and contributions are welcome through [Issues](https://github.com/l0o0/scholar-sketch/issues) and pull requests.

Built with [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) and [markdown-it](https://github.com/markdown-it/markdown-it).

[AGPL-3.0-or-later](LICENSE)
