import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "../packages/whiteboard/node_modules/vite/dist/node/index.js";
import type { CanvasNotice } from "../packages/whiteboard/src/model/protocol";

const labels = {
  close: "Close notice",
  acquisitionSummary: "Added {successCount}; failed {failureCount}.",
  dropMalformed: "Malformed drop",
  dropUnsupported: "Unsupported drop",
  acquisitionFailed: "Could not add source",
  noGroups: "Create a group first",
  sourceOpenFailed: "Could not open source",
  sourceRefreshFailed: "Could not refresh source",
  noteRefreshFailed: "Could not refresh Note",
  annotationsUnavailable: "Annotations unavailable",
  annotationsPartialFailure: "Some annotations failed",
  failureLibraryMissing: "Library missing",
  failureItemMissing: "Item missing",
  failureWrongKind: "Wrong item kind",
  failureParentMismatch: "Parent changed",
  failureAttachmentUnavailable: "Attachment missing",
  failureAnnotationUnavailable: "Annotation missing",
  failureResolutionFailed: "Resolution failed",
  failureOpenFailed: "Open failed",
  failureListFailed: "Annotation listing failed",
};

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
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
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

async function loadNoticeComponent(
  t: TestContext,
  name: "CanvasNoticeRegion" | "Notice" = "CanvasNoticeRegion",
) {
  const server = await createServer({
    root: "packages/whiteboard",
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  t.after(() => server.close());
  const path =
    name === "Notice" ? "/src/chrome/Notice.tsx" : "/src/whiteboard/app.tsx";
  const module = (await server.ssrLoadModule(path)) as Record<
    string,
    (props: Record<string, unknown>) => unknown
  >;
  assert.equal(typeof module[name], "function");
  return module[name];
}

test("mounted canvas notice is dismissible by click and keyboard", async (t) => {
  const window = installDom(t);
  const CanvasNoticeRegion = await loadNoticeComponent(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);

  function Harness() {
    const [notice, setNotice] = useState<Record<string, unknown> | null>({
      code: "source-open-failed",
      nodeId: "node-1",
      failureCode: "item-missing",
    });
    return createElement(CanvasNoticeRegion, {
      labels,
      notice,
      onDismiss: () => setNotice(null),
      autoDismissMs: 1000,
    });
  }

  await act(async () => root.render(createElement(Harness)));
  const status = window.document.querySelector<HTMLElement>('[role="status"]');
  assert.equal(status?.getAttribute("aria-live"), "polite");
  assert.equal(status?.getAttribute("aria-atomic"), "true");
  assert.match(
    status?.textContent ?? "",
    /Could not open source.*Item missing/,
  );
  const notice = container.querySelector<HTMLElement>(".zmd-board-notice");
  assert.equal(notice?.dataset.tone, "error");
  const icon = notice?.querySelector(".zmd-board-notice-icon");
  assert.equal(icon?.getAttribute("aria-hidden"), "true");
  assert.ok(
    icon?.querySelector("svg"),
    "a visible state icon must be rendered",
  );
  assert.equal(status?.contains(icon ?? null), false);
  assert.equal(status?.textContent, "Could not open source Item missing");
  const close =
    status?.parentElement?.querySelector<HTMLButtonElement>("button");
  assert.equal(close?.getAttribute("aria-label"), "Close notice");
  await act(async () => {
    close?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(window.document.querySelector('[role="status"]'), null);

  await act(async () =>
    root.render(createElement(Harness, { key: "keyboard" })),
  );
  await act(async () => {
    window.document
      .querySelector<HTMLButtonElement>(".zmd-board-notice button")
      ?.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
  });
  assert.equal(window.document.querySelector('[role="status"]'), null);
  await act(async () => root.unmount());
});

test("canvas notice tone distinguishes success, partial failure, and guidance", async (t) => {
  const window = installDom(t);
  const CanvasNoticeRegion = await loadNoticeComponent(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);

  const cases: {
    notice: CanvasNotice;
    tone: "info" | "success" | "warning" | "error";
    message: string;
  }[] = [
    {
      notice: { code: "group-required" },
      tone: "info",
      message: "Create a group first",
    },
    {
      notice: {
        code: "acquisition-summary",
        context: { successCount: 0, failureCount: 0 },
      },
      tone: "info",
      message: "Added 0; failed 0.",
    },
    {
      notice: {
        code: "acquisition-summary",
        context: { successCount: 3, failureCount: 0 },
      },
      tone: "success",
      message: "Added 3; failed 0.",
    },
    {
      notice: {
        code: "acquisition-summary",
        context: { successCount: 2, failureCount: 1 },
      },
      tone: "warning",
      message: "Added 2; failed 1.",
    },
    {
      notice: {
        code: "acquisition-summary",
        context: { successCount: 0, failureCount: 3 },
      },
      tone: "error",
      message: "Added 0; failed 3.",
    },
    {
      notice: {
        code: "annotations-partial-failure",
        requestId: "request-1",
        failureCodes: ["attachment-unavailable"],
      },
      tone: "warning",
      message: "Some annotations failed Attachment missing",
    },
    {
      notice: { code: "drop-malformed" },
      tone: "warning",
      message: "Malformed drop",
    },
    {
      notice: { code: "drop-unsupported" },
      tone: "warning",
      message: "Unsupported drop",
    },
    {
      notice: { code: "acquisition-failed" },
      tone: "error",
      message: "Could not add source",
    },
    {
      notice: {
        code: "note-refresh-failed",
        nodeId: "node-1",
        failureCode: "note-refresh-failed",
      },
      tone: "error",
      message: "Could not refresh Note",
    },
  ];

  try {
    for (const { notice, tone, message } of cases) {
      await act(async () =>
        root.render(
          createElement(CanvasNoticeRegion, {
            labels,
            notice,
            onDismiss: () => undefined,
            autoDismissMs: 1000,
          }),
        ),
      );
      const banner = container.querySelector<HTMLElement>(".zmd-board-notice");
      assert.equal(banner?.dataset.tone, tone, `${notice.code}: ${message}`);
      assert.equal(
        banner?.querySelector('[role="status"]')?.textContent,
        message,
      );
      assert.equal(
        banner
          ?.querySelector(".zmd-board-notice-icon")
          ?.getAttribute("aria-hidden"),
        "true",
      );
      assert.ok(banner?.querySelector(".zmd-board-notice-icon svg"));
    }
  } finally {
    await act(async () => root.unmount());
  }
});

test("shared notice keeps decorative icons out of status and alert messages", async (t) => {
  const window = installDom(t);
  const Notice = await loadNoticeComponent(t, "Notice");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        createElement(Notice, {
          tone: "progress",
          className: "export-progress",
          children: "Exporting canvas",
        }),
      ),
    );
    const progress = container.querySelector<HTMLElement>(".zmd-board-notice");
    assert.equal(progress?.dataset.tone, "progress");
    assert.equal(progress?.classList.contains("export-progress"), true);
    assert.equal(
      progress?.querySelector('[role="status"]')?.textContent,
      "Exporting canvas",
    );
    assert.equal(progress?.querySelector("button"), null);
    assert.equal(
      progress
        ?.querySelector(".zmd-board-notice-icon")
        ?.getAttribute("aria-hidden"),
      "true",
    );
    assert.ok(progress?.querySelector(".zmd-board-notice-icon svg"));

    await act(async () =>
      root.render(
        createElement(Notice, {
          tone: "error",
          role: "alert",
          icon: createElement("svg", { "data-test-icon": "custom" }),
          children: "Could not export canvas",
        }),
      ),
    );
    const alert = container.querySelector('[role="alert"]');
    assert.equal(alert?.textContent, "Could not export canvas");
    const icon = container.querySelector(".zmd-board-notice-icon");
    assert.equal(icon?.getAttribute("aria-hidden"), "true");
    assert.ok(icon?.querySelector('svg[data-test-icon="custom"]'));
    assert.equal(icon?.querySelectorAll("svg").length, 1);
    assert.equal(alert?.contains(icon ?? null), false);
  } finally {
    await act(async () => root.unmount());
  }
});

test("mounted canvas notice auto-expires and replacement resets its timer", async (t) => {
  const window = installDom(t);
  const CanvasNoticeRegion = await loadNoticeComponent(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  let replace!: (notice: Record<string, unknown> | null) => void;

  function Harness() {
    const [notice, setNotice] = useState<Record<string, unknown> | null>({
      code: "drop-malformed",
    });
    replace = setNotice;
    return createElement(CanvasNoticeRegion, {
      labels,
      notice,
      onDismiss: () => setNotice(null),
      autoDismissMs: 30,
    });
  }

  await act(async () => root.render(createElement(Harness)));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
  await act(async () =>
    replace({ code: "source-refresh-failed", failureCode: "wrong-kind" }),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.match(
    window.document.querySelector('[role="status"]')?.textContent ?? "",
    /Wrong item kind/,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(window.document.querySelector('[role="status"]'), null);
  await act(async () => root.unmount());
});

test("successful clearing removes a mounted notice immediately", async (t) => {
  const window = installDom(t);
  const CanvasNoticeRegion = await loadNoticeComponent(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  let clear!: () => void;
  let expiryDismissals = 0;

  function Harness() {
    const [notice, setNotice] = useState<Record<string, unknown> | null>({
      code: "annotations-unavailable",
      requestId: "request-1",
      failureCode: "annotation-unavailable",
    });
    clear = () => setNotice(null);
    return createElement(CanvasNoticeRegion, {
      labels,
      notice,
      onDismiss: () => {
        expiryDismissals += 1;
        setNotice(null);
      },
      autoDismissMs: 20,
    });
  }

  await act(async () => root.render(createElement(Harness)));
  assert.match(container.textContent, /Annotation missing/);
  await act(async () => clear());
  assert.equal(window.document.querySelector('[role="status"]'), null);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(expiryDismissals, 0, "successful clearing must cancel expiry");
  await act(async () => root.unmount());
});

test("mounted canvas notices distinguish every typed source failure", async (t) => {
  const window = installDom(t);
  const CanvasNoticeRegion = await loadNoticeComponent(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const cases = [
    ["library-missing", "Library missing", "source-open-failed"],
    ["item-missing", "Item missing", "source-open-failed"],
    ["wrong-kind", "Wrong item kind", "source-open-failed"],
    ["parent-mismatch", "Parent changed", "source-open-failed"],
    ["open-failed", "Open failed", "source-open-failed"],
    ["resolution-failed", "Resolution failed", "source-refresh-failed"],
    ["attachment-unavailable", "Attachment missing", "annotations-unavailable"],
    ["annotation-unavailable", "Annotation missing", "annotations-unavailable"],
    ["list-failed", "Annotation listing failed", "annotations-unavailable"],
  ] as const;

  for (const [failureCode, expected, code] of cases) {
    const notice = {
      code,
      nodeId: "node-1",
      requestId: "request-1",
      failureCode,
    };
    await act(async () =>
      root.render(
        createElement(CanvasNoticeRegion, {
          labels,
          notice,
          onDismiss: () => undefined,
          autoDismissMs: 1000,
        }),
      ),
    );
    assert.match(container.textContent, new RegExp(expected));
  }
  await act(async () => root.unmount());
});

test("unmount clears a pending notice timer", async (t) => {
  const window = installDom(t);
  const CanvasNoticeRegion = await loadNoticeComponent(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  let dismissals = 0;

  await act(async () =>
    root.render(
      createElement(CanvasNoticeRegion, {
        labels,
        notice: { code: "drop-unsupported" },
        onDismiss: () => dismissals++,
        autoDismissMs: 20,
      }),
    ),
  );
  await act(async () => root.unmount());
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(dismissals, 0);
});
