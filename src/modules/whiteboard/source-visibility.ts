import type { WhiteboardSession } from "./session-registry";

/** Pause new source lookups, keeping the editor and its saving lifecycle alive. */
export function bindWhiteboardSourceVisibility(session: WhiteboardSession) {
  const { win, surface, tabID } = session;
  const root = session.view?.root;
  const doc = root?.ownerDocument ?? win.document;
  let intersecting = true; // Unknown layout is visible until the first observation.
  let disposed = false;
  let paused: boolean | undefined;
  let observerID: string | undefined;
  let intersection: IntersectionObserver | undefined;

  const sync = () => {
    if (disposed) return;
    const selectedID = (win as _ZoteroTypes.MainWindow).Zotero_Tabs?.selectedID;
    const inactiveTab =
      observerID !== undefined &&
      (surface ?? "tab") === "tab" &&
      typeof selectedID === "string" &&
      selectedID !== tabID;
    const next =
      win.closed ||
      doc.visibilityState === "hidden" ||
      !intersecting ||
      inactiveTab;
    if (paused === next) return;
    paused = next;
    session.sourceScheduler?.setPaused(next);
  };

  // Tab notifications are global; always inspect this session's own window.
  if ((surface ?? "tab") === "tab") {
    try {
      observerID = Zotero.Notifier?.registerObserver(
        {
          notify: (event, type) => {
            if (event === "select" && type === "tab") sync();
          },
        },
        ["tab"],
        "whiteboard-source-visibility",
      );
    } catch {
      // Without an observer, leave tabs active rather than stranding their queue.
    }
  }
  if (surface === "sidebar" && root) {
    try {
      const Observer = (win as Window & typeof globalThis).IntersectionObserver;
      intersection = new Observer((entries) => {
        for (const entry of entries) {
          if (entry.target === root) intersecting = entry.isIntersecting;
        }
        sync();
      });
      intersection.observe(root);
    } catch {
      // Older hosts without intersection observations keep loading normally.
    }
  }
  doc.addEventListener("visibilitychange", sync);
  win.addEventListener("focus", sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener("visibilitychange", sync);
    win.removeEventListener("focus", sync);
    intersection?.disconnect();
    try {
      if (observerID !== undefined)
        Zotero.Notifier.unregisterObserver(observerID);
    } catch {
      // Native observer teardown may already have run during plugin shutdown.
    }
  };
}
