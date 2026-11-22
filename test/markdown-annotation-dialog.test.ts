import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { Window } from "happy-dom";
import {
  showAnnotationExportDialog,
  showAnnotationInsertDialog,
  type AnnotationInsertSource,
} from "../src/modules/markdown/annotation-dialog.ts";
import type { MarkdownAnnotation } from "../src/modules/markdown/annotations.ts";

const annotations: MarkdownAnnotation[] = [
  {
    key: "ANNO0001",
    attachmentKey: "PDF00001",
    attachmentTitle: "First PDF",
    pageLabel: "3",
    text: "A selected quote",
    comment: "Review this",
    type: "highlight",
    color: "#FFD400",
    tags: ["review"],
  },
  {
    key: "ANNO0002",
    attachmentKey: "PDF00001",
    attachmentTitle: "First PDF",
    pageLabel: "4",
    text: "Other quote",
    comment: "",
    type: "underline",
    color: "#2EA8E5",
    tags: ["method"],
  },
  {
    key: "ANNO0003",
    attachmentKey: "PDF00002",
    attachmentTitle: "Second PDF",
    pageLabel: "v",
    text: "",
    comment: "<script>unsafe()</script> " + "Long comment. ".repeat(30),
    type: "note",
    color: "#FFD400",
    tags: ["review"],
  },
];
function fixture(
  t: TestContext,
  create: Parameters<typeof showAnnotationExportDialog>[2],
  data = annotations,
) {
  const win = new Window();
  const trigger = win.document.createElement("button");
  win.document.body.append(trigger);
  trigger.focus();
  showAnnotationExportDialog(win as unknown as globalThis.Window, data, create);
  t.after(() => win.close());
  const dialog = win.document.querySelector("dialog")!;
  const query = <T extends HTMLElement>(selector: string) => {
    const result = dialog.querySelector<T>(selector);
    assert.ok(result, selector);
    return result;
  };
  const action = (name: string) =>
    query<HTMLButtonElement>(`[data-action="${name}"]`);
  const search = (value: string) => {
    const input = query<HTMLInputElement>('input[type="search"]');
    input.value = value;
    input.dispatchEvent(new win.Event("input"));
  };
  const cards = () => [...dialog.querySelectorAll(".ss-annotation-card")];
  return { win, dialog, trigger, query, action, search, cards };
}

test("search, type, tag and color filters combine without losing hidden selections", async (t) => {
  const created: MarkdownAnnotation[][] = [];
  const f = fixture(t, async (chosen) => {
    created.push(chosen);
    return true;
  });
  assert.equal(f.win.document.activeElement, f.query('input[type="search"]'));
  assert.equal(f.dialog.querySelectorAll(".ss-annotation-group").length, 2);
  f.action("clear-selection").click();
  f.query<HTMLButtonElement>('[data-type="highlight"]').click();
  assert.equal(f.cards().length, 1);
  f.action("select-results").click();
  assert.equal(f.action("select-results").disabled, true);
  f.query<HTMLButtonElement>('[data-type=""]').click();
  const tags = f.query<HTMLSelectElement>("select");
  tags.value = "review";
  tags.dispatchEvent(new f.win.Event("change"));
  assert.equal(f.cards().length, 2);
  f.search("unsafe");
  assert.equal(f.cards().length, 1);
  assert.equal(f.dialog.querySelector("script"), null);
  assert.equal(f.action("create").disabled, false);
  f.query<HTMLButtonElement>(".ss-annotation-color-trigger").click();
  f.query<HTMLButtonElement>('.ss-annotation-color[title="#2EA8E5"]').click();
  assert.equal(f.cards().length, 0);
  assert.ok(f.query(".ss-annotation-empty"));
  assert.equal(f.action("create").disabled, false);
  f.query<HTMLButtonElement>('.ss-annotation-color[title="#2EA8E5"]').click();
  f.action("select-results").click();
  f.action("create").click();
  await setImmediate();
  assert.deepEqual(created, [[annotations[0], annotations[2]]]);
  assert.equal(f.win.document.querySelector("dialog"), null);
  assert.equal(f.win.document.activeElement, f.trigger);
});

