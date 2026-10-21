export type SaveFeedbackState = "saved" | "dirty" | "saving" | "error";
type FeedbackState = SaveFeedbackState | "busy" | "success" | "warning";

export interface StatusTask {
  update(text: string): void;
  succeed(text: string): void;
  warn(text: string): void;
  fail(text: string): void;
  cancel(): void;
}

export interface StatusFeedback {
  setSave(state: SaveFeedbackState, text: string): void;
  begin(text: string): StatusTask;
  destroy(): void;
}

type Message = { state: FeedbackState; text: string };

const svgNamespace = "http://www.w3.org/2000/svg";
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const iconPaths: Record<FeedbackState, string> = {
  saved: "m5 12 4 4L19 6",
  success: "m5 12 4 4L19 6",
  dirty: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  saving: "M20 12a8 8 0 1 1-8-8",
  busy: "M20 12a8 8 0 1 1-8-8",
  warning:
    "M10.3 4.9 2.6 18.2A1.9 1.9 0 0 0 4.3 21h15.4a1.9 1.9 0 0 0 1.7-2.8L13.7 4.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01",
  error: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M9 9l6 6m0-6-6 6",
};

/** A task owns its notice until completion; save failures always remain visible. */
export function createStatusFeedback(
  element: HTMLElement,
  options: { durationMs?: number } = {},
): StatusFeedback {
  const doc = element.ownerDocument;
  const icon = doc.createElementNS(svgNamespace, "svg");
  icon.setAttribute("class", "zmd-status-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "14");
  icon.setAttribute("height", "14");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.8");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const path = doc.createElementNS(svgNamespace, "path");
  icon.append(path);
  const label = doc.createElementNS(htmlNamespace, "span");
  label.className = "zmd-status-text";

  let saved: Message = {
    state: element.classList.contains("is-error")
      ? "error"
      : element.classList.contains("is-dirty")
        ? "dirty"
        : "saved",
    text: element.textContent ?? "",
  };
  let notice: Message | undefined;
  let generation = 0;
  let destroyed = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const durationMs = options.durationMs ?? 6000;

  element.classList.add("zotero-markdown-save-status", "has-feedback");
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");
  element.replaceChildren(icon, label);

  function clearExpiry() {
    if (expiry !== undefined) {
      clearTimeout(expiry);
      expiry = undefined;
    }
  }

  function render() {
    if (destroyed) return;
    const current = saved.state === "error" ? saved : (notice ?? saved);
    for (const state of Object.keys(iconPaths)) {
      element.classList.toggle(`is-${state}`, state === current.state);
    }
    element.dataset.statusState = current.state;
    element.dataset.statusSource = current === saved ? "save" : "task";
    element.title = current.text;
    path.setAttribute("d", iconPaths[current.state]);
    // Avoid re-announcing an unchanged task when background saves complete.
    if (label.textContent !== current.text) label.textContent = current.text;
  }

  render();

  return {
    setSave(state, text) {
      if (destroyed) return;
      saved = { state, text };
      render();
    },
    begin(text) {
      const taskGeneration = ++generation;
      let completed = false;
      if (!destroyed) {
        clearExpiry();
        notice = { state: "busy", text };
        render();
      }

      function isCurrent() {
        return !destroyed && generation === taskGeneration;
      }

      function finish(state: "success" | "warning" | "error", text: string) {
        if (!isCurrent() || completed) return;
        completed = true;
        notice = { state, text };
        render();
        expiry = setTimeout(() => {
          expiry = undefined;
          if (!isCurrent()) return;
          notice = undefined;
          render();
        }, durationMs);
      }

      return {
        update(text) {
          if (!isCurrent() || completed) return;
          notice = { state: "busy", text };
          render();
        },
        succeed: (text) => finish("success", text),
        warn: (text) => finish("warning", text),
        fail: (text) => finish("error", text),
        cancel() {
          if (!isCurrent()) return;
          generation++;
          clearExpiry();
          notice = undefined;
          render();
        },
      };
    },
    destroy() {
      destroyed = true;
      generation++;
      clearExpiry();
      notice = undefined;
      element.removeAttribute("aria-live");
    },
  };
}
