import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconCheck } from "../whiteboard/icons";

/** A shared, viewport-aware flyout for the card and connection style controls. */
export function StyleMenu(props: {
  label: string;
  description?: string;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  kind?: "color" | "geometry" | "batch";
  colorTarget?: string;
  preferAbove?: boolean;
}) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({
    above: false,
    left: 0,
    maxHeight: 600,
  });
  useEffect(() => {
    if (!props.open) return;
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        // Commit numeric drafts before unmounting their inputs.
        if (panel.current?.contains(document.activeElement))
          (document.activeElement as HTMLElement)?.blur();
        props.onOpenChange(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const input =
        panel.current?.querySelector<HTMLInputElement>("input:focus");
      if (props.kind === "geometry" && input) input.value = input.defaultValue;
      trigger.current?.focus();
      props.onOpenChange(false);
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [props.open, props.onOpenChange, props.kind]);
  useLayoutEffect(() => {
    if (!props.open || !panel.current || !wrapper.current) return;
    const popup = panel.current;
    const anchor = wrapper.current;
    const measure = () => {
      const rect = popup.getBoundingClientRect();
      const button = anchor.getBoundingClientRect();
      const below = Math.max(0, window.innerHeight - 16 - button.bottom);
      const aboveSpace = Math.max(0, button.top - 16);
      const height = Math.max(popup.scrollHeight, rect.height);
      const above =
        props.preferAbove && aboveSpace >= height
          ? true
          : height > below && aboveSpace > below;
      const left = Math.max(
        8 - button.left,
        Math.min(0, window.innerWidth - 8 - button.left - rect.width),
      );
      const maxHeight = above ? aboveSpace : below;
      setLayout((current) =>
        current.above === above &&
        current.left === left &&
        current.maxHeight === maxHeight
          ? current
          : { above, left, maxHeight },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(popup);
    const bar = anchor.closest(".zmd-board-style-bar");
    if (bar) observer?.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  });
  return (
    <span className="zmd-board-flyout" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        title={props.description ?? props.label}
        aria-label={props.label}
        data-color-target={props.colorTarget}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        className={props.open ? "is-active" : ""}
        onClick={() => props.onOpenChange(!props.open)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          props.onOpenChange(true);
          window.requestAnimationFrame(() =>
            (
              panel.current?.querySelector<HTMLElement>(
                '[aria-pressed="true"]',
              ) ?? panel.current?.querySelector<HTMLElement>("button, input")
            )?.focus(),
          );
        }}
      >
        {props.icon}
      </button>
      {props.open ? (
        <div
          ref={panel}
          className={`zmd-board-popover zmd-board-style-popup is-${props.kind ?? "options"}`}
          role="dialog"
          aria-label={props.label}
          data-placement={layout.above ? "above" : "below"}
          style={{ left: layout.left, maxHeight: layout.maxHeight }}
          onClick={(event) => {
            if (!(event.target as Element).closest("[data-style-option]"))
              return;
            trigger.current?.focus();
            props.onOpenChange(false);
          }}
          onKeyDown={(event) => {
            const options = Array.from(
              panel.current?.querySelectorAll<HTMLButtonElement>(
                "[data-style-option]",
              ) ?? [],
            );
            if (
              !options.length ||
              !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const current = options.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : (current +
                      (event.key === "ArrowUp" ? -1 : 1) +
                      options.length) %
                    options.length;
            options[next]?.focus();
          }}
        >
          {props.children}
        </div>
      ) : null}
    </span>
  );
}

export function StyleOption(props: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-style-option
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.selected}
      className={props.selected ? "is-active" : ""}
      onClick={props.onClick}
    >
      {props.children}
      <span className="zmd-board-option-check">
        {props.selected ? <IconCheck /> : null}
      </span>
    </button>
  );
}
