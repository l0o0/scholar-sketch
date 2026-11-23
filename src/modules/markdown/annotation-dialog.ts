import { getString } from "../../utils/locale";
import type { MarkdownAnnotation } from "./annotations";
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

export { showAnnotationInsertDialog } from "./annotation-insert-dialog";
export type { AnnotationInsertDialogOptions } from "./annotation-insert-dialog";
export type { AnnotationInsertSource } from "./annotation-search";

/** The export dialog filters a fixed source snapshot and initially selects all. */
export function showAnnotationExportDialog(
  win: Window,
  annotations: readonly MarkdownAnnotation[],
  create: (
    chosen: MarkdownAnnotation[],
    shouldContinue: () => boolean,
  ) => Promise<boolean>,
): void {
  const doc = win.document;
  const { element, button } = annotationDialogElements(doc);
  let closed = false;
  let busy = false;
  let type = "";
  let tag = "";
  const colors = new Set<string>();
  const selected = new Set(annotations.map((_, index) => index));
  let visible: number[] = [];
  const previous = doc.activeElement as HTMLElement | null;
  const dialog = element("dialog", "ss-annotation-dialog");
  dialog.setAttribute("aria-label", getString("menuitem-annotations-md"));
  const style = element("style");
  style.textContent = annotationDialogCSS;
  const header = createAnnotationDialogHeader(
    win,
    dialog,
    getString("menuitem-annotations-md"),
    getString("annotation-export-hint"),
  );
  const filters = element("div", "ss-annotation-filters");
  const search = element("input", "ss-annotation-search");
  search.type = "search";
  search.placeholder = getString("annotation-export-search");
  search.setAttribute("aria-label", search.placeholder);
  const filterRow = element("div", "ss-annotation-filter-row");
  const types = element("div", "ss-annotation-types");
  types.setAttribute("role", "group");
  types.setAttribute(
    "aria-label",
    getString("whiteboard-annotation-type-filter"),
  );
  const typeButtons = new Map<string, HTMLButtonElement>();
  for (const value of [
    "",
    ...Object.keys(annotationTypeLabels).filter((value) =>
      annotations.some((annotation) => annotation.type === value),
    ),
  ]) {
    const control = button(
      value
        ? annotationTypeLabel(value)
        : getString("whiteboard-annotation-all-types"),
    );
    control.dataset.type = value;
    control.addEventListener("click", () => {
      type = value;
      render();
    });
    types.append(control);
    typeButtons.set(value, control);
  }
  const palette = createAnnotationColorPicker(win, dialog, colors, () =>
    render(),
  );
  const availableColors = [
    ...new Set(annotations.map(annotationColor).filter(Boolean)),
  ];
  const resultCount = element("p", "ss-annotation-result-count");
  resultCount.setAttribute("role", "status");
  filterRow.append(types, palette.element, resultCount);
  const tools = element("div", "ss-annotation-tools");
  const tags = [
    ...new Set(annotations.flatMap((annotation) => annotation.tags || [])),
  ].sort((a, b) => a.localeCompare(b));
  if (tags.length) {
    const tagFilter = element("label", "ss-annotation-tag-filter");
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
    tagFilter.append(caption, select);
    tools.append(tagFilter);
  }
  filters.append(search, filterRow, tools);
  const list = element("div", "ss-annotation-results");
  const status = element("p", "ss-annotation-error");
  status.setAttribute("role", "alert");
  status.hidden = true;
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
  function render() {
    const needle = search.value.trim().toLocaleLowerCase();
    visible = annotations.flatMap((annotation, index) =>
      (!type || annotation.type === type) &&
      (!tag || annotation.tags?.includes(tag)) &&
      (!colors.size || colors.has(annotationColor(annotation))) &&
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
    for (const control of filters.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >("input, button, select"))
      control.disabled = busy;
    palette.sync(availableColors, busy);
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
        group.setAttribute("aria-label", annotation.attachmentTitle);
        groups.set(annotation.attachmentKey, group);
        list.append(group);
      }
      group.append(
        createAnnotationCard(doc, annotation, {
          checked: selected.has(index),
          disabled: busy,
          onChange(checked) {
            if (checked) selected.add(index);
            else selected.delete(index);
            updateSelection();
          },
        }),
      );
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
  }
  search.addEventListener("input", render);
  selectResults.addEventListener("click", () => {
    for (const index of visible) selected.add(index);
    render();
  });
  clear.addEventListener("click", () => {
    selected.clear();
    render();
  });
  const isCurrent = () =>
    !closed && dialog.isConnected && dialog.open && !win.closed;
  submit.addEventListener("click", async () => {
    if (busy || !selected.size) return;
    const chosen = annotations.filter((_, index) => selected.has(index));
    busy = true;
    palette.close();
    status.hidden = true;
    render();
    try {
      if (await create(chosen, isCurrent)) {
        if (isCurrent()) dialog.close();
      } else if (isCurrent()) {
        status.textContent = getString("annotation-export-failed");
        status.hidden = false;
      }
    } catch (error) {
      if (isCurrent()) {
        status.textContent = `${getString("annotation-export-failed")} ${String(error)}`;
        status.hidden = false;
      }
    } finally {
      if (isCurrent()) {
        busy = false;
        render();
      }
    }
  });
  const dispose = () => {
    if (closed) return;
    closed = true;
    dialog.removeEventListener("close", dispose);
    win.removeEventListener("unload", dispose);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (!win.closed && previous?.isConnected) previous.focus();
  };
  dialog.addEventListener("close", dispose, { once: true });
  win.addEventListener("unload", dispose, { once: true });
  dialog.append(style, header, filters, list, status, footer);
  doc.documentElement.append(dialog);
  render();
  dialog.showModal();
  search.focus();
}
