import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatModalBytes,
  formatModalDate,
  modalTitle,
  normalizeMarkdownFilename,
  prefsFromSettings,
  settingsFromPrefs,
} from "../src/modules/markdown/modal.ts";
import { markdownModalCSS } from "../src/modules/markdown/styles.ts";
import { version } from "../package.json";
import { releaseHighlights } from "../src/modules/release-highlights.ts";

test("About shows installed release highlights and opens help links once across repeated visits", async (t) => {
  const { Window } = await import("happy-dom");
  const { createMarkdownModalController } =
    await import("../src/modules/markdown/modal.ts");
  const win = new Window();
  const launched: string[] = [];
  const stored = new Map<string, unknown>();
  for (const [key, value] of Object.entries({
    __buildVersion__: version,
    Zotero: {
      locale: "en-US",
      Prefs: {
        get: (key: string) => stored.get(key),
        set: (key: string, value: unknown) => stored.set(key, value),
      },
      launchURL: (url: string) => launched.push(url),
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const controller = createMarkdownModalController(
    win.document as unknown as Document,
    {},
    {
      initialSettingsPage: "about",
      about: { name: "Scholar Sketch", version, buildTime: "test build" },
    },
  );
  t.after(async () => {
    controller.destroy();
    await win.happyDOM.close();
  });
  const click = (action: string) => {
    const button = win.document.querySelector<HTMLButtonElement>(
      `[data-modal-action="${action}"]`,
    );
    assert.ok(button, `Missing ${action} action`);
    button.click();
    return button;
  };
  controller.open("settings");
  assert.deepEqual(
    [
      ...win.document.querySelectorAll(".zotero-markdown-settings-about dd"),
    ].map((element) => element.textContent),
    ["Scholar Sketch", version, "test build"],
  );
  const features = releaseHighlights(version)!.features;
  assert.deepEqual(
    [
      ...win.document.querySelectorAll(
        ".zotero-markdown-settings-release-highlights li",
      ),
    ].map((element) => element.textContent),
    features.map((feature) => `bamboo-${feature.title}bamboo-${feature.body}`),
  );
  assert.match(win.document.body.textContent, /bamboo-settings-about-star/);
  assert.equal(
    launched.length,
    0,
    "Opening About must not open external pages",
  );
  click("release-notes");
  const oldGuide = click("about-user-guide");
  click("project-repository");
  assert.deepEqual(launched, [
    `https://github.com/l0o0/scholar-sketch/releases/tag/v${version}`,
    "https://github.com/l0o0/scholar-sketch/blob/main/docs/user-guide.en.md",
    "https://github.com/l0o0/scholar-sketch",
  ]);
  assert.equal(
    stored.size,
    0,
    "Reading About must not consume the automatic notice",
  );
  win.document
    .querySelector<HTMLButtonElement>('[data-settings-page="general"]')!
    .click();
  win.document
    .querySelector<HTMLButtonElement>('[data-settings-page="about"]')!
    .click();
  oldGuide.click();
  assert.equal(launched.length, 3, "Removed page actions must be detached");
  click("project-repository");
  controller.close();
  controller.open("settings");
  const lastAction = click("project-repository");
  assert.equal(launched.length, 5);
  controller.destroy();
  lastAction.click();
  assert.equal(launched.length, 5, "Destroyed settings must not launch pages");
});

test("About does not present another release's highlights for an unknown version", async (t) => {
  const { Window } = await import("happy-dom");
  const { createMarkdownModalController } =
    await import("../src/modules/markdown/modal.ts");
  const win = new Window();
  const previousZotero = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { Prefs: { get: () => undefined } },
  });
  t.after(() => {
    if (previousZotero)
      Object.defineProperty(globalThis, "Zotero", previousZotero);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  const controller = createMarkdownModalController(
    win.document as unknown as Document,
    {},
    { about: { name: "Scholar Sketch", version: "99.0.0", buildTime: "test" } },
  );
  t.after(async () => {
    controller.destroy();
    await win.happyDOM.close();
  });
  controller.open("settings", {}, "about");
  assert.equal(
    win.document.querySelector(".zotero-markdown-settings-release-highlights"),
    null,
  );
  assert.match(
    win.document.body.textContent,
    /bamboo-settings-about-release-fallback/,
  );
  assert.ok(win.document.querySelector('[data-modal-action="release-notes"]'));
});

test("normalizes Markdown filenames without losing the extension", () => {
  assert.equal(
    normalizeMarkdownFilename("  Meeting notes  "),
    "Meeting-notes.md",
  );
  assert.equal(
    normalizeMarkdownFilename("Meeting notes.md"),
    "Meeting-notes.md",
  );
  assert.equal(normalizeMarkdownFilename("报告.md"), "报告.md");
});

test("formats document metadata values for the modal", () => {
  assert.equal(formatModalBytes(0), "0 B");
  assert.equal(formatModalBytes(1536), "1.5 KB");
  assert.equal(formatModalBytes(null), "—");
  assert.equal(
    formatModalDate("2026-08-22T10:00:00.000Z", "en-US"),
    "8/22/2026",
  );
  assert.equal(formatModalDate(null, "en-US"), "—");
});

test("maps plugin preferences to and from modal settings", () => {
  const settings = settingsFromPrefs({
    enable: true,
    frontmatter: false,
    fontSize: 16,
    theme: "system",
    markdownFontFamily: "system",
    markdownBackgroundColor: "",
    markdownSlashSearchLanguage: "auto",
    shortcutNewStandaloneMd: "accel,shift,M",
    whiteboardColorScheme: "traditional",
    whiteboardFontFamily: "system",
    whiteboardBackgroundColor: "",
  });
  assert.deepEqual(settings, {
    enable: true,
    frontmatter: false,
    fontSize: 16,
    theme: "system",
    markdownFontFamily: "system",
    markdownBackgroundColor: "",
    markdownSlashSearchLanguage: "auto",
    shortcutNewStandaloneMd: "accel,shift,M",
    whiteboardColorScheme: "traditional",
    whiteboardFontFamily: "system",
    whiteboardBackgroundColor: "",
  });
  assert.deepEqual(prefsFromSettings({ ...settings, fontSize: 18 }), {
    enable: true,
    frontmatter: false,
    fontSize: 18,
    theme: "system",
    markdownFontFamily: "system",
    markdownBackgroundColor: "",
    markdownSlashSearchLanguage: "auto",
    shortcutNewStandaloneMd: "accel,shift,M",
    whiteboardColorScheme: "traditional",
    whiteboardFontFamily: "system",
    whiteboardBackgroundColor: "",
  });
});

test("normalizes unsupported whiteboard schemes to the traditional palette", () => {
  assert.equal(
    settingsFromPrefs({
      enable: true,
      frontmatter: true,
      fontSize: 14,
      shortcutNewStandaloneMd: "",
      whiteboardColorScheme: "unsupported" as never,
    }).whiteboardColorScheme,
    "traditional",
  );
});

test("slash search segmented settings support keyboard selection, cancellation and persistence", async (t) => {
  const { Window } = await import("happy-dom");
  const { createMarkdownModalController, applySettings } =
    await import("../src/modules/markdown/modal.ts");
  const win = new Window();
  const previousZotero = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  const stored = new Map<string, unknown>();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Prefs: {
        get: (key: string) => stored.get(key),
        set: (key: string, value: unknown) => stored.set(key, value),
      },
    },
  });
  const controller = createMarkdownModalController(
    win.document as unknown as Document,
    { onSettings: applySettings },
  );
  t.after(async () => {
    controller.destroy();
    await win.happyDOM.close();
    if (previousZotero)
      Object.defineProperty(globalThis, "Zotero", previousZotero);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  const radios = () => [
    ...win.document.querySelectorAll<HTMLButtonElement>(
      "[data-slash-search-language]",
    ),
  ];
  const assertSelection = (language: string) => {
    assert.equal(radios().length, 3);
    for (const option of radios()) {
      const selected = option.dataset.slashSearchLanguage === language;
      assert.equal(option.getAttribute("aria-checked"), String(selected));
      assert.equal(option.tabIndex, selected ? 0 : -1);
    }
  };
  controller.open("settings", undefined, "editor");
  assertSelection("auto");
  radios()[2].click();
  assertSelection("pinyin");
  controller.close();
  assert.equal(stored.size, 0, "cancelled edits do not change preferences");
  controller.open("settings", undefined, "editor");
  assertSelection("auto");
  radios()[0].focus();
  radios()[0].dispatchEvent(
    new win.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
  );
  assertSelection("english");
  assert.equal(win.document.activeElement, radios()[1]);
  win.document
    .querySelector<HTMLButtonElement>('[data-settings-page="general"]')!
    .click();
  win.document
    .querySelector<HTMLButtonElement>('[data-settings-page="editor"]')!
    .click();
  assertSelection("english");
  win.document
    .querySelector<HTMLButtonElement>('[data-modal-action="save-settings"]')!
    .click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    stored.get("extensions.zotero.bamboo.markdownSlashSearchLanguage"),
    "english",
  );
  controller.open("settings", undefined, "editor");
  assertSelection("english");
  radios()[1].dispatchEvent(
    new win.KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  );
  assertSelection("pinyin");
  radios()[2].dispatchEvent(
    new win.KeyboardEvent("keydown", {
      key: "Home",
      bubbles: true,
      cancelable: true,
    }),
  );
  assertSelection("auto");
  win.document
    .querySelector<HTMLButtonElement>('[data-modal-action="save-settings"]')!
    .click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    stored.get("extensions.zotero.bamboo.markdownSlashSearchLanguage"),
    "auto",
  );
  stored.set("extensions.zotero.bamboo.markdownSlashSearchLanguage", "unknown");
  controller.open("settings", undefined, "editor");
  assertSelection("auto");
});

test("provides stable modal titles via localized keys", () => {
  // Without a Zotero window, getString falls back to the prefixed Fluent id.
  assert.equal(modalTitle("document-info"), "bamboo-more-document-info");
  assert.equal(modalTitle("rename"), "bamboo-more-rename");
  assert.equal(modalTitle("settings"), "bamboo-more-settings");
});

test("defines a centered accessible modal surface", () => {
  const css = markdownModalCSS();
  assert.match(css, /\.zotero-markdown-modal-backdrop/);
  assert.match(css, /align-items:\s*center/);
  assert.match(css, /justify-content:\s*center/);
  assert.match(css, /\.zotero-markdown-modal-button\.is-primary/);
});

test("allows document information to be selected and copied", () => {
  const css = markdownModalCSS();
  assert.match(
    css,
    /\.zotero-markdown-modal-info\s*\{[^}]*user-select:\s*text/s,
  );
});

test("defines a responsive settings workspace without changing compact dialogs", () => {
  const css = markdownModalCSS();
  assert.match(css, /\.zotero-markdown-modal\.is-settings/);
  assert.match(css, /grid-template-columns:\s*152px minmax\(0, 1fr\)/);
  assert.match(
    css,
    /zotero-markdown-settings-nav-item\[aria-selected="true"\]/,
  );
  assert.match(css, /zotero-markdown-settings-footer/);
  assert.match(css, /@media \(max-width:\s*560px\)/);
});

test("supports a tab-root mount without relying on document.body", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/modal.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /options\.mount \|\| doc\.body \|\| doc\.documentElement/,
  );
  assert.match(source, /mount\.appendChild\(backdrop\)/);
});