test("color palette sits beside the type filters and supports multiple colors, reset and dismissal", (t) => {
  const f = fixture(t, async () => true);
  const trigger = f.query<HTMLButtonElement>(".ss-annotation-color-trigger");
  const palette = f.query(".ss-annotation-colors");
  assert.equal(
    trigger.parentElement?.parentElement,
    f.query(".ss-annotation-types").parentElement,
  );
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(palette.hidden, true);
  trigger.click();
  assert.equal(palette.hidden, false);
  assert.equal(
    f.win.document.activeElement,
    f.query(".ss-annotation-all-colors"),
  );
  const blue = f.query<HTMLButtonElement>(
    '.ss-annotation-color[title="#2EA8E5"]',
  );
  blue.click();
  f.query<HTMLButtonElement>('.ss-annotation-color[title="#FFD400"]').click();
  assert.equal(trigger.textContent, "2");
  assert.equal(f.cards().length, 3);
  f.query<HTMLButtonElement>(".ss-annotation-all-colors").click();
  assert.equal(trigger.querySelector("span")?.hidden, true);
  assert.equal(blue.getAttribute("aria-pressed"), "false");
  blue.focus();
  const escape = new f.win.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  blue.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.dialog.open, true);
  assert.equal(palette.hidden, true);
  assert.equal(f.win.document.activeElement, trigger);
  trigger.click();
  f.query<HTMLInputElement>('input[type="search"]').focus();
  assert.equal(palette.hidden, true);
  trigger.click();
  f.query('[data-type="highlight"]').dispatchEvent(
    new f.win.Event("pointerdown", { bubbles: true }),
  );
  assert.equal(palette.hidden, true);
});

test("compact controls retain accessible guidance, source labels and live matching counts", (t) => {
  const globals = globalThis as typeof globalThis & { addon?: unknown };
  const previousAddon = Object.getOwnPropertyDescriptor(globals, "addon");
  Object.defineProperty(globals, "addon", {
    configurable: true,
    value: {
      data: {
        locale: {
          current: {
            formatMessagesSync: (
              messages: Array<{
                id: string;
                args?: Record<string, unknown>;
              }>,
            ) =>
              messages.map(({ id, args }) => ({
                value:
                  id === "bamboo-annotation-export-results"
                    ? `${args?.count} / ${args?.total}`
                    : id,
              })),
          },
        },
      },
    },
  });
  t.after(() => {
    if (previousAddon) Object.defineProperty(globals, "addon", previousAddon);
    else delete globals.addon;
  });
  const f = fixture(t, async () => true);
  const resultCount = f.query(".ss-annotation-result-count");
  assert.ok(f.query(".ss-annotation-filter-row").contains(resultCount));
  assert.equal(resultCount.textContent, "3 / 3");
  const groups = [...f.dialog.querySelectorAll(".ss-annotation-group")];
  assert.deepEqual(
    groups.map((group) => group.getAttribute("aria-label")),
    ["First PDF", "Second PDF"],
  );
  assert.equal(f.dialog.querySelector(".ss-annotation-group h3"), null);
  assert.ok(
    !f.query(".ss-annotation-results").textContent?.includes("First PDF"),
  );

  const help = f.query<HTMLButtonElement>(".ss-annotation-help button");
  const guidance = f.query('.ss-annotation-guidance[role="tooltip"]');
  assert.ok(f.query("header").contains(help));
  assert.ok(help.getAttribute("aria-label"));
  assert.ok(guidance.id);
  assert.equal(help.getAttribute("aria-describedby"), guidance.id);
  assert.equal(guidance.hidden, true);
  help.focus();
  assert.equal(f.win.document.activeElement, help);
  assert.equal(guidance.hidden, false);
  const escape = new f.win.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  help.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(guidance.hidden, true);
  assert.equal(f.dialog.open, true);

  f.search("Other quote");
  assert.equal(resultCount.textContent, "1 / 3");
  f.search("no matching annotation");
  assert.equal(resultCount.textContent, "0 / 3");
});

