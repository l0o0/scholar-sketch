import { keyboardShortcutMatches } from "../../../../src/modules/markdown/shortcut";
import {
  defaultWhiteboardShortcuts,
  WHITEBOARD_HOLD_SHORTCUT_ACTIONS,
  whiteboardShortcutMatches,
  type WhiteboardHoldShortcutAction,
  type WhiteboardShortcuts,
} from "../model/shortcuts";
import type { CanvasTool } from "../chrome/tools";

export interface CanvasArrowKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly code?: string;
  readonly isComposing?: boolean;
  readonly getModifierState?: (key: string) => boolean;
  readonly target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

type EditableEventTarget = EventTarget & {
  readonly tagName?: unknown;
  readonly isContentEditable?: unknown;
};
export function isEditableTarget(target: EventTarget | null): boolean {
  const candidate = target as EditableEventTarget | null;
  if (!candidate) return false;
  if (candidate.isContentEditable === true) return true;
  if (typeof candidate.tagName !== "string") return false;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(
    candidate.tagName.toUpperCase(),
  );
}
function isCanvasMenuTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(
    element?.closest?.(
      '[role="menu"], [role="dialog"], details[open], .zmd-board-properties, .zmd-board-style-bar',
    ),
  );
}
export function isCanvasShortcutTarget(target: EventTarget | null): boolean {
  return !isEditableTarget(target) && !isCanvasMenuTarget(target);
}
export interface GlobalCanvasKeyboardEvent extends CanvasArrowKeyEvent {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly isComposing?: boolean;
  readonly defaultPrevented?: boolean;
}
export interface GlobalCanvasKeyboardState {
  annotationBrowserOpen: boolean;
  editing: boolean;
  drawing: boolean;
  selectedNodeIds: readonly string[];
  selectedEdgeIds: readonly string[];
}
export interface GlobalCanvasKeyboardActions {
  endFrameDrag(): void;
  cancelDraw(): void;
  dismissTransientUi(): void;
  setActiveTool(tool: CanvasTool): void;
  setNoteTemplate?(type: "question" | "claim"): void;
  deleteSelection(nodeIds: string[], edgeIds: string[]): void;
  nudgeSelected(key: string, shift: boolean): boolean;
  fitView?(): void;
  fitSelection?(): void;
  undo?(): void;
  redo?(): void;
  save?(): void;
  find?(): void;
}

export function handleGlobalCanvasKeyDown(
  event: GlobalCanvasKeyboardEvent,
  state: GlobalCanvasKeyboardState,
  actions: GlobalCanvasKeyboardActions,
  shortcuts = defaultWhiteboardShortcuts(),
  platform?: string,
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    state.annotationBrowserOpen
  )
    return false;
  const matches = (action: Parameters<typeof whiteboardShortcutMatches>[1]) =>
    whiteboardShortcutMatches(event, action, shortcuts, platform);
  if (
    matches("save") &&
    actions.save &&
    !isCanvasMenuTarget(event.target) &&
    (!(state.editing || isEditableTarget(event.target)) ||
      event.ctrlKey ||
      event.metaKey)
  ) {
    event.preventDefault();
    actions.save();
    return true;
  }
  if (state.editing || !isCanvasShortcutTarget(event.target)) return false;
  if (!state.drawing) {
    for (const action of [
      "find",
      "undo",
      "redo",
      "fitView",
      "fitSelection",
    ] as const) {
      if (matches(action) && actions[action]) {
        event.preventDefault();
        actions[action]();
        return true;
      }
    }
  }
  if (matches("cancel")) {
    event.preventDefault();
    actions.endFrameDrag();
    if (state.drawing) actions.cancelDraw();
    else {
      actions.dismissTransientUi();
      actions.setActiveTool("select");
    }
    return true;
  }
  const tools = {
    select: "select",
    hand: "hand",
    rect: "rect",
    ellipse: "ellipse",
    arrow: "arrow",
    line: "line",
    text: "text",
    question: "note",
    claim: "note",
    frame: "frame",
    eraser: "eraser",
  } as const;
  for (const action of Object.keys(tools) as (keyof typeof tools)[]) {
    if (!matches(action)) continue;
    event.preventDefault();
    if (action === "question" || action === "claim")
      actions.setNoteTemplate?.(action);
    actions.setActiveTool(tools[action]);
    return true;
  }
  if (
    matches("delete") &&
    (state.selectedNodeIds.length || state.selectedEdgeIds.length)
  ) {
    event.preventDefault();
    actions.deleteSelection(
      [...state.selectedNodeIds],
      [...state.selectedEdgeIds],
    );
    return true;
  }
  return captureCanvasArrowKey(
    event,
    false,
    actions.nudgeSelected,
    shortcuts,
    platform,
  );
}

