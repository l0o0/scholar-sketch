import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";
import { showAnnotationExportDialog } from "../src/modules/markdown/annotation-dialog.ts";
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
});
