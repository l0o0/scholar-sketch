import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import type { CanvasDocument } from "../model/document";
import {
  quoteAttachmentIdentity,
  ANNOTATION_TYPES,
  nativeAnnotationIdentity,
  type AnnotationType,
} from "../model/academic";
import type {
  AnnotationCandidate,
  AnnotationListFailure,
} from "../model/protocol";
import { IconAnnotations, IconCheck, IconPalette } from "../whiteboard/icons";
import { AnnotationTypeIcon } from "./AnnotationTypeIcon";

export interface AnnotationBrowserLabels {
  title: string;
  search: string;
  loading: string;
  empty: string;
  unavailable: string;
  partialFailure: string;
  alreadyAdded: string;
  focusExisting: string;
  addSelected: string;
  page: string;
  close: string;
  typeLabels?: Record<AnnotationType, string>;
  typeFilter?: string;
  tagFilter?: string;
  allTypes?: string;
  allTags?: string;
  noText?: string;
  colorFilter?: string;
  allColors?: string;
  selectResults?: string;
  clearSelection?: string;
  selectedCount?: string;
}

export type AnnotationBrowserState =
  | { status: "loading" }
  | {
      status: "ready";
      candidates: AnnotationCandidate[];
      failures: AnnotationListFailure[];
    }
  | { status: "unavailable"; failure: AnnotationListFailure };

export interface AnnotationCandidateGroup {
  attachmentIdentity: string;
  attachmentTitle: string;
  candidates: AnnotationCandidate[];
}

export function filterAnnotationCandidates(
  candidates: AnnotationCandidate[],
  query: string,
  type: AnnotationType | "" = "",
  tag = "",
  colors: ReadonlySet<string> = new Set(),
): AnnotationCandidate[] {
  const needle = query.trim().toLocaleLowerCase();
  const normalizedColors = new Set(
    [...colors].map((color) => color.trim().toLowerCase()),
  );
  return candidates.filter(({ acquisition }) => {
    const { text, comment, pageLabel, annotationType, tags } =
      acquisition.snapshot;
    if (type && annotationType !== type) return false;
    if (tag && !tags?.includes(tag)) return false;
    if (
      normalizedColors.size &&
      !normalizedColors.has(
        acquisition.snapshot.color?.trim().toLowerCase() ?? "",
      )
    )
      return false;
    return (
      !needle ||
      [text, comment, pageLabel, ...(tags ?? [])].some((value) =>
        value?.toLocaleLowerCase().includes(needle),
      )
    );
  });
}

export function groupAnnotationCandidates(
  candidates: AnnotationCandidate[],
): AnnotationCandidateGroup[] {
  const groups: AnnotationCandidateGroup[] = [];
  const byAttachment = new Map<string, AnnotationCandidateGroup>();
  for (const candidate of candidates) {
    const attachmentIdentity = quoteAttachmentIdentity(
      candidate.acquisition.source,
    );
    let group = byAttachment.get(attachmentIdentity);
    if (!group) {
      group = {
        attachmentIdentity,
        attachmentTitle: candidate.attachmentTitle,
        candidates: [],
      };
      byAttachment.set(attachmentIdentity, group);
      groups.push(group);
    }
    group.candidates.push(candidate);
  }
  return groups;
}

export function existingAnnotationKeys(document: CanvasDocument): Set<string> {
  return new Set(
    document.nodes.flatMap((node) =>
      node.kind === "quote" ? [nativeAnnotationIdentity(node.source)] : [],
    ),
  );
}

export function toggleAnnotationSelection(
  selection: ReadonlySet<string>,
  annotationKey: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selection);
  if (checked) next.add(annotationKey);
  else next.delete(annotationKey);
  return next;
}

