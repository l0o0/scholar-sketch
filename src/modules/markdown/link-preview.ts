import type { LinkHoverTarget } from "./editor-protocol";
import {
  createLinkPreviewContentLoader,
  type LinkPreviewContent,
} from "./link-preview-content";
import { mountPdfLinkPreview } from "./link-preview-pdf";
import { subscribeNoteLibrary } from "./note-library";
import { getString } from "../../utils/locale";

export interface LinkPreviewController {
  show(target: LinkHoverTarget | null): void;
  leave(): void;
  hide(): void;
  invalidate(): void;
  bindLinks(root: HTMLElement): () => void;
  dispose(): void;
}

const HTML_NS = "http://www.w3.org/1999/xhtml";

/** One mounted editor surface owns its popup, pending request and PDF reader. */
export function createLinkPreviewController(options: {
  root: HTMLElement;
  currentItem: Zotero.Item;
  win: Window;
  onOpen(href: string, sourceItemID?: number): void;
  isActive?: () => boolean;
  loader?: ReturnType<typeof createLinkPreviewContentLoader>;
  mountPdf?: typeof mountPdfLinkPreview;
  labels?: {
    loading: string;
    empty: string;
    unavailable: string;
    unresolved: string;
    ambiguous: string;
    failed: string;
    open: string;
  };
}): LinkPreviewController {
  const { root, currentItem, win, onOpen } = options;
  const doc = root.ownerDocument;
  const loader = options.loader ?? createLinkPreviewContentLoader();
  const labels = options.labels ?? {
    loading: getString("link-preview-loading"),
    empty: getString("link-preview-empty"),
    unavailable: getString("link-preview-unavailable"),
    unresolved: getString("document-link-unresolved"),
    ambiguous: getString("link-preview-ambiguous"),
    failed: getString("link-preview-failed"),
    open: getString("link-preview-open"),
  };
  const element = <T extends HTMLElement>(tag: string, className: string) => {
    const value = doc.createElementNS(HTML_NS, tag) as T;
    value.className = className;
    return value;
  };
  const panel = element<HTMLElement>("section", "zmd-link-preview");
  panel.setAttribute("role", "region");
  panel.style.cssText =
    "position:fixed;z-index:2147483000;box-sizing:border-box;width:380px;max-width:calc(100vw - 24px);max-height:440px;display:none;flex-direction:column;overflow:hidden;border:1px solid color-mix(in srgb,CanvasText 18%,Canvas);border-radius:10px;background:Canvas;color:CanvasText;box-shadow:0 8px 32px #0003;font:13px/1.6 system-ui,sans-serif;text-align:start;";
  const style = element<HTMLStyleElement>("style", "");
  style.textContent = `
.zmd-link-preview h1,.zmd-link-preview h2,.zmd-link-preview h3 { font-size:1.1em; margin:.7em 0 .3em; }
.zmd-link-preview p { margin:.5em 0; }
.zmd-link-preview table { border-collapse:collapse; font-size:12px; }
.zmd-link-preview th,.zmd-link-preview td { padding:4px 7px; border:1px solid color-mix(in srgb,CanvasText 20%,Canvas); }
.zmd-link-preview pre,.zmd-link-preview .katex-display { overflow-x:auto; }
.zmd-link-preview mark { background:Mark; color:MarkText; }
.zmd-link-preview kbd { border:1px solid GrayText; border-radius:3px; padding:0 3px; }
.zmd-link-preview a { color:LinkText; }
.zmd-link-preview button { color:inherit; font:inherit; cursor:pointer; }
.zmd-link-preview button:focus-visible { outline:2px solid Highlight; outline-offset:2px; }
`;
  const header = element<HTMLElement>("header", "zmd-link-preview-header");
  header.style.cssText = "padding:12px 14px 8px;flex:none";
  const title = element<HTMLElement>("strong", "zmd-link-preview-title");
  title.style.cssText = "display:block;font-size:14px;line-height:1.4";
  const subtitle = element<HTMLElement>("div", "zmd-link-preview-subtitle");
  subtitle.style.cssText =
    "font-size:12px;color:color-mix(in srgb,CanvasText 72%,Canvas);margin-top:4px";
  header.append(title, subtitle);
  const body = element<HTMLElement>("div", "zmd-link-preview-body");
  body.style.cssText =
    "padding:0 14px 12px;overflow:auto;min-height:0;white-space:pre-wrap;overflow-wrap:anywhere";
  const open = element<HTMLButtonElement>("button", "zmd-link-preview-open");
  open.type = "button";
  open.textContent = labels.open;
  open.style.cssText =
    "flex:none;align-self:flex-end;margin:0 14px 10px;padding:2px 8px;border:1px solid color-mix(in srgb,CanvasText 20%,Canvas);border-radius:5px;background:transparent";
  panel.append(style, header, body, open);
  (doc.body ?? doc.documentElement).append(panel);

  let disposed = false;
  let generation = 0;
  let active: LinkHoverTarget | null = null;
  let openingHref = "";
  let previewItemID: number | undefined;
  let closeTimer: number | undefined;
  let overPanel = false;
  let placement: "above" | "below" | undefined;
  let pending: { target: LinkHoverTarget; generation: number } | null = null;
  let loading = false;
  let pdf: ReturnType<typeof mountPdfLinkPreview> | undefined;
  const cache = new Map<string, LinkPreviewContent>();
  const bindings = new Set<() => void>();
  const activeSurface = () =>
    !disposed && root.isConnected && (options.isActive?.() ?? true);
  const current = (value: number) =>
    activeSurface() && generation === value && active !== null;

  function clearCloseTimer() {
    if (closeTimer !== undefined) win.clearTimeout(closeTimer);
    closeTimer = undefined;
  }
  function releasePdf() {
    pdf?.dispose();
    pdf = undefined;
  }
  function hide() {
    clearCloseTimer();
    generation++;
    pending = null;
    active = null;
    previewItemID = undefined;
    overPanel = false;
    placement = undefined;
    releasePdf();
    panel.style.display = "none";
    body.replaceChildren();
  }
  function leave() {
    clearCloseTimer();
    if (overPanel || panel.contains(doc.activeElement)) return;
    closeTimer = win.setTimeout(hide, 150);
  }
  function position(target: LinkHoverTarget) {
    const width = Math.min(380, Math.max(0, win.innerWidth - 24));
    const below = Math.max(0, win.innerHeight - target.rect.bottom - 20);
    const above = Math.max(0, target.rect.top - 20);
    // Reserve a side for the whole hover, including the initial loading card.
    // Async content must grow away from the link instead of crossing the cursor.
    placement ??= below >= 440 || below >= above ? "below" : "above";
    const available = Math.min(440, placement === "below" ? below : above);
    panel.style.maxHeight = `${available}px`;
    const height = Math.min(
      panel.getBoundingClientRect().height || 180,
      available,
    );
    const left = Math.max(
      12,
      Math.min(target.rect.left, win.innerWidth - width - 12),
    );
    const top =
      placement === "below"
        ? target.rect.bottom + 8
        : Math.max(12, target.rect.top - height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
  function render(content: LinkPreviewContent, request: number) {
    releasePdf();
    body.replaceChildren();
    body.style.display = "block";
    body.style.overflow = "auto";
    panel.removeAttribute("aria-busy");
    if (content.status !== "resolved") {
      title.textContent = labels[content.status];
      panel.setAttribute("aria-label", labels[content.status]);
      subtitle.textContent = "";
      return;
    }
    title.textContent = content.title;
    panel.setAttribute("aria-label", content.title);
    subtitle.textContent = content.subtitle ?? "";
    subtitle.hidden = !content.subtitle;
    openingHref = content.href;
    previewItemID = content.sourceItemID;
    body.style.whiteSpace = content.bodyHtml ? "normal" : "pre-wrap";
    if (content.bodyHtml) {
      const parsed: Document = new win.DOMParser().parseFromString(
        content.bodyHtml,
        "text/html",
      );
      // Hover snippets do not resolve document assets or fetch remote images.
      parsed
        .querySelectorAll("img,video,audio,iframe")
        .forEach((node) => node.remove());
      for (const child of Array.from(parsed.body.childNodes))
        body.append(doc.importNode(child, true));
    } else {
      body.textContent = content.text || labels.empty;
    }
    if (content.kind === "pdf") {
      body.textContent = labels.loading;
      body.style.display = "flex";
      body.style.flexDirection = "column";
      body.style.overflow = "hidden";
      const pdfHost = element<HTMLElement>("div", "zmd-link-preview-pdf");
      pdfHost.style.cssText =
        "height:300px;flex:1 1 300px;min-height:0;width:100%;margin-top:6px;overflow:hidden";
      body.append(pdfHost);
      const mounted = (options.mountPdf ?? mountPdfLinkPreview)({
        container: pdfHost,
        itemID: content.attachmentID,
        location: content.location,
        isCurrent: () => current(request),
        onPointerPresence: (inside) => {
          if (!current(request)) return;
          overPanel = inside;
          if (inside) clearCloseTimer();
          else leave();
        },
      });
      pdf = mounted;
      void mounted.ready.then(
        () => {
          if (!current(request)) return;
          if (body.firstChild?.nodeType === 3) body.firstChild.remove();
          if (active) position(active);
        },
        (error) => {
          if (!current(request)) return;
          releasePdf();
          body.textContent = labels.failed;
          ztoolkit.log("Failed to load PDF link preview", error);
          if (active) position(active);
        },
      );
    }
    if (active) position(active);
  }
  async function pump() {
    if (loading || !pending || disposed) return;
    const job = pending;
    pending = null;
    loading = true;
    try {
      const cached = cache.get(job.target.href);
      const content =
        cached ?? (await loader.load(job.target.href, { currentItem, win }));
      if (!current(job.generation)) return;
      // Markdown is read afresh so another open editor's draft cannot go stale.
      if (content.status === "resolved" && content.kind !== "markdown") {
        cache.delete(job.target.href);
        cache.set(job.target.href, content);
        if (cache.size > 12) cache.delete(cache.keys().next().value!);
      }
      render(content, job.generation);
    } catch (error) {
      if (current(job.generation)) {
        panel.removeAttribute("aria-busy");
        title.textContent = labels.failed;
        body.replaceChildren();
        ztoolkit.log("Failed to load link preview", error);
      }
    } finally {
      loading = false;
      void pump();
    }
  }
  function show(target: LinkHoverTarget | null) {
    if (!target) return leave();
    if (!isPreviewLink(target.href)) return hide();
    if (!activeSurface()) return hide();
    clearCloseTimer();
    if (active?.href === target.href) {
      active = target;
      position(target);
      return;
    }
    hide();
    active = target;
    openingHref = target.href;
    title.textContent = labels.loading;
    subtitle.textContent = "";
    panel.setAttribute("aria-label", labels.loading);
    panel.setAttribute("aria-busy", "true");
    panel.style.display = "flex";
    position(target);
    pending = { target, generation };
    void pump();
  }
  function invalidate() {
    cache.clear();
    hide();
  }
  // Index scans also publish completion without changing the hovered target.
  // Drop cached metadata without tearing down the card's current snapshot.
  const unsubscribe = subscribeNoteLibrary(() => cache.clear());
  // Item refreshes also come from unrelated saves and native PDF initialization.
  // Keep the current snapshot; subsequent hovers read the invalidated metadata.
  const observer =
    typeof Zotero !== "undefined" && Zotero.Notifier
      ? Zotero.Notifier.registerObserver(
          { notify: () => cache.clear() },
          ["item"],
          "sketch-link-preview",
        )
      : undefined;
  function isPreviewTarget(target: EventTarget | null): boolean {
    if (pdf?.containsEventTarget(target)) return true;
    return (
      !!target &&
      typeof (target as Node).nodeType === "number" &&
      panel.contains(target as Node)
    );
  }
  const onPointerDown = (event: Event) => {
    if (!isPreviewTarget(event.target)) hide();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" || !isPreviewTarget(event.target)) hide();
  };
  const onScroll = (event: Event) => {
    const target = event.target as Node;
    // Gecko exposes scroll events from the embedded PDF document to chrome.
    // Its initial page navigation must not dismiss the owning preview card.
    if (target !== doc && target.ownerDocument !== doc) return;
    if (!panel.contains(target)) hide();
  };
  const onWindowDismiss = (event: Event) => {
    if (event.target === win) hide();
  };
  const onWindowFocus = (event: Event) => {
    if (event.target !== win) return;
    if (isPreviewTarget(doc.activeElement)) cache.clear();
    else invalidate();
  };
  panel.addEventListener("mouseenter", () => {
    overPanel = true;
    clearCloseTimer();
  });
  panel.addEventListener("mouseover", () => {
    overPanel = true;
    clearCloseTimer();
  });
  panel.addEventListener("mouseleave", (event) => {
    if (isPreviewTarget(event.relatedTarget)) return;
    overPanel = false;
    leave();
  });
  panel.addEventListener("focusin", clearCloseTimer);
  panel.addEventListener("focusout", leave);
  panel.addEventListener("click", (event) => {
    const anchor = (event.target as Element).closest(
      "a[href],[data-zmd-wikilink]",
    );
    if (!anchor) return;
    event.preventDefault();
    const href = domHref(anchor);
    if (href) {
      const sourceItemID = previewItemID;
      hide();
      onOpen(href, sourceItemID);
    }
  });
  open.addEventListener("click", () => {
    const href = openingHref;
    hide();
    onOpen(href);
  });
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", onWindowDismiss);
  // Focusing the embedded PDF blurs chrome without deactivating its window.
  win.addEventListener("deactivate", onWindowDismiss);
  win.addEventListener("focus", onWindowFocus);

  function bindLinks(host: HTMLElement) {
    let timer: number | undefined;
    let hovered: Element | null = null;
    const cancel = () => {
      if (timer !== undefined) win.clearTimeout(timer);
      timer = undefined;
    };
    const enter = (event: Event) => {
      const node = (event.target as Element)?.closest?.(
        "a[href],[data-zmd-wikilink],[data-zmd-preview-href]",
      );
      if (!node || !host.contains(node)) return;
      if (node === hovered) return;
      cancel();
      hovered = node;
      const href = domHref(node);
      if (!href || !isPreviewLink(href)) return;
      timer = win.setTimeout(() => {
        timer = undefined;
        if (node.isConnected && hovered === node)
          show({ href, rect: node.getBoundingClientRect() });
      }, 300);
    };
    const exit = (event: Event) => {
      if (hovered?.contains((event as MouseEvent).relatedTarget as Node))
        return;
      cancel();
      hovered = null;
      leave();
    };
    host.addEventListener("mouseover", enter);
    host.addEventListener("mouseout", exit);
    host.addEventListener("focusin", enter);
    host.addEventListener("focusout", exit);
    const unbind = () => {
      cancel();
      host.removeEventListener("mouseover", enter);
      host.removeEventListener("mouseout", exit);
      host.removeEventListener("focusin", enter);
      host.removeEventListener("focusout", exit);
      bindings.delete(unbind);
    };
    bindings.add(unbind);
    return unbind;
  }
  function dispose() {
    if (disposed) return;
    hide();
    disposed = true;
    for (const unbind of bindings) unbind();
    unsubscribe();
    if (observer !== undefined) Zotero.Notifier.unregisterObserver(observer);
    loader.dispose();
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("resize", onWindowDismiss);
    win.removeEventListener("deactivate", onWindowDismiss);
    win.removeEventListener("focus", onWindowFocus);
    panel.remove();
  }
  return { show, leave, hide, invalidate, bindLinks, dispose };
}

function domHref(node: Element): string | null {
  const wiki = node.getAttribute("data-zmd-wikilink");
  return (
    node.getAttribute("data-zmd-preview-href") ||
    node.getAttribute("href") ||
    (wiki ? `[[${wiki}]]` : null)
  );
}

export function isPreviewLink(href: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href))
    return /^zotero:\/\/(?:select|open-pdf)\//.test(href);
  return (
    href.startsWith("[[") ||
    /\.(?:md|markdown|mdown|mkd|mkdn)(?:#.*)?$/i.test(href) ||
    href.startsWith("#")
  );
}
