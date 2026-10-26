import type { EditorOutlineItem } from "./editor-protocol";
import { createSidebarMotion } from "./sidebar-motion";
import { registerSidebarLayout, bindSidebarDismiss } from "./sidebar-layout";
import { mountSidebarResize } from "./sidebar-resize";
import { getString } from "../../utils/locale";

export const OUTLINE_AUTO_HIDE_WIDTH = 680;

export function outlineIndentPx(level: number): number {
  return Math.min(44, 8 + (Math.max(1, level) - 1) * 12);
}

export function outlineVisibleAtWidth(
  expanded: boolean,
  width: number,
): boolean {
  return expanded && width >= OUTLINE_AUTO_HIDE_WIDTH;
}

export function outlineItemNeedsReveal(
  item: { top: number; bottom: number },
  viewport: { top: number; bottom: number },
): boolean {
  return item.top < viewport.top || item.bottom > viewport.bottom;
}

export interface OutlineSidebarHandle {
  update(items: readonly EditorOutlineItem[], activeID: string | null): void;
  setActive(activeID: string | null): void;
  setExpanded(expanded: boolean): void;
  isVisible(): boolean;
  destroy(): void;
}

export function mountOutlineSidebar(options: {
  root: HTMLElement;
  sidebar: HTMLElement;
  list: HTMLElement;
  toolbarToggle: HTMLButtonElement;
  emptyLabel: string;
  getExpanded: () => boolean;
  onExpandedChange: (expanded: boolean) => void;
  onNavigate: (item: EditorOutlineItem) => void;
  onLayoutChange?: () => void;
}): OutlineSidebarHandle {
  const {
    root,
    sidebar,
    list,
    toolbarToggle,
    emptyLabel,
    getExpanded,
    onExpandedChange,
    onNavigate,
  } = options;
  let itemsByID = new Map<string, EditorOutlineItem>();
  let activeID: string | null = null,
    focusedID: string | null = null;
  let explicitExpanded: boolean | undefined, previousWidth: number | undefined;
  let visible = false,
    occupiedWidth = 0,
    disposed = false;
  const collapsed = new Set<string>();
  let sectionKeys = new Map<string, string>();
  const motion = createSidebarMotion(sidebar, toolbarToggle, "left");
  const resize = mountSidebarResize(sidebar, {
    edge: "left",
    className: "zmd-outline-resize",
    variable: "--zmd-outline-width",
    min: 180,
    max: 360,
    initial: 220,
    label: getString("markdown-outline-resize"),
    help: getString("markdown-outline-resize-help"),
    focusFallback: toolbarToggle,
    beforeResize: () => motion.finish(),
    onResize: () => layout.sync(),
  });
  const allRows = () => [
    ...list.querySelectorAll<HTMLElement>("[data-outline-id]"),
  ];
  const visibleRows = () => allRows().filter((row) => !row.closest("[hidden]"));
  const syncTabStop = () => {
    const rows = visibleRows();
    const preferred =
      rows.find((row) => row.dataset.outlineId === focusedID) ||
      rows.find((row) => row.dataset.outlineId === activeID) ||
      rows[0];
    for (const row of allRows()) row.tabIndex = row === preferred ? 0 : -1;
  };
  const syncActive = () => {
    let activeElement: HTMLElement | undefined;
    for (const row of allRows()) {
      const active = row.dataset.outlineId === activeID;
      row.classList.toggle("is-active", active);
      if (active) {
        row.setAttribute("aria-current", "location");
        activeElement = row;
      } else row.removeAttribute("aria-current");
    }
    syncTabStop();
    if (
      activeElement &&
      visible &&
      !activeElement.closest("[hidden]") &&
      activeElement.isConnected &&
      outlineItemNeedsReveal(
        activeElement.firstElementChild!.getBoundingClientRect(),
        list.getBoundingClientRect(),
      )
    )
      activeElement.scrollIntoView({ block: "nearest" });
  };
  const layout = registerSidebarLayout(root, "left", {
    request(width) {
      return {
        width: resize.width,
        visible:
          explicitExpanded ?? outlineVisibleAtWidth(getExpanded(), width),
      };
    },
    apply(state, animate) {
      if (previousWidth !== undefined && previousWidth !== state.rootWidth)
        motion.finish();
      previousWidth = state.rootWidth;
      const changed = visible !== state.visible;
      visible = state.visible;
      resize.setEnabled(visible && !state.floating);
      motion.update(
        visible,
        () => {
          sidebar.hidden = !visible;
          sidebar.classList.toggle("is-floating", state.floating);
          root.classList.toggle("is-outline-collapsed", !visible);
          root.classList.remove("is-outline-auto-hidden");
          toolbarToggle.setAttribute("aria-expanded", String(visible));
        },
        animate,
      );
      const nextOccupied = visible && !state.floating ? state.width : 0;
      if (occupiedWidth !== nextOccupied) options.onLayoutChange?.();
      occupiedWidth = nextOccupied;
      if (visible && changed) syncActive();
    },
  });
  list.setAttribute("role", "tree");
  if (sidebar.id) toolbarToggle.setAttribute("aria-controls", sidebar.id);
  const focusRow = (row: HTMLElement | null | undefined) => {
    if (!row) return;
    focusedID = row.dataset.outlineId!;
    syncTabStop();
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest" });
  };
  const toggleSection = (row: HTMLElement, expand: boolean) => {
    const group = [...row.children].find(
      (child) => child.getAttribute("role") === "group",
    ) as HTMLElement | undefined;
    if (!group) return;
    const id = sectionKeys.get(row.dataset.outlineId!)!;
    if (expand) collapsed.delete(id);
    else collapsed.add(id);
    row.setAttribute("aria-expanded", String(expand));
    group.hidden = !expand;
    syncTabStop();
  };
  const update = (
    items: readonly EditorOutlineItem[],
    nextActiveID: string | null,
  ) => {
    if (disposed) return;
    const previousRows = visibleRows(),
      previousFocus = previousRows.find(
        (row) => row === list.ownerDocument.activeElement,
      );
    const previousIndex = previousFocus
      ? previousRows.indexOf(previousFocus)
      : -1;
    if (previousFocus) focusedID = previousFocus.dataset.outlineId!;
    const focusedSection = focusedID ? sectionKeys.get(focusedID) : undefined;
    itemsByID = new Map(items.map((item) => [item.id, item]));
    sectionKeys = new Map();
    activeID = nextActiveID;
    list.replaceChildren();
    if (!items.length) {
      const empty = list.ownerDocument.createElement("div");
      empty.className = "zotero-markdown-outline-empty";
      empty.textContent = emptyLabel;
      list.append(empty);
      if (previousFocus) toolbarToggle.focus();
      return;
    }
    const stack: {
      level: number;
      key: string;
      row: HTMLElement;
      group: HTMLElement;
      counts: Map<string, number>;
    }[] = [];
    const rootCounts = new Map<string, number>();
    for (const item of items) {
      while (stack.length && stack.at(-1)!.level >= item.level) stack.pop();
      const parent = stack.at(-1);
      // Protocol IDs include offsets. A section path survives ordinary edits
      // before the heading; sibling occurrences distinguish repeated titles.
      const name = JSON.stringify([item.level, item.text]);
      const counts = parent?.counts || rootCounts;
      const occurrence = counts.get(name) || 0;
      counts.set(name, occurrence + 1);
      const key = `${parent?.key || ""}/${name}:${occurrence}`;
      sectionKeys.set(item.id, key);
      if (parent) {
        parent.row.setAttribute(
          "aria-expanded",
          String(!collapsed.has(parent.key)),
        );
        parent.group.hidden = collapsed.has(parent.key);
        parent.row.classList.add("has-children");
      }
      const row = list.ownerDocument.createElement("div");
      row.className = "zotero-markdown-outline-item";
      row.dataset.outlineId = item.id;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(stack.length + 1));
      row.setAttribute("aria-label", item.text);
      row.tabIndex = -1;
      const header = list.ownerDocument.createElement("div");
      header.className = "zmd-outline-row";
      header.style.paddingInlineStart = `${outlineIndentPx(stack.length + 1)}px`;
      header.title = item.text;
      const disclosure = list.ownerDocument.createElement("span");
      disclosure.className = "zmd-outline-disclosure";
      disclosure.dataset.outlineToggle = "true";
      disclosure.setAttribute("aria-hidden", "true");
      const label = list.ownerDocument.createElement("span");
      label.className = "zmd-outline-label";
      label.textContent = item.text;
      header.append(disclosure, label);
      const group = list.ownerDocument.createElement("div");
      group.setAttribute("role", "group");
      row.append(header, group);
      (parent?.group || list).append(row);
      stack.push({ level: item.level, key, row, group, counts: new Map() });
    }
    const presentSections = new Set(sectionKeys.values());
    for (const key of collapsed)
      if (!presentSections.has(key)) collapsed.delete(key);
    if (focusedSection)
      focusedID =
        [...sectionKeys].find(([, key]) => key === focusedSection)?.[0] ||
        focusedID;
    syncActive();
    if (previousFocus) {
      const rows = visibleRows();
      focusRow(
        rows.find((row) => row.dataset.outlineId === focusedID) ||
          rows[Math.min(previousIndex, rows.length - 1)],
      );
    }
  };
  const targetRow = (target: EventTarget | null) =>
    (target as Element | null)?.closest?.(
      "[data-outline-id]",
    ) as HTMLElement | null;
  const navigate = (row: HTMLElement) => {
    const item = itemsByID.get(row.dataset.outlineId!);
    if (item) onNavigate(item);
  };
  const onListClick = (event: MouseEvent) => {
    const row = targetRow(event.target);
    if (!row) return;
    focusRow(row);
    if (
      (event.target as Element).closest("[data-outline-toggle]") &&
      row.hasAttribute("aria-expanded")
    )
      toggleSection(row, row.getAttribute("aria-expanded") !== "true");
    else navigate(row);
  };
  const onListKeyDown = (event: KeyboardEvent) => {
    const row = targetRow(event.target);
    if (!row) return;
    const rows = visibleRows(),
      index = rows.indexOf(row);
    switch (event.key) {
      case "ArrowDown":
        focusRow(rows[Math.min(index + 1, rows.length - 1)]);
        break;
      case "ArrowUp":
        focusRow(rows[Math.max(index - 1, 0)]);
        break;
      case "Home":
        focusRow(rows[0]);
        break;
      case "End":
        focusRow(rows.at(-1));
        break;
      case "ArrowRight":
        if (row.getAttribute("aria-expanded") === "false")
          toggleSection(row, true);
        else if (row.getAttribute("aria-expanded") === "true")
          focusRow(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (row.getAttribute("aria-expanded") === "true")
          toggleSection(row, false);
        else
          focusRow(
            row.parentElement?.closest<HTMLElement>("[data-outline-id]"),
          );
        break;
      case "Enter":
      case " ":
        navigate(row);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const onFocus = (event: FocusEvent) => {
    const row = targetRow(event.target);
    if (row) {
      focusedID = row.dataset.outlineId!;
      syncTabStop();
    }
  };
  const onToolbarToggle = () => {
    onExpandedChange(!visible);
    if (visible && sidebar.classList.contains("is-floating"))
      toolbarToggle.focus({ preventScroll: true });
  };
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    onExpandedChange(false);
    toolbarToggle.focus();
    event.preventDefault();
    event.stopPropagation();
  };
  const unbindDismiss = bindSidebarDismiss(
    sidebar,
    toolbarToggle,
    getString("modal-close"),
    () => onExpandedChange(false),
  );
  list.addEventListener("click", onListClick);
  list.addEventListener("keydown", onListKeyDown);
  list.addEventListener("focusin", onFocus);
  sidebar.addEventListener("keydown", onEscape);
  toolbarToggle.addEventListener("click", onToolbarToggle);
  return {
    update,
    setActive(nextID) {
      activeID = nextID;
      syncActive();
    },
    setExpanded(expanded) {
      explicitExpanded = expanded;
      layout?.sync(true);
    },
    isVisible: () => visible,
    destroy() {
      if (disposed) return;
      disposed = true;
      layout?.destroy();
      motion.destroy();
      resize.destroy();
      unbindDismiss();
      list.removeEventListener("click", onListClick);
      list.removeEventListener("keydown", onListKeyDown);
      list.removeEventListener("focusin", onFocus);
      sidebar.removeEventListener("keydown", onEscape);
      toolbarToggle.removeEventListener("click", onToolbarToggle);
      itemsByID.clear();
    },
  };
}
