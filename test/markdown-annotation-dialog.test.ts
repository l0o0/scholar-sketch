import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { readFileSync } from "node:fs";
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
const crossSourceAnnotations = annotations.map((annotation, index) => ({
  ...annotation,
  sourceKey: index < 2 ? "PAPER001" : "PDF00002",
  sourceTitle: index < 2 ? "First paper" : "Standalone PDF",
  sourceDetail: index < 2 ? "Researcher, 2024" : "",
}));

function insertFixture(
  t: TestContext,
  options: Partial<Parameters<typeof showAnnotationInsertDialog>[1]> = {},
) {
  const win = new Window();
  const trigger = win.document.createElement("button");
  win.document.body.append(trigger);
  trigger.focus();
  const previousAddon = Object.getOwnPropertyDescriptor(globalThis, "addon");
  const messages = new Map(
    [
      ...readFileSync("addon/locale/en-US/addon.ftl", "utf8").matchAll(
        /^([\w-]+) = (.+)$/gm,
      ),
    ].map((match) => [`bamboo-${match[1]}`, match[2]]),
  );
  Object.defineProperty(globalThis, "addon", {
    configurable: true,
    value: {
      data: {
        locale: {
          current: {
            formatMessagesSync: (
              input: Array<{ id: string; args?: Record<string, unknown> }>,
            ) =>
              input.map(({ id, args }) => ({
                value: (messages.get(id) || id).replace(
                  /\{ \$(\w+) \}/g,
                  (_match, key) => String(args?.[key] ?? ""),
                ),
                attributes: null,
              })),
          },
        },
      },
    },
  });
  let closed = 0;
  const dispose = showAnnotationInsertDialog(
    win as unknown as globalThis.Window,
    {
      initialSources: [sources[0]],
      searchSources: async () => sources,
      searchAnnotations: async () => ({ annotations: crossSourceAnnotations }),
      openAnnotation: () => {},
      insert: async () => true,
      ...options,
      onClose() {
        closed++;
        options.onClose?.();
      },
    },
  );
  t.after(() => {
    dispose();
    win.close();
    if (previousAddon)
      Object.defineProperty(globalThis, "addon", previousAddon);
    else Reflect.deleteProperty(globalThis, "addon");
  });
  const dialog = win.document.querySelector("dialog")!;
  const query = <T extends HTMLElement>(selector: string) => {
    const node = dialog.querySelector<T>(selector);
    assert.ok(node, selector);
    return node;
  };
  const action = (name: string) =>
    query<HTMLButtonElement>(`[data-action="${name}"]`);
  const input = (value: string) => {
    const node = query<HTMLInputElement>('input[type="search"]');
    node.value = value;
    node.dispatchEvent(new win.Event("input"));
    return node;
  };
  const search = async (value: string) => {
    const node = input(value);
    node.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await setImmediate();
  };
  const cards = () => [
    ...dialog.querySelectorAll<HTMLElement>(".ss-annotation-card"),
  ];
  const check = (index: number) =>
    cards()[index].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  return {
    win,
    dialog,
    trigger,
    dispose,
    query,
    action,
    input,
    search,
    cards,
    check,
    closed: () => closed,
  };
}