test("defines editor and shortcut settings controls", () => {
  const css = markdownModalCSS();
  assert.match(css, /zotero-markdown-settings-row/);
  assert.match(css, /zotero-markdown-settings-shortcut-row/);
  assert.match(css, /zotero-markdown-modal-shortcut-control/);
  const source = readFileSync(
    new URL("../src/modules/markdown/modal.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /getString\("settings-shortcut-edit"\)/);
  assert.match(source, /zotero-markdown-settings-workspace/);
  assert.match(source, /zotero-markdown-settings-navigation/);
  assert.match(source, /aria-selected/);
  assert.match(source, /SETTINGS_PAGES/);
  assert.match(source, /getString\("modal-done"\)/);
  assert.match(source, /shortcut-overflow/);
  assert.doesNotMatch(source, /button\(doc, "清除", "clear-shortcut"\)/);
  assert.doesNotMatch(source, /button\(doc, "恢复默认", "restore-shortcut"\)/);
  assert.match(source, /shortcutNewStandaloneMd/);
  assert.doesNotMatch(source, /打开 Zotero 设置/);
  assert.doesNotMatch(source, /native-settings/);
  assert.match(
    source,
    /if \(event\.defaultPrevented \|\| backdrop\.hidden\) return/,
  );
});

test("whiteboard settings preview, cancel and save preserve the preference", async (t) => {
  const { Window } = await import("happy-dom");
  const { createMarkdownModalController, applySettings } =
    await import("../src/modules/markdown/modal.ts");
  const window = new Window();
  const previousZotero = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  const stored = new Map<string, unknown>();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Prefs: {
        get: (key: string) => stored.get(key),
        set: (key: string, value: unknown) => stored.set(key, value),
      },
    },
  });
  t.after(() => {
    window.close();
    if (previousZotero)
      Object.defineProperty(globalThis, "Zotero", previousZotero);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  const controller = createMarkdownModalController(
    window.document as unknown as Document,
    { onSettings: applySettings },
    { initialSettingsPage: "whiteboard" },
  );
  t.after(() => controller.destroy());
  const choose = () => {
    const select = window.document.querySelector(
      'select[name="whiteboardColorScheme"]',
    )!;
    assert.equal(
      select.getAttribute("aria-label"),
      "bamboo-settings-whiteboard-color-scheme",
    );
    (select as unknown as HTMLSelectElement).value = "classic";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  controller.open("settings");
  assert.equal(
    (
      window.document.querySelector(
        ".zotero-markdown-settings-palette",
      ) as HTMLElement
    ).hidden,
    true,
  );
  assert.equal(
    window.document.querySelectorAll(".zotero-markdown-settings-palette-swatch")
      .length,
    18,
  );
  window.document
    .querySelector('[data-modal-action="toggle-whiteboard-preview"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(
    (
      window.document.querySelector(
        ".zotero-markdown-settings-palette",
      ) as HTMLElement
    ).hidden,
    false,
  );
  choose();
  controller.close();
  assert.equal(stored.size, 0);
  controller.open("settings");
  assert.equal(
    (window.document.querySelector("select") as unknown as HTMLSelectElement)
      .value,
    "traditional",
  );
  choose();
  window.document
    .querySelector('[data-modal-action="save-settings"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
  controller.open("settings");
  assert.equal(
    (window.document.querySelector("select") as unknown as HTMLSelectElement)
      .value,
    "classic",
  );
});

test("keeps page ownership, switches shortcut sets, and resets appearance colors", async (t) => {
  const { Window } = await import("happy-dom");
  const { createMarkdownModalController } =
    await import("../src/modules/markdown/modal.ts");
  const window = new Window();
  const previousZotero = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  const stored = new Map<string, unknown>();
  const saved: Record<string, unknown>[] = [];
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      Prefs: {
        get: (key: string) => stored.get(key),
        set: (key: string, value: unknown) => stored.set(key, value),
      },
    },
  });
  t.after(() => {
    window.close();
    if (previousZotero)
      Object.defineProperty(globalThis, "Zotero", previousZotero);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  const controller = createMarkdownModalController(
    window.document as unknown as Document,
    { onSettings: (settings) => saved.push(settings) },
  );
  t.after(() => controller.destroy());

  controller.open("settings");
  assert.ok(window.document.querySelector('select[name="theme"]'));
  assert.equal(window.document.querySelector('input[name="enable"]'), null);
  assert.equal(
    window.document.querySelector('input[name="frontmatter"]'),
    null,
  );

  window.document
    .querySelector('[data-settings-page="editor"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(window.document.querySelector('input[name="enable"]'));
  assert.ok(window.document.querySelector('input[name="frontmatter"]'));
  const markdownBackground = window.document.querySelector(
    'input[name="markdownBackgroundColor"]',
  ) as HTMLInputElement;
  markdownBackground.value = "#123456";
  markdownBackground.dispatchEvent(
    new window.Event("input", { bubbles: true }),
  );
  window.document
    .querySelector('[data-modal-action="reset-markdown-background"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(markdownBackground.value, "#ffffff");

  window.document
    .querySelector('[data-settings-page="shortcuts"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  window.document
    .querySelector('[data-shortcut-surface="whiteboard"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const whiteboardKeys = [
    ...window.document.querySelectorAll(
      ".zotero-markdown-settings-shortcut-keys",
    ),
  ].map((key) => key.textContent);
  assert.ok(whiteboardKeys.includes("Alt + drag"));
  assert.ok(whiteboardKeys.includes("↑ ↓ ← →"));
  assert.ok(whiteboardKeys.includes("Shift + ↑ ↓ ← →"));
  assert.equal(
    window.document.querySelector('input[name="shortcutNewStandaloneMd"]'),
    null,
  );
  window.document
    .querySelector('[data-shortcut-surface="markdown"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(
    window.document.querySelector('[data-modal-action="shortcut-edit"]'),
  );

  window.document
    .querySelector('[data-settings-page="whiteboard"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const whiteboardBackground = window.document.querySelector(
    'input[name="whiteboardBackgroundColor"]',
  ) as HTMLInputElement;
  whiteboardBackground.value = "#654321";
  whiteboardBackground.dispatchEvent(
    new window.Event("input", { bubbles: true }),
  );
  window.document
    .querySelector('[data-modal-action="reset-whiteboard-background"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(whiteboardBackground.value, "#fbfbfc");
  const previewButton = window.document.querySelector(
    '[data-modal-action="toggle-whiteboard-preview"]',
  )!;
  previewButton.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }),
  );
  const preview = window.document.querySelector(
    ".zotero-markdown-settings-palette",
  ) as HTMLElement;
  assert.equal(preview.hidden, false);
  window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape" }),
  );
  assert.equal(preview.hidden, true);
  assert.equal(
    window.document.querySelector(".zotero-markdown-modal-backdrop")?.hidden,
    false,
  );
  previewButton.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }),
  );
  window.document
    .querySelector(".zotero-markdown-modal-backdrop")!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(preview.hidden, true);
  assert.equal(
    window.document.querySelector(".zotero-markdown-modal-backdrop")?.hidden,
    false,
  );

  window.document
    .querySelector('[data-modal-action="save-settings"]')!
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.markdownBackgroundColor, "");
  assert.equal(
    markdownModalCSS().includes(
      ".zotero-markdown-settings-palette {\n  position: absolute;",
    ),
    true,
  );
});

