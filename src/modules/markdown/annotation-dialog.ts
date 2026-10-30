import { getString } from "../../utils/locale";
import type { MarkdownAnnotation } from "./annotations";
import { annotationDialogCSS } from "./annotation-dialog-style";

const typeLabels = {
  highlight: "whiteboard-annotation-type-highlight",
  underline: "whiteboard-annotation-type-underline",
  note: "whiteboard-annotation-type-note",
  text: "whiteboard-annotation-type-text",
  image: "whiteboard-annotation-type-image",
  ink: "whiteboard-annotation-type-ink",
} as const;
const typeLabel = (type = "") =>
  type in typeLabels
    ? getString(typeLabels[type as keyof typeof typeLabels])
    : getString("whiteboard-annotation-browser-title");

export function showAnnotationExportDialog(
  win: Window,
  annotations: readonly MarkdownAnnotation[],
  create: (
    chosen: MarkdownAnnotation[],
    shouldContinue: () => boolean,
  ) => Promise<boolean>,
) {
  const doc = win.document;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "") => {
    const node = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];
    node.className = cls;
    return node;
  };
  const button = (label: string, cls = "") => {
    const node = element("button", cls);
    node.type = "button";
    node.textContent = label;
    return node;
  };
  const dialog = element("dialog", "ss-annotation-dialog");
  dialog.setAttribute("aria-label", getString("menuitem-annotations-md"));
  const style = element("style");
  style.textContent = annotationDialogCSS;
  const header = element("header");
  const heading = element("h2");
  heading.textContent = getString("menuitem-annotations-md");
  const close = button("×", "ss-annotation-close");
  close.setAttribute("aria-label", getString("file-history-close"));
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  const hint = element("p", "ss-annotation-hint");
  hint.textContent = getString("annotation-export-hint");
  const filters = element("div", "ss-annotation-filters");
  const search = element("input", "ss-annotation-search");
  search.type = "search";
  search.placeholder = getString("annotation-export-search");
  search.setAttribute("aria-label", search.placeholder);
  const types = element("div", "ss-annotation-types");
  types.setAttribute("role", "group");
  types.setAttribute(
    "aria-label",
    getString("whiteboard-annotation-type-filter"),
  );
  let type = "";
  let tag = "";
  const colors = new Set<string>();
  const normalizeColor = (annotation: MarkdownAnnotation) =>
    annotation.color?.trim().toLowerCase() || "";
  const selected = new Set(annotations.map((_, index) => index));
  let visible: number[] = [];
  let busy = false;
  const typeButtons = new Map<string, HTMLButtonElement>();
  for (const value of [
    "",
    ...Object.keys(typeLabels).filter((key) =>
      annotations.some((annotation) => annotation.type === key),
    ),
  ]) {
    const control = button(
      value ? typeLabel(value) : getString("whiteboard-annotation-all-types"),
    );
    control.dataset.type = value;
    control.addEventListener("click", () => {
      type = value;
      render();
    });
    typeButtons.set(value, control);
    types.append(control);
  }
  const tools = element("div", "ss-annotation-tools");
  const tags = [
    ...new Set(annotations.flatMap((annotation) => annotation.tags || [])),
  ].sort((a, b) => a.localeCompare(b));
  if (tags.length) {
    const label = element("label", "ss-annotation-tag-filter");
    const caption = element("span");
    caption.textContent = getString("whiteboard-annotation-tag-filter");
    const select = element("select");
    for (const value of ["", ...tags]) {
      const option = element("option");
      option.value = value;
      option.textContent = value || getString("whiteboard-annotation-all-tags");
      select.append(option);
    }
    select.addEventListener("change", () => {
      tag = select.value;
      render();
    });
    label.append(caption, select);
    tools.append(label);
  }
  const colorButtons = new Map<string, HTMLButtonElement>();
  const availableColors = [
    ...new Set(annotations.map(normalizeColor).filter(Boolean)),
  ];
  const filterRow = element("div", "ss-annotation-filter-row");
  const picker = element("div", "ss-annotation-color-picker");
  const colorTrigger = button("", "ss-annotation-color-trigger");
  const colorLabel = getString("whiteboard-annotation-color-filter");
  colorTrigger.setAttribute("aria-label", colorLabel);
  colorTrigger.title = colorLabel;
  colorTrigger.setAttribute("aria-haspopup", "dialog");
  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4c-.8-.8-.2-2.1.9-2.1H17a4 4 0 0 0 4-4A8.5 8.5 0 0 0 12 3Z",
  );
  icon.append(path);
  for (const [x, y] of [
    [7, 11],
    [10, 7],
    [15, 7],
  ]) {
    const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", "1");
    icon.append(circle);
  }
  const colorCount = element("span");
  colorTrigger.append(icon, colorCount);
  const palette = element("div", "ss-annotation-colors");
  palette.id = `ss-annotation-colors-${win.crypto.randomUUID()}`;
  palette.setAttribute("role", "dialog");
  palette.setAttribute("aria-label", colorLabel);
  colorTrigger.setAttribute("aria-controls", palette.id);
  const setPaletteOpen = (open: boolean) => {
    palette.hidden = !open;
    colorTrigger.setAttribute("aria-expanded", String(open));
    if (open)
      palette
        .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus();
  };
  setPaletteOpen(false);
  colorTrigger.addEventListener("click", () =>
    setPaletteOpen(palette.hidden === true),
  );
  // Gecko on macOS may blur a button without focusing the next one.
  picker.addEventListener("mousedown", (event) => {
    const control = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (event.button === 0 && control) {
      event.preventDefault();
      control.focus();
    }
  });
  dialog.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target as Node)) setPaletteOpen(false);
  });
  dialog.addEventListener("focusin", (event) => {
    if (!picker.contains(event.target as Node)) setPaletteOpen(false);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !palette.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setPaletteOpen(false);
      colorTrigger.focus();
    }
  });
  const allColors = button(
    getString("whiteboard-annotation-all-colors"),
    "ss-annotation-all-colors",
  );
  allColors.addEventListener("click", () => {
    colors.clear();
    render();
  });
  colorButtons.set("", allColors);
  const colorGrid = element("div", "ss-annotation-color-grid");
  colorGrid.style.gridTemplateColumns = `repeat(${Math.min(5, availableColors.length) || 1}, 28px)`;
  for (const color of availableColors) {
    const control = button("", "ss-annotation-color");
    control.setAttribute("aria-label", `${colorLabel} ${color}`);
    control.title = color.toUpperCase();
    const swatch = element("span");
    swatch.style.backgroundColor = color;
    control.append(swatch);
    control.addEventListener("click", () => {
      if (colors.has(color)) colors.delete(color);
      else colors.add(color);
      render();
    });
    colorButtons.set(color, control);
    colorGrid.append(control);
  }
  palette.append(allColors, colorGrid);
  picker.append(colorTrigger, palette);
  filterRow.append(types, picker);
  filters.append(search, filterRow, tools);
  const resultCount = element("p", "ss-annotation-result-count");
  resultCount.setAttribute("role", "status");
  const list = element("div", "ss-annotation-results");
  const footer = element("footer");
  const count = element("span", "ss-annotation-selected");
  count.setAttribute("role", "status");
  const selectResults = button(
    getString("whiteboard-annotation-select-results"),
  );
  selectResults.dataset.action = "select-results";
  const clear = button(getString("whiteboard-annotation-clear-selection"));
  clear.dataset.action = "clear-selection";
  const submit = button(
    getString("annotation-export-create"),
    "ss-annotation-primary",
  );
  submit.dataset.action = "create";
  const status = element("p", "ss-annotation-error");
  status.setAttribute("role", "alert");
  status.hidden = true;
  footer.append(count, selectResults, clear, submit);

  const updateSelection = () => {
    count.textContent = getString("whiteboard-annotation-selected-count", {
      args: { count: selected.size },
    });
    submit.disabled = busy || !selected.size;
    clear.disabled = busy || !selected.size;
    selectResults.disabled =
      busy || !visible.some((index) => !selected.has(index));
  };
  const render = () => {
    const needle = search.value.trim().toLocaleLowerCase();
    visible = annotations.flatMap((annotation, index) =>
      (!type || annotation.type === type) &&
      (!tag || annotation.tags?.includes(tag)) &&
      (!colors.size || colors.has(normalizeColor(annotation))) &&
      (!needle ||
        [
          annotation.text,
          annotation.comment,
          annotation.pageLabel,
          annotation.attachmentTitle,
          ...(annotation.tags || []),
        ].some((value) => value.toLocaleLowerCase().includes(needle)))
        ? [index]
        : [],
    );
    for (const [value, control] of typeButtons)
      control.setAttribute("aria-pressed", String(type === value));
    for (const [value, control] of colorButtons)
      control.setAttribute(
        "aria-pressed",
        String(value ? colors.has(value) : !colors.size),
      );
    colorTrigger.disabled = busy || !availableColors.length;
    colorTrigger.dataset.filtered = String(colors.size > 0);
    colorCount.textContent = String(colors.size);
    colorCount.hidden = !colors.size;
    resultCount.textContent = getString("annotation-export-results", {
      args: { count: visible.length, total: annotations.length },
    });
    list.replaceChildren();
    const groups = new Map<string, HTMLElement>();
    for (const index of visible) {
      const annotation = annotations[index];
      let group = groups.get(annotation.attachmentKey);
      if (!group) {
        group = element("section", "ss-annotation-group");
        const title = element("h3");
        title.textContent = annotation.attachmentTitle;
        group.append(title);
        groups.set(annotation.attachmentKey, group);
        list.append(group);
      }
      const card = element("article", "ss-annotation-card");
      if (annotation.color)
        card.style.borderInlineStartColor = annotation.color;
      const label = element("label");
      const check = element("input");
      check.type = "checkbox";
      check.checked = selected.has(index);
      check.disabled = busy;
      check.setAttribute(
        "aria-label",
        `${typeLabel(annotation.type)} · ${getString("whiteboard-annotation-page")} ${annotation.pageLabel || annotation.page || "—"}`,
      );
      check.addEventListener("change", () => {
        if (check.checked) selected.add(index);
        else selected.delete(index);
        updateSelection();
      });
      const content = element("span", "ss-annotation-content");
      const meta = element("span", "ss-annotation-meta");
      meta.textContent = `${typeLabel(annotation.type)} · ${getString("whiteboard-annotation-page")}：${annotation.pageLabel || annotation.page || "—"}`;
      content.append(meta);
      if (annotation.text) {
        const quote = element("span", "ss-annotation-text");
        quote.textContent = annotation.text;
        content.append(quote);
      }
      if (annotation.comment) {
        const comment = element("span", "ss-annotation-comment");
        comment.textContent = annotation.comment;
        content.append(comment);
      }
      if (annotation.tags?.length) {
        const tags = element("span", "ss-annotation-tags");
        tags.textContent = annotation.tags.map((tag) => `#${tag}`).join("  ");
        content.append(tags);
      }
      label.append(check, content);
      card.append(label);
      if (
        [annotation.text, annotation.comment].some(
          (value) => value.length > 240 || value.split("\n").length > 4,
        )
      ) {
        card.classList.add("is-collapsed");
        const expand = button(
          getString("whiteboard-expand-quote"),
          "ss-annotation-expand",
        );
        expand.setAttribute("aria-expanded", "false");
        expand.addEventListener("click", () => {
          const collapsed = card.classList.toggle("is-collapsed");
          expand.textContent = getString(
            collapsed ? "whiteboard-expand-quote" : "whiteboard-collapse-quote",
          );
          expand.setAttribute("aria-expanded", String(!collapsed));
        });
        card.append(expand);
      }
      group.append(card);
    }
    if (!visible.length) {
      const empty = element("p", "ss-annotation-empty");
      empty.textContent = getString(
        annotations.length
          ? "annotation-export-no-results"
          : "annotation-export-empty",
      );
      list.append(empty);
    }
    updateSelection();
  };
  search.addEventListener("input", render);
  selectResults.addEventListener("click", () => {
    for (const index of visible) selected.add(index);
    render();
  });
  clear.addEventListener("click", () => {
    selected.clear();
    render();
  });
  submit.addEventListener("click", async () => {
    if (busy || !selected.size) return;
    const chosen = annotations.filter((_, index) => selected.has(index));
    busy = true;
    setPaletteOpen(false);
    status.hidden = true;
    for (const control of filters.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >("input, button, select"))
      control.disabled = true;
    render();
    const shouldContinue = () =>
      dialog.isConnected && dialog.open && !win.closed;
    try {
      if (await create(chosen, shouldContinue)) {
        if (shouldContinue()) dialog.close();
      } else if (shouldContinue()) {
        status.textContent = getString("annotation-export-failed");
        status.hidden = false;
      }
    } catch (error) {
      if (shouldContinue()) {
        status.textContent = `${getString("annotation-export-failed")} ${String(error)}`;
        status.hidden = false;
      }
    } finally {
      if (shouldContinue()) {
        busy = false;
        for (const control of filters.querySelectorAll<
          HTMLInputElement | HTMLButtonElement | HTMLSelectElement
        >("input, button, select"))
          control.disabled = false;
        render();
      }
    }
  });
  const previous = doc.activeElement as HTMLElement | null;
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      previous?.focus();
    },
    { once: true },
  );
  dialog.append(
    style,
    header,
    hint,
    filters,
    resultCount,
    list,
    status,
    footer,
  );
  doc.documentElement.append(dialog);
  render();
  dialog.showModal();
  search.focus();
}
