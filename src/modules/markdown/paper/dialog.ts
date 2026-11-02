import { getString } from "../../../utils/locale";

export interface PaperSettings {
  pandocPath: string;
  styleID: string;
  referenceDoc: string;
}
export interface PaperStyle {
  id: string;
  title: string;
}

/** One modal owned by the export operation; abort releases it and its listeners. */
export function choosePaperSettings(options: {
  mount: HTMLElement;
  initial: PaperSettings;
  styles: PaperStyle[];
  signal: AbortSignal;
  pickFile: (kind: "pandoc" | "template") => Promise<string | null>;
}): Promise<PaperSettings | null> {
  const { mount, signal } = options;
  if (signal.aborted) return Promise.resolve(null);
  const doc = mount.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
    doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];
  const dialog = el("dialog");
  dialog.className = "zotero-markdown-paper-dialog";
  dialog.setAttribute("aria-label", getString("paper-export-title"));
  const form = el("form");
  const heading = el("h2");
  heading.textContent = getString("paper-export-title");
  const hint = el("p");
  hint.textContent = getString("paper-export-hint");
  form.append(heading, hint);
  const field = (label: string) => {
    const wrapper = el("label");
    const text = el("span");
    text.textContent = label;
    wrapper.append(text);
    form.append(wrapper);
    return wrapper;
  };
  const pandoc = el("input");
  pandoc.value = options.initial.pandocPath;
  pandoc.required = true;
  const template = el("input");
  template.value = options.initial.referenceDoc;
  const addFileField = (
    input: HTMLInputElement,
    label: string,
    kind: "pandoc" | "template",
  ) => {
    const row = field(label);
    const group = el("span");
    group.className = "zotero-markdown-paper-file";
    const browse = el("button");
    browse.type = "button";
    browse.textContent = getString("paper-browse");
    browse.addEventListener("click", async () => {
      browse.disabled = true;
      try {
        const path = await options.pickFile(kind);
        if (dialog.isConnected && path) input.value = path;
      } catch (error) {
        if (dialog.isConnected) {
          errorMessage.textContent = String(error);
          errorMessage.hidden = false;
        }
      } finally {
        browse.disabled = false;
      }
    });
    group.append(input, browse);
    row.append(group);
  };
  addFileField(pandoc, getString("paper-pandoc"), "pandoc");
  const style = el("select");
  const defaultStyle = el("option");
  defaultStyle.value = "";
  defaultStyle.textContent = getString("paper-style-default");
  style.append(defaultStyle);
  for (const entry of options.styles) {
    const option = el("option");
    option.value = entry.id;
    option.textContent = entry.title;
    style.append(option);
  }
  style.value = options.initial.styleID;
  if (style.selectedIndex < 0) style.value = "";
  field(getString("paper-style")).append(style);
  addFileField(template, getString("paper-template"), "template");
  const errorMessage = el("p");
  errorMessage.setAttribute("role", "alert");
  errorMessage.hidden = true;
  form.append(errorMessage);
  const footer = el("footer");
  const cancel = el("button");
  cancel.type = "button";
  cancel.textContent = getString("modal-cancel");
  const submit = el("button");
  submit.type = "submit";
  submit.textContent = getString("paper-export-action");
  footer.append(cancel, submit);
  form.append(footer);
  dialog.append(form);
  mount.append(dialog);
  const previous = doc.activeElement;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: PaperSettings | null) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      dialog.close();
      dialog.remove();
      if (previous?.isConnected && "focus" in previous)
        (previous as HTMLElement).focus();
      resolve(result);
    };
    const abort = () => finish(null);
    cancel.addEventListener("click", abort);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (form.reportValidity())
        finish({
          pandocPath: pandoc.value.trim(),
          styleID: style.value,
          referenceDoc: template.value.trim(),
        });
    });
    signal.addEventListener("abort", abort, { once: true });
    dialog.showModal();
  });
}