export function captureCanvasArrowKey(
  event: CanvasArrowKeyEvent,
  editing: boolean,
  nudge: (key: string, shift: boolean) => boolean,
  shortcuts = defaultWhiteboardShortcuts(),
  platform?: string,
): boolean {
  if (editing || event.isComposing || !isCanvasShortcutTarget(event.target))
    return false;
  const keyboard = {
    ...event,
    key: event.key,
    code: event.code,
    getModifierState: event.getModifierState?.bind(event),
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey ?? false,
    metaKey: event.metaKey ?? false,
    altKey: event.altKey ?? false,
  };
  const directions = {
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
  } as const;
  let moved = false;
  for (const direction of Object.keys(
    directions,
  ) as (keyof typeof directions)[]) {
    for (const large of [false, true]) {
      const action =
        `nudge${direction}${large ? "Large" : ""}` as keyof WhiteboardShortcuts;
      if (whiteboardShortcutMatches(keyboard, action, shortcuts, platform))
        moved = nudge(directions[direction], large);
    }
  }
  // React Flow has its own Arrow-key mover. Own those keys even after a binding
  // is cleared, so a focused node cannot bypass the configured canvas command.
  if (!moved && !event.key.startsWith("Arrow")) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

type HeldEvent = Parameters<typeof keyboardShortcutMatches>[0];
export type CanvasHeldShortcutState = Record<
  WhiteboardHoldShortcutAction,
  boolean
>;
export const emptyCanvasHeldShortcuts = (): CanvasHeldShortcutState => ({
  pan: false,
  freeMove: false,
  constrain: false,
});

/** The canvas session owns held keys, including cleanup when focus/config changes. */
export function createCanvasHeldShortcuts(
  shortcuts: WhiteboardShortcuts,
  onChange: (state: CanvasHeldShortcutState) => void,
  platform?: string,
) {
  const pressed = new Map<string, HeldEvent>();
  let state = emptyCanvasHeldShortcuts();
  let modifiers = {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  const update = (event: HeldEvent) => {
    modifiers = {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    };
    const next = emptyCanvasHeldShortcuts();
    for (const action of WHITEBOARD_HOLD_SHORTCUT_ACTIONS) {
      next[action] =
        keyboardShortcutMatches(
          { ...modifiers, key: "" },
          shortcuts[action],
          platform,
        ) ||
        [...pressed.values()].some((key) =>
          keyboardShortcutMatches(
            { ...key, ...modifiers },
            shortcuts[action],
            platform,
          ),
        );
    }
    if (
      WHITEBOARD_HOLD_SHORTCUT_ACTIONS.some(
        (action) => next[action] !== state[action],
      )
    ) {
      state = next;
      onChange(next);
    }
    return state;
  };
  const clear = () => {
    pressed.clear();
    modifiers = {
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    update({ ...modifiers, key: "" });
  };
  return {
    keyDown(event: HeldEvent, blocked = false) {
      if (blocked || event.isComposing) {
        clear();
        return state;
      }
      pressed.set(event.code || event.key, {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      });
      return update(event);
    },
    keyUp(event: HeldEvent, blocked = false) {
      if (blocked) {
        clear();
        return state;
      }
      pressed.delete(event.code || event.key);
      return update(event);
    },
    pointer(
      event: Pick<HeldEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
    ) {
      return update({ ...event, key: "" });
    },
    clear,
    current: () => state,
  };
}
