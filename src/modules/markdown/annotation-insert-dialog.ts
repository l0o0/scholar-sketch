import { getString } from "../../utils/locale";
import { annotationIdentity, type MarkdownAnnotation } from "./annotations";
import type {
  AnnotationInsertSource,
  AnnotationSearchPage,
  AnnotationSearchFilters,
} from "./annotation-search";
import { annotationDialogCSS } from "./annotation-dialog-style";
import {
  annotationColor,
  annotationDialogElements,
  annotationTypeLabel,
  annotationTypeLabels,
  createAnnotationCard,
  createAnnotationDialogHeader,
  createAnnotationColorPicker,
} from "./annotation-dialog-controls";

export interface AnnotationInsertDialogOptions {
  initialSources: readonly AnnotationInsertSource[];
  availableColors?: readonly string[];
  searchSources: (query: string) => Promise<AnnotationInsertSource[]>;
  searchAnnotations: (
    query: string,
    sources: readonly AnnotationInsertSource[],
    shouldContinue: () => boolean,
    filters: AnnotationSearchFilters,
  ) => Promise<AnnotationSearchPage>;
  openAnnotation: (annotation: MarkdownAnnotation) => Promise<void> | void;
  insert: (
    chosen: MarkdownAnnotation[],
    shouldContinue: () => boolean,
  ) => Promise<boolean>;
  onClose: () => void;
}

