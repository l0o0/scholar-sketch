import { moveMenuFocus } from "../../utils/menu-keyboard";
import { iconLive, iconPreview, iconSource } from "./icons";
import { EDITOR_MODE_OPTIONS } from "./more-menu";

type EditorMode = "live" | "source" | "preview";

export interface ModeMenuController {
  sync(mode: EditorMode): void;
  close(): void;
  destroy(): void;
}

export function mountModeMenu(options: {
  root: HTMLElement;
  button: HTMLButtonElement;
  mode: EditorMode;
  labels: Record<EditorMode, string>;
  menuLabel: string;
  onSelect(mode: EditorMode): void;
  closeOtherMenus(): void;
  isComposing(): boolean;
}): ModeMenuController {
  const { root, button } = options;
  const doc = root.ownerDocument;
  const panel = doc.createElement("div");
  panel.className = "zotero-markdown-mode-menu";
  panel.hidden = true;
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", options.menuLabel);
  const buttons = EDITOR_MODE_OPTIONS.map(({ mode }) => {
    const entry = doc.createElement("button");
    entry.type = "button";
    entry.className = "zotero-markdown-more-menu-item";
    entry.dataset.mode = mode;
    entry.setAttribute("role", "menuitemradio");
    entry.textContent = options.labels[mode];
    entry.tabIndex = -1;
    panel.append(entry);
    return entry;
  });
  root
    .querySelector<HTMLElement>(".zotero-markdown-toolbar-inner")!
    .append(panel);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const icon = doc.createElement("span");
  icon.className = "zotero-markdown-mode-icon";
  icon.setAttribute("aria-hidden", "true");
  const label = doc.createElement("span");
  label.className = "zotero-markdown-mode-label";
  const chevron = doc.createElement("span");
  chevron.className = "zotero-markdown-mode-chevron";
  chevron.textContent = "⌄";
  chevron.setAttribute("aria-hidden", "true");
  button.replaceChildren(icon, label, chevron);

  let currentMode = options.mode;
  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const sync = (mode: EditorMode) => {
    currentMode = mode;
    label.textContent = options.labels[mode];
    button.title = options.labels[mode];
    button.setAttribute("aria-label", options.labels[mode]);
    icon.innerHTML = {
      live: iconLive,
      source: iconSource,
      preview: iconPreview,
    }[mode]();
    for (const entry of buttons) {
      entry.setAttribute("aria-checked", String(entry.dataset.mode === mode));
    }
  };
  const open = () => {
    if (options.isComposing()) return;
    options.closeOtherMenus();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const bounds = root.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    panel.style.maxWidth = `${Math.max(32, bounds.width - 8)}px`;
    panel.style.maxHeight = `${Math.max(32, bounds.height - 8)}px`;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(bounds.left + 4, Math.min(anchor.left, bounds.right - rect.width - 4))}px`;
    panel.style.top = `${Math.max(bounds.top + 4, Math.min(anchor.bottom + 6, bounds.bottom - rect.height - 4))}px`;
    for (const entry of buttons) {
      entry.tabIndex = entry.dataset.mode === currentMode ? 0 : -1;
    }
    buttons.find((entry) => entry.tabIndex === 0)?.focus();
  };
  const onTriggerClick = () => {
    if (panel.hidden) open();
    else close();
  };
  const onPanelClick = (event: MouseEvent) => {
    const entry = (event.target as Element | null)?.closest("[data-mode]");
    const index = buttons.findIndex((candidate) => candidate === entry);
    if (index < 0 || options.isComposing()) return;
    close();
    button.focus();
    options.onSelect(EDITOR_MODE_OPTIONS[index].mode);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || options.isComposing())
      return;
    const active = doc.activeElement;
    if (active === button && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      open();
    } else if (!panel.hidden && panel.contains(active)) {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        close();
        button.focus();
      } else {
        moveMenuFocus(event, buttons);
      }
    }
  };
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!panel.hidden && !panel.contains(target) && !button.contains(target))
      close();
  };
  const onResize = () => {
    const focused = !panel.hidden && panel.contains(doc.activeElement);
    close();
    if (focused) button.focus();
  };
  const onFocusOut = (event: FocusEvent) => {
    if (
      event.relatedTarget !== button &&
      !panel.contains(event.relatedTarget as Node | null)
    )
      close();
  };
  button.addEventListener("click", onTriggerClick);
  panel.addEventListener("click", onPanelClick);
  panel.addEventListener("focusout", onFocusOut);
  doc.addEventListener("keydown", onKeyDown);
  doc.addEventListener("pointerdown", onPointerDown);
  doc.defaultView?.addEventListener("resize", onResize);
  doc.defaultView?.addEventListener("blur", close);
  sync(currentMode);
  return {
    sync,
    close,
    destroy() {
      close();
      button.removeEventListener("click", onTriggerClick);
      panel.removeEventListener("click", onPanelClick);
      panel.removeEventListener("focusout", onFocusOut);
      doc.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.defaultView?.removeEventListener("resize", onResize);
      doc.defaultView?.removeEventListener("blur", close);
      panel.remove();
    },
  };
}
