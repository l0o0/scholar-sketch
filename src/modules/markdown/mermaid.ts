import { config } from "../../../package.json";
import {
  MAX_MERMAID_SOURCE,
  MAX_MERMAID_SVG,
  MERMAID_MESSAGE_SOURCE,
  type MermaidResult,
  type MermaidTheme,
} from "./mermaid-protocol";

export type { MermaidResult, MermaidTheme } from "./mermaid-protocol";

const renderers = new WeakMap<Document, MermaidRenderer>();
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 32;
const MAX_QUEUE = 64;
const TIMEOUT_MS = 20_000;
const IDLE_MS = 30_000;

interface Request {
  id: number;
  source: string;
  theme: MermaidTheme;
  resolve: (result: MermaidResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
}

function aborted(): Error {
  const error = new Error("Mermaid rendering cancelled");
  error.name = "AbortError";
  return error;
}

/** One lazy, isolated renderer per document; no Mermaid dependency in the editor bundle. */
export class MermaidRenderer {
  private frame?: HTMLIFrameElement;
  private port?: MessagePort;
  private ready = false;
  private current?: Request;
  private queue: Request[] = [];
  private serial = 0;
  private deadline?: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;
  private cache = new Map<string, MermaidResult>();
  private cacheBytes = 0;
  private disposed = false;
  private channel = Math.random().toString(36).slice(2);

  constructor(
    private doc: Document,
    private url = `chrome://${config.addonRef}/content/mermaid/index.html`,
  ) {}

