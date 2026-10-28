import type { MarkdownToolbarMode } from "./preferences";

export interface ToolbarVisibilityController {
  setMode(mode: MarkdownToolbarMode): void;
  reveal(): void;
  destroy(): void;
}

/** Own transient visibility for one editor, independently of its saved preference. */
export function mountToolbarVisibility(options: {
  root: HTMLElement;
  workspace: HTMLElement;
  toolbar: HTMLElement;
  iframe: HTMLIFrameElement;
}): ToolbarVisibilityController {
  const { root, workspace, toolbar, iframe } = options;
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  let mode: MarkdownToolbarMode = "always";
  let pointerInside = false;
  let hideTimer: number | undefined;
  let frameDocument: Document | null = null;

  const cancelHide = () => {
    if (hideTimer === undefined) return;
    win.clearTimeout(hideTimer);
    hideTimer = undefined;
  };
  const heldOpen = () =>
    pointerInside ||
    toolbar.contains(doc.activeElement) ||
    !!toolbar.querySelector('[aria-haspopup][aria-expanded="true"]');
  const reveal = () => {
    cancelHide();
    toolbar.dataset.toolbarCollapsed = "false";
  };
  const scheduleHide = () => {
    if (mode !== "auto") return;
    if (hideTimer !== undefined) return;
    // Give the pointer time to cross the gap between a trigger and its popup.
    hideTimer = win.setTimeout(() => {
      hideTimer = undefined;
      if (!heldOpen()) toolbar.dataset.toolbarCollapsed = "true";
    }, 220);
  };
  const updatePointer = (inside: boolean) => {
    pointerInside = inside;
    if (mode !== "auto") return;
    if (inside) reveal();
    else scheduleHide();
  };
  const inTopRegion = (x: number, y: number) => {
    const bounds = workspace.getBoundingClientRect();
    return (
      x >= bounds.left &&
      x < bounds.right &&
      y >= bounds.top &&
      y < toolbar.getBoundingClientRect().bottom
    );
  };
  const onPointerMove = (event: PointerEvent) => {
    if (mode !== "auto" || event.buttons !== 0) return;
    updatePointer(
      toolbar.contains(event.target as Node) ||
        inTopRegion(event.clientX, event.clientY),
    );
  };
  const onFramePointerMove = (event: PointerEvent) => {
    if (mode !== "auto" || event.buttons !== 0) return;
    const bounds = iframe.getBoundingClientRect();
    updatePointer(
      inTopRegion(bounds.left + event.clientX, bounds.top + event.clientY),
    );
  };
  const onPointerLeave = () => updatePointer(false);
  const onPointerDown = (event: PointerEvent) => {
    if (!toolbar.contains(event.target as Node)) onPointerLeave();
  };
  const onFocusIn = () => {
    if (mode !== "auto") return;
    if (toolbar.contains(doc.activeElement)) reveal();
    else scheduleHide();
  };
  const unbindFrame = () => {
    frameDocument?.removeEventListener("pointermove", onFramePointerMove);
    frameDocument?.removeEventListener("pointerleave", onPointerLeave);
    frameDocument?.removeEventListener("pointerdown", onPointerLeave);
    frameDocument = null;
  };
  const bindFrame = () => {
    unbindFrame();
    frameDocument = iframe.contentDocument;
    frameDocument?.addEventListener("pointermove", onFramePointerMove);
    frameDocument?.addEventListener("pointerleave", onPointerLeave);
    frameDocument?.addEventListener("pointerdown", onPointerLeave);
  };
  // Menus already own their expanded state; do not duplicate it here.
  const menuObserver = new win.MutationObserver(() => {
    if (mode !== "auto") return;
    if (heldOpen()) reveal();
    else scheduleHide();
  });
  menuObserver.observe(toolbar, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-expanded"],
  });
  doc.addEventListener("pointermove", onPointerMove);
  doc.addEventListener("pointerdown", onPointerDown);
  doc.addEventListener("pointerleave", onPointerLeave);
  doc.addEventListener("focusin", onFocusIn);
  toolbar.addEventListener("focusout", scheduleHide);
  win.addEventListener("blur", onPointerLeave);
  iframe.addEventListener("load", bindFrame);
  bindFrame();

  return {
    setMode(next) {
      if (mode !== next) {
        mode = next;
        pointerInside = false;
        cancelHide();
      }
      toolbar.dataset.toolbarMode = mode;
      toolbar.dataset.toolbarCollapsed = String(mode === "auto" && !heldOpen());
    },
    reveal() {
      if (mode !== "auto") return;
      reveal();
      toolbar.querySelector<HTMLButtonElement>('[data-action="more"]')!.focus();
    },
    destroy() {
      cancelHide();
      menuObserver.disconnect();
      unbindFrame();
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("pointerleave", onPointerLeave);
      doc.removeEventListener("focusin", onFocusIn);
      toolbar.removeEventListener("focusout", scheduleHide);
      win.removeEventListener("blur", onPointerLeave);
      iframe.removeEventListener("load", bindFrame);
    },
  };
}