test("long comments expand without toggling selection and empty results cannot be selected", (t) => {
  const f = fixture(t, async () => true);
  const expand = f.query<HTMLButtonElement>(".ss-annotation-expand");
  assert.equal(expand.getAttribute("aria-expanded"), "false");
  expand.click();
  assert.equal(expand.getAttribute("aria-expanded"), "true");
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    3,
  );
  f.search("no such annotation");
  assert.equal(f.action("select-results").disabled, true);
  f.action("clear-selection").click();
  assert.equal(f.action("create").disabled, true);
});

test("failed creation preserves selection and can retry without duplicate in-flight writes", async (t) => {
  let attempts = 0;
  let complete!: (created: boolean) => void;
  const f = fixture(t, async () => {
    attempts++;
    return new Promise<boolean>((resolve) => {
      complete = resolve;
    });
  });
  f.action("create").click();
  f.action("create").click();
  assert.equal(attempts, 1);
  assert.equal(
    f.query<HTMLInputElement>('input[type="search"]').disabled,
    true,
  );
  assert.equal(
    f.query<HTMLInputElement>('input[type="checkbox"]').disabled,
    true,
  );
  complete(false);
  await setImmediate();
  assert.equal(f.query(".ss-annotation-error").hidden, false);
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    3,
  );
  f.action("create").click();
  assert.equal(attempts, 2);
  complete(true);
  await setImmediate();
  assert.equal(f.win.document.querySelector("dialog"), null);
});

test("closing during creation invalidates the owner and late failure cannot reopen the dialog", async (t) => {
  let complete!: (created: boolean) => void;
  let current!: () => boolean;
  const f = fixture(t, async (_, shouldContinue) => {
    current = shouldContinue;
    return new Promise<boolean>((resolve) => {
      complete = resolve;
    });
  });
  f.action("create").click();
  assert.equal(current(), true);
  f.query<HTMLButtonElement>(".ss-annotation-close").click();
  assert.equal(current(), false);
  complete(false);
  await setImmediate();
  assert.equal(f.win.document.querySelector("dialog"), null);
  assert.equal(f.win.document.activeElement, f.trigger);
});

test("an empty source offers no creation or bulk selection", (t) => {
  const f = fixture(t, async () => {
    throw new Error("must not create");
  }, []);
  assert.equal(f.action("create").disabled, true);
  assert.equal(f.action("select-results").disabled, true);
  assert.equal(f.action("clear-selection").disabled, true);
  assert.ok(f.query(".ss-annotation-empty"));
  assert.equal(
    f.query<HTMLButtonElement>(".ss-annotation-color-trigger").disabled,
    true,
  );
});

const sources: AnnotationInsertSource[] = [
  { id: 10, title: "First paper", detail: "Researcher, 2024" },
  { id: 20, title: "Standalone PDF" },
];

function insertFixture(
  t: TestContext,
  options: Partial<Parameters<typeof showAnnotationInsertDialog>[1]> = {},
) {
  const win = new Window();
  const trigger = win.document.createElement("button");
  win.document.body.append(trigger);
  trigger.focus();
  let closed = 0;
  const dispose = showAnnotationInsertDialog(
    win as unknown as globalThis.Window,
    {
      initialSources: [sources[0]],
      searchSources: async () => sources,
      loadAnnotations: async () => annotations,
      insert: async () => true,
      ...options,
      onClose: () => {
        closed++;
        options.onClose?.();
      },
    },
  );
  t.after(() => {
    dispose();
    win.close();
  });
  const dialog = win.document.querySelector("dialog")!;
  const query = <T extends HTMLElement>(selector: string) => {
    const node = dialog.querySelector<T>(selector);
    assert.ok(node, selector);
    return node;
  };
  const action = (name: string) =>
    query<HTMLButtonElement>(`[data-action="${name}"]`);
  const choose = (selector: string, value: string) => {
    const select = query<HTMLSelectElement>(selector);
    select.value = value;
    select.dispatchEvent(new win.Event("change"));
  };
  const input = (selector: string, value: string) => {
    const control = query<HTMLInputElement>(selector);
    control.value = value;
    control.dispatchEvent(new win.Event("input"));
  };
  return {
    win,
    dialog,
    trigger,
    dispose,
    query,
    action,
    choose,
    input,
    closed: () => closed,
  };
}

