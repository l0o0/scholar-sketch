import type { ImageAssetRepairReport, ImageAssetRepairStatus } from "./repair";

export interface ImageRepairDialogLabels {
  title: string;
  description: string;
  inspecting: string;
  repairing: string;
  inspect: string;
  repair: string;
  close: string;
  readOnly: string;
  syncHint: string;
  noImages: string;
  candidates: string;
  unresolved: string;
  source: string;
  target: string;
  statuses: Record<ImageAssetRepairStatus, string>;
  summary: (report: ImageAssetRepairReport) => string;
  retained: (count: number) => string;
  skipped: (count: number) => string;
}

export interface ImageRepairDialogOptions {
  document: Document;
  /** Mount inside the editor root to inherit its theme and modal styles. */
  mount?: HTMLElement;
  labels: ImageRepairDialogLabels;
  /** Inspect saved references only. This callback must never modify files. */
  inspect: () => Promise<ImageAssetRepairReport>;
  /** The caller saves current drafts before invoking the repair service. */
  repair: () => Promise<ImageAssetRepairReport>;
  onClose?: () => void;
}

let dialogSequence = 0;

/** Pure UI: file access and draft coordination belong to the caller. */
export function openImageRepairDialog(options: ImageRepairDialogOptions): {
  destroy: () => void;
} {
  const { document: doc, labels } = options;
  const mount = options.mount || doc.body || doc.documentElement;
  const focusBefore = doc.activeElement as HTMLElement | null;
  const backdrop = doc.createElement("div");
  backdrop.className = "zotero-markdown-modal-backdrop";
  backdrop.dataset.imageRepairDialog = "true";
  const dialog = doc.createElement("section");
  dialog.className = "zotero-markdown-modal";
  dialog.style.inlineSize = "min(620px, 100%)";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;
  const header = doc.createElement("header");
  header.className = "zotero-markdown-modal-header";
  const title = doc.createElement("h2");
  title.className = "zotero-markdown-modal-title";
  title.id = `zmd-image-repair-${++dialogSequence}`;
  title.textContent = labels.title;
  dialog.setAttribute("aria-labelledby", title.id);

  const button = (action: string, text: string, primary = false) => {
    const element = doc.createElement("button");
    element.type = "button";
    element.dataset.imageRepairAction = action;
    element.className = `zotero-markdown-modal-button${primary ? " is-primary" : ""}`;
    element.textContent = text;
    return element;
  };
  const closeButton = button("close", "×");
  closeButton.classList.add("is-close");
  closeButton.setAttribute("aria-label", labels.close);
  header.append(title, closeButton);

  const body = doc.createElement("div");
  body.className = "zotero-markdown-modal-body";
  const description = doc.createElement("p");
  description.style.margin = "0";
  description.id = `${title.id}-description`;
  description.textContent = labels.description;
  dialog.setAttribute("aria-describedby", description.id);
  const status = doc.createElement("p");
  status.style.margin = "0";
  status.dataset.imageRepairState = "inspecting";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const results = doc.createElement("div");
  results.dataset.imageRepairResults = "true";
  results.style.userSelect = "text";
  results.style.overflowWrap = "anywhere";
  const error = doc.createElement("p");
  error.className = "zotero-markdown-modal-error";
  error.style.color = "var(--zmd-code-invalid, var(--zmd-danger))";
  error.setAttribute("role", "alert");
  error.hidden = true;
  const footer = doc.createElement("footer");
  footer.className = "zotero-markdown-modal-footer";
  footer.style.flexWrap = "wrap";
  const inspectButton = button("inspect", labels.inspect);
  const doneButton = button("close", labels.close);
  const repairButton = button("repair", labels.repair, true);
  repairButton.hidden = true;
  footer.append(inspectButton, doneButton, repairButton);
  body.append(description, status, results, error, footer);
  dialog.append(header, body);
  backdrop.append(dialog);
  mount.append(backdrop);

  let destroyed = false;
  let busy = false;
  let currentReport: ImageAssetRepairReport | undefined;

  const paragraph = (text: string) => {
    const element = doc.createElement("p");
    element.textContent = text;
    return element;
  };
  const render = (report: ImageAssetRepairReport) => {
    currentReport = report;
    status.textContent = labels.summary(report);
    status.dataset.imageRepairState = "ready";
    results.replaceChildren();
    if (!report.checked) results.append(paragraph(labels.noImages));
    if (!report.canRepair) results.append(paragraph(labels.readOnly));
    if (report.repaired) results.append(paragraph(labels.syncHint));
    if (report.retainedOriginals)
      results.append(paragraph(labels.retained(report.retainedOriginals)));

    for (const [heading, entries] of [
      [
        labels.candidates,
        report.entries.filter(({ status }) =>
          ["repairable", "repaired"].includes(status),
        ),
      ],
      [
        labels.unresolved,
        report.entries.filter(({ status }) =>
          ["missing", "conflict", "failed"].includes(status),
        ),
      ],
    ] as const) {
      if (!entries.length) continue;
      const section = doc.createElement("section");
      const headingElement = doc.createElement("h3");
      headingElement.textContent = heading;
      headingElement.style.fontSize = "13px";
      const list = doc.createElement("ul");
      list.style.paddingInlineStart = "20px";
      for (const entry of entries) {
        const row = doc.createElement("li");
        row.dataset.imageRepairEntry = entry.status;
        row.style.marginBlockEnd = "12px";
        const name = doc.createElement("strong");
        name.textContent = entry.reference;
        row.append(name, ` · ${labels.statuses[entry.status]}`);
        for (const [label, path] of [
          [labels.source, entry.sourcePath],
          [labels.target, entry.targetPath],
        ]) {
          if (!path) continue;
          const line = doc.createElement("div");
          line.style.fontSize = "12px";
          line.style.color = "var(--zmd-text-muted)";
          line.textContent = `${label}: ${path}`;
          row.append(line);
        }
        if (entry.reason) {
          const reason = paragraph(entry.reason);
          reason.className = "zotero-markdown-modal-error";
          reason.style.color = "var(--zmd-code-invalid, var(--zmd-danger))";
          row.append(reason);
        }
        list.append(row);
      }
      section.append(headingElement, list);
      results.append(section);
    }
    if (report.skippedPaths.length) {
      const details = doc.createElement("details");
      const summary = doc.createElement("summary");
      summary.textContent = labels.skipped(report.skippedPaths.length);
      const list = doc.createElement("ul");
      for (const path of report.skippedPaths) {
        const row = doc.createElement("li");
        row.textContent = path;
        list.append(row);
      }
      details.append(summary, list);
      results.append(details);
    }
    repairButton.hidden = !report.canRepair || !report.repairable;
  };

  const run = async (operation: "inspect" | "repair") => {
    if (destroyed || busy) return;
    if (
      operation === "repair" &&
      (!currentReport?.canRepair || !currentReport.repairable)
    )
      return;
    busy = true;
    dialog.setAttribute("aria-busy", "true");
    inspectButton.disabled = repairButton.disabled = true;
    error.hidden = true;
    error.textContent = "";
    status.dataset.imageRepairState =
      operation === "inspect" ? "inspecting" : "repairing";
    status.textContent =
      operation === "inspect" ? labels.inspecting : labels.repairing;
    try {
      const report = await options[operation]();
      if (!destroyed) render(report);
    } catch (reason) {
      if (destroyed) return;
      // Do not keep offering a repair based on a failed or stale scan.
      currentReport = undefined;
      repairButton.hidden = true;
      status.dataset.imageRepairState = "error";
      status.textContent = "";
      error.textContent =
        reason instanceof Error ? reason.message : String(reason);
      error.hidden = false;
    } finally {
      busy = false;
      if (!destroyed) {
        dialog.setAttribute("aria-busy", "false");
        inspectButton.disabled = repairButton.disabled = false;
        if (doc.activeElement === repairButton && repairButton.hidden)
          inspectButton.focus();
      }
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.defaultView?.removeEventListener("unload", destroy);
    backdrop.remove();
    if (focusBefore?.isConnected && !doc.defaultView?.closed)
      focusBefore.focus?.();
    options.onClose?.();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      destroy();
    } else if (event.key === "Tab") {
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>("button:not([disabled]), summary"),
      ).filter((element) => !element.hidden);
      const first = focusable[0] || dialog;
      const last = focusable[focusable.length - 1] || dialog;
      if (!dialog.contains(doc.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  closeButton.addEventListener("click", destroy);
  doneButton.addEventListener("click", destroy);
  inspectButton.addEventListener("click", () => void run("inspect"));
  repairButton.addEventListener("click", () => void run("repair"));
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) destroy();
  });
  doc.addEventListener("keydown", onKeyDown, true);
  doc.defaultView?.addEventListener("unload", destroy);
  closeButton.focus();
  void run("inspect");
  return { destroy };
}
