import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { act, createElement, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AnnotationBrowser,
  toggleAnnotationSelection,
  type AnnotationBrowserLabels,
} from "../packages/whiteboard/src/chrome/AnnotationBrowser.tsx";
import { nativeAnnotationIdentity } from "../packages/whiteboard/src/model/academic.ts";
import type { AnnotationCandidate } from "../packages/whiteboard/src/model/protocol.ts";
import { handleGlobalCanvasKeyDown } from "../packages/whiteboard/src/whiteboard/keyboard.ts";

const labels: AnnotationBrowserLabels = {
  title: "Annotations",
  search: "Search annotations",
  loading: "Loading",
  empty: "Empty",
  unavailable: "Unavailable",
  partialFailure: "Partial failure",
  alreadyAdded: "Already added",
  focusExisting: "Focus existing",
  addSelected: "Add selected",
  page: "Page",
  close: "Close",
  colorFilter: "Annotation color",
  allColors: "All colors",
  selectResults: "Select results",
  clearSelection: "Clear selection",
  selectedCount: "Selected: {count}",
};
const source = {
  library: { type: "user" as const },
  itemKey: "ITEM1234",
  attachmentKey: "PDF12345",
  annotationKey: "ANN12345",
};
const candidate: AnnotationCandidate = {
  attachmentTitle: "Paper.pdf",
  sortIndex: "0001",
  acquisition: {
    kind: "quote",
    source,
    snapshot: { text: "Evidence" },
  },
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

test("mounted dialog traps focus, inerts siblings, and restores trigger focus on Escape", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);

  function Harness() {
    const [open, setOpen] = useState(true);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return createElement(
      "div",
      null,
      createElement("button", { ref: triggerRef, id: "trigger" }, "View"),
      createElement(
        "main",
        { id: "background" },
        createElement("button", { id: "background-action" }, "Canvas action"),
      ),
      open
        ? createElement(AnnotationBrowser, {
            labels,
            state: { status: "ready", candidates: [candidate], failures: [] },
            query: "",
            selectedKeys: new Set([nativeAnnotationIdentity(source)]),
            existingKeys: new Set(),
            returnFocusRef: triggerRef,
            onQueryChange: () => undefined,
            onSelectionChange: () => undefined,
            onToggle: () => undefined,
            onClose: () => setOpen(false),
            onFocusExisting: () => undefined,
            onAddSelected: () => undefined,
          })
        : null,
    );
  }

  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  const search = window.document.querySelector<HTMLInputElement>(
    '[aria-label="Search annotations"]',
  );
  const background = window.document.querySelector<HTMLElement>("#background");
  assert.equal(window.document.activeElement, search);
  assert.equal(background?.inert, true);
  assert.equal(background?.getAttribute("aria-hidden"), "true");

  const dialog = window.document.querySelector<HTMLElement>('[role="dialog"]');
  const focusable = Array.from(
    dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  );
  focusable.at(-1)?.focus();
  window.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
  );
  assert.equal(window.document.activeElement, focusable[0]);
  focusable[0].focus();
  window.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    }),
  );
  assert.equal(window.document.activeElement, focusable.at(-1));

  await act(async () =>
    window.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(window.document.querySelector('[role="dialog"]'), null);
  assert.equal(background?.inert, false);
  assert.equal(background?.hasAttribute("aria-hidden"), false);
  assert.equal(window.document.activeElement?.id, "trigger");

  await act(async () => root.unmount());
});

