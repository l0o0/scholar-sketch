import { getString } from "../../utils/locale";
import type { MarkdownAnnotation } from "./annotations";

export const annotationTypeLabels = {
  highlight: "whiteboard-annotation-type-highlight",
  underline: "whiteboard-annotation-type-underline",
  note: "whiteboard-annotation-type-note",
  text: "whiteboard-annotation-type-text",
  image: "whiteboard-annotation-type-image",
  ink: "whiteboard-annotation-type-ink",
} as const;

export function annotationTypeLabel(type = "") {
  return type in annotationTypeLabels
    ? getString(annotationTypeLabels[type as keyof typeof annotationTypeLabels])
    : getString("whiteboard-annotation-browser-title");
}

export function annotationDialogElements(doc: Document) {
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "") => {
    const node = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];
    node.className = cls;
    return node;
  };
  const button = (label: string, cls = "") => {
    const node = element("button", cls);
    node.type = "button";
    node.textContent = label;
    return node;
  };
  return { element, button };
}

export function createAnnotationDialogHeader(
  win: Window,
  dialog: HTMLDialogElement,
  title: string,
  guidance: string,
): HTMLElement {
  const doc = win.document;
  const { element, button } = annotationDialogElements(doc);
  const header = element("header");
  const heading = element("h2");
  heading.textContent = title;
  const actions = element("div", "ss-annotation-header-actions");
  const help = element("div", "ss-annotation-help");
  const helpButton = button("", "ss-annotation-help-trigger");
  helpButton.setAttribute("aria-label", getString("annotation-export-help"));
  const mark = element("span");
  mark.textContent = "?";
  mark.setAttribute("aria-hidden", "true");
  helpButton.append(mark);
  const hint = element("p", "ss-annotation-guidance");
  hint.id = `ss-annotation-guidance-${win.crypto.randomUUID()}`;
  hint.setAttribute("role", "tooltip");
  hint.textContent = guidance;
  hint.hidden = true;
  helpButton.setAttribute("aria-describedby", hint.id);
  help.append(helpButton, hint);
  help.addEventListener("pointerenter", () => {
    hint.hidden = false;
  });
  help.addEventListener("pointerleave", () => {
    if (!help.contains(doc.activeElement)) hint.hidden = true;
  });
  help.addEventListener("focusin", () => {
    hint.hidden = false;
  });
  help.addEventListener("focusout", () => {
    if (!help.matches(":hover")) hint.hidden = true;
  });
  helpButton.addEventListener("click", () => {
    hint.hidden = false;
  });
  const close = button("×", "ss-annotation-close");
  close.setAttribute("aria-label", getString("file-history-close"));
  close.addEventListener("click", () => dialog.close());
  actions.append(help, close);
  header.append(heading, actions);
  dialog.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      hint.hidden ||
      event.defaultPrevented ||
      dialog.querySelector(".ss-annotation-colors:not([hidden])")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    hint.hidden = true;
  });
  return header;
}

export const annotationColor = (annotation: MarkdownAnnotation) =>
  annotation.color?.trim().toLowerCase() || "";

/** The caller owns selected colors; the mounted dialog owns these listeners. */
export function createAnnotationColorPicker(
  win: Window,
  dialog: HTMLDialogElement,
  selected: Set<string>,
  onChange: () => void,
) {
  const doc = win.document;
  const { element, button } = annotationDialogElements(doc);
  const picker = element("div", "ss-annotation-color-picker");
  const trigger = button("", "ss-annotation-color-trigger");
  const label = getString("whiteboard-annotation-color-filter");
  trigger.setAttribute("aria-label", label);
  trigger.title = label;
  trigger.setAttribute("aria-haspopup", "dialog");
  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    icon.setAttribute(name, value);
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4c-.8-.8-.2-2.1.9-2.1H17a4 4 0 0 0 4-4A8.5 8.5 0 0 0 12 3Z",
  );
  icon.append(path);
  for (const [x, y] of [
    [7, 11],
    [10, 7],
    [15, 7],
  ]) {
    const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", "1");
    icon.append(circle);
  }
  const count = element("span");
  trigger.append(icon, count);
  const palette = element("div", "ss-annotation-colors");
  palette.id = `ss-annotation-colors-${win.crypto.randomUUID()}`;
  palette.setAttribute("role", "dialog");
  palette.setAttribute("aria-label", label);
  trigger.setAttribute("aria-controls", palette.id);
  const setOpen = (open: boolean) => {
    palette.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open)
      palette
        .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus();
  };
  setOpen(false);
  trigger.addEventListener("click", () => setOpen(palette.hidden === true));
  // Gecko may blur the old control without focusing the clicked color.
  picker.addEventListener("mousedown", (event) => {
    const control = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (event.button === 0 && control) {
      event.preventDefault();
      control.focus();
    }
  });
  dialog.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target as Node)) setOpen(false);
  });
  dialog.addEventListener("focusin", (event) => {
    if (!picker.contains(event.target as Node)) setOpen(false);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || palette.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    trigger.focus();
  });
  const all = button(
    getString("whiteboard-annotation-all-colors"),
    "ss-annotation-all-colors",
  );
  all.addEventListener("click", () => {
    selected.clear();
    onChange();
  });
  const grid = element("div", "ss-annotation-color-grid");
  palette.append(all, grid);
  picker.append(trigger, palette);
  let previous = "";
  const buttons = new Map<string, HTMLButtonElement>();
  return {
    element: picker,
    close: () => setOpen(false),
    sync(available: readonly string[], disabled: boolean) {
      const identity = available.join(",");
      if (identity !== previous) {
        const focusedColor = [...buttons].find(
          ([, control]) => control === doc.activeElement,
        )?.[0];
        previous = identity;
        grid.replaceChildren();
        buttons.clear();
        grid.style.gridTemplateColumns = `repeat(${Math.min(5, available.length) || 1}, 28px)`;
        for (const color of available) {
          const control = button("", "ss-annotation-color");
          control.setAttribute("aria-label", `${label} ${color}`);
          control.title = color.toUpperCase();
          const swatch = element("span");
          swatch.style.backgroundColor = color;
          control.append(swatch);
          control.addEventListener("click", () => {
            if (selected.has(color)) selected.delete(color);
            else selected.add(color);
            onChange();
          });
          buttons.set(color, control);
          grid.append(control);
        }
        if (focusedColor) (buttons.get(focusedColor) ?? all).focus();
      }
      trigger.disabled = disabled || !available.length;
      trigger.dataset.filtered = String(selected.size > 0);
      count.textContent = String(selected.size);
      count.hidden = !selected.size;
      all.setAttribute("aria-pressed", String(!selected.size));
      all.disabled = disabled;
      for (const [color, control] of buttons) {
        control.disabled = disabled;
        control.setAttribute("aria-pressed", String(selected.has(color)));
      }
      if (disabled) setOpen(false);
    },
  };
}