test("shortcut categories expose one tab stop and switch the visible list with pointer and arrow keys", async (t) => {
  const { Window } = await import("happy-dom");
  const { createMarkdownModalController } =
    await import("../src/modules/markdown/modal.ts");
  const window = new Window();
  const previousZotero = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { Prefs: { get: () => undefined } },
  });
  const controller = createMarkdownModalController(
    window.document as unknown as Document,
  );
  t.after(() => {
    controller.destroy();
    window.close();
    if (previousZotero)
      Object.defineProperty(globalThis, "Zotero", previousZotero);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  controller.open("settings", undefined, "shortcuts");
  const group = window.document.querySelector('[role="radiogroup"]')!;
  assert.equal(
    group.getAttribute("aria-label"),
    "bamboo-settings-shortcut-surface",
  );
  const radios = [
    ...group.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];
  assert.deepEqual(
    radios.map((radio) => radio.textContent),
    [
      "bamboo-settings-shortcut-surface-markdown",
      "bamboo-settings-shortcut-surface-whiteboard",
    ],
  );
  const assertSelection = (index: number) => {
    assert.deepEqual(
      radios.map((radio) => radio.getAttribute("aria-checked")),
      radios.map((_, position) => String(position === index)),
    );
    assert.deepEqual(
      radios.map((radio) => radio.tabIndex),
      radios.map((_, position) => (position === index ? 0 : -1)),
    );
    assert.equal(
      !!window.document.querySelector('[data-modal-action="shortcut-edit"]'),
      index === 0,
    );
    assert.equal(
      window.document
        .querySelector(".zotero-markdown-settings-shortcut-list")!
        .textContent.includes("bamboo-whiteboard-shortcut-hand"),
      index === 1,
    );
  };
  assertSelection(0);
  const shortcutRows = [
    ...window.document.querySelectorAll(
      ".zotero-markdown-settings-shortcut-row",
    ),
  ];
  const keysFor = (id: string) =>
    shortcutRows
      .find((row) => row.textContent.includes(`bamboo-${id}`))
      ?.querySelector("kbd")?.textContent;
  const isMac = /Mac|iPhone|iPad/.test(window.navigator.platform);
  assert.equal(
    keysFor("settings-shortcut-import-image"),
    isMac ? "Cmd + Option + I" : "Ctrl + Alt + I",
  );
  assert.equal(
    keysFor("whiteboard-redo"),
    isMac ? "Cmd + Shift + Z" : "Ctrl + Y",
  );
  assert.equal(keysFor("settings-shortcut-unindent"), "Shift + Tab");
  assert.equal(keysFor("settings-shortcut-table-next"), "Tab");
  assert.equal(keysFor("settings-shortcut-table-previous"), "Shift + Tab");
  radios[1].click();
  assertSelection(1);
  radios[0].click();
  assertSelection(0);
  radios[0].focus();
  for (const [key, expected] of [
    ["ArrowRight", 1],
    ["ArrowRight", 0],
    ["ArrowLeft", 1],
    ["ArrowUp", 0],
    ["ArrowDown", 1],
    ["Home", 0],
    ["End", 1],
  ] as const) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    window.document.activeElement!.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(window.document.activeElement, radios[expected]);
    assertSelection(expected);
  }
  for (const key of ["Tab", "ArrowLeft"]) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      ctrlKey: key === "ArrowLeft",
      bubbles: true,
      cancelable: true,
    });
    radios[1].dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assertSelection(1);
  }
  assert.equal(
    window.document.querySelector(".zotero-markdown-modal-backdrop")!.hidden,
    false,
  );
});

