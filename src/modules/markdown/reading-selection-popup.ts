import type { ReadingTranslationResult } from "./reading-translation";
import type { EditorTextSelection } from "./editor-protocol";
import { iconReset, iconTranslate } from "./icons";

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
  translate(text: string): Promise<ReadingTranslationResult>;
  onShow?(): void;
  labels: {
    translate: string;
    loading: string;
    retry: string;
    unavailable: string;
    failed: string;
    close: string;
    region: string;
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
  controls.append(action, close);
  panel.append(style, controls, result);
  (doc.body ?? doc.documentElement).append(panel);

  let disposed = false;
  let snapshot: SelectionSnapshot | null = null;
  let dismissed: SelectionSnapshot | null = null;
  let selecting = false;
  let generation = 0;
  let running = false;
  let pending: { text: string; generation: number } | null = null;
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
  }
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
      value = await options.translate(job.text);
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
    pending = { text: snapshot.text, generation };
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
  action.addEventListener("click", request);
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
      close.removeEventListener("click", hide);
      panel.remove();
    },
  };
}