export function AnnotationBrowser(props: {
  labels: AnnotationBrowserLabels;
  state: AnnotationBrowserState;
  query: string;
  selectedKeys: ReadonlySet<string>;
  existingKeys: ReadonlySet<string>;
  returnFocusRef: RefObject<{ focus(): void } | null>;
  onQueryChange: (query: string) => void;
  onToggle: (annotationKey: string, checked: boolean) => void;
  onSelectionChange: (selection: Set<string>) => void;
  onClose: () => void;
  onFocusExisting: (annotationKey: string) => void;
  onAddSelected: () => void;
}) {
  const [typeFilter, setTypeFilter] = useState<AnnotationType | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [colorFilter, setColorFilter] = useState<Set<string>>(() => new Set());
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const colorPopoverId = useId();
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const colorPopoverRef = useRef<HTMLDivElement | null>(null);
  const colorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const restoreTriggerOnUnmountRef = useRef(true);
  const propsRef = useRef(props);
  propsRef.current = props;
  const close = useCallback(() => propsRef.current.onClose(), []);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    const view = backdrop?.ownerDocument.defaultView;
    if (!backdrop || !dialog || !view) return;

    const background = Array.from(backdrop.parentElement?.children ?? [])
      .filter((element) => element !== backdrop)
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const previous = {
          element: htmlElement,
          inert: htmlElement.inert,
          ariaHidden: htmlElement.getAttribute("aria-hidden"),
        };
        htmlElement.inert = true;
        htmlElement.setAttribute("aria-hidden", "true");
        return previous;
      });

    searchRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (colorPopoverRef.current) {
          setColorPopoverOpen(false);
          colorTriggerRef.current?.focus();
          return;
        }
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = dialog.ownerDocument.activeElement;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    view.addEventListener("keydown", onKeyDown, true);
    return () => {
      view.removeEventListener("keydown", onKeyDown, true);
      for (const previous of background) {
        previous.element.inert = previous.inert;
        if (previous.ariaHidden === null) {
          previous.element.removeAttribute("aria-hidden");
        } else {
          previous.element.setAttribute("aria-hidden", previous.ariaHidden);
        }
      }
      if (restoreTriggerOnUnmountRef.current) {
        propsRef.current.returnFocusRef.current?.focus();
      }
    };
  }, [close]);

  useEffect(() => {
    if (!colorPopoverOpen) return;
    const picker = colorPickerRef.current;
    const popover = colorPopoverRef.current;
    if (!picker || !popover) return;
    popover
      .querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      ?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!picker.contains(event.target as Node)) setColorPopoverOpen(false);
    };
    // A mouse press in Gecko can blur a button without focusing the next one.
    // Wait for a concrete focus destination so the pending color click survives.
    const onFocusIn = (event: FocusEvent) => {
      if (!picker.contains(event.target as Node)) setColorPopoverOpen(false);
    };
    const ownerDocument = picker.ownerDocument;
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    ownerDocument.addEventListener("focusin", onFocusIn, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
      ownerDocument.removeEventListener("focusin", onFocusIn, true);
    };
  }, [colorPopoverOpen]);

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };
  const focusColorControl = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // macOS may focus the enclosing dialog instead of a button on mouse down.
    event.preventDefault();
    event.currentTarget.focus();
  };
  const candidates =
    props.state.status === "ready"
      ? filterAnnotationCandidates(
          props.state.candidates,
          props.query,
          typeFilter,
          tagFilter,
          colorFilter,
        )
      : [];
  const groups = groupAnnotationCandidates(candidates);
  const availableCandidates =
    props.state.status === "ready" ? props.state.candidates : [];
  const typeOptions: Array<AnnotationType | ""> = ["", ...ANNOTATION_TYPES];
  const availableTags = [
    ...new Set(
      availableCandidates.flatMap(
        ({ acquisition }) => acquisition.snapshot.tags ?? [],
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const availableColors = [
    ...new Set(
      availableCandidates.flatMap(({ acquisition }) => {
        const color = acquisition.snapshot.color?.trim().toLowerCase();
        return color ? [color] : [];
      }),
    ),
  ];
  const eligibleKeys = new Set(
    candidates
      .map(({ acquisition }) => nativeAnnotationIdentity(acquisition.source))
      .filter((identity) => !props.existingKeys.has(identity)),
  );
  const selectedCount = new Set(
    availableCandidates.flatMap(({ acquisition }) => {
      const identity = nativeAnnotationIdentity(acquisition.source);
      return props.selectedKeys.has(identity) &&
        !props.existingKeys.has(identity)
        ? [identity]
        : [];
    }),
  ).size;
  const hasUnselectedResult = [...eligibleKeys].some(
    (identity) => !props.selectedKeys.has(identity),
  );

  return (
    <div
      ref={backdropRef}
      className="zmd-board-annotation-backdrop"
      onMouseDown={onBackdrop}
    >
      <section
        ref={dialogRef}
        className="zmd-board-annotation-browser"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zmd-board-annotation-title"
        tabIndex={-1}
      >
        <header>
          <h2
            id="zmd-board-annotation-title"
            className="zmd-board-annotation-title"
          >
            {props.labels.title}
          </h2>
          <input
            ref={searchRef}
            className="zmd-board-annotation-search"
            type="search"
            aria-label={props.labels.search}
            placeholder={props.labels.search}
            value={props.query}
            onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          />
          <button
            type="button"
            className="zmd-board-annotation-close"
            aria-label={props.labels.close}
            onClick={close}
          >
            ×
          </button>
        </header>

        <div className="zmd-board-annotation-filter-row">
          <div
            className="zmd-board-annotation-type-filters"
            role="group"
            aria-label={props.labels.typeFilter ?? "Annotation type"}
          >
            {typeOptions.map((type, index) => {
              const label = type
                ? (props.labels.typeLabels?.[type] ?? type)
                : (props.labels.allTypes ?? "All");
              return (
                <button
                  key={type}
                  type="button"
                  data-annotation-type={type}
                  aria-label={label}
                  aria-pressed={typeFilter === type}
                  title={label}
                  disabled={props.state.status !== "ready"}
                  onClick={() => setTypeFilter(type)}
                  onKeyDown={(event) => {
                    if (
                      event.nativeEvent.isComposing ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.altKey ||
                      event.shiftKey
                    )
                      return;
                    let next: number;
                    if (event.key === "ArrowRight")
                      next = (index + 1) % typeOptions.length;
                    else if (event.key === "ArrowLeft")
                      next =
                        (index - 1 + typeOptions.length) % typeOptions.length;
                    else if (event.key === "Home") next = 0;
                    else if (event.key === "End") next = typeOptions.length - 1;
                    else return;
                    event.preventDefault();
                    event.stopPropagation();
                    setTypeFilter(typeOptions[next]);
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>("button")
                      .item(next)
                      ?.focus();
                  }}
                >
                  {type ? (
                    <span
                      className="zmd-board-annotation-type-icon"
                      data-annotation-icon={type}
                      aria-hidden="true"
                    >
                      <AnnotationTypeIcon type={type} />
                    </span>
                  ) : (
                    <span>{label}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div
            ref={colorPickerRef}
            className="zmd-board-annotation-color-picker"
          >
            <button
              ref={colorTriggerRef}
              type="button"
              className="zmd-board-annotation-color-trigger"
              aria-label={props.labels.colorFilter ?? "Color"}
              title={props.labels.colorFilter ?? "Color"}
              aria-haspopup="dialog"
              aria-expanded={colorPopoverOpen}
              aria-controls={colorPopoverOpen ? colorPopoverId : undefined}
              data-filtered={colorFilter.size > 0}
              disabled={!availableColors.length}
              onMouseDown={focusColorControl}
              onClick={() => setColorPopoverOpen((open) => !open)}
            >
              <IconPalette />
              {colorFilter.size > 0 ? <span>{colorFilter.size}</span> : null}
            </button>
            {colorPopoverOpen ? (
              <div
                ref={colorPopoverRef}
                id={colorPopoverId}
                className="zmd-board-annotation-color-filters"
                role="dialog"
                aria-label={props.labels.colorFilter ?? "Color"}
              >
                <button
                  type="button"
                  className="zmd-board-annotation-all-colors"
                  aria-pressed={!colorFilter.size}
                  onMouseDown={focusColorControl}
                  onClick={() => setColorFilter(new Set())}
                >
                  {props.labels.allColors ?? "All colors"}
                </button>
                <div
                  className="zmd-board-annotation-color-grid"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(5, availableColors.length)}, 28px)`,
                  }}
                >
                  {availableColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="zmd-board-annotation-color-option"
                      aria-label={`${props.labels.colorFilter ?? "Color"} ${color.toUpperCase()}`}
                      title={`${props.labels.colorFilter ?? "Color"} ${color.toUpperCase()}`}
                      aria-pressed={colorFilter.has(color)}
                      onMouseDown={focusColorControl}
                      onClick={() =>
                        setColorFilter((selected) => {
                          const next = new Set(selected);
                          if (next.has(color)) next.delete(color);
                          else next.add(color);
                          return next;
                        })
                      }
                    >
                      <span
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      />
                      {colorFilter.has(color) ? <IconCheck /> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {availableTags.length ? (
          <div className="zmd-board-annotation-tools">
            <label className="zmd-board-annotation-tag-filter">
              <span>{props.labels.tagFilter ?? "Tag"}</span>
              <select
                aria-label={props.labels.tagFilter ?? "Tag"}
                value={tagFilter}
                disabled={props.state.status !== "ready"}
                onChange={(event) => setTagFilter(event.currentTarget.value)}
              >
                <option value="">{props.labels.allTags ?? "All tags"}</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div
          className={`zmd-board-annotation-results${groups.length ? "" : " is-empty"}`}
          aria-live="polite"
        >
          {props.state.status === "loading" ? (
            <p className="zmd-board-annotation-state">{props.labels.loading}</p>
          ) : props.state.status === "unavailable" ? (
            <p className="zmd-board-annotation-state is-error">
              {props.labels.unavailable}
            </p>
          ) : (
            <>
              {props.state.failures.length ? (
                <p className="zmd-board-annotation-state is-warning">
                  {props.labels.partialFailure}
                </p>
              ) : null}
              {!groups.length ? (
                <p className="zmd-board-annotation-state">
                  <IconAnnotations />
                  <span>{props.labels.empty}</span>
                </p>
              ) : (
                groups.map((group) => (
                  <section
                    className="zmd-board-annotation-group"
                    key={group.attachmentIdentity}
                    aria-label={group.attachmentTitle}
                  >
                    <h3>{group.attachmentTitle}</h3>
                    <ul>
                      {group.candidates.map((candidate) => {
                        const { source, snapshot } = candidate.acquisition;
                        const identity = nativeAnnotationIdentity(source);
                        const existing = props.existingKeys.has(identity);
                        return (
                          <li
                            key={identity}
                            className={
                              props.selectedKeys.has(identity)
                                ? "is-selected"
                                : undefined
                            }
                          >
                            <label>
                              <input
                                type="checkbox"
                                checked={props.selectedKeys.has(identity)}
                                disabled={existing}
                                onChange={(event) =>
                                  props.onToggle(
                                    identity,
                                    event.currentTarget.checked,
                                  )
                                }
                              />
                              <span
                                className="zmd-board-annotation-color"
                                style={{ backgroundColor: snapshot.color }}
                                aria-hidden="true"
                              />
                              <span className="zmd-board-annotation-content">
                                {snapshot.image ? (
                                  <img
                                    className="zmd-board-annotation-preview"
                                    src={snapshot.image}
                                    alt={
                                      snapshot.annotationType
                                        ? (props.labels.typeLabels?.[
                                            snapshot.annotationType
                                          ] ?? snapshot.annotationType)
                                        : props.labels.title
                                    }
                                    draggable={false}
                                  />
                                ) : null}
                                {!snapshot.image ||
                                snapshot.text ||
                                snapshot.comment ? (
                                  <span className="zmd-board-annotation-text">
                                    {snapshot.text ||
                                      snapshot.comment ||
                                      props.labels.noText ||
                                      "Open the source to view this annotation"}
                                  </span>
                                ) : null}
                                {snapshot.text && snapshot.comment ? (
                                  <span className="zmd-board-annotation-comment">
                                    {snapshot.comment}
                                  </span>
                                ) : null}
                                <span className="zmd-board-annotation-metadata">
                                  {snapshot.annotationType ? (
                                    <span className="zmd-board-annotation-type">
                                      {props.labels.typeLabels?.[
                                        snapshot.annotationType
                                      ] ?? snapshot.annotationType}
                                    </span>
                                  ) : null}
                                  {snapshot.pageLabel ? (
                                    <span className="zmd-board-annotation-page">
                                      {props.labels.page} {snapshot.pageLabel}
                                    </span>
                                  ) : null}
                                  {snapshot.tags?.length ? (
                                    <span className="zmd-board-annotation-tags">
                                      {snapshot.tags.map((tag) => (
                                        <span key={tag}>#{tag}</span>
                                      ))}
                                    </span>
                                  ) : null}
                                  {existing ? (
                                    <span className="zmd-board-annotation-existing">
                                      {props.labels.alreadyAdded}
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                            </label>
                            {existing ? (
                              <button
                                type="button"
                                className="zmd-board-annotation-focus"
                                onClick={() => {
                                  restoreTriggerOnUnmountRef.current = false;
                                  props.onFocusExisting(identity);
                                }}
                              >
                                {props.labels.focusExisting}
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
            </>
          )}
        </div>

        <footer>
          <span className="zmd-board-annotation-selected-count" role="status">
            {(props.labels.selectedCount ?? "Selected: {count}").replace(
              "{count}",
              String(selectedCount),
            )}
          </span>
          <div className="zmd-board-annotation-bulk-actions">
            <button
              type="button"
              disabled={!hasUnselectedResult}
              onClick={() =>
                props.onSelectionChange(
                  new Set([...props.selectedKeys, ...eligibleKeys]),
                )
              }
            >
              {props.labels.selectResults ?? "Select results"}
            </button>
            <button
              type="button"
              disabled={!props.selectedKeys.size}
              onClick={() => props.onSelectionChange(new Set())}
            >
              {props.labels.clearSelection ?? "Clear selection"}
            </button>
          </div>
          <button
            type="button"
            className="zmd-board-annotation-add"
            onClick={props.onAddSelected}
            disabled={!selectedCount}
          >
            {props.labels.addSelected}
          </button>
        </footer>
      </section>
    </div>
  );
}