test("one enabled search input searches across sources without first choosing a paper", async (t) => {
  const requests: Array<[string, number[]]> = [];
  const opened: MarkdownAnnotation[] = [];
  const f = insertFixture(t, {
    searchAnnotations: async (query, chosen) => {
      requests.push([query, chosen.map((source) => source.id)]);
      return { annotations: crossSourceAnnotations };
    },
    openAnnotation: (annotation) => {
      opened.push(annotation);
    },
  });
  assert.equal(f.dialog.querySelectorAll('input[type="search"]').length, 1);
  assert.equal(
    f.query<HTMLInputElement>('input[type="search"]').disabled,
    false,
  );
  assert.ok(f.win.document.activeElement === f.query('input[type="search"]'));
  assert.equal(f.cards().length, 0);
  assert.equal(
    requests.length,
    0,
    "Opening the picker must not query the entire library",
  );
  assert.match(f.query(".ss-annotation-empty").textContent!, /current library/);
  await f.search("quote");
  assert.deepEqual(requests, [["quote", []]]);
  assert.equal(f.cards().length, 3);
  assert.equal(
    f.dialog.querySelectorAll('input[type="checkbox"]:checked').length,
    0,
  );
  assert.match(f.cards()[0].textContent!, /First paper.*Researcher, 2024/);
  assert.match(f.cards()[2].textContent!, /Standalone PDF/);
  assert.equal(f.dialog.querySelector("script"), null);
  f.query<HTMLButtonElement>(".ss-annotation-location").click();
  await setImmediate();
  assert.deepEqual(opened, [crossSourceAnnotations[0]]);
  assert.equal(
    f.check(0).checked,
    false,
    "Opening the original must not select the annotation",
  );
  f.action("select-results").click();
  assert.match(
    f.query(".ss-annotation-selected").textContent!,
    /3 selected · 2 sources/,
  );
  assert.match(f.action("insert").textContent!, /Insert 3 annotations/);
});

test("cross-source selections survive queries and filters and can be reviewed together", async (t) => {
  const inserted: MarkdownAnnotation[][] = [];
  const f = insertFixture(t, {
    searchAnnotations: async (query, _sources, _current, filters) => ({
      annotations:
        filters.type === "underline"
          ? [crossSourceAnnotations[1]]
          : query === "first"
            ? crossSourceAnnotations.slice(0, 2)
            : crossSourceAnnotations.slice(2),
    }),
    insert: async (chosen) => {
      inserted.push(chosen);
      return true;
    },
  });
  await f.search("first");
  f.check(0).click();
  f.query<HTMLButtonElement>('[data-type="underline"]').click();
  await setImmediate();
  assert.equal(f.cards().length, 1);
  f.check(0).click();
  assert.match(f.query(".ss-annotation-selected").textContent!, /2 selected/);
  f.query<HTMLButtonElement>('[data-type=""]').click();
  await f.search("second");
  assert.equal(f.cards().length, 1);
  assert.equal(f.action("insert").disabled, false);
  f.check(0).click();
  assert.match(
    f.query(".ss-annotation-selected").textContent!,
    /3 selected · 2 sources/,
  );
  f.action("view-selected").click();
  assert.equal(f.cards().length, 3);
  assert.equal(
    f.query<HTMLSelectElement>("select").disabled,
    true,
    "Selected review does not apply query filters",
  );
  f.check(1).click();
  assert.equal(f.cards().length, 2);
  assert.ok(f.win.document.activeElement === f.check(1));
  assert.match(
    f.query(".ss-annotation-selected").textContent!,
    /2 selected · 2 sources/,
  );
  f.action("insert").click();
  await setImmediate();
  assert.deepEqual(inserted, [
    [crossSourceAnnotations[0], crossSourceAnnotations[2]],
  ]);
  assert.equal(f.dialog.isConnected, false);
  assert.ok(f.win.document.activeElement === f.trigger);
});

test("choosing source suggestions adds removable scope chips and clears only the query", async (t) => {
  const requests: Array<[string, number[]]> = [];
  const f = insertFixture(t, {
    initialSources: sources,
    searchAnnotations: async (query, scope) => {
      requests.push([query, scope.map((source) => source.id)]);
      return { annotations: crossSourceAnnotations };
    },
  });
  f.query<HTMLButtonElement>(
    '.ss-annotation-source-results [data-source-id="10"]',
  ).click();
  await setImmediate();
  assert.deepEqual(requests, [["", [10]]]);
  f.check(0).click();
  await f.search("standalone");
  f.query<HTMLButtonElement>(
    '.ss-annotation-source-results [data-source-id="20"]',
  ).click();
  await setImmediate();
  assert.equal(f.query<HTMLInputElement>('input[type="search"]').value, "");
  assert.deepEqual(requests.at(-1), ["", [10, 20]]);
  assert.equal(
    f.dialog.querySelectorAll(".ss-annotation-source-chip").length,
    2,
  );
  assert.match(f.query(".ss-annotation-selected").textContent!, /1 selected/);
  f.query<HTMLButtonElement>(
    '.ss-annotation-source-chip[data-source-id="10"]',
  ).click();
  await setImmediate();
  assert.deepEqual(requests.at(-1), ["", [20]]);
  assert.match(f.query(".ss-annotation-selected").textContent!, /1 selected/);
  f.query<HTMLButtonElement>(
    '.ss-annotation-source-chip[data-source-id="20"]',
  ).click();
  await setImmediate();
  assert.equal(f.cards().length, 0);
  assert.equal(f.action("insert").disabled, false);
  f.action("view-selected").click();
  assert.equal(f.cards().length, 1);
});

