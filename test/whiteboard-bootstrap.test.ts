import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import {
  createDeferredLabels,
  forwardAcademicParentMessage,
} from "../packages/whiteboard/src/bootstrapState.ts";
import {
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
  dispatchWhiteboardParentMessageEvent,
  type AcademicAcquisition,
  type AnnotationCandidate,
  type ParentToWhiteboardMessage,
} from "../packages/whiteboard/src/model/protocol.ts";
import type { WhiteboardLabels } from "../packages/whiteboard/src/model/protocol.ts";
import {
  canvasDocumentToFlow,
  flowToCanvasDocument,
} from "../packages/whiteboard/src/whiteboard/document.ts";
import { createWhiteboardEditor } from "../src/modules/whiteboard/editor.ts";

const bootstrap = readFileSync(
  new URL("../packages/whiteboard/src/bootstrap.tsx", import.meta.url),
  "utf8",
);
const editor = readFileSync(
  new URL("../src/modules/whiteboard/editor.ts", import.meta.url),
  "utf8",
);

test("labels received before runtime readiness are replayed on attachment", () => {
  const initial = { canvas: "Localized canvas" } as WhiteboardLabels;
  const replacement = { canvas: "Updated canvas" } as WhiteboardLabels;
  const received: WhiteboardLabels[] = [];
  const deferred = createDeferredLabels();

  deferred.receive(initial);
  assert.deepEqual(received, []);
  deferred.attach({ setLabels: (labels) => received.push(labels) });
  assert.deepEqual(received, [initial]);

  deferred.receive(replacement);
  assert.deepEqual(received, [initial, replacement]);
});

