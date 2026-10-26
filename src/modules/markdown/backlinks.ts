import { getString } from "../../utils/locale";
import {
  chooseDocumentLinkCandidate,
  openDocumentLink,
} from "./document-links";
import {
  getNoteBacklinks,
  downloadNoteAttachment,
  bindNoteLibraryWindow,
  rebuildNoteLibrary,
  subscribeNoteLibrary,
  type NoteAttachmentDownloadResult,
  type NoteReadFailure,
} from "./note-library";
import type { PortableNote } from "./note-links";
import { createSidebarMotion } from "./sidebar-motion";
import { registerSidebarLayout, bindSidebarDismiss } from "./sidebar-layout";
import { mountSidebarResize } from "./sidebar-resize";
import {
  getOutgoingNoteReferences,
  type NoteReference,
} from "./note-references";

let referencePanelID = 0;

/** Keep sidebar visibility independent from the currently displayed note. */
export function mountBacklinksSidebar(
  root: HTMLElement,
  sidebar: HTMLElement,
  toggle: HTMLButtonElement,
  onLayoutChange?: () => void,
): () => void {
  let expanded: boolean | undefined;
  let visible = false;
  let occupiedWidth = 0;
  let previousWidth: number | undefined;
  let disposed = false;
  const motion = createSidebarMotion(sidebar, toggle, "right");
  const resize = mountSidebarResize(sidebar, {
    edge: "right",
    className: "zmd-backlinks-resize",
    variable: "--zmd-backlinks-width",
    min: 240,
    max: 440,
    initial: 300,
    label: getString("note-references-resize"),
    help: getString("note-references-resize-help"),
    focusFallback: toggle,
    beforeResize: () => motion.finish(),
    onResize: () => layout.sync(),
  });
  const layout = registerSidebarLayout(root, "right", {
    request(width) {
      return { width: resize.width, visible: expanded ?? width >= 1000 };
    },
    apply(state, animate) {
      if (previousWidth !== undefined && previousWidth !== state.rootWidth)
        motion.finish();
      previousWidth = state.rootWidth;
      visible = state.visible;
      resize.setEnabled(visible && !state.floating);
      motion.update(
        visible,
        () => {
          sidebar.hidden = !visible;
          sidebar.classList.toggle("is-floating", state.floating);
          toggle.setAttribute("aria-expanded", String(visible));
        },
        animate,
      );
      const nextOccupied = visible && !state.floating ? state.width : 0;
      if (occupiedWidth !== nextOccupied) onLayoutChange?.();
      occupiedWidth = nextOccupied;
    },
  });
  const onToggle = () => {
    expanded = !visible;
    layout?.sync(true);
    if (visible && sidebar.classList.contains("is-floating"))
      toggle.focus({ preventScroll: true });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    expanded = false;
    layout?.sync(true);
    toggle.focus();
    event.preventDefault();
    event.stopPropagation();
  };
  const unbindDismiss = bindSidebarDismiss(
    sidebar,
    toggle,
    getString("modal-close"),
    () => {
      expanded = false;
      layout.sync(true);
    },
  );
  if (sidebar.id) toggle.setAttribute("aria-controls", sidebar.id);
  toggle.addEventListener("click", onToggle);
  sidebar.addEventListener("keydown", onKeyDown);
  return () => {
    if (disposed) return;
    disposed = true;
    layout?.destroy();
    motion.destroy();
    resize.destroy();
    unbindDismiss();
    toggle.removeEventListener("click", onToggle);
    sidebar.removeEventListener("keydown", onKeyDown);
  };
}

