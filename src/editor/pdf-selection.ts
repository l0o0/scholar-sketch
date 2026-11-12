import { EditorSelection, type EditorState } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import {
  PDF_SELECTION_EVENT,
  type PdfSelectionInsertion,
} from "../modules/markdown/editor-protocol";

function readInsertion(event: Event): PdfSelectionInsertion | null {
  const detail: unknown = (event as CustomEvent).detail;
  if (typeof detail !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<PdfSelectionInsertion>;
  if (typeof payload.markdown !== "string" || !payload.markdown.trim())
    return null;
  if (
    payload.position !== undefined &&
    (!payload.position ||
      typeof payload.position !== "object" ||
      !Number.isFinite(payload.position.x) ||
      !Number.isFinite(payload.position.y))
  )
    return null;
  return payload as PdfSelectionInsertion;
}

function blockInsertion(
  state: EditorState,
  from: number,
  to: number,
  markdown: string,
) {
  const before = state.doc.sliceString(Math.max(0, from - 2), from);
  const after = state.doc.sliceString(to, Math.min(state.doc.length, to + 2));
  const prefix =
    from === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const suffix =
    to === state.doc.length || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  return {
    changes: { from, to, insert: prefix + markdown + suffix },
    range: EditorSelection.cursor(from + prefix.length + markdown.length),
  };
}

/** The host resolves Zotero metadata synchronously before emitting this input. */
export function pdfSelectionInput(isComposing: () => boolean) {
  return EditorView.domEventHandlers({
    [PDF_SELECTION_EVENT](event, view) {
      if (
        view.state.readOnly ||
        view.composing ||
        view.compositionStarted ||
        isComposing()
      )
        return false;
      const payload = readInsertion(event);
      if (!payload) return false;
      const position = payload.position
        ? view.posAtCoords(payload.position)
        : undefined;
      if (position === null) return false;
      let insertion;
      if (position === undefined) {
        insertion = view.state.changeByRange((range) =>
          blockInsertion(view.state, range.from, range.to, payload.markdown),
        );
      } else {
        const block = blockInsertion(
          view.state,
          position,
          position,
          payload.markdown,
        );
        insertion = {
          changes: block.changes,
          selection: EditorSelection.create([block.range]),
        };
      }
      view.dispatch({
        ...insertion,
        scrollIntoView: true,
        userEvent: payload.position ? "input.drop" : "input.paste",
        annotations: isolateHistory.of("full"),
      });
      event.preventDefault();
      view.focus();
      return true;
    },
  });
}