test("protocol-v2 academic acquisition is forwarded across both bridge sides", () => {
  assert.match(bootstrap, /forwardAcademicParentMessage\(runtime, data\)/);
  assert.match(bootstrap, /type: "pickAcademicSource"/);
  assert.match(bootstrap, /type: "dropAcademicSources"/);

  assert.match(editor, /resolveAcademicAcquisitionBatch\(/);
  assert.match(editor, /type: "academicSourcesAcquired"/);
  assert.match(editor, /rejectAcademicRequest\(/);
  assert.match(editor, /type: "academicRequestFailed"/);
  assert.match(editor, /case "pickAcademicSource"/);
  assert.match(editor, /case "dropAcademicSources"/);
  assert.match(bootstrap, /onResolveAcademicSources/);
  assert.match(
    bootstrap,
    /onResolveAcademicSources=\{\(requestId, generation, priority, sources\)/,
  );
  assert.match(
    bootstrap,
    /payload: \{ requestId, generation, priority, sources \}/,
  );
  assert.match(editor, /case "resolveAcademicSources"/);
  assert.match(editor, /data\.payload\.priority/);
  assert.match(editor, /applySourceResolutionBatch/);
  assert.match(editor, /type: "sourceResolutionBatch"/);
  assert.match(bootstrap, /type: "refreshZoteroNote"/);
  assert.match(editor, /case "refreshZoteroNote"/);
  assert.match(editor, /type: "noteRefreshed"/);
  assert.match(bootstrap, /type: "listLiteratureAnnotations"/);
  assert.match(editor, /case "listLiteratureAnnotations"/);
  assert.match(editor, /type: "annotationsListed"/);
  assert.match(editor, /type: "annotationListFailed"/);
  assert.match(editor, /type: "sourceActionFailed"/);
});

test("academic bridge dispatch invokes the correlated runtime methods", () => {
  const acquisition: AcademicAcquisition = {
    kind: "literature",
    source: { library: { type: "user" }, itemKey: "ABCD2345" },
    snapshot: { title: "A paper" },
  };
  const calls: unknown[] = [];
  const runtime = {
    resolveAcademicAcquisitionBatch: (...args: unknown[]) =>
      calls.push(["resolve-batch", ...args]),
    rejectAcademicRequest: (...args: unknown[]) =>
      calls.push(["reject", ...args]),
    rejectSourceAction: (...args: unknown[]) =>
      calls.push(["source-action-failure", ...args]),
    acceptSourceAction: (...args: unknown[]) =>
      calls.push(["source-action-success", ...args]),
    applySourceResolutionBatch: (...args: unknown[]) =>
      calls.push(["resolution", ...args]),
    applyNoteRefresh: (...args: unknown[]) =>
      calls.push(["note-refresh", ...args]),
    applyAnnotationCandidates: (...args: unknown[]) =>
      calls.push(["annotations", ...args]),
    rejectAnnotationList: (...args: unknown[]) =>
      calls.push(["annotation-failure", ...args]),
  };
  const acquired: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "academicSourcesAcquired",
    payload: {
      requestId: "pick-1",
      nodeId: "node-1",
      successes: [{ index: 0, acquisition }],
      failures: [],
    },
  };
  const rejected: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "academicRequestFailed",
    payload: {
      requestId: "pick-2",
      nodeId: "node-2",
      code: "picker-cancelled",
    },
  };
  const acquiredBatch: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "academicSourcesAcquired",
    payload: {
      requestId: "drop-1",
      nodeId: "drop-node",
      successes: [{ index: 0, acquisition }],
      failures: [
        {
          index: 1,
          code: "unsupported-attachment",
          message: "Unsupported attachment",
        },
      ],
    },
  };
  const sourceActionFailed: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "sourceActionFailed",
    payload: {
      requestId: "open-1",
      nodeId: "node-1",
      source: { kind: "literature", source: acquisition.source },
      failure: { code: "open-failed", message: "Could not open" },
    },
  };
  const sourceActionSucceeded: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "sourceActionSucceeded",
    payload: {
      requestId: "open-2",
      nodeId: "node-1",
      action: "open",
      source: { kind: "literature", source: acquisition.source },
    },
  };
  const resolution: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "sourceResolutionBatch",
    payload: {
      requestId: "resolution-1",
      generation: 4,
      results: [
        {
          nodeId: "node-3",
          generation: 4,
          status: "unavailable",
          code: "item-missing",
          message: "Missing",
        },
      ],
    },
  };
  const noteRefresh: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "noteRefreshed",
    payload: {
      requestId: "refresh-1",
      nodeId: "node-4",
      acquisition: {
        kind: "note",
        source: { library: { type: "user" }, noteKey: "NOTE1234" },
        content: "Current Zotero text",
      },
    },
  };
  const annotation: AnnotationCandidate = {
    attachmentTitle: "Paper.pdf",
    sortIndex: "00001",
    acquisition: {
      kind: "quote",
      source: {
        library: { type: "user" },
        itemKey: "ITEM1234",
        attachmentKey: "PDF12345",
        annotationKey: "ANN12345",
      },
      snapshot: { text: "Evidence", pageLabel: "8" },
    },
  };
  const annotationsListed: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "annotationsListed",
    payload: {
      requestId: "annotations-1",
      source: { library: { type: "user" }, itemKey: "ITEM1234" },
      candidates: [annotation],
      failures: [],
    },
  };
  const annotationListFailed: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "annotationListFailed",
    payload: {
      requestId: "annotations-2",
      source: { library: { type: "user" }, itemKey: "ITEM1234" },
      failure: { code: "item-missing", message: "Missing" },
    },
  };

  assert.equal(forwardAcademicParentMessage(runtime, acquired), true);
  assert.equal(forwardAcademicParentMessage(runtime, acquiredBatch), true);
  assert.equal(forwardAcademicParentMessage(runtime, rejected), true);
  assert.equal(forwardAcademicParentMessage(runtime, sourceActionFailed), true);
  assert.equal(
    forwardAcademicParentMessage(runtime, sourceActionSucceeded),
    true,
  );
  assert.equal(forwardAcademicParentMessage(runtime, resolution), true);
  assert.equal(forwardAcademicParentMessage(runtime, noteRefresh), true);
  assert.equal(forwardAcademicParentMessage(runtime, annotationsListed), true);
  assert.equal(
    forwardAcademicParentMessage(runtime, annotationListFailed),
    true,
  );
  assert.deepEqual(calls, [
    ["resolve-batch", "pick-1", "node-1", acquired.payload.successes, []],
    [
      "resolve-batch",
      "drop-1",
      "drop-node",
      acquiredBatch.payload.successes,
      acquiredBatch.payload.failures,
    ],
    ["reject", "pick-2", "node-2", "picker-cancelled"],
    [
      "source-action-failure",
      "open-1",
      "node-1",
      sourceActionFailed.payload.source,
      sourceActionFailed.payload.failure,
    ],
    [
      "source-action-success",
      "open-2",
      "node-1",
      "open",
      sourceActionSucceeded.payload.source,
    ],
    ["resolution", 4, resolution.payload.results],
    ["note-refresh", "refresh-1", "node-4", noteRefresh.payload.acquisition],
    [
      "annotations",
      "annotations-1",
      annotationsListed.payload.source,
      [annotation],
      [],
    ],
    [
      "annotation-failure",
      "annotations-2",
      annotationListFailed.payload.source,
      annotationListFailed.payload.failure,
    ],
  ]);
  assert.equal(JSON.stringify(annotationsListed).includes('"itemID"'), false);
  assert.equal(
    JSON.stringify(annotationsListed).includes('"attachmentID"'),
    false,
  );
});

