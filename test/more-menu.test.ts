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
        ["search-library", "find", "source", "mode"],
        ["export"],
        ["import-external-images", "cleanup-images", "shortcuts", "settings"],
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
    ["export-pdf", "export-html", "export-obsidian", "export-markdown"],
  );
});

it("opens one flyout at a time and returns focus on Escape", async () => {
  const { Window } = await import("happy-dom");
  const { mountMoreMenu } = await import("../src/modules/markdown/tab.ts");
  const window = new Window();
  window.document.body.innerHTML =
    '<main><button data-action="more"></button><div class="zotero-markdown-more-menu"></div></main>';
  const root = window.document.querySelector("main")!;
  const session: any = { view: { root }, mode: "live", surface: "tab" };
  mountMoreMenu(session);
  const mode = root.querySelector<HTMLButtonElement>(
    '[data-menu-action="mode"]',
  )!;
  const exporting = root.querySelector<HTMLButtonElement>(
    '[data-menu-action="export"]',
  )!;
  const modeMenu = root.querySelector<HTMLElement>(
    ".zotero-markdown-mode-submenu",
  )!;
  const exportMenu = root.querySelector<HTMLElement>(
    ".zotero-markdown-export-submenu",
  )!;
  mode.click();
  assert.equal(modeMenu.hidden, false);
  assert.equal(
    modeMenu.querySelector('[data-mode="live"]')?.getAttribute("aria-checked"),
    "true",
  );
  exporting.click();
  assert.equal(modeMenu.hidden, true);
  assert.equal(exportMenu.hidden, false);
  exportMenu.querySelector<HTMLButtonElement>("button")!.focus();
  window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );
  assert.equal(exportMenu.hidden, true);
  assert.equal(window.document.activeElement, exporting);
  assert.equal(
    root.querySelector<HTMLElement>(".zotero-markdown-more-menu")!.hidden,
    false,
  );
  session.closeMoreMenu();
  window.close();
});
