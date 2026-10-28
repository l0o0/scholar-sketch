import { useEffect, useRef, useState, type RefObject } from "react";

export interface MarkdownExportOptions {
  scope: "all" | "selection" | "group";
  organization: "type" | "group";
}

export interface MarkdownExportLabels {
  title: string;
  scope: string;
  all: string;
  selection: string;
  group: string;
  organization: string;
  byGroup: string;
  byType: string;
  includeSources: string;
  confirm: string;
  cancel: string;
}

export function MarkdownExportDialog(props: {
  labels: MarkdownExportLabels;
  selectionCount: number;
  groupTitle?: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onExport: (options: MarkdownExportOptions) => void;
  onClose: () => void;
}) {
  const { labels } = props;
  const [scope, setScope] = useState<MarkdownExportOptions["scope"]>("all");
  const [organization, setOrganization] =
    useState<MarkdownExportOptions["organization"]>("group");
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const backdrop = backdropRef.current!;
    const background = Array.from(backdrop.parentElement?.children ?? [])
      .filter((element) => element !== backdrop)
      .map((element) => ({
        element: element as HTMLElement,
        inert: (element as HTMLElement).inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
    for (const { element } of background) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      for (const { element, inert, ariaHidden } of background) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      props.returnFocusRef.current?.focus();
    };
  }, []);

  const scopeAvailable =
    scope === "all" ||
    (scope === "selection" && props.selectionCount > 0) ||
    (scope === "group" && props.groupTitle !== undefined);

  return (
    <div
      ref={backdropRef}
      className="zmd-board-export-backdrop"
      onPaste={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        } else if (event.key === "Tab") {
          const controls = Array.from(
            dialogRef.current!.querySelectorAll<HTMLElement>(
              "input:checked:not(:disabled), button:not(:disabled)",
            ),
          );
          const current = dialogRef.current!.ownerDocument.activeElement;
          if (event.shiftKey && current === controls[0]) {
            event.preventDefault();
            controls.at(-1)?.focus();
          } else if (!event.shiftKey && current === controls.at(-1)) {
            event.preventDefault();
            controls[0]?.focus();
          }
        }
      }}
    >
      <form
        ref={dialogRef}
        className="zmd-board-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        onSubmit={(event) => {
          event.preventDefault();
          if (scopeAvailable) props.onExport({ scope, organization });
        }}
      >
        <strong className="zmd-board-export-title">{labels.title}</strong>
        <fieldset>
          <legend>{labels.scope}</legend>
          {(
            [
              ["all", labels.all, false],
              [
                "selection",
                `${labels.selection} (${props.selectionCount})`,
                !props.selectionCount,
              ],
              [
                "group",
                props.groupTitle
                  ? `${labels.group} · ${props.groupTitle}`
                  : labels.group,
                props.groupTitle === undefined,
              ],
            ] as const
          ).map(([value, label, disabled]) => (
            <label key={value}>
              <input
                type="radio"
                name="export-scope"
                value={value}
                checked={scope === value}
                disabled={disabled}
                onChange={() => setScope(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{labels.organization}</legend>
          {(
            [
              ["group", labels.byGroup],
              ["type", labels.byType],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="export-organization"
                value={value}
                checked={organization === value}
                onChange={() => setOrganization(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <p>{labels.includeSources}</p>
        <footer>
          <button type="button" onClick={props.onClose}>
            {labels.cancel}
          </button>
          <button type="submit" disabled={!scopeAvailable}>
            {labels.confirm}
          </button>
        </footer>
      </form>
    </div>
  );
}