test("both bridge listeners validate their envelope before allowing a null Zotero chrome source", () => {
  assert.match(bootstrap, /dispatchWhiteboardParentMessageEvent/);
  assert.match(bootstrap, /window\.parent/);
  assert.match(
    editor,
    /readWhiteboardToParentMessageEvent\(\s*event,\s*iframe\.contentWindow,\s*channel,?\s*\)/,
  );
  assert.match(bootstrap, /reactRoot\?\.unmount\(\)/);
});

test("iframe ingress accepts validated null-source parent messages and rejects forged traffic", () => {
  const messageRealm = new Window({ url: "https://parent.example" });
  const parent = {} as WindowProxy;
  const accepted: ParentToWhiteboardMessage[] = [];
  const init: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "tab-1:canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "init",
    payload: { theme: "dark", snapshot: null },
  };

  assert.equal(
    dispatchWhiteboardParentMessageEvent(
      {
        source: null,
        data: messageRealm.eval(`(${JSON.stringify(init)})`),
      },
      parent,
      "tab-1:canvas-1",
      (message) => accepted.push(message),
    ),
    true,
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].type, "init");
  assert.equal(accepted[0].payload.theme, "dark");

  for (const data of [
    { ...init, source: "forged" },
    { ...init, channel: "other" },
    { ...init, v: 1 },
    { ...init, type: "executeArbitraryCommand" },
    { ...init, payload: { theme: "sepia" } },
    Object.create({ ...init }),
  ]) {
    assert.equal(
      dispatchWhiteboardParentMessageEvent(
        { source: null, data },
        parent,
        "tab-1:canvas-1",
        (message) => accepted.push(message),
      ),
      false,
    );
  }
  assert.equal(
    dispatchWhiteboardParentMessageEvent(
      { source: {} as WindowProxy, data: init },
      parent,
      "tab-1:canvas-1",
      (message) => accepted.push(message),
    ),
    false,
  );
  assert.equal(
    dispatchWhiteboardParentMessageEvent(
      { source: parent, data: init },
      parent,
      "tab-1:canvas-1",
      (message) => accepted.push(message),
    ),
    true,
  );
  assert.equal(accepted.length, 2);
  assert.deepEqual(accepted[1], init);

  const focus: ParentToWhiteboardMessage = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "tab-1:canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "focus",
  };
  let liveDataReads = 0;
  assert.equal(
    dispatchWhiteboardParentMessageEvent(
      {
        source: null,
        get data() {
          liveDataReads += 1;
          return liveDataReads === 1 ? focus : init;
        },
      },
      parent,
      "tab-1:canvas-1",
      (message) => accepted.push(message),
    ),
    true,
  );
  assert.equal(liveDataReads, 1, "ingress must snapshot event.data once");
  assert.equal(
    accepted.at(-1)?.type,
    "focus",
    "validated focus must not mutate into init before dispatch",
  );

  const nativeStructuredClone = globalThis.structuredClone;
  assert.equal(typeof nativeStructuredClone, "function");
  let structuredCloneCalls = 0;
  globalThis.structuredClone = ((value: unknown) => {
    structuredCloneCalls += 1;
    return nativeStructuredClone(value);
  }) as typeof structuredClone;
  try {
    assert.equal(
      dispatchWhiteboardParentMessageEvent(
        { source: null, data: focus },
        parent,
        "tab-1:canvas-1",
        (message) => accepted.push(message),
      ),
      true,
    );
  } finally {
    globalThis.structuredClone = nativeStructuredClone;
  }
  assert.equal(
    structuredCloneCalls,
    1,
    "supported Zotero/Firefox realms must use the platform structured clone",
  );

  const cloneDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "structuredClone",
  );
  assert.ok(cloneDescriptor);
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    value: undefined,
    writable: true,
  });
  const fallbackInit: ParentToWhiteboardMessage = {
    ...init,
    payload: {
      theme: "dark",
      snapshot: {
        version: 2,
        nodes: [],
        connections: [],
        extensions: { values: [undefined] },
      },
    },
  };
  try {
    assert.equal(
      dispatchWhiteboardParentMessageEvent(
        { source: null, data: fallbackInit },
        parent,
        "tab-1:canvas-1",
        (message) => accepted.push(message),
      ),
      true,
    );
  } finally {
    Object.defineProperty(globalThis, "structuredClone", cloneDescriptor);
  }
  const fallbackAccepted = accepted.at(-1);
  assert.notEqual(fallbackAccepted, fallbackInit);
  assert.equal(fallbackAccepted?.type, "init");
  assert.equal(
    fallbackAccepted?.type === "init" &&
      (fallbackAccepted.payload.snapshot?.extensions?.values as unknown[])[0],
    undefined,
    "fallback cloning must preserve explicit undefined array positions",
  );

  const handlerFailure = new Error("valid runtime handler failure");
  assert.throws(
    () =>
      dispatchWhiteboardParentMessageEvent(
        { source: null, data: focus },
        parent,
        "tab-1:canvas-1",
        () => {
          throw handlerFailure;
        },
      ),
    handlerFailure,
    "valid handler failures must escape the validation boundary",
  );
  messageRealm.close();
});