test("insert annotations defaults to no selection and keeps selections across attachment filters", async (t) => {
  const submitted: MarkdownAnnotation[][] = [];
  let finish!: (success: boolean) => void;
  const f = insertFixture(t, {
    insert: async (chosen) => {
      submitted.push(chosen);
      return new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    },
  });
  assert.equal(
    f.query<HTMLInputElement>(".ss-annotation-source-search").disabled,
    true,
  );
  assert.equal(
    f.query(".ss-annotation-results").getAttribute("aria-busy"),
    "true",
  );
  await setImmediate();
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    0,
  );
  assert.equal(f.action("insert").disabled, true);
  assert.equal(
    f.dialog.querySelectorAll(".ss-annotation-group-title").length,
    2,
  );
  f.choose(".ss-annotation-attachment-filter select", "PDF00002");
  f.action("select-results").click();
  f.choose(".ss-annotation-attachment-filter select", "PDF00001");
  f.input(".ss-annotation-search", "A selected quote");
  f.action("select-results").click();
  f.input(".ss-annotation-search", "");
  f.choose(".ss-annotation-attachment-filter select", "");
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    2,
  );
  f.action("insert").click();
  f.action("insert").click();
  assert.deepEqual(submitted, [[annotations[0], annotations[2]]]);
  assert.equal(
    f.query<HTMLInputElement>(".ss-annotation-source-search").disabled,
    true,
  );
  finish(false);
  await setImmediate();
  assert.match(
    f.query(".ss-annotation-error").textContent!,
    /markdown-annotation-insert-failed/,
  );
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    2,
  );
  f.action("insert").click();
  finish(true);
  await setImmediate();
  assert.equal(f.closed(), 1);
  assert.equal(f.win.document.querySelector("dialog"), null);
  assert.equal(f.win.document.activeElement, f.trigger);
});

test("source search ignores old results and closing invalidates a pending annotation load", async (t) => {
  const pending = new Map<string, (values: AnnotationInsertSource[]) => void>();
  let loaded!: (values: readonly MarkdownAnnotation[]) => void;
  const f = insertFixture(t, {
    initialSources: [],
    searchSources: async (query) =>
      new Promise((resolve) => pending.set(query, resolve)),
    loadAnnotations: async () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
  });
  assert.match(
    f.query(".ss-annotation-empty").textContent!,
    /markdown-annotation-choose-source/,
  );
  f.input(".ss-annotation-source-search", "older");
  await delay(200);
  f.input(".ss-annotation-source-search", "newer");
  await delay(200);
  pending.get("newer")!([sources[1]]);
  await setImmediate();
  assert.ok(f.dialog.querySelector('button[data-source-id="20"]'));
  pending.get("older")!([sources[0]]);
  await setImmediate();
  assert.equal(f.dialog.querySelector('button[data-source-id="10"]'), null);
  f.query<HTMLButtonElement>('button[data-source-id="20"]').click();
  assert.equal(
    f.query(".ss-annotation-results").getAttribute("aria-busy"),
    "true",
  );
  f.dispose();
  loaded(annotations);
  await setImmediate();
  assert.equal(f.win.document.querySelector("dialog"), null);
  assert.equal(f.dialog.querySelectorAll(".ss-annotation-card").length, 0);
  f.dispose();
  assert.equal(f.closed(), 1);
});

test("source refresh retries loading and changing sources resets selection and filters", async (t) => {
  let attempts = 0;
  const f = insertFixture(t, {
    initialSources: sources,
    loadAnnotations: async (source) => {
      if (source.id === 20) return [];
      if (++attempts === 1) throw new Error("Native source load failed");
      return annotations;
    },
  });
  assert.equal(f.query(".ss-annotation-source-results").hidden, false);
  f.query<HTMLButtonElement>('button[data-source-id="10"]').click();
  await setImmediate();
  assert.match(
    f.query('.ss-annotation-empty[role="alert"]').textContent!,
    /Native source load failed/,
  );
  assert.equal(f.action("insert").disabled, true);
  assert.equal(f.action("refresh-source").disabled, false);
  f.action("refresh-source").click();
  await setImmediate();
  f.query<HTMLButtonElement>('[data-type="highlight"]').click();
  f.action("select-results").click();
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    1,
  );
  f.input(".ss-annotation-source-search", "standalone");
  await delay(200);
  f.query<HTMLButtonElement>('button[data-source-id="20"]').click();
  await setImmediate();
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    0,
  );
  assert.equal(f.action("insert").disabled, true);
  assert.match(
    f.query(".ss-annotation-empty").textContent!,
    /annotation-export-empty/,
  );
  f.input(".ss-annotation-source-search", "first");
  await delay(200);
  f.query<HTMLButtonElement>('button[data-source-id="10"]').click();
  await setImmediate();
  assert.equal(f.dialog.querySelectorAll(".ss-annotation-card").length, 3);
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    0,
  );
});

