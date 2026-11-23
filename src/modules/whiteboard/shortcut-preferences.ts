import { getPref, setPref } from "../../utils/prefs";
import {
  defaultWhiteboardShortcuts,
  WHITEBOARD_SHORTCUT_ACTIONS,
  parseWhiteboardShortcuts,
  type WhiteboardShortcuts,
} from "../../../packages/whiteboard/src/model/shortcuts";

export function readWhiteboardShortcuts(
  platform?: string,
): WhiteboardShortcuts {
  return parseWhiteboardShortcuts(
    getPref("whiteboardShortcuts") ?? "{}",
    platform,
  );
}

export function writeWhiteboardShortcuts(
  bindings: WhiteboardShortcuts,
  platform?: string,
): void {
  const defaults = defaultWhiteboardShortcuts(platform);
  const overrides = Object.fromEntries(
    WHITEBOARD_SHORTCUT_ACTIONS.filter(
      (action) => bindings[action] !== defaults[action],
    ).map((action) => [action, bindings[action]]),
  );
  setPref("whiteboardShortcuts", JSON.stringify(overrides));
}