test("host-owned iframe drop capture emits native refs and cleans up listeners", async () => {
  const module =
    (await import("../src/modules/whiteboard/editor.ts")) as typeof import("../src/modules/whiteboard/editor.ts") & {
      attachNativeAcademicDropListeners?: (
        target: {
          addEventListener(
            type: string,
            listener: (event: DragEvent) => void,
          ): void;
          removeEventListener(
            type: string,
            listener: (event: DragEvent) => void,
          ): void;
        },
        resolve: () => {
          status: "accepted";
          sources: Array<{
            library: { type: "user" };
            itemKey: string;
          }>;
        },
        emit: (drop: unknown) => void,
      ) => () => void;
    };
  assert.equal(typeof module.attachNativeAcademicDropListeners, "function");
  const listeners = new Map<string, (event: DragEvent) => void>();
  const removed: string[] = [];
  const target = {
    addEventListener(type: string, listener: (event: DragEvent) => void) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      removed.push(type);
      listeners.delete(type);
    },
  };
  const emitted: unknown[] = [];
  const sources = [{ library: { type: "user" as const }, itemKey: "ITEM1234" }];
  const cleanup = module.attachNativeAcademicDropListeners!(
    target,
    () => ({ status: "accepted", sources }),
    (drop) => emitted.push(drop),
  );
  let prevented = 0;
  let stopped = 0;
  const event = {
    dataTransfer: { types: ["zotero/item"], dropEffect: "none" },
    clientX: 40,
    clientY: 70,
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  } as unknown as DragEvent;
  listeners.get("dragover")?.(event);
  listeners.get("drop")?.(event);
  assert.deepEqual(emitted, [{ position: { x: 40, y: 70 }, sources }]);
  assert.equal(prevented, 2);
  assert.equal(stopped, 2);
  cleanup();
  assert.deepEqual(removed.sort(), ["dragenter", "dragover", "drop"]);
});

