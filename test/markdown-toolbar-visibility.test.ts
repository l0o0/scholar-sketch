import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { mountToolbarVisibility } from "../src/modules/markdown/toolbar-visibility.ts";

function fixture(t: TestContext) {
  const win = new Window();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(win, "setTimeout", globalThis.setTimeout);
  t.mock.method(win, "clearTimeout", globalThis.clearTimeout);
  win.document.body.innerHTML = `
    <div id="root">
      <main id="workspace">
        <div id="toolbar">
          <button data-action="sidebar" aria-expanded="false">Sidebar</button>
          <button data-action="more" aria-haspopup="menu" aria-expanded="false">More</button>
          <div role="menu"><button id="menu-item">Menu item</button></div>
        </div>
        <iframe></iframe>
        <article id="preview"><p>Read-only document</p></article>
      </main>
      <button id="outside">Outside toolbar</button>
    </div>`;
  const doc = win.document as unknown as Document;
  const root = doc.querySelector<HTMLElement>("#root")!;
  const workspace = doc.querySelector<HTMLElement>("#workspace")!;
  const toolbar = doc.querySelector<HTMLElement>("#toolbar")!;
  const iframe = doc.querySelector<HTMLIFrameElement>("iframe")!;
  const more = toolbar.querySelector<HTMLButtonElement>(
    '[data-action="more"]',
  )!;
  const sidebar = toolbar.querySelector<HTMLButtonElement>(
    '[data-action="sidebar"]',
  )!;
  const outside = doc.querySelector<HTMLButtonElement>("#outside")!;
  t.mock.method(
    workspace,
    "getBoundingClientRect",
    () => new win.DOMRect(100, 80, 600, 600),
  );
  t.mock.method(
    toolbar,
    "getBoundingClientRect",
    () => new win.DOMRect(200, 92, 400, 40),
  );
  t.mock.method(
    iframe,
    "getBoundingClientRect",
    () => new win.DOMRect(100, 80, 600, 600),
  );
  const controller = mountToolbarVisibility({
    root,
    workspace,
    toolbar,
    iframe,
  });
  t.after(async () => {
    controller.destroy();
    await win.happyDOM.close();
  });
  const pointer = (
    target: EventTarget,
    type: string,
    x = 0,
    y = 0,
    buttons = 0,
  ) => {
    const event = new win.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons,
    }) as unknown as PointerEvent;
    target.dispatchEvent(event);
    return event;
  };
  return {
    win,
    doc,
    toolbar,
    iframe,
    more,
    sidebar,
    outside,
    controller,
    pointer,
    tick: (milliseconds: number) => t.mock.timers.tick(milliseconds),
    collapsed: () => toolbar.dataset.toolbarCollapsed === "true",
    flushMutations: () => new Promise<void>((resolve) => setImmediate(resolve)),
  };
}

test("auto-hide reveals at the editor top, delays hiding and cancels hiding on re-entry", (t) => {
  const f = fixture(t);
  f.controller.setMode("auto");
  assert.equal(f.collapsed(), true);

  f.pointer(f.doc, "pointermove", 90, 90);
  assert.equal(
    f.collapsed(),
    true,
    "The area outside the editor does not reveal it",
  );
  f.pointer(f.doc, "pointermove", 150, 90);
  assert.equal(f.collapsed(), false);
  f.pointer(f.doc, "pointermove", 150, 250);
  f.tick(219);
  assert.equal(
    f.collapsed(),
    false,
    "Crossing a menu gap must not hide immediately",
  );
  f.pointer(f.doc, "pointermove", 150, 90);
  f.tick(1000);
  assert.equal(f.collapsed(), false, "Re-entering cancels the pending hide");
  f.pointer(f.doc, "pointerleave");
  f.tick(219);
  assert.equal(f.collapsed(), false);
  f.tick(1);
  assert.equal(f.collapsed(), true);
});

test("toolbar keyboard focus and open menus keep auto-hide visible, but expanded sidebars do not", async (t) => {
  const f = fixture(t);
  f.controller.setMode("auto");
  f.more.focus();
  assert.equal(f.collapsed(), false);
  f.pointer(f.doc, "pointerleave");
  f.tick(220);
  assert.equal(
    f.collapsed(),
    false,
    "Keyboard users retain their focused control",
  );
  f.outside.focus();
  f.tick(220);
  assert.equal(f.collapsed(), true);

  f.more.setAttribute("aria-expanded", "true");
  await f.flushMutations();
  assert.equal(f.collapsed(), false);
  f.pointer(f.doc, "pointermove", 150, 250);
  f.tick(220);
  assert.equal(
    f.collapsed(),
    false,
    "An open menu remains usable away from its trigger",
  );
  f.more.setAttribute("aria-expanded", "false");
  await f.flushMutations();
  f.tick(220);
  assert.equal(f.collapsed(), true);

  f.sidebar.setAttribute("aria-expanded", "true");
  await f.flushMutations();
  assert.equal(f.collapsed(), true, "A sidebar is not an open toolbar menu");
  f.pointer(f.doc, "pointermove", 150, 90);
  f.pointer(f.doc, "pointerleave");
  f.tick(220);
  assert.equal(f.collapsed(), true);
});

