import { AnnotationTypeIcon } from "../chrome/AnnotationTypeIcon";
import { IconOpen, IconZotero } from "../whiteboard/icons";
import { IconFile } from "../whiteboard/icons";
import { IconGroup } from "../whiteboard/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { renderMarkdownCore } from "../../../../src/modules/markdown/preview-render-core";
import { mountRenderedMarkdown } from "../../../../src/modules/markdown/preview-dom";
import {
  extractNoteLinks,
  noteLinkLabel,
} from "../../../../src/modules/markdown/note-links";
import { isPdfDocumentLink } from "../../../../src/modules/markdown/document-link-shared";
import type { NodeProps } from "@xyflow/react";
import { getNoteType, getNoteTitle } from "../model/academic";
import {
  useWhiteboardLabels,
  noteTypeLabel,
  noteTypePrompt,
} from "../chrome/labels";
import { nodeTextStyle } from "../whiteboard/document";
import {
  CardShell,
  nodeContentAlignmentStyle,
  nodeSurfaceStyle,
} from "./CardShell";
import type { CanvasFlowNode } from "./types";
import { quoteNodeStyle } from "./annotationStyle";

function citationLine(parts: Array<string | undefined>) {
  const text = parts.filter(Boolean).join(" · ");
  return text ? <p className="zmd-board-card-meta">{text}</p> : null;
}