test("native drop capture converts resolver exceptions into typed diagnostics", async () => {
  const module = await import("../src/modules/whiteboard/editor.ts");
  const listeners = new Map<string, (event: DragEvent) => void>();
  const emitted: unknown[] = [];
  const cleanup = module.attachNativeAcademicDropListeners(
    {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      removeEventListener(type) {
        listeners.delete(type);
      },
    },
    () => {
      throw new Error("native resolver exploded");
    },
    (drop) => emitted.push(drop),
  );
  listeners.get("drop")?.({
    dataTransfer: { types: ["zotero/item"] },
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as DragEvent);
  assert.deepEqual(emitted, [
    {
      code: "drop-malformed",
      diagnostic: "native resolver exploded",
    },
  ]);
  cleanup();
});

function installProductionEditorWindow(t: {
  after(callback: () => void): void;
}) {
  const window = new Window({ url: "https://example.test" });
  const globalKeys = [
    "addon",
    "ztoolkit",
    "__zoteroMarkdownDOMGlobalsInjected",
    "window",
    "self",
    "document",
    "HTMLElement",
    "HTMLDivElement",
    "HTMLSpanElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "Element",
    "Node",
    "Text",
    "DocumentFragment",
    "DOMParser",
    "Range",
    "Selection",
    "NodeFilter",
    "MutationObserver",
    "ResizeObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getSelection",
    "CSS",
    "CSSStyleSheet",
    "CustomEvent",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "FocusEvent",
    "InputEvent",
  ];
  const previous = new Map(
    globalKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "addon", {
    configurable: true,
    value: { data: { config: { addonRef: "bamboo" } } },
  });
  Object.defineProperty(globalThis, "ztoolkit", {
    configurable: true,
    value: { log: () => undefined },
  });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    window.close();
  });
  return window;
}

test("production editor rebinds native drop ownership on iframe reload and releases it on destroy", (t) => {
  const window = installProductionEditorWindow(t);
  const parent = window.document.createElement("div");
  window.document.body.append(parent);
  let resolveCount = 0;
  const rejected: Array<[string, string, string | undefined]> = [];
  const handle = createWhiteboardEditor(parent as unknown as HTMLElement, {
    win: window as unknown as globalThis.Window,
    channel: "tab-1:canvas-1",
    resolveNativeAcademicDrop: () => {
      resolveCount += 1;
      return resolveCount === 1
        ? {
            status: "accepted" as const,
            sources: [
              { library: { type: "user" as const }, itemKey: "ITEM1234" },
            ],
          }
        : {
            status: "rejected" as const,
            code: "drop-malformed" as const,
            diagnostic: "native transfer exception",
          };
    },
    onNativeAcademicDropRejected: (requestId, code, diagnostic) =>
      rejected.push([requestId, code, diagnostic]),
  });
  const iframe = parent.querySelector("iframe")!;
  const contentDocument = iframe.contentDocument!;
  const dispatchDrop = () => {
    const event = new window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      dataTransfer: {
        value: { types: ["zotero/item"], dropEffect: "none" },
      },
      clientX: { value: 20 },
      clientY: { value: 30 },
    });
    contentDocument.dispatchEvent(event);
  };

  iframe.dispatchEvent(new window.Event("load"));
  dispatchDrop();
  assert.equal(resolveCount, 1);
  iframe.dispatchEvent(new window.Event("load"));
  dispatchDrop();
  assert.equal(resolveCount, 2, "reload must not duplicate drop listeners");
  assert.equal(rejected.length, 1);
  assert.match(rejected[0][0], /^drop-/);
  assert.deepEqual(rejected[0].slice(1), [
    "drop-malformed",
    "native transfer exception",
  ]);

  handle.destroy();
  dispatchDrop();
  assert.equal(resolveCount, 2, "destroy must detach the active document");
  assert.equal(parent.childElementCount, 0);
});

