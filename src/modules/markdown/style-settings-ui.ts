import { getString } from "../../utils/locale";
import type { FluentMessageId } from "../../../typings/i10n";
import {
  BUILTIN_CSS_PRESETS,
  getSelectedStyleCss,
  type MarkdownStyleSettings,
} from "./style-settings";
import { DEFAULT_MARKDOWN_STYLE } from "./style-presets";
import { compileMarkdownStyleCss } from "./style-css";
import { markdownStylePrompt } from "./style-prompt";
import { applyPreviewStyle, renderMarkdown } from "./preview";

const builtinLabels: Record<string, FluentMessageId> = {
  default: "settings-style-default",
  paper: "settings-style-paper",
  compact: "settings-style-compact",
};

const issueLabels = {
  syntax: "settings-style-css-syntax",
  selector: "settings-style-css-selector",
  property: "settings-style-css-property",
  value: "settings-style-css-value",
  variable: "settings-style-css-variable",
  "at-rule": "settings-style-css-at-rule",
  limit: "settings-style-css-limit",
} as const;

/** Owns only the dialog's CSS draft. Done validates every preset before saving. */
export function createMarkdownStyleSettingsUI(
  doc: Document,
  settings: MarkdownStyleSettings,
  theme: "light" | "dark",
): HTMLElement {
  const root = doc.createElement("section");
  root.className = "zmd-style-settings";
  const id = `zmd-style-css-${doc.querySelectorAll(".zmd-style-settings").length}`;
  let palette = theme;
  let previewStyle = DEFAULT_MARKDOWN_STYLE;
  const nameOf = (id: string) => {
    const builtin = builtinLabels[id];
    return builtin
      ? getString(builtin)
      : settings.presets.find((preset) => preset.id === id)!.name;
  };
  const selectedCustom = () =>
    settings.presets.find((preset) => preset.id === settings.selectedId);
  const action = (label: FluentMessageId, name: string) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "zotero-markdown-modal-button";
    button.dataset.styleAction = name;
    button.textContent = getString(label);
    return button;
  };
  const title = doc.createElement("h4");
  title.textContent = getString("settings-style-title");
  const picker = doc.createElement("select");
  picker.name = "markdownStylePreset";
  picker.className = "zotero-markdown-settings-select";
  picker.setAttribute("aria-label", getString("settings-style-title"));
  const toolbar = doc.createElement("div");
  toolbar.className = "zmd-style-toolbar";
  const copy = action("settings-style-save-as", "copy");
  const rename = action("settings-style-rename", "rename");
  const remove = action("settings-style-delete", "delete");
  toolbar.append(picker, copy, rename, remove);

  const naming = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "dialog",
  ) as HTMLDialogElement;
  naming.className = "zmd-style-name-dialog";
  const namingTitle = doc.createElement("h3");
  namingTitle.id = `${id}-name-title`;
  naming.setAttribute("aria-labelledby", namingTitle.id);
  const nameLabel = doc.createElement("label");
  nameLabel.textContent = getString("settings-style-name");
  const nameInput = doc.createElement("input");
  nameInput.id = `${id}-name`;
  nameInput.name = "markdownStyleName";
  nameInput.className = "zotero-markdown-modal-input";
  nameInput.maxLength = 80;
  nameLabel.htmlFor = nameInput.id;
  const confirm = action("settings-style-confirm", "confirm-name");
  confirm.classList.add("is-primary");
  const cancel = action("settings-style-cancel", "cancel-name");
  const namingError = doc.createElement("p");
  namingError.id = `${id}-name-error`;
  namingError.className = "zotero-markdown-modal-error";
  namingError.setAttribute("role", "alert");
  namingError.hidden = true;
  nameInput.setAttribute("aria-describedby", namingError.id);
  const namingFooter = doc.createElement("footer");
  namingFooter.append(cancel, confirm);
  naming.append(namingTitle, nameLabel, nameInput, namingError, namingFooter);
  let namingMode: "copy" | "rename" = "copy";

  const locked = doc.createElement("p");
  locked.className = "zmd-style-locked";
  locked.textContent = getString("settings-style-builtin-hint");
  const tools = doc.createElement("div");
  tools.className = "zmd-style-css-tools";
  const cssLabel = doc.createElement("label");
  cssLabel.textContent = "CSS";
  cssLabel.htmlFor = id;
  const copyPrompt = action("settings-style-copy-prompt", "copy-prompt");
  const reset = action("settings-style-reset-css", "reset-css");
  tools.append(cssLabel, copyPrompt, reset);
  const css = doc.createElement("textarea");
  css.id = id;
  css.name = "markdownStyleCss";
  css.className = "zmd-style-css";
  css.spellcheck = false;
  css.setAttribute("autocapitalize", "off");
  css.setAttribute("autocomplete", "off");
  css.wrap = "off";
  const diagnostics = doc.createElement("div");
  diagnostics.id = `${id}-diagnostics`;
  diagnostics.className = "zmd-style-css-diagnostics";
  diagnostics.setAttribute("role", "status");
  diagnostics.hidden = true;
  css.setAttribute("aria-describedby", diagnostics.id);
  const copyStatus = doc.createElement("p");
  copyStatus.className = "zmd-style-copy-status";
  copyStatus.setAttribute("role", "status");
  copyStatus.hidden = true;

  const previewHeader = doc.createElement("div");
  previewHeader.className = "zmd-style-preview-header";
  const previewLabel = doc.createElement("span");
  previewLabel.textContent = getString("settings-style-preview");
  const modes = doc.createElement("div");
  modes.className = "zmd-style-segments zmd-style-palettes";
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", getString("settings-theme"));
  previewHeader.append(previewLabel, modes);
  const preview = doc.createElement("div");
  preview.className = "zmd-style-preview";
  preview.tabIndex = 0;
  preview.setAttribute("role", "region");
  preview.setAttribute("aria-label", getString("settings-style-preview"));
  const previewPage = doc.createElement("div");
  previewPage.className = "zotero-markdown-preview-page";
  const article = doc.createElement("article");
  article.className = "zotero-markdown-preview-inner";
  article.innerHTML = renderMarkdown(getString("settings-style-sample"));
  for (const link of article.querySelectorAll("a")) link.tabIndex = -1;
  previewPage.append(article);
  preview.append(previewPage);
  root.append(
    title,
    toolbar,
    naming,
    locked,
    tools,
    css,
    diagnostics,
    copyStatus,
    previewHeader,
    preview,
  );

  const updatePreview = () => applyPreviewStyle(preview, previewStyle, palette);
  const compileDraft = () => {
    const result = compileMarkdownStyleCss(css.value);
    diagnostics.replaceChildren();
    diagnostics.hidden = result.ok;
    css.setAttribute("aria-invalid", String(!result.ok));
    if (result.ok) {
      previewStyle = result.style;
    } else {
      const hint = doc.createElement("p");
      hint.textContent = getString("settings-style-css-preview-unchanged");
      const list = doc.createElement("ul");
      for (const issue of result.issues) {
        const item = doc.createElement("li");
        const message = getString(issueLabels[issue.code]);
        item.textContent =
          getString("settings-style-css-diagnostic", {
            args: { line: issue.line, message },
          }) + (issue.detail ? ` · ${issue.detail}` : "");
        list.append(item);
      }
      diagnostics.append(hint, list);
    }
    updatePreview();
  };
  for (const mode of ["light", "dark"] as const) {
    const toggle = action(
      mode === "light" ? "settings-theme-light" : "settings-theme-dark",
      `palette-${mode}`,
    );
    toggle.setAttribute("aria-pressed", String(palette === mode));
    toggle.addEventListener("click", () => {
      palette = mode;
      for (const button of modes.querySelectorAll("button"))
        button.setAttribute("aria-pressed", String(button === toggle));
      updatePreview();
    });
    modes.append(toggle);
  }
  css.addEventListener("input", () => {
    const preset = selectedCustom();
    if (!preset) return;
    preset.css = css.value;
    compileDraft();
  });
  copyPrompt.addEventListener("click", () => {
    try {
      new ztoolkit.Clipboard()
        .addText(markdownStylePrompt(css.value), "text/unicode")
        .copy();
      copyStatus.textContent = getString("settings-style-prompt-copied");
    } catch {
      copyStatus.textContent = getString("settings-style-prompt-copy-failed");
    }
    copyStatus.hidden = false;
  });
  reset.addEventListener("click", () => {
    const preset = selectedCustom()!;
    preset.css = BUILTIN_CSS_PRESETS.find(
      (value) => value.id === "default",
    )!.css;
    css.value = preset.css;
    compileDraft();
  });
  const refresh = () => {
    picker.replaceChildren();
    for (const preset of [...BUILTIN_CSS_PRESETS, ...settings.presets]) {
      const option = doc.createElement("option");
      option.value = preset.id;
      option.textContent = nameOf(preset.id);
      picker.append(option);
    }
    picker.value = settings.selectedId;
    const custom = !!selectedCustom();
    rename.disabled = remove.disabled = reset.disabled = !custom;
    locked.hidden = custom;
    css.readOnly = !custom;
    css.value = getSelectedStyleCss(settings);
    copyStatus.hidden = true;
    previewStyle = DEFAULT_MARKDOWN_STYLE;
    compileDraft();
  };
  const closeNaming = () => {
    if (!naming.open) return;
    naming.close();
    namingError.hidden = true;
    nameInput.setCustomValidity("");
    (namingMode === "copy" ? copy : rename).focus();
  };
  const startNaming = (mode: "copy" | "rename") => {
    namingMode = mode;
    namingTitle.textContent = getString(
      mode === "copy"
        ? "settings-style-save-as-title"
        : "settings-style-rename-title",
    );
    namingError.hidden = true;
    nameInput.setCustomValidity("");
    nameInput.value =
      mode === "copy"
        ? getString("settings-style-copy-name", {
            args: { name: nameOf(settings.selectedId) },
          })
        : nameOf(settings.selectedId);
    naming.showModal();
    nameInput.focus();
    nameInput.select();
  };
  copy.addEventListener("click", () => startNaming("copy"));
  rename.addEventListener("click", () => startNaming("rename"));
  cancel.addEventListener("click", closeNaming);
  naming.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeNaming();
  });
  confirm.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const duplicate = settings.presets.some(
      (preset) =>
        preset.name === name &&
        (namingMode === "copy" || preset.id !== settings.selectedId),
    );
    if (!name || duplicate) {
      namingError.textContent = getString(
        duplicate
          ? "settings-style-name-duplicate"
          : "settings-style-name-required",
      );
      namingError.hidden = false;
      nameInput.setCustomValidity(namingError.textContent);
      nameInput.focus();
      return;
    }
    if (namingMode === "copy") {
      const id = `custom-${doc.defaultView!.crypto.randomUUID()}`;
      settings.presets.push({ id, name, css: getSelectedStyleCss(settings) });
      settings.selectedId = id;
    } else selectedCustom()!.name = name;
    refresh();
    closeNaming();
  });
  nameInput.addEventListener("input", () => {
    nameInput.setCustomValidity("");
    namingError.hidden = true;
  });
  naming.addEventListener("keydown", (event) => {
    // Keep keyboard actions in the naming dialog, including its Tab boundaries.
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Tab") {
      if (event.shiftKey && doc.activeElement === nameInput) {
        event.preventDefault();
        confirm.focus();
      } else if (!event.shiftKey && doc.activeElement === confirm) {
        event.preventDefault();
        nameInput.focus();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeNaming();
    } else if (event.key === "Enter" && event.target === nameInput) {
      event.preventDefault();
      confirm.click();
    }
  });
  remove.addEventListener("click", () => {
    settings.presets.splice(
      settings.presets.findIndex((preset) => preset.id === settings.selectedId),
      1,
    );
    settings.selectedId = "default";
    closeNaming();
    refresh();
    picker.focus();
  });
  picker.addEventListener("change", () => {
    settings.selectedId = picker.value;
    closeNaming();
    refresh();
  });
  refresh();
  return root;
}