test("visible search results switch the source only when chosen and keep current selections during search", async (t) => {
  const loaded: number[] = [];
  let finish!: (success: boolean) => void;
  const f = insertFixture(t, {
    insert: async () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    searchSources: async (query) => {
      if (query === "missing") return [];
      if (query === "failure") throw new Error("Source search unavailable");
      return [sources[1]];
    },
    loadAnnotations: async (source) => {
      loaded.push(source.id);
      return source.id === 10 ? annotations : [annotations[1]];
    },
  });
  await setImmediate();
  f.action("select-results").click();
  const current = f.query(".ss-annotation-current-source");
  assert.ok(current.textContent?.includes("First paper"));
  assert.ok(current.textContent?.includes("Researcher, 2024"));
  assert.equal(f.query(".ss-annotation-source-results").hidden, true);
  for (const query of ["missing", "failure"]) {
    f.input(".ss-annotation-source-search", query);
    await delay(200);
    assert.equal(f.query(".ss-annotation-source-results").hidden, true);
    assert.equal(f.query(".ss-annotation-source-feedback").hidden, false);
    assert.ok(current.textContent?.includes("First paper"));
    assert.equal(
      f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
      3,
    );
  }
  assert.match(
    f.query(".ss-annotation-source-feedback").textContent!,
    /Source search unavailable/,
  );
  f.input(".ss-annotation-source-search", "standalone");
  assert.equal(f.query(".ss-annotation-source-results").hidden, true);
  await delay(200);
  const result = f.query<HTMLButtonElement>(
    '.ss-annotation-source-results button[data-source-id="20"]',
  );
  assert.equal(result.type, "button");
  assert.equal(result.tabIndex, 0);
  assert.equal(result.textContent, "Standalone PDF");
  assert.deepEqual(loaded, [10]);
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    3,
  );
  result.focus();
  assert.equal(f.win.document.activeElement, result);
  f.action("insert").click();
  assert.equal(result.disabled, true);
  result.click();
  assert.deepEqual(loaded, [10]);
  finish(false);
  await setImmediate();
  assert.equal(result.disabled, false);
  result.click();
  assert.equal(
    f.query<HTMLInputElement>(".ss-annotation-source-search").value,
    "",
  );
  assert.equal(f.query(".ss-annotation-source-results").hidden, true);
  assert.ok(current.textContent?.includes("Standalone PDF"));
  assert.equal(
    f.query<HTMLInputElement>(".ss-annotation-source-search").disabled,
    true,
  );
  await setImmediate();
  assert.deepEqual(loaded, [10, 20]);
  assert.equal(f.dialog.querySelectorAll(".ss-annotation-card").length, 1);
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    0,
  );
});

test("closing insertion notifies its owner once and rejects a late submit result", async (t) => {
  let finish!: (success: boolean) => void;
  let current!: () => boolean;
  const f = insertFixture(t, {
    insert: async (_, shouldContinue) => {
      current = shouldContinue;
      return new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    },
  });
  await setImmediate();
  f.action("select-results").click();
  f.action("insert").click();
  assert.equal(current(), true);
  f.query<HTMLButtonElement>(".ss-annotation-close").click();
  assert.equal(current(), false);
  finish(false);
  await setImmediate();
  f.dispose();
  assert.equal(f.closed(), 1);
  assert.equal(f.win.document.querySelector("dialog"), null);
});
