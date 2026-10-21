import { renderMermaid, type MermaidTheme } from "./mermaid";

export interface MermaidLabels {
  loading: string;
  error: string;
  edit: string;
}

const DEFAULT_LABELS: MermaidLabels = {
  loading: "Rendering diagram…",
  error: "Unable to render Mermaid diagram. Check the source below.",
  edit: "Edit Mermaid source",
};

export function mermaidStyles(): string {
  return `
.zmd-mermaid-block { margin:1em 0; max-width:100%; overflow:auto; }
.zmd-mermaid-image { display:block; max-width:100%; height:auto; margin:auto; }
.zmd-mermaid-block[role="button"] { cursor:text; }
.zmd-mermaid-block:focus-visible { outline:2px solid var(--zmd-accent, #476ee7); outline-offset:3px; border-radius:6px; }
.zmd-mermaid-status { padding:.5em .75em; color:var(--zmd-text-muted, currentColor); font:inherit; font-size:.9em; opacity:.8; }
.zmd-mermaid-source { margin:0; white-space:pre; overflow:auto; font-family:monospace; }
.zmd-mermaid-block.is-error { border-left:2px solid var(--zmd-border, #8886); padding-left:.75em; }
.zmd-mermaid-error { color:var(--zmd-text-muted, currentColor); font-size:.9em; }
`;
}

/** Render visible blocks only; each owner disposes its observer and pending work. */
export function mountMermaidBlock(
  container: HTMLElement,
  source: string,
  options: {
    theme: MermaidTheme;
    labels?: MermaidLabels;
    onLayout?: () => void;
    onEdit?: () => void;
  },
): () => void {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const labels = options.labels ?? DEFAULT_LABELS;
  if (!doc.getElementById("zmd-mermaid-styles")) {
    const style = doc.createElement("style");
    style.id = "zmd-mermaid-styles";
    style.textContent = mermaidStyles();
    (doc.head || doc.documentElement).appendChild(style);
  }
  container.classList.add("zmd-mermaid-block");
  container.classList.remove("is-error");
  container.replaceChildren();
  const status = doc.createElement("div");
  status.className = "zmd-mermaid-status";
  status.textContent = labels.loading;
  status.setAttribute("role", "status");
  container.appendChild(status);
  const controller = new AbortController();
  let disposed = false;
  let started = false;
  let observer: IntersectionObserver | undefined;
  const edit = (event: MouseEvent | KeyboardEvent) => {
    if (
      !options.onEdit ||
      ("button" in event && event.button !== 0) ||
      ("key" in event && event.key !== "Enter" && event.key !== " ")
    )
      return;
    event.preventDefault();
    options.onEdit();
  };
  if (options.onEdit) {
    container.setAttribute("role", "button");
    container.tabIndex = 0;
    container.title = labels.edit;
    container.setAttribute("aria-label", labels.edit);
    container.addEventListener("mousedown", edit);
    container.addEventListener("keydown", edit);
  }
  const start = () => {
    if (started || disposed) return;
    started = true;
    observer?.disconnect();
    void renderMermaid(source, {
      document: doc,
      theme: options.theme,
      signal: controller.signal,
    }).then(
      (result) => {
        if (disposed) return;
        const image = doc.createElement("img");
        image.className = "zmd-mermaid-image";
        image.alt = "Mermaid";
        image.addEventListener(
          "load",
          () => {
            if (!disposed) options.onLayout?.();
          },
          { once: true },
        );
        image.src = result.dataUrl;
        container.replaceChildren(image);
        options.onLayout?.();
      },
      (error) => {
        if (disposed || error?.name === "AbortError") return;
        container.classList.add("is-error");
        status.textContent = labels.error;
        const pre = doc.createElement("pre");
        pre.className = "zmd-mermaid-source";
        const code = doc.createElement("code");
        code.textContent = source;
        pre.appendChild(code);
        container.replaceChildren(status, pre);
        options.onLayout?.();
      },
    );
  };
  if (win?.IntersectionObserver) {
    observer = new win.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
      },
      { rootMargin: "200px" },
    );
    observer.observe(container);
  } else {
    start();
  }
  return () => {
    disposed = true;
    controller.abort();
    observer?.disconnect();
    container.removeEventListener("mousedown", edit);
    container.removeEventListener("keydown", edit);
  };
}
