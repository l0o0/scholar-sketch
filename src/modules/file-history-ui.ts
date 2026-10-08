import { getString } from "../utils/locale";
import { readFileVersions } from "./file-safety";

/** Restore to a separate file, so an open editor can never overwrite a recovery. */
export async function showFileHistory(win: Window, item: Zotero.Item) {
  const versions = await readFileVersions(item);
  const doc = win.document;
  const previousFocus = doc.activeElement as HTMLElement | null;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
    doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];
  const dialog = element("dialog");
  dialog.style.cssText =
    "width:min(760px,85vw);max-height:85vh;padding:24px;border:1px solid GrayText;border-radius:10px;background:Canvas;color:CanvasText;";
  dialog.setAttribute("aria-label", getString("file-history"));
  const title = element("h2");
  title.textContent = getString("file-history");
  const description = element("p");
  description.textContent = getString("file-history-description");
  const select = element("select");
  select.style.cssText = "width:100%;margin-bottom:12px";
  select.setAttribute("aria-label", getString("file-history-version"));
  for (const version of versions) {
    const option = element("option");
    option.value = version.id;
    const label =
      version.kind === "draft"
        ? "file-history-draft"
        : version.kind === "conflict"
          ? "file-history-conflict"
          : "file-history-saved";
    option.textContent = `${new Date(version.created).toLocaleString()} · ${getString(label)}`;
    select.append(option);
  }
  const preview = element("textarea");
  preview.readOnly = true;
  preview.setAttribute("aria-label", getString("file-history-preview"));
  preview.style.cssText =
    "display:block;width:100%;height:42vh;box-sizing:border-box;font-family:monospace;white-space:pre;";
  const status = element("p");
  status.setAttribute("role", "status");
  const sync = () => {
    preview.value = versions.find((v) => v.id === select.value)?.content ?? "";
  };
  select.addEventListener("change", sync);
  sync();
  const save = element("button");
  save.type = "button";
  save.textContent = getString("file-history-copy");
  save.disabled = versions.length === 0;
  if (!versions.length) status.textContent = getString("file-history-empty");
  save.addEventListener("click", () => {
    void (async () => {
      save.disabled = true;
      try {
        const content = preview.value;
        const filename = item.attachmentFilename || "recovered.md";
        const extension = filename.split(".").pop() || "md";
        const suggestion =
          filename.replace(/\.[^.]+$/, "") + `-recovered.${extension}`;
        const path = await new ztoolkit.FilePicker(
          getString("file-history-copy"),
          "save",
          [[extension, `*.${extension}`]],
          suggestion,
          win,
        ).open();
        if (!path) return;
        // No replacement, even if the native picker confirmed overwriting.
        await IOUtils.writeUTF8(path, content, { mode: "create", flush: true });
        status.textContent = getString("file-history-copied");
      } catch (error) {
        status.textContent = `${getString("file-history-copy-failed")} ${String(error)}`;
      } finally {
        save.disabled = versions.length === 0;
      }
    })();
  });
  const close = element("button");
  close.type = "button";
  close.style.marginInlineStart = "12px";
  close.textContent = getString("file-history-close");
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      previousFocus?.focus();
    },
    { once: true },
  );
  dialog.append(title, description, select, preview, status, save, close);
  doc.documentElement.append(dialog);
  dialog.showModal();
}

export function registerFileHistoryMenu(
  win: _ZoteroTypes.MainWindow,
  popup: HTMLElement,
  accepts: (item: Zotero.Item) => boolean,
): () => void {
  const menu = win.document.createXULElement("menuitem") as HTMLElement;
  menu.setAttribute("label", getString("file-history"));
  menu.hidden = true;
  const onShowing = () => {
    const items = win.ZoteroPane?.getSelectedItems?.() || [];
    menu.hidden = items.length !== 1 || !accepts(items[0]);
  };
  const onCommand = () => {
    const items = win.ZoteroPane?.getSelectedItems?.() || [];
    if (items.length !== 1 || !accepts(items[0])) return;
    void showFileHistory(win, items[0]).catch((error) => {
      ztoolkit.log("Failed to open file history", error);
      win.alert(`${getString("file-history")}\n${String(error)}`);
    });
  };
  popup.addEventListener("popupshowing", onShowing);
  menu.addEventListener("command", onCommand);
  popup.append(menu);
  return () => {
    popup.removeEventListener("popupshowing", onShowing);
    menu.remove();
  };
}
