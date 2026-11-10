import { getString } from "../../utils/locale";
import type { FluentMessageId } from "../../../typings/i10n";
import {
  BUILTIN_STYLE_PRESETS,
  cloneMarkdownStyle,
  resolveSelectedStyle,
  type MarkdownHeadingStyle,
  type MarkdownStyleColors,
  type MarkdownStyleSettings,
} from "./style-presets";
import { applyPreviewStyle, renderMarkdown } from "./preview";

const builtinLabels: Record<string, FluentMessageId> = {
  default: "settings-style-default",
  paper: "settings-style-paper",
  compact: "settings-style-compact",
};

/** Owns only the settings dialog's draft. Persistence belongs to its Done action. */
export function createMarkdownStyleSettingsUI(
  doc: Document,
  settings: MarkdownStyleSettings,
  theme: "light" | "dark",
): HTMLElement {
  const root = doc.createElement("section");
  root.className = "zmd-style-settings";
  let category: "body" | "heading" | "colors" = "body";
  let palette = theme;
  let headingIndex = 0;
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
  const row = (label: string, control: HTMLElement) => {
    const element = doc.createElement("label");
    element.className = "zmd-style-field";
    const text = doc.createElement("span");
    text.textContent = label;
    element.append(text, control);
    return element;
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

  const naming = doc.createElement("div");
  naming.className = "zmd-style-naming";
  naming.hidden = true;
  const nameInput = doc.createElement("input");
  nameInput.name = "markdownStyleName";
  nameInput.className = "zotero-markdown-modal-input";
  nameInput.maxLength = 80;
  nameInput.setAttribute("aria-label", getString("settings-style-name"));
  const confirm = action("settings-style-confirm", "confirm-name");
  const cancel = action("settings-style-cancel", "cancel-name");
  const error = doc.createElement("p");
  error.className = "zotero-markdown-modal-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  naming.append(nameInput, confirm, cancel);
  let namingMode: "copy" | "rename" = "copy";

  const locked = doc.createElement("p");
  locked.className = "zmd-style-locked";
  locked.textContent = getString("settings-style-builtin-hint");
  const layout = doc.createElement("div");
  layout.className = "zmd-style-layout";
  const controls = doc.createElement("div");
  controls.className = "zmd-style-controls";
  const categories = doc.createElement("div");
  categories.className = "zmd-style-segments";
  categories.setAttribute("role", "tablist");
  categories.setAttribute("aria-label", getString("settings-style-title"));
  const fields = doc.createElement("fieldset");
  fields.className = "zmd-style-fields";
  fields.id = `zmd-style-fields-${doc.querySelectorAll(".zmd-style-settings").length}`;
  fields.setAttribute("role", "tabpanel");
  controls.append(categories, fields);

  const preview = doc.createElement("div");
  preview.className = "zmd-style-preview";
  preview.setAttribute("aria-label", getString("settings-style-preview"));
  const previewPage = doc.createElement("div");
  previewPage.className = "zotero-markdown-preview-page";
  const article = doc.createElement("article");
  article.className = "zotero-markdown-preview-inner";
  article.innerHTML = renderMarkdown(getString("settings-style-sample"));
  for (const link of article.querySelectorAll("a")) link.tabIndex = -1;
  previewPage.append(article);
  preview.append(previewPage);
  layout.append(controls, preview);
  root.append(title, toolbar, naming, error, locked, layout);

  const updatePreview = () =>
    applyPreviewStyle(preview, resolveSelectedStyle(settings), palette);
  const numeric = (
    key: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
  ) => {
    const input = doc.createElement("input");
    input.type = "number";
    input.name = key;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = "zotero-markdown-modal-input is-small";
    let lastValue = value;
    input.addEventListener("change", () => {
      if (!selectedCustom()) return;
      const number = input.valueAsNumber;
      const next = Number.isFinite(number)
        ? Math.max(min, Math.min(max, number))
        : lastValue;
      lastValue = next;
      input.value = String(next);
      onChange(next);
      updatePreview();
    });
    return input;
  };
  const select = (
    name: string,
    options: Array<[string, string]>,
    value: string,
  ) => {
    const control = doc.createElement("select");
    control.name = name;
    control.className = "zotero-markdown-settings-select";
    for (const [id, label] of options) {
      const option = doc.createElement("option");
      option.value = id;
      option.textContent = label;
      control.append(option);
    }
    control.value = value;
    return control;
  };
  const renderFields = () => {
    fields.replaceChildren();
    const style = resolveSelectedStyle(settings);
    // Keep navigation available on built-ins, disabling only editable controls.
    locked.hidden = !!selectedCustom();
    const editableFields = doc.createElement("fieldset");
    editableFields.className = "zmd-style-editable-fields";
    editableFields.disabled = !selectedCustom();
    if (category === "body") {
      const font = select(
        "styleFontFamily",
        [
          ["system", getString("settings-font-system")],
          ["serif", getString("settings-font-serif")],
          ["mono", getString("settings-font-mono")],
        ],
        style.fontFamily,
      );
      font.addEventListener("change", () => {
        if (!selectedCustom()) return;
        style.fontFamily = font.value as typeof style.fontFamily;
        updatePreview();
      });
      editableFields.append(row(getString("settings-font-family"), font));
      for (const [key, label, min, max, step] of [
        ["fontSize", "settings-style-font-size", 11, 32, 1],
        ["lineHeight", "settings-style-line-height", 1.2, 2.4, 0.05],
        ["paragraphSpacing", "settings-style-paragraph-spacing", 0, 2, 0.05],
        ["contentWidth", "settings-style-content-width", 360, 1200, 20],
      ] as const) {
        editableFields.append(
          row(
            getString(label),
            numeric(key, style[key], min, max, step, (value) => {
              style[key] = value;
            }),
          ),
        );
      }
    } else if (category === "heading") {
      const level = select(
        "styleHeadingLevel",
        Array.from({ length: 6 }, (_, index) => [
          String(index),
          `H${index + 1}`,
        ]),
        String(headingIndex),
      );
      level.addEventListener("change", () => {
        headingIndex = Number(level.value);
        renderFields();
        fields
          .querySelector<HTMLSelectElement>('[name="styleHeadingLevel"]')
          ?.focus();
      });
      fields.append(row(getString("settings-style-heading-level"), level));
      const heading = style.headings[headingIndex];
      for (const [key, label, min, max, step] of [
        ["size", "settings-style-heading-size", 0.8, 3, 0.05],
        ["weight", "settings-style-heading-weight", 400, 800, 50],
        ["before", "settings-style-heading-before", 0, 3, 0.05],
        ["after", "settings-style-heading-after", 0, 2, 0.05],
      ] as const) {
        editableFields.append(
          row(
            getString(label),
            numeric(`heading-${key}`, heading[key], min, max, step, (value) => {
              heading[key as keyof MarkdownHeadingStyle] = value;
            }),
          ),
        );
      }
    } else {
      const modes = doc.createElement("div");
      modes.className = "zmd-style-segments zmd-style-palettes";
      modes.setAttribute("role", "group");
      modes.setAttribute("aria-label", getString("settings-style-colors"));
      for (const mode of ["light", "dark"] as const) {
        const toggle = action(
          mode === "light" ? "settings-theme-light" : "settings-theme-dark",
          `palette-${mode}`,
        );
        toggle.setAttribute("aria-pressed", String(palette === mode));
        toggle.addEventListener("click", () => {
          palette = mode;
          renderFields();
          updatePreview();
          fields
            .querySelector<HTMLButtonElement>(
              `[data-style-action="palette-${mode}"]`,
            )
            ?.focus();
        });
        modes.append(toggle);
      }
      fields.append(modes);
      editableFields.classList.add("zmd-style-colors");
      const colors = style[palette];
      for (const [key, label] of [
        ["background", "settings-background"],
        ["text", "settings-style-color-text"],
        ["heading", "settings-style-color-heading"],
        ["link", "settings-style-color-link"],
        ["accent", "settings-style-color-accent"],
        ["quoteBackground", "settings-style-color-quote-background"],
        ["quoteBorder", "settings-style-color-quote-border"],
        ["codeBackground", "settings-style-color-code-background"],
        ["codeBorder", "settings-style-color-code-border"],
        ["tableHeader", "settings-style-color-table-header"],
        ["tableBorder", "settings-style-color-table-border"],
      ] as const) {
        const color = doc.createElement("input");
        color.type = "color";
        color.name = `styleColor-${key}`;
        color.value = colors[key];
        color.title = colors[key].toUpperCase();
        color.addEventListener("input", () => {
          if (!selectedCustom()) return;
          colors[key as keyof MarkdownStyleColors] = color.value;
          color.title = color.value.toUpperCase();
          updatePreview();
        });
        editableFields.append(row(getString(label), color));
      }
    }
    fields.append(editableFields);
  };
  const tabs = (
    [
      ["body", "settings-style-body"],
      ["heading", "settings-style-headings"],
      ["colors", "settings-style-colors"],
    ] as const
  ).map(([id, label]) => {
    const tab = action(label, `category-${id}`);
    tab.id = `${fields.id}-${id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", fields.id);
    const activate = () => {
      category = id;
      for (const entry of tabs) {
        entry.setAttribute("aria-selected", String(entry === tab));
        entry.tabIndex = entry === tab ? 0 : -1;
      }
      fields.setAttribute("aria-labelledby", tab.id);
      renderFields();
    };
    tab.addEventListener("click", activate);
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      const next =
        event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : -1;
      if (next < 0) return;
      event.preventDefault();
      event.stopPropagation();
      tabs[next].click();
      tabs[next].focus();
    });
    categories.append(tab);
    return tab;
  });
  const refresh = () => {
    picker.replaceChildren();
    for (const preset of [...BUILTIN_STYLE_PRESETS, ...settings.presets]) {
      const option = doc.createElement("option");
      option.value = preset.id;
      option.textContent = nameOf(preset.id);
      picker.append(option);
    }
    picker.value = settings.selectedId;
    rename.disabled = remove.disabled = !selectedCustom();
    renderFields();
    updatePreview();
  };
  const closeNaming = () => {
    naming.hidden = true;
    error.hidden = true;
    nameInput.setCustomValidity("");
  };
  const startNaming = (mode: "copy" | "rename") => {
    namingMode = mode;
    naming.hidden = false;
    error.hidden = true;
    nameInput.value =
      mode === "copy"
        ? getString("settings-style-copy-name", {
            args: { name: nameOf(settings.selectedId) },
          })
        : nameOf(settings.selectedId);
    nameInput.focus();
    nameInput.select();
  };
  copy.addEventListener("click", () => startNaming("copy"));
  rename.addEventListener("click", () => startNaming("rename"));
  cancel.addEventListener("click", () => {
    closeNaming();
    picker.focus();
  });
  confirm.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const duplicate = settings.presets.some(
      (preset) =>
        preset.name === name &&
        (namingMode === "copy" || preset.id !== settings.selectedId),
    );
    if (!name || duplicate) {
      error.textContent = getString(
        duplicate
          ? "settings-style-name-duplicate"
          : "settings-style-name-required",
      );
      error.hidden = false;
      nameInput.setCustomValidity(error.textContent);
      nameInput.focus();
      return;
    }
    if (namingMode === "copy") {
      const id = `custom-${doc.defaultView!.crypto.randomUUID()}`;
      settings.presets.push({
        id,
        name,
        style: cloneMarkdownStyle(resolveSelectedStyle(settings)),
      });
      settings.selectedId = id;
    } else selectedCustom()!.name = name;
    closeNaming();
    refresh();
    picker.focus();
  });
  nameInput.addEventListener("input", () => {
    nameInput.setCustomValidity("");
    error.hidden = true;
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter") confirm.click();
    else {
      closeNaming();
      picker.focus();
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
  tabs[0].click();
  refresh();
  return root;
}
