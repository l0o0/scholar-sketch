import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnnotationBrowser,
  existingAnnotationKeys,
  filterAnnotationCandidates,
  groupAnnotationCandidates,
  toggleAnnotationSelection,
  type AnnotationBrowserLabels,
} from "../packages/whiteboard/src/chrome/AnnotationBrowser.tsx";
import { PropertiesPanel } from "../packages/whiteboard/src/chrome/PropertiesPanel.tsx";
import { StyleBar } from "../packages/whiteboard/src/chrome/StyleBar.tsx";
import {
  quoteAttachmentIdentity,
  nativeAnnotationIdentity,
} from "../packages/whiteboard/src/model/academic.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import type {
  AnnotationCandidate,
  AnnotationListFailure,
  WhiteboardLabels,
} from "../packages/whiteboard/src/model/protocol.ts";
import { canvasDocumentToFlow } from "../packages/whiteboard/src/whiteboard/document.ts";
import {
  acceptAnnotationListFailure,
  closeAnnotationBrowserSession,
  openAnnotationBrowserSession,
  replaceDocumentAnnotationBrowserSession,
} from "../packages/whiteboard/src/whiteboard/annotationBrowserState.ts";

test("closed, replaced, reopened, and source-mismatched annotation failures are inert", () => {
  const source = { library: { type: "user" as const }, itemKey: "ITEM1234" };
  const failure = {
    code: "list-failed" as const,
    message: "host diagnostic",
  };
  const open = openAnnotationBrowserSession("request-1", source);
  const closed = closeAnnotationBrowserSession(open);
  assert.equal(
    acceptAnnotationListFailure(closed, "request-1", source, failure),
    closed,
  );
  const replaced = replaceDocumentAnnotationBrowserSession(open);
  assert.equal(
    acceptAnnotationListFailure(replaced, "request-1", source, failure),
    replaced,
  );
  const reopened = openAnnotationBrowserSession("request-2", source);
  assert.equal(
    acceptAnnotationListFailure(reopened, "request-1", source, failure),
    reopened,
  );
  assert.equal(
    acceptAnnotationListFailure(
      reopened,
      "request-2",
      { library: { type: "user" }, itemKey: "OTHER123" },
      failure,
    ),
    reopened,
  );
});

const browserLabels: AnnotationBrowserLabels = {
  title: "Annotations",
  search: "Search annotations",
  loading: "Loading annotations…",
  empty: "No supported annotations",
  unavailable: "Annotations unavailable",
  partialFailure: "Some annotations could not be loaded",
  alreadyAdded: "Already added",
  focusExisting: "Focus existing",
  addSelected: "Add selected",
  page: "Page",
  close: "Close",
};

function candidate(
  annotationKey: string,
  attachmentTitle: string,
  text: string,
  options: {
    comment?: string;
    pageLabel?: string;
    color?: string;
    library?: { type: "user" } | { type: "group"; groupID: number };
    itemKey?: string;
    attachmentKey?: string;
  } = {},
): AnnotationCandidate {
  return {
    attachmentTitle,
    sortIndex: annotationKey,
    acquisition: {
      kind: "quote",
      source: {
        library: options.library ?? { type: "user" },
        itemKey: options.itemKey ?? "ITEM1234",
        attachmentKey: options.attachmentKey ?? `PDF-${attachmentTitle}`,
        annotationKey,
      },
      snapshot: { text, ...options },
    },
  };
}

const candidates = [
  candidate("ANN1", "Methods.pdf", "Prior evidence", {
    comment: "Background",
    pageLabel: "4",
    color: "#ffd400",
  }),
  candidate("ANN2", "Results.pdf", "Strong result", {
    comment: "Method implication",
    pageLabel: "12",
  }),
  candidate("ANN3", "Methods.pdf", "Later excerpt", { pageLabel: "19" }),
];

const document: CanvasDocument = {
  version: 2,
  nodes: [
    {
      id: "literature",
      kind: "literature",
      position: { x: 0, y: 0 },
      width: 280,
      height: 200,
      source: { library: { type: "user" }, itemKey: "ITEM1234" },
      snapshot: { title: "Paper" },
    },
    {
      id: "quote-one",
      kind: "quote",
      position: { x: 320, y: 0 },
      width: 280,
      height: 192,
      source: {
        library: { type: "user" },
        itemKey: "OTHER",
        attachmentKey: "OTHER-PDF",
        annotationKey: "ANN1",
      },
      snapshot: { text: "Already here" },
    },
  ],
  connections: [],
};

