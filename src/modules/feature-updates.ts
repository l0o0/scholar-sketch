import { getPref, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { openReleaseNotes, openUserGuide } from "./help";
import { featureUpdateVersion, releaseHighlights } from "./release-highlights";

const disposers = new Set<() => void>();
const checks = new Set<() => void>();
const shownVersions = new Set<string>();
let suspended = 0;
let stopped = false;
let activeCard: (() => void) | undefined;

export interface FeatureUpdateSurface {
  win: Window;
  root: HTMLElement;
  isActive: () => boolean;
  ready: Promise<unknown>;
}

function hasSeen(version: string) {
  if (shownVersions.has(version)) return true;
  try {
    return getPref("featureUpdatesSeenVersion") === version;
  } catch {
    return false;
  }
}

function markSeen(version: string) {
  shownVersions.add(version);
  try {
    setPref("featureUpdatesSeenVersion", version);
  } catch (error) {
    if (typeof ztoolkit !== "undefined")
      ztoolkit.log("Could not remember feature update notice", error);
  }
}

function visibleSurface({ win, root, isActive }: FeatureUpdateSurface) {
  if (
    win.closed ||
    !root.isConnected ||
    root.inert ||
    win.document.visibilityState === "hidden" ||
    !win.document.hasFocus() ||
    !isActive()
  )
    return false;
  const box = root.getBoundingClientRect();
  const style = win.getComputedStyle(root);
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.bottom > 0 &&
    box.right > 0 &&
    box.top < win.innerHeight &&
    box.left < win.innerWidth &&
    style?.visibility !== "hidden" &&
    style?.display !== "none"
  );
}

/** Resume only once the whole workspace has restored its final active surface. */
export function suspendFeatureUpdates(): () => void {
  if (stopped) return () => {};
  suspended++;
  for (const check of checks) check();
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    suspended = Math.max(0, suspended - 1);
    if (stopped) return;
    for (const check of checks) check();
  };
}

/** Attach only to a real editor surface; loading failure never consumes a version. */
export function bindFeatureUpdates(surface: FeatureUpdateSurface): () => void {
  if (stopped) return () => {};
  const { win, root } = surface;
  const doc = win.document;
  const version = featureUpdateVersion();
  if (hasSeen(version)) return () => {};
  let disposed = false;
  let ready = false;
  let timer: number | undefined;
  let closeCard: (() => void) | undefined;
  let observerID: string | undefined;
  let resize: ResizeObserver | undefined;
  let intersection: IntersectionObserver | undefined;
  let intersecting: boolean | undefined;
  const eligible = () => intersecting !== false && visibleSurface(surface);

  const cancelTimer = () => {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelTimer();
    closeCard?.();
    resize?.disconnect();
    intersection?.disconnect();
    doc.removeEventListener("visibilitychange", check);
    win.removeEventListener("focus", check, true);
    win.removeEventListener("blur", check, true);
    win.removeEventListener("resize", check);
    win.removeEventListener("pagehide", onPageHide, true);
    try {
      if (observerID !== undefined)
        Zotero.Notifier.unregisterObserver(observerID);
    } catch {
      // Host notifier shutdown can precede plugin cleanup.
    }
    checks.delete(check);
    disposers.delete(dispose);
  };
  const check = () => {
    if (disposed || stopped) return;
    if (suspended || !ready || !eligible()) {
      cancelTimer();
      if (closeCard) dispose();
      return;
    }
    if (closeCard) return;
    if (hasSeen(version)) {
      dispose();
      return;
    }
    if (timer !== undefined) return;
    // Let tab selection/layout settle, then validate again before claiming it.
    timer = win.setTimeout(() => {
      timer = undefined;
      if (disposed || stopped || suspended || !ready || !eligible()) return;
      if (hasSeen(version)) {
        dispose();
        return;
      }
      closeCard = mountCard(win, dispose);
      if (closeCard) markSeen(version);
    }, 700);
  };
  const onPageHide = (event: Event) => {
    // Gecko delivers descendant iframe lifecycle events to chrome windows.
    if (event.target === doc || event.target === win) dispose();
  };

  disposers.add(dispose);
  checks.add(check);
  doc.addEventListener("visibilitychange", check);
  win.addEventListener("focus", check, true);
  win.addEventListener("blur", check, true);
  win.addEventListener("resize", check);
  win.addEventListener("pagehide", onPageHide, true);
  try {
    observerID = Zotero.Notifier.registerObserver(
      {
        notify: (event, type) => {
          if (event === "select" && type === "tab") check();
        },
      },
      ["tab"],
      "scholar-sketch-feature-updates",
    );
  } catch {
    // Focus and layout events still cover windows without Zotero tabs.
  }
  try {
    const Observer = (win as Window & typeof globalThis).ResizeObserver;
    resize = new Observer(check);
    resize.observe(root);
  } catch {
    /* Older hosts still have focus and resize events. */
  }
  try {
    const Observer = (win as Window & typeof globalThis).IntersectionObserver;
    intersection = new Observer((entries) => {
      for (const entry of entries) {
        if (entry.target === root) intersecting = entry.isIntersecting;
      }
      check();
    });
    intersection.observe(root);
  } catch {
    /* Visibility is also checked synchronously before presentation. */
  }
  void surface.ready.then(
    () => {
      ready = true;
      check();
    },
    () => dispose(),
  );
  return dispose;
}

