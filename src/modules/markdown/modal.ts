import { getPref, setPref } from "../../utils/prefs";
import {
  openProjectRepository,
  openReleaseNotes,
  openUserGuide,
} from "../help";
import { releaseHighlights } from "../release-highlights";
import {
  hasGarden,
  promptGardenDownload,
  openGardenQuestion,
} from "../garden-forum";
import {
  DEFAULT_NEW_MARKDOWN_SHORTCUT,
  DEFAULT_MARKDOWN_INSERT_SHORTCUTS,
  MARKDOWN_INSERT_COMMANDS,
  markdownInsertShortcutFromKeyboardEvent,
  keyboardShortcutFromKeyboardEvent,
  isShortcutModifierKey,
  shortcutFromKeyboardEvent,
  shortcutKeycaps,
  type MarkdownInsertCommand,
  type MarkdownInsertShortcuts,
} from "./shortcut";
import {
  readMarkdownInsertShortcuts,
  writeMarkdownInsertShortcuts,
} from "./insert-shortcut-preferences";
import {
  MARKDOWN_COMMAND_ACTIONS,
  MARKDOWN_COMMAND_LABELS,
  defaultMarkdownCommandShortcuts,
  markdownCommandShortcutFromKeyboardEvent,
  validateMarkdownShortcutAssignment,
  type MarkdownCommandShortcuts,
  type MarkdownShortcutAction,
} from "./markdown-command-shortcuts";
import {
  readMarkdownCommandShortcuts,
  writeMarkdownCommandShortcuts,
} from "./command-shortcut-preferences";
import {
  WHITEBOARD_SHORTCUT_ACTIONS,
  WHITEBOARD_HOLD_SHORTCUT_ACTIONS,
  defaultWhiteboardShortcuts,
  validateWhiteboardShortcut,
  type WhiteboardShortcuts,
  type WhiteboardShortcutAction,
} from "../../../packages/whiteboard/src/model/shortcuts";
import {
  readWhiteboardShortcuts,
  writeWhiteboardShortcuts,
} from "../whiteboard/shortcut-preferences";
import { getString } from "../../utils/locale";
import type { FluentMessageId } from "../../../typings/i10n";
import {
  iconCanvas,
  iconPalette,
  iconReset,
  iconInfo,
  iconKeyboard,
  iconMore,
  iconSettings,
  iconType,
} from "./icons";
import {
  nextSettingsPage,
  SETTINGS_PAGES,
  settingsPageLabel,
  type SettingsPageID,
} from "./settings-pages";
import { normalizeMarkdownFilename } from "./storage-filename";
import {
  colorPalette,
  normalizeColorScheme,
  type ColorSchemeID,
} from "../../../packages/whiteboard/src/model/colorSchemes";
import {
  normalizeAppearanceTheme,
  normalizeColor,
  normalizeFontFamily,
  normalizeSlashSearchLanguage,
  resolveMarkdownToolbarMode,
  type AppearanceTheme,
  type FontFamilyID,
  type MarkdownToolbarMode,
  type SlashSearchLanguage,
} from "./preferences";

import type { MarkdownStyleSettings } from "./style-settings";
import { compileMarkdownStyleCss } from "./style-css";
import {
  readMarkdownStyleSettings,
  writeMarkdownStyleSettings,
} from "./style-preferences";
import { createMarkdownStyleSettingsUI } from "./style-settings-ui";

export { normalizeMarkdownFilename } from "./storage-filename";

export type ModalKind = "document-info" | "rename" | "settings";

export interface DocumentModalData {
  title: string;
  path: string | null;
  size: number | null;
  imageCount: number;
  created: string | null;
  modified: string | null;
  storageLabel: string;
}

export interface SettingsModalData {
  enable: boolean;
  frontmatter: boolean;
  markdownStyles: MarkdownStyleSettings;
  theme: AppearanceTheme;
  markdownToolbarMode: MarkdownToolbarMode;
  markdownSlashSearchLanguage: SlashSearchLanguage;
  markdownPdfLinkPreviewEnabled: boolean;
  shortcutNewStandaloneMd: string;
  markdownInsertShortcuts: MarkdownInsertShortcuts;
  markdownCommandShortcuts: MarkdownCommandShortcuts;
  whiteboardShortcuts: WhiteboardShortcuts;
  whiteboardColorScheme: ColorSchemeID;
  whiteboardFontFamily: FontFamilyID;
  whiteboardBackgroundColor: string;
}

export interface MarkdownModalCallbacks {
  onRename?: (filename: string) => Promise<void> | void;
  onReveal?: () => Promise<void> | void;
  onSettings?: (settings: SettingsModalData) => Promise<void> | void;
  onClose?: () => void;
}

export interface MarkdownModalOptions {
  mount?: HTMLElement;
  initialSettingsPage?: SettingsPageID;
  about?: {
    name: string;
    version: string;
    buildTime: string;
  };
}

export interface MarkdownModalController {
  open: (
    kind: ModalKind,
    payload?: DocumentModalData | Partial<SettingsModalData>,
    initialSettingsPage?: SettingsPageID,
  ) => void;
  close: () => void;
  destroy: () => void;
}

const INSERT_SHORTCUT_LABELS: Record<MarkdownInsertCommand, FluentMessageId> = {
  annotation: "markdown-annotation-insert-title",
  image: "settings-shortcut-import-image",
  table: "tab-table",
  task: "tab-task",
  code: "tab-code",
};

const WHITEBOARD_SHORTCUT_SETTING_LABELS: Record<
  WhiteboardShortcutAction,
  FluentMessageId
> = {
  save: "whiteboard-save",
  find: "whiteboard-search-canvas",
  select: "whiteboard-shortcut-select",
  hand: "whiteboard-shortcut-hand",
  pan: "whiteboard-shortcut-pan",
  freeMove: "whiteboard-shortcut-free-move",
  nudgeUp: "whiteboard-shortcut-nudge-up",
  nudgeDown: "whiteboard-shortcut-nudge-down",
  nudgeLeft: "whiteboard-shortcut-nudge-left",
  nudgeRight: "whiteboard-shortcut-nudge-right",
  nudgeUpLarge: "whiteboard-shortcut-nudge-up-large",
  nudgeDownLarge: "whiteboard-shortcut-nudge-down-large",
  nudgeLeftLarge: "whiteboard-shortcut-nudge-left-large",
  nudgeRightLarge: "whiteboard-shortcut-nudge-right-large",
  fitView: "whiteboard-fit-view",
  fitSelection: "whiteboard-fit-selection",
  rect: "whiteboard-shortcut-rect",
  ellipse: "whiteboard-shortcut-ellipse",
  arrow: "whiteboard-shortcut-arrow",
  line: "whiteboard-shortcut-line",
  text: "whiteboard-shortcut-text",
  question: "whiteboard-shortcut-question",
  claim: "whiteboard-shortcut-claim",
  frame: "whiteboard-shortcut-frame",
  eraser: "whiteboard-shortcut-eraser",
  constrain: "whiteboard-shortcut-constrain",
  cancel: "whiteboard-shortcut-cancel",
  delete: "whiteboard-shortcut-delete",
  undo: "whiteboard-undo",
  redo: "whiteboard-redo",
};
const MARKDOWN_SHORTCUT_LABELS: Record<
  MarkdownShortcutAction,
  FluentMessageId
