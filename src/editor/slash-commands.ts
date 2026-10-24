import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { EditorSlashLabels } from "../modules/markdown/editor-protocol";
import type { ResolvedSlashSearchLanguage } from "../modules/markdown/preferences";
import { linkCompletionPosition } from "./link-completion";

export const SLASH_COMMANDS = [
  {
    id: "reference",
    icon: "[[",
    english: "zotero reference citation note",
    pinyin: "yinyong wenxian biji yy wx bj",
  },
  {
    id: "h1",
    icon: "H1",
    english: "heading title h1",
    pinyin: "biaoti yiji bt h1",
  },
  {
    id: "h2",
    icon: "H2",
    english: "heading title h2",
    pinyin: "biaoti erji bt h2",
  },
  {
    id: "h3",
    icon: "H3",
    english: "heading title h3",
    pinyin: "biaoti sanji bt h3",
  },
  {
    id: "list",
    icon: "≡",
    english: "bulleted unordered list",
    pinyin: "wuxu liebiao lb",
  },
  {
    id: "orderedList",
    icon: "1.",
    english: "numbered ordered list",
    pinyin: "youxu liebiao lb",
  },
  {
    id: "task",
    icon: "☑",
    english: "task todo checklist",
    pinyin: "renwu daiban rw db",
  },
  {
    id: "quote",
    icon: "❞",
    english: "blockquote quote",
    pinyin: "yinyongkuai yy",
  },
  { id: "bold", icon: "B", english: "bold", pinyin: "jiacu cuti jc ct" },
  { id: "italic", icon: "I", english: "italic", pinyin: "xieti xt" },
  {
    id: "code",
    icon: "</>",
    english: "inline code",
    pinyin: "hangnei daima dm",
  },
  {
    id: "codeBlock",
    icon: "```",
    english: "fenced code block",
    pinyin: "daimakuai dm",
  },
  { id: "link", icon: "↗", english: "link url", pinyin: "lianjie lj" },
  { id: "table", icon: "▦", english: "table grid", pinyin: "biaoge bg" },
  {
    id: "image",
    icon: "▧",
    english: "image picture local import",
    pinyin: "tupian bendi daoru tp",
  },
  {
    id: "divider",
    icon: "—",
    english: "horizontal rule divider",
    pinyin: "fengexian fgx",
  },
] as const;

export type SlashCommandID = (typeof SLASH_COMMANDS)[number]["id"];

export const DEFAULT_SLASH_LABELS: EditorSlashLabels = {
  title: "Insert",
  hint: "Type to filter · ↑↓ select · Enter insert · Esc close",
  empty: "No matching commands",
  reference: "Reference literature or notes",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  list: "Bulleted list",
  orderedList: "Numbered list",
  task: "Task list",
  quote: "Block quote",
  bold: "Bold",
  italic: "Italic",
  code: "Inline code",
  codeBlock: "Code block",
  link: "Link",
  table: "Table (3 × 3)",
  image: "Import local image",
  divider: "Divider",
};

export interface SlashQuery {
  from: number;
  to: number;
  query: string;
}

/** A slash starts a command only in an otherwise empty, unindented paragraph. */
export function activeSlashQuery(state: EditorState): SlashQuery | null {
  const selection = state.selection.main;
  if (state.readOnly || !selection.empty || state.selection.ranges.length !== 1)
    return null;
  const line = state.doc.lineAt(selection.head);
  const before = line.text.slice(0, selection.head - line.from);
  const match = /^( {0,3})\/([\p{L}\p{N} -]{0,48})$/u.exec(before);
  if (!match || line.text.slice(before.length).trim()) return null;
  let node = syntaxTree(state).resolveInner(selection.head, -1);
  for (;;) {
    if (
      /^(?:FencedCode|CodeBlock|InlineCode|CodeText|HTMLBlock|Table)$/.test(
        node.name,
      )
    )
      return null;
    if (!node.parent) break;
    node = node.parent;
  }
  // Markdown's frontmatter is rendered separately from Lezer's syntax tree.
  if (state.doc.line(1).text === "---") {
    let closing = 2;
    while (
      closing <= state.doc.lines &&
      !/^(?:---|\.\.\.)\s*$/.test(state.doc.line(closing).text)
    )
      closing++;
    if (closing <= state.doc.lines && line.number <= closing) return null;
  }
  return {
    from: line.from + match[1].length,
    to: selection.head,
    query: match[2],
  };
}

