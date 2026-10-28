import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getNoteTitle, getNoteType, type CanvasNode } from "../model/academic";
import { searchCanvasNodes } from "../whiteboard/selection";
import {
  IconAnnotations,
  IconArrow,
  IconEllipse,
  IconFile,
  IconFrame,
  IconItem,
  IconLine,
  IconRect,
  IconText,
  NoteTypeIcon,
} from "../whiteboard/icons";

export interface CanvasSearchLabels {
  search: string;
  close: string;
  all: string;
  literature: string;
  quote: string;
  note: string;
  frame: string;
  other: string;
  filter: string;
  results: string;
  empty: string;
  prompt: string;
}

const FILTERS = ["all", "literature", "quote", "note", "frame"] as const;
type SearchFilter = (typeof FILTERS)[number];

function resultText(node: CanvasNode): { title: string; summary: string } {
  switch (node.kind) {
    case "literature":
      return {
        title: node.snapshot.title,
        summary: [
          node.snapshot.creators,
          node.snapshot.year,
          node.snapshot.publicationTitle,
          node.snapshot.tags?.join(", "),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "quote":
      return {
        title: node.snapshot.citation || node.snapshot.attachmentTitle || "",
        summary: [node.snapshot.text, node.snapshot.comment]
          .filter(Boolean)
          .join(" · "),
      };
    case "note": {
      const lines = node.content.trim().split(/\r?\n/);
      const title = getNoteTitle(node) || node.sourceSnapshot?.title;
      return {
        title: title || lines[0]?.replace(/^#{1,6}\s+/, "") || "",
        summary: title ? node.content : lines.slice(1).join(" "),
      };
    }
    case "frame":
      return { title: node.title, summary: "" };
    default:
      return {
        title: node.data.title,
        summary:
          node.kind === "item" ||
          node.kind === "pdf" ||
          node.kind === "attachment"
            ? [node.data.subtitle, node.data.preview]
                .filter(Boolean)
                .join(" · ")
            : "",
      };
  }
}

function ResultIcon({ node }: { node: CanvasNode }) {
  switch (node.kind) {
    case "literature":
    case "item":
      return <IconItem />;
    case "quote":
      return <IconAnnotations />;
    case "note":
      return <NoteTypeIcon type={getNoteType(node)} />;
    case "frame":
      return <IconFrame />;
    case "pdf":
    case "attachment":
      return <IconFile />;
    case "text":
      return <IconText />;
    case "rect":
      return <IconRect />;
    case "ellipse":
      return <IconEllipse />;
    case "line":
      return <IconLine />;
    case "arrow":
      return <IconArrow />;
  }
}

export function CanvasSearch(props: {
  nodes: readonly CanvasNode[];
  query: string;
  onQueryChange: (query: string) => void;
  onFocusNode: (id: string) => void;
  onClose: () => void;
  labels: CanvasSearchLabels;
}) {
  const { nodes, query, labels } = props;
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [cursor, setCursor] = useState<{
    query: string;
    filter: SearchFilter;
    id: string;
  } | null>(null);
  const id = useId();
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const matches = useMemo(() => {
    const ids = new Set(searchCanvasNodes(nodes, query));
    return nodes.filter((node) => ids.has(node.id));
  }, [nodes, query]);
  const results = matches.filter(
    (node) => filter === "all" || node.kind === filter,
  );
  const activeIndex =
    cursor?.query === query && cursor.filter === filter
      ? results.findIndex((node) => node.id === cursor.id)
      : -1;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const focusResult = (node: CanvasNode) => {
    setCursor({ query, filter, id: node.id });
    props.onFocusNode(node.id);
  };

  return (
    <section
      className="zmd-board-search"
      role="search"
      aria-label={labels.search}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
        if (
          results.length &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          ["ArrowDown", "ArrowUp", "Enter"].includes(event.key) &&
          (event.target instanceof HTMLInputElement ||
            (event.target as HTMLElement).getAttribute("role") === "option")
        ) {
          event.preventDefault();
          const reverse =
            event.key === "ArrowUp" ||
            (event.key === "Enter" && event.shiftKey);
          const next =
            activeIndex < 0
              ? reverse
                ? results.length - 1
                : 0
              : (activeIndex + (reverse ? -1 : 1) + results.length) %
                results.length;
          focusResult(results[next]);
        }
      }}
    >
      <div className="zmd-board-search-heading">
        <input
          autoFocus
          type="search"
          role="combobox"
          aria-label={labels.search}
          aria-autocomplete="list"
          aria-controls={`${id}-results`}
          aria-expanded="true"
          aria-activedescendant={
            activeIndex < 0 ? undefined : `${id}-result-${activeIndex}`
          }
          placeholder={labels.search}
          value={query}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
        <button
          type="button"
          className="zmd-board-search-close"
          aria-label={labels.close}
          title={labels.close}
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      <div
        className="zmd-board-search-filters"
        role="group"
        aria-label={labels.filter}
      >
        {FILTERS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {labels[kind]}
          </button>
        ))}
      </div>
      <div className="zmd-board-search-count" role="status">
        {labels.results} ({results.length})
      </div>
      <ul
        id={`${id}-results`}
        className="zmd-board-search-results"
        role="listbox"
        aria-label={labels.results}
      >
        {results.map((node, index) => {
          const text = resultText(node);
          const kindLabel =
            node.kind === "literature" ||
            node.kind === "quote" ||
            node.kind === "note" ||
            node.kind === "frame"
              ? labels[node.kind]
              : labels.other;
          const title = text.title.replace(/\s+/g, " ").trim() || kindLabel;
          const summary = text.summary.replace(/\s+/g, " ").trim();
          return (
            <li key={node.id} role="presentation">
              <button
                ref={index === activeIndex ? activeRef : undefined}
                id={`${id}-result-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onClick={() => focusResult(node)}
              >
                <span className="zmd-board-search-icon" title={kindLabel}>
                  <ResultIcon node={node} />
                </span>
                <span className="zmd-board-search-text">
                  <span className="zmd-board-search-title" title={title}>
                    {title}
                  </span>
                  <span className="zmd-board-search-summary" title={summary}>
                    {summary || kindLabel}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!results.length ? (
        <p className="zmd-board-search-empty">
          {query.trim() ? labels.empty : labels.prompt}
        </p>
      ) : null}
    </section>
  );
}
