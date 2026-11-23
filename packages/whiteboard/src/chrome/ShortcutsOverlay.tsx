import type { WhiteboardShortcuts } from "../model/shortcuts";
import type { WhiteboardLabels } from "../model/protocol";
import { keyboardShortcuts } from "./shortcuts";

export function ShortcutsOverlay(props: {
  labels: WhiteboardLabels;
  shortcuts?: WhiteboardShortcuts;
  onClose: () => void;
}) {
  return (
    <div className="zmd-board-help-backdrop" onClick={props.onClose}>
      <div
        className="zmd-board-help"
        role="dialog"
        aria-labelledby="zmd-board-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="zmd-board-help-title">{props.labels.shortcutsTitle}</h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={props.labels.close}
          >
            ×
          </button>
        </header>
        <ul>
          {keyboardShortcuts(props.labels, props.shortcuts).map((item) => (
            <li key={item.action}>
              <kbd>{item.keys}</kbd>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
