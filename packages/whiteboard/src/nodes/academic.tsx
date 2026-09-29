import { IconGroup } from "../whiteboard/icons";
import { useMemo } from "react";
import { renderMarkdownCore } from "../../../../src/modules/markdown/preview-render-core";
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
      kindLabel={labels.kindQuote}
      selected={selected}
      nodeStyle={model.style}
      footer={citationLine([snapshot.citation, snapshot.pageLabel])}
    >
      {snapshot.color ? (
        <span
          className="zmd-board-quote-color"
          style={{ backgroundColor: snapshot.color }}
          aria-label={`${labels.annotationColor}: ${snapshot.color}`}
          role="img"
        />
      ) : null}
      <blockquote
        className="zmd-board-card-content"
        style={nodeTextStyle(model.style ?? {})}
      >
        {snapshot.text}
      </blockquote>
      {snapshot.comment ? (
        <p className="zmd-board-card-comment">{snapshot.comment}</p>
      ) : null}
    </CardShell>
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
  if (model.kind !== "note") return null;
  return (
    <CardShell
      kind="note"
      noteType={getNoteType(model)}
      kindLabel={noteTypeLabel(labels, getNoteType(model))}
      badge={getNoteTitle(model)}
      selected={selected}
      nodeStyle={model.style}
    >
      {model.content === "" ? (
        <p className="zmd-board-card-content is-placeholder">
          {noteTypePrompt(labels, getNoteType(model))}
        </p>
      ) : (
        <div
          className="zmd-board-card-content zmd-board-card-markdown nowheel"
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
          dangerouslySetInnerHTML={{ __html: html }}
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
        <h3 style={nodeTextStyle(style)}>{model.title}</h3>
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