function browser(
  overrides: Partial<Parameters<typeof AnnotationBrowser>[0]> = {},
) {
  return createElement(AnnotationBrowser, {
    labels: browserLabels,
    state: { status: "ready", candidates, failures: [] },
    query: "",
    selectedKeys: new Set<string>(),
    existingKeys: existingAnnotationKeys(document),
    returnFocusRef: { current: null },
    onQueryChange: () => undefined,
    onSelectionChange: () => undefined,
    onToggle: () => undefined,
    onClose: () => undefined,
    onFocusExisting: () => undefined,
    onAddSelected: () => undefined,
    ...overrides,
  });
}

test("filters text, comment, and page label case-insensitively", () => {
  assert.deepEqual(
    filterAnnotationCandidates(candidates, "METHOD").map(
      (item) => item.acquisition.source.annotationKey,
    ),
    ["ANN2"],
  );
  assert.deepEqual(
    filterAnnotationCandidates(candidates, "prior").map(
      (item) => item.acquisition.source.annotationKey,
    ),
    ["ANN1"],
  );
  assert.deepEqual(
    filterAnnotationCandidates(candidates, "19").map(
      (item) => item.acquisition.source.annotationKey,
    ),
    ["ANN3"],
  );
});

test("groups by full attachment identity without changing gateway order or title", () => {
  const sameTitle = [
    candidate("ANN-A1", "Paper.pdf", "First attachment", {
      attachmentKey: "PDF-A",
    }),
    candidate("ANN-B1", "Paper.pdf", "Second attachment", {
      attachmentKey: "PDF-B",
    }),
    candidate("ANN-A2", "Paper.pdf", "First attachment later", {
      attachmentKey: "PDF-A",
    }),
  ];
  assert.deepEqual(
    groupAnnotationCandidates(sameTitle).map((group) => ({
      title: group.attachmentTitle,
      identity: group.attachmentIdentity,
      keys: group.candidates.map(
        (item) => item.acquisition.source.annotationKey,
      ),
    })),
    [
      {
        title: "Paper.pdf",
        identity: quoteAttachmentIdentity(sameTitle[0].acquisition.source),
        keys: ["ANN-A1", "ANN-A2"],
      },
      {
        title: "Paper.pdf",
        identity: quoteAttachmentIdentity(sameTitle[1].acquisition.source),
        keys: ["ANN-B1"],
      },
    ],
  );
});

test("uses native annotation identity for duplicates across attachment reparenting", () => {
  const existing = document.nodes[1];
  assert.equal(existing.kind, "quote");
  assert.deepEqual(
    existingAnnotationKeys(document),
    new Set(['["annotation","user",null,"OTHER-PDF","ANN1"]']),
  );
  assert.notEqual(
    nativeAnnotationIdentity(candidates[0].acquisition.source),
    nativeAnnotationIdentity(existing.source),
  );
});

test("supports checkbox multi-selection without selecting duplicate keys", () => {
  const ann2 = nativeAnnotationIdentity(candidates[1].acquisition.source);
  const ann3 = nativeAnnotationIdentity(candidates[2].acquisition.source);
  const first = toggleAnnotationSelection(new Set<string>(), ann2, true);
  const second = toggleAnnotationSelection(first, ann3, true);
  const removed = toggleAnnotationSelection(second, ann2, false);
  assert.deepEqual(second, new Set([ann2, ann3]));
  assert.deepEqual(removed, new Set([ann3]));

  const markup = renderToStaticMarkup(browser({ selectedKeys: second }));
  assert.equal(markup.match(/type="checkbox"/g)?.length, 3);
  assert.equal(markup.match(/checked=""/g)?.length, 2);
});