test("loaded result selection and page retries preserve earlier selections and deduplicate annotations", async (t) => {
  let attempts = 0;
  const f = insertFixture(t, {
    searchAnnotations: async () => ({
      annotations: [crossSourceAnnotations[0]],
      loadMore: async () => {
        if (++attempts === 1) throw new Error("Page unavailable");
        return {
          annotations: [crossSourceAnnotations[0], crossSourceAnnotations[2]],
        };
      },
    }),
  });
  await f.search("quote");
  f.action("select-results").click();
  assert.match(f.query(".ss-annotation-selected").textContent!, /1 selected/);
  f.action("load-more").click();
  await setImmediate();
  assert.equal(f.cards().length, 1);
  assert.match(f.dialog.textContent!, /Page unavailable/);
  assert.match(f.query(".ss-annotation-selected").textContent!, /1 selected/);
  assert.match(f.action("load-more").textContent!, /Retry loading/);
  f.action("load-more").click();
  await setImmediate();
  assert.equal(f.cards().length, 2);
  assert.equal(f.check(0).checked, true);
  assert.equal(f.check(1).checked, false);
  assert.equal(f.action("load-more").parentElement!.hidden, true);
  f.action("select-results").click();
  assert.match(
    f.query(".ss-annotation-selected").textContent!,
    /2 selected · 2 sources/,
  );
});

test("query and suggestion versions reject late responses and closing cancels ownership", async (t) => {
  let oldResults!: (page: {
    annotations: readonly MarkdownAnnotation[];
  }) => void;
  let oldSources!: (value: AnnotationInsertSource[]) => void;
  let oldCurrent!: () => boolean;
  const f = insertFixture(t, {
    searchSources: (query) =>
      query === "old"
        ? new Promise((resolve) => {
            oldSources = resolve;
          })
        : Promise.resolve([sources[1]]),
    searchAnnotations: async (query, _sources, current) => {
      if (query === "old") {
        oldCurrent = current;
        return new Promise((resolve) => {
          oldResults = resolve;
        });
      }
      return { annotations: [crossSourceAnnotations[2]] };
    },
  });
  await f.search("old");
  await f.search("new");
  assert.equal(oldCurrent(), false);
  oldResults({ annotations: [crossSourceAnnotations[0]] });
  oldSources([sources[0]]);
  await setImmediate();
  assert.equal(f.cards().length, 1);
  assert.match(f.cards()[0].textContent!, /Standalone PDF/);
  assert.equal(
    f.dialog.querySelector(
      '.ss-annotation-source-results [data-source-id="10"]',
    ),
    null,
  );
  await f.search("old");
  assert.equal(oldCurrent(), true);
  f.dispose();
  f.dispose();
  assert.equal(oldCurrent(), false);
  oldResults({ annotations: crossSourceAnnotations });
  oldSources(sources);
  await setImmediate();
  assert.equal(f.dialog.isConnected, false);
  assert.equal(f.closed(), 1);
});