test("an existing modal opens shortcut help directly and keeps regular settings on its own page", async (t) => {
  const { Window } = await import("happy-dom");
  const { createMarkdownModalController } =
    await import("../src/modules/markdown/modal.ts");
  const window = new Window();
  const previousZotero = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { Prefs: { get: () => undefined } },
  });
  const controller = createMarkdownModalController(
    window.document as unknown as Document,
  );
  t.after(() => {
    controller.destroy();
    window.close();
    if (previousZotero)
      Object.defineProperty(globalThis, "Zotero", previousZotero);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  const trigger = window.document.createElement("button");
  window.document.body.appendChild(trigger);
  for (const [platform, modifier] of [
    ["Win32", "Ctrl + Alt"],
    ["MacIntel", "Cmd + Option"],
  ]) {
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: platform,
    });
    trigger.focus();
    controller.open("settings", undefined, "shortcuts");
    const backdrop = window.document.querySelector<HTMLElement>(
      ".zotero-markdown-modal-backdrop",
    )!;
    assert.equal(backdrop.hidden, false);
    assert.equal(backdrop.getAttribute("aria-hidden"), "false");
    assert.equal(
      window.document
        .querySelector('[aria-selected="true"]')
        ?.getAttribute("data-settings-page"),
      "shortcuts",
    );
    const keys = [
      ...window.document.querySelectorAll(
        ".zotero-markdown-settings-shortcut-keys",
      ),
    ].map((element) => element.textContent);
    for (let level = 1; level <= 3; level++) {
      assert.ok(keys.includes(`${modifier} + ${level}`));
      assert.ok(!keys.includes(`Ctrl/Meta + ${level}`));
    }
    window.document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(backdrop.hidden, true);
    assert.equal(window.document.activeElement, trigger);
  }
  controller.open("settings");
  assert.equal(
    window.document
      .querySelector('[aria-selected="true"]')
      ?.getAttribute("data-settings-page"),
    "general",
  );
  assert.ok(window.document.querySelector('select[name="theme"]'));
});

