import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { Window } from "happy-dom";
import {
  AnnotationBrowser,
  type AnnotationBrowserLabels,
} from "../packages/whiteboard/src/chrome/AnnotationBrowser.tsx";
import { PropertiesPanel } from "../packages/whiteboard/src/chrome/PropertiesPanel.tsx";
import { StyleBar } from "../packages/whiteboard/src/chrome/StyleBar.tsx";
import { WhiteboardLabelsProvider } from "../packages/whiteboard/src/chrome/labels.tsx";
import {
  createBasicNode,
  type CanvasNode,
  type QuoteNode,
} from "../packages/whiteboard/src/model/index.ts";
import { nativeAnnotationIdentity } from "../packages/whiteboard/src/model/academic.ts";
import type {
  AnnotationCandidate,
  WhiteboardLabels,
} from "../packages/whiteboard/src/model/protocol.ts";
import { getNodeSpec } from "../packages/whiteboard/src/nodes/index.ts";
import { canvasDocumentToFlow } from "../packages/whiteboard/src/whiteboard/document.ts";

const typeLabels = {
  highlight: "Highlight",
  underline: "Underline",
  note: "Sticky note",
  text: "Text annotation",
  image: "Image annotation",
  ink: "Ink annotation",
};
const browserLabels: AnnotationBrowserLabels = {
  title: "Annotations",
  search: "Search annotations",
  loading: "Loading",
  empty: "No matching annotations",
  unavailable: "Unavailable",
  partialFailure: "Partial failure",
  alreadyAdded: "Already added",
  focusExisting: "Focus existing",
  addSelected: "Add selected",
  page: "Page",
  close: "Close",
  typeLabels,
  typeFilter: "Annotation type",
  tagFilter: "Tag",
  allTypes: "All types",
  allTags: "All tags",
  noText: "Open the source to view this annotation",
};
const labels = {
  kindQuote: "Quote",
  annotationTypeLabels: typeLabels,
  annotationNoText: browserLabels.noText,
  annotationColor: "Annotation color",
  viewAnnotations: "View annotations",
  openSource: "Open source",
} as WhiteboardLabels;
const attachmentSource = {
  library: { type: "user" as const },
  attachmentKey: "ATTACH01",
};
const candidates: AnnotationCandidate[] = [
  {
    attachmentTitle: "Snapshot.html",
    sortIndex: "1",
    acquisition: {
      kind: "quote",
      source: { ...attachmentSource, annotationKey: "ANN00001" },
      snapshot: {
        text: "Quoted evidence",
        comment: "Context",
        annotationType: "underline",
        tags: ["method", "review"],
      },
    },
  },
  {
    attachmentTitle: "Snapshot.html",
    sortIndex: "2",
    acquisition: {
      kind: "quote",
      source: { ...attachmentSource, annotationKey: "ANN00002" },
      snapshot: {
        text: "",
        comment: "Question to investigate",
        annotationType: "note",
        tags: ["review"],
      },
    },
  },
  {
    attachmentTitle: "Snapshot.html",
    sortIndex: "3",
    acquisition: {
      kind: "quote",
      source: { ...attachmentSource, annotationKey: "ANN00003" },
      snapshot: { text: "", annotationType: "image", tags: ["figure"] },
    },
  },
];

function installDom(t: TestContext) {
  const window = new Window({ url: "https://example.test" });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    getComputedStyle: window.getComputedStyle.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    window.close();
  });
  return window;
}

function quote(
  snapshot: QuoteNode["snapshot"],
  style?: QuoteNode["style"],
): QuoteNode {
  return {
    id: "annotation-node",
    kind: "quote",
    position: { x: 0, y: 0 },
    width: 280,
    height: 192,
    source: { ...attachmentSource, annotationKey: "ANN00001" },
    snapshot,
    style,
  };
}

function renderNode(model: CanvasNode) {
  const Component = getNodeSpec(model.kind).Component;
  return renderToStaticMarkup(
    createElement(
      WhiteboardLabelsProvider,
      { value: labels },
      createElement(
        ReactFlowProvider,
        null,
        createElement(Component, {
          id: model.id,
          type: model.kind,
          data: { model },
          selected: false,
          width: model.width,
          height: model.height,
        } as never),
      ),
    ),
  );
}