test("Focus existing unmounts without restoring the trigger and transfers focus", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const focusedKeys: string[] = [];
  const reparentedCandidate: AnnotationCandidate = {
    ...candidate,
    acquisition: {
      ...candidate.acquisition,
      source: { ...source, itemKey: "NEW-PARENT" },
    },
  };

  function Harness() {
    const [open, setOpen] = useState(true);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const focusExisting = (identity: string) => {
      focusedKeys.push(identity);
      setOpen(false);
      window.requestAnimationFrame(() =>
        window.document.querySelector<HTMLElement>("#existing-node")?.focus(),
      );
    };
    return createElement(
      "div",
      null,
      createElement("button", { ref: triggerRef, id: "trigger" }, "View"),
      createElement(
        "main",
        { id: "background" },
        createElement("button", { id: "existing-node" }, "Existing Quote"),
      ),
      open
        ? createElement(AnnotationBrowser, {
            labels,
            state: {
              status: "ready",
              candidates: [reparentedCandidate],
              failures: [],
            },
            query: "",
            selectedKeys: new Set(),
            existingKeys: new Set([nativeAnnotationIdentity(source)]),
            returnFocusRef: triggerRef,
            onQueryChange: () => undefined,
            onSelectionChange: () => undefined,
            onToggle: () => undefined,
            onClose: () => setOpen(false),
            onFocusExisting: focusExisting,
            onAddSelected: () => undefined,
          })
        : null,
    );
  }

  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  const focus = window.document.querySelector<HTMLButtonElement>(
    ".zmd-board-annotation-focus",
  );
  await act(async () => focus?.click());
  await window.happyDOM.waitUntilComplete();
  assert.equal(window.document.querySelector('[role="dialog"]'), null);
  assert.equal(window.document.activeElement?.id, "existing-node");
  assert.notEqual(window.document.activeElement?.id, "trigger");
  assert.deepEqual(focusedKeys, [nativeAnnotationIdentity(source)]);
  await act(async () => root.unmount());
});

test("close button and backdrop both restore trigger focus after real unmount", async (t) => {
  const window = installDom(t);

  for (const method of ["button", "backdrop"] as const) {
    const container = window.document.createElement("div");
    window.document.body.append(container);
    function Harness() {
      const [open, setOpen] = useState(true);
      const triggerRef = useRef<HTMLButtonElement | null>(null);
      return createElement(
        "div",
        null,
        createElement(
          "button",
          { ref: triggerRef, id: `trigger-${method}` },
          "View",
        ),
        createElement("main", { id: `background-${method}` }, "Canvas"),
        open
          ? createElement(AnnotationBrowser, {
              labels,
              state: { status: "loading" },
              query: "",
              selectedKeys: new Set(),
              existingKeys: new Set(),
              returnFocusRef: triggerRef,
              onQueryChange: () => undefined,
              onSelectionChange: () => undefined,
              onToggle: () => undefined,
              onClose: () => setOpen(false),
              onFocusExisting: () => undefined,
              onAddSelected: () => undefined,
            })
          : null,
      );
    }

    const root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
    if (method === "button") {
      await act(async () =>
        window.document
          .querySelector<HTMLButtonElement>(".zmd-board-annotation-close")
          ?.click(),
      );
    } else {
      await act(async () =>
        window.document
          .querySelector<HTMLElement>(".zmd-board-annotation-backdrop")
          ?.dispatchEvent(
            new window.MouseEvent("mousedown", { bubbles: true }),
          ),
      );
    }
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    assert.equal(window.document.activeElement?.id, `trigger-${method}`);
    assert.equal(
      window.document
        .querySelector<HTMLElement>(`#background-${method}`)
        ?.hasAttribute("aria-hidden"),
      false,
    );
    await act(async () => root.unmount());
    container.remove();
  }
});

test("checkbox interaction emits the full source identity", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const toggled: Array<[string, boolean]> = [];
  const returnFocusRef = { current: null };
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(AnnotationBrowser, {
        labels,
        state: { status: "ready", candidates: [candidate], failures: [] },
        query: "",
        selectedKeys: new Set(),
        existingKeys: new Set(),
        returnFocusRef,
        onQueryChange: () => undefined,
        onSelectionChange: () => undefined,
        onToggle: (identity, checked) => toggled.push([identity, checked]),
        onClose: () => undefined,
        onFocusExisting: () => undefined,
        onAddSelected: () => undefined,
      }),
    ),
  );
  const checkbox = window.document.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  await act(async () => checkbox?.click());
  assert.deepEqual(toggled, [[nativeAnnotationIdentity(source), true]]);
  await act(async () => root.unmount());
});

