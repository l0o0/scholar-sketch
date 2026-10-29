import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_MODE_OPTIONS,
  EXPORT_OPTIONS,
  submenuPosition,
  findShortcutLabel,
  MORE_MENU_SECTIONS,
} from "../src/modules/markdown/more-menu.ts";

describe("more menu", () => {
  it("keeps document, editor, export, and other actions separated", () => {
    assert.equal(MORE_MENU_SECTIONS.length, 4);
    assert.deepEqual(
      MORE_MENU_SECTIONS.map((section) => section.map((item) => item.action)),
      [
        ["document-info", "history", "rename", "show-in-folder", "open-window"],
        ["insert-citation", "search-library", "find"],
        ["export"],
        [
          "import-external-images",
          "repair-images",
          "cleanup-images",
          "shortcuts",
          "settings",
        ],
      ],
    );
  });

  it("lists the three editor modes for a flyout", () => {
    assert.deepEqual(
      EDITOR_MODE_OPTIONS.map((option) => option.mode),
      ["live", "source", "preview"],
    );
  });

  it("opens settings as a direct command without a submenu chevron", () => {
    const settings = MORE_MENU_SECTIONS.flat().find(
      (item) => item.action === "settings",
    );
    assert.ok(settings);
    assert.notEqual(settings.submenu, true);
  });

  it("uses the native find shortcut label for each platform", () => {
    assert.equal(findShortcutLabel("MacIntel"), "⌘F");
    assert.equal(findShortcutLabel("Win32"), "Ctrl+F");
  });
});

it("positions flyouts to the right or flips left within the available surface", () => {
  const bounds = { left: 0, right: 800, top: 0, bottom: 500 };
  assert.deepEqual(
    submenuPosition({ left: 200, right: 400, top: 80 }, 176, 100, bounds),
    { left: 404, top: 80 },
  );
  assert.deepEqual(
    submenuPosition({ left: 600, right: 800, top: 450 }, 176, 100, bounds),
    { left: 420, top: 396 },
  );
  assert.deepEqual(
    EXPORT_OPTIONS.map((x) => x.action),
    [
      "export-pdf",
      "export-html",
      "export-docx",
      "export-obsidian",
      "export-markdown",
    ],
  );
});

it("focuses eligible entries, navigates export and returns to its trigger", async (t) => {
  const { Window } = await import("happy-dom");
  const { mountMoreMenu, toggleMoreMenu } =
    await import("../src/modules/markdown/tab.ts");
  const window = new Window();
  window.document.body.innerHTML =
    '<main><button data-action="more"></button><div class="zotero-markdown-more-menu" hidden></div><button class="after"></button></main>';
  const root = window.document.querySelector("main")!;
  const session: any = { view: { root }, mode: "live", surface: "tab" };
  mountMoreMenu(session);
  t.after(() => {
    session.closeMoreMenu();
    window.close();
  });
  const menu = root.querySelector<HTMLElement>(".zotero-markdown-more-menu")!;
  const trigger = root.querySelector<HTMLButtonElement>(
    '[data-action="more"]',
  )!;
  const action = (name: string) =>
    menu.querySelector<HTMLButtonElement>(`[data-menu-action="${name}"]`)!;
  const key = (name: string, shiftKey = false) => {
    const event = new window.KeyboardEvent("keydown", {
      key: name,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    window.document.activeElement!.dispatchEvent(event);
    return event;
  };
  assert.equal(action("mode"), null);
  assert.equal(action("source"), null);
  action("save").hidden = true;
  action("redo").style.display = "none";
  action("history").disabled = true;
  toggleMoreMenu(session);
  assert.equal(window.document.activeElement, action("document-info"));
  key("ArrowDown");
  assert.equal(window.document.activeElement, action("rename"));
  key("End");
  assert.equal(window.document.activeElement, action("settings"));
  key("ArrowDown");
  assert.equal(window.document.activeElement, action("document-info"));
  key("Home");
  assert.equal(menu.querySelectorAll('[tabindex="0"]').length, 1);
  const exporting = root.querySelector<HTMLButtonElement>(
    '[data-menu-action="export"]',
  )!;
  const exportMenu = root.querySelector<HTMLElement>(
    ".zotero-markdown-export-submenu",
  )!;
  exporting.focus();
  key("ArrowRight");
  assert.equal(exportMenu.hidden, false);
  assert.equal(window.document.activeElement, action("export-pdf"));
  key("End");
  assert.equal(window.document.activeElement, action("export-markdown"));
  assert.equal(menu.querySelectorAll('[tabindex="0"]').length, 1);
  assert.equal(key("Escape").defaultPrevented, true);
  assert.equal(exportMenu.hidden, true);
  assert.equal(window.document.activeElement, exporting);
  assert.equal(menu.hidden, false);
  key("Escape");
  assert.equal(menu.hidden, true);
  assert.equal(window.document.activeElement, trigger);
  toggleMoreMenu(session);
  trigger.focus();
  toggleMoreMenu(session);
  assert.equal(
    menu.hidden,
    true,
    "pointer focus before toggle must not reopen the menu",
  );
  toggleMoreMenu(session);
  assert.equal(key("Tab", true).defaultPrevented, false);
  assert.equal(menu.hidden, true);
  assert.equal(window.document.activeElement, trigger);
  toggleMoreMenu(session);
  root.querySelector<HTMLButtonElement>(".after")!.focus();
  assert.equal(menu.hidden, true);
  toggleMoreMenu(session);
  window.dispatchEvent(new window.Event("blur"));
  assert.equal(menu.hidden, true);
  // Remounting must not leave a second key handler advancing two entries.
  mountMoreMenu(session);
  toggleMoreMenu(session);
  assert.equal(window.document.activeElement, action("save"));
  key("ArrowDown");
  assert.equal(window.document.activeElement, action("redo"));
  session.closeMoreMenu();
  menu.hidden = false;
  action("save").focus();
  key("ArrowDown");
  assert.equal(window.document.activeElement, action("save"));
});