test("source-backed PDF, EPUB and webpage attachments expose the lazy annotation action", () => {
  for (const contentType of [
    "application/pdf",
    "application/epub+zip",
    "text/html",
  ]) {
    const model = createBasicNode("attachment", { x: 0, y: 0 }, "attachment");
    model.data = { ...model.data, source: attachmentSource, contentType };
    const markup = renderToStaticMarkup(
      createElement(StyleBar, {
        labels,
        left: 0,
        top: 0,
        theme: "light",
        node: canvasDocumentToFlow({
          version: 2,
          nodes: [model],
          connections: [],
        }).nodes[0],
        onViewAnnotations: () => undefined,
        onChange: () => undefined,
      }),
    );
    assert.match(markup, /aria-label="View annotations"/, contentType);
    assert.match(markup, /aria-haspopup="dialog" aria-expanded="false"/);
  }
  for (const model of [
    createBasicNode("pdf", { x: 0, y: 0 }, "embedded-pdf"),
    {
      ...createBasicNode("attachment", { x: 0, y: 0 }, "xhtml"),
      data: {
        title: "XHTML",
        source: attachmentSource,
        contentType: "application/xhtml+xml",
      },
    },
    {
      ...createBasicNode("attachment", { x: 0, y: 0 }, "audio"),
      data: {
        title: "Audio",
        source: attachmentSource,
        contentType: "audio/mpeg",
      },
    },
  ]) {
    const markup = renderToStaticMarkup(
      createElement(StyleBar, {
        labels,
        left: 0,
        top: 0,
        theme: "light",
        node: canvasDocumentToFlow({
          version: 2,
          nodes: [model],
          connections: [],
        }).nodes[0],
        onViewAnnotations: () => undefined,
        onChange: () => undefined,
      }),
    );
    assert.doesNotMatch(markup, /aria-label="View annotations"/);
  }
});

test("annotation card displays the actual type, comments once and an accessible source hint for drawings", () => {
  const markup = renderNode(
    quote({
      text: "",
      comment: "Remember this",
      annotationType: "note",
      tags: ["review"],
    }),
  );
  assert.match(markup, /aria-label="Sticky note"/);
  assert.equal(markup.match(/Remember this/g)?.length, 1);
  assert.match(markup, /review/);
  for (const annotationType of ["image", "ink"] as const) {
    assert.match(
      renderNode(quote({ text: "", annotationType })),
      /Open the source to view this annotation/,
    );
  }
  assert.match(
    renderNode(quote({ text: "Legacy quote" })),
    /aria-label="Quote"/,
  );
});