test("production canvas keyboard handling leaves modal search input and dismissal intact", async (t) => {
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  let activeTool = "select";
  let deletions = 0;
  let nudges = 0;

  function Harness() {
    const [open, setOpen] = useState(true);
    const [query, setQuery] = useState("");
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) =>
        handleGlobalCanvasKeyDown(
          event,
          {
            annotationBrowserOpen: open,
            editing: false,
            drawing: false,
            selectedNodeIds: ["literature-1"],
            selectedEdgeIds: [],
          },
          {
            endFrameDrag: () => undefined,
            cancelDraw: () => undefined,
            dismissTransientUi: () => undefined,
            setActiveTool: (tool) => {
              activeTool = tool;
            },
            deleteSelection: () => {
              deletions += 1;
            },
            nudgeSelected: () => {
              nudges += 1;
              return true;
            },
          },
        );
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [open]);
    return createElement(
      "div",
      null,
      createElement("button", { ref: triggerRef, id: "trigger" }, "View"),
      createElement(
        "main",
        null,
        "Selected Literature",
        createElement("input", { id: "outside-input", "aria-label": "Title" }),
      ),
      open
        ? createElement(AnnotationBrowser, {
            labels,
            state: { status: "ready", candidates: [candidate], failures: [] },
            query,
            selectedKeys: new Set(),
            existingKeys: new Set(),
            returnFocusRef: triggerRef,
            onQueryChange: setQuery,
            onSelectionChange: () => undefined,
            onToggle: () => undefined,
            onClose: () => setOpen(false),
            onFocusExisting: () => undefined,
            onAddSelected: () => undefined,
          })
        : null,
    );
  }

  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  const search = window.document.querySelector<HTMLInputElement>(
    '[aria-label="Search annotations"]',
  );
  assert.ok(search);

  for (const key of ["e", "r", "a", "t", "Backspace", "Delete", "ArrowRight"]) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    search.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `${key} must remain editable`);
  }
  assert.equal(activeTool, "select");
  assert.equal(deletions, 0);
  assert.equal(nudges, 0);
  assert.equal(
    window.document.querySelector("main")?.textContent,
    "Selected Literature",
  );

  await act(async () =>
    search.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal(window.document.querySelector('[role="dialog"]'), null);
  assert.equal(window.document.activeElement?.id, "trigger");

  const outsideInput =
    window.document.querySelector<HTMLInputElement>("#outside-input");
  for (const key of ["e", "Backspace", "Delete", "ArrowRight"]) {
    const editableEvent = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    outsideInput?.dispatchEvent(editableEvent);
    assert.equal(editableEvent.defaultPrevented, false);
  }
  assert.equal(activeTool, "select");
  assert.equal(deletions, 0);
  assert.equal(nudges, 0);

  const shortcut = new window.KeyboardEvent("keydown", {
    key: "e",
    bubbles: true,
    cancelable: true,
  });
  window.document.querySelector("main")?.dispatchEvent(shortcut);
  assert.equal(shortcut.defaultPrevented, true);
  assert.equal(activeTool, "eraser");

  const deletion = new window.KeyboardEvent("keydown", {
    key: "Delete",
    bubbles: true,
    cancelable: true,
  });
  window.document.querySelector("main")?.dispatchEvent(deletion);
  assert.equal(deletion.defaultPrevented, true);
  assert.equal(deletions, 1);

  const arrow = new window.KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true,
  });
  window.document.querySelector("main")?.dispatchEvent(arrow);
  assert.equal(arrow.defaultPrevented, true);
  assert.equal(nudges, 1);
  await act(async () => root.unmount());
});