test("a late page cannot append to a new query", async (t) => {
  let complete!: (page: { annotations: readonly MarkdownAnnotation[] }) => void;
  let oldCurrent!: () => boolean;
  const f = insertFixture(t, {
    searchAnnotations: async (query) =>
      query === "first"
        ? {
            annotations: [crossSourceAnnotations[0]],
            loadMore: (current) => {
              oldCurrent = current;
              return new Promise((resolve) => {
                complete = resolve;
              });
            },
          }
        : { annotations: [crossSourceAnnotations[2]] },
  });
  await f.search("first");
  f.check(0).click();
  f.action("load-more").click();
  await f.search("second");
  assert.equal(oldCurrent(), false);
  complete({ annotations: [crossSourceAnnotations[1]] });
  await setImmediate();
  assert.equal(f.cards().length, 1);
  assert.match(f.cards()[0].textContent!, /Standalone PDF/);
  assert.match(f.query(".ss-annotation-selected").textContent!, /1 selected/);
});

test("search failures retain loaded results and selected annotations until retry succeeds", async (t) => {
  let fail = true;
  const f = insertFixture(t, {
    searchAnnotations: async (query) => {
      if (query === "broken" && fail) throw new Error("Search unavailable");
      return { annotations: [crossSourceAnnotations[0]] };
    },
  });
  await f.search("first");
  f.check(0).click();
  await f.search("broken");
  assert.equal(f.cards().length, 1);
  assert.equal(f.check(0).checked, true);
  assert.match(f.dialog.textContent!, /Previous results are still shown/);
  assert.equal(
    f.query<HTMLInputElement>('input[type="search"]').disabled,
    false,
  );
  fail = false;
  f.action("retry-search").click();
  await setImmediate();
  assert.equal(f.action("retry-search").hidden, true);
  assert.equal(f.check(0).checked, true);
});

test("insertion locks interactions, preserves failed selections and invalidates late completion", async (t) => {
  const pending: Array<{
    resolve: (success: boolean) => void;
    current: () => boolean;
    chosen: MarkdownAnnotation[];
  }> = [];
  const f = insertFixture(t, {
    insert: (chosen, current) =>
      new Promise((resolve) => {
        pending.push({ resolve, current, chosen });
      }),
  });
  await f.search("quote");
  f.check(0).click();
  f.check(2).click();
  f.action("insert").click();
  f.action("insert").click();
  assert.equal(pending.length, 1);
  assert.equal(
    f.query<HTMLInputElement>('input[type="search"]').disabled,
    true,
  );
  assert.equal(
    f.query<HTMLButtonElement>(".ss-annotation-source-choice").disabled,
    true,
  );
  pending[0].resolve(false);
  await setImmediate();
  assert.match(
    f.query(".ss-annotation-selected").textContent!,
    /2 selected · 2 sources/,
  );
  assert.equal(f.action("insert").disabled, false);
  f.action("insert").click();
  assert.equal(pending.length, 2);
  assert.deepEqual(pending[1].chosen, [
    crossSourceAnnotations[0],
    crossSourceAnnotations[2],
  ]);
  f.dispose();
  assert.equal(pending[1].current(), false);
  pending[1].resolve(true);
  await setImmediate();
  assert.equal(f.dialog.isConnected, false);
  assert.equal(f.closed(), 1);
});

test("type, color and tag filters query the complete scope and preserve hidden choices", async (t) => {
  const requests: Array<{
    type: string;
    colors: readonly string[];
    tag: string;
  }> = [];
  const f = insertFixture(t, {
    searchAnnotations: async (_query, _sources, _current, filters) => {
      requests.push(filters);
      return {
        annotations:
          filters.type === "underline"
            ? [crossSourceAnnotations[1]]
            : [crossSourceAnnotations[0]],
      };
    },
  });
  await f.search("topic");
  f.check(0).click();
  assert.ok(
    f.dialog.querySelector('[data-type="underline"]'),
    "A type outside the loaded page must remain searchable",
  );
  f.query<HTMLButtonElement>('[data-type="underline"]').click();
  await setImmediate();
  assert.deepEqual(requests.at(-1), { type: "underline", colors: [], tag: "" });
  assert.match(f.cards()[0].textContent!, /Other quote/);
  f.query<HTMLButtonElement>(".ss-annotation-color-trigger").click();
  f.query<HTMLButtonElement>('.ss-annotation-color[title="#2EA8E5"]').click();
  await setImmediate();
  assert.deepEqual(requests.at(-1), {
    type: "underline",
    colors: ["#2ea8e5"],
    tag: "",
  });
  const tags = f.query<HTMLSelectElement>("select");
  tags.value = "method";
  tags.dispatchEvent(new f.win.Event("change"));
  await setImmediate();
  assert.deepEqual(requests.at(-1), {
    type: "underline",
    colors: ["#2ea8e5"],
    tag: "method",
  });
  assert.match(f.query(".ss-annotation-selected").textContent!, /1 selected/);
  f.action("view-selected").click();
  assert.match(f.cards()[0].textContent!, /A selected quote/);
});

