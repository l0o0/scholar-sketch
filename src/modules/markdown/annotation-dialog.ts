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

export interface AnnotationInsertSource {
  id: number;
  title: string;
  detail?: string;
}

interface AnnotationInsertDialogOptions {
  initialSources: readonly AnnotationInsertSource[];
  searchSources: (query: string) => Promise<AnnotationInsertSource[]>;
  loadAnnotations: (
    source: AnnotationInsertSource,
  ) => Promise<readonly MarkdownAnnotation[]>;
  insert: (
    chosen: MarkdownAnnotation[],
    shouldContinue: () => boolean,
  ) => Promise<boolean>;
  onClose: () => void;
}

export function showAnnotationExportDialog(
  win: Window,
  annotations: readonly MarkdownAnnotation[],
  create: (
    chosen: MarkdownAnnotation[],
    shouldContinue: () => boolean,
  ) => Promise<boolean>,
) {
  showAnnotationDialog(win, annotations, create);
}

export function showAnnotationInsertDialog(
  win: Window,
  options: AnnotationInsertDialogOptions,
): () => void {
  return showAnnotationDialog(win, [], options.insert, options);
}

function showAnnotationDialog(
  win: Window,
  initialAnnotations: readonly MarkdownAnnotation[],
  submitAnnotations: (
    chosen: MarkdownAnnotation[],
    shouldContinue: () => boolean,
  ) => Promise<boolean>,
  insertion?: AnnotationInsertDialogOptions,
): () => void {
  const doc = win.document;
  let annotations = initialAnnotations;
  let closed = false;
  let sourceGeneration = 0;
  let searchGeneration = 0;
  let searchTimer: ReturnType<typeof win.setTimeout> | undefined;
  let sourceState: "unselected" | "loading" | "loaded" | "failed" = insertion
    ? "unselected"
    : "loaded";
  let currentSource: AnnotationInsertSource | undefined;
  let sourceError = "";
  let sources = [...(insertion?.initialSources ?? [])];
  let searchingSources = false;
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
  const title = getString(
    insertion ? "markdown-annotation-insert-title" : "menuitem-annotations-md",
  );
  dialog.setAttribute("aria-label", title);
  const style = element("style");
  style.textContent = annotationDialogCSS;
  const header = element("header");
  const heading = element("h2");
  heading.textContent = title;
  const headerActions = element("div", "ss-annotation-header-actions");
  const help = element("div", "ss-annotation-help");
  const helpButton = button("", "ss-annotation-help-trigger");
  helpButton.setAttribute("aria-label", getString("annotation-export-help"));
  const question = element("span");
  question.textContent = "?";
  question.setAttribute("aria-hidden", "true");
  helpButton.append(question);
  const hint = element("p", "ss-annotation-guidance");
  hint.id = `ss-annotation-guidance-${win.crypto.randomUUID()}`;
  hint.setAttribute("role", "tooltip");
  hint.textContent = getString(
    insertion ? "markdown-annotation-insert-hint" : "annotation-export-hint",
  );
  hint.hidden = true;
  helpButton.setAttribute("aria-describedby", hint.id);
  help.append(helpButton, hint);
  help.addEventListener("pointerenter", () => {
    hint.hidden = false;
  });
  help.addEventListener("pointerleave", () => {
    if (!help.contains(doc.activeElement)) hint.hidden = true;
  });
  help.addEventListener("focusin", () => {
    hint.hidden = false;
  });
  help.addEventListener("focusout", () => {
    if (!help.matches(":hover")) hint.hidden = true;
  });
  helpButton.addEventListener("click", () => {
    hint.hidden = false;
  });
  const close = button("×", "ss-annotation-close");
  close.setAttribute("aria-label", getString("file-history-close"));
  close.addEventListener("click", () => dialog.close());
  headerActions.append(help, close);
  header.append(heading, headerActions);
  const sourcePicker = element("div", "ss-annotation-source-picker");
  const sourceSearch = element("input", "ss-annotation-source-search");
  sourceSearch.type = "search";
  sourceSearch.placeholder = getString("markdown-annotation-source-search");
  sourceSearch.setAttribute("aria-label", sourceSearch.placeholder);
  const sourceResults = element("div", "ss-annotation-source-results");
  sourceResults.id = `ss-annotation-sources-${win.crypto.randomUUID()}`;
  sourceResults.setAttribute("role", "group");
  sourceResults.setAttribute(
    "aria-label",
    getString("markdown-annotation-source"),
  );
  sourceSearch.setAttribute("aria-controls", sourceResults.id);
  const currentSourceLabel = element("div", "ss-annotation-current-source");
  currentSourceLabel.setAttribute("role", "status");
  const sourceCaption = element("span", "ss-annotation-source-caption");
  sourceCaption.textContent = getString("markdown-annotation-source");
  const sourceTitle = element("strong", "ss-annotation-source-title");
  const sourceDetail = element("span", "ss-annotation-source-detail");
  currentSourceLabel.append(sourceCaption, sourceTitle, sourceDetail);
  const refreshSource = button(getString("markdown-annotation-refresh-source"));
  refreshSource.dataset.action = "refresh-source";
  const sourceControls = element("div", "ss-annotation-source-controls");
  sourceControls.append(currentSourceLabel, refreshSource);
  const sourceFeedback = element("p", "ss-annotation-source-feedback");
  sourceFeedback.setAttribute("role", "status");
  sourceFeedback.hidden = true;
  sourcePicker.append(
    sourceSearch,
    sourceResults,
    sourceFeedback,
    sourceControls,
  );
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
  let attachmentKey = "";
  const colors = new Set<string>();
  const normalizeColor = (annotation: MarkdownAnnotation) =>
    annotation.color?.trim().toLowerCase() || "";
  const selected = new Set(
    insertion ? [] : annotations.map((_, index) => index),
  );
  let visible: number[] = [];
  let busy = false;
  const typeButtons = new Map<string, HTMLButtonElement>();
  const tools = element("div", "ss-annotation-tools");
  const attachmentFilter = element("label", "ss-annotation-attachment-filter");
  const attachmentCaption = element("span");
  attachmentCaption.textContent = getString("markdown-annotation-attachment");
  const attachmentSelect = element("select");
  attachmentSelect.addEventListener("change", () => {
    attachmentKey = attachmentSelect.value;
    render();
  });
  attachmentFilter.append(attachmentCaption, attachmentSelect);
  const tagFilter = element("label", "ss-annotation-tag-filter");
  const tagCaption = element("span");
  tagCaption.textContent = getString("whiteboard-annotation-tag-filter");
  const tagSelect = element("select");
  tagSelect.addEventListener("change", () => {
    tag = tagSelect.value;
    render();
  });
  tagFilter.append(tagCaption, tagSelect);
  const colorButtons = new Map<string, HTMLButtonElement>();
  let availableColors: string[] = [];
  let attachmentCount = 0;
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
    } else if (event.key === "Escape" && !hint.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hint.hidden = true;
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
  const refreshAnnotationChoices = () => {
    types.replaceChildren();
    typeButtons.clear();
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
    tools.replaceChildren();
    const attachments = new Map(
      annotations.map((annotation) => [
        annotation.attachmentKey,
        annotation.attachmentTitle,
      ]),
    );
    attachmentCount = attachments.size;
    attachmentSelect.replaceChildren();
    for (const [value, label] of [
      ["", getString("markdown-annotation-all-attachments")],
      ...attachments,
    ]) {
      const option = element("option");
      option.value = value;
      option.textContent = label;
      attachmentSelect.append(option);
    }
    if (insertion && attachmentCount > 1) tools.append(attachmentFilter);
    const tags = [
      ...new Set(annotations.flatMap((annotation) => annotation.tags || [])),
    ].sort((a, b) => a.localeCompare(b));
    tagSelect.replaceChildren();
    for (const value of ["", ...tags]) {
      const option = element("option");
      option.value = value;
      option.textContent = value || getString("whiteboard-annotation-all-tags");
      tagSelect.append(option);
    }
    if (tags.length) tools.append(tagFilter);
    availableColors = [
      ...new Set(annotations.map(normalizeColor).filter(Boolean)),
    ];
    colorGrid.replaceChildren();
    colorButtons.clear();
    colorButtons.set("", allColors);
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
  };
  palette.append(allColors, colorGrid);
  picker.append(colorTrigger, palette);
  const resultCount = element("p", "ss-annotation-result-count");
  resultCount.setAttribute("role", "status");
  filterRow.append(types, picker, resultCount);
  filters.append(search, filterRow, tools);
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
    getString(
      insertion
        ? "markdown-annotation-insert-selected"
        : "annotation-export-create",
    ),
    "ss-annotation-primary",
  );
  submit.dataset.action = insertion ? "insert" : "create";
  const status = element("p", "ss-annotation-error");
  status.setAttribute("role", "alert");
  status.hidden = true;
  footer.append(count, selectResults, clear, submit);

  const updateSelection = () => {
    count.textContent = getString("whiteboard-annotation-selected-count", {
      args: { count: selected.size },
    });
    submit.disabled = busy || sourceState !== "loaded" || !selected.size;
    clear.disabled = busy || !selected.size;
    selectResults.disabled =
      busy || !visible.some((index) => !selected.has(index));
  };
  const render = () => {
    const needle = search.value.trim().toLocaleLowerCase();
    visible = annotations.flatMap((annotation, index) =>
      (!type || annotation.type === type) &&
      (!attachmentKey || annotation.attachmentKey === attachmentKey) &&
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
    for (const control of filters.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >("input, button, select"))
      control.disabled = busy || sourceState !== "loaded";
    sourceSearch.disabled = busy || sourceState === "loading";
    for (const control of sourceResults.querySelectorAll("button"))
      control.disabled = busy || sourceState === "loading";
    refreshSource.disabled =
      busy || sourceState === "loading" || !currentSource;
    colorTrigger.disabled =
      busy || sourceState !== "loaded" || !availableColors.length;
    colorTrigger.dataset.filtered = String(colors.size > 0);
    colorCount.textContent = String(colors.size);
    colorCount.hidden = !colors.size;
    resultCount.textContent = getString("annotation-export-results", {
      args: { count: visible.length, total: annotations.length },
    });
    list.replaceChildren();
    list.setAttribute("aria-busy", String(sourceState === "loading"));
    const groups = new Map<string, HTMLElement>();
    for (const index of visible) {
      const annotation = annotations[index];
      let group = groups.get(annotation.attachmentKey);
      if (!group) {
        group = element("section", "ss-annotation-group");
        group.setAttribute("aria-label", annotation.attachmentTitle);
        groups.set(annotation.attachmentKey, group);
        list.append(group);
        if (insertion && attachmentCount > 1 && !attachmentKey) {
          const title = element("h3", "ss-annotation-group-title");
          title.textContent = annotation.attachmentTitle;
          group.append(title);
        }
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
      if (sourceState === "failed") {
        empty.textContent = sourceError;
        empty.setAttribute("role", "alert");
      } else {
        empty.textContent = getString(
          sourceState === "unselected"
            ? "markdown-annotation-choose-source"
            : sourceState === "loading"
              ? "markdown-annotation-loading"
              : annotations.length
                ? "annotation-export-no-results"
                : "annotation-export-empty",
        );
      }
      list.append(empty);
    }
    updateSelection();
  };
  const isCurrent = () =>
    !closed && dialog.isConnected && dialog.open && !win.closed;
  const renderSources = () => {
    sourceControls.hidden = !currentSource;
    sourceTitle.textContent = currentSource?.title ?? "";
    sourceTitle.title = sourceTitle.textContent;
    sourceDetail.textContent = currentSource?.detail ?? "";
    sourceDetail.title = sourceDetail.textContent;
    sourceDetail.hidden = !currentSource?.detail;
    sourceResults.replaceChildren();
    sourceResults.hidden =
      searchingSources ||
      (!sourceSearch.value.trim() &&
        (Boolean(currentSource) || sources.length < 2)) ||
      !sources.length;
    if (sourceResults.hidden) return;
    for (const source of sources) {
      const choice = button("", "ss-annotation-source-choice");
      choice.dataset.sourceId = String(source.id);
      choice.title = source.detail
        ? `${source.title} · ${source.detail}`
        : source.title;
      choice.setAttribute(
        "aria-pressed",
        String(currentSource?.id === source.id),
      );
      const title = element("span", "ss-annotation-source-title");
      title.textContent = source.title;
      choice.append(title);
      if (source.detail) {
        const detail = element("span", "ss-annotation-source-detail");
        detail.textContent = source.detail;
        choice.append(detail);
      }
      choice.addEventListener("click", () => {
        if (busy || sourceState === "loading") return;
        void loadSource(source);
      });
      sourceResults.append(choice);
    }
  };
  const loadSource = async (
    source: AnnotationInsertSource,
    refresh = false,
  ) => {
    if (!insertion || !isCurrent()) return;
    searchGeneration++;
    if (searchTimer !== undefined) win.clearTimeout(searchTimer);
    searchTimer = undefined;
    sourceSearch.value = "";
    searchingSources = false;
    sources = [...insertion.initialSources];
    sourceFeedback.hidden = true;
    if (
      !refresh &&
      currentSource?.id === source.id &&
      sourceState === "loaded"
    ) {
      renderSources();
      sourceSearch.focus();
      return;
    }
    const generation = ++sourceGeneration;
    currentSource = source;
    sourceState = "loading";
    annotations = [];
    selected.clear();
    type = tag = attachmentKey = "";
    colors.clear();
    search.value = "";
    sourceError = "";
    status.hidden = true;
    setPaletteOpen(false);
    renderSources();
    refreshAnnotationChoices();
    render();
    try {
      const loaded = await insertion.loadAnnotations(source);
      if (!isCurrent() || generation !== sourceGeneration) return;
      annotations = loaded;
      sourceState = "loaded";
      refreshAnnotationChoices();
      render();
      if (doc.activeElement === doc.body) sourceSearch.focus();
    } catch (error) {
      if (!isCurrent() || generation !== sourceGeneration) return;
      sourceState = "failed";
      sourceError = `${getString("markdown-annotation-load-failed")} ${String(error)}`;
      render();
    }
  };
  refreshSource.addEventListener("click", () => {
    if (currentSource) void loadSource(currentSource, true);
  });
  sourceSearch.addEventListener("input", () => {
    if (!insertion) return;
    if (searchTimer !== undefined) win.clearTimeout(searchTimer);
    searchTimer = undefined;
    const generation = ++searchGeneration;
    const query = sourceSearch.value.trim();
    sources = [];
    searchingSources = Boolean(query);
    sourceFeedback.setAttribute("role", "status");
    if (!query) {
      sources = [...insertion.initialSources];
      sourceFeedback.hidden = true;
      renderSources();
      render();
      return;
    }
    renderSources();
    sourceFeedback.hidden = false;
    sourceFeedback.textContent = getString(
      "markdown-annotation-source-searching",
    );
    searchTimer = win.setTimeout(async () => {
      searchTimer = undefined;
      try {
        const found = await insertion.searchSources(query);
        if (!isCurrent() || generation !== searchGeneration) return;
        sources = found;
        searchingSources = false;
        renderSources();
        sourceFeedback.hidden = sources.length > 0;
        sourceFeedback.textContent = getString(
          "markdown-annotation-no-sources",
        );
        render();
      } catch (error) {
        if (!isCurrent() || generation !== searchGeneration) return;
        searchingSources = false;
        sourceFeedback.setAttribute("role", "alert");
        sourceFeedback.textContent = `${getString("markdown-annotation-source-failed")} ${String(error)}`;
        sourceFeedback.hidden = false;
      }
    }, 180);
  });
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
    const shouldContinue = isCurrent;
    try {
      if (await submitAnnotations(chosen, shouldContinue)) {
        if (shouldContinue()) dialog.close();
      } else if (shouldContinue()) {
        status.textContent = getString(
          insertion
            ? "markdown-annotation-insert-failed"
            : "annotation-export-failed",
        );
        status.hidden = false;
      }
    } catch (error) {
      if (shouldContinue()) {
        status.textContent = `${getString(insertion ? "markdown-annotation-insert-failed" : "annotation-export-failed")} ${String(error)}`;
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
  const dispose = () => {
    if (closed) return;
    closed = true;
    sourceGeneration++;
    searchGeneration++;
    if (searchTimer !== undefined) win.clearTimeout(searchTimer);
    dialog.removeEventListener("close", dispose);
    win.removeEventListener("unload", dispose);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (!win.closed && previous?.isConnected) previous.focus();
    insertion?.onClose();
  };
  dialog.addEventListener("close", dispose, { once: true });
  win.addEventListener("unload", dispose, { once: true });
  dialog.append(style, header);
  if (insertion) dialog.append(sourcePicker);
  dialog.append(filters, list, status, footer);
  doc.documentElement.append(dialog);
  renderSources();
  refreshAnnotationChoices();
  render();
  dialog.showModal();
  if (insertion) {
    sourceSearch.focus();
    if (sources.length === 1) void loadSource(sources[0]);
  } else search.focus();
  return dispose;
}
