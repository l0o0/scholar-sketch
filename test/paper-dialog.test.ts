import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { choosePaperSettings } from "../src/modules/markdown/paper/dialog.ts";

test("paper export dialog submits explicit paths and style, then restores focus", async (t) => {
  const window = new Window();
  t.after(() => window.close());
  const mount = window.document.createElement("main");
  window.document.body.append(mount);
  const trigger = window.document.createElement("button");
  mount.append(trigger);
  trigger.focus();
  const result = choosePaperSettings({
    mount: mount as unknown as HTMLElement,
    initial: { pandocPath: "/opt/pandoc", styleID: "apa", referenceDoc: "" },
    styles: [{ id: "apa", title: "APA" }],
    signal: new AbortController().signal,
    pickFile: async () => null,
  });
  const dialog = mount.querySelector("dialog")!;
  assert.equal(dialog.open, true);
  const inputs = dialog.querySelectorAll("input");
  inputs[1].value = "/templates/School.docx";
  dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  assert.deepEqual(await result, {
    pandocPath: "/opt/pandoc",
    styleID: "apa",
    referenceDoc: "/templates/School.docx",
  });
  assert.equal(mount.querySelector("dialog"), null);
  assert.equal(window.document.activeElement, trigger);
});

test("closing a paper export operation releases its modal even with a picker pending", async (t) => {
  const window = new Window();
  t.after(() => window.close());
  const mount = window.document.createElement("main");
  window.document.body.append(mount);
  const controller = new AbortController();
  const selected = Promise.withResolvers<string | null>();
  const result = choosePaperSettings({
    mount: mount as unknown as HTMLElement,
    initial: { pandocPath: "", styleID: "", referenceDoc: "" },
    styles: [],
    signal: controller.signal,
    pickFile: () => selected.promise,
  });
  mount.querySelector<HTMLButtonElement>("label button")!.click();
  controller.abort();
  assert.equal(await result, null);
  selected.resolve("/late/pandoc");
  await selected.promise;
  assert.equal(mount.querySelector("dialog"), null);
});
