import type {
  ReadingTranslationResult,
  ReadingTranslationServices,
} from "./reading-translation";
import type { EditorTextSelection } from "./editor-protocol";
import { iconMore, iconReset, iconTranslate } from "./icons";
import { moveMenuFocus } from "../../utils/menu-keyboard";

interface PreviewSelectionSnapshot {
  source: "preview";
  article: HTMLElement;
  range: Range;
  text: string;
  sourceText: string;
}
type SelectionSnapshot =
  PreviewSelectionSnapshot | ({ source: "editor" } & EditorTextSelection);

export interface ReadingSelectionPopup {
  hide(): void;
  dispose(): void;
  isOpen(): boolean;
  showEditorSelection(target: EditorTextSelection | null): void;
}

/** A reading surface owns its selected text, queued translation and host popup. */
export function mountReadingSelectionPopup(options: {
  root: HTMLElement;
  isActive(source: "preview" | "editor"): boolean;
  translate(
    text: string,
    serviceID?: string,
  ): Promise<ReadingTranslationResult>;
  getServices(): ReadingTranslationServices;
  onShow?(): void;
  labels: {
    translate: string;
    loading: string;
    retry: string;
    unavailable: string;
    failed: string;
    close: string;
    region: string;
    services: string;
    defaultService: string;
    servicesUnavailable: string;
    servicesFailed: string;
    servicesEmpty: string;
  };
}): ReadingSelectionPopup {
  const { root, labels } = options;
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const element = <T extends HTMLElement>(tag: string, className: string) => {
    const node = doc.createElementNS("http://www.w3.org/1999/xhtml", tag) as T;
    node.className = className;
    return node;
  };
  const panel = element<HTMLElement>("section", "zmd-reading-selection-popup");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", labels.region);
  panel.style.cssText =
    "position:fixed;z-index:2147483001;display:none;box-sizing:border-box;max-width:calc(100vw - 24px);max-height:320px;overflow:auto;border:1px solid color-mix(in srgb,CanvasText 16%,Canvas);border-radius:8px;background:Canvas;color:CanvasText;box-shadow:0 3px 12px #0002;font:13px/1.6 system-ui,sans-serif;text-align:start";
  const style = element<HTMLStyleElement>("style", "");
  style.textContent = `
.zmd-reading-selection-popup { padding:2px; }
.zmd-reading-selection-popup.is-expanded { width:360px; padding:8px; }
.zmd-reading-selection-popup [hidden] { display:none; }
.zmd-reading-selection-popup button { appearance:none; -moz-appearance:none; display:grid; place-items:center; box-sizing:border-box; width:28px; height:28px; min-width:0; min-height:0; margin:0; padding:0; border:0; border-radius:5px; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.zmd-reading-selection-popup button:hover:not(:disabled) { background:color-mix(in srgb,CanvasText 7%,Canvas); }
.zmd-reading-selection-popup button:focus-visible { outline:2px solid Highlight; outline-offset:-2px; }
.zmd-reading-selection-popup button:disabled { opacity:.5; cursor:wait; }
.zmd-reading-selection-popup .zmd-icon { display:block; width:18px; height:18px; background-color:currentColor; mask-image:var(--zmd-icon-url); mask-mode:alpha; mask-repeat:no-repeat; mask-position:center; mask-size:contain; }
.zmd-reading-selection-service-menu { position:fixed; z-index:2147483002; box-sizing:border-box; width:220px; max-width:calc(100vw - 24px); padding:4px; overflow:auto; border:1px solid color-mix(in srgb,CanvasText 16%,Canvas); border-radius:8px; background:Canvas; color:CanvasText; box-shadow:0 4px 16px #0002; }
.zmd-reading-selection-popup .zmd-reading-selection-service-menu button { display:flex; gap:8px; width:100%; height:auto; min-height:30px; padding:5px 8px; text-align:start; }
.zmd-reading-selection-service-menu button::before { content:""; flex:0 0 14px; }
.zmd-reading-selection-service-menu button[aria-checked="true"]::before { content:"✓"; color:Highlight; }
.zmd-reading-selection-service-menu .zmd-reading-selection-service-name { overflow-wrap:anywhere; }
.zmd-reading-selection-service-status { margin:4px 8px; color:color-mix(in srgb,CanvasText 65%,Canvas); }
`;
  const controls = element<HTMLElement>("div", "zmd-reading-selection-actions");
  controls.style.cssText = "display:flex;align-items:center;gap:6px";
  const action = element<HTMLButtonElement>(
    "button",
    "zmd-reading-selection-translate",
  );
  action.type = "button";
  function actionIcon(retry = false) {
    const label = retry ? labels.retry : labels.translate;
    action.title = label;
    action.setAttribute("aria-label", label);
    // icons.ts emits trusted spans with external masks, never inline SVG.
    action.innerHTML = retry ? iconReset() : iconTranslate();
  }
  actionIcon();
  const services = element<HTMLButtonElement>(
    "button",
    "zmd-reading-selection-services",
  );
  services.type = "button";
  services.title = labels.services;
  services.setAttribute("aria-label", labels.services);
  services.setAttribute("aria-haspopup", "menu");
  services.setAttribute("aria-expanded", "false");
  services.innerHTML = iconMore();
  services.style.cssText =
    "border-inline-start:1px solid color-mix(in srgb,CanvasText 12%,Canvas);border-radius:0 5px 5px 0";
  const serviceMenu = element<HTMLElement>(
    "div",
    "zmd-reading-selection-service-menu",
  );
  serviceMenu.hidden = true;
  serviceMenu.setAttribute("role", "menu");
  serviceMenu.setAttribute("aria-label", labels.services);
  const close = element<HTMLButtonElement>(
    "button",
    "zmd-reading-selection-close",
  );
  close.type = "button";
  close.textContent = "×";
  close.title = labels.close;
  close.setAttribute("aria-label", labels.close);
  close.style.marginInlineStart = "auto";
  close.hidden = true;
  const result = element<HTMLElement>("div", "zmd-reading-selection-result");
  result.setAttribute("role", "status");
  result.setAttribute("aria-live", "polite");
  result.style.cssText =
    "margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;max-width:344px;user-select:text";
  result.hidden = true;
  controls.append(action, services, close);
  panel.append(style, controls, result, serviceMenu);
  (doc.body ?? doc.documentElement).append(panel);

  let disposed = false;
  let snapshot: SelectionSnapshot | null = null;
  let dismissed: SelectionSnapshot | null = null;
  let selecting = false;
  let generation = 0;
  let running = false;
  let pending: {
    text: string;
    serviceID?: string;
    generation: number;
  } | null = null;
  // A surface-local override never changes the provider's global default.
  let selectedServiceID: string | undefined;
  let serviceButtons: HTMLButtonElement[] = [];
  let placement: "above" | "below" | undefined;

  const inPanel = (target: EventTarget | null) =>
    !!target &&
    typeof (target as Node).nodeType === "number" &&
    panel.contains(target as Node);
  const active = (source: SelectionSnapshot["source"]) =>
    !disposed && root.isConnected && options.isActive(source);
  const inDocument = (target: EventTarget | null) =>
    target === doc ||
    (!!target && "ownerDocument" in target && target.ownerDocument === doc);

  function selected(): PreviewSelectionSnapshot | null {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
      return null;
    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const element =
      ancestor.nodeType === 1 ? (ancestor as Element) : ancestor.parentElement;
    const article = element?.closest<HTMLElement>(
      "article.zotero-markdown-preview-inner",
    );
    if (
      !article ||
      article.ownerDocument !== doc ||
      !root.contains(article) ||
      !article.contains(range.startContainer) ||
      !article.contains(range.endContainer)
    )
      return null;
    const text = selection.toString();
    if (!text.trim()) return null;
    return {
      source: "preview",
      article,
      range: range.cloneRange(),
      text,
      sourceText: range.toString(),
    };
  }
  function same(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
    if (a.source === "editor")
      return (
        b.source === "editor" &&
        a.rev === b.rev &&
        a.from === b.from &&
        a.to === b.to &&
        a.text === b.text
      );
    return (
      b.source === "preview" &&
      a.article === b.article &&
      a.text === b.text &&
      a.range.startContainer === b.range.startContainer &&
      a.range.startOffset === b.range.startOffset &&
      a.range.endContainer === b.range.endContainer &&
      a.range.endOffset === b.range.endOffset
    );
  }
  function valid(value: SelectionSnapshot): boolean {
    if (!active(value.source)) return false;
    if (value.source === "editor") return true;
    return (
      value.article.isConnected &&
      root.contains(value.article) &&
      value.article.contains(value.range.startContainer) &&
      value.article.contains(value.range.endContainer) &&
      value.range.toString() === value.sourceText
    );
  }
  function selectionMatches(): boolean {
    if (!snapshot) return false;
    if (snapshot.source === "editor") return true;
    const current = selected();
    if (current) return same(snapshot, current);
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed)
      return inPanel(selection.anchorNode) && inPanel(selection.focusNode);
    return inPanel(doc.activeElement);
  }
  function hide() {
    generation++;
    selecting = false;
    if (snapshot) dismissed = snapshot;
    snapshot = null;
    pending = null;
    placement = undefined;
    panel.style.display = "none";
    panel.removeAttribute("aria-busy");
    result.textContent = "";
    closeServices();
  }
  function position() {
    if (!snapshot || !valid(snapshot)) return hide();
    let anchor: { left: number; top: number; right: number; bottom: number };
    if (snapshot.source === "editor") anchor = snapshot.rect;
    else {
      const rects = snapshot.range.getClientRects();
      anchor = rects?.length
        ? rects[rects.length - 1]
        : snapshot.range.getBoundingClientRect();
    }
    const width = Math.min(
      panel.getBoundingClientRect().width || 120,
      win.innerWidth - 24,
    );
    const above = Math.max(0, anchor.top - 20);
    const below = Math.max(0, win.innerHeight - anchor.bottom - 20);
    placement ??= below >= 320 || below >= above ? "below" : "above";
    const available = Math.min(320, placement === "below" ? below : above);
    panel.style.maxHeight = `${available}px`;
    const height = Math.min(
      panel.getBoundingClientRect().height || 40,
      available,
    );
    panel.style.left = `${Math.max(12, Math.min(anchor.left, win.innerWidth - width - 12))}px`;
    panel.style.top = `${placement === "below" ? anchor.bottom + 8 : Math.max(12, anchor.top - height - 8)}px`;
    positionServices();
  }
  function closeServices(restoreFocus = false) {
    serviceMenu.hidden = true;
    services.setAttribute("aria-expanded", "false");
    if (restoreFocus) services.focus({ preventScroll: true });
  }
  function positionServices() {
    if (serviceMenu.hidden) return;
    const anchor = services.getBoundingClientRect();
    const above = Math.max(0, anchor.top - 20);
    const below = Math.max(0, win.innerHeight - anchor.bottom - 20);
    const belowMenu = below >= 240 || below >= above;
    serviceMenu.style.maxHeight = `${Math.min(240, belowMenu ? below : above)}px`;
    const rect = serviceMenu.getBoundingClientRect();
    serviceMenu.style.left = `${Math.max(12, Math.min(anchor.right - rect.width, win.innerWidth - rect.width - 12))}px`;
    serviceMenu.style.top = `${belowMenu ? anchor.bottom + 6 : Math.max(12, anchor.top - rect.height - 6)}px`;
  }
  function openServices() {
    updateSelection();
    if (!snapshot || !valid(snapshot) || !selectionMatches()) return;
    const available = options.getServices();
    serviceMenu.replaceChildren();
    serviceButtons = [];
    const entries = [
      { id: "", name: labels.defaultService },
      ...(available.status === "available" ? available.services : []),
    ];
    for (const entry of entries) {
      const button = element<HTMLButtonElement>("button", "");
      button.type = "button";
      button.dataset.serviceId = entry.id;
      button.setAttribute("role", "menuitemradio");
      const checked = entry.id === (selectedServiceID ?? "");
      button.setAttribute("aria-checked", String(checked));
      button.tabIndex = checked ? 0 : -1;
      const name = element<HTMLElement>(
        "span",
        "zmd-reading-selection-service-name",
      );
      name.textContent = entry.name;
      button.append(name);
      serviceButtons.push(button);
      serviceMenu.append(button);
    }
    if (available.status !== "available" || !available.services.length) {
      const status = element<HTMLElement>(
        "div",
        "zmd-reading-selection-service-status",
      );
      status.setAttribute("role", "status");
      status.textContent =
        available.status === "unavailable"
          ? labels.servicesUnavailable
          : available.status === "failed"
            ? labels.servicesFailed
            : labels.servicesEmpty;
      serviceMenu.append(status);
    }
    serviceMenu.hidden = false;
    services.setAttribute("aria-expanded", "true");
    positionServices();
    const focused =
      serviceButtons.find((button) => button.tabIndex === 0) ??
      serviceButtons[0];
    focused.tabIndex = 0;
    focused.focus({ preventScroll: true });
  }
  const onServicesClick = () => {
    if (serviceMenu.hidden) openServices();
    else closeServices(true);
  };
  const onServiceClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "[data-service-id]",
    );
    if (!button || !serviceButtons.includes(button)) return;
    selectedServiceID = button.dataset.serviceId || undefined;
    closeServices(true);
    generation++;
    pending = null;
    request();
  };
  function updateSelection() {
    if (disposed || selecting) return;
    if (snapshot?.source === "editor") {
      if (valid(snapshot)) return;
      hide();
    }
    if (!active("preview")) {
      if (snapshot?.source === "preview") hide();
      return;
    }
    const next = selected();
    if (!next) {
      if (snapshot && valid(snapshot) && selectionMatches()) return;
      hide();
      dismissed = null;
      return;
    }
    show(next);
  }
  function show(next: SelectionSnapshot) {
    if (snapshot && same(snapshot, next)) {
      snapshot = next;
      return position();
    }
    if (dismissed && same(dismissed, next)) return;
    generation++;
    pending = null;
    closeServices();
    snapshot = next;
    dismissed = null;
    placement = undefined;
    action.disabled = false;
    actionIcon();
    close.hidden = true;
    panel.classList.remove("is-expanded");
    panel.removeAttribute("aria-busy");
    result.hidden = true;
    result.textContent = "";
    panel.style.display = "block";
    position();
    options.onShow?.();
  }
  function showEditorSelection(target: EditorTextSelection | null) {
    if (disposed) return;
    if (!target || !target.text.trim()) {
      if (snapshot?.source === "editor") hide();
      if (dismissed?.source === "editor") dismissed = null;
      return;
    }
    if (!active("editor")) {
      if (snapshot?.source === "editor") hide();
      return;
    }
    show({ source: "editor", ...target, rect: { ...target.rect } });
  }
  const current = (job: { generation: number }) =>
    snapshot !== null &&
    job.generation === generation &&
    valid(snapshot) &&
    selectionMatches();
  async function pump() {
    if (running || !pending || disposed) return;
    const job = pending;
    pending = null;
    running = true;
    let value: ReadingTranslationResult;
    try {
      value = await options.translate(job.text, job.serviceID);
    } catch {
      value = { status: "failed" };
    }
    if (current(job)) {
      panel.removeAttribute("aria-busy");
      action.disabled = false;
      actionIcon(value.status !== "translated");
      result.textContent =
        value.status === "translated" ? value.text : labels[value.status];
      position();
    }
    running = false;
    void pump();
  }
  function request() {
    updateSelection();
    if (!snapshot || !valid(snapshot) || !selectionMatches()) return;
    closeServices();
    pending = { text: snapshot.text, serviceID: selectedServiceID, generation };
    panel.classList.add("is-expanded");
    close.hidden = false;
    action.disabled = true;
    result.hidden = false;
    result.textContent = labels.loading;
    panel.setAttribute("aria-busy", "true");
    position();
    void pump();
  }
  const onPointerDown = (event: Event) => {
    if (inPanel(event.target)) return;
    hide();
    const node = event.target as Node;
    const element =
      node.nodeType === 1 ? (node as Element) : node.parentElement;
    const article = element?.closest("article.zotero-markdown-preview-inner");
    selecting = !!article && root.contains(article);
    if (selecting) dismissed = null;
  };
  const onPointerUp = () => {
    if (!selecting) return;
    selecting = false;
    updateSelection();
  };
  const onPointerCancel = () => {
    if (selecting) hide();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (
      doc.activeElement === services &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      openServices();
      return;
    }
    if (!serviceMenu.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeServices(true);
        return;
      }
      if (serviceMenu.contains(doc.activeElement)) {
        if (event.key === "Tab") closeServices(true);
        else if (moveMenuFocus(event, serviceButtons)) return;
      }
    }
    if (event.key !== "Escape" || event.isComposing || !snapshot) return;
    if (snapshot.source === "preview") {
      event.preventDefault();
      event.stopPropagation();
    }
    hide();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" &&
      inDocument(event.target) &&
      !inPanel(event.target)
    )
      updateSelection();
  };
  const onSelectionChange = (event: Event) => {
    if (event.target === doc) updateSelection();
  };
  const onLayout = (event: Event) => {
    if (!snapshot || inPanel(event.target)) return;
    if (event.type === "resize" && event.target !== win) return;
    if (event.type === "scroll" && !inDocument(event.target)) return;
    position();
  };
  const onDeactivate = (event: Event) => {
    if (event.target === win) hide();
  };
  const preserveSelection = (event: MouseEvent) => {
    if ((event.target as Element).closest("button")) event.preventDefault();
  };
  const onServiceFocusOut = (event: FocusEvent) => {
    if (!serviceMenu.contains(event.relatedTarget as Node | null))
      closeServices();
  };
  action.addEventListener("click", request);
  services.addEventListener("click", onServicesClick);
  serviceMenu.addEventListener("click", onServiceClick);
  serviceMenu.addEventListener("focusout", onServiceFocusOut);
  close.addEventListener("click", hide);
  panel.addEventListener("mousedown", preserveSelection);
  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("pointerup", onPointerUp, true);
  doc.addEventListener("pointercancel", onPointerCancel, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("keyup", onKeyUp);
  doc.addEventListener("scroll", onLayout, true);
  win.addEventListener("resize", onLayout);
  win.addEventListener("deactivate", onDeactivate);

  return {
    hide,
    showEditorSelection,
    isOpen: () => snapshot !== null && !disposed,
    dispose() {
      if (disposed) return;
      hide();
      disposed = true;
      dismissed = null;
      doc.removeEventListener("selectionchange", onSelectionChange);
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("pointerup", onPointerUp, true);
      doc.removeEventListener("pointercancel", onPointerCancel, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("keyup", onKeyUp);
      doc.removeEventListener("scroll", onLayout, true);
      win.removeEventListener("resize", onLayout);
      win.removeEventListener("deactivate", onDeactivate);
      panel.removeEventListener("mousedown", preserveSelection);
      action.removeEventListener("click", request);
      services.removeEventListener("click", onServicesClick);
      serviceMenu.removeEventListener("click", onServiceClick);
      serviceMenu.removeEventListener("focusout", onServiceFocusOut);
      close.removeEventListener("click", hide);
      panel.remove();
    },
  };
}
