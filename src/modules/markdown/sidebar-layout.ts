type Edge = "left" | "right";
interface SidebarState {
  visible: boolean;
  width: number;
  floating: boolean;
  rootWidth: number;
}
interface Participant {
  request(rootWidth: number): { visible: boolean; width: number };
  apply(state: SidebarState, animate: boolean): void;
  previous?: SidebarState;
}

const layouts = new WeakMap<
  HTMLElement,
  {
    participants: Map<Edge, Participant>;
    observer?: ResizeObserver;
    sync(animatedEdge?: Edge): void;
  }
>();

/** Both host sidebars share one width budget; explicit visibility is never revoked. */
export function registerSidebarLayout(
  root: HTMLElement,
  edge: Edge,
  participant: Participant,
) {
  let layout = layouts.get(root);
  if (!layout) {
    const participants = new Map<Edge, Participant>();
    const sync = (animatedEdge?: Edge) => {
      const rootWidth =
        root.getBoundingClientRect().width || root.clientWidth || 1280;
      let available = rootWidth;
      const updates: [Edge, Participant, SidebarState][] = [];
      // The document outline gets the first dock. References become an overlay
      // when docking both would leave too little room for writing.
      for (const side of ["left", "right"] as const) {
        const entry = participants.get(side);
        if (!entry) continue;
        const requested = entry.request(rootWidth);
        const floating = available - requested.width < 520;
        if (requested.visible && !floating) available -= requested.width;
        updates.push([side, entry, { ...requested, floating, rootWidth }]);
      }
      for (const [side, entry, state] of updates) {
        const previous = entry.previous;
        if (
          previous &&
          state.visible === previous.visible &&
          state.width === previous.width &&
          state.floating === previous.floating &&
          state.rootWidth === previous.rootWidth
        )
          continue;
        entry.previous = state;
        entry.apply(state, side === animatedEdge);
      }
    };
    const Observer = root.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(() => sync()) : undefined;
    observer?.observe(root);
    layout = { participants, observer, sync };
    layouts.set(root, layout);
  }
  layout.participants.set(edge, participant);
  layout.sync();
  let disposed = false;
  return {
    sync(animate = false) {
      if (!disposed) layout.sync(animate ? edge : undefined);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      layout.participants.delete(edge);
      if (layout.participants.size) layout.sync();
      else {
        layout.observer?.disconnect();
        layouts.delete(root);
      }
    },
  };
}

/** Floating panels cover their toolbar trigger, so keep a visible way back. */
export function bindSidebarDismiss(
  sidebar: HTMLElement,
  toggle: HTMLElement,
  label: string,
  onClose: () => void,
): () => void {
  const doc = sidebar.ownerDocument;
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "zmd-sidebar-close";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = "×";
  sidebar.prepend(button);
  const floating = () =>
    !sidebar.hidden && sidebar.classList.contains("is-floating");
  const close = () => {
    if (!floating()) return;
    onClose();
    toggle.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing || !floating()) return;
    if (
      !toggle.contains(event.target as Node) &&
      !sidebar.contains(event.target as Node)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onPointer = (event: PointerEvent) => {
    if (
      floating() &&
      !sidebar.contains(event.target as Node) &&
      !toggle.contains(event.target as Node)
    )
      onClose();
  };
  // Input events inside the editor iframe cannot bubble to the host document.
  const onBlur = () => {
    if (floating()) onClose();
  };
  button.addEventListener("click", close);
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("pointerdown", onPointer);
  doc.defaultView?.addEventListener("blur", onBlur);
  return () => {
    button.removeEventListener("click", close);
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("pointerdown", onPointer);
    doc.defaultView?.removeEventListener("blur", onBlur);
    button.remove();
  };
}