test("IME composition does not submit partial search text", async (t) => {
  const queries: string[] = [];
  const f = insertFixture(t, {
    searchAnnotations: async (query) => {
      queries.push(query);
      return { annotations: [] };
    },
  });
  const input = f.query<HTMLInputElement>('input[type="search"]');
  input.dispatchEvent(new f.win.CompositionEvent("compositionstart"));
  f.input("xue");
  input.dispatchEvent(
    new f.win.KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await setImmediate();
  assert.deepEqual(queries, []);
  input.value = "学习";
  input.dispatchEvent(new f.win.CompositionEvent("compositionend"));
  input.dispatchEvent(
    new f.win.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await setImmediate();
  assert.deepEqual(queries, ["学习"]);
});

test("failed insertion restarts the interrupted query and keeps its selected annotations", async (t) => {
  const pending: Array<{
    resolve: (page: { annotations: readonly MarkdownAnnotation[] }) => void;
    current: () => boolean;
  }> = [];
  const f = insertFixture(t, {
    searchAnnotations: async (query, _sources, current) => {
      if (query === "first")
        return { annotations: [crossSourceAnnotations[0]] };
      return new Promise((resolve) => pending.push({ resolve, current }));
    },
    insert: async () => false,
  });
  await f.search("first");
  f.check(0).click();
  await f.search("second");
  assert.equal(pending.length, 1);
  f.action("insert").click();
  await setImmediate();
  assert.equal(
    pending.length,
    2,
    "Failed insertion must resume the current search",
  );
  assert.equal(pending[0].current(), false);
  assert.equal(pending[1].current(), true);
  pending[0].resolve({ annotations: [crossSourceAnnotations[1]] });
  pending[1].resolve({ annotations: [crossSourceAnnotations[2]] });
  await setImmediate();
  assert.equal(
    f.query<HTMLInputElement>('input[type="search"]').value,
    "second",
  );
  assert.equal(f.cards().length, 1);
  assert.match(f.cards()[0].textContent!, /Standalone PDF/);
  assert.equal(f.check(0).disabled, false);
  assert.match(f.query(".ss-annotation-selected").textContent!, /1 selected/);
  assert.match(f.dialog.textContent!, /Could not insert annotations/);
  f.action("view-selected").click();
  assert.match(f.cards()[0].textContent!, /A selected quote/);
});

test("an explicit standard color can search without loading the entire library on open", async (t) => {
  const requests: Array<{
    query: string;
    filters: { type: string; colors: readonly string[]; tag: string };
  }> = [];
  const f = insertFixture(t, {
    availableColors: ["#FFD400", "#2EA8E5"],
    searchAnnotations: async (query, _sources, _current, filters) => {
      requests.push({ query, filters });
      return { annotations: [crossSourceAnnotations[1]] };
    },
  });
  assert.equal(requests.length, 0);
  f.query<HTMLButtonElement>(".ss-annotation-color-trigger").click();
  f.query<HTMLButtonElement>('.ss-annotation-color[title="#2EA8E5"]').click();
  await setImmediate();
  assert.deepEqual(requests, [
    { query: "", filters: { type: "", colors: ["#2ea8e5"], tag: "" } },
  ]);
  assert.equal(f.cards().length, 1);
  assert.match(f.cards()[0].textContent!, /Other quote/);
});