test("production editor accepts strictly validated null-source Zotero messages", (t) => {
  const window = installProductionEditorWindow(t);
  const wrongWindow = new Window({ url: "https://forged.example" });
  t.after(() => {
    wrongWindow.close();
  });

  const parent = window.document.createElement("div");
  window.document.body.append(parent);
  const resolved: string[] = [];
  const opened: unknown[] = [];
  const savedTemplates: unknown[] = [];
  const deletedTemplates: string[] = [];
  const template = {
    id: "custom-template",
    name: "Review",
    style: { fill: "#fff7d6" },
    updatedAt: "2026-09-06T01:00:00.000Z",
  };
  const handle = createWhiteboardEditor(parent as unknown as HTMLElement, {
    win: window as unknown as globalThis.Window,
    channel: "tab-1:canvas-1",
    templates: [template],
    onSaveNoteTemplate: (value) => savedTemplates.push(value),
    onDeleteNoteTemplate: (templateId) => deletedTemplates.push(templateId),
    onResolveAcademicSources: (requestId) => resolved.push(requestId),
    onOpenItem: (payload) => opened.push(payload),
  });
  const iframe = parent.querySelector("iframe")!;
  const posted: unknown[] = [];
  iframe.contentWindow!.postMessage = ((message: unknown) => {
    posted.push(message);
  }) as typeof iframe.contentWindow.postMessage;
  const ready = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "tab-1:canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "ready",
  };
  const resolve = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "tab-1:canvas-1",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "resolveAcademicSources",
    payload: {
      requestId: "resolve-null",
      generation: 3,
      priority: "selected",
      sources: [
        {
          nodeId: "node-1",
          source: {
            kind: "literature",
            source: {
              library: { type: "user" },
              itemKey: "ITEM1234",
            },
          },
        },
      ],
    },
  };
  const crossRealmReady = wrongWindow.eval(
    `(${JSON.stringify(ready)})`,
  ) as unknown;
  const crossRealmResolve = wrongWindow.eval(
    `(${JSON.stringify(resolve)})`,
  ) as unknown;
  const dispatch = (data: unknown, source: WindowProxy | null) =>
    window.dispatchEvent(new window.MessageEvent("message", { data, source }));

  dispatch(crossRealmReady, null);
  assert.equal(
    (posted[0] as { type?: string } | undefined)?.type,
    "init",
    "null-source ready must initialize the production iframe bridge",
  );
  assert.equal(
    Object.hasOwn(
      (posted[0] as { payload: Record<string, unknown> }).payload,
      "labels",
    ),
    false,
    "optional undefined init fields must not cross the protocol boundary",
  );
  assert.deepEqual(
    (posted[0] as { payload: { templates: unknown[] } }).payload.templates,
    [template],
  );
  handle.setTemplates([]);
  assert.equal(
    (posted.at(-1) as { type: string }).type,
    "noteTemplatesChanged",
  );

  dispatch(
    {
      source: WHITEBOARD_MESSAGE_SOURCE,
      channel: "tab-1:canvas-1",
      v: WHITEBOARD_PROTOCOL_VERSION,
      type: "saveNoteTemplate",
      payload: { template },
    },
    null,
  );
  dispatch(
    {
      source: WHITEBOARD_MESSAGE_SOURCE,
      channel: "tab-1:canvas-1",
      v: WHITEBOARD_PROTOCOL_VERSION,
      type: "deleteNoteTemplate",
      payload: { templateId: template.id },
    },
    null,
  );
  assert.deepEqual(savedTemplates, [template]);
  assert.deepEqual(deletedTemplates, [template.id]);
  dispatch(crossRealmResolve, null);
  assert.deepEqual(resolved, ["resolve-null"]);

  let typeReads = 0;
  const mutableReady = { ...ready, payload: { itemID: 77 } };
  const statefulHostileMessage = new Proxy(mutableReady, {
    get(target, key, receiver) {
      if (key === "type") return ++typeReads <= 2 ? "ready" : "openItem";
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === "payload" && typeReads <= 2) return undefined;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    has(target, key) {
      if (key === "payload" && typeReads <= 2) return false;
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(
        (key) => key !== "payload" || typeReads > 2,
      );
    },
  });
  assert.doesNotThrow(() => dispatch(statefulHostileMessage, null));
  assert.deepEqual(
    opened,
    [],
    "validated ready must not mutate into openItem before consumption",
  );
  assert.deepEqual(resolved, ["resolve-null"]);

  for (const data of [
    { ...resolve, source: "forged" },
    { ...resolve, channel: "other" },
    { ...resolve, v: 1 },
    { ...resolve, type: "executeArbitraryCommand" },
    { ...resolve, payload: { ...resolve.payload, sources: "forged" } },
    Object.create(resolve),
    Object.assign(Object.create({ forged: true }), resolve),
    { ...resolve, payload: window.document.body },
  ]) {
    dispatch(data, null);
  }
  dispatch(resolve, wrongWindow as unknown as WindowProxy);
  assert.deepEqual(resolved, ["resolve-null"]);

  dispatch(
    {
      ...resolve,
      payload: { ...resolve.payload, requestId: "resolve-exact" },
    },
    iframe.contentWindow,
  );
  assert.deepEqual(resolved, ["resolve-null", "resolve-exact"]);

  handle.destroy();
  dispatch(
    {
      ...resolve,
      payload: { ...resolve.payload, requestId: "resolve-after-destroy" },
    },
    null,
  );
  assert.deepEqual(resolved, ["resolve-null", "resolve-exact"]);
});

