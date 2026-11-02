import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { IconMore } from "../whiteboard/icons";

type ToolbarMenu = "templates" | "draw" | "more" | null;

export interface SidebarAction {
  id: string;
  label: string;
  icon: ReactElement;
  priority: number;
  group?: string;
  selected?: boolean;
  disabled?: boolean;
  menu?: "templates" | "draw";
  triggerRef?: RefObject<HTMLButtonElement | null>;
  holdEditFocus?: () => void;
  run: () => void;
}

function visibleActions(actions: SidebarAction[], capacity: number) {
  const groups = new Map<string, SidebarAction[]>();
  for (const action of actions) {
    const key = action.group ?? action.id;
    const group = groups.get(key) ?? [];
    group.push(action);
    groups.set(key, group);
  }
  const visible = new Set<string>();
  for (const group of [...groups.values()].sort(
    (a, b) => a[0].priority - b[0].priority,
  )) {
    if (group.length > capacity) break;
    for (const action of group) visible.add(action.id);
    capacity -= group.length;
  }
  return visible;
}

export function SidebarToolbar(props: {
  actions: SidebarAction[];
  label: string;
  moreLabel: string;
  openMenu: ToolbarMenu;
  onMenuChange: (menu: ToolbarMenu) => void;
  moreTriggerRef: RefObject<HTMLButtonElement | null>;
  templateMenu: ReactNode;
  drawMenu: ReactNode;
  moreContent: ReactNode;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(0);
  const restoreActionRef = useRef<string | null>(null);
  const visible = visibleActions(props.actions, capacity);
  const overflow = props.actions.filter((action) => !visible.has(action.id));

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current!;
    const view = toolbar.ownerDocument.defaultView!;
    const measure = () => {
      const active = toolbar.ownerDocument.activeElement;
      restoreActionRef.current =
        active && toolbar.contains(active)
          ? active.getAttribute("data-sidebar-action")
          : null;
      const style = view.getComputedStyle(toolbar)!;
      const button = props.moreTriggerRef.current!;
      const buttonWidth = button.getBoundingClientRect().width;
      const width = toolbar.getBoundingClientRect().width;
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0);
      const gap = Number.parseFloat(style.columnGap) || 0;
      // The permanent More button measures the same fixed-size icon slot.
      setCapacity(
        buttonWidth > 0
          ? Math.max(
              0,
              Math.floor((width - padding - buttonWidth) / (buttonWidth + gap)),
            )
          : 0,
      );
    };
    measure();
    const observer = new view.ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [props.moreTriggerRef]);

  useLayoutEffect(() => {
    const action = restoreActionRef.current;
    if (!action) return;
    restoreActionRef.current = null;
    const target = toolbarRef.current?.querySelector<HTMLButtonElement>(
      `[data-sidebar-action="${action}"]`,
    );
    (target ?? props.moreTriggerRef.current)?.focus();
  }, [capacity, props.moreTriggerRef]);

  const renderAction = (action: SidebarAction, inMenu: boolean) => (
    <button
      key={action.id}
      ref={inMenu ? undefined : action.triggerRef}
      type="button"
      data-sidebar-action={action.id}
      title={action.label}
      aria-label={action.label}
      role={
        inMenu
          ? action.selected === undefined
            ? "menuitem"
            : "menuitemradio"
          : undefined
      }
      aria-checked={inMenu ? action.selected : undefined}
      aria-pressed={inMenu ? undefined : action.selected}
      aria-haspopup={action.menu ? "menu" : undefined}
      aria-expanded={action.menu ? props.openMenu === action.menu : undefined}
      className={action.selected ? "is-active" : undefined}
      disabled={action.disabled}
      onPointerDown={(event) => {
        if (action.holdEditFocus) {
          action.holdEditFocus();
          event.preventDefault();
        }
      }}
      onClick={() => {
        if (!action.menu) {
          props.onMenuChange(null);
          if (inMenu) props.moreTriggerRef.current?.focus();
        }
        action.run();
      }}
    >
      {action.icon}
      {inMenu ? <span>{action.label}</span> : null}
    </button>
  );

  return (
    <div
      ref={toolbarRef}
      className="zmd-board-top-island zmd-board-sidebar-toolbar"
      role="toolbar"
      aria-label={props.label}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('[role="menu"]')) return;
        const buttons = Array.from(
          toolbarRef.current!.querySelectorAll<HTMLButtonElement>(
            ":scope > button:not(:disabled)",
          ),
        );
        const current = buttons.indexOf(target as HTMLButtonElement);
        if (current < 0) return;
        if (
          ["ArrowDown", "ArrowUp"].includes(event.key) &&
          target.getAttribute("aria-haspopup") === "menu"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (target.getAttribute("aria-expanded") !== "true") target.click();
          return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowLeft" ? -1 : 1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      {props.actions
        .filter((action) => visible.has(action.id))
        .map((action) => renderAction(action, false))}
      <button
        ref={props.moreTriggerRef}
        type="button"
        className={`zmd-board-sidebar-more${props.openMenu === "more" ? " is-active" : ""}`}
        title={props.moreLabel}
        aria-label={props.moreLabel}
        aria-haspopup="menu"
        aria-expanded={props.openMenu === "more"}
        onClick={() =>
          props.onMenuChange(props.openMenu === "more" ? null : "more")
        }
      >
        <IconMore />
      </button>
      {props.templateMenu}
      {props.drawMenu}
      {props.openMenu === "more" ? (
        <div
          className="zmd-board-more-menu"
          role="menu"
          aria-label={props.moreLabel}
        >
          {overflow.length ? (
            <div className="zmd-board-menu-section" role="group">
              {overflow.map((action) => renderAction(action, true))}
            </div>
          ) : null}
          <div className="zmd-board-menu-section" role="group">
            {props.moreContent}
          </div>
        </div>
      ) : null}
    </div>
  );
}
