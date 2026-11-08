const READER_URL = "resource://zotero/reader/reader.html";

export interface PdfLinkPreviewLocation {
  pageIndex?: number;
  annotationID?: string;
}

export interface PdfLinkPreviewOptions {
  container: HTMLElement;
  itemID: number;
  location?: PdfLinkPreviewLocation;
  isCurrent(): boolean;
}

interface NativeReaderPreview {
  _open(options: Record<string, never>): Promise<boolean>;
  navigate?(location: PdfLinkPreviewLocation): Promise<void>;
  uninit(): void;
}

interface NativeReaderPreviewAPI {
  openPreview?(
    itemID: number,
    browser: XULBrowserElement,
  ): Promise<NativeReaderPreview>;
}

/** A chrome-only adapter for Zotero's transient, read-only attachment reader. */
export function mountPdfLinkPreview({
  container,
  itemID,
  location,
  isCurrent,
}: PdfLinkPreviewOptions): { ready: Promise<void>; dispose(): void } {
  let disposed = false;
  let browser: XULBrowserElement | undefined;
  let reader: NativeReaderPreview | undefined;
  let opening = false;
  let cancelLoad = () => {};
  let resolveCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    resolveCancelled = resolve;
  });

  const releaseReader = () => {
    const owned = reader;
    reader = undefined;
    if (!owned) return;
    try {
      owned.uninit();
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelLoad();
    // _open can register host observers after an await. Its finally releases
    // an in-flight reader after those registrations, rather than uninit twice.
    if (!opening) releaseReader();
    browser?.remove();
  };

  const dispose = () => {
    cleanup();
    resolveCancelled();
  };

  const current = () => {
    if (!disposed && isCurrent()) return true;
    dispose();
    return false;
  };

  const initialize = async () => {
    try {
      if (!current()) return;
      // openPreview and _open are core attachment-preview interfaces, not a
      // guaranteed plugin API. Keep this capability boundary in one module.
      const api = Zotero.Reader as unknown as
        NativeReaderPreviewAPI | undefined;
      if (!api || typeof api.openPreview !== "function") {
        throw new Error("Native PDF preview is unavailable");
      }
      const doc = container.ownerDocument;
      browser = doc.createXULElement("browser");
      const frame = browser;
      frame.setAttribute("type", "content");
      frame.setAttribute("primary", "true");
      frame.setAttribute("transparent", "transparent");
      frame.setAttribute("flex", "1");
      frame.setAttribute("tabindex", "-1");
      frame.style.cssText =
        "display:block;width:100%;height:100%;border:0;pointer-events:none";

      const loaded = new Promise<boolean>((resolve) => {
        const finish = (success: boolean) => {
          frame.removeEventListener("DOMContentLoaded", onLoad, true);
          cancelLoad = () => {};
          resolve(success);
        };
        const isReady = () => {
          const document = frame.contentDocument;
          return (
            document?.documentURI === READER_URL &&
            (document.readyState === "interactive" ||
              document.readyState === "complete")
          );
        };
        const onLoad = (event: Event) => {
          if (event.target === frame.contentDocument && isReady()) finish(true);
        };
        cancelLoad = () => finish(false);
        frame.addEventListener("DOMContentLoaded", onLoad, true);
        frame.setAttribute("src", READER_URL);
        container.append(frame);
        if (isReady()) finish(true);
      });
      if (!(await loaded) || !current()) return;

      reader = await api.openPreview(itemID, frame);
      if (!current()) {
        releaseReader();
        return;
      }
      if (typeof reader._open !== "function") {
        throw new Error("Native PDF preview initialization is unavailable");
      }
      opening = true;
      try {
        // Preview mode skips PDFView's normal documentinit navigation. Apply
        // locations only after _open has loaded the first page and set its
        // preview layout; annotation selection must not run before that point.
        const success = await reader._open({});
        if (!current()) return;
        if (!success) throw new Error("Native PDF preview could not be loaded");
        if (location) {
          if (typeof reader.navigate !== "function") {
            throw new Error("Native PDF preview navigation is unavailable");
          }
          await reader.navigate(location);
          current();
        }
      } finally {
        opening = false;
        if (disposed) releaseReader();
      }
    } catch (error) {
      if (disposed) return;
      cleanup();
      throw error;
    }
  };

  return { ready: Promise.race([initialize(), cancelled]), dispose };
}
