import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import {
  mountOutlineSidebar,
  outlineIndentPx,
  outlineItemNeedsReveal,
  outlineVisibleAtWidth,
  type OutlineSidebarHandle,
} from "../src/modules/markdown/outline-sidebar.ts";
import { mountBacklinksSidebar } from "../src/modules/markdown/backlinks.ts";
import { iconPanelLeft } from "../src/modules/markdown/icons.ts";
import { outlineSidebarCSS } from "../src/modules/markdown/styles.ts";

test("caps indentation and auto-hides only at narrow widths", () => {
  assert.equal(outlineIndentPx(1), 8);
  assert.equal(outlineIndentPx(3), 32);
  assert.equal(outlineIndentPx(6), 44);
  assert.equal(outlineVisibleAtWidth(true, 900), true);
  assert.equal(outlineVisibleAtWidth(true, 620), false);
  assert.equal(outlineVisibleAtWidth(false, 900), false);
});

test("reveals only active items outside the outline viewport", () => {
  const viewport = { top: 100, bottom: 300 };
  assert.equal(
    outlineItemNeedsReveal({ top: 120, bottom: 150 }, viewport),
    false,
  );
  assert.equal(
    outlineItemNeedsReveal({ top: 80, bottom: 110 }, viewport),
    true,
  );
  assert.equal(
    outlineItemNeedsReveal({ top: 290, bottom: 320 }, viewport),
    true,
  );

  const source = readFileSync(
    "src/modules/markdown/outline-sidebar.ts",
    "utf8",
  );
  assert.match(source, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("defines unframed geometry and complete collapse", () => {
  const css = outlineSidebarCSS();

  assert.match(css, /inline-size: var\(--zmd-outline-width, 220px\)/);
  assert.match(css, /border-inline-end: 1px solid var\(--zmd-border\)/);
  assert.match(css, /is-outline-collapsed[\s\S]*display: none/);
  assert.match(css, /text-overflow: ellipsis/);
  assert.doesNotMatch(css, /zotero-markdown-outline-header/);
  assert.doesNotMatch(css, /zotero-markdown-outline-collapse/);
});

test("uses the leading toolbar panel button as the primary outline control", () => {
  const source = readFileSync("src/modules/markdown/tab.ts", "utf8");
  const toggleIndex = source.indexOf('"data-action": "outline-toggle"');
  const saveIndex = source.indexOf('"data-action": "save"');

  assert.ok(toggleIndex >= 0);
  assert.ok(saveIndex > toggleIndex);
  assert.match(source, /zotero-markdown-outline-sidebar/);
  assert.match(source, /onOutline:/);
  assert.match(source, /revealPosition/);
  assert.match(source, /session\.outlineActiveID = item\.id/);
  assert.match(source, /outlineSidebar\?\.setActive\(item\.id\)/);
  assert.doesNotMatch(source, /zotero-markdown-outline-header/);
  assert.doesNotMatch(source, /outlineCollapseEl/);
  assert.doesNotMatch(source, /iconPanelLeftClose/);
  assert.match(iconPanelLeft(), /chrome:\/\/bamboo\/content\/icons\/markdown/);
});

test("uses XHTML-safe markup for sidebar toolbar icons", () => {
  const icon = iconPanelLeft();

  assert.match(icon, /^<span\b[^>]*><\/span>$/);
  assert.match(icon, /--zmd-icon-url: url/);
  assert.doesNotMatch(icon, /<svg/);
  assert.doesNotMatch(icon, /<\/img>/);
});

function animatedOutline(t: TestContext) {
  const browser = new Window();
  const doc = browser.document;
  doc.body.innerHTML =
    '<main><button id="toggle"></button><nav><div id="list"></div></nav></main>';
  const root = doc.querySelector("main")!;
  const sidebar = doc.querySelector("nav")!;
  const list = doc.querySelector<HTMLDivElement>("#list")!;
  const toggle = doc.querySelector<HTMLButtonElement>("#toggle")!;
  let width = 900;
  root.getBoundingClientRect = () => ({ width }) as DOMRect;
  list.getBoundingClientRect = () => ({ top: 100, bottom: 300 }) as DOMRect;
  for (const [name, value] of Object.entries({
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: 220,
    offsetHeight: 600,
  }))
    Object.defineProperty(sidebar, name, { get: () => value });
  let resize = () => {};
  let disconnected = false;
  browser.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  } as unknown as typeof browser.ResizeObserver;
  const animations: {
    finished: Promise<void>;
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
    canceled: number;
    cancel(): void;
  }[] = [];
  sidebar.animate = (() => {
    let rejectFinished = (_error: Error) => {};
    const animation = {
      finished: new Promise<void>((_resolve, reject) => {
        rejectFinished = reject;
      }),
      onfinish: null as (() => void) | null,
      oncancel: null as (() => void) | null,
      canceled: 0,
      cancel() {
        this.canceled++;
        rejectFinished(
          new browser.DOMException("Animation cancelled", "AbortError"),
        );
        this.oncancel?.();
      },
    };
    animations.push(animation);
    return animation;
  }) as unknown as typeof sidebar.animate;
  let expanded = true;
  const handle: OutlineSidebarHandle = mountOutlineSidebar({
    root: root as unknown as HTMLElement,
    sidebar: sidebar as unknown as HTMLElement,
    list: list as unknown as HTMLElement,
    toolbarToggle: toggle as unknown as HTMLButtonElement,
    emptyLabel: "No headings",
    getExpanded: () => expanded,
    onExpandedChange(next) {
      expanded = next;
      handle.setExpanded(next);
    },
    onNavigate() {},
  });
  handle.update(
    [{ id: "heading", level: 1, text: "Heading", from: 0 }],
    "heading",
  );
  const heading = list.querySelector<HTMLElement>('[role="treeitem"]')!;
  let reveals = 0;
  heading.scrollIntoView = () => {
    reveals++;
  };
  heading.firstElementChild!.getBoundingClientRect = () =>
    ({ top: 50, bottom: 80 }) as DOMRect;
  handle.setActive("heading");
  t.after(() => {
    handle.destroy();
    browser.close();
  });
  return {
    browser,
    root,
    sidebar,
    toggle,
    heading,
    handle,
    animations,
    expanded: () => expanded,
    reveals: () => reveals,
    disconnected: () => disconnected,
    resize(nextWidth = width) {
      width = nextWidth;
      resize();
    },
  };
}

test("outline ignores repeated resize notifications and stale close completion after reopening", (t) => {
  const ui = animatedOutline(t);
  assert.equal(ui.animations.length, 0, "mount must not animate");
  ui.heading.focus();
  ui.toggle.click();
  assert.equal(ui.expanded(), false);
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "true");
  assert.equal(ui.sidebar.inert, true);
  assert.equal(ui.browser.document.activeElement, ui.toggle);
  assert.equal(ui.animations.length, 1);
  const oldClose = ui.animations[0].onfinish!;
  ui.resize();
  ui.resize();
  assert.equal(ui.animations.length, 1);
  assert.equal(
    ui.animations[0].canceled,
    0,
    "same-width RO keeps the running animation",
  );

  ui.toggle.click();
  assert.equal(ui.animations.length, 2);
  assert.equal(ui.animations[0].canceled, 1);
  oldClose();
  assert.equal(ui.expanded(), true);
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "false");
  assert.equal(ui.sidebar.inert, false);
  assert.equal(ui.root.classList.contains("is-outline-collapsed"), false);
  const reveals = ui.reveals();
  ui.resize();
  assert.equal(ui.animations[1].canceled, 0);
  ui.resize(901);
  assert.equal(
    ui.animations[1].canceled,
    1,
    "a real width change settles the animation",
  );
  assert.equal(ui.animations.length, 2);
  assert.equal(
    ui.reveals(),
    reveals,
    "RO must not scroll the active heading repeatedly",
  );
});

