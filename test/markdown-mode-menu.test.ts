import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import { mountModeMenu } from "../src/modules/markdown/mode-menu.ts";

function fixture(t: TestContext) {
  const window = new Window();
  window.document.body.innerHTML =
    '<main><button class="mode"></button><button class="after"></button></main>';
  const root = window.document.querySelector("main")!;
  const button = root.querySelector<HTMLButtonElement>(".mode")!;
  const labels = {
    live: "实时预览",
    source: "源码",
    preview: "只读预览",
  };
  const selected: string[] = [];
  let closingOtherMenus = 0;
  let composing = false;
  const controller = mountModeMenu({
    root: root as unknown as HTMLElement,
    button: button as unknown as HTMLButtonElement,
    mode: "live",
    labels,
    menuLabel: "编辑模式",
    onSelect(mode) {
      selected.push(mode);
      controller.sync(mode);
    },
    closeOtherMenus() {
      closingOtherMenus++;
    },
    isComposing: () => composing,
  });
  t.after(async () => {
    controller.destroy();
    await window.happyDOM.close();
  });
  const menu = root.querySelector<HTMLElement>(".zotero-markdown-mode-menu")!;
  const entry = (mode: string) =>
    menu.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)!;
  const key = (value: string) => {
    const event = new window.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    });
    window.document.activeElement!.dispatchEvent(event);
    return event;
  };
  return {
    window,
    root,
    button,
    menu,
    entry,
    key,
    controller,
    labels,
    selected,
    get closingOtherMenus() {
      return closingOtherMenus;
    },
    set composing(value: boolean) {
      composing = value;
    },
  };
}

test("mode control shows the current mode and opens on its checked option", (t) => {
  const f = fixture(t);
  for (const mode of ["live", "source", "preview"] as const) {
    f.controller.sync(mode);
    assert.equal(f.button.getAttribute("aria-label"), f.labels[mode]);
    assert.equal(
      f.button.querySelector(".zotero-markdown-mode-label")!.textContent,
      f.labels[mode],
    );
    assert.match(f.button.innerHTML, new RegExp(`/${mode}\\.svg`));
    f.button.click();
    assert.equal(f.menu.hidden, false);
    assert.equal(f.window.document.activeElement, f.entry(mode));
    assert.equal(f.entry(mode).getAttribute("aria-checked"), "true");
    assert.equal(f.menu.querySelectorAll('[tabindex="0"]').length, 1);
    assert.equal(f.key("Escape").defaultPrevented, true);
    assert.equal(f.window.document.activeElement, f.button);
    assert.equal(f.menu.hidden, true);
  }
  assert.equal(f.closingOtherMenus, 3);
});

test("mode menu aligns with its trigger and stays within the editor near the edge", (t) => {
  const f = fixture(t);
  f.root.getBoundingClientRect = () => new f.window.DOMRect(60, 40, 480, 360);
  f.menu.getBoundingClientRect = () => new f.window.DOMRect(0, 0, 124, 102);
  let anchor = new f.window.DOMRect(180, 50, 70, 32);
  f.button.getBoundingClientRect = () => anchor;
  f.button.click();
  assert.equal(f.menu.style.left, "180px");
  assert.equal(f.menu.style.top, "88px");
  f.controller.close();
  anchor = new f.window.DOMRect(460, 340, 70, 32);
  f.button.click();
  assert.equal(f.menu.style.left, "412px");
  assert.equal(f.menu.style.top, "294px");
});

test("mode menu supports arrows, Home/End, selection and an untrapped Tab exit", (t) => {
  const f = fixture(t);
  f.button.focus();
  f.key("ArrowDown");
  f.key("End");
  assert.equal(f.window.document.activeElement, f.entry("preview"));
  f.key("ArrowDown");
  assert.equal(f.window.document.activeElement, f.entry("live"));
  f.key("ArrowUp");
  assert.equal(f.window.document.activeElement, f.entry("preview"));
  f.key("Home");
  f.key("ArrowDown");
  f.entry("source").click();
  assert.deepEqual(f.selected, ["source"]);
  assert.equal(f.button.getAttribute("aria-label"), "源码");
  assert.equal(f.menu.hidden, true);
  assert.equal(f.window.document.activeElement, f.button);
  f.button.click();
  assert.equal(f.key("Tab").defaultPrevented, false);
  assert.equal(f.menu.hidden, true);
  assert.equal(f.window.document.activeElement, f.button);
  f.button.click();
  // Pointer activation focuses the trigger before dispatching its click.
  f.button.focus();
  f.button.click();
  assert.equal(f.menu.hidden, true, "clicking the trigger again closes it");
});

test("mode menu closes on outside click/resize and releases listeners on destroy", (t) => {
  const f = fixture(t);
  f.composing = true;
  f.button.click();
  assert.equal(f.menu.hidden, true);
  assert.equal(f.closingOtherMenus, 0);
  f.composing = false;
  f.button.click();
  f.root
    .querySelector(".after")!
    .dispatchEvent(new f.window.PointerEvent("pointerdown", { bubbles: true }));
  assert.equal(f.menu.hidden, true);
  f.button.click();
  f.window.dispatchEvent(new f.window.Event("resize"));
  assert.equal(f.menu.hidden, true);
  assert.equal(f.window.document.activeElement, f.button);
  f.button.click();
  f.root.querySelector<HTMLButtonElement>(".after")!.focus();
  assert.equal(f.menu.hidden, true);
  f.button.click();
  f.window.dispatchEvent(new f.window.Event("blur"));
  assert.equal(f.menu.hidden, true);
  f.controller.destroy();
  f.button.click();
  assert.equal(f.root.querySelector(".zotero-markdown-mode-menu"), null);
  assert.deepEqual(f.selected, []);
  assert.equal(f.closingOtherMenus, 4);
});