export function LiteratureNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const labels = useWhiteboardLabels();
  const model = data.model;
  if (model.kind !== "literature") return null;
  const { snapshot } = model;
  return (
    <CardShell
      kind="literature"
      kindLabel={labels.kindLiterature}
      selected={selected}
      nodeStyle={model.style}
      footer={
        snapshot.annotationCount !== undefined ? (
          <p className="zmd-board-card-count">
            {snapshot.annotationCount}{" "}
            {snapshot.annotationCount === 1
              ? labels.annotations.one
              : labels.annotations.other}
          </p>
        ) : null
      }
    >
      <h3
        className="zmd-board-card-title"
        style={nodeTextStyle(model.style ?? {})}
      >
        {snapshot.title}
      </h3>
      {citationLine([snapshot.creators, snapshot.year])}
      {snapshot.publicationTitle ? (
        <p className="zmd-board-card-meta">{snapshot.publicationTitle}</p>
      ) : null}
      {snapshot.tags?.length ? (
        <div className="zmd-board-card-tags">
          {snapshot.tags.slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
    </CardShell>
  );
}

export function QuoteNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const labels = useWhiteboardLabels();
  const model = data.model;
  if (model.kind !== "quote") return null;
  const { snapshot } = model;
  return (
    <CardShell
      kind="quote"
      kindIcon={
        snapshot.annotationType ? (
          <AnnotationTypeIcon type={snapshot.annotationType} />
        ) : undefined
      }
      kindLabel={
        (snapshot.annotationType &&
          labels.annotationTypeLabels?.[snapshot.annotationType]) ||
        labels.kindQuote
      }
      selected={selected}
      nodeStyle={quoteNodeStyle(snapshot, model.style)}
      footer={citationLine([
        snapshot.citation,
        snapshot.pageLabel
          ? `${labels.annotationPage}: ${snapshot.pageLabel}`
          : undefined,
      ])}
    >
      {snapshot.color ? (
        <span
          className="zmd-board-quote-color"
          style={{ backgroundColor: snapshot.color }}
          aria-label={`${labels.annotationColor}: ${snapshot.color}`}
          role="img"
        />
      ) : null}
      {snapshot.image ? (
        <img
          className="zmd-board-annotation-preview"
          src={snapshot.image}
          alt={
            snapshot.annotationType
              ? (labels.annotationTypeLabels?.[snapshot.annotationType] ??
                labels.kindQuote)
              : labels.kindQuote
          }
          draggable={false}
        />
      ) : null}
      {!snapshot.image || snapshot.text || snapshot.comment ? (
        <blockquote
          className="zmd-board-card-content"
          style={nodeTextStyle(model.style ?? {})}
        >
          {snapshot.text ||
            snapshot.comment ||
            labels.annotationNoText ||
            "Open the source to view this annotation"}
        </blockquote>
      ) : null}
      {snapshot.text && snapshot.comment ? (
        <p className="zmd-board-card-comment">{snapshot.comment}</p>
      ) : null}
      {snapshot.tags?.length ? (
        <div className="zmd-board-card-tags">
          {snapshot.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
    </CardShell>
  );
}

interface NotePdfSource {
  href: string;
  caption: string;
}

function NoteSourceAction({ sources }: { sources: NotePdfSource[] }) {
  const labels = useWhiteboardLabels();
  const action = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    host: HTMLElement;
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    above: boolean;
  } | null>(null);
  const multiple = sources.length > 1;
  const openMenu = (button: HTMLButtonElement) => {
    const host = button.closest<HTMLElement>(".zmd-board-host");
    if (!host) return;
    const bounds = host.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    const width = Math.min(320, bounds.width - 16);
    const below = bounds.bottom - anchor.bottom - 8;
    const above =
      below < Math.min(sources.length * 34 + 8, 240) &&
      anchor.top - bounds.top > below;
    setMenu({
      host,
      width,
      left: Math.max(
        8,
        Math.min(anchor.right - bounds.left - width, bounds.width - width - 8),
      ),
      top: above ? anchor.top - bounds.top - 4 : anchor.bottom - bounds.top + 4,
      maxHeight: Math.max(0, above ? anchor.top - bounds.top - 8 : below),
      above,
    });
  };
  useEffect(() => {
    if (!menu) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !action.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      trigger.current?.focus();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [menu]);
  return (
    <span
      ref={action}
      className={`zmd-board-note-source-actions${menu ? " is-open" : ""}`}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        ref={trigger}
        type="button"
        className="zmd-board-note-source-button nodrag nopan"
        title={labels.openSource}
        aria-label={labels.openSource}
        aria-haspopup={multiple ? "menu" : undefined}
        aria-expanded={multiple ? Boolean(menu) : undefined}
        data-zmd-note-source-trigger=""
        data-zmd-note-source={multiple ? undefined : sources[0]?.href}
        onClick={
          multiple
            ? (event) => {
                event.stopPropagation();
                if (menu) setMenu(null);
                else openMenu(event.currentTarget);
              }
            : undefined
        }
        onKeyDown={(event) => {
          if (!multiple || !["ArrowDown", "ArrowUp"].includes(event.key))
            return;
          event.preventDefault();
          event.stopPropagation();
          openMenu(event.currentTarget);
        }}
      >
        <IconOpen />
      </button>
      {menu
        ? createPortal(
            <div
              ref={panel}
              role="menu"
              aria-label={labels.openSource}
              className="zmd-board-context-menu zmd-board-note-source-menu nodrag nopan nowheel"
              style={{
                left: menu.left,
                top: menu.top,
                width: menu.width,
                maxHeight: menu.maxHeight,
                transform: menu.above ? "translateY(-100%)" : undefined,
              }}
              onKeyDown={(event) => {
                if (
                  !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                const buttons = [
                  ...(panel.current?.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ) ?? []),
                ];
                const current = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (current +
                          (event.key === "ArrowUp" ? -1 : 1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }}
            >
              {sources.map((source) => (
                <button
                  key={source.href}
                  type="button"
                  role="menuitem"
                  className="nodrag nopan"
                  data-zmd-note-source={source.href}
                  title={source.caption}
                  onClick={() => setMenu(null)}
                >
                  <IconOpen />
                  <span>{source.caption}</span>
                </button>
              ))}
            </div>,
            menu.host,
          )
        : null}
    </span>
  );
}

function AcademicTextNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const labels = useWhiteboardLabels();
  const model = data.model;
  const content = model.kind === "note" ? model.content : "";
  const html = useMemo(
    () => renderMarkdownCore(content, `card-${model.id}`),
    [content, model.id],
  );
  const mountMarkdown = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      mountRenderedMarkdown(element, html);
      element
        .querySelectorAll("a[href], [data-zmd-wikilink]")
        .forEach((link) => {
          link.classList.add("nodrag");
        });
    },
    [html],
  );
  const sources = useMemo(() => {
    const unique = new Map<string, NotePdfSource>();
    for (const link of extractNoteLinks(content)) {
      if (!isPdfDocumentLink(link.href) || unique.has(link.href)) continue;
      unique.set(link.href, {
        href: link.href,
        caption: noteLinkLabel(link) || labels.openSource,
      });
    }
    return [...unique.values()];
  }, [content, labels.openSource]);
  if (model.kind !== "note") return null;
  return (
    <CardShell
      kind="note"
      noteType={getNoteType(model)}
      kindLabel={noteTypeLabel(labels, getNoteType(model))}
      badge={getNoteTitle(model)}
      actions={
        sources.length ? <NoteSourceAction sources={sources} /> : undefined
      }
      selected={selected}
      nodeStyle={model.style}
      footer={
        model.references?.length || model.attachments?.length ? (
          <>
            {model.references?.length ? (
              <div
                className="zmd-board-note-attachments nowheel"
                role="group"
                aria-label={labels.addItem}
              >
                {model.references.map((reference) => (
                  <button
                    key={reference.id}
                    type="button"
                    className="zmd-board-note-attachment"
                    data-zmd-note-reference={reference.id}
                    title={reference.title}
                    aria-label={`${labels.fileOpen}: ${reference.title}`}
                  >
                    <span
                      className="zmd-board-note-attachment-icon"
                      aria-hidden="true"
                    >
                      {reference.kind === "attachment" ? (
                        <IconFile />
                      ) : (
                        <IconZotero />
                      )}
                    </span>
                    <span className="zmd-board-note-attachment-title">
                      {reference.title}
                      {reference.kind === "literature" &&
                      (reference.creators || reference.year) ? (
                        <small style={{ display: "block" }}>
                          {[reference.creators, reference.year]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {model.attachments?.length ? (
              <div
                className="zmd-board-note-attachments nowheel"
                role="group"
                aria-label={labels.fileOpen}
              >
                {model.attachments.slice(0, 100).map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    className="zmd-board-note-attachment"
                    data-zmd-note-attachment={attachment.id}
                    title={attachment.title}
                    aria-label={`${labels.fileOpen}: ${attachment.title}`}
                  >
                    <span
                      className="zmd-board-note-attachment-icon"
                      aria-hidden="true"
                    >
                      <IconFile />
                    </span>
                    <span className="zmd-board-note-attachment-title">
                      {attachment.title}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : undefined
      }
    >
      {model.content === "" ? (
        <p className="zmd-board-card-content is-placeholder">
          {noteTypePrompt(labels, getNoteType(model))}
        </p>
      ) : (
        <div
          className="zmd-board-card-content zmd-board-card-markdown nowheel"
          ref={mountMarkdown}
          style={nodeTextStyle(model.style ?? {})}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.target as HTMLElement).hasAttribute("data-zmd-wikilink")
            ) {
              event.preventDefault();
              event.stopPropagation();
              (event.target as HTMLElement).click();
            }
          }}
        />
      )}
    </CardShell>
  );
}

export function NoteNode(props: NodeProps<CanvasFlowNode>) {
  return <AcademicTextNode {...props} />;
}

export function FrameNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const labels = useWhiteboardLabels();
  const model = data.model;
  if (model.kind !== "frame") return null;
  const style = model.style ?? {};
  return (
    <section
      className={`zmd-board-frame${selected ? " is-selected" : ""}`}
      aria-label={`${labels.kindFrame}: ${model.title}`}
      style={{
        ...nodeSurfaceStyle("frame", style),
        ...nodeContentAlignmentStyle(style),
      }}
    >
      <header className="zmd-board-frame-title">
        <IconGroup />
        <h3 style={nodeTextStyle(style)}>
          {["Frame", labels.kindFrame].includes(model.title) ? "" : model.title}
        </h3>
      </header>
      {(["top", "right", "bottom", "left"] as const).map((edge) => (
        <span
          key={edge}
          className={`zmd-board-frame-hit-edge is-${edge}`}
          aria-hidden="true"
        />
      ))}
    </section>
  );
}
