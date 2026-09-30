import { getString } from "../../utils/locale";
import { openDocumentLink } from "./document-links";
import {
  getNoteBacklinks,
  bindNoteLibraryWindow,
  rebuildNoteLibrary,
  subscribeNoteLibrary,
} from "./note-library";
import type { PortableNote } from "./note-links";

/** Keep sidebar visibility independent from the currently displayed note. */
export function mountBacklinksSidebar(
  root: HTMLElement,
  sidebar: HTMLElement,
  toggle: HTMLButtonElement,
  onLayoutChange?: () => void,
): () => void {
  let expanded: boolean | undefined;
  const sync = () => {
    const width = root.getBoundingClientRect().width || root.clientWidth;
    const narrow = width > 0 && width < 1000;
    const visible = expanded ?? !narrow;
    if (!visible && sidebar.contains(sidebar.ownerDocument.activeElement))
      toggle.focus();
    sidebar.hidden = !visible;
    sidebar.classList.toggle("is-floating", narrow);
    toggle.setAttribute("aria-expanded", String(visible));
    sidebar.setAttribute("aria-hidden", String(!visible));
    onLayoutChange?.();
  };
  const onToggle = () => {
    expanded = sidebar.hidden === true;
    sync();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    expanded = false;
    sync();
    toggle.focus();
    event.preventDefault();
  };
  if (sidebar.id) toggle.setAttribute("aria-controls", sidebar.id);
  toggle.addEventListener("click", onToggle);
  sidebar.addEventListener("keydown", onKeyDown);
  const ResizeObserverCtor = root.ownerDocument.defaultView?.ResizeObserver;
  const observer = ResizeObserverCtor ? new ResizeObserverCtor(sync) : null;
  observer?.observe(root);
  sync();
  return () => {
    observer?.disconnect();
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
    };
  } = {},
): () => void {
  const labels = options.labels ?? {
    title: getString("note-backlinks-title"),
    refresh: getString("note-backlinks-refresh"),
    loading: getString("note-backlinks-loading"),
    empty: getString("note-backlinks-empty"),
    incomplete: getString("note-backlinks-incomplete"),
    failed: getString("note-backlinks-failed"),
  };
  const doc = parent.ownerDocument;
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
  heading.textContent = labels.title;
  const count = doc.createElement("span");
  count.className = "zmd-backlinks-count";
  summary.append(heading, count);
  summary.style.cursor = "pointer";
  const refresh = doc.createElement("button");
  refresh.type = "button";
  refresh.textContent = labels.refresh;
  refresh.className = "zmd-backlinks-refresh";
  summary.append(refresh);
  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  status.style.cssText = "font-size:12px;white-space:pre-wrap";
  const list = doc.createElement("div");
  panel.append(summary, status, list);
  parent.append(panel);
  let disposed = false;
  let generation = 0;

  async function render() {
    const current = ++generation;
    refresh.disabled = true;
    status.textContent = labels.loading;
    try {
      const result = await getNoteBacklinks(item);
      if (disposed || current !== generation) return;
      list.replaceChildren();
      count.textContent = `(${result.entries.length})`;
      status.textContent = result.unreadable
        ? `${labels.incomplete} (${result.unreadable})`
        : result.entries.length
          ? ""
          : labels.empty;
      for (const entry of result.entries) {
        const button = doc.createElement("button");
        button.type = "button";
        button.title = entry.filename;
        button.style.cssText =
          "display:block;width:100%;text-align:start;padding:8px 0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow-wrap:anywhere";
        const title = doc.createElement("strong");
        title.textContent = entry.title;
        const excerpt = doc.createElement("span");
        excerpt.textContent = entry.excerpt;
        excerpt.style.cssText = "display:block;font-size:12px;opacity:.75";
        button.append(title, excerpt);
        button.onclick = () => {
          void openDocumentLink(entry.href, {
            currentItem: item,
            win,
            position: entry.position,
            onNavigateNote: options.onNavigateNote,
          })
            .then((result) => {
              if (!disposed && result.status !== "opened")
                status.textContent = labels.failed;
            })
            .catch((error) => {
              if (!disposed)
                status.textContent = `${labels.failed}: ${String(error)}`;
            });
        };
        list.append(button);
      }
    } catch (error) {
      if (!disposed && current === generation) {
        list.replaceChildren();
        status.textContent = `${labels.failed}: ${String(error)}`;
      }
    } finally {
      if (!disposed && current === generation) refresh.disabled = false;
    }
  }
  const unbindWindow = bindNoteLibraryWindow(win);
  const unsubscribe = subscribeNoteLibrary((libraryID) => {
    if (libraryID === item.libraryID) void render();
  });
  refresh.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    refresh.disabled = true;
    void rebuildNoteLibrary(item.libraryID).catch((error) => {
      if (!disposed) {
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