test("type segments filter with arrows without hijacking modal Tab or losing selections", async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
  });
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const underline: AnnotationCandidate = {
    ...candidate,
    acquisition: {
      ...candidate.acquisition,
      snapshot: {
        text: "Underlined evidence",
        annotationType: "underline",
        tags: ["review"],
      },
    },
  };
  const note: AnnotationCandidate = {
    ...candidate,
    sortIndex: "0002",
    acquisition: {
      kind: "quote",
      source: { ...source, annotationKey: "NOTE1234" },
      snapshot: {
        text: "",
        comment: "Review this finding",
        annotationType: "note",
      },
    },
  };
  let submitted: string[] = [];
  function Harness() {
    const [selected, setSelected] = useState(new Set<string>());
    return createElement(AnnotationBrowser, {
      labels,
      state: { status: "ready", candidates: [note, underline], failures: [] },
      query: "",
      selectedKeys: selected,
      existingKeys: new Set<string>(),
      returnFocusRef: { current: null },
      onQueryChange: () => undefined,
      onSelectionChange: () => undefined,
      onToggle: (identity, checked) =>
        setSelected((previous) => {
          const next = new Set(previous);
          if (checked) next.add(identity);
          else next.delete(identity);
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
  const group = container.querySelector(
    '[role="group"][aria-label="Annotation type"]',
  );
  assert.ok(group);
  const segments = [...group.querySelectorAll<HTMLButtonElement>("button")];
  assert.deepEqual(
    segments.map((button) => button.dataset.annotationType),
    ["", "highlight", "underline", "note", "text", "image", "ink"],
  );
  assert.equal(segments[0].getAttribute("aria-pressed"), "true");
  await act(async () =>
    container
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .item(1)
      ?.click(),
  );
  segments[0].focus();
  const arrow = new window.KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => segments[0].dispatchEvent(arrow));
  assert.equal(arrow.defaultPrevented, true);
  assert.equal(window.document.activeElement, segments[1]);
  assert.equal(segments[1].getAttribute("aria-pressed"), "true");
  assert.equal(container.querySelectorAll('input[type="checkbox"]').length, 0);
  assert.equal(
    container.querySelector(".zmd-board-annotation-state")?.textContent,
    labels.empty,
    "an absent type remains available and shows the empty state",
  );
  assert.equal(
    container.querySelector<HTMLButtonElement>(".zmd-board-annotation-add")
      ?.disabled,
    false,
    "empty type filters retain selections from other types",
  );
  await act(async () =>
    segments[1].dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal(window.document.activeElement, segments[2]);
  assert.equal(segments[2].getAttribute("aria-pressed"), "true");
  assert.equal(container.querySelectorAll('input[type="checkbox"]').length, 1);
  assert.equal(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.checked,
    true,
  );
  const tab = new window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  segments[2].dispatchEvent(tab);
  assert.equal(
    tab.defaultPrevented,
    false,
    "Tab retains normal modal focus traversal",
  );
  assert.equal(segments[2].getAttribute("aria-pressed"), "true");
  await act(async () => segments[3].click());
  assert.equal(
    container.querySelector(".zmd-board-annotation-text")?.textContent,
    "Review this finding",
  );
  assert.equal(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.checked,
    false,
  );
  const add = container.querySelector<HTMLButtonElement>(
    ".zmd-board-annotation-add",
  );
  assert.equal(
    add?.disabled,
    false,
    "hidden selected annotations remain eligible",
  );
  await act(async () => add?.click());
  assert.deepEqual(submitted, [nativeAnnotationIdentity(source)]);
  const home = new window.KeyboardEvent("keydown", {
    key: "Home",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => segments[3].dispatchEvent(home));
  assert.equal(window.document.activeElement, segments[0]);
  assert.equal(segments[0].getAttribute("aria-pressed"), "true");
  assert.equal(container.querySelectorAll('input[type="checkbox"]').length, 2);
});

test("color popover keeps mouse selection when Gecko would focus the dialog, dismisses outside, and consumes Escape first", async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
  });
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  let closeCount = 0;

  function Harness() {
    const [open, setOpen] = useState(true);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return createElement(
      "div",
      null,
      createElement(
        "button",
        { ref: triggerRef, id: "view-annotations" },
        "View",
      ),
      open
        ? createElement(AnnotationBrowser, {
            labels,
            state: {
              status: "ready",
              candidates: [
                {
                  ...candidate,
                  acquisition: {
                    ...candidate.acquisition,
                    snapshot: { text: "Evidence", color: "#ffd400" },
                  },
                },
              ],
              failures: [],
            },
            query: "",
            selectedKeys: new Set(),
            existingKeys: new Set(),
            returnFocusRef: triggerRef,
            onQueryChange: () => undefined,
            onSelectionChange: () => undefined,
            onToggle: () => undefined,
            onClose: () => {
              closeCount += 1;
              setOpen(false);
            },
            onFocusExisting: () => undefined,
            onAddSelected: () => undefined,
          })
        : null,
    );
  }

  await act(async () => root.render(createElement(Harness)));
  const trigger = container.querySelector<HTMLButtonElement>(
    '.zmd-board-annotation-color-trigger[aria-label="Annotation color"]',
  );
  const search = container.querySelector<HTMLInputElement>(
    '[aria-label="Search annotations"]',
  );
  assert.ok(trigger);
  assert.ok(search);
  const palette = () =>
    container.querySelector('[role="dialog"][aria-label="Annotation color"]');

  await act(async () => trigger.click());
  assert.ok(palette());
  const swatch = palette()?.querySelector<HTMLButtonElement>(
    '[aria-label="Annotation color #FFD400"]',
  );
  const focusedColorControl = palette()?.querySelector<HTMLButtonElement>(
    '[aria-pressed="true"]',
  );
  assert.ok(swatch);
  assert.ok(focusedColorControl);
  assert.equal(window.document.activeElement, focusedColorControl);
  const dialog = container.querySelector<HTMLElement>(
    '[role="dialog"][aria-modal="true"]',
  );
  assert.ok(dialog);
  const clickWithGeckoFocus = async (button: HTMLButtonElement) => {
    await act(async () => {
      button.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true }),
      );
      const press = new window.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      button.dispatchEvent(press);
      if (!press.defaultPrevented) {
        // macOS Gecko can focus the ancestor dialog instead of the clicked button.
        (window.document.activeElement as HTMLElement | null)?.blur();
        dialog.focus();
      }
    });
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
      button.click();
    });
  };
  await clickWithGeckoFocus(swatch);
  assert.ok(palette(), "a color stays clickable through mouse focus changes");
  assert.equal(swatch.getAttribute("aria-pressed"), "true");
  assert.equal(trigger.textContent?.trim(), "1");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(window.document.activeElement, swatch);

  const allColors = palette()?.querySelector<HTMLButtonElement>(
    ".zmd-board-annotation-all-colors",
  );
  assert.ok(allColors);
  await clickWithGeckoFocus(allColors);
  assert.ok(palette());
  assert.equal(swatch.getAttribute("aria-pressed"), "false");
  assert.equal(allColors.getAttribute("aria-pressed"), "true");
  assert.equal(trigger.textContent?.trim(), "");
  assert.equal(window.document.activeElement, allColors);

  await clickWithGeckoFocus(trigger);
  assert.equal(
    Boolean(palette()),
    false,
    "clicking the trigger again closes the palette",
  );
  assert.equal(window.document.activeElement, trigger);
  await clickWithGeckoFocus(trigger);
  assert.ok(palette());

  await act(async () => {
    search.dispatchEvent(
      new window.MouseEvent("pointerdown", { bubbles: true }),
    );
    search.focus();
    search.click();
  });
  assert.equal(palette(), null);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(closeCount, 0, "outside the palette is still inside the dialog");
  assert.equal(window.document.activeElement, search);

  await act(async () => trigger.click());
  assert.ok(palette());
  await act(async () => search.focus());
  assert.equal(palette(), null, "keyboard focus leaving the picker closes it");
  assert.equal(window.document.activeElement, search);
  assert.equal(closeCount, 0);

  await act(async () => trigger.click());
  const color = palette()?.querySelector<HTMLButtonElement>(
    '[aria-label="Annotation color #FFD400"]',
  );
  assert.ok(color);
  color.focus();
  await act(async () =>
    color.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(palette(), null);
  assert.equal(closeCount, 0);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(window.document.activeElement, trigger);

  await act(async () =>
    trigger.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(closeCount, 1);
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(window.document.activeElement?.id, "view-annotations");
});