/** Search results belong to a request; selected annotations belong to the dialog. */
export function showAnnotationInsertDialog(
  win: Window,
  options: AnnotationInsertDialogOptions,
): () => void {
  const doc = win.document;
  const { element, button } = annotationDialogElements(doc);
  const previous = doc.activeElement as HTMLElement | null;
  let closed = false;
  let generation = 0;
  let timer: ReturnType<typeof win.setTimeout> | undefined;
  let searchState: "idle" | "loading" | "loaded" | "failed" = "idle";
  let loadingMore = false;
  let composing = false;
  let busy = false;
  let showingSelected = false;
  let annotations: readonly MarkdownAnnotation[] = [];
  let nextPage: AnnotationSearchPage["loadMore"];
  let suggestions = [...options.initialSources];
  const sources = new Map<number, AnnotationInsertSource>();
  const selected = new Map<string, MarkdownAnnotation>();
  const colors = new Set<string>();
  let type = "";
  let tag = "";
  let visible: readonly MarkdownAnnotation[] = [];
  let searchError = "";
  let sourceError = "";
  let moreError = "";
  let operationError = "";
  const dialog = element(
    "dialog",
    "ss-annotation-dialog ss-annotation-insert-dialog",
  );
  dialog.setAttribute(
    "aria-label",
    getString("markdown-annotation-insert-title"),
  );
  const style = element("style");
  style.textContent = annotationDialogCSS;
  const header = createAnnotationDialogHeader(
    win,
    dialog,
    getString("markdown-annotation-insert-title"),
    getString("markdown-annotation-insert-hint"),
  );
  const searchBox = element("div", "ss-annotation-source-picker");
  const search = element("input", "ss-annotation-search");
  search.type = "search";
  search.placeholder = getString("markdown-annotation-search");
  search.setAttribute("aria-label", search.placeholder);
  const chips = element("div", "ss-annotation-source-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", getString("markdown-annotation-source"));
  const suggestionList = element("div", "ss-annotation-source-results");
  suggestionList.id = `ss-annotation-sources-${win.crypto.randomUUID()}`;
  suggestionList.setAttribute("role", "group");
  suggestionList.setAttribute(
    "aria-label",
    getString("markdown-annotation-source-suggestions"),
  );
  search.setAttribute("aria-controls", suggestionList.id);
  const sourceStatus = element("p", "ss-annotation-source-feedback");
  sourceStatus.setAttribute("role", "alert");
  sourceStatus.hidden = true;
  searchBox.append(search, chips, suggestionList, sourceStatus);
  const filters = element("div", "ss-annotation-filters");
  const filterRow = element("div", "ss-annotation-filter-row");
  const scope = element("span", "ss-annotation-scope");
  scope.textContent = getString("markdown-annotation-library-scope");
  const types = element("div", "ss-annotation-types");
  types.setAttribute("role", "group");
  types.setAttribute(
    "aria-label",
    getString("whiteboard-annotation-type-filter"),
  );
  const typeButtons = new Map<string, HTMLButtonElement>();
  const palette = createAnnotationColorPicker(win, dialog, colors, () =>
    scheduleSearch(0),
  );
  const resultCount = element("p", "ss-annotation-result-count");
  resultCount.setAttribute("role", "status");
  filterRow.append(types, palette.element, resultCount);
  const tagFilter = element("label", "ss-annotation-tag-filter");
  const tagLabel = element("span");
  tagLabel.textContent = getString("whiteboard-annotation-tag-filter");
  const tagSelect = element("select");
  tagSelect.setAttribute("aria-label", tagLabel.textContent);
  tagSelect.addEventListener("change", () => {
    tag = tagSelect.value;
    scheduleSearch(0);
  });
  tagFilter.append(tagLabel, tagSelect);
  const tools = element("div", "ss-annotation-tools");
  tools.append(scope, tagFilter);
  filters.append(filterRow, tools);
  const list = element("div", "ss-annotation-results");
  const searchStatus = element("p", "ss-annotation-error");
  searchStatus.setAttribute("role", "alert");
  const retrySearch = button(getString("markdown-annotation-retry-search"));
  retrySearch.dataset.action = "retry-search";
  const paging = element("div", "ss-annotation-paging");
  const moreStatus = element("p", "ss-annotation-error");
  moreStatus.setAttribute("role", "alert");
  const more = button(getString("markdown-annotation-load-more"));
  more.dataset.action = "load-more";
  paging.append(moreStatus, more);
  const status = element("p", "ss-annotation-error");
  status.setAttribute("role", "alert");
  const footer = element("footer");
  const count = element("span", "ss-annotation-selected");
  count.setAttribute("role", "status");
  const viewSelected = button(getString("markdown-annotation-show-selected"));
  viewSelected.dataset.action = "view-selected";
  const selectResults = button(getString("markdown-annotation-select-loaded"));
  selectResults.dataset.action = "select-results";
  const clear = button(getString("whiteboard-annotation-clear-selection"));
  clear.dataset.action = "clear-selection";
  const submit = button("", "ss-annotation-primary");
  submit.dataset.action = "insert";
  footer.append(count, viewSelected, selectResults, clear, submit);
  const isCurrent = () =>
    !closed && dialog.isConnected && dialog.open && !win.closed;
  const hasQuery = () =>
    Boolean(search.value.trim() || sources.size || type || tag || colors.size);
  const sourceIdentity = (annotation: MarkdownAnnotation) =>
    `${annotation.groupID ?? "library"}/${annotation.sourceKey || annotation.attachmentKey}`;

  function updateSelection() {
    const sourceCount = new Set([...selected.values()].map(sourceIdentity))
      .size;
    count.textContent = getString("markdown-annotation-selection-summary", {
      args: { count: selected.size, sources: sourceCount },
    });
    submit.textContent = getString("markdown-annotation-insert-count", {
      args: { count: selected.size },
    });
    submit.disabled = busy || !selected.size;
    clear.disabled = busy || !selected.size;
    viewSelected.disabled = busy || (!selected.size && !showingSelected);
    viewSelected.textContent = getString(
      showingSelected
        ? "markdown-annotation-show-results"
        : "markdown-annotation-show-selected",
    );
    viewSelected.setAttribute("aria-pressed", String(showingSelected));
    selectResults.disabled =
      busy ||
      (!showingSelected && searchState === "loading") ||
      !visible.some(
        (annotation) => !selected.has(annotationIdentity(annotation)),
      );
    selectResults.hidden = showingSelected;
  }
  function refreshFilters() {
    types.replaceChildren();
    typeButtons.clear();
    const entries = showingSelected ? [...selected.values()] : annotations;
    for (const value of ["", ...Object.keys(annotationTypeLabels)]) {
      const control = button(
        value
          ? annotationTypeLabel(value)
          : getString("whiteboard-annotation-all-types"),
      );
      control.dataset.type = value;
      control.addEventListener("click", () => {
        type = value;
        scheduleSearch(0);
      });
      types.append(control);
      typeButtons.set(value, control);
    }
    tagSelect.replaceChildren();
    const tags = [
      ...new Set([
        ...entries.flatMap((annotation) => annotation.tags || []),
        ...(tag ? [tag] : []),
      ]),
    ].sort((a, b) => a.localeCompare(b));
    for (const value of ["", ...tags]) {
      const option = element("option");
      option.value = value;
      option.textContent = value || getString("whiteboard-annotation-all-tags");
      tagSelect.append(option);
    }
    tagSelect.value = tag;
    tagFilter.hidden = !tags.length;
  }
  function renderSources() {
    chips.replaceChildren();
    for (const source of sources.values()) {
      const chip = button(`${source.title} ×`, "ss-annotation-source-chip");
      chip.dataset.sourceId = String(source.id);
      chip.setAttribute(
        "aria-label",
        getString("markdown-annotation-remove-source", {
          args: { title: source.title },
        }),
      );
      chip.disabled = busy;
      chip.addEventListener("click", () => {
        sources.delete(source.id);
        showingSelected = false;
        scheduleSearch(0);
        search.focus();
      });
      chips.append(chip);
    }
    chips.hidden = !sources.size;
    suggestionList.replaceChildren();
    for (const source of suggestions) {
      if (sources.has(source.id)) continue;
      const choice = button("", "ss-annotation-source-choice");
      choice.dataset.sourceId = String(source.id);
      choice.disabled = busy;
      const title = element("span", "ss-annotation-source-title");
      title.textContent = source.title;
      choice.append(title);
      if (source.detail) {
        const detail = element("span", "ss-annotation-source-detail");
        detail.textContent = source.detail;
        choice.append(detail);
      }
      choice.addEventListener("click", () => {
        if (busy) return;
        sources.set(source.id, source);
        search.value = "";
        showingSelected = false;
        scheduleSearch(0);
        search.focus();
      });
      suggestionList.append(choice);
    }
    suggestionList.hidden = !suggestionList.childElementCount;
    sourceStatus.textContent = sourceError;
    sourceStatus.hidden = !sourceError;
  }
  function render() {
    const entries = showingSelected ? [...selected.values()] : annotations;
    visible = entries;
    search.disabled = busy;
    for (const [value, control] of typeButtons) {
      control.disabled = busy || showingSelected;
      control.setAttribute("aria-pressed", String(type === value));
    }
    tagSelect.disabled = busy || showingSelected;
    palette.sync(
      [
        ...new Set([
          ...(options.availableColors?.map((color) => color.toLowerCase()) ??
            []),
          ...entries.map(annotationColor).filter(Boolean),
          ...colors,
        ]),
      ],
      busy || showingSelected,
    );
    resultCount.textContent = getString("markdown-annotation-loaded-results", {
      args: { count: visible.length, total: entries.length },
    });
    list.replaceChildren();
    list.setAttribute(
      "aria-busy",
      String(!showingSelected && (searchState === "loading" || loadingMore)),
    );
    for (const annotation of visible) {
      const key = annotationIdentity(annotation);
      const card = createAnnotationCard(doc, annotation, {
        checked: selected.has(key),
        disabled: busy || (!showingSelected && searchState === "loading"),
        showSource: true,
        onChange(checked) {
          if (checked) selected.set(key, annotation);
          else selected.delete(key);
          if (showingSelected) {
            const index = visible.findIndex(
              (entry) => annotationIdentity(entry) === key,
            );
            refreshFilters();
            render();
            const remaining = [
              ...list.querySelectorAll<HTMLInputElement>(
                'input[type="checkbox"]',
              ),
            ];
            (
              remaining[Math.min(index, remaining.length - 1)] ?? viewSelected
            ).focus();
          } else updateSelection();
        },
        open: () => {
          void Promise.resolve()
            .then(() => options.openAnnotation(annotation))
            .catch((error) => {
              if (isCurrent()) {
                operationError = String(error);
                render();
              }
            });
        },
      });
      card.dataset.annotationId = key;
      list.append(card);
    }
    if (!visible.length) {
      const empty = element("p", "ss-annotation-empty");
      empty.textContent = getString(
        !showingSelected && searchState === "loading"
          ? "markdown-annotation-searching"
          : !showingSelected && !hasQuery()
            ? "markdown-annotation-search-empty"
            : "annotation-export-no-results",
      );
      list.append(empty);
    }
    searchStatus.textContent = searchError;
    searchStatus.hidden = !searchError;
    retrySearch.hidden = !searchError;
    retrySearch.disabled = busy || searchState === "loading";
    moreStatus.textContent = moreError;
    moreStatus.hidden = !moreError;
    more.textContent = getString(
      moreError
        ? "markdown-annotation-retry-more"
        : "markdown-annotation-load-more",
    );
    more.disabled = busy || loadingMore || searchState === "loading";
    paging.hidden = showingSelected || !nextPage;
    status.textContent = operationError;
    status.hidden = !operationError;
    updateSelection();
  }
  async function runSearch(request: number) {
    const current = () => isCurrent() && generation === request && !busy;
    const query = search.value.trim();
    const scope = [...sources.values()];
    const loadSuggestions = async () => {
      if (!query) {
        suggestions = [...options.initialSources];
        renderSources();
        return;
      }
      try {
        const found = await options.searchSources(query);
        if (!current()) return;
        suggestions = found;
        sourceError = "";
        renderSources();
      } catch (error) {
        if (!current()) return;
        sourceError = `${getString("markdown-annotation-source-failed")} ${String(error)}`;
        renderSources();
      }
    };
    const loadAnnotations = async () => {
      if (!query && !scope.length && !type && !tag && !colors.size) return;
      try {
        const page = await options.searchAnnotations(query, scope, current, {
          type,
          colors: [...colors],
          tag,
        });
        if (!current()) return;
        annotations = [
          ...new Map(
            page.annotations.map((annotation) => [
              annotationIdentity(annotation),
              annotation,
            ]),
          ).values(),
        ];
        nextPage = page.loadMore;
        searchState = "loaded";
        refreshFilters();
        render();
      } catch (error) {
        if (!current()) return;
        searchState = "failed";
        searchError = `${getString("markdown-annotation-search-failed")} ${String(error)}`;
        render();
      }
    };
    await Promise.all([loadSuggestions(), loadAnnotations()]);
  }
  function scheduleSearch(wait = 180, keepOperationError = false) {
    if (busy) return;
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    const request = ++generation;
    loadingMore = false;
    nextPage = undefined;
    if (!keepOperationError) showingSelected = false;
    searchError = sourceError = moreError = "";
    if (!keepOperationError) operationError = "";
    searchState = hasQuery() ? "loading" : "idle";
    if (!hasQuery()) {
      annotations = [];
      nextPage = undefined;
    }
    suggestions = search.value.trim() ? [] : [...options.initialSources];
    renderSources();
    refreshFilters();
    render();
    if (wait === 0) {
      void runSearch(request);
      return;
    }
    timer = win.setTimeout(() => {
      timer = undefined;
      void runSearch(request);
    }, wait);
  }
  search.addEventListener("compositionstart", () => {
    composing = true;
    generation++;
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
  });
  search.addEventListener("compositionend", () => {
    composing = false;
    scheduleSearch();
  });
  search.addEventListener("input", (event) => {
    if (!composing && !(event as InputEvent).isComposing) scheduleSearch();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && !composing) {
      event.preventDefault();
      scheduleSearch(0);
    }
  });
  retrySearch.addEventListener("click", () => scheduleSearch(0));
  more.addEventListener("click", async () => {
    if (busy || loadingMore || !nextPage || searchState === "loading") return;
    const request = generation;
    const current = () => isCurrent() && generation === request && !busy;
    const load = nextPage;
    loadingMore = true;
    moreError = "";
    render();
    try {
      const page = await load(current);
      if (!current()) return;
      annotations = [
        ...new Map(
          [...annotations, ...page.annotations].map((annotation) => [
            annotationIdentity(annotation),
            annotation,
          ]),
        ).values(),
      ];
      nextPage = page.loadMore;
      refreshFilters();
    } catch (error) {
      if (!current()) return;
      moreError = `${getString("markdown-annotation-more-failed")} ${String(error)}`;
    } finally {
      if (current()) {
        loadingMore = false;
        render();
      }
    }
  });
  viewSelected.addEventListener("click", () => {
    showingSelected = !showingSelected;
    refreshFilters();
    render();
  });
  selectResults.addEventListener("click", () => {
    for (const annotation of visible)
      selected.set(annotationIdentity(annotation), annotation);
    render();
  });
  clear.addEventListener("click", () => {
    selected.clear();
    render();
  });
  submit.addEventListener("click", async () => {
    if (busy || !selected.size) return;
    const chosen = [...selected.values()];
    busy = true;
    generation++;
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    loadingMore = false;
    if (searchState === "loading")
      searchState = annotations.length ? "loaded" : "idle";
    operationError = "";
    palette.close();
    renderSources();
    render();
    try {
      const inserted = await options.insert(chosen, isCurrent);
      if (!isCurrent()) return;
      if (inserted) dialog.close();
      else operationError = getString("markdown-annotation-insert-failed");
    } catch (error) {
      if (isCurrent())
        operationError = `${getString("markdown-annotation-insert-failed")} ${String(error)}`;
    } finally {
      if (isCurrent()) {
        busy = false;
        if (operationError && hasQuery()) scheduleSearch(0, true);
        else {
          renderSources();
          render();
        }
      }
    }
  });
  const dispose = () => {
    if (closed) return;
    closed = true;
    generation++;
    if (timer !== undefined) win.clearTimeout(timer);
    dialog.removeEventListener("close", dispose);
    win.removeEventListener("unload", dispose);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (!win.closed && previous?.isConnected) previous.focus();
    options.onClose();
  };
  dialog.addEventListener("close", dispose, { once: true });
  win.addEventListener("unload", dispose, { once: true });
  dialog.append(
    style,
    header,
    searchBox,
    filters,
    list,
    searchStatus,
    retrySearch,
    paging,
    status,
    footer,
  );
  doc.documentElement.append(dialog);
  refreshFilters();
  renderSources();
  render();
  dialog.showModal();
  search.focus();
  return dispose;
}
