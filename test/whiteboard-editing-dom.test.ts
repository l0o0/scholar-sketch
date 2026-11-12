import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createServer } from "../packages/whiteboard/node_modules/vite/dist/node/index.js";
import type { WhiteboardRuntime } from "../packages/whiteboard/src/whiteboard/app.tsx";
import { buildCanvasMarkdown } from "../packages/whiteboard/src/whiteboard/export.ts";

test("editing persists drafts atomically and keeps undo boundaries coherent", async () => {
  const window = new Window({ url: "https://example.test" });
  window.document.write(
    "<!doctype html><html><head></head><body></body></html>",
  );
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
    get: () => 1200,
  });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    get: () => 800,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
    get: () => 1200,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    get: () => 800,
  });
  const style = window.document.createElement("style");
  style.textContent =
    readFileSync("node_modules/@xyflow/react/dist/style.css", "utf8") +
    readFileSync("packages/whiteboard/src/whiteboard/board.css", "utf8");
  window.document.head.append(style);
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window,
    self: window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    FileReader: window.FileReader,
    ResizeObserver: window.ResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const server = await createServer({
    root: "packages/whiteboard",
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
  });
  const container = window.document.createElement("div");
  container.style.cssText = "width:1200px;height:800px";
  window.document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  const revisions: number[] = [];
  const notifiedContents: unknown[] = [];
  const transferredAnnotations: string[] = [];
  const openedLinks: string[] = [];
  let runtime: WhiteboardRuntime | undefined;
  try {
    const app = (await server.ssrLoadModule("/src/whiteboard/app.tsx")) as {
      WhiteboardApp: typeof import("../packages/whiteboard/src/whiteboard/app.tsx").WhiteboardApp;
    };
    const noop = () => {};
    await act(async () => {
      root.render(
        createElement(app.WhiteboardApp, {
          theme: "light",
          initialSnapshot: {
            version: 2,
            nodes: [
              {
                id: "note",
                kind: "note",
                content: "Original",
                position: { x: 200, y: 200 },
                width: 240,
                height: 140,
              },
            ],
            connections: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          onReady: (next: WhiteboardRuntime) => {
            runtime = next;
          },
          onChange: (revision: number) => {
            revisions.push(revision);
            notifiedContents.push(runtime?.getSnapshot().nodes[0]?.content);
          },
          onSave: noop,
          onPickAcademicSource: noop,
          onOpenItem: noop,
          onOpenLink: (href: string) => openedLinks.push(href),
          onDropAcademicSources: (requestId) =>
            transferredAnnotations.push(requestId),
          onRefreshZoteroNote: noop,
          onExportFile: noop,
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.ok(runtime);
    const api = runtime;
    // The iframe receives its sidebar mode after React has mounted.
    await act(async () => {
      api.setSidebar(true);
      api.setSidebarFocus(true);
    });
    assert.ok(container.querySelector('.zmd-board-host[data-sidebar="true"]'));
    assert.ok(container.querySelector(".zmd-board-sidebar-toolbar"));
    const annotationSource = {
      library: { type: "user" as const },
      attachmentKey: "ATTACH12",
      annotationKey: "ANNOT123",
    };
    const card = container.querySelector<HTMLElement>('[data-id="note"]');
    assert.ok(card);
    const cardContent = card.querySelector<HTMLElement>(
      ".zmd-board-card-content",
    );
    assert.ok(cardContent);
    const doubleClick = async (target: HTMLElement) => {
      await act(async () => {
        target.dispatchEvent(
          new window.MouseEvent("dblclick", {
            bubbles: true,
            detail: 2,
            button: 0,
            clientX: 220,
            clientY: 220,
          }),
        );
      });
    };
    await doubleClick(cardContent);
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(textarea);

    const setText = async (value: string, target = textarea) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(target, value);
        target.dispatchEvent(new window.Event("input", { bubbles: true }));
        target.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    };

    await setText("First draft");
    const pdfMarkdown =
      "> Selected passage\n\n[Source](zotero://open-pdf/library/items/PDF12345?page=2&position=%7B%22pageIndex%22%3A1%2C%22rects%22%3A%5B%5B10%2C20%2C30%2C40%5D%5D%7D)";
    textarea.setSelectionRange(0, "First draft".length);
    const draftTarget = {
      nodeId: "note",
      revision: Number(textarea.dataset.pdfSelectionRevision),
      value: "First draft",
      from: 0,
      to: "First draft".length,
    };
    await act(async () =>
      api.insertPdfSelection({
        markdown: pdfMarkdown,
        position: { x: 100, y: 100 },
        interaction: "paste",
        editing: draftTarget,
      }),
    );
    assert.equal(api.getSnapshot().nodes[0]?.content, pdfMarkdown);
    await setText("First draft");
    await act(async () =>
      api.insertPdfSelection({
        markdown: pdfMarkdown,
        position: { x: 100, y: 100 },
        interaction: "paste",
        editing: draftTarget,
      }),
    );
    assert.equal(
      api.getSnapshot().nodes[0]?.content,
      "First draft",
      "an older transfer cannot replace a newer draft",
    );
    await act(async () =>
      api.beginAcademicDrop(
        "editing-paste",
        "editing-quote",
        { x: 100, y: 100 },
        [annotationSource],
        "paste",
      ),
    );
    assert.deepEqual(
      transferredAnnotations,
      [],
      "annotation paste must not interrupt text editing",
    );
    const firstRevision = revisions.at(-1);
    assert.ok(firstRevision !== undefined);
    assert.equal(api.getSnapshot().nodes[0]?.kind, "note");
    assert.equal(api.getSnapshot().nodes[0]?.content, "First draft");
    assert.equal(
      notifiedContents.at(-1),
      "First draft",
      "the change callback must already see the corresponding draft",
    );
    assert.equal(revisions.at(-1), firstRevision);

    await act(async () => api.setSaveState("saved"));
    const savedRevision = firstRevision;
    await setText("Saved then continued");
    assert.ok((revisions.at(-1) ?? 0) > savedRevision);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Saved then continued");

    const beforeCancelRevision = revisions.at(-1)!;
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    assert.equal(container.querySelector("textarea"), null);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Original");
    assert.equal(notifiedContents.at(-1), "Original");
    assert.ok((revisions.at(-1) ?? 0) > beforeCancelRevision);

    const reopened = container.querySelector<HTMLElement>('[data-id="note"]');
    assert.ok(reopened);
    const reopenedContent = reopened.querySelector<HTMLElement>(
      ".zmd-board-card-content",
    );
    assert.ok(reopenedContent);
    await doubleClick(reopenedContent);
    const committed = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(committed);
    await setText("Committed", committed);
    await act(async () => {
      committed.dispatchEvent(
        new window.FocusEvent("focusout", { bubbles: true }),
      );
    });
    assert.equal(container.querySelector("textarea"), null);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");
    await act(async () => api.undo());
    assert.equal(api.getSnapshot().nodes[0]?.content, "Original");
    const afterUndo = revisions.at(-1);
    await act(async () => api.undo());
    assert.equal(revisions.at(-1), afterUndo, "typing adds one undo step");
    await act(async () => api.redo());
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");

    await doubleClick(
      container.querySelector<HTMLElement>(".zmd-board-card-content")!,
    );
    const imageEditor =
      container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => api.setEditable(false));
    assert.equal(imageEditor.readOnly, true);
    const readonlyRevision = revisions.at(-1);
    await setText("Blocked input", imageEditor);
    assert.equal(revisions.at(-1), readonlyRevision);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");
    await act(async () => api.setEditable(true));

    const file = new window.File(["image"], "paste.png", { type: "image/png" });
    const paste = new window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(paste, "clipboardData", {
      value: { items: [{ type: "image/png", getAsFile: () => file }] },
    });
    imageEditor.setSelectionRange(
      imageEditor.value.length,
      imageEditor.value.length,
    );
    const beforePaste = revisions.at(-1)!;
    await act(async () => imageEditor.dispatchEvent(paste));
    const deadline = Date.now() + 5000;
    while ((revisions.at(-1) ?? 0) === beforePaste) {
      assert.ok(
        Date.now() < deadline,
        "pasted image should notify a new draft",
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    assert.match(
      String(api.getSnapshot().nodes[0]?.content),
      /!\[paste\.png\]\(data:image\/png;base64,/,
    );
    assert.equal(notifiedContents.at(-1), api.getSnapshot().nodes[0]?.content);
    await act(async () =>
      imageEditor.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");
    assert.equal(notifiedContents.at(-1), "Committed");
    await act(async () =>
      api.beginAcademicDrop(
        "readonly-result",
        "pending-quote",
        { x: 100, y: 100 },
        [annotationSource],
        "paste",
      ),
    );
    assert.deepEqual(transferredAnnotations, ["readonly-result"]);
    const acquisition = {
      kind: "quote" as const,
      source: annotationSource,
      snapshot: {
        text: "Quoted passage",
        pageLabel: "3",
        annotationType: "highlight" as const,
      },
    };
    await act(async () => api.setEditable(false));
    await act(async () => {
      api.resolveAcademicAcquisitionBatch(
        "readonly-result",
        "pending-quote",
        [{ index: 0, acquisition }],
        [],
      );
      api.beginAcademicDrop(
        "readonly-paste",
        "blocked-quote",
        { x: 100, y: 100 },
        [annotationSource],
        "paste",
      );
    });
    assert.equal(
      api.getSnapshot().nodes.length,
      1,
      "a late annotation response must not edit a readonly canvas",
    );
    assert.deepEqual(transferredAnnotations, ["readonly-result"]);
    await act(async () => api.setEditable(true));
    await act(async () =>
      api.beginAcademicDrop(
        "accepted-paste",
        "new-quote",
        { x: 100, y: 100 },
        [annotationSource],
        "paste",
      ),
    );
    await act(async () =>
      api.resolveAcademicAcquisitionBatch(
        "accepted-paste",
        "new-quote",
        [{ index: 0, acquisition }],
        [],
      ),
    );
    assert.equal(api.getSnapshot().nodes.at(-1)?.kind, "quote");
    await act(async () => api.undo());
    assert.equal(api.getSnapshot().nodes.length, 1);
    await act(async () => api.setSidebar(false));
    assert.equal(container.querySelector(".zmd-board-sidebar-toolbar"), null);
    assert.equal(api.getSnapshot().nodes[0]?.content, "Committed");
    await act(async () =>
      api.insertPdfSelection({
        markdown: pdfMarkdown,
        position: { x: 300, y: 240 },
        interaction: "drop",
      }),
    );
    const selectionNote = api.getSnapshot().nodes.at(-1)!;
    assert.equal(selectionNote.kind, "note");
    assert.equal(selectionNote.content, pdfMarkdown);
    const transferredId = selectionNote.id;
    const locationButton = container.querySelector<HTMLButtonElement>(
      `[data-id="${transferredId}"] [data-zmd-note-source-trigger]`,
    );
    assert.ok(locationButton, "the card retains its source navigation action");
    const sourceHref = locationButton.getAttribute("data-zmd-note-source")!;
    assert.ok(sourceHref.includes("&position="));
    const excerptBody = container.querySelector<HTMLElement>(
      `[data-id="${transferredId}"] .zmd-board-card-markdown`,
    )!;
    assert.equal(
      excerptBody.querySelector("blockquote")?.textContent.trim(),
      "Selected passage",
    );
    assert.equal(
      excerptBody.querySelector("a[href]"),
      null,
      "the generated source row takes no space in the excerpt body",
    );
    assert.ok(
      buildCanvasMarkdown(api.getSnapshot()).includes(sourceHref),
      "Markdown export keeps the full source location",
    );
    const clickWithJitter = async (target: HTMLElement) => {
      await act(async () => {
        const mouse = (type: string, x: number) =>
          new window.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            clientX: x,
            clientY: 240,
          });
        target.dispatchEvent(mouse("mousedown", 300));
        target.dispatchEvent(mouse("mousemove", 301));
        target.dispatchEvent(mouse("mouseup", 301));
        target.dispatchEvent(mouse("click", 301));
      });
    };
    await clickWithJitter(locationButton);
    assert.deepEqual(openedLinks, [sourceHref]);
    const serialized = JSON.stringify(api.getSnapshot());
    await act(async () => api.undo());
    assert.equal(
      api.getSnapshot().nodes.some((node) => node.id === transferredId),
      false,
    );
    await act(async () => api.redo());
    assert.equal(
      api.getSnapshot().nodes.find((node) => node.id === transferredId)
        ?.content,
      pdfMarkdown,
    );
    await act(async () => api.loadSnapshot(JSON.parse(serialized)));
    assert.equal(
      api.getSnapshot().nodes.find((node) => node.id === transferredId)
        ?.content,
      pdfMarkdown,
      "saving and reloading retains the complete region link",
    );
    await act(async () => api.setEditable(false));
    await act(async () =>
      api.insertPdfSelection({
        markdown: pdfMarkdown,
        position: { x: 300, y: 240 },
        interaction: "paste",
      }),
    );
    assert.equal(
      api.getSnapshot().nodes.length,
      2,
      "readonly canvas cannot create a selection note",
    );
    const sourceButton = container.querySelector<HTMLButtonElement>(
      `[data-id="${transferredId}"] [data-zmd-note-source-trigger]`,
    );
    assert.ok(sourceButton);
    assert.equal(sourceButton.getAttribute("aria-label"), "Open source");
    const readonlyContent = api
      .getSnapshot()
      .nodes.map((node) => ({ id: node.id, content: node.content }));
    await act(async () => sourceButton.click());
    assert.deepEqual(
      openedLinks,
      [sourceHref, sourceHref],
      "the compact source action navigates in readonly mode",
    );
    await act(async () =>
      sourceButton.dispatchEvent(
        new window.MouseEvent("dblclick", { bubbles: true, detail: 2 }),
      ),
    );
    assert.equal(
      container.querySelector("textarea"),
      null,
      "source action double-click never edits the note",
    );
    assert.deepEqual(
      api
        .getSnapshot()
        .nodes.map((node) => ({ id: node.id, content: node.content })),
      readonlyContent,
    );
    const secondHref = sourceHref.replace("PDF12345", "PDF67890");
    await act(async () =>
      api.loadSnapshot({
        ...api.getSnapshot(),
        nodes: [
          {
            ...selectionNote,
            id: "multiple-sources",
            content: `[First passage](${sourceHref})\n\n[Duplicate](${sourceHref})\n\n[Second passage](${secondHref})\n\n[Website](https://example.test)\n\n\`\`\`md\n[Example](zotero://open-pdf/library/items/PDF00000?page=1)\n\`\`\``,
          },
        ],
      }),
    );
    const multipleTrigger = container.querySelector<HTMLButtonElement>(
      "[data-zmd-note-source-trigger]",
    )!;
    assert.equal(multipleTrigger.getAttribute("aria-haspopup"), "menu");
    await act(async () =>
      multipleTrigger.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const sourceMenu = container.querySelector<HTMLElement>(
      '.zmd-board-note-source-menu[role="menu"]',
    );
    assert.ok(sourceMenu);
    const sourceOptions = [
      ...sourceMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    assert.deepEqual(
      sourceOptions.map((button) => button.textContent),
      ["First passage", "Second passage"],
      "sources are captioned, deduplicated, and exclude fenced examples",
    );
    assert.equal(window.document.activeElement, sourceOptions[0]);
    await act(async () =>
      sourceOptions[0]!.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(window.document.activeElement, sourceOptions[1]);
    await act(async () => sourceOptions[1]!.click());
    assert.equal(openedLinks.at(-1), secondHref);
    assert.equal(container.querySelector(".zmd-board-note-source-menu"), null);
    await act(async () => multipleTrigger.click());
    assert.ok(container.querySelector(".zmd-board-note-source-menu"));
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(container.querySelector(".zmd-board-note-source-menu"), null);
    assert.equal(window.document.activeElement, multipleTrigger);
    await act(async () => multipleTrigger.click());
    await act(async () =>
      window.document.body.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    assert.equal(container.querySelector(".zmd-board-note-source-menu"), null);
    await act(async () => multipleTrigger.click());
    await act(async () =>
      api.loadSnapshot({ ...api.getSnapshot(), nodes: [] }),
    );
    assert.equal(
      container.querySelector(".zmd-board-note-source-menu"),
      null,
      "replacing the document releases the source menu",
    );
    const markdownContent = [
      "**plain research**\nsecond line",
      `> First quoted passage\n\n[First source](${sourceHref})`,
      `[Standalone PDF](${sourceHref})`,
      `> Second quoted passage\n\n[Second source](${secondHref})`,
      `> A comment\n\nSee [Inline PDF](${sourceHref}).`,
      `> A comparison\n\n[One PDF](${sourceHref}) and [Another PDF](${secondHref})`,
      "> A website quotation\n\n[Website](https://example.test)",
      `> Figure explanation\n\n[![Figure](https://example.test/figure.png)](${sourceHref})`,
      `> Formatted source explanation\n\n[**Formatted PDF**](${sourceHref})`,
    ].join("\n\n");
    await act(async () =>
      api.loadSnapshot({
        ...api.getSnapshot(),
        nodes: [
          { ...selectionNote, id: "markdown-note", content: markdownContent },
        ],
      }),
    );
    const mountedMarkdown = container.querySelector<HTMLElement>(
      '[data-id="markdown-note"] .zmd-board-card-markdown',
    );
    assert.ok(mountedMarkdown);
    assert.equal(
      mountedMarkdown.querySelector("strong")?.textContent,
      "plain research",
    );
    assert.ok(mountedMarkdown.textContent.includes("second line"));
    assert.ok(mountedMarkdown.querySelector("br"));
    assert.ok(mountedMarkdown.textContent.includes("First quoted passage"));
    assert.ok(mountedMarkdown.textContent.includes("Second quoted passage"));
    assert.equal(mountedMarkdown.textContent.includes("First source"), false);
    assert.equal(mountedMarkdown.textContent.includes("Second source"), false);
    const linkedFigure = mountedMarkdown.querySelector<HTMLImageElement>(
      'a[href] img[alt="Figure"]',
    );
    assert.ok(linkedFigure, "a linked image after a quotation remains visible");
    assert.equal(linkedFigure.closest("a")?.getAttribute("href"), sourceHref);
    assert.equal(
      mountedMarkdown.querySelector("a[href] strong")?.textContent,
      "Formatted PDF",
      "formatted user link text remains in the body",
    );
    const ordinaryLinks = [
      ...mountedMarkdown.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ];
    assert.deepEqual(
      ordinaryLinks.map((link) => link.textContent),
      [
        "Standalone PDF",
        "Inline PDF",
        "One PDF",
        "Another PDF",
        "Website",
        "",
        "Formatted PDF",
      ],
    );
    await clickWithJitter(ordinaryLinks[0]!);
    assert.equal(
      openedLinks.at(-1),
      sourceHref,
      "ordinary inline and standalone source links remain actionable",
    );
    assert.equal(
      api.getSnapshot().nodes[0]?.content,
      markdownContent,
      "mounting the rendered Markdown preserves canonical source text",
    );
    assert.ok(
      buildCanvasMarkdown(api.getSnapshot()).includes(
        `[First source](${sourceHref})`,
      ),
    );
    assert.ok(
      buildCanvasMarkdown(api.getSnapshot()).includes(
        `[Second source](${secondHref})`,
      ),
    );
  } finally {
    await act(async () => root.unmount());
    await server.close();
    window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
