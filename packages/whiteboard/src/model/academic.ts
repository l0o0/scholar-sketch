import type { BasicNode, BasicNodeKind } from "./basic";
import type { CanvasNodeBase, CanvasNodeStyle, CanvasPoint } from "./core";
import type { WhiteboardTheme } from "./protocol";

export type AcademicNodeKind = "literature" | "quote" | "note" | "frame";

export const ACADEMIC_SOURCE_CARD_SIZE = {
  literature: { width: 280, height: 200 },
  quote: { width: 280, height: 192 },
} as const;

export type ZoteroLibraryRef =
  { type: "user" } | { type: "group"; groupID: number };

export interface LiteratureSource {
  library: ZoteroLibraryRef;
  itemKey: string;
}

/** Stable identity for a Zotero file attachment. Numeric item ids are runtime-only. */
export interface AttachmentSource {
  library: ZoteroLibraryRef;
  attachmentKey: string;
}

export interface QuoteSource extends LiteratureSource {
  attachmentKey: string;
  annotationKey: string;
}

export interface NoteSource {
  library: ZoteroLibraryRef;
  noteKey: string;
  itemKey?: string;
}

function sourceLibraryIdentity(
  library: ZoteroLibraryRef,
): [string, number | null] {
  return library.type === "user" ? ["user", null] : ["group", library.groupID];
}

export function literatureSourceIdentity(source: LiteratureSource): string {
  return JSON.stringify([
    "literature",
    ...sourceLibraryIdentity(source.library),
    source.itemKey,
  ]);
}

export function attachmentSourceIdentity(source: AttachmentSource): string {
  return JSON.stringify([
    "attachment",
    ...sourceLibraryIdentity(source.library),
    source.attachmentKey,
  ]);
}

export function quoteAttachmentIdentity(source: QuoteSource): string {
  return JSON.stringify([
    "quote-attachment",
    ...sourceLibraryIdentity(source.library),
    source.itemKey,
    source.attachmentKey,
  ]);
}

export function quoteSourceIdentity(source: QuoteSource): string {
  return JSON.stringify([
    "quote",
    ...sourceLibraryIdentity(source.library),
    source.itemKey,
    source.attachmentKey,
    source.annotationKey,
  ]);
}

export function noteSourceIdentity(source: NoteSource): string {
  return JSON.stringify([
    "note",
    ...sourceLibraryIdentity(source.library),
    source.itemKey ?? null,
    source.noteKey,
  ]);
}

export interface LiteratureSnapshot {
  title: string;
  creators?: string;
  year?: string;
  publicationTitle?: string;
  tags?: string[];
  annotationCount?: number;
}

export type AttachmentAvailability = "available" | "not-downloaded";

export interface AttachmentSnapshot {
  filename: string;
  contentType?: string;
  availability: AttachmentAvailability;
}

export interface QuoteSnapshot {
  text: string;
  comment?: string;
  citation?: string;
  pageLabel?: string;
  color?: string;
}

export interface NoteSourceSnapshot {
  title?: string;
}

export interface LiteratureNode extends CanvasNodeBase<"literature"> {
  source: LiteratureSource;
  snapshot: LiteratureSnapshot;
}

export interface QuoteNode extends CanvasNodeBase<"quote"> {
  source: QuoteSource;
  snapshot: QuoteSnapshot;
}