> = {
  ...MARKDOWN_COMMAND_LABELS,
  ...INSERT_SHORTCUT_LABELS,
  "new-note": "settings-shortcut-new-standalone",
};

function shortcutProblemText(
  problem:
    | { kind: "invalid" }
    | { kind: "reserved" }
    | { kind: "duplicate"; command: string },
  labels: Record<string, FluentMessageId> = MARKDOWN_SHORTCUT_LABELS,
  invalidLabel: FluentMessageId = "settings-shortcut-invalid",
): string {
  if (problem.kind === "invalid") return getString(invalidLabel);
  if (problem.kind === "reserved")
    return getString("settings-shortcut-reserved");
  return getString("settings-shortcut-duplicate", {
    args: { action: getString(labels[problem.command]) },
  });
}

export function modalTitle(kind: ModalKind): string {
  switch (kind) {
    case "document-info":
      return getString("more-document-info");
    case "rename":
      return getString("more-rename");
    case "settings":
      return getString("more-settings");
  }
}

export function formatModalBytes(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, "")} GB`;
}

export function formatModalDate(
  value: string | number | Date | null,
  locale?: string,
): string {
  if (value === null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(locale);
}

export function settingsFromPrefs(
  prefs: SettingsModalData = {
    enable: Boolean(getPref("enable")),
    frontmatter: Boolean(getPref("frontmatter")),
    markdownStyles: readMarkdownStyleSettings(),
    theme: normalizeAppearanceTheme(getPref("theme")),
    markdownToolbarMode: resolveMarkdownToolbarMode(
      getPref("markdownToolbarMode"),
      getPref("markdownToolbarVisible"),
    ),
    markdownSlashSearchLanguage: normalizeSlashSearchLanguage(
      getPref("markdownSlashSearchLanguage"),
    ),
    markdownPdfLinkPreviewEnabled:
      getPref("markdown.linkPreview.pdfEnabled") !== false,
    shortcutNewStandaloneMd: String(getPref("shortcutNewStandaloneMd") || ""),
    markdownInsertShortcuts: readMarkdownInsertShortcuts(),
    markdownCommandShortcuts: readMarkdownCommandShortcuts(),
    whiteboardShortcuts: readWhiteboardShortcuts(),
    whiteboardColorScheme: normalizeColorScheme(
      getPref("whiteboardColorScheme"),
    ),
    whiteboardFontFamily: normalizeFontFamily(getPref("whiteboardFontFamily")),
    whiteboardBackgroundColor: normalizeColor(
      getPref("whiteboardBackgroundColor"),
    ),
  },
): SettingsModalData {
  return {
    enable: Boolean(prefs.enable),
    frontmatter: Boolean(prefs.frontmatter),
    markdownStyles: {
      ...prefs.markdownStyles,
      presets: prefs.markdownStyles.presets.map((preset) => ({ ...preset })),
    },
    theme: normalizeAppearanceTheme(prefs.theme),
    markdownToolbarMode: resolveMarkdownToolbarMode(
      prefs.markdownToolbarMode,
      undefined,
    ),
    markdownSlashSearchLanguage: normalizeSlashSearchLanguage(
      prefs.markdownSlashSearchLanguage,
    ),
    markdownPdfLinkPreviewEnabled: prefs.markdownPdfLinkPreviewEnabled,
    shortcutNewStandaloneMd: String(prefs.shortcutNewStandaloneMd || ""),
    markdownInsertShortcuts: { ...prefs.markdownInsertShortcuts },
    markdownCommandShortcuts: { ...prefs.markdownCommandShortcuts },
    whiteboardShortcuts: { ...prefs.whiteboardShortcuts },
    whiteboardColorScheme: normalizeColorScheme(prefs.whiteboardColorScheme),
    whiteboardFontFamily: normalizeFontFamily(prefs.whiteboardFontFamily),
    whiteboardBackgroundColor: normalizeColor(prefs.whiteboardBackgroundColor),
  };
}

export function prefsFromSettings(settings: SettingsModalData) {
  return settingsFromPrefs(settings);
}

function textElement(
  doc: Document,
  tag: string,
  text: string,
  className?: string,
) {
  const element = doc.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(doc: Document, label: string, action: string, primary = false) {
  const element = doc.createElement("button");
  element.type = "button";
  element.dataset.modalAction = action;
  element.className = `zotero-markdown-modal-button${primary ? " is-primary" : ""}`;
  element.textContent = label;
  return element;
}

function bindSegmentedOptions(
  buttons: HTMLButtonElement[],
  onSelect: (index: number) => void,
  initialIndex = 0,
) {
  const select = (index: number) => {
    if (buttons[index].getAttribute("aria-checked") === "true") return;
    buttons.forEach((option, optionIndex) => {
      const selected = optionIndex === index;
      option.setAttribute("aria-checked", String(selected));
      option.tabIndex = selected ? 0 : -1;
    });
    onSelect(index);
  };
  buttons.forEach((option, index) => {
    option.addEventListener("click", () => select(index));
    option.addEventListener("keydown", (event) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      let next: number;
      if (event.key === "ArrowRight" || event.key === "ArrowDown")
        next = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        next = (index + buttons.length - 1) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      else return;
      event.preventDefault();
      select(next);
      buttons[next].focus();
    });
  });
  select(initialIndex);
}

export function createMarkdownModalController(
  doc: Document,
  callbacks: MarkdownModalCallbacks = {},
  options: MarkdownModalOptions = {},
): MarkdownModalController {
  const backdrop = doc.createElement("div");
  backdrop.className = "zotero-markdown-modal-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");

  const dialog = doc.createElement("section");
  dialog.className = "zotero-markdown-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;

  const title = textElement(doc, "h2", "", "zotero-markdown-modal-title");
  const close = button(doc, "×", "close");
  close.classList.add("is-close");
  close.setAttribute("aria-label", getString("modal-close"));
  const header = doc.createElement("header");
  header.className = "zotero-markdown-modal-header";
  header.append(title, close);
  const body = doc.createElement("div");
  body.className = "zotero-markdown-modal-body";
  dialog.append(header, body);
  backdrop.appendChild(dialog);
  const mount = options.mount || doc.body || doc.documentElement;
  if (!mount) {
    throw new Error("Markdown modal mount is not available");
  }
  mount.appendChild(backdrop);

  let activeKind: ModalKind | null = null;
  let restoreFocus: HTMLElement | null = null;
  let pendingSettings: SettingsModalData | null = null;
  let settingsAtOpen = "";
  let savingSettings = false;
  let selectSettingsPage:
    ((page: SettingsPageID, focusHeading?: boolean) => void) | null = null;

  const closeChildDialogs = () => {
    for (const child of body.querySelectorAll<HTMLDialogElement>(
      "dialog[open]",
    ))
      child.close();
  };
  const closeModal = () => {
    if (backdrop.hidden || savingSettings) return;
    closeChildDialogs();
    backdrop.hidden = true;
    backdrop.setAttribute("aria-hidden", "true");
    activeKind = null;
    restoreFocus?.focus?.();
    restoreFocus = null;
    callbacks.onClose?.();
  };

  const renderDocumentInfo = (data: DocumentModalData) => {
    const rows: [string, string][] = [
      [getString("modal-filename"), data.title || "—"],
      [getString("modal-path"), data.path || "—"],
      [getString("modal-size"), formatModalBytes(data.size)],
      [getString("modal-image-count"), String(data.imageCount)],
      [getString("modal-created"), formatModalDate(data.created)],
      [getString("modal-modified"), formatModalDate(data.modified)],
      [getString("modal-storage-type"), data.storageLabel || "—"],
    ];
    const list = doc.createElement("dl");
    list.className = "zotero-markdown-modal-info";
    for (const [label, value] of rows) {
      list.append(textElement(doc, "dt", label), textElement(doc, "dd", value));
    }
    body.appendChild(list);
    const footer = doc.createElement("footer");
    footer.className = "zotero-markdown-modal-footer";
    footer.append(button(doc, getString("more-show-in-folder"), "reveal"));
    body.appendChild(footer);
  };

  const renderRename = (data: DocumentModalData) => {
    const label = textElement(
      doc,
      "label",
      getString("modal-filename"),
      "zotero-markdown-modal-label",
    );
    const input = doc.createElement("input");
    input.type = "text";
    input.name = "filename";
    input.value = data.title || "Note.md";
    input.className = "zotero-markdown-modal-input";
    label.appendChild(input);
    body.appendChild(label);
    const error = textElement(doc, "p", "", "zotero-markdown-modal-error");
    error.dataset.modalError = "";
    error.hidden = true;
    body.appendChild(error);
    const footer = doc.createElement("footer");
    footer.className = "zotero-markdown-modal-footer";
    footer.append(
      button(doc, getString("modal-cancel"), "close"),
      button(doc, getString("more-rename"), "rename", true),
    );
    body.appendChild(footer);
    input.focus();
    input.select();
  };

  const renderSettings = (
    payload: Partial<SettingsModalData> = {},
    initialSettingsPage = options.initialSettingsPage,
  ) => {
    pendingSettings = settingsFromPrefs({
      enable: payload.enable ?? Boolean(getPref("enable")),
      frontmatter: payload.frontmatter ?? Boolean(getPref("frontmatter")),
      markdownStyles: payload.markdownStyles ?? readMarkdownStyleSettings(),
      theme: payload.theme ?? normalizeAppearanceTheme(getPref("theme")),
      markdownToolbarMode:
        payload.markdownToolbarMode ??
        resolveMarkdownToolbarMode(
          getPref("markdownToolbarMode"),
          getPref("markdownToolbarVisible"),
        ),
      markdownSlashSearchLanguage:
        payload.markdownSlashSearchLanguage ??
        normalizeSlashSearchLanguage(getPref("markdownSlashSearchLanguage")),
      markdownPdfLinkPreviewEnabled:
        payload.markdownPdfLinkPreviewEnabled ??
        getPref("markdown.linkPreview.pdfEnabled") !== false,
      shortcutNewStandaloneMd:
        payload.shortcutNewStandaloneMd ??
        String(getPref("shortcutNewStandaloneMd") || ""),
      markdownInsertShortcuts:
        payload.markdownInsertShortcuts ?? readMarkdownInsertShortcuts(),
      markdownCommandShortcuts:
        payload.markdownCommandShortcuts ??
        readMarkdownCommandShortcuts(doc.defaultView?.navigator.platform),
      whiteboardShortcuts:
        payload.whiteboardShortcuts ??
        readWhiteboardShortcuts(doc.defaultView?.navigator.platform),
      whiteboardColorScheme:
        payload.whiteboardColorScheme ??
        normalizeColorScheme(getPref("whiteboardColorScheme")),
      whiteboardFontFamily:
        payload.whiteboardFontFamily ??
        normalizeFontFamily(getPref("whiteboardFontFamily")),
      whiteboardBackgroundColor:
        payload.whiteboardBackgroundColor ??
        normalizeColor(getPref("whiteboardBackgroundColor")),
    });
    settingsAtOpen = JSON.stringify(pendingSettings);

    const workspace = doc.createElement("form");
    workspace.className = "zotero-markdown-settings-workspace";
    workspace.addEventListener("submit", (event) => event.preventDefault());
    const navigation = doc.createElement("nav");
    navigation.className = "zotero-markdown-settings-navigation";
    navigation.setAttribute("role", "tablist");
    navigation.setAttribute("aria-label", getString("settings-tablist-label"));
    const main = doc.createElement("main");
    main.className = "zotero-markdown-settings-main";
    const pageContent = doc.createElement("div");
    pageContent.className = "zotero-markdown-settings-page";
    const footer = doc.createElement("footer");
    footer.className =
      "zotero-markdown-modal-footer zotero-markdown-settings-footer";
    footer.append(button(doc, getString("modal-done"), "save-settings", true));
    const error = textElement(doc, "p", "", "zotero-markdown-modal-error");
    error.dataset.modalError = "";
    error.hidden = true;
    main.append(pageContent, error);
    workspace.append(navigation, main, footer);

    const iconForPage = (page: SettingsPageID) => {
      if (page === "general") return iconSettings();
      if (page === "editor") return iconType();
      if (page === "whiteboard") return iconCanvas();
      if (page === "shortcuts") return iconKeyboard();
      return iconInfo();
    };
    let activePage: SettingsPageID = "general";

    const renderHeading = (label: string) => {
      const heading = textElement(
        doc,
        "h3",
        label,
        "zotero-markdown-settings-page-title",
      );
      heading.tabIndex = -1;
      pageContent.appendChild(heading);
      return heading;
    };

    const renderGeneral = () => {
      const heading = renderHeading(getString("settings-page-general"));
      const row = doc.createElement("label");
      row.className = "zotero-markdown-settings-row";
      row.appendChild(textElement(doc, "span", getString("settings-theme")));
      const select = doc.createElement("select");
      select.name = "theme";
      select.className = "zotero-markdown-settings-select";
      for (const [value, labelKey] of [
        ["system", "settings-theme-system"],
        ["light", "settings-theme-light"],
        ["dark", "settings-theme-dark"],
      ] as const) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = getString(labelKey);
        select.appendChild(option);
      }
      select.value = normalizeAppearanceTheme(pendingSettings?.theme);
      select.addEventListener("change", () => {
        if (pendingSettings)
          pendingSettings.theme = normalizeAppearanceTheme(select.value);
      });
      row.appendChild(select);
      pageContent.appendChild(row);
      const help = doc.createElement("section");
      help.className = "zotero-markdown-settings-help";
      help.append(
        textElement(doc, "h4", getString("settings-help-title")),
        textElement(doc, "p", getString("settings-help-description")),
      );
      const guide = button(doc, getString("settings-user-guide"), "user-guide");
      guide.addEventListener("click", () => void openUserGuide());
      help.appendChild(guide);
      pageContent.appendChild(help);
      return heading;
    };

    const renderEditor = () => {
      const heading = renderHeading(getString("settings-page-editor"));
      const checkbox = (
        name: "enable" | "frontmatter" | "markdownPdfLinkPreviewEnabled",
        labelText: string,
      ) => {
        const label = doc.createElement("label");
        label.className = "zotero-markdown-settings-check-row";
        const input = doc.createElement("input");
        input.type = "checkbox";
        input.name = name;
        input.checked = !!pendingSettings?.[name];
        input.addEventListener("change", () => {
          if (pendingSettings) pendingSettings[name] = input.checked;
        });
        label.append(input, textElement(doc, "span", labelText));
        pageContent.appendChild(label);
      };
      checkbox("enable", getString("settings-enable-editor"));
      checkbox("frontmatter", getString("settings-frontmatter"));
      checkbox(
        "markdownPdfLinkPreviewEnabled",
        getString("settings-markdown-pdf-preview"),
      );
      const toolbarRow = doc.createElement("label");
      toolbarRow.className = "zotero-markdown-settings-row";
      toolbarRow.appendChild(
        textElement(doc, "span", getString("settings-markdown-toolbar")),
      );
      const toolbarMode = doc.createElement("select");
      toolbarMode.name = "markdownToolbarMode";
      toolbarMode.className = "zotero-markdown-settings-select";
      for (const [value, labelKey] of [
        ["always", "settings-markdown-toolbar-always"],
        ["auto", "settings-markdown-toolbar-auto"],
        ["hidden", "settings-markdown-toolbar-hidden"],
      ] as const) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = getString(labelKey);
        toolbarMode.appendChild(option);
      }
      toolbarMode.value = pendingSettings!.markdownToolbarMode;
      toolbarMode.addEventListener("change", () => {
        if (pendingSettings)
          pendingSettings.markdownToolbarMode = resolveMarkdownToolbarMode(
            toolbarMode.value,
            undefined,
          );
      });
      toolbarRow.appendChild(toolbarMode);
      pageContent.appendChild(toolbarRow);
      pageContent.appendChild(
        textElement(
          doc,
          "p",
          getString("settings-markdown-toolbar-description"),
          "zotero-markdown-settings-description",
        ),
      );
      const searchRow = doc.createElement("div");
      searchRow.className = "zotero-markdown-settings-row";
      searchRow.appendChild(
        textElement(doc, "span", getString("settings-slash-search-language")),
      );
      const searchLanguage = doc.createElement("div");
      searchLanguage.className =
        "zotero-markdown-settings-shortcut-surface zotero-markdown-settings-slash-language";
      searchLanguage.setAttribute("role", "radiogroup");
      searchLanguage.setAttribute(
        "aria-label",
        getString("settings-slash-search-language"),
      );
      const languages = [
        ["auto", "settings-slash-search-auto"],
        ["english", "settings-slash-search-english"],
        ["pinyin", "settings-slash-search-pinyin"],
      ] as const;
      const languageButtons = languages.map(([value, labelKey]) => {
        const option = doc.createElement("button");
        option.type = "button";
        option.dataset.slashSearchLanguage = value;
        option.setAttribute("role", "radio");
        option.textContent = getString(labelKey);
        searchLanguage.appendChild(option);
        return option;
      });
      bindSegmentedOptions(
        languageButtons,
        (index) => {
          if (pendingSettings)
            pendingSettings.markdownSlashSearchLanguage = languages[index][0];
        },
        languages.findIndex(
          ([value]) => value === pendingSettings?.markdownSlashSearchLanguage,
        ),
      );
      searchRow.appendChild(searchLanguage);
      pageContent.append(
        searchRow,
        textElement(
          doc,
          "p",
          getString("settings-slash-search-description"),
          "zotero-markdown-settings-description",
        ),
      );
      pageContent.appendChild(
        createMarkdownStyleSettingsUI(
          doc,
          pendingSettings!.markdownStyles,
          pendingSettings!.theme === "dark" ||
            (pendingSettings!.theme === "system" &&
              !!doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)")
                ?.matches)
            ? "dark"
            : "light",
        ),
      );
      return heading;
    };

    const renderShortcuts = () => {
      const heading = renderHeading(getString("settings-page-shortcuts"));
      const header = doc.createElement("div");
      header.className = "zotero-markdown-settings-shortcuts-header";
      header.appendChild(heading);
      const surface = doc.createElement("div");
      surface.className = "zotero-markdown-settings-shortcut-surface";
      surface.setAttribute("role", "radiogroup");
      surface.setAttribute(
        "aria-label",
        getString("settings-shortcut-surface"),
      );
      const surfaces = [
        ["markdown", "settings-shortcut-surface-markdown"],
        ["whiteboard", "settings-shortcut-surface-whiteboard"],
      ] as const;
      const surfaceButtons = surfaces.map(([value, labelKey]) => {
        const option = doc.createElement("button");
        option.type = "button";
        option.dataset.shortcutSurface = value;
        option.setAttribute("role", "radio");
        option.textContent = getString(labelKey);
        surface.appendChild(option);
        return option;
      });
      header.appendChild(surface);
      pageContent.appendChild(header);

      const list = doc.createElement("div");
      list.className = "zotero-markdown-settings-shortcut-list";
      const renderRows = (kind: "markdown" | "whiteboard") => {
        list.replaceChildren();
        let stopRecording: (() => void) | undefined;
        const closeShortcutMenus = () => {
          for (const menu of list.querySelectorAll<HTMLElement>(
            ".zotero-markdown-shortcut-overflow-menu",
          ))
            menu.hidden = true;
          for (const trigger of list.querySelectorAll<HTMLElement>(
            ".zotero-markdown-shortcut-overflow",
          ))
            trigger.setAttribute("aria-expanded", "false");
        };
        const editableRow = (options: {
          id: string;
          label: FluentMessageId;
          read: () => string;
          write: (value: string) => void;
          defaultValue: string;
          validate: (value: string) => string;
          record: (event: KeyboardEvent) => string | null;
          allowHeldModifier?: boolean;
          deleteClears?: boolean;
          invalidLabel?: FluentMessageId;
        }) => {
          const label = getString(options.label);
          const row = doc.createElement("div");
          row.className = "zotero-markdown-settings-shortcut-row is-editable";
          row.dataset.shortcutId = options.id;
          row.setAttribute("role", "group");
          row.setAttribute("aria-label", label);
          const description = doc.createElement("div");
          const error = textElement(
            doc,
            "p",
            "",
            "zotero-markdown-modal-error",
          );
          error.dataset.shortcutError = "";
          error.setAttribute("role", "alert");
          error.hidden = true;
          description.append(textElement(doc, "span", label), error);
          row.appendChild(description);
          const controls = doc.createElement("div");
          controls.className = "zotero-markdown-settings-shortcut-controls";
          const shortcutControl = doc.createElement("button");
          shortcutControl.type = "button";
          shortcutControl.className = "zotero-markdown-modal-shortcut-control";
          shortcutControl.setAttribute(
            "aria-label",
            getString("settings-shortcut-edit-action", {
              args: { action: label },
            }),
          );
          const shortcutValue = doc.createElement("span");
          shortcutValue.className = "zotero-markdown-modal-shortcut-value";
          const renderShortcut = () => {
            shortcutValue.replaceChildren();
            const keycaps = shortcutKeycaps(
              options.read(),
              doc.defaultView?.navigator.platform,
            );
            if (!keycaps.length)
              shortcutValue.textContent = getString("settings-shortcut-unset");
            else
              for (const keycap of keycaps)
                shortcutValue.appendChild(textElement(doc, "kbd", keycap));
          };
          renderShortcut();
          shortcutControl.appendChild(shortcutValue);
          const showError = (message: string) => {
            error.textContent = message;
            error.hidden = !message;
            if (message) shortcutControl.setAttribute("aria-invalid", "true");
            else shortcutControl.removeAttribute("aria-invalid");
          };
          const setShortcut = (value: string) => {
            const message = options.validate(value);
            showError(message);
            if (message) return false;
            options.write(value);
            renderShortcut();
            return true;
          };
          const finishRecording = () => {
            shortcutControl.classList.remove("is-recording");
            shortcutControl.removeAttribute("aria-live");
            renderShortcut();
            if (stopRecording === finishRecording) stopRecording = undefined;
          };
          let recordingPrevious = options.read();
          let pendingModifier: string | undefined;
          const beginRecording = () => {
            stopRecording?.();
            closeShortcutMenus();
            recordingPrevious = options.read();
            pendingModifier = undefined;
            showError("");
            shortcutControl.classList.add("is-recording");
            shortcutControl.setAttribute("aria-live", "polite");
            shortcutValue.textContent = getString(
              "settings-shortcut-recording",
            );
            stopRecording = finishRecording;
            shortcutControl.focus();
          };
          const edit = button(
            doc,
            getString("settings-shortcut-edit"),
            "shortcut-edit",
          );
          edit.setAttribute(
            "aria-label",
            shortcutControl.getAttribute("aria-label")!,
          );
          shortcutControl.addEventListener("click", beginRecording);
          edit.addEventListener("click", beginRecording);
          shortcutControl.addEventListener("blur", finishRecording);
          shortcutControl.addEventListener("keydown", (event) => {
            if (!shortcutControl.classList.contains("is-recording")) return;
            if (event.isComposing || event.keyCode === 229 || event.repeat)
              return;
            if (
              event.key === "Escape" &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.shiftKey
            ) {
              event.preventDefault();
              options.write(recordingPrevious);
              showError("");
            } else if (
              options.deleteClears !== false &&
              (event.key === "Backspace" || event.key === "Delete")
            ) {
              event.preventDefault();
              setShortcut("");
            } else {
              if (
                options.allowHeldModifier &&
                isShortcutModifierKey(event.key)
              ) {
                pendingModifier = event.key;
                event.preventDefault();
                return;
              }
              pendingModifier = undefined;
              const recorded = options.record(event);
              if (!recorded) {
                if (!isShortcutModifierKey(event.key)) {
                  event.preventDefault();
                  showError(
                    getString(
                      options.invalidLabel ?? "settings-shortcut-invalid",
                    ),
                  );
                }
                return;
              }
              event.preventDefault();
              if (!setShortcut(recorded)) return;
            }
            finishRecording();
          });
          shortcutControl.addEventListener("keyup", (event) => {
            if (
              !shortcutControl.classList.contains("is-recording") ||
              event.key !== pendingModifier
            )
              return;
            pendingModifier = undefined;
            const recorded = options.record(event);
            if (!recorded) return;
            event.preventDefault();
            if (setShortcut(recorded)) finishRecording();
          });
          const overflow = doc.createElement("button");
          overflow.type = "button";
          overflow.className = "zotero-markdown-shortcut-overflow";
          overflow.setAttribute(
            "aria-label",
            getString("settings-shortcut-more-action", {
              args: { action: label },
            }),
          );
          overflow.setAttribute("aria-expanded", "false");
          overflow.innerHTML = iconMore();
          const overflowMenu = doc.createElement("div");
          overflowMenu.className = "zotero-markdown-shortcut-overflow-menu";
          overflowMenu.hidden = true;
          const clear = button(
            doc,
            getString("settings-shortcut-clear"),
            "shortcut-clear",
          );
          const restore = button(
            doc,
            getString("settings-shortcut-restore"),
            "shortcut-restore",
          );
          overflowMenu.append(clear, restore);
          overflow.addEventListener("click", () => {
            const open = overflowMenu.hidden;
            closeShortcutMenus();
            overflowMenu.hidden = !open;
            overflow.setAttribute("aria-expanded", String(open));
          });
          clear.addEventListener("click", () => {
            setShortcut("");
            closeShortcutMenus();
          });
          restore.addEventListener("click", () => {
            setShortcut(options.defaultValue);
            closeShortcutMenus();
          });
          controls.append(shortcutControl, edit, overflow, overflowMenu);
          row.appendChild(controls);
          return row;
        };
        const platform = doc.defaultView?.navigator.platform;
        if (kind === "whiteboard") {
          for (const action of WHITEBOARD_SHORTCUT_ACTIONS) {
            const isHold = WHITEBOARD_HOLD_SHORTCUT_ACTIONS.some(
              (value) => value === action,
            );
            list.appendChild(
              editableRow({
                id: `wb-${action}`,
                label: WHITEBOARD_SHORTCUT_SETTING_LABELS[action],
                read: () => pendingSettings!.whiteboardShortcuts[action],
                write: (value) => {
                  pendingSettings!.whiteboardShortcuts[action] = value;
                },
                defaultValue: defaultWhiteboardShortcuts(platform)[action],
                validate: (value) => {
                  const problem = validateWhiteboardShortcut(
                    action,
                    value,
                    pendingSettings!.whiteboardShortcuts,
                    pendingSettings!.shortcutNewStandaloneMd,
                    platform,
                  );
                  return problem
                    ? shortcutProblemText(
                        problem,
                        {
                          ...WHITEBOARD_SHORTCUT_SETTING_LABELS,
                          "new-note": "settings-shortcut-new-standalone",
                        },
                        "settings-shortcut-invalid-whiteboard",
                      )
                    : "";
                },
                record: (event) =>
                  keyboardShortcutFromKeyboardEvent(event, platform, {
                    allowModifierOnly: isHold,
                  }),
                allowHeldModifier: isHold,
                deleteClears: false,
                invalidLabel: "settings-shortcut-invalid-whiteboard",
              }),
            );
          }
          return;
        }
        const validateMarkdown = (
          action: MarkdownShortcutAction,
          value: string,
        ) => {
          const problem = validateMarkdownShortcutAssignment(
            action,
            value,
            pendingSettings!.markdownCommandShortcuts,
            pendingSettings!.markdownInsertShortcuts,
            pendingSettings!.shortcutNewStandaloneMd,
            platform,
          );
          return problem ? shortcutProblemText(problem) : "";
        };
        for (const action of MARKDOWN_COMMAND_ACTIONS) {
          list.appendChild(
            editableRow({
              id: action,
              label: MARKDOWN_COMMAND_LABELS[action],
              read: () => pendingSettings!.markdownCommandShortcuts[action],
              write: (value) => {
                pendingSettings!.markdownCommandShortcuts[action] = value;
              },
              defaultValue: defaultMarkdownCommandShortcuts(platform)[action],
              validate: (value) => validateMarkdown(action, value),
              record: (event) =>
                markdownCommandShortcutFromKeyboardEvent(
                  action,
                  event,
                  platform,
                ),
            }),
          );
        }
        for (const command of MARKDOWN_INSERT_COMMANDS) {
          list.appendChild(
            editableRow({
              id: command,
              label: INSERT_SHORTCUT_LABELS[command],
              read: () => pendingSettings!.markdownInsertShortcuts[command],
              write: (value) => {
                pendingSettings!.markdownInsertShortcuts[command] = value;
              },
              defaultValue: DEFAULT_MARKDOWN_INSERT_SHORTCUTS[command],
              validate: (value) => validateMarkdown(command, value),
              record: (event) =>
                markdownInsertShortcutFromKeyboardEvent(event, platform),
            }),
          );
        }
        list.appendChild(
          editableRow({
            id: "new-note",
            label: "settings-shortcut-new-standalone",
            read: () => pendingSettings!.shortcutNewStandaloneMd,
            write: (value) => {
              pendingSettings!.shortcutNewStandaloneMd = value;
            },
            defaultValue: DEFAULT_NEW_MARKDOWN_SHORTCUT,
            validate: (value) => {
              const markdownError = validateMarkdown("new-note", value);
              if (markdownError) return markdownError;
              for (const action of WHITEBOARD_SHORTCUT_ACTIONS) {
                const problem = validateWhiteboardShortcut(
                  action,
                  pendingSettings!.whiteboardShortcuts[action],
                  pendingSettings!.whiteboardShortcuts,
                  value,
                  platform,
                );
                if (
                  problem?.kind === "duplicate" &&
                  problem.command === "new-note"
                )
                  return getString("settings-shortcut-duplicate", {
                    args: {
                      action: `${getString("settings-shortcut-surface-whiteboard")} · ${getString(WHITEBOARD_SHORTCUT_SETTING_LABELS[action])}`,
                    },
                  });
              }
              return "";
            },
            record: (event) => shortcutFromKeyboardEvent(event, platform),
          }),
        );
      };
      let activeSurface: "markdown" | "whiteboard" = "markdown";
      const restoreAll = button(
        doc,
        getString("settings-shortcut-restore-all"),
        "shortcut-restore-all",
      );
      restoreAll.addEventListener("click", () => {
        pendingSettings!.markdownCommandShortcuts =
          defaultMarkdownCommandShortcuts(doc.defaultView?.navigator.platform);
        pendingSettings!.markdownInsertShortcuts = {
          ...DEFAULT_MARKDOWN_INSERT_SHORTCUTS,
        };
        pendingSettings!.whiteboardShortcuts = defaultWhiteboardShortcuts(
          doc.defaultView?.navigator.platform,
        );
        pendingSettings!.shortcutNewStandaloneMd =
          DEFAULT_NEW_MARKDOWN_SHORTCUT;
        renderRows(activeSurface);
      });
      header.appendChild(restoreAll);
      bindSegmentedOptions(surfaceButtons, (index) => {
        activeSurface = surfaces[index][0];
        renderRows(activeSurface);
      });
      pageContent.appendChild(list);
      return heading;
    };

    const renderWhiteboard = () => {
      const heading = renderHeading(getString("settings-page-whiteboard"));
      const row = doc.createElement("div");
      row.className = "zotero-markdown-settings-color-row";
      row.appendChild(
        textElement(doc, "span", getString("settings-whiteboard-color-scheme")),
      );
      const controls = doc.createElement("div");
      controls.className = "zotero-markdown-settings-color-controls";
      const select = doc.createElement("select");
      select.name = "whiteboardColorScheme";
      select.setAttribute(
        "aria-label",
        getString("settings-whiteboard-color-scheme"),
      );
      select.className = "zotero-markdown-settings-color-select";
      for (const [value, labelKey] of [
        ["traditional", "settings-whiteboard-color-scheme-traditional"],
        ["classic", "settings-whiteboard-color-scheme-classic"],
      ] as const) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = getString(labelKey);
        select.appendChild(option);
      }
      select.value = normalizeColorScheme(
        pendingSettings?.whiteboardColorScheme,
      );
      const previewWrap = doc.createElement("span");
      previewWrap.className = "zotero-markdown-settings-palette-wrap";
      const previewButton = button(
        doc,
        getString("settings-whiteboard-color-preview"),
        "toggle-whiteboard-preview",
      );
      previewButton.classList.add("is-secondary", "is-icon");
      previewButton.innerHTML = iconPalette();
      previewButton.title = getString("settings-whiteboard-color-preview");
      previewButton.setAttribute("aria-label", previewButton.title);
      previewButton.setAttribute("aria-haspopup", "dialog");
      previewButton.setAttribute("aria-expanded", "false");
      const preview = doc.createElement("div");
      preview.className = "zotero-markdown-settings-palette";
      preview.hidden = true;
      preview.setAttribute("role", "dialog");
      preview.setAttribute("aria-modal", "true");
      preview.setAttribute(
        "aria-label",
        getString("settings-whiteboard-color-scheme"),
      );
      const paletteContent = doc.createElement("div");
      paletteContent.className = "zotero-markdown-settings-palette-content";
      const closePreview = button(doc, "×", "close-palette");
      closePreview.classList.add("is-close");
      closePreview.setAttribute("aria-label", getString("modal-close"));
      const dismissPreview = () => {
        preview.hidden = true;
        previewButton.setAttribute("aria-expanded", "false");
        previewButton.focus();
      };
      closePreview.addEventListener("click", (event) => {
        event.stopPropagation();
        dismissPreview();
      });
      preview.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.target === preview) dismissPreview();
      });
      const sample = doc.createElement("div");
      sample.className = "zotero-markdown-settings-palette-sample";
      const sampleCard = doc.createElement("span");
      sampleCard.className = "zotero-markdown-settings-palette-sample-card";
      const sampleLine = doc.createElement("span");
      sampleLine.className = "zotero-markdown-settings-palette-sample-line";
      sampleCard.appendChild(sampleLine);
      sample.appendChild(sampleCard);
      const renderPalette = () => {
        const scheme = normalizeColorScheme(select.value);
        if (pendingSettings) pendingSettings.whiteboardColorScheme = scheme;
        const colors = colorPalette(true, scheme);
        sampleCard.style.backgroundColor = colors[0] || "#fff";
        sampleCard.style.borderColor = colors[6] || "#888";
        sampleLine.style.backgroundColor = colors[12] || "#888";
        paletteContent.replaceChildren(
          closePreview,
          sample,
          ...colors.map((color) => {
            const swatch = doc.createElement("span");
            swatch.className = "zotero-markdown-settings-palette-swatch";
            swatch.style.backgroundColor = color;
            return swatch;
          }),
        );
      };
      preview.append(paletteContent);
      select.addEventListener("change", renderPalette);
      renderPalette();
      previewButton.addEventListener("click", () => {
        preview.hidden = !preview.hidden;
        previewButton.setAttribute("aria-expanded", String(!preview.hidden));
        if (!preview.hidden) closePreview.focus();
      });
      previewWrap.append(previewButton);
      controls.append(select, previewWrap);
      row.append(controls);
      body.append(preview);
      pageContent.appendChild(row);

      const fontRow = doc.createElement("label");
      fontRow.className = "zotero-markdown-settings-row";
      fontRow.appendChild(
        textElement(doc, "span", getString("settings-font-family")),
      );
      const font = doc.createElement("select");
      font.name = "whiteboardFontFamily";
      font.className = "zotero-markdown-settings-select";
      for (const [value, labelKey] of [
        ["system", "settings-font-system"],
        ["serif", "settings-font-serif"],
        ["mono", "settings-font-mono"],
      ] as const) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = getString(labelKey);
        font.appendChild(option);
      }
      font.value = normalizeFontFamily(pendingSettings?.whiteboardFontFamily);
      font.addEventListener("change", () => {
        if (pendingSettings)
          pendingSettings.whiteboardFontFamily = normalizeFontFamily(
            font.value,
          );
      });
      fontRow.appendChild(font);
      pageContent.appendChild(fontRow);

      const backgroundRow = doc.createElement("label");
      backgroundRow.className = "zotero-markdown-settings-row";
      backgroundRow.appendChild(
        textElement(doc, "span", getString("settings-background")),
      );
      const backgroundControls = doc.createElement("span");
      backgroundControls.className = "zotero-markdown-settings-color-inline";
      const background = doc.createElement("input");
      background.type = "color";
      background.name = "whiteboardBackgroundColor";
      background.value = normalizeColor(
        pendingSettings?.whiteboardBackgroundColor,
        "#fbfbfc",
      );
      background.setAttribute("aria-label", getString("settings-background"));
      const colorValue = textElement(
        doc,
        "span",
        background.value.toUpperCase(),
        "zotero-markdown-settings-color-value",
      );
      background.addEventListener("input", () => {
        colorValue.textContent = background.value.toUpperCase();
        if (pendingSettings)
          pendingSettings.whiteboardBackgroundColor = normalizeColor(
            background.value,
          );
      });
      const reset = button(
        doc,
        getString("settings-reset"),
        "reset-whiteboard-background",
      );
      reset.innerHTML = iconReset();
      reset.classList.add("is-icon");
      reset.title = getString("settings-reset");
      reset.setAttribute("aria-label", reset.title);
      reset.addEventListener("click", () => {
        if (pendingSettings) pendingSettings.whiteboardBackgroundColor = "";
        background.value = "#fbfbfc";
        colorValue.textContent = background.value.toUpperCase();
      });
      backgroundControls.append(background, colorValue, reset);
      backgroundRow.appendChild(backgroundControls);
      pageContent.appendChild(backgroundRow);
      return heading;
    };

    const renderAbout = () => {
      const heading = renderHeading(getString("settings-page-about"));
      const about = options.about || {
        name: "Scholar Sketch",
        version: "—",
        buildTime: "—",
      };
      const details = doc.createElement("dl");
      details.className = "zotero-markdown-settings-about";
      for (const [label, value] of [
        [getString("settings-about-name"), about.name],
        [getString("settings-about-version"), about.version],
        [getString("settings-about-build-time"), about.buildTime],
      ]) {
        details.append(
          textElement(doc, "dt", label),
          textElement(doc, "dd", value),
        );
      }
      pageContent.appendChild(details);

      const updates = doc.createElement("section");
      updates.className = "zotero-markdown-settings-about-section";
      updates.appendChild(
        textElement(doc, "h4", getString("feature-updates-description")),
      );
      const highlights = releaseHighlights(about.version);
      if (highlights?.features.length) {
        const list = doc.createElement("ul");
        list.className = "zotero-markdown-settings-release-highlights";
        for (const feature of highlights.features) {
          const item = doc.createElement("li");
          item.append(
            textElement(doc, "strong", getString(feature.title)),
            textElement(doc, "p", getString(feature.body)),
          );
          list.appendChild(item);
        }
        updates.appendChild(list);
      } else {
        updates.appendChild(
          textElement(
            doc,
            "p",
            getString(
              highlights
                ? "feature-updates-maintenance-description"
                : "settings-about-release-fallback",
            ),
          ),
        );
      }
      updates.appendChild(
        button(
          doc,
          getString("feature-updates-release-notes"),
          "release-notes",
        ),
      );

      const support = doc.createElement("section");
      support.className = "zotero-markdown-settings-about-section";
      const actions = doc.createElement("div");
      actions.className = "zotero-markdown-settings-about-actions";
      actions.append(
        button(doc, getString("settings-user-guide"), "about-user-guide"),
        button(doc, getString("settings-about-github"), "project-repository"),
        button(doc, getString("settings-garden-question"), "garden-question"),
      );
      support.append(
        textElement(doc, "h4", getString("settings-about-support")),
        textElement(doc, "p", getString("settings-about-star")),
        actions,
      );
      pageContent.append(updates, support);
      return heading;
    };

    const selectPage = (page: SettingsPageID, focusHeading = false) => {
      activePage = page;
      for (const item of navigation.querySelectorAll<HTMLButtonElement>(
        "[data-settings-page]",
      )) {
        const selected = item.dataset.settingsPage === page;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
      }
      body.querySelector(".zotero-markdown-settings-palette")?.remove();
      closeChildDialogs();
      pageContent.replaceChildren();
      const heading =
        page === "general"
          ? renderGeneral()
          : page === "editor"
            ? renderEditor()
            : page === "whiteboard"
              ? renderWhiteboard()
              : page === "shortcuts"
                ? renderShortcuts()
                : renderAbout();
      if (focusHeading) heading.focus();
    };

    for (const page of SETTINGS_PAGES) {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "zotero-markdown-settings-nav-item";
      item.dataset.settingsPage = page.id;
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", "false");
      const icon = doc.createElement("span");
      icon.className = "zotero-markdown-settings-nav-icon";
      icon.innerHTML = iconForPage(page.id);
      item.append(icon, textElement(doc, "span", settingsPageLabel(page.id)));
      item.addEventListener("click", () => selectPage(page.id, true));
      item.addEventListener("keydown", (event) => {
        const direction =
          event.key === "ArrowDown" || event.key === "ArrowRight"
            ? 1
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
              ? -1
              : 0;
        if (!direction) return;
        event.preventDefault();
        const next = nextSettingsPage(activePage, direction);
        selectPage(next);
        navigation
          .querySelector<HTMLButtonElement>(`[data-settings-page="${next}"]`)
          ?.focus();
      });
      navigation.appendChild(item);
    }

    selectSettingsPage = selectPage;
    body.appendChild(workspace);
    const initialPage = SETTINGS_PAGES.some(
      ({ id }) => id === initialSettingsPage,
    )
      ? initialSettingsPage!
      : "general";
    selectPage(initialPage);
  };

  const showActionError = (error: unknown) => {
    const element = body.querySelector<HTMLElement>("[data-modal-error]");
    if (!element) return;
    element.textContent =
      error instanceof Error ? error.message : String(error);
    element.hidden = false;
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const preview = body.querySelector<HTMLElement>(
      ".zotero-markdown-settings-palette",
    );
    const previewButton = body.querySelector<HTMLButtonElement>(
      '[data-modal-action="toggle-whiteboard-preview"]',
    );
    if (
      preview &&
      !preview.hidden &&
      !target?.closest?.(".zotero-markdown-settings-palette-wrap")
    ) {
      preview.hidden = true;
      previewButton?.setAttribute("aria-expanded", "false");
      if (target === backdrop) return;
    }
    if (target === backdrop) {
      if (activeKind !== "settings") closeModal();
      return;
    }
    const action = target
      ?.closest?.("[data-modal-action]")
      ?.getAttribute("data-modal-action");
    if (!action) return;
    if (action === "close") return closeModal();
    if (activeKind === "settings") {
      if (action === "release-notes") return openReleaseNotes();
      if (action === "about-user-guide") return void openUserGuide();
      if (action === "project-repository") return openProjectRepository();
      if (action === "garden-question") {
        if (!hasGarden()) return promptGardenDownload(doc.defaultView!);
        if (JSON.stringify(pendingSettings) !== settingsAtOpen)
          return showActionError(getString("settings-garden-unsaved"));
        try {
          openGardenQuestion();
        } catch (error) {
          return showActionError(error);
        }
        closeModal();
        Zotero.getMainWindow()?.focus();
        return;
      }
    }
    if (action === "reveal") {
      return void Promise.resolve(callbacks.onReveal?.()).catch(
        showActionError,
      );
    }
    if (action === "rename") {
      const input = body.querySelector<HTMLInputElement>(
        'input[name="filename"]',
      );
      const filename = normalizeMarkdownFilename(input?.value || "");
      return void Promise.resolve(callbacks.onRename?.(filename))
        .then(closeModal)
        .catch(showActionError);
    }
    if (action === "reset-whiteboard-background") {
      if (pendingSettings) pendingSettings.whiteboardBackgroundColor = "";
      const input = body.querySelector<HTMLInputElement>(
        'input[name="whiteboardBackgroundColor"]',
      );
      if (input) input.value = "#fbfbfc";
      return;
    }
    if (action === "save-settings") {
      if (savingSettings) return;
      const platform = doc.defaultView?.navigator.platform;
      const showShortcutError = (
        id: string,
        message: string,
        whiteboard = false,
      ) => {
        selectSettingsPage!("shortcuts", true);
        if (whiteboard)
          body
            .querySelector<HTMLButtonElement>(
              '[data-shortcut-surface="whiteboard"]',
            )!
            .click();
        const row = body.querySelector<HTMLElement>(
          `[data-shortcut-id="${id}"]`,
        )!;
        const error = row.querySelector<HTMLElement>("[data-shortcut-error]")!;
        error.textContent = message;
        error.hidden = false;
        const control = row.querySelector<HTMLButtonElement>(
          ".zotero-markdown-modal-shortcut-control",
        )!;
        control.setAttribute("aria-invalid", "true");
        control.focus();
      };
      const markdownBindings = {
        ...pendingSettings!.markdownCommandShortcuts,
        ...pendingSettings!.markdownInsertShortcuts,
        "new-note": pendingSettings!.shortcutNewStandaloneMd,
      };
      for (const command of [
        ...MARKDOWN_COMMAND_ACTIONS,
        ...MARKDOWN_INSERT_COMMANDS,
        "new-note",
      ] as const) {
        const problem = validateMarkdownShortcutAssignment(
          command,
          markdownBindings[command],
          pendingSettings!.markdownCommandShortcuts,
          pendingSettings!.markdownInsertShortcuts,
          pendingSettings!.shortcutNewStandaloneMd,
          platform,
        );
        if (problem)
          return showShortcutError(command, shortcutProblemText(problem));
      }
      for (const action of WHITEBOARD_SHORTCUT_ACTIONS) {
        const problem = validateWhiteboardShortcut(
          action,
          pendingSettings!.whiteboardShortcuts[action],
          pendingSettings!.whiteboardShortcuts,
          pendingSettings!.shortcutNewStandaloneMd,
          platform,
        );
        if (problem)
          return showShortcutError(
            `wb-${action}`,
            shortcutProblemText(
              problem,
              {
                ...WHITEBOARD_SHORTCUT_SETTING_LABELS,
                "new-note": "settings-shortcut-new-standalone",
              },
              "settings-shortcut-invalid-whiteboard",
            ),
            true,
          );
      }
      const invalid = pendingSettings!.markdownStyles.presets.find(
        (preset) => !compileMarkdownStyleCss(preset.css).ok,
      );
      if (invalid) {
        pendingSettings!.markdownStyles.selectedId = invalid.id;
        selectSettingsPage!("editor", true);
        body
          .querySelector<HTMLTextAreaElement>(
            'textarea[name="markdownStyleCss"]',
          )!
          .focus();
        return;
      }
      const settings = prefsFromSettings(
        pendingSettings || settingsFromPrefs(),
      );
      savingSettings = true;
      const saveButton = body.querySelector<HTMLButtonElement>(
        '[data-modal-action="save-settings"]',
      );
      if (saveButton) saveButton.disabled = true;
      return void Promise.resolve()
        .then(() => callbacks.onSettings?.(settings))
        .then(() => {
          savingSettings = false;
          closeModal();
        })
        .catch(showActionError)
        .finally(() => {
          savingSettings = false;
          if (saveButton) saveButton.disabled = false;
        });
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.defaultPrevented || backdrop.hidden) return;
    if (event.key === "Tab") {
      const focusScope =
        body.querySelector<HTMLElement>(
          ".zotero-markdown-settings-palette:not([hidden])",
        ) || dialog;
      const controls = [
        ...focusScope.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter(
        (element) =>
          !element.closest("[hidden], dialog:not([open])") &&
          element.tabIndex >= 0,
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) return;
      if (
        event.shiftKey &&
        (doc.activeElement === first || doc.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (doc.activeElement === last || doc.activeElement === dialog)
      ) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key !== "Escape") return;
    const preview = body.querySelector<HTMLElement>(
      ".zotero-markdown-settings-palette",
    );
    if (preview && !preview.hidden) {
      preview.hidden = true;
      body
        .querySelector<HTMLButtonElement>(
          '[data-modal-action="toggle-whiteboard-preview"]',
        )
        ?.setAttribute("aria-expanded", "false");
      body
        .querySelector<HTMLButtonElement>(
          '[data-modal-action="toggle-whiteboard-preview"]',
        )
        ?.focus();
      event.preventDefault();
      return;
    }
    const tooltip = body.querySelector<HTMLElement>(
      '[role="tooltip"]:not([hidden])',
    );
    if (tooltip) {
      tooltip.hidden = true;
      event.preventDefault();
      return;
    }
    closeModal();
  };
  backdrop.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKeyDown);

  return {
    open(kind, payload, initialSettingsPage) {
      activeKind = kind;
      dialog.classList.toggle("is-settings", kind === "settings");
      body.classList.toggle(
        "zotero-markdown-modal-body-settings",
        kind === "settings",
      );
      restoreFocus = doc.activeElement as HTMLElement | null;
      title.textContent = modalTitle(kind);
      closeChildDialogs();
      body.replaceChildren();
      if (kind === "document-info")
        renderDocumentInfo(payload as DocumentModalData);
      else if (kind === "rename") renderRename(payload as DocumentModalData);
      else
        renderSettings(
          payload as Partial<SettingsModalData>,
          initialSettingsPage,
        );
      backdrop.hidden = false;
      backdrop.setAttribute("aria-hidden", "false");
      if (kind !== "rename") dialog.focus();
    },
    close: closeModal,
    destroy() {
      closeModal();
      backdrop.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      activeKind = null;
    },
  };
}

export function applySettings(settings: SettingsModalData, platform?: string) {
  const values = prefsFromSettings(settings);
  writeMarkdownInsertShortcuts(values.markdownInsertShortcuts);
  writeMarkdownCommandShortcuts(values.markdownCommandShortcuts, platform);
  writeWhiteboardShortcuts(values.whiteboardShortcuts, platform);
  setPref("enable", values.enable);
  setPref("frontmatter", values.frontmatter);
  writeMarkdownStyleSettings(values.markdownStyles);
  setPref("theme", values.theme);
  setPref("markdownToolbarMode", values.markdownToolbarMode);
  setPref("markdownSlashSearchLanguage", values.markdownSlashSearchLanguage);
  setPref(
    "markdown.linkPreview.pdfEnabled",
    values.markdownPdfLinkPreviewEnabled,
  );
  setPref("shortcutNewStandaloneMd", values.shortcutNewStandaloneMd);
  setPref("whiteboardColorScheme", values.whiteboardColorScheme);
  setPref("whiteboardFontFamily", values.whiteboardFontFamily);
  setPref("whiteboardBackgroundColor", values.whiteboardBackgroundColor);
}
