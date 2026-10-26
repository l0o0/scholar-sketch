/** Pointer and keyboard resizing owned by the mounted host sidebar. */
export function mountSidebarResize(
  sidebar: HTMLElement,
  options: {
    edge: "left" | "right";
    className: string;
    variable: string;
    min: number;
    max: number;
    initial: number;
    label: string;
    help: string;
    focusFallback: HTMLElement;
    beforeResize(): void;
    onResize(): void;
  },
) {
  const handle = sidebar.ownerDocument.createElement("div");
  handle.className = options.className;
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", options.label);
  handle.setAttribute("aria-valuemin", String(options.min));
  handle.setAttribute("aria-valuemax", String(options.max));
  handle.title = options.help;
  sidebar.prepend(handle);
  let width = options.initial;
  let enabled = false;
  let disposed = false;
  let drag: { pointerID: number; x: number; width: number } | undefined;
  const sign = options.edge === "left" ? 1 : -1;
  const apply = () => {
    sidebar.style.setProperty(options.variable, `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
  };
  const setWidth = (value: number) => {
    if (!enabled || disposed) return;
    options.beforeResize();
    width = Math.max(options.min, Math.min(options.max, value));
    apply();
    options.onResize();
  };
  const finish = () => {
    if (!drag) return;
    const pointerID = drag.pointerID;
    drag = undefined;
    sidebar.classList.remove("is-resizing");
    if (handle.hasPointerCapture(pointerID))
      handle.releasePointerCapture(pointerID);
  };
  const start = (event: PointerEvent) => {
    if (event.button !== 0 || !enabled || disposed) return;
    event.preventDefault();
    options.beforeResize();
    handle.focus();
    drag = { pointerID: event.pointerId, x: event.clientX, width };
    handle.setPointerCapture(event.pointerId);
    sidebar.classList.add("is-resizing");
  };
  const move = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.pointerID)
      setWidth(drag.width + sign * (event.clientX - drag.x));
  };
  const key = (event: KeyboardEvent) => {
    if (!enabled || disposed) return;
    const step = event.shiftKey ? 40 : 16;
    const value =
      event.key === "ArrowLeft"
        ? width - sign * step
        : event.key === "ArrowRight"
          ? width + sign * step
          : event.key === "Home"
            ? options.min
            : event.key === "End"
              ? options.max
              : event.key === "Enter"
                ? options.initial
                : undefined;
    if (value === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setWidth(value);
  };
  const reset = () => setWidth(options.initial);
  handle.addEventListener("pointerdown", start);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  handle.addEventListener("keydown", key);
  handle.addEventListener("dblclick", reset);
  const win = sidebar.ownerDocument.defaultView;
  win?.addEventListener("blur", finish);
  apply();
  return {
    get width() {
      return width;
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (!value && sidebar.ownerDocument.activeElement === handle)
        options.focusFallback.focus({ preventScroll: true });
      handle.hidden = !value;
      if (!value) finish();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      finish();
      handle.removeEventListener("pointerdown", start);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
      handle.removeEventListener("keydown", key);
      handle.removeEventListener("dblclick", reset);
      win?.removeEventListener("blur", finish);
      handle.remove();
      sidebar.style.removeProperty(options.variable);
    },
  };
}