test("outline crosses the exact auto-hide boundary without changing the user's expanded choice", (t) => {
  const ui = animatedOutline(t);
  ui.heading.focus();
  ui.resize(679);
  assert.equal(ui.handle.isVisible(), false);
  assert.equal(
    ui.expanded(),
    true,
    "auto-hide keeps the user's expansion preference",
  );
  assert.equal(ui.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(ui.sidebar.inert, true);
  assert.equal(ui.browser.document.activeElement, ui.toggle);
  ui.resize(680);
  assert.equal(ui.handle.isVisible(), true);
  assert.equal(ui.sidebar.inert, false);
  assert.equal(ui.animations.length, 0, "breakpoint changes must not animate");

  ui.toggle.click();
  ui.resize(679);
  ui.resize(900);
  assert.equal(ui.handle.isVisible(), false);
  assert.equal(
    ui.expanded(),
    false,
    "widening must not reopen a manually collapsed panel",
  );
  ui.toggle.click();
  const opening = ui.animations.at(-1)!;
  ui.handle.destroy();
  assert.equal(opening.canceled, 1);
  assert.equal(ui.disconnected(), true);
  ui.toggle.click();
  assert.equal(
    ui.expanded(),
    true,
    "destroyed controls cannot change the stored choice",
  );
});

function outlineFixture(t: TestContext, initialWidth = 1280) {
  const browser = new Window();
  const doc = browser.document;
  doc.body.innerHTML =
    '<main><button id="outline-toggle"></button><button id="reference-toggle"></button><nav id="outline"><div id="headings"></div></nav><aside id="references"></aside></main>';
  const root = doc.querySelector<HTMLElement>("main")!,
    sidebar = doc.querySelector<HTMLElement>("nav")!,
    list = doc.querySelector<HTMLElement>("#headings")!,
    toggle = doc.querySelector<HTMLButtonElement>("#outline-toggle")!;
  let width = initialWidth,
    resize = () => {},
    disconnects = 0,
    expanded = true;
  root.getBoundingClientRect = () => ({ width }) as DOMRect;
  browser.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe() {}
    disconnect() {
      disconnects++;
    }
  } as unknown as typeof browser.ResizeObserver;
  const navigated: string[] = [];
  const handle = mountOutlineSidebar({
    root: root as any,
    sidebar: sidebar as any,
    list: list as any,
    toolbarToggle: toggle as any,
    emptyLabel: "No headings",
    getExpanded: () => expanded,
    onExpandedChange(value) {
      expanded = value;
      handle.setExpanded(value);
    },
    onNavigate(item) {
      navigated.push(item.id);
    },
  });
  const headings = [
    {
      id: "a",
      level: 1,
      text: "A long title that remains available in the tooltip",
      from: 0,
    },
    { id: "a1", level: 2, text: "A child", from: 20 },
    { id: "a11", level: 3, text: "A grandchild", from: 40 },
    { id: "b", level: 1, text: "B", from: 60 },
  ];
  handle.update(headings, "a");
  t.after(() => {
    handle.destroy();
    browser.close();
  });
  const row = (id: string) =>
    list.querySelector<HTMLElement>(`[data-outline-id="${id}"]`)!;
  const key = (value: string) =>
    doc.activeElement!.dispatchEvent(
      new browser.KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  return {
    browser,
    doc,
    root,
    sidebar,
    list,
    toggle,
    handle,
    headings,
    navigated,
    row,
    key,
    resize(value: number) {
      width = value;
      resize();
    },
    disconnects: () => disconnects,
  };
}

test("narrow outline opens as an overlay on request and Escape restores toolbar focus", (t) => {
  const ui = outlineFixture(t, 620);
  assert.equal(ui.handle.isVisible(), false);
  ui.toggle.click();
  assert.equal(ui.handle.isVisible(), true);
  assert.equal(ui.sidebar.classList.contains("is-floating"), true);
  ui.row("a").focus();
  ui.key("Escape");
  assert.equal(ui.handle.isVisible(), false);
  assert.equal(ui.doc.activeElement, ui.toggle);
  ui.toggle.click();
  ui.resize(600);
  assert.equal(
    ui.handle.isVisible(),
    true,
    "explicit open survives a narrow resize",
  );
});

test("opening the floating outline from another control lets Escape close it immediately", (t) => {
  const ui = outlineFixture(t, 620);
  const status = ui.doc.createElement("button");
  status.textContent = "Status details";
  ui.root.append(status);
  status.focus();
  assert.ok(ui.doc.activeElement === status);

  ui.toggle.click();
  assert.equal(ui.handle.isVisible(), true);
  assert.equal(ui.sidebar.classList.contains("is-floating"), true);
  assert.ok(ui.doc.activeElement === ui.toggle, "opening focuses its trigger");
  ui.key("Escape");
  assert.equal(ui.handle.isVisible(), false);
  assert.ok(ui.doc.activeElement === ui.toggle);
});

test("outline tree has one Tab entry, supports hierarchy keys, and keeps collapsed sections on update", (t) => {
  const ui = outlineFixture(t);
  assert.equal(ui.list.querySelectorAll('[tabindex="0"]').length, 1);
  assert.equal(ui.row("a1").parentElement!.getAttribute("role"), "group");
  assert.equal(
    ui.row("a").firstElementChild!.getAttribute("title"),
    ui.headings[0].text,
  );
  ui.row("a").focus();
  ui.key("ArrowRight");
  assert.equal(ui.doc.activeElement, ui.row("a1"));
  ui.key("ArrowLeft");
  assert.equal(ui.row("a1").getAttribute("aria-expanded"), "false");
  ui.key("ArrowDown");
  assert.equal(ui.doc.activeElement, ui.row("b"));
  ui.key("Home");
  ui.key("ArrowLeft");
  assert.equal(ui.row("a").getAttribute("aria-expanded"), "false");
  ui.key("End");
  assert.equal(ui.doc.activeElement, ui.row("b"));
  ui.key("ArrowUp");
  assert.equal(ui.doc.activeElement, ui.row("a"));
  ui.handle.update([...ui.headings], "a11");
  assert.equal(ui.row("a").getAttribute("aria-expanded"), "false");
  assert.equal(ui.doc.activeElement, ui.row("a"));
  ui.key("ArrowRight");
  ui.key("ArrowRight");
  assert.equal(ui.doc.activeElement, ui.row("a1"));
  ui.key("ArrowLeft");
  assert.equal(ui.doc.activeElement, ui.row("a"));
  ui.key("Enter");
  assert.deepEqual(ui.navigated, ["a"]);
  ui.row("a").querySelector<HTMLElement>("[data-outline-toggle]")!.click();
  assert.equal(ui.row("a").getAttribute("aria-expanded"), "false");
  assert.deepEqual(ui.navigated, ["a"], "disclosure does not navigate");
  ui.handle.update(ui.headings.slice(3), "b");
  assert.equal(ui.doc.activeElement, ui.row("b"));
  assert.equal(ui.list.querySelectorAll('[tabindex="0"]').length, 1);
});

test("outline pointer and keyboard resizing releases capture and listeners on destroy", (t) => {
  const ui = outlineFixture(t);
  const separator = ui.sidebar.querySelector<HTMLElement>(
    ".zmd-outline-resize",
  )!;
  const captures = new Set<number>();
  separator.setPointerCapture = (id: number) => {
    captures.add(id);
  };
  separator.hasPointerCapture = (id: number) => captures.has(id);
  separator.releasePointerCapture = (id: number) => {
    captures.delete(id);
  };
  const pointer = (type: string, x: number) =>
    separator.dispatchEvent(
      new ui.browser.PointerEvent(type, {
        pointerId: 7,
        button: 0,
        clientX: x,
        bubbles: true,
      }),
    );
  pointer("pointerdown", 220);
  pointer("pointermove", 260);
  assert.equal(separator.getAttribute("aria-valuenow"), "260");
  assert.equal(captures.has(7), true);
  pointer("pointerup", 260);
  assert.equal(captures.size, 0);
  separator.focus();
  ui.key("Home");
  assert.equal(separator.getAttribute("aria-valuenow"), "180");
  ui.key("End");
  assert.equal(separator.getAttribute("aria-valuenow"), "360");
  separator.dispatchEvent(new ui.browser.MouseEvent("dblclick"));
  assert.equal(separator.getAttribute("aria-valuenow"), "220");
  pointer("pointerdown", 220);
  ui.handle.destroy();
  assert.equal(captures.size, 0);
  assert.equal(separator.isConnected, false);
  assert.equal(ui.disconnects(), 1);
  pointer("pointermove", 300);
  assert.equal(ui.sidebar.style.getPropertyValue("--zmd-outline-width"), "");
});

test("both sidebars coordinate docked space and preserve explicitly opened overlays", (t) => {
  const ui = outlineFixture(t, 1100);
  const right = ui.doc.querySelector<HTMLElement>("aside")!,
    toggle = ui.doc.querySelector<HTMLButtonElement>("#reference-toggle")!;
  const dispose = mountBacklinksSidebar(
    ui.root as any,
    right as any,
    toggle as any,
  );
  t.after(dispose);
  assert.equal(right.classList.contains("is-floating"), false);
  const separator = ui.sidebar.querySelector<HTMLElement>(
    ".zmd-outline-resize",
  )!;
  separator.focus();
  ui.key("End");
  assert.equal(right.hidden, false);
  assert.equal(
    right.classList.contains("is-floating"),
    true,
    "360 + 300 must not squeeze the document to 440px",
  );
  ui.toggle.click();
  assert.equal(
    right.classList.contains("is-floating"),
    false,
    "closing outline frees the reference dock",
  );
  ui.resize(760);
  assert.equal(right.hidden, true, "default narrow references start closed");
  toggle.click();
  assert.equal(right.hidden, false);
  assert.equal(right.classList.contains("is-floating"), true);
  ui.toggle.click();
  assert.equal(ui.sidebar.classList.contains("is-floating"), true);
  assert.equal(ui.sidebar.hidden, false);
  assert.equal(right.hidden, false);
  ui.resize(1280);
  assert.equal(ui.sidebar.hidden, false);
  assert.equal(right.hidden, false);
  assert.equal(right.classList.contains("is-floating"), false);
  dispose();
  assert.equal(
    ui.disconnects(),
    0,
    "remaining outline retains the shared observer",
  );
  ui.handle.destroy();
  assert.equal(ui.disconnects(), 1);
});

test("section collapse and focus survive heading offset changes without mixing duplicate titles", (t) => {
  const ui = outlineFixture(t);
  const headings = [
    { id: "h1:0", level: 1, text: "Repeated", from: 0 },
    { id: "h2:20", level: 2, text: "Child", from: 20 },
    { id: "h1:40", level: 1, text: "Repeated", from: 40 },
    { id: "h2:60", level: 2, text: "Child", from: 60 },
  ];
  ui.handle.update(headings, "h1:0");
  ui.row("h1:40").focus();
  ui.key("ArrowLeft");
  const shifted = headings.map((heading) => ({
    ...heading,
    id: `h${heading.level}:${heading.from + 10}`,
    from: heading.from + 10,
  }));
  ui.handle.update(shifted, "h1:10");
  assert.equal(ui.row("h1:10").getAttribute("aria-expanded"), "true");
  assert.equal(ui.row("h1:50").getAttribute("aria-expanded"), "false");
  assert.equal(ui.doc.activeElement, ui.row("h1:50"));
});

test("a narrow outline closes immediately from its trigger, close button, outside pointer, or editor focus", (t) => {
  const ui = animatedOutline(t);
  ui.resize(600);
  const open = () => {
    ui.toggle.focus();
    ui.toggle.click();
    assert.equal(ui.handle.isVisible(), true);
  };
  open();
  ui.toggle.dispatchEvent(
    new ui.browser.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(ui.handle.isVisible(), false);
  open();
  ui.sidebar.querySelector<HTMLButtonElement>(".zmd-sidebar-close")!.click();
  assert.equal(ui.handle.isVisible(), false);
  assert.ok(ui.browser.document.activeElement === ui.toggle);
  open();
  ui.browser.document.body.dispatchEvent(
    new ui.browser.PointerEvent("pointerdown", { bubbles: true }),
  );
  assert.equal(ui.handle.isVisible(), false);
  open();
  ui.browser.dispatchEvent(new ui.browser.Event("blur"));
  assert.equal(ui.handle.isVisible(), false);
  ui.handle.destroy();
  assert.equal(ui.sidebar.querySelector(".zmd-sidebar-close"), null);
});