export const NOTE_TYPES = [
  "note",
  "question",
  "claim",
  "evidence",
  "summary",
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export function isNoteType(value: unknown): value is NoteType {
  return NOTE_TYPES.some((type) => type === value);
}

// Older cards stored their role in the visible badge. Explicit types always win.
const LEGACY_NOTE_TYPES: Record<string, NoteType> = {
  Note: "note",
  "\u7b14\u8bb0": "note",
  Question: "question",
  "\u95ee\u9898": "question",
  Claim: "claim",
  Viewpoint: "claim",
  "\u4e3b\u5f20": "claim",
  "\u89c2\u70b9": "claim",
  Evidence: "evidence",
  "\u8bc1\u636e": "evidence",
  Summary: "summary",
  "\u603b\u7ed3": "summary",
};

export function getNoteType(note: NoteNode): NoteType {
  return note.noteType ?? legacyNoteType(note) ?? "note";
}

export function getNoteTitle(note: NoteNode): string | undefined {
  return note.noteType === undefined && legacyNoteType(note)
    ? undefined
    : note.badge;
}

function legacyNoteType(note: NoteNode): NoteType | undefined {
  return note.badge && Object.hasOwn(LEGACY_NOTE_TYPES, note.badge)
    ? LEGACY_NOTE_TYPES[note.badge]
    : undefined;
}

export interface NoteNode extends CanvasNodeBase<"note"> {
  noteType?: NoteType;
  content: string;
  badge?: string;
  source?: NoteSource;
  sourceSnapshot?: NoteSourceSnapshot;
}

export interface FrameNode extends Omit<CanvasNodeBase<"frame">, "frameId"> {
  title: string;
}

export type AcademicNode = LiteratureNode | QuoteNode | NoteNode | FrameNode;

export type CanvasNode = BasicNode | AcademicNode;
export type CanvasNodeKind = BasicNodeKind | AcademicNodeKind;

export type CanvasNodeSurfaceDefaults = Required<
  Pick<
    CanvasNodeStyle,
    "stroke" | "fill" | "strokeWidth" | "radius" | "strokeStyle"
  >
>;

export type CanvasNodeTextDefaults = Required<
  Pick<
    CanvasNodeStyle,
    | "fontFamily"
    | "fontSize"
    | "fontWeight"
    | "fontStyle"
    | "textDecoration"
    | "textAlign"
    | "verticalAlign"
    | "textColor"
    | "textOpacity"
  >
>;

export interface CanvasThemePalette {
  surface: string;
  border: string;
  text: string;
  edge: string;
}

export type CanvasNodeUiTextStyle = Omit<
  CanvasNodeTextDefaults,
  "textColor"
> & { textColor?: string };

export function canvasThemePalette(theme: WhiteboardTheme): CanvasThemePalette {
  return theme === "dark"
    ? {
        surface: "#1a1d24",
        border: "#3d4452",
        text: "#e8eaed",
        edge: "#6b7280",
      }
    : {
        surface: "#ffffff",
        border: "#e5e7eb",
        text: "#111827",
        edge: "#9ca3af",
      };
}

// Low-chroma paper colors distinguish roles without competing with the text.
const NOTE_TYPE_SURFACES = {
  question: {
    fill: "oklch(96% 0.045 88)",
    stroke: "oklch(68% 0.10 85)",
    radius: 16,
    strokeWidth: 1,
    strokeStyle: "dashed",
  },
  claim: {
    fill: "oklch(95% 0.032 148)",
    stroke: "oklch(61% 0.08 150)",
    radius: 8,
    strokeWidth: 2,
    strokeStyle: "solid",
  },
  evidence: {
    fill: "oklch(96% 0.028 240)",
    stroke: "oklch(66% 0.075 240)",
    radius: 4,
    strokeWidth: 1,
    strokeStyle: "solid",
  },
  summary: {
    fill: "oklch(95% 0.028 300)",
    stroke: "oklch(66% 0.075 300)",
    radius: 12,
    strokeWidth: 1,
    strokeStyle: "solid",
  },
} satisfies Record<Exclude<NoteType, "note">, CanvasNodeSurfaceDefaults>;
const DARK_NOTE_TYPE_COLORS = {
  question: { fill: "oklch(27% 0.028 88)", stroke: "oklch(65% 0.08 85)" },
  claim: { fill: "oklch(27% 0.024 148)", stroke: "oklch(63% 0.065 150)" },
  evidence: { fill: "oklch(27% 0.028 240)", stroke: "oklch(65% 0.07 240)" },
  summary: { fill: "oklch(27% 0.028 300)", stroke: "oklch(66% 0.07 300)" },
};

export function canvasNodeSurfaceDefaults(
  kind: CanvasNodeKind,
  noteType?: NoteType,
): CanvasNodeSurfaceDefaults {
  if (kind === "note" && noteType && noteType !== "note")
    return { ...NOTE_TYPE_SURFACES[noteType] };
  if (kind === "frame") {
    return {
      stroke: "#94a3b8",
      fill: "rgba(59, 130, 246, 0.05)",
      strokeWidth: 2,
      radius: 8,
      strokeStyle: "solid",
    };
  }
  if (
    kind === "rect" ||
    kind === "ellipse" ||
    kind === "line" ||
    kind === "arrow"
  ) {
    return {
      stroke: "#1f2937",
      fill: "#ffffff",
      strokeWidth: 2,
      radius: 8,
      strokeStyle: "solid",
    };
  }
  return {
    stroke: "#e5e7eb",
    fill: "#ffffff",
    strokeWidth: 1,
    radius: 8,
    strokeStyle: "solid",
  };
}

export function canvasNodeUiSurfaceDefaults(
  kind: CanvasNodeKind,
  theme: WhiteboardTheme,
  noteType?: NoteType,
): CanvasNodeSurfaceDefaults {
  const defaults = canvasNodeSurfaceDefaults(kind, noteType);
  if (theme === "light") return defaults;
  if (kind === "note" && noteType && noteType !== "note")
    return { ...defaults, ...DARK_NOTE_TYPE_COLORS[noteType] };
  const palette = canvasThemePalette(theme);
  if (kind === "frame") {
    return { ...defaults, stroke: "#64748b", fill: "rgba(96, 165, 250, 0.08)" };
  }
  if (kind === "rect" || kind === "ellipse") {
    return { ...defaults, stroke: palette.text, fill: palette.surface };
  }
  if (kind === "line" || kind === "arrow") {
    return { ...defaults, stroke: palette.edge, fill: palette.surface };
  }
  return { ...defaults, stroke: palette.border, fill: palette.surface };
}

export function canvasNodeTextDefaults(
  kind: CanvasNodeKind,
): CanvasNodeTextDefaults {
  const common = {
    fontFamily: "system-ui, sans-serif",
    fontStyle: "normal",
    textDecoration: "none",
    textColor: "#111827",
    textOpacity: 1,
  } as const;
  if (
    kind === "item" ||
    kind === "pdf" ||
    kind === "attachment" ||
    kind === "literature" ||
    kind === "frame"
  ) {
    return {
      ...common,
      fontSize: 13,
      fontWeight: "bold",
      textAlign: "left",
      verticalAlign: "top",
    };
  }
  if (kind === "quote" || kind === "note") {
    return {
      ...common,
      fontSize: 12,
      fontWeight: "normal",
      textAlign: "left",
      verticalAlign: "top",
    };
  }
  return {
    ...common,
    fontSize: 16,
    fontWeight: "normal",
    textAlign: "center",
    verticalAlign: "middle",
  };
}

export function effectiveCanvasNodeTextStyle(
  kind: CanvasNodeKind,
  style: Partial<CanvasNodeStyle> = {},
): CanvasNodeTextDefaults {
  const defaults = canvasNodeTextDefaults(kind);
  const fontSize = style.fontSize;
  return {
    fontFamily: style.fontFamily || defaults.fontFamily,
    fontSize:
      typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
        ? fontSize
        : defaults.fontSize,
    fontWeight: style.fontWeight ?? defaults.fontWeight,
    fontStyle: style.fontStyle ?? defaults.fontStyle,
    textDecoration: style.textDecoration ?? defaults.textDecoration,
    textAlign: style.textAlign ?? defaults.textAlign,
    verticalAlign: style.verticalAlign ?? defaults.verticalAlign,
    textColor: style.textColor || defaults.textColor,
    textOpacity: style.textOpacity ?? defaults.textOpacity,
  };
}

export function effectiveCanvasNodeUiTextStyle(
  kind: CanvasNodeKind,
  style: Partial<CanvasNodeStyle> = {},
): CanvasNodeUiTextStyle {
  const { textColor: _deterministicColor, ...effective } =
    effectiveCanvasNodeTextStyle(kind, style);
  return {
    ...effective,
    ...(style.textColor ? { textColor: style.textColor } : {}),
  };
}

export interface LiteratureNodeOptions {
  source: LiteratureSource;
  snapshot: LiteratureSnapshot;
}

export interface QuoteNodeOptions {
  source: QuoteSource;
  snapshot: QuoteSnapshot;
}

export interface NoteNodeOptions {
  noteType?: NoteType;
  content?: string;
  badge?: string;
  style?: CanvasNodeStyle;
  width?: number;
  height?: number;
}

export function createAcademicNode(
  kind: "literature",
  position: CanvasPoint,
  id: string,
  options: LiteratureNodeOptions,
): LiteratureNode;
export function createAcademicNode(
  kind: "quote",
  position: CanvasPoint,
  id: string,
  options: QuoteNodeOptions,
): QuoteNode;
export function createAcademicNode(
  kind: "note",
  position: CanvasPoint,
  id: string,
  options?: NoteNodeOptions,
): NoteNode;
export function createAcademicNode(
  kind: "frame",
  position: CanvasPoint,
  id: string,
): FrameNode;
export function createAcademicNode(
  kind: AcademicNodeKind,
  position: CanvasPoint,
  id: string,
  options?: LiteratureNodeOptions | QuoteNodeOptions | NoteNodeOptions,
): AcademicNode {
  switch (kind) {
    case "literature":
      return {
        id,
        kind,
        position,
        ...ACADEMIC_SOURCE_CARD_SIZE.literature,
        source: (options as LiteratureNodeOptions).source,
        snapshot: (options as LiteratureNodeOptions).snapshot,
      };
    case "quote":
      return {
        id,
        kind,
        position,
        ...ACADEMIC_SOURCE_CARD_SIZE.quote,
        source: (options as QuoteNodeOptions).source,
        snapshot: (options as QuoteNodeOptions).snapshot,
      };
    case "note":
      return {
        id,
        kind,
        position,
        width: (options as NoteNodeOptions | undefined)?.width ?? 260,
        height: (options as NoteNodeOptions | undefined)?.height ?? 152,
        content: (options as NoteNodeOptions | undefined)?.content ?? "",
        ...((options as NoteNodeOptions | undefined)?.noteType
          ? { noteType: (options as NoteNodeOptions).noteType }
          : {}),
        ...((options as NoteNodeOptions | undefined)?.badge !== undefined
          ? { badge: (options as NoteNodeOptions).badge }
          : {}),
        ...((options as NoteNodeOptions | undefined)?.style
          ? { style: { ...(options as NoteNodeOptions).style } }
          : {}),
      };
    case "frame":
      return { id, kind, position, width: 480, height: 320, title: "Frame" };
  }
}