/** Settings can always reopen the current release, even after dismissal. */
export function showFeatureUpdates(win: Window): () => void {
  if (stopped) return () => {};
  const close = mountCard(win);
  if (close) markSeen(featureUpdateVersion());
  return close ?? (() => {});
}

export function disposeFeatureUpdates(): void {
  stopped = true;
  for (const dispose of [...disposers]) dispose();
  activeCard?.();
}

function mountCard(
  win: Window,
  onClose?: () => void,
): (() => void) | undefined {
  const doc = win.document;
  if (win.closed || !doc.documentElement?.isConnected) return;
  activeCard?.();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const host = el("aside");
  host.className = "scholar-feature-updates";
  host.setAttribute("role", "region");
  const title = getString("feature-updates-title", {
    args: { version: featureUpdateVersion() },
  });
  host.setAttribute("aria-label", title);
  const style = el("style", cardStyles);
  const closeButton = el("button", "×");
  closeButton.type = "button";
  closeButton.className = "ss-update-close";
  closeButton.setAttribute("aria-label", getString("feature-updates-close"));
  const heading = el("h2", title);
  const highlights = releaseHighlights();
  const introduction = el(
    "p",
    getString(
      highlights?.overview
        ? "feature-updates-current-description"
        : highlights?.features.length === 0
          ? "feature-updates-maintenance-description"
          : "feature-updates-description",
    ),
  );
  introduction.className = "ss-update-introduction";
  const list = el("ul");
  for (const feature of highlights?.features ?? []) {
    const item = el("li");
    item.append(
      el("strong", getString(feature.title)),
      el("span", getString(feature.body)),
    );
    list.append(item);
  }
  const footer = el("div");
  footer.className = "ss-update-actions";
  const guide = el("button", getString("feature-updates-guide"));
  const releaseNotes = el("button", getString("feature-updates-release-notes"));
  const dismiss = el("button", getString("feature-updates-dismiss"));
  for (const button of [guide, releaseNotes, dismiss]) button.type = "button";
  dismiss.className = "ss-update-dismiss";
  footer.append(guide, releaseNotes, dismiss);
  host.append(style, closeButton, heading, introduction, list, footer);

  let disposed = false;
  const theme = win.matchMedia?.("(prefers-color-scheme: dark)");
  const syncTheme = () => {
    let preference: unknown;
    try {
      preference = getPref("theme");
    } catch {
      /* System fallback. */
    }
    const documentDark =
      /dark/i.test(
        doc.documentElement.getAttribute("data-theme") ||
          doc.documentElement.getAttribute("theme") ||
          "",
      ) || doc.documentElement.classList.contains("theme-dark");
    host.classList.toggle(
      "ss-update-dark",
      preference === "dark" ||
        (preference !== "light" && (!!theme?.matches || documentDark)),
    );
  };
  const Observer = (win as Window & typeof globalThis).MutationObserver;
  const observer = new Observer(syncTheme);
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ["class", "theme", "data-theme"],
  });
  const close = () => {
    if (disposed) return;
    disposed = true;
    host.remove();
    observer.disconnect();
    theme?.removeEventListener?.("change", syncTheme);
    win.removeEventListener("pagehide", onPageHide, true);
    disposers.delete(close);
    if (activeCard === close) activeCard = undefined;
    onClose?.();
  };
  const onPageHide = (event: Event) => {
    if (event.target === doc || event.target === win) close();
  };
  guide.addEventListener("click", () => {
    void openUserGuide();
  });
  releaseNotes.addEventListener("click", () => openReleaseNotes());
  dismiss.addEventListener("click", close);
  closeButton.addEventListener("click", close);
  theme?.addEventListener?.("change", syncTheme);
  win.addEventListener("pagehide", onPageHide, true);
  syncTheme();
  doc.documentElement.append(host);
  // Appending this non-modal card intentionally leaves editor/IME focus alone.
  activeCard = close;
  disposers.add(close);
  return close;
}