/** The same saved-note backlinks panel is used by tabs, windows and the lab. */
export function mountNoteBacklinks(
  parent: HTMLElement,
  item: Zotero.Item,
  win: Window,
  options: {
    fullHeight?: boolean;
    onNavigateNote?: (
      note: PortableNote,
      heading?: string,
      position?: number,
    ) => boolean | Promise<boolean>;
    labels?: {
      title: string;
      refresh: string;
      loading: string;
      empty: string;
      incomplete: string;
      failed: string;
      failureSummary?: string;
      notDownloaded?: string;
      unavailable?: string;
      readError?: string;
      indexError?: string;
      locateNote?: string;
      moreFailures?: string;
      download?: string;
      downloadAll?: string;
      downloading?: string;
      downloadComplete?: string;
      downloadFailed?: string;
      downloadPending?: string;
      downloadUnavailable?: string;
      downloadSyncUnavailable?: string;
      downloadNotStarted?: string;
      downloadRetry?: string;
      referencesTitle?: string;
      outgoing?: string;
      incoming?: string;
      all?: string;
      literature?: string;
      notes?: string;
      attachments?: string;
      emptyOutgoing?: string;
      emptyFilter?: string;
      pendingReference?: string;
      unavailableReference?: string;
      referenceOccurrences?: string;
    };
  } = {},
): () => void {
  const labels: NonNullable<typeof options.labels> = options.labels ?? {
    title: getString("note-backlinks-title"),
    refresh: getString("note-backlinks-refresh"),
    loading: getString("note-backlinks-loading"),
    empty: getString("note-backlinks-empty"),
    incomplete: getString("note-backlinks-incomplete"),
    failed: getString("note-backlinks-failed"),
  };
  const referenceLabels = {
    title: labels.referencesTitle ?? getString("note-references-title"),
    outgoing: labels.outgoing ?? getString("note-references-outgoing"),
    incoming: labels.incoming ?? getString("note-references-incoming"),
    all: labels.all ?? getString("note-references-all"),
    literature: labels.literature ?? getString("note-references-literature"),
    note: labels.notes ?? getString("note-references-notes"),
    attachment: labels.attachments ?? getString("note-references-attachments"),
    emptyOutgoing:
      labels.emptyOutgoing ?? getString("note-references-empty-outgoing"),
    emptyFilter:
      labels.emptyFilter ?? getString("note-references-empty-filter"),
    pending: labels.pendingReference ?? getString("note-references-pending"),
    unavailable:
      labels.unavailableReference ?? getString("note-references-unavailable"),
    occurrences:
      labels.referenceOccurrences ?? getString("note-references-occurrences"),
  };
  const doc = parent.ownerDocument;
  const icon = (path: string) => {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({
      viewBox: "0 0 24 24",
      width: "16",
      height: "16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    }))
      svg.setAttribute(key, value);
    const shape = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", path);
    svg.append(shape);
    return svg;
  };
  const panel = doc.createElement("details");
  panel.className = "zmd-backlinks";
  panel.open = true;
  panel.style.cssText =
    "flex:0 1 auto;max-height:40%;min-height:34px;overflow:auto;padding:10px;border-top:1px solid var(--zmd-border,#d8dee8);font:inherit;color:inherit";
  if (options.fullHeight) {
    panel.style.maxHeight = "none";
    panel.style.borderTop = "0";
    panel.style.flex = "1 1 auto";
  }
  const summary = doc.createElement("summary");
  const heading = doc.createElement("span");
  heading.textContent = referenceLabels.title;
  const count = doc.createElement("span");
  count.className = "zmd-backlinks-count";
  summary.append(heading, count);
  summary.style.cursor = "pointer";
  const refresh = doc.createElement("button");
  refresh.type = "button";
  refresh.title = labels.refresh;
  refresh.setAttribute("aria-label", labels.refresh);
  const refreshIcon = doc.createElement("img");
  refreshIcon.src = "chrome://zotero/skin/16/universal/refresh.svg";
  refreshIcon.alt = "";
  refreshIcon.width = refreshIcon.height = 16;
  refresh.append(refreshIcon);
  refresh.className = "zmd-backlinks-refresh";
  summary.append(refresh);
  const status = doc.createElement("p");
  status.className = "zmd-backlinks-status";
  status.setAttribute("role", "status");
  status.style.cssText = "font-size:12px;white-space:pre-wrap";
  type Direction = "incoming" | "outgoing";
  type Filter = "all" | Exclude<NoteReference["category"], "unresolved">;
  let direction: Direction = "incoming";
  let filter: Filter = "all";
  let entries: NoteReference[] = [];
  const expandedGroups = new Set<string>();
  const controls = doc.createElement("div");
  controls.className = "zmd-reference-controls";
  controls.setAttribute("role", "tablist");
  controls.setAttribute("aria-label", referenceLabels.title);
  const directionButtons = new Map<Direction, HTMLButtonElement>();
  const panelID = `zmd-references-${++referencePanelID}`;
  for (const value of ["outgoing", "incoming"] as const) {
    const button = doc.createElement("button");
    button.type = "button";
    button.dataset.direction = value;
    button.setAttribute("role", "tab");
    button.id = `${panelID}-${value}`;
    button.setAttribute("aria-controls", panelID);
    button.textContent = referenceLabels[value];
    directionButtons.set(value, button);
    controls.append(button);
    button.onclick = () => setDirection(value);
    button.onkeydown = (event) => {
      if (downloading) return;
      const next =
        event.key === "ArrowLeft" || event.key === "Home"
          ? "outgoing"
          : event.key === "ArrowRight" || event.key === "End"
            ? "incoming"
            : undefined;
      if (!next) return;
      event.preventDefault();
      directionButtons.get(next)!.focus();
      setDirection(next);
    };
  }
  const filters = doc.createElement("div");
  filters.className = "zmd-reference-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", getString("note-references-filter"));
  const filterButtons = new Map<Filter, HTMLButtonElement>();
  for (const value of ["all", "literature", "note", "attachment"] as const) {
    const button = doc.createElement("button");
    button.type = "button";
    button.dataset.filter = value;
    filterButtons.set(value, button);
    filters.append(button);
    button.onclick = () => {
      filter = value;
      renderEntries();
    };
  }
  const failures = doc.createElement("details");
  failures.className = "zmd-backlinks-failures";
  failures.hidden = true;
  failures.style.cssText = "font-size:12px;margin:8px 0 12px";
  const failureSummary = doc.createElement("summary");
  const failureList = doc.createElement("ul");
  failureList.style.cssText = "list-style:none;padding:0;margin:8px 0";
  const downloadAll = doc.createElement("button");
  downloadAll.type = "button";
  downloadAll.className = "zmd-backlinks-download-all";
  downloadAll.hidden = true;
  const downloadStatus = doc.createElement("p");
  downloadStatus.className = "zmd-backlinks-download-status";
  downloadStatus.setAttribute("role", "status");
  downloadStatus.setAttribute("aria-atomic", "true");
  downloadStatus.hidden = true;
  const list = doc.createElement("div");
  list.className = "zmd-reference-list";
  list.id = panelID;
  list.setAttribute("role", "tabpanel");
  failures.append(failureSummary, downloadStatus, downloadAll, failureList);
  panel.append(summary, controls, filters, status, list, failures);
  parent.append(panel);
  let disposed = false;
  let generation = 0;
  let currentFailures: readonly NoteReadFailure[] = [];
  let downloading = false;
  let downloadingKey: string | undefined;
  type DownloadProblem =
    Exclude<NoteAttachmentDownloadResult, "available"> | "error";
  const downloadProblems = new Map<string, DownloadProblem>();
  const downloadLabels = {
    download: labels.download ?? getString("note-backlinks-download"),
    all: labels.downloadAll ?? getString("note-backlinks-download-all"),
    busy: labels.downloading ?? getString("note-backlinks-downloading"),
    complete:
      labels.downloadComplete ?? getString("note-backlinks-download-complete"),
    failed:
      labels.downloadFailed ?? getString("note-backlinks-download-failed"),
    pending:
      labels.downloadPending ?? getString("note-backlinks-download-pending"),
    retry: labels.downloadRetry ?? getString("note-backlinks-download-retry"),
    problems: {
      "not-available":
        labels.downloadUnavailable ??
        getString("note-backlinks-download-unavailable"),
      "sync-unavailable":
        labels.downloadSyncUnavailable ??
        getString("note-backlinks-download-sync-unavailable"),
      "not-started":
        labels.downloadNotStarted ??
        getString("note-backlinks-download-not-started"),
    },
  };

  const failureLabel = (reason: NoteReadFailure["reason"]) => {
    if (reason === "not-downloaded")
      return labels.notDownloaded ?? getString("note-backlinks-not-downloaded");
    if (reason === "unavailable")
      return labels.unavailable ?? getString("note-backlinks-unavailable");
    if (reason === "index-error")
      return labels.indexError ?? getString("note-backlinks-index-error");
    return labels.readError ?? getString("note-backlinks-read-error");
  };

  const renderFailures = (values: readonly NoteReadFailure[]) => {
    currentFailures = values;
    const downloadable = values.filter((failure) => failure.canDownload);
    downloadAll.hidden = downloadable.length === 0;
    downloadAll.disabled = downloading;
    downloadAll.textContent = `${downloadLabels.all} (${downloadable.length})`;
    failures.hidden = values.length === 0;
    failureList.replaceChildren();
    failureSummary.textContent = `${
      labels.failureSummary ?? getString("note-backlinks-failure-summary")
    } (${values.length})`;
    const api = (globalThis as { Zotero?: any }).Zotero;
    const pane =
      (win as _ZoteroTypes.MainWindow).ZoteroPane ||
      api?.getActiveZoteroPane?.();
    const canLocate =
      typeof pane?.selectItem === "function" &&
      typeof api?.Items?.getByLibraryAndKey === "function";
    for (const failure of values.slice(0, 10)) {
      const row = doc.createElement("li");
      row.style.marginBlock = "6px";
      const title = doc.createElement(canLocate ? "button" : "span");
      title.textContent = failure.title;
      if (title.tagName.toLowerCase() === "button") {
        const button = title as HTMLButtonElement;
        button.type = "button";
        button.title =
          labels.locateNote ?? getString("note-backlinks-locate-note");
        button.dataset.noteKey = failure.key;
        button.style.cssText =
          "padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:start;text-decoration:underline;cursor:pointer;overflow-wrap:anywhere";
        button.onclick = () => {
          if (disposed) return;
          void (async () => {
            const source = api?.Items?.getByLibraryAndKey?.(
              item.libraryID,
              failure.key,
            );
            if (source && !disposed) await pane.selectItem(source.id);
          })().catch(() => {
            if (!disposed) status.textContent = labels.failed;
          });
        };
      }
      const detail = doc.createElement("div");
      detail.className = "zmd-backlinks-failure-detail";
      const reason = doc.createElement("span");
      reason.className = "zmd-backlinks-failure-reason";
      const problem = downloadProblems.get(failure.key);
      reason.textContent =
        problem === "error"
          ? downloadLabels.failed
          : problem
            ? downloadLabels.problems[problem]
            : failureLabel(failure.reason);
      detail.append(reason);
      if (failure.canDownload) {
        const download = doc.createElement("button");
        download.type = "button";
        download.className = "zmd-backlinks-download";
        download.dataset.downloadKey = failure.key;
        download.disabled = downloading;
        const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("width", "14");
        icon.setAttribute("height", "14");
        icon.setAttribute("fill", "none");
        icon.setAttribute("stroke", "currentColor");
        icon.setAttribute("stroke-width", "1.8");
        icon.setAttribute("stroke-linecap", "round");
        icon.setAttribute("stroke-linejoin", "round");
        icon.setAttribute("aria-hidden", "true");
        icon.setAttribute("focusable", "false");
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4");
        icon.append(path);
        const label = doc.createElement("span");
        label.textContent =
          downloadingKey === failure.key
            ? downloadLabels.busy
            : problem
              ? downloadLabels.retry
              : downloadLabels.download;
        download.append(icon, label);
        download.onclick = () => void downloadNotes([failure]);
        detail.append(download);
      }
      row.append(title, detail);
      failureList.append(row);
    }
    if (values.length > 10) {
      const more = doc.createElement("li");
      more.textContent = `${labels.moreFailures ?? getString("note-backlinks-more-failures")} (${values.length - 10})`;
      failureList.append(more);
    }
  };

  async function downloadNotes(values: readonly NoteReadFailure[]) {
    if (disposed || downloading) return;
    const targets = values.filter((failure) => failure.canDownload);
    if (!targets.length) return;
    downloading = true;
    syncControls();
    refresh.disabled = true;
    downloadStatus.hidden = false;
    downloadStatus.classList.remove("is-error");
    for (const target of targets) downloadProblems.delete(target.key);
    let completed = 0;
    let failed = 0;
    let hasError = false;
    try {
      for (const [index, target] of targets.entries()) {
        if (disposed) break;
        downloadingKey = target.key;
        downloadStatus.textContent = `${downloadLabels.busy} (${index + 1}/${targets.length})`;
        renderFailures(currentFailures);
        let result: NoteAttachmentDownloadResult | "error";
        try {
          result = await downloadNoteAttachment(item.libraryID, target.key);
        } catch (error) {
          result = "error";
          Zotero.logError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        if (disposed) break;
        if (result === "available") completed++;
        else {
          failed++;
          hasError ||= result === "error";
          downloadProblems.set(target.key, result);
        }
      }
    } finally {
      downloading = false;
      downloadingKey = undefined;
      if (!disposed) {
        downloadStatus.classList.toggle("is-error", hasError);
        downloadStatus.textContent = [
          completed ? `${downloadLabels.complete} (${completed})` : "",
          failed ? `${downloadLabels.pending} (${failed})` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        await render();
      }
    }
  }
  downloadAll.onclick = () => void downloadNotes(currentFailures);

  function syncControls() {
    for (const [value, button] of directionButtons) {
      button.disabled = downloading;
      button.setAttribute("aria-selected", String(direction === value));
      button.tabIndex = direction === value ? 0 : -1;
    }
    filters.hidden = direction !== "outgoing";
    list.setAttribute("aria-labelledby", directionButtons.get(direction)!.id);
  }

  function setDirection(value: Direction) {
    if (disposed || downloading || direction === value) return;
    clearRenderedEntries();
    direction = value;
    entries = [];
    count.textContent = "";
    renderFailures([]);
    downloadStatus.hidden = true;
    void render();
  }

  function navigate(
    occurrence: NoteReference["occurrences"][number],
    from: Direction,
  ) {
    const current = generation;
    let choiceCancelled = false;
    void openDocumentLink(occurrence.href, {
      currentItem: item,
      win,
      ...(from === "incoming" ? { position: occurrence.position } : {}),
      onNavigateNote: options.onNavigateNote,
      chooseCandidate: async (candidates) => {
        const selected = await chooseDocumentLinkCandidate(candidates, win);
        choiceCancelled = !selected;
        return selected;
      },
    })
      .then((result) => {
        if (disposed || current !== generation || choiceCancelled) return;
        if (
          result.status !== "opened" &&
          !(
            from === "outgoing" &&
            (result.status === "external" || result.status === "dispatched")
          )
        )
          status.textContent = labels.failed;
      })
      .catch(() => {
        if (!disposed && current === generation)
          status.textContent = labels.failed;
      });
  }

  function clearRenderedEntries() {
    const active = doc.activeElement as HTMLElement | null;
    const groups = [
      ...list.querySelectorAll<HTMLElement>("[data-reference-id]"),
    ];
    const group =
      active && list.contains(active)
        ? active.closest<HTMLElement>("[data-reference-id]")
        : null;
    const focus =
      group && active
        ? {
            id: group.dataset.referenceId,
            index: groups.indexOf(group),
            position: active.dataset.position,
            occurrence: [
              ...group.querySelectorAll(".zmd-reference-occurrence"),
            ].indexOf(active),
          }
        : undefined;
    for (const row of list.querySelectorAll<HTMLDetailsElement>(
      "details[data-reference-id]",
    )) {
      const key = `${direction}:${row.dataset.referenceId}`;
      if (row.open) expandedGroups.add(key);
      else expandedGroups.delete(key);
    }
    list.replaceChildren();
    return focus;
  }

  function restoreReferenceFocus(
    focus: ReturnType<typeof clearRenderedEntries>,
  ) {
    if (!focus) return;
    const groups = [
      ...list.querySelectorAll<HTMLElement>("[data-reference-id]"),
    ];
    const group =
      groups.find((row) => row.dataset.referenceId === focus.id) ||
      groups[Math.min(focus.index, groups.length - 1)];
    const occurrences = group?.matches("details[open]")
      ? [...group.querySelectorAll<HTMLElement>(".zmd-reference-occurrence")]
      : [];
    const occurrence =
      focus.occurrence >= 0 && group?.dataset.referenceId === focus.id
        ? occurrences.find((row) => row.dataset.position === focus.position) ||
          occurrences[Math.min(focus.occurrence, occurrences.length - 1)]
        : undefined;
    const target =
      occurrence ||
      group?.querySelector<HTMLElement>(".zmd-reference-open") ||
      (downloading ? summary : directionButtons.get(direction)!);
    target.focus({ preventScroll: true });
  }

  function renderEntries() {
    const focus = clearRenderedEntries();
    const visible =
      direction === "incoming" || filter === "all"
        ? entries
        : entries.filter((entry) => entry.category === filter);
    count.textContent = `(${visible.length})`;
    for (const [value, button] of filterButtons) {
      const total =
        value === "all"
          ? entries.length
          : entries.filter((entry) => entry.category === value).length;
      button.textContent = `${referenceLabels[value]} ${total}`;
      button.setAttribute("aria-pressed", String(filter === value));
    }
    status.textContent = visible.length
      ? ""
      : direction === "incoming"
        ? labels.empty
        : filter !== "all" && entries.length
          ? referenceLabels.emptyFilter
          : referenceLabels.emptyOutgoing;
    const from = direction;
    for (const entry of visible) {
      const multiple = entry.occurrences.length > 1;
      const row = doc.createElement(multiple ? "details" : "article");
      row.className = "zmd-reference-group";
      row.dataset.referenceId = entry.id;
      if (multiple)
        (row as HTMLDetailsElement).open = expandedGroups.has(
          `${from}:${entry.id}`,
        );
      const header = doc.createElement(multiple ? "summary" : "button");
      header.className = "zmd-reference-open";
      if (!multiple) {
        const button = header as HTMLButtonElement;
        button.type = "button";
        button.onclick = () => navigate(entry.occurrences[0], from);
      }
      const titleRow = doc.createElement("span");
      titleRow.className = "zmd-reference-heading";
      if (entry.candidate?.icon) {
        const image = doc.createElement("img");
        image.src = entry.candidate.icon;
        image.alt = "";
        image.width = image.height = 16;
        titleRow.append(image);
      } else {
        titleRow.append(
          icon(
            entry.category === "unresolved"
              ? "M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2"
              : "M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6",
          ),
        );
      }
      const title = doc.createElement("span");
      title.className = "zmd-reference-title";
      title.textContent = entry.title || referenceLabels.unavailable;
      title.title = title.textContent;
      titleRow.append(title);
      const meta = doc.createElement("span");
      meta.className = "zmd-reference-meta";
      meta.textContent = [
        entry.status === "pending"
          ? referenceLabels.pending
          : entry.status === "unavailable"
            ? referenceLabels.unavailable
            : entry.candidate?.kindLabel || "Markdown",
        entry.candidate?.author,
        multiple
          ? `${entry.occurrences.length} ${referenceLabels.occurrences}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const excerpt = doc.createElement("span");
      excerpt.className = "zmd-reference-excerpt";
      excerpt.textContent = entry.occurrences[0]?.excerpt || "";
      header.append(titleRow, meta, excerpt);
      row.append(header);
      if (multiple) {
        const occurrences = doc.createElement("div");
        occurrences.className = "zmd-reference-occurrences";
        for (const [index, occurrence] of entry.occurrences.entries()) {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "zmd-reference-occurrence";
          button.dataset.position = String(occurrence.position);
          const ordinal = doc.createElement("span");
          ordinal.className = "zmd-reference-ordinal";
          ordinal.textContent = String(index + 1);
          const text = doc.createElement("span");
          text.textContent =
            occurrence.excerpt || entry.title || referenceLabels.pending;
          button.append(ordinal, text);
          button.onclick = () => navigate(occurrence, from);
          occurrences.append(button);
        }
        row.append(occurrences);
      }
      list.append(row);
    }
    restoreReferenceFocus(focus);
  }

  async function render() {
    const current = ++generation;
    refresh.disabled = true;
    for (const button of filterButtons.values()) button.disabled = true;
    syncControls();
    list.setAttribute("aria-busy", "true");
    status.textContent = labels.loading;
    try {
      let nextEntries: NoteReference[];
      let nextFailures: NoteReadFailure[];
      if (direction === "outgoing") {
        const result = await getOutgoingNoteReferences(item);
        nextEntries = result.entries;
        nextFailures = result.failure ? [result.failure] : [];
      } else {
        const result = await getNoteBacklinks(item);
        const groups = new Map<string, NoteReference>();
        for (const entry of result.entries) {
          const id = `${entry.libraryID}/${entry.key}`;
          let group = groups.get(id);
          if (!group) {
            group = {
              id,
              title: entry.title,
              category: "note",
              status: "resolved",
              occurrences: [],
            };
            groups.set(id, group);
          }
          group.occurrences.push({
            href: entry.href,
            position: entry.position,
            excerpt: entry.excerpt,
          });
        }
        nextEntries = [...groups.values()];
        nextFailures = result.failures;
      }
      if (disposed || current !== generation) return;
      entries = nextEntries;
      renderFailures(nextFailures);
      renderEntries();
    } catch (error) {
      if (!disposed && current === generation) {
        entries = [];
        const focus = clearRenderedEntries();
        count.textContent = "";
        renderFailures([]);
        status.textContent = labels.failed;
        restoreReferenceFocus(focus);
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    } finally {
      if (!disposed && current === generation) {
        list.setAttribute("aria-busy", "false");
        refresh.disabled = downloading;
        for (const button of filterButtons.values()) button.disabled = false;
        syncControls();
      }
    }
  }
  const unbindWindow = bindNoteLibraryWindow(win);
  const unsubscribe = subscribeNoteLibrary((libraryID) => {
    if (libraryID === item.libraryID) void render();
  });
  refresh.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (disposed || downloading) return;
    downloadProblems.clear();
    downloadStatus.hidden = true;
    if (direction === "outgoing") {
      void render();
      return;
    }
    const current = generation;
    refresh.disabled = true;
    void rebuildNoteLibrary(item.libraryID).catch((error) => {
      if (!disposed && current === generation) {
        status.textContent = `${labels.failed}: ${String(error)}`;
        refresh.disabled = false;
      }
    });
  };
  void render();
  return () => {
    disposed = true;
    generation++;
    unsubscribe();
    unbindWindow();
    panel.remove();
  };
}