test("annotation colors fill the card with contrast ink while an explicit user fill takes precedence", () => {
  const markup = renderNode(
    quote({ text: "Evidence", color: "#ffd400", annotationType: "highlight" }),
  );
  assert.match(markup, /--zmd-board-node-fill:#ffd400/);
  assert.match(markup, /--zmd-node-ink:#111827/);
  const manual = renderNode(
    quote({ text: "Evidence", color: "#ffd400" }, { fill: "#111827" }),
  );
  assert.match(manual, /--zmd-board-node-fill:#111827/);
  assert.match(manual, /--zmd-node-ink:#e8eaed/);
  const transparent = renderNode(
    quote({ text: "Evidence", color: "#ffd400" }, { fillStyle: "none" }),
  );
  assert.match(transparent, /--zmd-board-node-fill:transparent/);
  assert.doesNotMatch(transparent, /--zmd-node-ink:/);
  const invalid = renderNode(
    quote({ text: "Evidence", color: "url(https://example.test/image.png)" }),
  );
  assert.doesNotMatch(invalid, /--zmd-board-node-fill:/);
});

test("mounted filters combine type, tag and search while retaining hidden selections", async (t) => {
  t.after(async () => {
    await act(async () => root?.unmount());
  });
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  let submitted: string[] = [];
  const root = createRoot(container);
  function Harness() {
    const [selected, setSelected] = useState(new Set<string>());
    return createElement(AnnotationBrowser, {
      labels: browserLabels,
      state: { status: "ready", candidates, failures: [] },
      query: "review",
      selectedKeys: selected,
      existingKeys: new Set<string>(),
      returnFocusRef: { current: null },
      onQueryChange: () => undefined,
      onSelectionChange: () => undefined,
      onToggle: (key, checked) =>
        setSelected((old) => {
          const next = new Set(old);
          if (checked) next.add(key);
          else next.delete(key);
          return next;
        }),
      onClose: () => undefined,
      onFocusExisting: () => undefined,
      onAddSelected: () => {
        submitted = [...selected];
      },
    });
  }
  await act(async () => root.render(createElement(Harness)));
  const results = () =>
    [...container.querySelectorAll(".zmd-board-annotation-text")].map(
      (item) => item.textContent,
    );
  assert.deepEqual(results(), ["Quoted evidence", "Question to investigate"]);
  const noteType = container.querySelector<HTMLButtonElement>(
    '[data-annotation-type="note"]',
  );
  const tag = container.querySelector<HTMLSelectElement>('[aria-label="Tag"]');
  assert.ok(noteType);
  assert.ok(tag);
  assert.equal(
    container.textContent?.match(/Question to investigate/g)?.length,
    1,
  );
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.click(),
  );
  await act(async () => noteType.click());
  assert.equal(noteType.getAttribute("aria-pressed"), "true");
  assert.deepEqual(results(), ["Question to investigate"]);
  await act(async () => {
    tag.value = "method";
    tag.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.deepEqual(results(), []);
  assert.match(container.textContent ?? "", /No matching annotations/);
  const add = container.querySelector<HTMLButtonElement>(
    ".zmd-board-annotation-add",
  );
  assert.equal(add?.disabled, false);
  await act(async () => add?.click());
  assert.deepEqual(submitted, [
    nativeAnnotationIdentity(candidates[0].acquisition.source),
  ]);
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('[data-annotation-type=""]')
      ?.click();
    tag.value = "";
    tag.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.checked,
    true,
  );
});

test("sparse annotation lists keep all seven type filters and put search first without an empty tag control", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const noop = () => undefined;
  const withoutTags = candidates.slice(0, 2).map((candidate) => ({
    ...candidate,
    acquisition: {
      ...candidate.acquisition,
      snapshot: { ...candidate.acquisition.snapshot, tags: undefined },
    },
  }));
  try {
    for (const count of [1, 2]) {
      await act(async () =>
        root.render(
          createElement(AnnotationBrowser, {
            key: count,
            labels: browserLabels,
            state: {
              status: "ready",
              candidates: withoutTags.slice(0, count),
              failures: [],
            },
            query: "",
            selectedKeys: new Set([
              nativeAnnotationIdentity(withoutTags[0].acquisition.source),
            ]),
            existingKeys: new Set<string>(),
            returnFocusRef: { current: null },
            onQueryChange: noop,
            onSelectionChange: () => undefined,
            onToggle: noop,
            onClose: noop,
            onFocusExisting: noop,
            onAddSelected: noop,
          }),
        ),
      );
      const search = container.querySelector(
        '[aria-label="Search annotations"]',
      );
      const filters = container.querySelector('[aria-label="Annotation type"]');
      assert.ok(search);
      assert.ok(filters);
      assert.ok(
        search.compareDocumentPosition(filters) &
          window.Node.DOCUMENT_POSITION_FOLLOWING,
      );
      assert.deepEqual(
        Array.from(filters.querySelectorAll("button"), (button) =>
          button.getAttribute("data-annotation-type"),
        ),
        ["", "highlight", "underline", "note", "text", "image", "ink"],
      );
      for (const type of [
        "highlight",
        "underline",
        "note",
        "text",
        "image",
        "ink",
      ] as const) {
        const button = filters.querySelector(
          `[data-annotation-type="${type}"]`,
        );
        assert.ok(button);
        assert.equal(
          button.textContent?.trim(),
          "",
          `${type} is displayed as an icon without visible text`,
        );
        assert.equal(button.getAttribute("aria-label"), typeLabels[type]);
        assert.equal(button.getAttribute("title"), typeLabels[type]);
        const icon = filters.querySelector(
          `[data-annotation-type="${type}"] [data-annotation-icon="${type}"]`,
        );
        assert.ok(icon, `${type} has a corresponding annotation icon`);
        assert.ok(
          icon.querySelector("svg"),
          `${type} renders an icon rather than an empty placeholder`,
        );
        assert.equal(
          icon.getAttribute("aria-hidden"),
          "true",
          "decorative icons do not duplicate the button name",
        );
      }
      assert.equal(
        filters.querySelector('[data-annotation-type=""]')?.textContent?.trim(),
        browserLabels.allTypes,
        "All retains its visible label",
      );
      assert.equal(
        container.querySelector('select[aria-label="Tag"]'),
        null,
        "no tag dropdown is rendered when no candidates have tags",
      );
      const ink = filters.querySelector<HTMLButtonElement>(
        '[data-annotation-type="ink"]',
      );
      assert.ok(ink);
      assert.equal(
        ink.disabled,
        false,
        "an annotation type remains selectable even without candidates",
      );
      await act(async () => ink.click());
      assert.equal(
        container.querySelectorAll(".zmd-board-annotation-group li").length,
        0,
      );
      assert.match(
        container.querySelector(".zmd-board-annotation-results")?.textContent ??
          "",
        /No matching annotations/,
      );
      assert.equal(
        container.querySelector<HTMLButtonElement>(".zmd-board-annotation-add")
          ?.disabled,
        false,
      );
      await act(async () =>
        filters
          .querySelector<HTMLButtonElement>(
            '[data-annotation-type="underline"]',
          )
          ?.click(),
      );
      assert.equal(
        container.querySelector<HTMLInputElement>('input[type="checkbox"]')
          ?.checked,
        true,
      );
    }
  } finally {
    await act(async () => root.unmount());
  }
});

test("the source PDF toolbar annotation button is lazy and exposes its expanded state", async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
  });
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const model = createBasicNode("pdf", { x: 0, y: 0 }, "source-pdf");
  model.data.source = attachmentSource;
  const node = canvasDocumentToFlow({
    version: 2,
    nodes: [model],
    connections: [],
  }).nodes[0];
  const requests: string[] = [];
  const buttonRef = { current: null as HTMLButtonElement | null };
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(StyleBar, {
      labels,
      node,
      left: 0,
      top: 0,
      theme: "light",
      annotationsOpen: open,
      viewAnnotationsRef: buttonRef,
      onViewAnnotations: () => {
        requests.push(node.id);
        setOpen(true);
      },
      onChange: () => undefined,
    });
  }
  await act(async () => root.render(createElement(Harness)));
  assert.deepEqual(requests, []);
  const button = container.querySelector<HTMLButtonElement>(
    '.zmd-board-style-bar [aria-label="View annotations"]',
  );
  assert.ok(button);
  assert.equal(buttonRef.current, button);
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  await act(async () => button.click());
  assert.deepEqual(requests, ["source-pdf"]);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.doesNotMatch(
    renderToStaticMarkup(
      createElement(PropertiesPanel, {
        labels,
        node,
        onOpen: () => undefined,
        onRefreshSource: () => undefined,
        onCopy: () => undefined,
        onDelete: () => undefined,
      }),
    ),
    /View annotations/,
    "card details must not duplicate the toolbar action",
  );
});