const cardStyles = `
.scholar-feature-updates { position: fixed; z-index: 2147483000; right: 20px; bottom: 28px; width: 380px; max-width: calc(100vw - 40px); max-height: calc(100vh - 70px); overflow: auto; box-sizing: border-box; padding: 22px; border: 1px solid rgba(30,40,55,.12); border-radius: 16px; background: #fff; color: #252a32; box-shadow: 0 12px 48px rgba(21,30,43,.16), 0 2px 8px rgba(21,30,43,.05); font: 13px/1.55 system-ui, sans-serif; text-align: left; animation: ss-update-in 180ms ease-out; }
.scholar-feature-updates.ss-update-dark { background: #292c30; color: #eceef2; border-color: rgba(255,255,255,.12); box-shadow: 0 12px 48px rgba(0,0,0,.38); color-scheme: dark; }
.scholar-feature-updates h2 { margin: 0 28px 5px 0; font-size: 16px; line-height: 1.4; font-weight: 650; color: inherit; }
.scholar-feature-updates .ss-update-introduction { margin: 0 0 16px; color: #737984; font-size: 12px; }
.scholar-feature-updates.ss-update-dark .ss-update-introduction { color: #afb5bf; }
.scholar-feature-updates ul { display: flex; flex-direction: column; gap: 13px; margin: 0; padding: 0; list-style: none; }
.scholar-feature-updates li { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; }
.scholar-feature-updates li strong { font-size: 13px; font-weight: 600; }
.scholar-feature-updates li span { color: #626a76; font-size: 12px; }
.scholar-feature-updates.ss-update-dark li span { color: #bfc4cd; }
.scholar-feature-updates button { appearance: none; -moz-appearance: none; border: 0; border-radius: 7px; padding: 7px 9px; margin: 0; min-width: 0; font: inherit; font-size: 12px; cursor: pointer; background: transparent; color: inherit; }
.scholar-feature-updates button:hover { background: rgba(90,105,130,.10); }
.scholar-feature-updates.ss-update-dark button:hover { background: rgba(255,255,255,.09); }
.scholar-feature-updates button:focus-visible { outline: 2px solid #497ed5; outline-offset: 2px; }
.scholar-feature-updates .ss-update-close { position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; padding: 0; font-size: 22px; line-height: 1; color: #838a95; }
.scholar-feature-updates .ss-update-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding-top: 17px; margin-top: 17px; border-top: 1px solid rgba(90,105,130,.14); }
.scholar-feature-updates .ss-update-actions button { white-space: normal; }
.scholar-feature-updates .ss-update-dismiss { margin-left: auto; padding-inline: 12px; background: #edf1f7; font-weight: 600; }
.scholar-feature-updates.ss-update-dark .ss-update-dismiss { background: #3b424d; }
@keyframes ss-update-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .scholar-feature-updates { animation: none; } }
`;