export function matchingSlashCommands(
  query: string,
  labels: EditorSlashLabels,
  language: ResolvedSlashSearchLanguage,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return SLASH_COMMANDS.filter((command) => {
    const text =
      `${labels[command.id]} ${command[language]}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export interface SlashCommandPopup {
  update(query: string, language: ResolvedSlashSearchLanguage): void;
  destroy(): void;
}

let popupSequence = 0;

export function createSlashCommandPopup(options: {
  host: HTMLElement;
  contentDOM: HTMLElement;
  labels: EditorSlashLabels;
  isComposing: () => boolean;
  anchor: () => { left: number; top: number; bottom: number } | null;
  onChoose: (command: SlashCommandID) => void;
  onDismiss: () => void;
}): SlashCommandPopup {
  const { host, contentDOM, labels } = options;
  const doc = host.ownerDocument;
  const win = doc.defaultView!;
  const popup = doc.createElement("div");
  popup.className = "zmd-slash-completion";
  Object.assign(popup.style, {
    position: "fixed",
    visibility: "hidden",
    zIndex: "1000",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    overflow: "hidden",
    borderRadius: "10px",
    background: "var(--zmd-menu-bg, #fff)",
    border: "1px solid var(--zmd-menu-border, #d8dbe0)",
    color: "var(--zmd-menu-text, #24272d)",
    boxShadow: "0 8px 24px var(--zmd-menu-shadow, rgb(0 0 0 / 16%))",
    font: "12px/1.4 system-ui, sans-serif",
  });
  const heading = doc.createElement("div");
  heading.textContent = labels.title;
  Object.assign(heading.style, {
    padding: "9px 12px 6px",
    fontWeight: "600",
    flexShrink: "0",
  });
  const list = doc.createElement("div");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", labels.title);
  list.id = `zmd-slash-options-${++popupSequence}`;
  Object.assign(list.style, {
    overflow: "auto",
    minHeight: "0",
    padding: "3px 5px",
  });
  const hint = doc.createElement("div");
  hint.textContent = labels.hint;
  Object.assign(hint.style, {
    padding: "7px 12px",
    fontSize: "10px",
    flexShrink: "0",
    color: "var(--zmd-menu-disabled, #737985)",
    borderTop: "1px solid var(--zmd-menu-border, #d8dbe0)",
  });
  popup.append(heading, list, hint);
  host.append(popup);
  const previousAria = new Map(
    [
      "aria-controls",
      "aria-expanded",
      "aria-autocomplete",
      "aria-activedescendant",
    ].map((name) => [name, contentDOM.getAttribute(name)]),
  );
  contentDOM.setAttribute("aria-controls", list.id);
  contentDOM.setAttribute("aria-expanded", "true");
  contentDOM.setAttribute("aria-autocomplete", "list");
  let commands = matchingSlashCommands("", labels, "english");
  let rows: HTMLButtonElement[] = [];
  let active = 0;
  let frame: number | null = null;
  let destroyed = false;
  const position = () => {
    frame = null;
    if (destroyed) return;
    const anchor = options.anchor();
    if (!anchor) return options.onDismiss();
    const height = Math.min(
      328,
      Math.max(
        100,
        heading.offsetHeight + list.scrollHeight + hint.offsetHeight + 2,
      ),
    );
    const box = linkCompletionPosition(
      anchor,
      { width: win.innerWidth, height: win.innerHeight },
      height,
    );
    popup.style.width = `${Math.min(340, box.width)}px`;
    popup.style.maxHeight = `${box.height}px`;
    popup.style.left = `${box.left}px`;
    popup.style.top = `${box.top}px`;
    popup.style.visibility = "visible";
  };
  const schedulePosition = () => {
    if (frame === null && !destroyed)
      frame = win.requestAnimationFrame(position);
  };
  const updateActive = (scroll = false) => {
    contentDOM.removeAttribute("aria-activedescendant");
    rows.forEach((row, index) => {
      const selected = index === active;
      row.setAttribute("aria-selected", String(selected));
      row.style.background = selected
        ? "var(--zmd-menu-hover, #eef1f5)"
        : "transparent";
      if (selected) {
        contentDOM.setAttribute("aria-activedescendant", row.id);
        if (scroll) row.scrollIntoView({ block: "nearest" });
      }
    });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !contentDOM.contains(event.target as Node) ||
      options.isComposing() ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key))
      return;
    if (event.key === "Enter" && !commands.length) {
      options.onDismiss();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") options.onDismiss();
    else if (event.key === "Enter") {
      if (commands.length) options.onChoose(commands[active].id);
    } else if (commands.length) {
      active =
        (active + (event.key === "ArrowDown" ? 1 : -1) + commands.length) %
        commands.length;
      updateActive(true);
    }
  };
  const onMouseDown = (event: MouseEvent) => event.preventDefault();
  const onPointerDown = (event: PointerEvent) => {
    if (!host.contains(event.target as Node)) options.onDismiss();
  };
  const onScroll = (event: Event) => {
    if (!popup.contains(event.target as Node)) schedulePosition();
  };
  const onBlur = () => options.onDismiss();
  host.addEventListener("keydown", onKeyDown, true);
  popup.addEventListener("mousedown", onMouseDown);
  doc.addEventListener("pointerdown", onPointerDown);
  doc.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", schedulePosition);
  win.addEventListener("blur", onBlur);
  contentDOM.addEventListener("blur", onBlur);
  return {
    update(query, language) {
      commands = matchingSlashCommands(query, labels, language);
      active = 0;
      rows = [];
      list.replaceChildren();
      for (const command of commands) {
        const row = doc.createElement("button");
        row.type = "button";
        row.tabIndex = -1;
        row.dataset.slashCommand = command.id;
        row.id = `${list.id}-${command.id}`;
        row.setAttribute("role", "option");
        Object.assign(row.style, {
          display: "flex",
          alignItems: "center",
          gap: "10px",
          width: "100%",
          minHeight: "34px",
          padding: "5px 8px",
          border: "0",
          borderRadius: "6px",
          color: "inherit",
          textAlign: "start",
          font: "inherit",
          cursor: "pointer",
        });
        const icon = doc.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = command.icon;
        Object.assign(icon.style, {
          flex: "0 0 25px",
          textAlign: "center",
          fontWeight: "600",
          color: "var(--zmd-menu-disabled, #737985)",
          fontStyle: command.id === "italic" ? "italic" : "normal",
        });
        const label = doc.createElement("span");
        label.textContent = labels[command.id];
        row.append(icon, label);
        const index = rows.length;
        row.addEventListener("pointermove", () => {
          if (!destroyed && !options.isComposing()) {
            active = index;
            updateActive();
          }
        });
        row.addEventListener("click", () => {
          if (!destroyed && !options.isComposing())
            options.onChoose(command.id);
        });
        rows.push(row);
        list.append(row);
      }
      if (!commands.length) {
        const empty = doc.createElement("div");
        empty.setAttribute("role", "status");
        empty.textContent = labels.empty;
        Object.assign(empty.style, {
          padding: "16px 8px",
          color: "var(--zmd-menu-disabled, #737985)",
        });
        list.append(empty);
      }
      updateActive();
      schedulePosition();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) win.cancelAnimationFrame(frame);
      host.removeEventListener("keydown", onKeyDown, true);
      popup.removeEventListener("mousedown", onMouseDown);
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("scroll", onScroll, true);
      win.removeEventListener("resize", schedulePosition);
      win.removeEventListener("blur", onBlur);
      contentDOM.removeEventListener("blur", onBlur);
      for (const [name, value] of previousAria) {
        if (value === null) contentDOM.removeAttribute(name);
        else contentDOM.setAttribute(name, value);
      }
      popup.remove();
    },
  };
}