test("iframe pointer movement uses editor coordinates and text dragging does not reveal the toolbar", (t) => {
  const f = fixture(t);
  const frameDocument = f.iframe.contentDocument!;
  f.controller.setMode("auto");
  f.pointer(frameDocument, "pointermove", 50, 10, 1);
  assert.equal(f.collapsed(), true);
  f.pointer(frameDocument, "pointermove", 50, 10);
  assert.equal(f.collapsed(), false);
  f.pointer(frameDocument, "pointermove", 50, 200);
  f.tick(220);
  assert.equal(f.collapsed(), true);

  f.pointer(frameDocument, "pointermove", 50, 10);
  f.pointer(frameDocument, "pointerdown", 50, 10, 1);
  f.pointer(frameDocument, "pointermove", 50, 10, 1);
  f.tick(220);
  assert.equal(
    f.collapsed(),
    true,
    "A selection drag must not keep the toolbar active",
  );
  f.pointer(frameDocument, "pointermove", 50, 10);
  assert.equal(f.collapsed(), false);
  f.pointer(frameDocument, "pointerleave");
  f.tick(220);
  assert.equal(f.collapsed(), true);
});

test("clicking read-only preview text at the top preserves the click and lets auto-hide collapse", (t) => {
  const f = fixture(t);
  const text = f.doc.querySelector<HTMLElement>("#preview p")!;
  f.controller.setMode("auto");
  f.pointer(text, "pointermove", 150, 90);
  assert.equal(f.collapsed(), false);
  const click = f.pointer(text, "pointerdown", 150, 90, 1);
  assert.equal(click.defaultPrevented, false);
  f.tick(220);
  assert.equal(f.collapsed(), true);
});

test("iframe reload binds the new document and destroy releases listeners, observers and pending hiding", async (t) => {
  const f = fixture(t);
  const previousDocument = f.iframe.contentDocument!;
  const replacement = new Window();
  t.after(() => replacement.happyDOM.close());
  Object.defineProperty(f.iframe, "contentDocument", {
    configurable: true,
    value: replacement.document,
  });
  f.iframe.dispatchEvent(new f.win.Event("load") as unknown as Event);
  f.controller.setMode("auto");
  f.pointer(previousDocument, "pointermove", 50, 10);
  assert.equal(f.collapsed(), true, "The old iframe document is detached");
  f.pointer(replacement.document as unknown as Document, "pointermove", 50, 10);
  assert.equal(f.collapsed(), false);
  f.pointer(replacement.document as unknown as Document, "pointerleave");
  f.controller.destroy();
  f.tick(220);
  assert.equal(f.collapsed(), false, "Destroy cancels a pending hide");

  f.toolbar.dataset.toolbarCollapsed = "true";
  f.pointer(f.doc, "pointermove", 150, 90);
  f.pointer(replacement.document as unknown as Document, "pointermove", 50, 10);
  f.more.focus();
  f.more.setAttribute("aria-expanded", "true");
  f.iframe.dispatchEvent(new f.win.Event("load") as unknown as Event);
  f.pointer(replacement.document as unknown as Document, "pointermove", 50, 10);
  await f.flushMutations();
  f.tick(220);
  assert.equal(
    f.collapsed(),
    true,
    "Released inputs must not mutate the toolbar",
  );
});

test("explicit visibility modes and temporary reveal preserve the selected mode", (t) => {
  const f = fixture(t);
  f.controller.setMode("auto");
  f.controller.reveal();
  assert.equal(f.collapsed(), false);
  assert.equal(f.doc.activeElement, f.more);
  assert.equal(f.toolbar.dataset.toolbarMode, "auto");
  f.outside.focus();
  f.tick(220);
  assert.equal(f.collapsed(), true, "A temporary reveal returns to auto-hide");

  f.controller.setMode("hidden");
  f.pointer(f.doc, "pointermove", 150, 90);
  f.controller.reveal();
  assert.equal(f.toolbar.dataset.toolbarMode, "hidden");
  assert.equal(f.doc.activeElement, f.outside);

  f.controller.setMode("auto");
  f.pointer(f.doc, "pointermove", 150, 90);
  f.pointer(f.doc, "pointerleave");
  f.controller.setMode("always");
  f.tick(220);
  assert.equal(
    f.collapsed(),
    false,
    "A pending hide cannot change Always show",
  );
  f.pointer(f.doc, "pointerleave");
  f.tick(220);
  assert.equal(f.collapsed(), false);
  assert.equal(f.toolbar.dataset.toolbarMode, "always");
});