  render(
    source: string,
    theme: MermaidTheme,
    signal?: AbortSignal,
  ): Promise<MermaidResult> {
    if (signal?.aborted) return Promise.reject(aborted());
    if (this.disposed)
      return Promise.reject(new Error("Mermaid renderer is closed"));
    if (source.length > MAX_MERMAID_SOURCE)
      return Promise.reject(new Error("Mermaid diagram is too large"));
    if (!source.trim())
      return Promise.reject(new Error("Mermaid diagram is empty"));
    const key = `${theme}\n${source}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    if (this.queue.length >= MAX_QUEUE)
      return Promise.reject(new Error("Too many pending Mermaid diagrams"));
    if (this.idle) clearTimeout(this.idle);
    return new Promise((resolve, reject) => {
      const request: Request = {
        id: ++this.serial,
        source,
        theme,
        resolve,
        reject,
        signal,
        abort: () => {
          const index = this.queue.indexOf(request);
          if (index >= 0) {
            this.queue.splice(index, 1);
            this.finish(request);
          }
          // An in-flight layout completes in its isolated document; do not let
          // its eventual result modify a widget which no longer exists.
          reject(aborted());
        },
      };
      signal?.addEventListener("abort", request.abort, { once: true });
      this.queue.push(request);
      try {
        this.ensureFrame();
        this.pump();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.fail(new Error("Mermaid renderer is closed"));
    this.cache.clear();
    this.cacheBytes = 0;
    this.doc.defaultView?.removeEventListener("pagehide", this.onPageHide);
    renderers.delete(this.doc);
  }

  private onPageHide = (event: PageTransitionEvent) => {
    // Gecko chrome windows also receive pagehide from child browser frames.
    // Loading/replacing the renderer must not dispose its owning document.
    if (event.target === this.doc || event.target === this.doc.defaultView)
      this.dispose();
  };

  private ensureFrame() {
    if (this.frame) return;
    const win = this.doc.defaultView;
    if (!win) throw new Error("Mermaid requires a browser document");
    const frame = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "iframe",
    ) as HTMLIFrameElement;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("title", "Mermaid renderer");
    // Keep measurable geometry for SVG layout without adding document scroll.
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:1000px;height:800px;border:0;visibility:hidden;pointer-events:none;";
    frame.src = `${this.url}#${this.channel}`;
    this.frame = frame;
    const connect = () => {
      if (this.frame !== frame || this.disposed) return;
      let transferredPort: MessagePort | undefined;
      try {
        this.port?.close();
        const connection = new win.MessageChannel();
        this.port = connection.port1;
        transferredPort = connection.port2;
        this.port.onmessage = (event) => this.onMessage(event as MessageEvent);
        this.port.start();
        // The opaque sandbox cannot access a privileged Gecko parent's
        // postMessage. A private MessagePort crosses that boundary safely.
        if (!frame.contentWindow)
          throw new Error("Mermaid renderer window is unavailable");
        frame.contentWindow.postMessage(
          {
            source: MERMAID_MESSAGE_SOURCE,
            channel: this.channel,
            type: "connect",
          },
          "*",
          [transferredPort],
        );
      } catch (error) {
        transferredPort?.close();
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    };
    // In Gecko chrome, sandboxed document load reaches the iframe in capture.
    frame.addEventListener("load", connect, { capture: true, once: true });
    win.addEventListener("pagehide", this.onPageHide);
    this.deadline = setTimeout(
      () => this.fail(new Error("Mermaid renderer could not be loaded")),
      TIMEOUT_MS,
    );
    (this.doc.body || this.doc.documentElement).appendChild(frame);
  }

  private onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (
      !data ||
      data.source !== MERMAID_MESSAGE_SOURCE ||
      data.channel !== this.channel
    )
      return;
    if (data.type === "ready") {
      if (this.ready) return;
      this.ready = true;
      clearTimeout(this.deadline);
      this.pump();
      return;
    }
    const request = this.current;
    if (data.type !== "result" || !request || data.id !== request.id) return;
    clearTimeout(this.deadline);
    this.current = undefined;
    this.finish(request);
    if (
      typeof data.svg === "string" &&
      data.svg.length <= MAX_MERMAID_SVG &&
      /^\s*<svg[\s>]/.test(data.svg)
    ) {
      const result = {
        svg: data.svg,
        dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`,
      };
      const key = `${request.theme}\n${request.source}`;
      this.cache.set(key, result);
      this.cacheBytes += key.length + result.svg.length + result.dataUrl.length;
      while (
        this.cache.size > MAX_CACHE_ENTRIES ||
        this.cacheBytes > MAX_CACHE_BYTES
      ) {
        const first = this.cache.entries().next().value;
        if (!first) break;
        this.cache.delete(first[0]);
        this.cacheBytes -=
          first[0].length + first[1].svg.length + first[1].dataUrl.length;
      }
      if (!request.signal?.aborted) request.resolve(result);
    } else {
      request.reject(new Error("Mermaid diagram could not be rendered"));
    }
    this.pump();
  };

  private pump() {
    if (!this.ready || this.current) return;
    const request = this.queue.shift();
    if (!request) {
      this.idle = setTimeout(() => this.removeFrame(), IDLE_MS);
      return;
    }
    if (request.signal?.aborted) {
      this.finish(request);
      request.reject(aborted());
      this.pump();
      return;
    }
    const cached = this.cache.get(`${request.theme}\n${request.source}`);
    if (cached) {
      this.finish(request);
      request.resolve(cached);
      this.pump();
      return;
    }
    this.current = request;
    this.deadline = setTimeout(
      () => this.fail(new Error("Mermaid rendering timed out")),
      TIMEOUT_MS,
    );
    this.port?.postMessage({
      source: MERMAID_MESSAGE_SOURCE,
      channel: this.channel,
      type: "render",
      id: request.id,
      text: request.source,
      theme: request.theme,
    });
  }

  private finish(request: Request) {
    request.signal?.removeEventListener("abort", request.abort);
  }

  private fail(error: Error) {
    for (const request of [
      ...(this.current ? [this.current] : []),
      ...this.queue,
    ]) {
      this.finish(request);
      request.reject(error);
    }
    this.queue = [];
    this.current = undefined;
    this.removeFrame();
  }

  private removeFrame() {
    clearTimeout(this.deadline);
    clearTimeout(this.idle);
    this.port?.close();
    this.port = undefined;
    this.frame?.remove();
    this.frame = undefined;
    this.ready = false;
  }
}

export function renderMermaid(
  source: string,
  options: {
    document: Document;
    theme: MermaidTheme;
    signal?: AbortSignal;
  },
): Promise<MermaidResult> {
  let renderer = renderers.get(options.document);
  if (!renderer) {
    renderer = new MermaidRenderer(options.document);
    renderers.set(options.document, renderer);
  }
  return renderer.render(source, options.theme, options.signal);
}