export function createAnnotationCard(
  doc: Document,
  annotation: MarkdownAnnotation,
  options: {
    checked: boolean;
    disabled: boolean;
    onChange: (selected: boolean) => void;
    showSource?: boolean;
    open?: () => void;
  },
): HTMLElement {
  const { element, button } = annotationDialogElements(doc);
  const card = element("article", "ss-annotation-card");
  if (annotation.color) card.style.borderInlineStartColor = annotation.color;
  const label = element("label");
  const check = element("input");
  check.type = "checkbox";
  check.checked = options.checked;
  check.disabled = options.disabled;
  const page = annotation.pageLabel || annotation.page || "—";
  check.setAttribute(
    "aria-label",
    `${options.showSource ? `${annotation.sourceTitle || annotation.attachmentTitle} · ` : ""}${annotationTypeLabel(annotation.type)} · ${getString("whiteboard-annotation-page")} ${page}`,
  );
  check.addEventListener("change", () => options.onChange(check.checked));
  const content = element("span", "ss-annotation-content");
  if (options.showSource) {
    const source = element("span", "ss-annotation-card-source");
    source.textContent = [
      annotation.sourceTitle || annotation.attachmentTitle,
      annotation.sourceCreator,
      annotation.sourceYear,
    ]
      .filter(Boolean)
      .join(" · ");
    content.append(source);
  }
  const meta = element("span", "ss-annotation-meta");
  meta.textContent = `${annotationTypeLabel(annotation.type)} · ${getString("whiteboard-annotation-page")}：${page}`;
  if (
    options.showSource &&
    annotation.sourceTitle !== annotation.attachmentTitle
  )
    meta.textContent = `${annotation.attachmentTitle} · ${meta.textContent}`;
  content.append(meta);
  if (annotation.text) {
    const quote = element("span", "ss-annotation-text");
    quote.textContent = annotation.text;
    content.append(quote);
  }
  if (annotation.comment) {
    const comment = element("span", "ss-annotation-comment");
    comment.textContent = annotation.comment;
    content.append(comment);
  }
  if (annotation.tags?.length) {
    const tags = element("span", "ss-annotation-tags");
    tags.textContent = annotation.tags.map((tag) => `#${tag}`).join("  ");
    content.append(tags);
  }
  label.append(check, content);
  card.append(label);
  if (
    [annotation.text, annotation.comment].some(
      (value) => value.length > 240 || value.split("\n").length > 4,
    )
  ) {
    card.classList.add("is-collapsed");
    const expand = button(
      getString("whiteboard-expand-quote"),
      "ss-annotation-expand",
    );
    expand.setAttribute("aria-expanded", "false");
    expand.addEventListener("click", () => {
      const collapsed = card.classList.toggle("is-collapsed");
      expand.textContent = getString(
        collapsed ? "whiteboard-expand-quote" : "whiteboard-collapse-quote",
      );
      expand.setAttribute("aria-expanded", String(!collapsed));
    });
    card.append(expand);
  }
  if (options.open) {
    const open = button(
      `${getString("whiteboard-annotation-page")} ${page} ↗`,
      "ss-annotation-location",
    );
    open.setAttribute(
      "aria-label",
      `${getString("markdown-annotation-open-source")} · ${annotation.attachmentTitle} · ${page}`,
    );
    open.disabled = options.disabled;
    open.addEventListener("click", options.open);
    card.append(open);
  }
  return card;
}
