import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SlashQuery } from "./slash-commands";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;
type InlineFormat = "StrongEmphasis" | "Emphasis" | "InlineCode";
interface TextRange {
  from: number;
  to: number;
}

function linePrefix(text: string) {
  const container = text.match(/^[\t ]*(?:>[\t ]*)*/)?.[0] ?? "";
  const rest = text.slice(container.length);
  const marker =
    rest.match(
      /^(?:#{1,6}(?:[\t ]+|$)|(?:[-+*]|\d+[.)])[\t ]+(?:\[[ xX]\](?:[\t ]+|$))?)/,
    )?.[0] ?? "";
  const heading =
    marker && !marker.startsWith("#")
      ? (rest.slice(marker.length).match(/^#{1,6}(?:[\t ]+|$)/)?.[0] ?? "")
      : "";
  const prefix = marker + heading;
  const kind = /\[[ xX]\]/.test(marker)
    ? "task"
    : /^\d/.test(marker)
      ? "ordered"
      : /^[-+*]/.test(marker)
        ? "list"
        : marker.trim();
  return {
    container,
    prefix,
    kind,
  };
}

function selectedLines(state: EditorState, range: TextRange) {
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(
    range.to > range.from ? range.to - 1 : range.to,
  ).number;
  return Array.from({ length: last - first + 1 }, (_, i) =>
    state.doc.line(first + i),
  );
}

function codeBlockOnLine(tree: ReturnType<typeof syntaxTree>, line: TextRange) {
  let protectedLine = false;
  tree.iterate({
    from: line.from,
    to: line.to,
    enter(ref) {
      // Container marks and indentation can precede the code node on its first
      // line. Checking only line.from would miss quoted or nested-list fences.
      if (
        /^(?:FencedCode|CodeBlock|HTMLBlock)$/.test(ref.name) &&
        ref.from <= line.to &&
        ref.to > line.from
      ) {
        protectedLine = true;
        return false;
      }
    },
  });
  return protectedLine;
}

function formatMarks(node: SyntaxNode): [TextRange, TextRange] | null {
  const first = node.firstChild;
  const last = node.lastChild;
  if (
    !first ||
    !last ||
    first === last ||
    !/^(?:EmphasisMark|CodeMark)$/.test(first.name) ||
    last.name !== first.name
  )
    return null;
  return [first, last];
}

function formattedRange(
  tree: ReturnType<typeof syntaxTree>,
  range: TextRange,
  format: InlineFormat,
): SyntaxNode | null {
  let result: SyntaxNode | null = null;
  tree.iterate({
    from: range.from,
    to: range.to,
    enter(ref) {
      if (ref.name !== format) return;
      const node = ref.node;
      const marks = formatMarks(node);
      if (!marks) return;
      const [open, close] = marks;
      let matches =
        range.from >= node.from &&
        range.to <= node.to &&
        range.from <= close.from &&
        range.to >= open.to;
      // A complete outer emphasis selection may contain another format's marks,
      // as in selecting ***both*** and removing only its bold formatting.
      for (
        let wrapper: SyntaxNode | null = node;
        wrapper &&
        /^(?:Emphasis|StrongEmphasis|InlineCode)$/.test(wrapper.name);
        wrapper = wrapper.parent
      ) {
        if (range.from === wrapper.from && range.to === wrapper.to)
          matches = true;
      }
      if (matches && (!result || node.to - node.from < result.to - result.from))
        result = node;
    },
  });
  return result;
}

function removeMarks(state: EditorState, node: SyntaxNode): ChangeSpec[] {
  const [open, close] = formatMarks(node)!;
  let openEnd = open.to;
  let closeStart = close.from;
  if (node.name === "InlineCode") {
    const content = state.sliceDoc(openEnd, closeStart);
    if (
      content.startsWith(" ") &&
      content.endsWith(" ") &&
      /[^ ]/.test(content)
    ) {
      openEnd++;
      closeStart--;
    }
  }
  return [
    { from: open.from, to: openEnd },
    { from: closeStart, to: close.to },
  ];
}

function cancelSelectedFormat(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  node: SyntaxNode,
  range: TextRange,
  marker: string,
): ChangeSpec[] {
  const [open, close] = formatMarks(node)!;
  if (
    range.from === range.to ||
    (range.from <= open.to && range.to >= close.from)
  )
    return removeMarks(state, node);
  const from = Math.max(open.to, range.from);
  const to = Math.min(close.from, range.to);
  if (node.name === "InlineCode") {
    const content = state.sliceDoc(open.to, close.from);
    const padded =
      content.startsWith(" ") && content.endsWith(" ") && /[^ ]/.test(content);
    const bodyFrom = open.to + Number(padded);
    const bodyTo = close.from - Number(padded);
    const encode = (text: string) => {
      const core = text.trim();
      if (!core) return text;
      const leading = text.slice(0, text.length - text.trimStart().length);
      const trailing = text.slice(text.trimEnd().length);
      const longest = Math.max(
        0,
        ...[...core.matchAll(/`+/g)].map((match) => match[0].length),
      );
      const delimiter = "`".repeat(longest + 1);
      const pad = core.startsWith("`") || core.endsWith("`") ? " " : "";
      return leading + delimiter + pad + core + pad + delimiter + trailing;
    };
    return [
      {
        from: open.from,
        to: from,
        insert: encode(state.sliceDoc(bodyFrom, Math.max(bodyFrom, from))),
      },
      {
        from: to,
        to: close.to,
        insert: encode(state.sliceDoc(Math.min(bodyTo, to), bodyTo)),
      },
    ];
  }
  const prefix = state.sliceDoc(open.to, from);
  const suffix = state.sliceDoc(to, close.from);
  let leftEnd = open.to + prefix.trimEnd().length;
  let rightStart = close.from - suffix.trimStart().length;
  const innerMarks: [TextRange, TextRange][] = [];
  tree.iterate({
    from: open.to,
    to: close.from,
    enter(ref) {
      if (
        ref.from > node.from &&
        ref.to < node.to &&
        /^(?:Emphasis|StrongEmphasis)$/.test(ref.name)
      ) {
        const marks = formatMarks(ref.node);
        if (marks) innerMarks.push(marks);
      }
    },
  });
  // When the selection starts/ends exactly at inner content, keep that
  // content's own delimiter with it instead of reopening the outer format
  // in the middle of a closing/opening delimiter run.
  for (const [innerOpen] of innerMarks.toReversed()) {
    if (innerOpen.to === leftEnd) {
      leftEnd = innerOpen.from;
      leftEnd = open.to + state.sliceDoc(open.to, leftEnd).trimEnd().length;
    }
  }
  for (const [, innerClose] of innerMarks.toReversed()) {
    if (innerClose.from === rightStart) {
      rightStart = innerClose.to;
      rightStart =
        close.from - state.sliceDoc(rightStart, close.from).trimStart().length;
    }
  }
  const keepLeft = !!state.sliceDoc(open.to, leftEnd).trim();
  const keepRight = !!state.sliceDoc(rightStart, close.from).trim();
  // Different delimiter characters keep adjacent nested fragments unambiguous
  // for both CodeMirror and the export renderer. Underscores must not open or
  // close inside a word.
  const outsideWord =
    !/[\p{L}\p{N}]/u.test(
      state.sliceDoc(Math.max(0, node.from - 1), node.from),
    ) &&
    !/[\p{L}\p{N}]/u.test(
      state.sliceDoc(node.to, Math.min(state.doc.length, node.to + 1)),
    );
  const delimiter =
    innerMarks.length && outsideWord ? "_".repeat(marker.length) : marker;
  const edits: ChangeSpec[] = [];
  const splitNested = (position: number, reopening: boolean) => {
    const nested: SyntaxNode[] = [];
    tree.iterate({
      from: position,
      to: position,
      enter(ref) {
        if (
          ref.from <= node.from ||
          ref.to >= node.to ||
          !/^(?:Emphasis|StrongEmphasis)$/.test(ref.name)
        )
          return;
        const marks = formatMarks(ref.node);
        if (marks && marks[0].to < position && marks[1].from > position)
          nested.push(ref.node);
      },
    });
    const opening = nested
      .map((child) => {
        const [mark] = formatMarks(child)!;
        return state.sliceDoc(mark.from, mark.to);
      })
      .join("");
    const closing = nested
      .toReversed()
      .map((child) => {
        const [, mark] = formatMarks(child)!;
        return state.sliceDoc(mark.from, mark.to);
      })
      .join("");
    // Whitespace can remain outside both styles; never leave an emphasis
    // delimiter opening into a space or closing after one.
    const gap = reopening
      ? state.sliceDoc(to, position)
      : state.sliceDoc(position, from);
    if (gap && nested.length) {
      edits.push({
        from: reopening ? to : position,
        insert: closing + (reopening ? "" : delimiter),
      });
      edits.push({
        from: reopening ? position : from,
        insert: (reopening ? delimiter : "") + opening,
      });
    } else
      edits.push({ from: position, insert: closing + delimiter + opening });
  };
  if (keepLeft) {
    edits.push({ from: open.from, to: open.to, insert: delimiter });
    splitNested(leftEnd, false);
  } else edits.push({ from: open.from, to: open.to });
  if (keepRight) {
    splitNested(rightStart, true);
    edits.push({ from: close.from, to: close.to, insert: delimiter });
  } else edits.push({ from: close.from, to: close.to });
  return edits;
}

function transaction(
  state: EditorState,
  specs: ChangeSpec[],
  selection?: TransactionSpec["selection"],
  inline = false,
): TransactionSpec | null {
  if (!specs.length) return null;
  const changes = state.changes(specs);
  const old = state.selection.main;
  const forward = old.anchor <= old.head;
  const from = changes.mapPos(old.from, inline ? 1 : -1);
  const to = changes.mapPos(old.to, -1);
  return {
    changes,
    selection:
      selection ??
      (old.empty
        ? EditorSelection.cursor(changes.mapPos(old.head, 1))
        : EditorSelection.range(forward ? from : to, forward ? to : from)),
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  };
}

/** The toolbar, keyboard shortcuts and slash menu share these editor commands. */
export function wrapSelectionTransaction(
  state: EditorState,
  before: string,
  after = before,
  query?: SlashQuery,
): TransactionSpec | null {
  if (state.readOnly) return null;
  const range = query ?? state.selection.main;
  const selected = query ? "" : state.sliceDoc(range.from, range.to);
  if (before === "[" && after === "](url)") {
    const start = range.from + selected.length + 3;
    return transaction(
      state,
      [{ ...range, insert: `[${selected}](url)` }],
      EditorSelection.range(start, start + 3),
    );
  }
  const format: InlineFormat | undefined =
    before === after
      ? (
          {
            "**": "StrongEmphasis",
            "*": "Emphasis",
            "`": "InlineCode",
          } as const
        )[before as "**" | "*" | "`"]
      : undefined;
  if (!format || query) {
    const insert = before + selected + after;
    const anchor = range.from + before.length;
    return transaction(
      state,
      [{ ...range, insert }],
      EditorSelection.range(anchor, anchor + selected.length),
    );
  }
  const tree = ensureSyntaxTree(state, range.to, 50) ?? syntaxTree(state);
  const existing = formattedRange(tree, range, format);
  let cutsCode = false;
  tree.iterate({
    from: range.from,
    to: range.to,
    enter(ref) {
      if (
        ref.name === "InlineCode" &&
        (range.from > ref.from || range.to < ref.to)
      )
        cutsCode = true;
    },
  });
  // Emphasis inside a code span is literal text. Only wrap a whole code span,
  // or use the code command above to remove its own delimiters.
  if (cutsCode && (format !== "InlineCode" || !existing)) return null;
  if (existing)
    return transaction(
      state,
      cancelSelectedFormat(state, tree, existing, range, before),
      undefined,
      true,
    );
  if (range.from === range.to) {
    if (codeBlockOnLine(tree, state.doc.lineAt(range.from))) return null;
    const left = range.from - before.length;
    const right = range.to + after.length;
    if (
      left >= 0 &&
      right <= state.doc.length &&
      state.sliceDoc(left, range.from) === before &&
      state.sliceDoc(range.to, right) === after
    ) {
      return transaction(
        state,
        [{ from: left, to: right }],
        EditorSelection.cursor(left),
      );
    }
    return transaction(
      state,
      [{ ...range, insert: before + after }],
      EditorSelection.cursor(range.from + before.length),
    );
  }

  // Apply inline marks separately to each selected text line. Blank lines and
  // structural prefixes stay outside the marks, preserving Markdown blocks.
  const ranges = selectedLines(state, range).flatMap((line) => {
    if (codeBlockOnLine(tree, line)) return [];
    const prefix = linePrefix(line.text);
    let from = Math.max(
      range.from,
      line.from + prefix.container.length + prefix.prefix.length,
    );
    let to = Math.min(range.to, line.to);
    tree.iterate({
      from,
      to,
      enter(ref) {
        if (
          ref.name === "HeaderMark" &&
          ref.node.parent?.name.startsWith("ATXHeading") &&
          ref.from > ref.node.parent.from
        )
          to = Math.min(to, ref.from);
      },
    });
    const text = state.sliceDoc(from, to);
    from += text.length - text.trimStart().length;
    to -= text.length - text.trimEnd().length;
    return from < to ? [{ from, to }] : [];
  });
  const nodes = ranges.map((item) => formattedRange(tree, item, format));
  if (ranges.length && nodes.every(Boolean)) {
    const unique = new Map(nodes.map((node) => [node!.from, node!]));
    return transaction(
      state,
      [...unique.values()].flatMap((node) =>
        cancelSelectedFormat(state, tree, node, range, before),
      ),
      undefined,
      true,
    );
  }
  const edits: ChangeSpec[] = [];
  ranges.forEach((item, index) => {
    if (nodes[index]) return;
    if (format !== "InlineCode") {
      tree.iterate({
        from: item.from,
        to: item.to,
        enter(ref) {
          if (ref.name === format && ref.from < item.to && ref.to > item.from) {
            item.from = Math.min(item.from, ref.from);
            item.to = Math.max(item.to, ref.to);
          }
        },
      });
    }
    let marker = before;
    let padding = "";
    const text = state.sliceDoc(item.from, item.to);
    if (format === "InlineCode") {
      const longest = Math.max(
        0,
        ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
      );
      marker = "`".repeat(longest + 1);
      if (text.startsWith("`") || text.endsWith("`")) padding = " ";
    } else {
      tree.iterate({
        from: item.from,
        to: item.to,
        enter(ref) {
          if (
            ref.name === format &&
            ref.from >= item.from &&
            ref.to <= item.to
          ) {
            edits.push(...removeMarks(state, ref.node));
            return false;
          }
        },
      });
    }
    edits.push(
      { from: item.from, insert: marker + padding },
      { from: item.to, insert: padding + marker },
    );
  });
  return transaction(state, edits, undefined, true);
}

export function prefixLinesTransaction(
  state: EditorState,
  prefix: string,
  query?: SlashQuery,
): TransactionSpec | null {
  if (state.readOnly) return null;
  const range = query ?? state.selection.main;
  if (query) {
    return transaction(
      state,
      [{ from: query.from, to: query.to, insert: prefix }],
      EditorSelection.cursor(query.from + prefix.length),
    );
  }
  const tree = ensureSyntaxTree(state, range.to, 50) ?? syntaxTree(state);
  const lines = selectedLines(state, range).filter(
    (line) =>
      !codeBlockOnLine(tree, line) &&
      (range.from === range.to || line.text.trim()),
  );
  const parsed = lines.map((line) => ({ line, ...linePrefix(line.text) }));
  const target = linePrefix(prefix).kind;
  const remove =
    parsed.length > 0 && parsed.every((item) => item.kind === target);
  const edits: ChangeSpec[] = [];
  for (const item of parsed) {
    const start = item.line.from + item.container.length;
    const next = remove ? "" : item.kind === target ? item.prefix : prefix;
    if (next !== item.prefix)
      edits.push({ from: start, to: start + item.prefix.length, insert: next });
  }
  return transaction(state, edits);
}