test("flow snapshots with ordinary unlabeled edges resolve host snapshot requests and save", async (t) => {
  const window = installProductionEditorWindow(t);
  const parent = window.document.createElement("div");
  window.document.body.append(parent);
  let saves = 0;
  const handle = createWhiteboardEditor(parent as unknown as HTMLElement, {
    win: window as unknown as globalThis.Window,
    channel: "tab-1:canvas-1",
    onSave: () => {
      saves += 1;
    },
  });
  t.after(() => handle.destroy());
  const iframe = parent.querySelector("iframe")!;
  const posted: unknown[] = [];
  const clearedSnapshotTimers: number[] = [];
  const nativeClearTimeout = window.clearTimeout.bind(window);
  window.clearTimeout = ((timeoutId: number) => {
    clearedSnapshotTimers.push(timeoutId);
    nativeClearTimeout(timeoutId);
  }) as typeof window.clearTimeout;
  iframe.contentWindow!.postMessage = ((message: unknown) => {
    posted.push(message);
  }) as typeof iframe.contentWindow.postMessage;
  const initial = {
    version: 2,
    nodes: [
      {
        id: "note-1",
        kind: "note",
        position: { x: 0, y: 0 },
        width: 240,
        height: 120,
        content: "Claim one",
      },
      {
        id: "note-2",
        kind: "note",
        position: { x: 320, y: 0 },
        width: 240,
        height: 120,
        content: "Claim two",
      },
    ],
    connections: [
      {
        id: "edge-1",
        kind: "basic",
        source: "note-1",
        target: "note-2",
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as const;
  const flow = canvasDocumentToFlow(initial);
  flow.nodes[0] = {
    ...flow.nodes[0],
    data: {
      ...flow.nodes[0].data,
      model: {
        ...flow.nodes[0].data.model,
        style: undefined,
        extensions: undefined,
      },
    },
  };
  flow.edges[0] = {
    ...flow.edges[0],
    data: {
      ...flow.edges[0].data!,
      connection: {
        ...flow.edges[0].data!.connection,
        extensions: undefined,
      },
    },
  };
  const snapshot = flowToCanvasDocument(flow.nodes, flow.edges, {
    x: 0,
    y: 0,
    zoom: 1,
  });
  assert.equal(Object.hasOwn(snapshot.nodes[0], "style"), false);
  assert.equal(Object.hasOwn(snapshot.nodes[0], "extensions"), false);
  assert.equal(Object.hasOwn(snapshot.connections[0], "label"), false);
  assert.equal(Object.hasOwn(snapshot.connections[0], "extensions"), false);

  const requested = handle.requestSnapshot();
  const request = posted.at(-1) as Extract<
    ParentToWhiteboardMessage,
    { type: "requestSnapshot" }
  >;
  assert.equal(request.type, "requestSnapshot");
  window.dispatchEvent(
    new window.MessageEvent("message", {
      source: null,
      data: {
        source: WHITEBOARD_MESSAGE_SOURCE,
        channel: "tab-1:canvas-1",
        v: WHITEBOARD_PROTOCOL_VERSION,
        type: "snapshot",
        payload: { requestId: request.payload.requestId, rev: 3, snapshot },
      },
    }),
  );
  const resolved = await Promise.race([
    requested,
    new Promise<"pending">((resolve) =>
      window.setTimeout(() => resolve("pending"), 20),
    ),
  ]);
  assert.notEqual(
    resolved,
    "pending",
    "valid snapshots must not wait for timeout",
  );
  assert.deepEqual(resolved, { rev: 3, snapshot });
  assert.equal(
    clearedSnapshotTimers.length,
    1,
    "a resolved snapshot must release its pending timeout",
  );

  window.dispatchEvent(
    new window.MessageEvent("message", {
      source: null,
      data: {
        source: WHITEBOARD_MESSAGE_SOURCE,
        channel: "tab-1:canvas-1",
        v: WHITEBOARD_PROTOCOL_VERSION,
        type: "save",
      },
    }),
  );
  assert.equal(saves, 1);
});

test("palette preferences initialize the bridge and queued changes keep the latest choice", (t) => {
  const window = installProductionEditorWindow(t);
  const parent = window.document.createElement("div");
  window.document.body.append(parent);
  let settingsOpened = 0;
  const handle = createWhiteboardEditor(parent as unknown as HTMLElement, {
    win: window as unknown as globalThis.Window,
    channel: "palette-test",
    colorScheme: "classic",
    onOpenSettings: () => settingsOpened++,
  });
  const iframe = parent.querySelector("iframe")!;
  const posted: Array<{ type: string; payload?: { colorScheme?: string } }> =
    [];
  iframe.contentWindow!.postMessage = ((message: unknown) =>
    posted.push(
      message as (typeof posted)[number],
    )) as typeof iframe.contentWindow.postMessage;
  handle.setColorScheme("classic");
  handle.setColorScheme("traditional");
  const dispatch = (type: string) =>
    window.dispatchEvent(
      new window.MessageEvent("message", {
        source: null,
        data: {
          source: WHITEBOARD_MESSAGE_SOURCE,
          channel: "palette-test",
          v: WHITEBOARD_PROTOCOL_VERSION,
          type,
        },
      }),
    );
  dispatch("ready");
  assert.equal(posted[0].payload?.colorScheme, "classic");
  assert.equal(
    posted.filter((message) => message.type === "setColorScheme").length,
    1,
  );
  assert.equal(posted[1].payload?.colorScheme, "traditional");
  handle.setColorScheme("classic");
  assert.equal(posted.at(-1)?.payload?.colorScheme, "classic");
  dispatch("openSettings");
  assert.equal(settingsOpened, 1);
  handle.destroy();
});

test("outer-window drops reach the iframe once with local coordinates and detach on destroy", (t) => {
  const window = installProductionEditorWindow(t);
  const parent = window.document.createElement("div");
  window.document.body.append(parent);
  let resolutions = 0;
  const sources = [{ library: { type: "user" as const }, itemKey: "ITEM1234" }];
  const handle = createWhiteboardEditor(parent as unknown as HTMLElement, {
    win: window as unknown as globalThis.Window,
    channel: "window-1:canvas-1",
    resolveNativeAcademicDrop: () => {
      resolutions++;
      return { status: "accepted", sources };
    },
  });
  const iframe = parent.querySelector("iframe")!;
  iframe.getBoundingClientRect = () => ({ left: 15, top: 25 }) as DOMRect;
  const posted: any[] = [];
  iframe.contentWindow!.postMessage = ((message: unknown) =>
    posted.push(message)) as typeof iframe.contentWindow.postMessage;
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        source: WHITEBOARD_MESSAGE_SOURCE,
        channel: "window-1:canvas-1",
        v: WHITEBOARD_PROTOCOL_VERSION,
        type: "ready",
      },
      source: null,
    }),
  );
  const dispatch = (type: string, types = ["zotero/item"]) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    const transfer = { types, dropEffect: "none" };
    Object.defineProperties(event, {
      dataTransfer: { value: transfer },
      clientX: { value: 115 },
      clientY: { value: 225 },
    });
    iframe.dispatchEvent(event);
    return { event, transfer };
  };
  for (const type of ["dragenter", "dragover"]) {
    const { event, transfer } = dispatch(type);
    assert.equal(event.defaultPrevented, true);
    assert.equal(transfer.dropEffect, "copy");
    assert.equal(dispatch(type, ["Files"]).event.defaultPrevented, false);
  }
  dispatch("drop");
  assert.equal(resolutions, 1);
  const drops = posted.filter(
    (message) => message.type === "academicDropStarted",
  );
  assert.equal(drops.length, 1);
  assert.deepEqual(drops[0].payload.position, { x: 100, y: 200 });
  assert.deepEqual(drops[0].payload.sources, sources);
  handle.destroy();
  dispatch("drop");
  assert.equal(resolutions, 1);
});

test("whiteboard page loads the bundle with the current editor mount cache key", () => {
  const html = readFileSync("addon/content/whiteboard/index.html", "utf8");
  const loader = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const urls: string[] = [];
  for (const version of ["first-mount", "after-hot-reload"]) {
    runInNewContext(loader, {
      URLSearchParams,
      encodeURIComponent,
      location: { search: `?channel=test&v=${version}` },
      document: {
        createElement: () => ({}),
        body: {
          appendChild: (script: { src: string }) => urls.push(script.src),
        },
      },
    });
  }
  assert.deepEqual(urls, [
    "chrome://bamboo/content/whiteboard/whiteboard.js?v=first-mount",
    "chrome://bamboo/content/whiteboard/whiteboard.js?v=after-hot-reload",
  ]);
});