test("multiple color and text filters batch-select visible new annotations while preserving hidden selections", async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
  });
  const window = installDom(t);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const makeCandidate = (
    annotationKey: string,
    snapshot: AnnotationCandidate["acquisition"]["snapshot"],
  ): AnnotationCandidate => ({
    ...candidate,
    acquisition: {
      ...candidate.acquisition,
      source: { ...source, annotationKey },
      snapshot,
    },
  });
  const highlight = {
    text: "Evidence from the paper",
    annotationType: "highlight" as const,
    tags: ["review"],
    color: "#FFD400",
  };
  const items = [
    makeCandidate("HIDDEN01", {
      text: "Evidence comment",
      annotationType: "note",
      color: "#2ea8e5",
    }),
    makeCandidate("NEW00001", highlight),
    makeCandidate("NEW00002", { ...highlight, color: "#ffd400" }),
    makeCandidate("EXIST001", highlight),
    makeCandidate("OTHER001", { ...highlight, text: "An unrelated finding" }),
    makeCandidate("OTHER002", { ...highlight, tags: ["method"] }),
    makeCandidate("OTHER003", { ...highlight, color: "#a28ae5" }),
  ];
  const identity = (index: number) =>
    nativeAnnotationIdentity(items[index].acquisition.source);
  const changes: string[][] = [];
  let submitted: string[] = [];
  function Harness() {
    const [selected, setSelected] = useState(new Set([identity(0)]));
    return createElement(AnnotationBrowser, {
      labels,
      state: { status: "ready", candidates: items, failures: [] },
      query: "evidence",
      selectedKeys: selected,
      existingKeys: new Set([identity(3)]),
      returnFocusRef: { current: null },
      onQueryChange: () => undefined,
      onToggle: (key, checked) =>
        setSelected((previous) =>
          toggleAnnotationSelection(previous, key, checked),
        ),
      onSelectionChange: (next) => {
        changes.push([...next]);
        setSelected(next);
      },
      onClose: () => undefined,
      onFocusExisting: () => undefined,
      onAddSelected: () => {
        submitted = [...selected];
      },
    });
  }
  await act(async () => root.render(createElement(Harness)));
  const getButton = (name: string) => {
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (element) =>
        (element.getAttribute("aria-label") ?? element.textContent) === name,
    );
    assert.ok(button, `button ${name} is available`);
    return button;
  };
  const results = () => container.querySelectorAll('input[type="checkbox"]');
  const colorTrigger = getButton("Annotation color");
  const openColors = async () => {
    if (colorTrigger.getAttribute("aria-expanded") === "false") {
      await act(async () => colorTrigger.click());
    }
  };
  const palette = () =>
    container.querySelector('[role="dialog"][aria-label="Annotation color"]');
  assert.equal(colorTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(palette(), null, "colors are collapsed until requested");
  await openColors();
  assert.equal(
    palette()?.querySelectorAll("button").length,
    4,
    "the actual three colors are offered once, plus All colors",
  );
  await act(async () => getButton("highlight").click());
  assert.equal(results().length, 5);
  await openColors();
  await act(async () => getButton("Annotation color #FFD400").click());
  assert.equal(results().length, 4);
  assert.equal(colorTrigger.getAttribute("aria-expanded"), "true");
  assert.equal(
    getButton("Annotation color #FFD400").getAttribute("aria-pressed"),
    "true",
  );
  const tag = container.querySelector<HTMLSelectElement>('[aria-label="Tag"]');
  assert.ok(tag);
  await act(async () => {
    tag.value = "review";
    tag.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(results().length, 3);
  await openColors();
  await act(async () => getButton("Annotation color #A28AE5").click());
  assert.equal(results().length, 4, "multiple colors are combined with OR");
  assert.equal(colorTrigger.textContent?.trim(), "2");
  assert.equal(
    getButton("Annotation color #FFD400").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    getButton("Annotation color #A28AE5").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    container.querySelector(".zmd-board-annotation-selected-count")
      ?.textContent,
    "Selected: 1",
    "hidden selected annotations still count",
  );
  await act(async () => getButton("Select results").click());
  assert.deepEqual(changes, [
    [identity(0), identity(1), identity(2), identity(6)],
  ]);
  assert.equal(getButton("Select results").disabled, true);
  assert.equal(
    container.querySelector(".zmd-board-annotation-selected-count")
      ?.textContent,
    "Selected: 4",
  );
  assert.equal(
    container.querySelectorAll('input[type="checkbox"]:disabled').length,
    1,
    "an already-added annotation stays unavailable for selection",
  );
  await act(async () => getButton("Add selected").click());
  assert.deepEqual(submitted, [
    identity(0),
    identity(1),
    identity(2),
    identity(6),
  ]);
  await openColors();
  await act(async () => getButton("All colors").click());
  assert.equal(results().length, 4);
  assert.equal(getButton("All colors").getAttribute("aria-pressed"), "true");
  assert.equal(
    getButton("Annotation color #FFD400").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    getButton("Annotation color #A28AE5").getAttribute("aria-pressed"),
    "false",
  );
  await act(async () => getButton("Annotation color #2EA8E5").click());
  assert.equal(results().length, 0);
  assert.equal(colorTrigger.textContent?.trim(), "1");
  assert.equal(getButton("Select results").disabled, true);
  assert.equal(getButton("Add selected").disabled, false);
  await act(async () => getButton("Clear selection").click());
  assert.deepEqual(changes.at(-1), []);
  assert.equal(getButton("Clear selection").disabled, true);
  assert.equal(getButton("Add selected").disabled, true);
  assert.equal(
    container.querySelector(".zmd-board-annotation-selected-count")
      ?.textContent,
    "Selected: 0",
  );
});