test("settings retain focus and remain open during a failed save", async (t) => {
  const { Window } = await import("happy-dom");
  const { createMarkdownModalController } =
    await import("../src/modules/markdown/modal.ts");
  const window = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { Prefs: { get: () => undefined } },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Zotero", previous);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  let rejectSave!: (error: Error) => void;
  const saving = new Promise<void>((_resolve, reject) => {
    rejectSave = reject;
  });
  const controller = createMarkdownModalController(
    window.document as unknown as Document,
    { onSettings: () => saving },
  );
  t.after(() => {
    controller.destroy();
    window.close();
  });
  controller.open("settings", settingsFromPrefs());
  const backdrop = window.document.querySelector<HTMLElement>(
    ".zotero-markdown-modal-backdrop",
  )!;
  backdrop.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(backdrop.hidden, false);
  const close = window.document.querySelector<HTMLElement>(
    '[data-modal-action="close"]',
  )!;
  const save = window.document.querySelector<HTMLButtonElement>(
    '[data-modal-action="save-settings"]',
  )!;
  save.focus();
  save.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(window.document.activeElement, close);
  save.click();
  await Promise.resolve();
  assert.equal(save.disabled, true);
  controller.close();
  assert.equal(backdrop.hidden, false);
  rejectSave(new Error("Save failed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(backdrop.hidden, false);
  assert.equal(save.disabled, false);
  assert.match(
    window.document.querySelector(".zotero-markdown-modal-error")!.textContent!,
    /Save failed/,
  );
});
