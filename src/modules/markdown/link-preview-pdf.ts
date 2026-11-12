import type { PdfTextPosition } from "../../utils/pdf-position";

const READER_URL = "resource://zotero/reader/reader.html";

export interface PdfLinkPreviewLocation {
  pageIndex?: number;
  annotationID?: string;
  position?: PdfTextPosition;
}

export interface PdfLinkPreviewOptions {
  container: HTMLElement;
  itemID: number;
  location?: PdfLinkPreviewLocation;
  isCurrent(): boolean;
  onPointerPresence?(inside: boolean): void;
}

export interface PdfLinkPreviewHandle {
  ready: Promise<void>;
  dispose(): void;
  containsEventTarget(target: EventTarget | null): boolean;
}

interface NativeReaderPreview {
  _open(options: Record<string, never>): Promise<boolean>;
  navigate?(location: PdfLinkPreviewLocation): Promise<void>;
  updatePDFAttr?: EventListener;
  uninit(): void;
}

interface PdfPreviewWindow extends Window {
  wrappedJSObject?: {
    PDFViewerApplication?: {
      pdfViewer?: {
        scrollMode: number;
        currentScaleValue: string;
      };
    };
  };
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
  onPointerPresence,
}: PdfLinkPreviewOptions): PdfLinkPreviewHandle {
  let disposed = false;
  let browser: XULBrowserElement | undefined;
  let reader: NativeReaderPreview | undefined;
  let opening = false;
  let cancelLoad = () => {};
  const ownedDocuments = new Set<Document>();
  const unbindListeners: (() => void)[] = [];
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
    for (const unbind of unbindListeners.splice(0)) unbind();
    ownedDocuments.clear();
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

  const containsEventTarget = (target: EventTarget | null) => {
    if (disposed || !target) return false;
    if (target === browser) return true;
    for (const doc of ownedDocuments) {
      if (
        target === doc ||
        target === doc.defaultView ||
        ("ownerDocument" in target && target.ownerDocument === doc)
      )
        return true;
    }
    return false;
  };

  const ownDocument = (document: Document) => {
    ownedDocuments.add(document);
    const enter = () => {
      if (!disposed) onPointerPresence?.(true);
    };
    const leave = (event: Event) => {
      if (
        !disposed &&
        !containsEventTarget((event as PointerEvent).relatedTarget)
      )
        onPointerPresence?.(false);
    };
    document.addEventListener("pointerover", enter, true);
    document.addEventListener("pointerout", leave, true);
    unbindListeners.push(() => {
      document.removeEventListener("pointerover", enter, true);
      document.removeEventListener("pointerout", leave, true);
    });
  };

  const enableScrolling = (
    nativeReader: NativeReaderPreview,
    document: Document,
  ) => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "#primary-view iframe",
    );
    const pdfWindow = iframe?.contentWindow as PdfPreviewWindow | null;
    // Gecko's standard content Window exposes DOM through an Xray wrapper.
    // The trusted packaged viewer's JS engine lives behind wrappedJSObject.
    const viewer = pdfWindow?.wrappedJSObject?.PDFViewerApplication?.pdfViewer;
    const viewport = pdfWindow?.document.getElementById("viewerContainer");
    if (
      !pdfWindow ||
      !viewer ||
      !viewport ||
      typeof nativeReader.updatePDFAttr !== "function"
    )
      throw new Error(
        `Scrollable native PDF preview is unavailable: ${JSON.stringify({
          frame: Boolean(iframe),
          window: Boolean(pdfWindow),
          wrappedWindow: Boolean(pdfWindow?.wrappedJSObject),
          viewer: Boolean(viewer),
          viewport: Boolean(viewport),
          resize: typeof nativeReader.updatePDFAttr === "function",
        })}`,
      );

    // ReaderPreview is a single-page thumbnail: its resize handler restores
    // PAGE mode and its CSS hides overflow. This card owns a continuous view.
    pdfWindow.removeEventListener("resize", nativeReader.updatePDFAttr);
    viewport.style.overflow = "auto";
    viewport.style.overscrollBehavior = "contain";
    const layout = () => {
      viewer.scrollMode = 0;
      viewer.currentScaleValue = "page-width";
    };
    pdfWindow.addEventListener("resize", layout);
    unbindListeners.push(() => pdfWindow.removeEventListener("resize", layout));
    ownDocument(pdfWindow.document);
    layout();
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
      frame.style.cssText = "display:block;width:100%;height:100%;border:0";

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
      const previewDocument = frame.contentDocument!;
      ownDocument(previewDocument);

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
        enableScrolling(reader, previewDocument);
        if (location) {
          if (typeof reader.navigate !== "function") {
            throw new Error("Native PDF preview navigation is unavailable");
          }
          if (location.pageIndex !== undefined && location.annotationID) {
            // Position the page before native annotation scrolling so the
            // annotation's viewport coordinates describe the selected page.
            await reader.navigate({ pageIndex: location.pageIndex });
            if (!current()) return;
          }
          if (location.annotationID) {
            // Preview omits ReaderUI, which normally owns this live region.
            // Native annotation selection still announces into it afterwards.
            if (!previewDocument.getElementById("a11yAnnouncement")) {
              const announcement = previewDocument.createElement("div");
              announcement.id = "a11yAnnouncement";
              announcement.setAttribute("aria-live", "polite");
              announcement.style.cssText =
                "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0";
              previewDocument.body.append(announcement);
            }
            await reader.navigate({ annotationID: location.annotationID });
          } else {
            await reader.navigate(location);
          }
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

  return {
    ready: Promise.race([initialize(), cancelled]),
    dispose,
    containsEventTarget,
  };
}