test("renders an accessible dialog and duplicate focus action", () => {
  const duplicate = candidate("ANN1", "Other.pdf", "Duplicate source", {
    itemKey: "NEW-PARENT",
    attachmentKey: "OTHER-PDF",
  });
  const markup = renderToStaticMarkup(
    browser({
      state: { status: "ready", candidates: [duplicate], failures: [] },
    }),
  );
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-label="Search annotations"/);
  assert.match(markup, /type="checkbox"[^>]*disabled/);
  assert.match(markup, /Already added/);
  assert.match(markup, />Focus existing</);
  assert.match(markup, /Other\.pdf[\s\S]*Duplicate source/);
});

test("renders loading, empty, unavailable, and partial-failure states", () => {
  assert.match(
    renderToStaticMarkup(browser({ state: { status: "loading" } })),
    /Loading annotations/,
  );
  assert.match(
    renderToStaticMarkup(
      browser({ state: { status: "ready", candidates: [], failures: [] } }),
    ),
    /No supported annotations/,
  );
  const unavailable: AnnotationListFailure = {
    code: "item-missing",
    message: "The Zotero item is unavailable.",
  };
  assert.match(
    renderToStaticMarkup(
      browser({ state: { status: "unavailable", failure: unavailable } }),
    ),
    /Annotations unavailable/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(
      browser({ state: { status: "unavailable", failure: unavailable } }),
    ),
    /The Zotero item is unavailable/,
    "host diagnostics must not leak into visible DOM attributes",
  );
  assert.match(
    renderToStaticMarkup(
      browser({
        state: {
          status: "ready",
          candidates: [candidates[1]],
          failures: [{ code: "list-failed", message: "One PDF failed" }],
        },
      }),
    ),
    /Some annotations could not be loaded[\s\S]*Strong result/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(
      browser({
        state: {
          status: "ready",
          candidates: [candidates[1]],
          failures: [{ code: "list-failed", message: "One PDF failed" }],
        },
      }),
    ),
    /One PDF failed/,
  );
});

test("Add selected is disabled only when no eligible annotation is selected", () => {
  const none = renderToStaticMarkup(browser());
  const selected = renderToStaticMarkup(
    browser({
      selectedKeys: new Set([
        nativeAnnotationIdentity(candidates[1].acquisition.source),
        nativeAnnotationIdentity(candidates[2].acquisition.source),
      ]),
    }),
  );
  assert.match(none, /<button[^>]*disabled=""[^>]*>Add selected<\/button>/);
  assert.doesNotMatch(
    selected,
    /<button[^>]*disabled=""[^>]*>Add selected<\/button>/,
  );
});

test("Literature exposes annotations in its selection toolbar, without a duplicate details action", () => {
  const literature = canvasDocumentToFlow(document).nodes[0];
  const quote = canvasDocumentToFlow(document).nodes[1];
  const labels = {
    ...({} as WhiteboardLabels),
    kindLiterature: "Literature",
    kindQuote: "Quote",
    sourceStatus: "Source status",
    sourceAvailable: "Available",
    sourceLoading: "Loading",
    sourceMissing: "Unavailable",
    editText: "Edit",
    viewAnnotations: "View annotations",
    copy: "Copy",
    delete: "Delete",
  };
  const renderPanel = (node: typeof literature) =>
    createElement(PropertiesPanel, {
      labels,
      node,
      sourceState: { status: "resolved" },
      onOpen: () => undefined,
      onRefreshSource: () => undefined,
      onCopy: () => undefined,
      onDelete: () => undefined,
    });
  const literaturePanel = renderPanel(literature);
  const quotePanel = renderPanel(quote);
  assert.doesNotMatch(
    renderToStaticMarkup(literaturePanel),
    /View annotations/,
  );
  assert.doesNotMatch(renderToStaticMarkup(quotePanel), /View annotations/);
  let requests = 0;
  const renderToolbar = (node: typeof literature) =>
    renderToStaticMarkup(
      createElement(StyleBar, {
        labels,
        node,
        left: 0,
        top: 0,
        theme: "light",
        onViewAnnotations: () => requests++,
        onChange: () => undefined,
      }),
    );
  assert.match(renderToolbar(literature), /aria-label="View annotations"/);
  assert.doesNotMatch(renderToolbar(quote), /aria-label="View annotations"/);
  assert.equal(requests, 0, "rendering must not request annotations");
});