test("drawing previews appear in cards, picker and properties without the missing-text hint", () => {
  const image = "data:image/png;base64,aGVsbG8=";
  for (const annotationType of ["image", "ink"] as const) {
    const model = quote({ text: "", image, annotationType });
    const node = canvasDocumentToFlow({
      version: 2,
      nodes: [model],
      connections: [],
    }).nodes[0];
    const card = renderNode(model);
    const properties = renderToStaticMarkup(
      createElement(PropertiesPanel, {
        labels,
        node,
        onOpen: () => undefined,
        onRefreshSource: () => undefined,
        onCopy: () => undefined,
        onDelete: () => undefined,
      }),
    );
    const browser = renderToStaticMarkup(
      createElement(AnnotationBrowser, {
        labels: browserLabels,
        state: {
          status: "ready",
          candidates: [
            {
              acquisition: {
                kind: "quote",
                source: model.source,
                snapshot: model.snapshot,
              },
              attachmentTitle: "Paper.pdf",
              sortIndex: "1",
            },
          ],
          failures: [],
        },
        query: "",
        selectedKeys: new Set<string>(),
        existingKeys: new Set<string>(),
        onQueryChange: () => undefined,
        onSelectionChange: () => undefined,
        onToggle: () => undefined,
        onClose: () => undefined,
        onFocusExisting: () => undefined,
        onAddSelected: () => undefined,
      }),
    );
    for (const markup of [card, properties, browser]) {
      assert.match(markup, /<img[^>]+src="data:image\/png;base64,aGVsbG8="/);
      assert.match(markup, new RegExp(`alt="${typeLabels[annotationType]}"`));
      assert.doesNotMatch(markup, /Open the source to view this annotation/);
    }
  }
});
