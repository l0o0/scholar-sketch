import {
  selectedDocument,
  cloneSelection,
  serializeSelection,
  parseSelection,
  layoutSelection,
  searchCanvas,
} from "./selection";
import { THEME_TOKENS, UI_METRICS } from "../../../../src/ui/theme";
/// <reference lib="dom" />

import {
  getNoteType,
  canvasNodeSurfaceDefaults,
  type NoteType,
} from "../model/academic";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
  type CSSProperties,
} from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  getBezierPath,
  MarkerType,
  Position,
  ReactFlow,
  ViewportPortal,
  addEdge,
  applyEdgeChanges,
  reconnectEdge,
  useKeyPress,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./board.css";
import {
  createAcademicNode,
  effectiveCanvasNodeUiTextStyle,
  quoteSourceIdentity,
  type CanvasNode,
  type CanvasNodeKind,
  type LiteratureSource,
  type NoteSource,
} from "../model/academic";
import { createBasicNode } from "../model/basic";
import { hasDefaultTutorialViewport } from "../model/tutorial";
import {
  demoCanvasDocument,
  parseCanvasDocument,
  type CanvasDocument,
} from "../model/document";
import {
  BUILTIN_NOTE_TEMPLATE_IDS,
  BUILTIN_NOTE_TEMPLATES,
  applyNoteTemplate,
  createBuiltinNoteTemplates,
  changeNoteType,
  createCustomNoteTemplate,
  materializeNoteTemplate,
  parseNoteTemplateRegistry,
  type NoteTemplate,
} from "../model/note-template";
import type {
  AcademicAcquisition,
  AcademicAcquisitionFailure,
  AcademicDropFailureCode,
  AcademicDropSourceRef,
  AcademicRequestFailureCode,
  AcademicSourceDescriptor,
  AcademicSourceActionFailure,
  AnnotationCandidate,
  AnnotationListFailure,
  CanvasFailureCode,
  CanvasNotice,
  IndexedAcademicAcquisition,
  SourceResolutionPriority,
  SourceResolutionResult,
  WhiteboardLabels,
  WhiteboardTheme,
} from "../model/protocol";
import { canvasNodeTypes, type CanvasFlowNode } from "../nodes";
import { PropertiesPanel } from "../chrome/PropertiesPanel";
import {
  AnnotationBrowser,
  existingAnnotationKeys,
  toggleAnnotationSelection,
} from "../chrome/AnnotationBrowser";
import { ShortcutsOverlay } from "../chrome/ShortcutsOverlay";
import { StyleBar } from "../chrome/StyleBar";
import { EdgeStyleBar } from "../chrome/EdgeStyleBar";
import { TextStyleBar } from "../chrome/TextStyleBar";
import { TopIsland } from "../chrome/TopIsland";
import { WhiteboardLabelsProvider, noteTypePrompt } from "../chrome/labels";
import {
  drawNodeKind,
  drawNodeStyle,
  frameFromDrag,
  isBorderHit,
  isDrawTool,
  isLibraryKind,
  isStampTool,
  noteTemplateShortcut,
  shouldEditOnCreate,
  toolAfterDraw,
  type DrawFrame,
  type DrawKind,
} from "../chrome/draw";
import {
  connectionDisplayLabel,
  ConnectionEditor,
} from "../chrome/ConnectionEditor";
import type { CanvasTool } from "../chrome/tools";
import { alignNodes, distributeNodes, type AlignMode } from "./layout";
import {
  buildCanvasMarkdown,
  buildCanvasSvg,
  connectionEndpoint,
} from "./export";
import { exportCanvasPng, type PngScale } from "./png";
import {
  canAcceptNativeFileTransfer,
  fileImportFailureMessage,
  importWhiteboardFiles,
  isEditingImportSessionCurrent,
  type ImportedWhiteboardFile,
} from "./file-import";
import {
  acceptAnnotationListFailure,
  acceptAnnotationListResult,
  closeAnnotationBrowserSession,
  openAnnotationBrowserSession,
  replaceDocumentAnnotationBrowserSession,
  type AnnotationBrowserSession,
} from "./annotationBrowserState";
import {
  beginNodeEditing,
  canvasDocumentToFlow,
  flowNodeText,
  flowToCanvasDocument,
  applyCanvasNodeChanges,
  labelTextStyle,
  nodeTextStyle,
  mergeEditingStyle,
  toggleEditingBold,
  type CanvasFlowEdge,
  updateFlowNodeModel,
  verticalAlignmentStyle,
  withEdgeStyle,
} from "./document";
import { armEditFocusHold, handleEditBlur } from "./editFocus";
import { IconCopy, IconEdit, IconExport, IconOpen, IconTrash } from "./icons";
import {
  beginFrameDragState,
  assignNodeToFrame,
  deleteNodeFromDocument,
  finishFrameDragState,
  moveNodesInDocument,
  settleFrameDragState,
  updateFrameDragState,
  type FrameDragState,
} from "./frame";
import {
  captureCanvasArrowKey,
  handleGlobalCanvasKeyDown,
  isEditableTarget,
} from "./keyboard";
import {
  createAcademicAcquisitionRuntime,
  omitAcademicPlaceholders,
  useCanvasDocumentRuntime,
  type AcademicAcquisitionRuntime,
} from "./runtime";
import {
  createQuoteBatchRuntime,
  createSourceActionCorrelation,
  createSourceRefreshRuntime,
  createSourceResolutionStates,
  prioritizedSourceRequests,
  sourceDescriptor,
  updateSourceResolutionStates,
  type SourceRefreshRuntime,
  type SourceResolutionRequest,
} from "./sourceState";
import {
  createNoteRefreshRuntime,
  type NoteRefreshRuntime,
} from "./noteRefresh";

type FileLabelKey =
  | "fileImage"
  | "filePdf"
  | "fileText"
  | "fileAudio"
  | "fileVideo"
  | "fileGeneric"
  | "fileOpen"
  | "fileDetails"
  | "filePreview"
  | "fileTooLarge"
  | "fileImportFailed"
  | "fileUnavailable"
  | "fileDimensions"
  | "filePages";
type FileLabelValues = Partial<Record<FileLabelKey, string>>;

const DEFAULT_LABELS: WhiteboardLabels & FileLabelValues = {
  canvas: "Canvas",
  selection: "Selection",
  select: "Select (V)",
  hand: "Hand (H)",
  addItem: "Item",
  addNote: "Note",
  addQuestion: "Question",
  addClaim: "Viewpoint",
  addEvidence: "Evidence",
  addSummary: "Summary",
  noteType: "Card type",
  notePrompt: "Capture a thought or reading note.",
  questionPrompt: "What do I want to understand?",
  claimPrompt: "What is my view, and why?",
  evidencePrompt: "Which passage, data, or example matters?",
  summaryPrompt: "What agrees, what differs, and what remains open?",
  editNoteBody: "Edit body",
  addFrame: "Frame",
  addPdf: "PDF",
  addFile: "File",
  addText: "Text",
  addRect: "Rect",
  addRoundedRect: "Rounded rectangle",
  addDiamond: "Diamond",
  attachmentNotDownloaded: "Not downloaded",
  fileImage: "Image",
  filePdf: "PDF",
  fileText: "Text",
  fileAudio: "Audio",
  fileVideo: "Video",
  fileGeneric: "File",
  fileOpen: "Open file",
  fileDetails: "File details",
  filePreview: "Preview",
  fileTooLarge: "Files must be 15 MB or smaller, up to 30 MB per batch.",
  fileImportFailed: "The file could not be imported.",
  fileUnavailable: "The file is unavailable.",
  fileDimensions: "Dimensions",
  filePages: "Pages",
  addEllipse: "Oval",
  addLine: "Line",
  addArrow: "Arrow",
  kindLiterature: "Literature",
  kindQuote: "Quote",
  kindNote: "Note",
  emptyNote: "Empty note",
  badge: "Title (optional)",
  applyTemplate: "Apply template",
  chooseTemplate: "Choose a template to apply…",
  saveAsTemplate: "Save as template",
  templateName: "Template name",
  includeTemplateContent: "Include body text",
  customTemplates: "Custom templates",
  noCustomTemplates: "No custom templates",
  renameTemplate: "Rename template",
  duplicateTemplate: "Duplicate template",
  deleteTemplate: "Delete template",
  kindFrame: "Frame",
  annotationColor: "Annotation color",
  annotations: { one: "annotation", other: "annotations" },
  sourceStatus: "Source status",
  sourceIdle: "Not checked",
  sourceAvailable: "Available",
  sourceLoading: "Checking…",
  sourceMissing: "Source unavailable",
  acquisitionSummary:
    "Added {successCount} source(s); {failureCount} could not be added.",
  dropMalformed: "The Zotero drop could not be read.",
  dropUnsupported: "This Zotero drag type cannot be added to the canvas.",
  acquisitionFailed: "The Zotero source could not be added.",
  sourceOpenFailed: "The Zotero source could not be opened.",
  sourceRefreshFailed: "The Zotero source could not be refreshed.",
  noteRefreshFailed: "The Zotero Note could not be refreshed.",
  failureLibraryMissing: "The Zotero library is unavailable.",
  failureItemMissing: "The Zotero item no longer exists.",
  failureWrongKind: "The Zotero item type no longer matches this source.",
  failureParentMismatch: "The Zotero item's parent has changed.",
  failureAttachmentUnavailable: "The Zotero attachment is unavailable.",
  failureAnnotationUnavailable: "The Zotero annotation is unavailable.",
  failureResolutionFailed: "Zotero could not resolve the current source.",
  failureOpenFailed: "Zotero could not open the current source.",
  failureListFailed: "Zotero could not list annotations for this source.",
  openSource: "Open source",
  refreshSource: "Refresh source",
  refreshNote: "Refresh from Zotero",
  viewAnnotations: "View annotations",
  annotationBrowserTitle: "Annotations",
  searchAnnotations: "Search annotations",
  annotationsLoading: "Loading annotations…",
  annotationsEmpty: "No supported annotations",
  annotationsUnavailable: "Annotations unavailable",
  annotationsPartialFailure: "Some annotations could not be loaded",
  annotationAlreadyAdded: "Already added",
  focusExistingAnnotation: "Focus existing",
  addSelectedAnnotations: "Add selected",
  annotationPage: "Page",
  noteOverwriteTitle: "Replace local Note?",
  noteOverwriteBody:
    "Zotero's current Note will replace local content. Local changes will be lost.",
  confirm: "Replace",
  cancel: "Cancel",
  groupSelection: "Group selection",
  removeFromGroup: "Remove from group",
  fitSelection: "Fit selection",
  drawTools: "Shapes and drawing",
  selectionDetails: "Selection details",
  edgeLabel: "Connection text",
  edgeRelation: "Relation",
  relationNone: "No relation",
  relationRelated: "Related",
  relationSupports: "Supports",
  relationContradicts: "Contradicts",
  eraser: "Eraser",
  undo: "Undo",
  redo: "Redo",
  save: "Save",
  switchWindow: "Open in standalone window",
  editText: "Edit text",
  copy: "Copy",
  delete: "Delete",
  openItem: "Open item",
  alignLeft: "Align left",
  alignRight: "Align right",
  alignTop: "Align top",
  alignBottom: "Align bottom",
  alignHorizontal: "Align horizontal center",
  alignVertical: "Align vertical center",
  distributeHorizontal: "Distribute horizontally",
  distributeVertical: "Distribute vertically",
  fitView: "Fit view",
  autoLayout: "Auto layout",
  searchCanvas: "Search canvas",
  duplicateSelection: "Duplicate selection",
  layoutAllConfirm:
    "No cards are selected. Arrange the entire canvas? This can be undone.",
  edgeColor: "Edge color",
  edgeDash: "Toggle dashed",
  edgeArrow: "Toggle arrow",
  edgeStyle: "Line style",
  edgeArrows: "Arrows",
  arrowNone: "None",
  arrowForward: "Forward",
  arrowReverse: "Reverse",
  arrowBoth: "Both ends",
  edgeSelection: "Connection",
  saved: "Saved",
  saving: "Saving…",
  saveFailed: "Save failed",
  exportPng: "Export PNG",
  exporting: "Rendering PNG…",
  exportRenderFailed:
    "Could not render PNG. Check that images have loaded, or try a lower resolution.",
  exportSvg: "Export SVG",
  exportMarkdown: "Export Markdown",
  more: "More",
  shortcutsTitle: "Keyboard shortcuts",
  close: "Close",
  stroke: "Stroke",
  background: "Background",
  transparent: "Transparent",
  style: "Style",
  solid: "Solid",
  dashed: "Dashed",
  corners: "Corners",
  strokeWidth: "Stroke width",
  geometry: "Size and position",
  nodeWidth: "Width",
  nodeHeight: "Height",
  positionX: "Horizontal position",
  positionY: "Vertical position",
  format: "Format",
  color: "Color",
  size: "Size",
  alignment: "Alignment",
  textAlignment: "Text alignment",
  verticalAlignment: "Vertical alignment",
  fontSystem: "System font",
  fontGeorgia: "Georgia",
  fontTimes: "Times",
  fontInter: "Inter",
  fontMenlo: "Menlo",
  fontSerifSc: "Noto Serif SC",
  weightRegular: "Regular",
  textItalic: "Italic",
  textUnderline: "Underline",
  textStrike: "Strikethrough",
  fontFamily: "Font",
  weightBold: "Bold",
  commonColors: "Common custom colors",
  recentColors: "Recently used colors",
  opacity: "Opacity",
  customColor: "Custom color",
  resetColor: "Restore default",
  shortcutSelect: "Select",
  shortcutHand: "Pan canvas",
  shortcutRect: "Draw rectangle",
  shortcutEllipse: "Draw ellipse",
  shortcutArrow: "Draw arrow",
  shortcutLine: "Draw line",
  shortcutText: "Add text",
  shortcutQuestion: "Add question",
  shortcutClaim: "Add viewpoint",
  shortcutFrame: "Add frame",
  shortcutEraser: "Erase",
  shortcutConstrain: "Constrain ratio or angle while drawing",
  shortcutCancel: "Cancel drawing or close menu",
  shortcutDelete: "Delete selection",
  shortcutUndo: "Undo",
  shortcutRedo: "Redo",
};

function fileLabel(
  labels: WhiteboardLabels,
  key: FileLabelKey,
  fallback: string,
): string {
  return (labels as WhiteboardLabels & FileLabelValues)[key] ?? fallback;
}

export interface WhiteboardAppProps {
  theme: WhiteboardTheme;
  labels?: WhiteboardLabels;
  initialSnapshot?: CanvasDocument;
  templates?: NoteTemplate[];
  onReady: (api: WhiteboardRuntime) => void;
  onChange: (rev: number) => void;
  onSave: () => void;
  onSwitchWindow?: () => void;
  onSaveNoteTemplate?: (template: NoteTemplate) => void;
  onDeleteNoteTemplate?: (templateId: string) => void;
  onPickAcademicSource: (
    requestId: string,
    nodeId: string,
    kind: "literature",
  ) => void;
  onOpenLink?: (href: string) => void;
  onOpenItem: (payload: {
    itemID?: number;
    attachmentID?: number;
    pdfPage?: number;
  }) => void;
  onOpenFile?: (payload: { nodeId: string }) => void;
  onDropAcademicSources: (
    requestId: string,
    nodeId: string,
    sources: AcademicDropSourceRef[],
  ) => void;
  onResolveAcademicSources?: (
    requestId: string,
    generation: number,
    priority: SourceResolutionPriority,
    sources: SourceResolutionRequest[],
  ) => void;
  onOpenAcademicSource?: (
    requestId: string,
    nodeId: string,
    source: AcademicSourceDescriptor,
  ) => void;
  onRefreshZoteroNote: (
    requestId: string,
    nodeId: string,
    source: NoteSource,
  ) => void;
  onListLiteratureAnnotations?: (
    requestId: string,
    source: LiteratureSource,
  ) => void;
  onExportFile: (payload: {
    requestId: string;
    format: "png" | "svg" | "md";
    mimeType: string;
    dataUrl?: string;
    text?: string;
  }) => void;
}

export interface WhiteboardRuntime {
  setTheme: (theme: WhiteboardTheme) => void;
  setLabels: (labels: WhiteboardLabels) => void;
  setTemplates: (templates: NoteTemplate[]) => void;
  loadSnapshot: (snapshot: CanvasDocument) => void;
  getSnapshot: () => CanvasDocument;
  undo: () => void;
  redo: () => void;
  beginAcademicDrop: (
    requestId: string,
    nodeId: string,
    position: { x: number; y: number },
    sources: AcademicDropSourceRef[],
  ) => void;
  rejectAcademicDrop: (code: AcademicDropFailureCode) => void;
  resolveAcademicAcquisitionBatch: (
    requestId: string,
    nodeId: string,
    successes: IndexedAcademicAcquisition[],
    failures: AcademicAcquisitionFailure[],
  ) => void;
  rejectAcademicRequest: (
    requestId: string,
    nodeId: string,
    code: AcademicRequestFailureCode,
  ) => void;
  rejectSourceAction: (
    requestId: string,
    nodeId: string,
    source: AcademicSourceDescriptor,
    failure: AcademicSourceActionFailure,
  ) => void;
  acceptSourceAction: (
    requestId: string,
    nodeId: string,
    action: "open",
    source: AcademicSourceDescriptor,
  ) => void;
  applySourceResolutionBatch: (
    generation: number,
    results: SourceResolutionResult[],
  ) => void;
  applyNoteRefresh: (
    requestId: string,
    nodeId: string,
    acquisition: Extract<AcademicAcquisition, { kind: "note" }>,
  ) => void;
  applyAnnotationCandidates: (
    requestId: string,
    source: LiteratureSource,
    candidates: AnnotationCandidate[],
    failures: AnnotationListFailure[],
  ) => void;
  rejectAnnotationList: (
    requestId: string,
    source: LiteratureSource,
    failure: AnnotationListFailure,
  ) => void;
  setSaveState: (state: "saved" | "saving" | "error") => void;
}

function newId(kind: string) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
}

const SOURCE_PRIORITY_ORDER: Record<SourceResolutionPriority, number> = {
  selected: 0,
  visible: 1,
  idle: 2,
};

export function canvasNoticeText(
  labels: WhiteboardLabels,
  notice: CanvasNotice,
): string {
  const withFailures = (
    message: string,
    codes: readonly CanvasFailureCode[],
  ) => {
    const reasons = [...new Set(codes)]
      .map((code) => canvasFailureText(labels, code))
      .filter((reason): reason is string => Boolean(reason));
    return reasons.length ? `${message} ${reasons.join(" ")}` : message;
  };
  switch (notice.code) {
    case "acquisition-summary":
      return labels.acquisitionSummary
        .replace("{successCount}", String(notice.context.successCount))
        .replace("{failureCount}", String(notice.context.failureCount));
    case "drop-malformed":
      return labels.dropMalformed;
    case "drop-unsupported":
      return labels.dropUnsupported;
    case "acquisition-failed":
      return labels.acquisitionFailed;
    case "source-open-failed":
      return withFailures(labels.sourceOpenFailed, [notice.failureCode]);
    case "source-refresh-failed":
      return withFailures(labels.sourceRefreshFailed, [notice.failureCode]);
    case "note-refresh-failed":
      return withFailures(labels.noteRefreshFailed, [notice.failureCode]);
    case "annotations-unavailable":
      return withFailures(labels.annotationsUnavailable, [notice.failureCode]);
    case "annotations-partial-failure":
      return withFailures(
        labels.annotationsPartialFailure,
        notice.failureCodes,
      );
  }
}

export function canvasFailureText(
  labels: WhiteboardLabels,
  code: CanvasFailureCode,
): string | null {
  switch (code) {
    case "library-missing":
      return labels.failureLibraryMissing;
    case "item-missing":
      return labels.failureItemMissing;
    case "wrong-kind":
      return labels.failureWrongKind;
    case "parent-mismatch":
      return labels.failureParentMismatch;
    case "attachment-unavailable":
      return labels.failureAttachmentUnavailable;
    case "annotation-unavailable":
      return labels.failureAnnotationUnavailable;
    case "resolution-failed":
      return labels.failureResolutionFailed;
    case "open-failed":
      return labels.failureOpenFailed;
    case "list-failed":
      return labels.failureListFailed;
    default:
      return null;
  }
}

const NOTICE_AUTO_DISMISS_MS = 8000;

export function CanvasNoticeRegion(props: {
  labels: WhiteboardLabels;
  notice: CanvasNotice | null;
  onDismiss: () => void;
  autoDismissMs?: number;
}): ReactElement | null {
  const { labels, notice, onDismiss } = props;
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      onDismiss,
      props.autoDismissMs ?? NOTICE_AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss, props.autoDismissMs]);
  if (!notice) return null;
  return (
    <div
      className="zmd-board-notice"
      data-tone={notice.code === "acquisition-summary" ? "info" : "error"}
    >
      <span role="status" aria-live="polite" aria-atomic="true">
        {canvasNoticeText(labels, notice)}
      </span>
      <button
        type="button"
        aria-label={labels.close}
        onClick={onDismiss}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onDismiss();
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
  flowPosition?: { x: number; y: number };
}

interface EdgeEditingState {
  edgeId: string;
  value: string;
}

interface DrawSession {
  nodeId: string;
  kind: DrawKind;
  origin: { x: number; y: number };
  pointerId: number;
}

interface EmbeddedFileInfo {
  title: string;
  contentType: string;
  size: number;
  fileData: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  pageCount?: number;
}

function embeddedFileInfo(model: CanvasNode): EmbeddedFileInfo | undefined {
  if (model.kind !== "attachment" && model.kind !== "pdf") return undefined;
  const data = model.data as Record<string, unknown>;
  if (typeof data.fileData !== "string") return undefined;
  return {
    title: typeof data.title === "string" ? data.title : "File",
    contentType: typeof data.contentType === "string" ? data.contentType : "",
    size: typeof data.size === "number" ? data.size : 0,
    fileData: data.fileData,
    ...(typeof data.image === "string" ? { image: data.image } : {}),
    ...(typeof data.imageWidth === "number"
      ? { imageWidth: data.imageWidth }
      : {}),
    ...(typeof data.imageHeight === "number"
      ? { imageHeight: data.imageHeight }
      : {}),
    ...(typeof data.pageCount === "number"
      ? { pageCount: data.pageCount }
      : {}),
  };
}

function embeddedImageInfo(model: CanvasNode): EmbeddedFileInfo | undefined {
  if (model.kind !== "attachment" && model.kind !== "pdf") return undefined;
  const data = model.data as Record<string, unknown>;
  const image =
    typeof data.image === "string"
      ? data.image
      : typeof data.fileData === "string" &&
          typeof data.contentType === "string" &&
          data.contentType.startsWith("image/")
        ? data.fileData
        : undefined;
  if (!image) return undefined;
  return {
    title: typeof data.title === "string" ? data.title : "Image",
    contentType:
      typeof data.contentType === "string" ? data.contentType : "image/*",
    size: typeof data.size === "number" ? data.size : 0,
    fileData: typeof data.fileData === "string" ? data.fileData : image,
    image,
    ...(typeof data.imageWidth === "number"
      ? { imageWidth: data.imageWidth }
      : {}),
    ...(typeof data.imageHeight === "number"
      ? { imageHeight: data.imageHeight }
      : {}),
    ...(typeof data.pageCount === "number"
      ? { pageCount: data.pageCount }
      : {}),
  };
}

function dataUrlBlob(value: string): Blob | undefined {
  if (!/^data:[^,]+,/i.test(value)) return undefined;
  const comma = value.indexOf(",");
  const metadata = value.slice(5, comma);
  const body = value.slice(comma + 1);
  const base64 = /;base64$/i.test(metadata);
  try {
    const bytes = base64
      ? Uint8Array.from(atob(body), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body));
    return new Blob([bytes], {
      type: metadata.replace(/;base64$/i, "") || "application/octet-stream",
    });
  } catch {
    return undefined;
  }
}

function nodeSize(node: CanvasFlowNode) {
  return {
    width:
      node.width ??
      (typeof node.style?.width === "number" ? node.style.width : 120),
    height:
      node.height ??
      (typeof node.style?.height === "number" ? node.style.height : 80),
  };
}

function applyDrawFrame(
  node: CanvasFlowNode,
  frame: DrawFrame,
  kind: DrawKind,
): CanvasFlowNode {
  let { position, width, height, start, end } = frame;
  if ((kind === "line" || kind === "arrow") && height < 16) {
    const pad = (16 - height) / 2;
    position = { x: position.x, y: position.y - pad };
    height = 16;
    start = { x: start.x, y: start.y + pad };
    end = { x: end.x, y: end.y + pad };
  }
  width = Math.max(width, 8);
  height = Math.max(height, 8);
  const next = updateFlowNodeModel(node, (model) => {
    if (model.kind !== "line" && model.kind !== "arrow") return model;
    return { ...model, data: { ...model.data, from: start, to: end } };
  });
  return {
    ...next,
    position,
    width,
    height,
    style: { width, height },
  };
}

function createCanvasNode(
  kind: CanvasNodeKind,
  position: { x: number; y: number },
  id: string,
  noteTemplate?: NoteTemplate,
): CanvasNode {
  if (kind === "note") {
    return materializeNoteTemplate(
      noteTemplate ?? BUILTIN_NOTE_TEMPLATES[0]!,
      position,
      id,
    );
  }
  if (kind === "frame") return createAcademicNode("frame", position, id);
  if (kind === "literature" || kind === "quote") {
    throw new Error(`${kind} nodes require a Zotero source and snapshot.`);
  }
  return createBasicNode(kind, position, id);
}

function hasOpenTarget(node: CanvasFlowNode): boolean {
  const model = node.data.model;
  if (embeddedFileInfo(model)) return true;
  if (sourceDescriptor(model)) return true;
  if (!("data" in model)) return false;
  return (
    ("itemID" in model.data && Boolean(model.data.itemID)) ||
    ("attachmentID" in model.data && Boolean(model.data.attachmentID))
  );
}

export function WhiteboardApp(props: WhiteboardAppProps): ReactElement {
  const initial = useMemo(
    () =>
      parseCanvasDocument(props.initialSnapshot ?? demoCanvasDocument())
        .document,
    [props.initialSnapshot],
  );
  const flowRef = useRef<ReactFlowInstance<
    CanvasFlowNode,
    CanvasFlowEdge
  > | null>(null);
  const fitInitialView =
    !props.initialSnapshot || hasDefaultTutorialViewport(initial);
  const fitPendingViewRef = useRef(false);
  const fitPendingView = useCallback(() => {
    if (!fitPendingViewRef.current || !flowRef.current) return;
    fitPendingViewRef.current = false;
    void flowRef.current.fitView({ padding: 0.15, maxZoom: 1 });
  }, []);
  const resizingRef = useRef(false);
  const exportBusyRef = useRef(false);
  const [exportStatus, setExportStatus] = useState<"busy" | "error" | null>(
    null,
  );
  const sourceGenerationRef = useRef(1);
  const sourceGenerationAnnouncedRef = useRef(0);
  const sourcePrioritiesRef = useRef(
    new Map<string, SourceResolutionPriority>(),
  );
  const sourceStatesRef = useRef(createSourceResolutionStates(initial.nodes));
  const [, renderSourceState] = useState(0);
  const cancelIdleResolutionRef = useRef<(() => void) | null>(null);
  const [sourceCycle, setSourceCycle] = useState(1);
  useEffect(fitPendingView, [sourceCycle, fitPendingView]);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [canvasNotice, setCanvasNotice] = useState<CanvasNotice | null>(null);
  const clearCanvasNotice = useCallback(() => setCanvasNotice(null), []);
  const showCanvasNotice = useCallback(
    (notice: CanvasNotice) => setCanvasNotice(notice),
    [],
  );
  const clearMatchingNotice = useCallback(
    (matches: (notice: CanvasNotice) => boolean) => {
      setCanvasNotice((current) => {
        if (!current || !matches(current)) return current;
        return null;
      });
    },
    [],
  );
  const openSourceRequestsRef = useRef(createSourceActionCorrelation());
  const academicAcquisitionRef = useRef<AcademicAcquisitionRuntime | null>(
    null,
  );
  const noteRefreshRuntimeRef = useRef<NoteRefreshRuntime | null>(null);
  const sourceRefreshRuntimeRef = useRef<SourceRefreshRuntime | null>(null);
  const documentRuntime = useCanvasDocumentRuntime(
    initial,
    (revision) => propsRef.current.onChange(revision),
    (viewport) => flowRef.current?.setViewport(viewport),
    (document) =>
      omitAcademicPlaceholders(
        document,
        academicAcquisitionRef.current?.pendingNodeIds() ?? [],
      ),
  );
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    nodesRef,
    edgesRef,
    viewportRef,
    shellRef,
    history: documentHistory,
    changed: bump,
    pushHistory,
    applyDocument,
    loadSnapshot: loadDocumentSnapshot,
    applySourceResolutionBatch: applyDocumentSourceResolutionBatch,
    applyLiteratureAnnotationCount,
    getRawSnapshot: workingSnapshot,
    getSnapshot: snapshotNow,
    undo,
    redo,
  } = documentRuntime;
  if (!academicAcquisitionRef.current) {
    academicAcquisitionRef.current = createAcademicAcquisitionRuntime({
      getNodes: () => nodesRef.current,
      setNodes,
      getEdges: () => edgesRef.current,
      setEdges,
      pushHistory,
      changed: bump,
      onNotice: showCanvasNotice,
      createNodeId: () => newId("academic"),
      onPickAcademicSource: (requestId, nodeId, kind) =>
        propsRef.current.onPickAcademicSource(requestId, nodeId, kind),
      onDropAcademicSources: (requestId, nodeId, sources) =>
        propsRef.current.onDropAcademicSources(requestId, nodeId, sources),
    });
  }
  const academicAcquisition = academicAcquisitionRef.current;
  const [theme, setTheme] = useState<WhiteboardTheme>(props.theme);
  const [labels, setLabels] = useState<WhiteboardLabels>(
    props.labels ?? DEFAULT_LABELS,
  );
  const [customTemplates, setCustomTemplates] = useState<NoteTemplate[]>(() =>
    parseNoteTemplateRegistry(props.templates ?? []),
  );
  const noteTemplates = useMemo(
    () => [
      ...createBuiltinNoteTemplates({
        note: labels.addNote,
        question: labels.addQuestion,
        claim: labels.addClaim,
        evidence: labels.addEvidence,
        summary: labels.addSummary,
      }),
      ...customTemplates,
    ],
    [
      customTemplates,
      labels.addClaim,
      labels.addNote,
      labels.addQuestion,
      labels.addEvidence,
      labels.addSummary,
    ],
  );
  if (!noteRefreshRuntimeRef.current) {
    noteRefreshRuntimeRef.current = createNoteRefreshRuntime({
      getWorkingDocument: workingSnapshot,
      getHistoryDocument: snapshotNow,
      applyDocument,
      commitHistory: (document) => documentHistory.commit(document),
      confirm: (warning) => window.confirm(warning),
      request: (requestId, nodeId, source) =>
        propsRef.current.onRefreshZoteroNote(requestId, nodeId, source),
      onError: (_message, nodeId) =>
        showCanvasNotice({
          code: "note-refresh-failed",
          nodeId,
          failureCode: "note-refresh-failed",
        }),
      createRequestId: () => newId("note-refresh"),
    });
  }
  const noteRefreshRuntime = noteRefreshRuntimeRef.current;
  if (!sourceRefreshRuntimeRef.current) {
    sourceRefreshRuntimeRef.current = createSourceRefreshRuntime({
      getNodes: () => nodesRef.current,
      applyResolutionBatch: applyDocumentSourceResolutionBatch,
      changed: bump,
    });
  }
  const sourceRefreshRuntime = sourceRefreshRuntimeRef.current;
  const [selectedTool, setActiveTool] = useState<CanvasTool>("select");
  const spacePressed = useKeyPress("Space", {
    actInsideInputWithModifier: false,
  });
  const [activeNoteTemplateId, setActiveNoteTemplateId] = useState<string>(
    BUILTIN_NOTE_TEMPLATE_IDS.note,
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [editing, setEditing] = useState<{
    nodeId: string;
    value: string;
  } | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const editingRevisionRef = useRef(0);
  const [edgeEditorHeight, setEdgeEditorHeight] = useState(32);
  const [editingEdge, setEditingEdge] = useState<EdgeEditingState | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [imageViewer, setImageViewer] = useState<EmbeddedFileInfo | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(-1);
  const searchResults = useMemo(
    () =>
      searchCanvas(
        flowToCanvasDocument(nodes, edges, viewportRef.current),
        searchQuery,
      ),
    [nodes, edges, searchQuery],
  );
  const focusSearchResult = (index: number) => {
    const id = searchResults[index];
    if (!id) return;
    setSearchIndex(index);
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: node.id === id })),
    );
    void flowRef.current?.fitView({
      nodes: [{ id }],
      padding: 0.3,
      maxZoom: 1.2,
      duration: 200,
    });
  };
  const [detailsTarget, setDetailsTarget] = useState<string | null>(null);
  const [annotationBrowser, setAnnotationBrowser] =
    useState<AnnotationBrowserSession | null>(null);
  // Space temporarily owns all pointer gestures, including those over cards.
  const activeTool =
    spacePressed && !editing && !annotationBrowser ? "hand" : selectedTool;
  const eraser = activeTool === "eraser";
  const annotationBrowserRef = useRef<AnnotationBrowserSession | null>(null);
  annotationBrowserRef.current = annotationBrowser;
  const annotationBrowserOriginNodeIdRef = useRef<string | null>(null);
  const viewAnnotationsRef = useRef<HTMLButtonElement | null>(null);
  const detailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filePickerModeRef = useRef<"attachment" | "markdown">("attachment");
  const filePickerPositionRef = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const mountedRef = useRef(true);
  const importGenerationRef = useRef(0);
  const holdEditFocusRef = useRef(false);

  const runtimeRef = useRef<WhiteboardRuntime | null>(null);
  const drawRef = useRef<DrawSession | null>(null);
  const preDrawRef = useRef<{
    working: CanvasDocument;
    history: CanvasDocument;
  } | null>(null);
  const frameDragRef = useRef<FrameDragState | null>(null);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  useEffect(
    () => () => {
      mountedRef.current = false;
      importGenerationRef.current += 1;
    },
    [],
  );

  const cancelIdleResolution = useCallback(() => {
    cancelIdleResolutionRef.current?.();
    cancelIdleResolutionRef.current = null;
  }, []);

  const requestSources = useCallback(
    (
      priority: SourceResolutionPriority,
      sources: readonly SourceResolutionRequest[],
      generation = sourceGenerationRef.current,
    ) => {
      if (generation !== sourceGenerationRef.current) return;
      const requested = sources.filter(({ nodeId, refresh }) => {
        const previous = sourcePrioritiesRef.current.get(nodeId);
        if (
          !refresh &&
          previous &&
          SOURCE_PRIORITY_ORDER[previous] <= SOURCE_PRIORITY_ORDER[priority]
        ) {
          return false;
        }
        sourcePrioritiesRef.current.set(nodeId, priority);
        return true;
      });
      const generationWasAnnounced =
        sourceGenerationAnnouncedRef.current === generation;
      if (!requested.length && generationWasAnnounced) return;
      sourceStatesRef.current = updateSourceResolutionStates(
        sourceStatesRef.current,
        requested.map(({ nodeId }) => ({ nodeId, status: "loading" })),
      );
      if (requested.length) renderSourceState((revision) => revision + 1);
      sourceGenerationAnnouncedRef.current = generation;
      propsRef.current.onResolveAcademicSources?.(
        newId("source-resolution"),
        generation,
        priority,
        requested,
      );
    },
    [],
  );

  const currentSourceRequests = useCallback(
    () =>
      prioritizedSourceRequests(nodesRef.current, viewportRef.current, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    [nodesRef, viewportRef],
  );

  const scheduleSourceResolution = useCallback(() => {
    cancelIdleResolution();
    const generation = sourceGenerationRef.current;
    const requests = currentSourceRequests();
    requestSources("selected", requests.selected, generation);
    requestSources("visible", requests.visible, generation);

    const runIdle = () => {
      cancelIdleResolutionRef.current = null;
      if (generation !== sourceGenerationRef.current) return;
      requestSources("idle", currentSourceRequests().idle, generation);
    };
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(runIdle);
      cancelIdleResolutionRef.current = () => window.cancelIdleCallback(idleId);
    } else {
      const timeoutId = window.setTimeout(runIdle, 0);
      cancelIdleResolutionRef.current = () => window.clearTimeout(timeoutId);
    }
  }, [cancelIdleResolution, currentSourceRequests, requestSources]);

  const requestVisibleSources = useCallback(() => {
    const requests = currentSourceRequests();
    requestSources("selected", requests.selected);
    requestSources("visible", requests.visible);
  }, [currentSourceRequests, requestSources]);

  const loadSnapshot = useCallback(
    (value: CanvasDocument) => {
      importGenerationRef.current += 1;
      cancelIdleResolution();
      annotationBrowserRef.current = replaceDocumentAnnotationBrowserSession(
        annotationBrowserRef.current,
      );
      setAnnotationBrowser(annotationBrowserRef.current);
      noteRefreshRuntimeRef.current?.clear();
      sourceRefreshRuntimeRef.current?.clear();
      academicAcquisitionRef.current?.clear();
      openSourceRequestsRef.current.clear();
      clearCanvasNotice();
      annotationBrowserOriginNodeIdRef.current = null;
      sourceGenerationRef.current += 1;
      sourcePrioritiesRef.current.clear();
      sourceStatesRef.current = createSourceResolutionStates(value.nodes);
      fitPendingViewRef.current = hasDefaultTutorialViewport(value);
      loadDocumentSnapshot(value);
      setSourceCycle(sourceGenerationRef.current);
    },
    [cancelIdleResolution, clearCanvasNotice, loadDocumentSnapshot],
  );

  const applySourceResolutionBatch = useCallback(
    (generation: number, results: SourceResolutionResult[]) => {
      if (generation !== sourceGenerationRef.current) return;
      const current = results.filter(
        (result) => result.generation === generation,
      );
      if (!current.length) return;
      sourceStatesRef.current = updateSourceResolutionStates(
        sourceStatesRef.current,
        current.map((result) =>
          result.status === "resolved"
            ? { nodeId: result.nodeId, status: "resolved" as const }
            : {
                nodeId: result.nodeId,
                status: "unavailable" as const,
                message: result.message,
              },
        ),
      );
      renderSourceState((revision) => revision + 1);
      const explicitResults = sourceRefreshRuntime.apply(generation, current);
      for (const result of explicitResults) {
        if (result.status !== "resolved") continue;
        clearMatchingNotice(
          (notice) =>
            notice.code === "source-refresh-failed" &&
            notice.nodeId === result.nodeId,
        );
      }
      const failedRefresh = explicitResults.find(
        (result) => result.status === "unavailable",
      );
      if (failedRefresh?.status === "unavailable") {
        showCanvasNotice({
          code: "source-refresh-failed",
          nodeId: failedRefresh.nodeId,
          failureCode: failedRefresh.code,
        });
      }
    },
    [clearMatchingNotice, showCanvasNotice, sourceRefreshRuntime],
  );

  const refreshNoteSource = useCallback(
    (node: CanvasFlowNode) => {
      noteRefreshRuntime.request(node, labels);
    },
    [labels, noteRefreshRuntime],
  );

  const refreshAcademicSource = useCallback(
    (node: CanvasFlowNode) => {
      const request = sourceRefreshRuntime.request(node);
      if (!request) return;
      requestSources("selected", [{ ...request, refresh: true }]);
    },
    [requestSources, sourceRefreshRuntime],
  );

  const refreshNodeSource = useCallback(
    (node: CanvasFlowNode) => {
      if (node.data.model.kind === "note") refreshNoteSource(node);
      else refreshAcademicSource(node);
    },
    [refreshAcademicSource, refreshNoteSource],
  );

  const applyNoteRefresh = useCallback(
    (
      requestId: string,
      nodeId: string,
      acquisition: Extract<AcademicAcquisition, { kind: "note" }>,
    ) => {
      if (noteRefreshRuntime.resolve(requestId, nodeId, acquisition)) {
        clearMatchingNotice(
          (notice) =>
            notice.code === "note-refresh-failed" && notice.nodeId === nodeId,
        );
        sourceStatesRef.current = updateSourceResolutionStates(
          sourceStatesRef.current,
          [{ nodeId, status: "resolved" }],
        );
        renderSourceState((revision) => revision + 1);
      }
    },
    [clearMatchingNotice, noteRefreshRuntime],
  );

  const openAnnotationBrowser = useCallback((node: CanvasFlowNode) => {
    const model = node.data.model;
    if (model.kind !== "literature" || annotationBrowserRef.current) return;
    const requestId = newId("annotations");
    const session = openAnnotationBrowserSession(requestId, model.source);
    annotationBrowserOriginNodeIdRef.current = node.id;
    annotationBrowserRef.current = session;
    setAnnotationBrowser(session);
    propsRef.current.onListLiteratureAnnotations?.(requestId, model.source);
  }, []);

  const applyAnnotationCandidates = useCallback(
    (
      requestId: string,
      source: LiteratureSource,
      candidates: AnnotationCandidate[],
      failures: AnnotationListFailure[],
    ) => {
      const current = annotationBrowserRef.current;
      const next = acceptAnnotationListResult(current, requestId, source, {
        candidates,
        failures,
      });
      if (next === current) return;
      const originNodeId = annotationBrowserOriginNodeIdRef.current;
      if (originNodeId) {
        applyLiteratureAnnotationCount(originNodeId, source, candidates.length);
      }
      annotationBrowserRef.current = next;
      setAnnotationBrowser(next);
      if (failures.length) {
        showCanvasNotice({
          code: "annotations-partial-failure",
          requestId,
          failureCodes: failures.map((failure) => failure.code),
        });
      } else {
        clearMatchingNotice(
          (notice) =>
            notice.code === "annotations-unavailable" ||
            notice.code === "annotations-partial-failure",
        );
      }
    },
    [applyLiteratureAnnotationCount, clearMatchingNotice, showCanvasNotice],
  );

  const rejectAnnotationList = useCallback(
    (
      requestId: string,
      source: LiteratureSource,
      failure: AnnotationListFailure,
    ) => {
      const current = annotationBrowserRef.current;
      const next = acceptAnnotationListFailure(
        current,
        requestId,
        source,
        failure,
      );
      if (next === current) return;
      annotationBrowserRef.current = next;
      setAnnotationBrowser(next);
      showCanvasNotice({
        code: "annotations-unavailable",
        requestId,
        failureCode: failure.code,
      });
    },
    [showCanvasNotice],
  );

  const closeAnnotationBrowser = useCallback(() => {
    annotationBrowserRef.current = closeAnnotationBrowserSession(
      annotationBrowserRef.current,
    );
    setAnnotationBrowser(annotationBrowserRef.current);
    annotationBrowserOriginNodeIdRef.current = null;
  }, []);

  const addSelectedAnnotations = useCallback(() => {
    const session = annotationBrowserRef.current;
    const literatureNodeId = annotationBrowserOriginNodeIdRef.current;
    if (!session || !literatureNodeId || session.state.status !== "ready") {
      closeAnnotationBrowser();
      return;
    }
    const addedNodeIds = createQuoteBatchRuntime({
      getWorkingDocument: workingSnapshot,
      getHistoryDocument: snapshotNow,
      applyDocument,
      commitHistory: (document) => documentHistory.commit(document),
      createNodeId: () => newId("quote"),
    }).add(literatureNodeId, session.state.candidates, session.selectedKeys);
    if (addedNodeIds.length) {
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          selected: node.id === literatureNodeId,
        })),
      );
      sourceStatesRef.current = updateSourceResolutionStates(
        sourceStatesRef.current,
        addedNodeIds.map((nodeId) => ({ nodeId, status: "idle" })),
      );
      renderSourceState((revision) => revision + 1);
      setSourceCycle((cycle) => cycle + 1);
    }
    closeAnnotationBrowser();
  }, [
    applyDocument,
    closeAnnotationBrowser,
    documentHistory,
    setNodes,
    snapshotNow,
    workingSnapshot,
  ]);

  const focusExistingAnnotation = useCallback(
    (annotationIdentity: string) => {
      const existing = nodesRef.current.find(
        (node) =>
          node.data.model.kind === "quote" &&
          quoteSourceIdentity(node.data.model.source) === annotationIdentity,
      );
      if (!existing) return;
      closeAnnotationBrowser();
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          selected: node.id === existing.id,
        })),
      );
      void flowRef.current?.fitView({
        nodes: [{ id: existing.id }],
        padding: 0.4,
        duration: 200,
      });
      window.requestAnimationFrame(() => {
        const canvasHost = canvasHostRef.current;
        const existingElement = Array.from(
          canvasHost?.querySelectorAll<HTMLElement>(".react-flow__node") ?? [],
        ).find((element) => element.dataset.id === existing.id);
        (existingElement ?? canvasHost)?.focus();
      });
    },
    [closeAnnotationBrowser, nodesRef, setNodes],
  );

  const applyNodePositions = useCallback(
    (positioned: readonly CanvasFlowNode[]) => {
      const document = moveNodesInDocument(
        workingSnapshot(),
        positioned.map((node) => ({ id: node.id, position: node.position })),
      );
      const models = new Map(document.nodes.map((node) => [node.id, node]));
      setNodes((current) =>
        current.map((node) => {
          const model = models.get(node.id);
          return model
            ? {
                ...node,
                position: model.position,
                data: { ...node.data, model },
              }
            : node;
        }),
      );
    },
    [setNodes, workingSnapshot],
  );

  const deleteCanvasElements = useCallback(
    (nodeIds: string[], edgeIds: string[] = []) => {
      const nodeIdSet = new Set(nodeIds);
      const edgeIdSet = new Set(edgeIds);
      if (!nodeIdSet.size && !edgeIdSet.size) return;

      let document = workingSnapshot();
      const existingNodeIds = new Set(document.nodes.map((node) => node.id));
      const existingEdgeIds = new Set(
        document.connections.map((connection) => connection.id),
      );
      if (
        !nodeIds.some((id) => existingNodeIds.has(id)) &&
        !edgeIds.some((id) => existingEdgeIds.has(id))
      ) {
        return;
      }

      const settledDrag = settleFrameDragState(
        frameDragRef.current ?? undefined,
      );
      frameDragRef.current = settledDrag.state ?? null;
      pushHistory();
      for (const nodeId of nodeIdSet) {
        document = deleteNodeFromDocument(document, nodeId);
      }
      if (edgeIdSet.size) {
        document = {
          ...document,
          connections: document.connections.filter(
            (connection) => !edgeIdSet.has(connection.id),
          ),
        };
      }
      applyDocument(document);
      bump();
    },
    [applyDocument, bump, pushHistory, workingSnapshot],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const removedNodeIds = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id);
      if (removedNodeIds.length) {
        deleteCanvasElements(removedNodeIds);
      }

      let retainedChanges = changes.filter(
        (change) => change.type !== "remove",
      );
      if (!retainedChanges.length) return;
      if (retainedChanges.some((change) => change.type === "add")) {
        pushHistory();
      }

      const resizeChanges = retainedChanges.filter(
        (change) => change.type === "dimensions",
      );
      if (
        resizeChanges.some((change) => change.resizing === true) &&
        !resizingRef.current
      ) {
        pushHistory();
        resizingRef.current = true;
      }
      if (resizeChanges.some((change) => change.resizing === false))
        resizingRef.current = false;

      const drag = frameDragRef.current;
      if (drag?.phase === "ending") {
        retainedChanges = retainedChanges.filter(
          (change) => change.type !== "position",
        );
        if (!retainedChanges.length) return;
      }
      const positionUpdates = retainedChanges.flatMap((change) =>
        change.type === "position" && change.position
          ? [{ id: change.id, position: change.position }]
          : [],
      );

      if (drag && positionUpdates.length) {
        setNodes((current) => {
          const currentDocument = flowToCanvasDocument(
            current,
            edgesRef.current,
            viewportRef.current,
            shellRef.current,
          );
          const moved = updateFrameDragState(
            currentDocument,
            drag,
            positionUpdates,
          );
          frameDragRef.current = moved.state;
          const movedById = new Map(
            moved.document.nodes.map((node) => [node.id, node]),
          );
          const movedNodes = current.map((node) => {
            const model = movedById.get(node.id);
            return model
              ? {
                  ...node,
                  position: model.position,
                  data: { ...node.data, model },
                }
              : node;
          });
          return applyCanvasNodeChanges(retainedChanges, movedNodes);
        });
      } else {
        setNodes((current) => applyCanvasNodeChanges(retainedChanges, current));
      }

      if (!drag && retainedChanges.some((change) => change.type !== "select")) {
        bump();
      }
    },
    [bump, deleteCanvasElements, edgesRef, pushHistory, shellRef, viewportRef],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasFlowEdge>[]) => {
      const removedEdgeIds = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id);
      if (removedEdgeIds.length) {
        deleteCanvasElements([], removedEdgeIds);
      }
      const retainedChanges = changes.filter(
        (change) => change.type !== "remove",
      );
      if (!retainedChanges.length) return;
      setEdges((current) => applyEdgeChanges(retainedChanges, current));
      if (retainedChanges.some((change) => change.type !== "select")) bump();
    },
    [bump, deleteCanvasElements],
  );

  const beginNodeDrag = useCallback<OnNodeDrag<CanvasFlowNode>>(
    (_event, _node, draggedNodes) => {
      pushHistory();
      frameDragRef.current =
        beginFrameDragState(
          workingSnapshot(),
          draggedNodes.map((dragged) => dragged.id),
        ) ?? null;
    },
    [pushHistory, workingSnapshot],
  );

  const endFrameDrag = useCallback(() => {
    const settled = settleFrameDragState(frameDragRef.current ?? undefined);
    frameDragRef.current = settled.state ?? null;
    if (settled.notify) bump();
  }, [bump]);

  const finishNodeDrag = useCallback<OnNodeDrag<CanvasFlowNode>>(() => {
    const stopped = finishFrameDragState(frameDragRef.current ?? undefined);
    frameDragRef.current = stopped.state ?? null;
    if (stopped.notify) bump();
  }, [bump]);

  const onConnect = useCallback(
    (connection: Connection) => {
      pushHistory();
      const id = newId("edge");
      const color = "#9ca3af";
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id,
            data: {
              connection: {
                id,
                kind: "basic",
                source: connection.source,
                target: connection.target,
                sourceHandle: connection.sourceHandle,
                targetHandle: connection.targetHandle,
                color,
                arrow: true,
              },
            },
            style: { stroke: color },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color,
            },
          },
          current,
        ),
      );
      bump();
    },
    [bump, pushHistory],
  );

  const onReconnect = useCallback(
    (edge: CanvasFlowEdge, connection: Connection) => {
      if (
        edge.source === connection.source &&
        edge.target === connection.target &&
        edge.sourceHandle === connection.sourceHandle &&
        edge.targetHandle === connection.targetHandle
      )
        return;
      const rawEdge = edgesRef.current.find(
        (candidate) => candidate.id === edge.id,
      );
      pushHistory();
      setEdges((current) =>
        reconnectEdge(rawEdge ?? edge, connection, current, {
          shouldReplaceId: false,
        }),
      );
      bump();
    },
    [bump, edgesRef, pushHistory],
  );

  const addNode = useCallback(
    (kind: CanvasNodeKind, position?: { x: number; y: number }) => {
      const center = position ??
        flowRef.current?.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }) ?? { x: 120, y: 120 };
      const nodeId = newId(kind);
      setActiveTool("select");
      if (kind === "literature") {
        const requestId = `pick-${nodeId}-${Date.now().toString(36)}`;
        academicAcquisition.placeLiterature(requestId, nodeId, center);
        return;
      }
      pushHistory();
      const created = canvasDocumentToFlow({
        version: 2,
        nodes: [
          createCanvasNode(
            kind,
            center,
            nodeId,
            kind === "note"
              ? noteTemplates.find(
                  (template) => template.id === activeNoteTemplateId,
                )
              : undefined,
          ),
        ],
        connections: [],
      }).nodes[0];
      const editOnCreate = isStampTool(kind) && shouldEditOnCreate(kind);
      setNodes((current) => {
        const next = [...current, created];
        return editOnCreate
          ? (beginNodeEditing(next, nodeId)?.nodes ?? next)
          : next;
      });
      bump();
      if (editOnCreate) {
        setDetailsTarget(null);
        setEditingEdge(null);
        editingRevisionRef.current += 1;
        setEditing({ nodeId, value: flowNodeText(created) });
      }
    },
    [
      academicAcquisition,
      activeNoteTemplateId,
      bump,
      noteTemplates,
      pushHistory,
    ],
  );

  const openContextMenu = useCallback(
    (
      event: { clientX: number; clientY: number },
      nodeId: string,
      flowPosition?: { x: number; y: number },
    ) => {
      const width = 220;
      const height = 340;
      setMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
        y: Math.max(
          8,
          Math.min(event.clientY, window.innerHeight - height - 8),
        ),
        nodeId,
        ...(flowPosition ? { flowPosition } : {}),
      });
    },
    [],
  );

  const flowPoint = useCallback((clientX: number, clientY: number) => {
    return (
      flowRef.current?.screenToFlowPosition({ x: clientX, y: clientY }) ?? {
        x: clientX,
        y: clientY,
      }
    );
  }, []);

  const reportFileFailures = useCallback(
    (
      failures: Awaited<ReturnType<typeof importWhiteboardFiles>>["failures"],
    ) => {
      if (!failures.length) return;
      setFileNotice(
        failures
          .map((failure) =>
            fileImportFailureMessage(failure, {
              fileTooLarge: fileLabel(
                labels,
                "fileTooLarge",
                "Files must be 15 MB or smaller, up to 30 MB per batch.",
              ),
              fileImportFailed: fileLabel(
                labels,
                "fileImportFailed",
                "The file could not be imported.",
              ),
            }),
          )
          .join(" "),
      );
    },
    [labels],
  );

  const addImportedFiles = useCallback(
    async (input: Iterable<File>, origin?: { x: number; y: number }) => {
      const generation = importGenerationRef.current;
      const result = await importWhiteboardFiles(input);
      if (!mountedRef.current || generation !== importGenerationRef.current)
        return;
      reportFileFailures(result.failures);
      if (!result.files.length) return;
      const point =
        origin ?? flowPoint(window.innerWidth / 2, window.innerHeight / 2);
      const imported = result.files.map((file, index) => {
        const model = createBasicNode(
          "attachment",
          {
            x: point.x + (index % 3) * 280,
            y: point.y + Math.floor(index / 3) * 260,
          },
          newId("attachment"),
        );
        model.data = {
          ...model.data,
          title: file.title,
          subtitle: file.contentType,
          contentType: file.contentType,
          size: file.size,
          fileData: file.fileData,
          ...(file.preview !== undefined ? { preview: file.preview } : {}),
          ...(file.image !== undefined ? { image: file.image } : {}),
          ...(file.imageWidth !== undefined
            ? { imageWidth: file.imageWidth }
            : {}),
          ...(file.imageHeight !== undefined
            ? { imageHeight: file.imageHeight }
            : {}),
        } as typeof model.data;
        if (file.image || file.contentType.startsWith("image/")) {
          model.height = 220;
        } else if (file.preview) {
          model.height = 180;
        }
        return canvasDocumentToFlow({
          version: 2,
          nodes: [model],
          connections: [],
        }).nodes[0];
      });
      pushHistory();
      setNodes((current) => [
        ...current.map((node) => ({ ...node, selected: false })),
        ...imported.map((node) => ({ ...node, selected: true })),
      ]);
      bump();
    },
    [bump, flowPoint, pushHistory, reportFileFailures, setNodes],
  );

  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const insertImportedImages = useCallback(
    (
      images: readonly ImportedWhiteboardFile[],
      nodeId: string,
      selection?: { start: number; end: number },
      expected?: { revision: number; value: string },
    ) => {
      if (!images.length) return;
      const current = editingRef.current;
      if (!current || current.nodeId !== nodeId) return;
      if (
        expected &&
        !isEditingImportSessionCurrent(
          { ...current, revision: editingRevisionRef.current },
          { nodeId, value: expected.value, revision: expected.revision },
        )
      )
        return;
      const textarea = editingTextareaRef.current;
      const start = Math.min(
        selection?.start ?? textarea?.selectionStart ?? current.value.length,
        current.value.length,
      );
      const end = Math.min(
        selection?.end ?? textarea?.selectionEnd ?? start,
        current.value.length,
      );
      const markdown = images
        .filter((file) => file.image || file.contentType.startsWith("image/"))
        .map(
          (file) =>
            `![${file.title.replace(/[\\\]\r\n]/g, "\\$&")}](${file.fileData})`,
        )
        .join("\n");
      if (!markdown) return;
      const value = `${current.value.slice(0, start)}${markdown}${current.value.slice(end)}`;
      editingRevisionRef.current += 1;
      setEditing({ nodeId, value });
      window.requestAnimationFrame(() => {
        if (!editingTextareaRef.current) return;
        const caret = start + markdown.length;
        editingTextareaRef.current.setSelectionRange(caret, caret);
      });
    },
    [],
  );

  const addImagesToEditing = useCallback(
    async (input: Iterable<File>, nodeId: string) => {
      const generation = importGenerationRef.current;
      const session = editingRef.current;
      if (!session || session.nodeId !== nodeId) return;
      const revision = editingRevisionRef.current;
      const selection = {
        start:
          editingTextareaRef.current?.selectionStart ??
          editingRef.current?.value.length ??
          0,
        end:
          editingTextareaRef.current?.selectionEnd ??
          editingTextareaRef.current?.value.length ??
          0,
      };
      const result = await importWhiteboardFiles(input);
      if (!mountedRef.current || generation !== importGenerationRef.current)
        return;
      reportFileFailures(result.failures);
      insertImportedImages(result.files, nodeId, selection, {
        revision,
        value: session.value,
      });
    },
    [insertImportedImages, reportFileFailures],
  );

  const openFilePicker = useCallback(
    (mode: "attachment" | "markdown", position?: { x: number; y: number }) => {
      filePickerModeRef.current = mode;
      filePickerPositionRef.current = position;
      const input = fileInputRef.current;
      if (!input) return;
      input.value = "";
      input.click();
    },
    [],
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files;
      if (!files?.length) return;
      const input = Array.from(files);
      const activeEditing = editingRef.current;
      if (filePickerModeRef.current === "markdown" && activeEditing) {
        void addImagesToEditing(input, activeEditing.nodeId);
      } else {
        void addImportedFiles(input, filePickerPositionRef.current);
      }
      filePickerPositionRef.current = undefined;
      event.currentTarget.value = "";
    },
    [addImagesToEditing, addImportedFiles],
  );

  const openEmbeddedFile = useCallback(
    (node: CanvasFlowNode) => {
      const file = embeddedFileInfo(node.data.model);
      if (!file) {
        setFileNotice(
          fileLabel(labels, "fileUnavailable", "The file is unavailable."),
        );
        return;
      }
      const handler = propsRef.current.onOpenFile;
      if (handler) {
        handler({ nodeId: node.id });
        return;
      }
      if (!/^data:[^,]+,/i.test(file.fileData)) {
        setFileNotice(
          fileLabel(labels, "fileUnavailable", "The file is unavailable."),
        );
        return;
      }
      const blob = dataUrlBlob(file.fileData);
      if (!blob) {
        setFileNotice(
          fileLabel(labels, "fileUnavailable", "The file is unavailable."),
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.title;
      anchor.rel = "noopener";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [labels],
  );

  const isNativeFileTransfer = useCallback(canAcceptNativeFileTransfer, []);

  const onCanvasDragOver = useCallback(
    (event: DragEvent) => {
      if (!isNativeFileTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [isNativeFileTransfer],
  );

  const onCanvasDrop = useCallback(
    (event: DragEvent) => {
      if (!isNativeFileTransfer(event.dataTransfer)) return;
      event.preventDefault();
      void addImportedFiles(
        Array.from(event.dataTransfer.files),
        flowPoint(event.clientX, event.clientY),
      );
    },
    [addImportedFiles, flowPoint, isNativeFileTransfer],
  );

  const cancelDraw = useCallback(() => {
    const session = drawRef.current;
    if (!session) return;
    drawRef.current = null;
    const previous = preDrawRef.current;
    preDrawRef.current = null;
    if (previous) applyDocument(previous.working);
    else {
      setNodes((current) =>
        current.filter((node) => node.id !== session.nodeId),
      );
    }
  }, [applyDocument]);

  const updateDraw = useCallback(
    (clientX: number, clientY: number, shift: boolean) => {
      const session = drawRef.current;
      if (!session) return;
      const current = flowPoint(clientX, clientY);
      const frame = frameFromDrag(session.origin, current, {
        kind: session.kind,
        shift,
      });
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === session.nodeId
            ? applyDrawFrame(node, frame, session.kind)
            : node,
        ),
      );
    },
    [flowPoint],
  );

  const finishDraw = useCallback(() => {
    const session = drawRef.current;
    if (!session) return;
    drawRef.current = null;
    const previous = preDrawRef.current;
    preDrawRef.current = null;
    if (previous) {
      documentHistory.push(previous.history);
    }
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        selected: node.id === session.nodeId,
      })),
    );
    setActiveTool(toolAfterDraw(session.kind));
    bump();
  }, [bump, documentHistory]);

  const beginDraw = useCallback(
    (
      event: {
        clientX: number;
        clientY: number;
        pointerId: number;
        shiftKey: boolean;
      },
      kind: DrawKind,
    ) => {
      const origin = flowPoint(event.clientX, event.clientY);
      const nodeId = newId(kind);
      const frame = frameFromDrag(origin, origin, {
        kind,
        shift: event.shiftKey,
      });
      preDrawRef.current = {
        working: workingSnapshot(),
        history: snapshotNow(),
      };
      const model = createBasicNode(drawNodeKind(kind), origin, nodeId);
      model.style = { ...model.style, ...drawNodeStyle(kind) };
      if (model.kind === "rect" || model.kind === "ellipse") {
        // New shapes inherit the active theme until a color is chosen.
        delete model.style.fill;
        delete model.style.stroke;
      }
      const created = applyDrawFrame(
        canvasDocumentToFlow({
          version: 2,
          nodes: [model],
          connections: [],
        }).nodes[0],
        frame,
        kind,
      );
      drawRef.current = {
        nodeId,
        kind,
        origin,
        pointerId: event.pointerId,
      };
      setNodes((current) => [...current, created]);
    },
    [flowPoint, snapshotNow, workingSnapshot],
  );

  const eraseNode = useCallback(
    (id: string) => {
      deleteCanvasElements([id]);
    },
    [deleteCanvasElements],
  );

  const eraseEdge = useCallback(
    (id: string) => {
      deleteCanvasElements([], [id]);
    },
    [deleteCanvasElements],
  );

  const updateNode = useCallback(
    (nodeId: string, updater: (node: CanvasFlowNode) => CanvasFlowNode) => {
      pushHistory();
      setNodes((current) =>
        current.map((node) => (node.id === nodeId ? updater(node) : node)),
      );
      bump();
    },
    [bump, pushHistory],
  );

  const startEdit = useCallback((nodeId: string) => {
    const transition = beginNodeEditing(nodesRef.current, nodeId);
    if (!transition) return;
    setMenu(null);
    setDetailsTarget(null);
    setEditingEdge(null);
    setActiveTool("select");
    setNodes(transition.nodes);
    editingRevisionRef.current += 1;
    setEditing(transition.editing);
  }, []);

  const startEdgeEdit = useCallback(
    (edgeId: string) => {
      const edge = edgesRef.current.find(
        (candidate) => candidate.id === edgeId,
      );
      if (!edge) return;
      const connection = edge.data?.connection;
      editingRevisionRef.current += 1;
      setEditing(null);
      setDetailsTarget(null);
      setMenu(null);
      setActiveTool("select");
      setEditingEdge({
        edgeId,
        value: connection
          ? (connectionDisplayLabel(
              connection,
              labels,
              typeof edge.label === "string" ? edge.label : undefined,
            ) ?? "")
          : typeof edge.label === "string"
            ? edge.label
            : "",
      });
    },
    [edgesRef, labels],
  );

  const openNode = useCallback(
    (node: CanvasFlowNode) => {
      const model = node.data.model;
      const embeddedImage = embeddedImageInfo(model);
      if (model.kind === "pdf" && embeddedImage) {
        setImageViewer(embeddedImage);
        return;
      }
      if (embeddedFileInfo(model)) {
        openEmbeddedFile(node);
        return;
      }
      const academicSource = sourceDescriptor(model);
      if (academicSource) {
        requestSources("selected", [
          { nodeId: node.id, source: academicSource },
        ]);
        const requestId = newId("open-source");
        openSourceRequestsRef.current.begin(requestId, node.id, academicSource);
        propsRef.current.onOpenAcademicSource?.(
          requestId,
          node.id,
          academicSource,
        );
      } else if (model.kind === "pdf" && model.data.attachmentID) {
        propsRef.current.onOpenItem({
          attachmentID: model.data.attachmentID,
          pdfPage: model.data.pdfPage,
        });
      } else if (model.kind === "attachment" && model.data.attachmentID) {
        propsRef.current.onOpenItem({
          attachmentID: model.data.attachmentID,
        });
      } else if (model.kind === "item" && model.data.itemID) {
        propsRef.current.onOpenItem({ itemID: model.data.itemID });
      } else {
        startEdit(node.id);
      }
    },
    [openEmbeddedFile, requestSources, startEdit],
  );

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const { nodeId, value } = editing;
    editingRevisionRef.current += 1;
    setEditing(null);
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node) {
      setNodes((current) =>
        current.map((item) => ({ ...item, className: undefined })),
      );
      return;
    }
    if (flowNodeText(node) === value) {
      setNodes((current) =>
        current.map((item) => ({ ...item, className: undefined })),
      );
      return;
    }
    updateNode(nodeId, (current) => ({
      ...mergeEditingStyle(current, value, {}),
      className: undefined,
    }));
  }, [editing, updateNode]);

  const cancelEdit = useCallback(() => {
    editingRevisionRef.current += 1;
    setEditing(null);
    setNodes((current) =>
      current.map((item) => ({ ...item, className: undefined })),
    );
  }, []);

  const commitEdgeEdit = useCallback(
    (text: string) => {
      if (!editingEdge) return;
      const edge = edgesRef.current.find(
        (candidate) => candidate.id === editingEdge.edgeId,
      );
      setEditingEdge(null);
      if (!edge) return;
      const connection = edge.data?.connection ?? {
        id: edge.id,
        kind: "basic" as const,
        source: edge.source,
        target: edge.target,
      };
      const value = text.trim();
      // Unchanged visible fallback labels should not be materialized on blur.
      if (value === editingEdge.value.trim()) return;
      // An explicit empty label suppresses relation fallback without losing semantics.
      const nextConnection = { ...connection, label: value };
      pushHistory();
      setEdges((current) =>
        current.map((candidate) =>
          candidate.id === edge.id
            ? {
                ...candidate,
                label: nextConnection.label,
                data: { ...candidate.data, connection: nextConnection },
              }
            : candidate,
        ),
      );
      bump();
    },
    [bump, edgesRef, editingEdge, pushHistory],
  );

  const cancelEdgeEdit = useCallback(() => setEditingEdge(null), []);

  const pasteSelection = useCallback(
    (document: CanvasDocument, center = false) => {
      if (!document.nodes.length) return;
      let offset = { x: 24, y: 24 };
      if (center) {
        const host = canvasHostRef.current?.getBoundingClientRect();
        if (host && flowRef.current) {
          const point = flowRef.current.screenToFlowPosition({
            x: host.left + host.width / 2,
            y: host.top + host.height / 2,
          });
          offset = {
            x: point.x - Math.min(...document.nodes.map((n) => n.position.x)),
            y: point.y - Math.min(...document.nodes.map((n) => n.position.y)),
          };
        }
      }
      const copied = cloneSelection(document, () => newId("copy"), offset);
      const flow = canvasDocumentToFlow(copied);
      pushHistory();
      setNodes((current) => [
        ...current.map((n) => ({ ...n, selected: false })),
        ...flow.nodes.map((n) => ({ ...n, selected: true })),
      ]);
      setEdges((current) => [
        ...current.map((e) => ({ ...e, selected: false })),
        ...flow.edges,
      ]);
      bump();
    },
    [pushHistory, setNodes, setEdges, bump],
  );

  const copyNode = useCallback(
    (nodeId?: string) => {
      const selected = nodesRef.current
        .filter((node) => node.selected)
        .map((node) => node.id);
      const ids = nodeId && !selected.includes(nodeId) ? [nodeId] : selected;
      pasteSelection(selectedDocument(snapshotNow(), ids));
    },
    [nodesRef, snapshotNow, pasteSelection],
  );

  useEffect(() => {
    const allowed = (event: ClipboardEvent) =>
      !editing &&
      !editingEdge &&
      !annotationBrowserRef.current &&
      !isEditableTarget(event.target);
    const onCopy = (event: ClipboardEvent) => {
      if (
        !allowed(event) ||
        !event.clipboardData ||
        window.getSelection()?.toString()
      )
        return;
      const document = selectedDocument(
        snapshotNow(),
        nodesRef.current.filter((n) => n.selected).map((n) => n.id),
      );
      if (!document.nodes.length) return;
      event.clipboardData.setData("text/plain", serializeSelection(document));
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!allowed(event) || !event.clipboardData) return;
      const imageItem = Array.from(event.clipboardData.items ?? []).find(
        (item) => item.type.startsWith("image/"),
      );
      const imageFile = imageItem?.getAsFile();
      if (imageFile) {
        event.preventDefault();
        void addImportedFiles([imageFile]);
        return;
      }
      const document = parseSelection(
        event.clipboardData.getData("text/plain"),
      );
      if (!document) return;
      event.preventDefault();
      pasteSelection(document, true);
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, [
    addImportedFiles,
    editing,
    editingEdge,
    nodesRef,
    snapshotNow,
    pasteSelection,
  ]);

  const deleteNode = useCallback(
    (nodeId: string) => {
      setMenu(null);
      deleteCanvasElements([nodeId]);
    },
    [deleteCanvasElements],
  );

  const changeSelectedNoteType = useCallback(
    (nodeId: string, noteType: NoteType) => {
      updateNode(nodeId, (current) =>
        updateFlowNodeModel(current, (model) =>
          model.kind === "note" ? changeNoteType(model, noteType) : model,
        ),
      );
    },
    [updateNode],
  );

  const changeNoteBadge = useCallback(
    (nodeId: string, badge: string) => {
      updateNode(nodeId, (current) =>
        updateFlowNodeModel(current, (model) => {
          if (model.kind !== "note") return model;
          const { badge: _badge, ...withoutBadge } = model;
          return {
            ...withoutBadge,
            noteType: getNoteType(model),
            ...(badge ? { badge } : {}),
          };
        }),
      );
    },
    [updateNode],
  );

  const applyTemplateToNote = useCallback(
    (nodeId: string, templateId: string) => {
      const template = noteTemplates.find((item) => item.id === templateId);
      if (!template) return;
      updateNode(nodeId, (current) => {
        const model = current.data.model;
        if (model.kind !== "note") return current;
        const nextModel = applyNoteTemplate(model, template);
        return {
          ...updateFlowNodeModel(current, () => nextModel),
          width: nextModel.width,
          height: nextModel.height,
          style: { width: nextModel.width, height: nextModel.height },
        };
      });
    },
    [noteTemplates, updateNode],
  );

  const persistTemplate = useCallback((template: NoteTemplate) => {
    setCustomTemplates((current) => [
      ...current.filter((item) => item.id !== template.id),
      template,
    ]);
    propsRef.current.onSaveNoteTemplate?.(template);
  }, []);

  const saveNoteAsTemplate = useCallback(
    (nodeId: string, name: string, includeContent: boolean) => {
      const model = nodesRef.current.find((node) => node.id === nodeId)?.data
        .model;
      if (model?.kind !== "note") return;
      persistTemplate(
        createCustomNoteTemplate(model, {
          id: newId("template"),
          name,
          includeContent,
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    [nodesRef, persistTemplate],
  );

  const renameTemplate = useCallback(
    (templateId: string, name: string) => {
      const template = customTemplates.find((item) => item.id === templateId);
      if (!template) return;
      persistTemplate({
        ...template,
        name,
        updatedAt: new Date().toISOString(),
      });
    },
    [customTemplates, persistTemplate],
  );

  const duplicateTemplate = useCallback(
    (templateId: string) => {
      const template = customTemplates.find((item) => item.id === templateId);
      if (!template) return;
      persistTemplate({
        ...template,
        id: newId("template"),
        name: `${template.name} ${labels.copy}`,
        style: { ...template.style },
        ...(template.defaultSize
          ? { defaultSize: { ...template.defaultSize } }
          : {}),
        updatedAt: new Date().toISOString(),
      });
    },
    [customTemplates, labels.copy, persistTemplate],
  );

  const deleteTemplate = useCallback(
    (templateId: string) => {
      if (!window.confirm(labels.deleteTemplate)) return;
      setCustomTemplates((current) =>
        current.filter((item) => item.id !== templateId),
      );
      propsRef.current.onDeleteNoteTemplate?.(templateId);
      if (activeNoteTemplateId === templateId) {
        setActiveNoteTemplateId(BUILTIN_NOTE_TEMPLATE_IDS.note);
      }
    },
    [activeNoteTemplateId, labels.deleteTemplate],
  );

  const alignSelected = useCallback(
    (mode: AlignMode) => {
      const selected = nodesRef.current.filter((node) => node.selected);
      if (selected.length < 2) return;
      pushHistory();
      const aligned = alignNodes(selected, mode);
      applyNodePositions(aligned);
      bump();
    },
    [applyNodePositions, bump, pushHistory],
  );

  const distributeSelected = useCallback(
    (direction: "horizontal" | "vertical") => {
      const selected = nodesRef.current.filter((node) => node.selected);
      if (selected.length < 3) return;
      pushHistory();
      const distributed = distributeNodes(selected, direction);
      applyNodePositions(distributed);
      bump();
    },
    [applyNodePositions, bump, pushHistory],
  );

  const autoLayout = useCallback(() => {
    if (
      !nodesRef.current.some((node) => node.selected) &&
      !window.confirm(labels.layoutAllConfirm ?? "Arrange the entire canvas?")
    )
      return;
    pushHistory();
    applyNodePositions(layoutSelection(nodesRef.current));
    bump();
  }, [
    applyNodePositions,
    bump,
    nodesRef,
    pushHistory,
    labels.layoutAllConfirm,
  ]);

  const nudgeSelected = useCallback(
    (key: string, shift: boolean): boolean => {
      const selected = nodesRef.current.filter((node) => node.selected);
      if (!selected.length || !key.startsWith("Arrow")) return false;
      const step = shift ? 16 : 1;
      const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      if (!dx && !dy) return false;

      pushHistory();
      const positioned = selected.map((node) => ({
        ...node,
        position: {
          x: node.position.x + dx,
          y: node.position.y + dy,
        },
      }));
      applyNodePositions(positioned);
      bump();
      return true;
    },
    [applyNodePositions, bump, nodesRef, pushHistory],
  );

  const fitView = useCallback(() => {
    void flowRef.current?.fitView({ padding: 0.2, duration: 300 });
  }, []);

  const fitSelection = useCallback(() => {
    const selected = nodesRef.current
      .filter((node) => node.selected)
      .map((node) => ({ id: node.id }));
    if (!selected.length) return;
    void flowRef.current?.fitView({
      nodes: selected,
      padding: 0.24,
      duration: 300,
    });
  }, [nodesRef]);

  const groupSelection = useCallback(() => {
    setMenu(null);
    const pending = new Set(academicAcquisition.pendingNodeIds());
    const selected = nodesRef.current.filter(
      (node) =>
        node.selected &&
        node.data.model.kind !== "frame" &&
        !pending.has(node.id),
    );
    if (!selected.length) return;
    const padding = 32;
    const titleSpace = 64;
    const bounds = selected.reduce(
      (current, node) => {
        const size = nodeSize(node);
        return {
          left: Math.min(current.left, node.position.x),
          top: Math.min(current.top, node.position.y),
          right: Math.max(current.right, node.position.x + size.width),
          bottom: Math.max(current.bottom, node.position.y + size.height),
        };
      },
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      },
    );
    const frameId = newId("frame");
    const frame = {
      ...createAcademicNode(
        "frame",
        {
          x: bounds.left - padding,
          y: bounds.top - titleSpace,
        },
        frameId,
      ),
      width: bounds.right - bounds.left + padding * 2,
      height: bounds.bottom - bounds.top + titleSpace + padding,
      title: labels.kindFrame,
    };
    let document = workingSnapshot();
    document = {
      ...document,
      nodes: [...document.nodes, frame],
    };
    for (const node of selected) {
      document = assignNodeToFrame(document, node.id, frameId);
    }
    pushHistory();
    applyDocument(document);
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        selected: node.id === frameId,
      })),
    );
    bump();
  }, [
    academicAcquisition,
    applyDocument,
    bump,
    labels.kindFrame,
    nodesRef,
    pushHistory,
    setMenu,
    setNodes,
    workingSnapshot,
  ]);

  const removeFromGroup = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find(
        (candidate) => candidate.id === nodeId,
      );
      if (!node || !("frameId" in node.data.model) || !node.data.model.frameId)
        return;
      const selectedIds = new Set(
        nodesRef.current
          .filter((candidate) => candidate.selected)
          .map((candidate) => candidate.id),
      );
      pushHistory();
      applyDocument(assignNodeToFrame(workingSnapshot(), nodeId, undefined));
      setNodes((current) =>
        current.map((candidate) => ({
          ...candidate,
          selected: selectedIds.has(candidate.id),
        })),
      );
      setMenu(null);
      bump();
    },
    [applyDocument, bump, nodesRef, pushHistory, setNodes, workingSnapshot],
  );

  const closeEditing = useCallback(() => {
    editingRevisionRef.current += 1;
    setEditing(null);
    setEditingEdge(null);
    setDetailsTarget(null);
    setNodes((current) =>
      current.map((item) => ({ ...item, className: undefined })),
    );
  }, [setNodes]);

  const loadCanvasSnapshot = useCallback(
    (snapshot: CanvasDocument) => {
      closeEditing();
      loadSnapshot(snapshot);
    },
    [closeEditing, loadSnapshot],
  );

  const undoCanvas = useCallback(() => {
    closeEditing();
    undo();
  }, [closeEditing, undo]);

  const redoCanvas = useCallback(() => {
    closeEditing();
    redo();
  }, [closeEditing, redo]);

  const changeEdgeStyle = useCallback(
    (edgeId: string, patch: Parameters<typeof withEdgeStyle>[1]) => {
      if (!edgesRef.current.some((edge) => edge.id === edgeId)) return;
      pushHistory();
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId ? withEdgeStyle(edge, patch) : edge,
        ),
      );
      bump();
    },
    [bump, pushHistory],
  );

  const EDGE_COLORS = ["#9ca3af", "#2563eb", "#059669", "#d97706", "#dc2626"];
  const cycleEdgeColor = useCallback(
    (edgeId: string) => {
      const edge = edgesRef.current.find((item) => item.id === edgeId);
      if (!edge) return;
      const color = String(edge.style?.stroke ?? "#9ca3af");
      changeEdgeStyle(edgeId, {
        color:
          EDGE_COLORS[(EDGE_COLORS.indexOf(color) + 1) % EDGE_COLORS.length],
      });
    },
    [changeEdgeStyle],
  );
  const toggleEdgeDashed = useCallback(
    (edgeId: string) => {
      const edge = edgesRef.current.find((item) => item.id === edgeId);
      if (edge)
        changeEdgeStyle(edgeId, { dashed: !edge.style?.strokeDasharray });
    },
    [changeEdgeStyle],
  );
  const toggleEdgeArrow = useCallback(
    (edgeId: string) => {
      const edge = edgesRef.current.find((item) => item.id === edgeId);
      if (edge) changeEdgeStyle(edgeId, { arrow: !edge.markerEnd });
    },
    [changeEdgeStyle],
  );

  const exportAs = useCallback(
    (format: "png" | "svg" | "md", scale: PngScale = 2) => {
      if (exportBusyRef.current) return;
      setMenu(null);
      const doc = snapshotNow();
      const requestId = `export-${Date.now().toString(36)}`;
      if (format === "md") {
        propsRef.current.onExportFile({
          requestId,
          format,
          mimeType: "text/markdown",
          text: buildCanvasMarkdown(doc),
        });
        return;
      }
      if (format === "svg") {
        const svg = buildCanvasSvg(doc, labels);
        propsRef.current.onExportFile({
          requestId,
          format,
          mimeType: "image/svg+xml",
          dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        });
        return;
      }
      const host = canvasHostRef.current;
      if (!host) return;
      exportBusyRef.current = true;
      setExportStatus("busy");
      void exportCanvasPng(host, doc, scale)
        .then((dataUrl) => {
          propsRef.current.onExportFile({
            requestId,
            format,
            mimeType: "image/png",
            dataUrl,
          });
          setExportStatus(null);
        })
        .catch((error: unknown) => {
          console.error("PNG export failed", error);
          setExportStatus("error");
        })
        .finally(() => {
          exportBusyRef.current = false;
        });
    },
    [snapshotNow, labels],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && imageViewer) {
        event.preventDefault();
        event.stopPropagation();
        setImageViewer(null);
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f" &&
        !isEditableTarget(event.target) &&
        !editing &&
        !editingEdge &&
        !annotationBrowserRef.current
      ) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !editing &&
        !editingEdge &&
        annotationBrowserRef.current === null &&
        !isEditableTarget(event.target)
      ) {
        const templateId = noteTemplateShortcut(event.key);
        if (templateId) setActiveNoteTemplateId(templateId);
      }
      handleGlobalCanvasKeyDown(
        event,
        {
          annotationBrowserOpen: annotationBrowserRef.current !== null,
          editing: Boolean(editing || editingEdge),
          drawing: drawRef.current !== null,
          selectedNodeIds: nodesRef.current
            .filter((node) => node.selected)
            .map((node) => node.id),
          selectedEdgeIds: edgesRef.current
            .filter((edge) => edge.selected)
            .map((edge) => edge.id),
        },
        {
          endFrameDrag,
          cancelDraw,
          dismissTransientUi() {
            setMenu(null);
            setHelpOpen(false);
            setDetailsTarget(null);
          },
          setActiveTool,
          deleteSelection: deleteCanvasElements,
          nudgeSelected,
          fitView,
          fitSelection,
          undo: undoCanvas,
          redo: redoCanvas,
        },
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editing,
    editingEdge,
    imageViewer,
    cancelDraw,
    deleteCanvasElements,
    edgesRef,
    endFrameDrag,
    fitSelection,
    fitView,
    nudgeSelected,
    redoCanvas,
    undoCanvas,
  ]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!drawRef.current || event.pointerId !== drawRef.current.pointerId)
        return;
      updateDraw(event.clientX, event.clientY, event.shiftKey);
    };
    const onUp = (event: PointerEvent) => {
      if (!drawRef.current || event.pointerId !== drawRef.current.pointerId)
        return;
      updateDraw(event.clientX, event.clientY, event.shiftKey);
      finishDraw();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [finishDraw, updateDraw]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".zmd-board-context-menu")) {
        setMenu(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menu]);

  useEffect(() => {
    const runtime: WhiteboardRuntime = {
      setTheme,
      setLabels,
      setTemplates(templates) {
        setCustomTemplates(parseNoteTemplateRegistry(templates));
      },
      loadSnapshot: loadCanvasSnapshot,
      getSnapshot: snapshotNow,
      undo: undoCanvas,
      redo: redoCanvas,
      beginAcademicDrop(requestId, nodeId, screenPosition, sources) {
        setActiveTool("select");
        const position =
          flowRef.current?.screenToFlowPosition(screenPosition) ??
          screenPosition;
        academicAcquisition.dropLiterature(
          requestId,
          nodeId,
          position,
          sources,
        );
      },
      rejectAcademicDrop(code) {
        showCanvasNotice({ code });
      },
      resolveAcademicAcquisitionBatch(requestId, nodeId, successes, failures) {
        const addedNodeIds = academicAcquisition.resolveBatch(
          requestId,
          nodeId,
          successes,
          failures,
        );
        if (addedNodeIds.length) {
          sourceStatesRef.current = updateSourceResolutionStates(
            sourceStatesRef.current,
            addedNodeIds.map((addedNodeId) => ({
              nodeId: addedNodeId,
              status: "idle",
            })),
          );
          renderSourceState((revision) => revision + 1);
          setSourceCycle((cycle) => cycle + 1);
        }
      },
      rejectAcademicRequest(requestId, nodeId, code) {
        if (
          noteRefreshRuntime.reject(requestId, nodeId, labels.noteRefreshFailed)
        ) {
          showCanvasNotice({
            code: "note-refresh-failed",
            nodeId,
            failureCode:
              code === "library-missing" ||
              code === "item-missing" ||
              code === "wrong-kind" ||
              code === "parent-mismatch"
                ? code
                : "note-refresh-failed",
          });
          return;
        }
        academicAcquisition.reject(requestId, nodeId, code);
      },
      rejectSourceAction(requestId, nodeId, source, failure) {
        if (!openSourceRequestsRef.current.accept(requestId, nodeId, source)) {
          return;
        }
        showCanvasNotice({
          code: "source-open-failed",
          nodeId,
          failureCode: failure.code,
        });
      },
      acceptSourceAction(requestId, nodeId, action, source) {
        if (action !== "open") return;
        if (!openSourceRequestsRef.current.accept(requestId, nodeId, source)) {
          return;
        }
        clearMatchingNotice(
          (notice) =>
            notice.code === "source-open-failed" && notice.nodeId === nodeId,
        );
      },
      applySourceResolutionBatch,
      applyNoteRefresh,
      applyAnnotationCandidates,
      rejectAnnotationList,
      setSaveState(state) {
        setSaveState(state);
      },
    };
    runtimeRef.current = runtime;
    propsRef.current.onReady(runtime);
  }, [
    academicAcquisition,
    applySourceResolutionBatch,
    applyNoteRefresh,
    applyAnnotationCandidates,
    clearMatchingNotice,
    labels.noteRefreshFailed,
    loadCanvasSnapshot,
    noteRefreshRuntime,
    rejectAnnotationList,
    redoCanvas,
    snapshotNow,
    showCanvasNotice,
    undoCanvas,
  ]);

  useEffect(() => {
    scheduleSourceResolution();
    return cancelIdleResolution;
  }, [cancelIdleResolution, scheduleSourceResolution, sourceCycle]);

  useEffect(
    () => () => {
      openSourceRequestsRef.current.clear();
      academicAcquisitionRef.current?.clear();
      noteRefreshRuntimeRef.current?.clear();
      sourceRefreshRuntimeRef.current?.clear();
    },
    [],
  );

  useEffect(() => {
    requestSources("selected", currentSourceRequests().selected);
  }, [currentSourceRequests, nodes, requestSources]);

  useEffect(() => {
    setTheme(props.theme);
  }, [props.theme]);

  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedEdges = edges.filter((edge) => edge.selected);
  useEffect(() => {
    setDetailsTarget((current) => {
      if (
        !current ||
        editing ||
        editingEdge ||
        selectedNodes.length !== 1 ||
        selectedEdges.length
      ) {
        return null;
      }
      return selectedNodes[0]!.id === current ? current : null;
    });
  }, [editing, editingEdge, nodes, edges]);
  const editingNode = editing
    ? nodes.find((node) => node.id === editing.nodeId)
    : null;
  const editingStroke =
    editingNode &&
    (editingNode.data.model.kind === "line" ||
      editingNode.data.model.kind === "arrow")
      ? editingNode.data.model
      : null;
  const editingStrokeCenter = editingStroke
    ? {
        x:
          ((editingStroke.data.from?.x ?? 0) +
            (editingStroke.data.to?.x ?? nodeSize(editingNode!).width)) /
          2,
        y:
          ((editingStroke.data.from?.y ?? nodeSize(editingNode!).height / 2) +
            (editingStroke.data.to?.y ?? nodeSize(editingNode!).height / 2)) /
          2,
      }
    : null;
  const editingSurfaceDefaults = editingNode
    ? canvasNodeSurfaceDefaults(
        editingNode.data.model.kind,
        editingNode.data.model.kind === "note"
          ? getNoteType(editingNode.data.model)
          : undefined,
      )
    : undefined;
  const editingScreen = editingNode
    ? flowRef.current?.flowToScreenPosition(editingNode.position)
    : null;
  const editingTextStyle = editingNode
    ? effectiveCanvasNodeUiTextStyle(
        editingNode.data.model.kind,
        editingNode.data.model.style,
      )
    : null;
  const menuNode = menu ? nodes.find((node) => node.id === menu.nodeId) : null;
  const toolbarNode =
    selectedNodes.length === 1 &&
    !selectedEdges.length &&
    !editing &&
    !editingEdge
      ? selectedNodes[0]
      : null;
  const toolbarScreen = toolbarNode
    ? flowRef.current?.flowToScreenPosition(toolbarNode.position)
    : null;
  const toolbarEdge =
    selectedEdges.length === 1 &&
    !selectedNodes.length &&
    !editing &&
    !editingEdge
      ? selectedEdges[0]
      : null;
  const anchoredEdge = editingEdge
    ? edges.find((edge) => edge.id === editingEdge.edgeId)
    : toolbarEdge;
  const edgeToolbarAnchor = anchoredEdge
    ? (() => {
        const source = nodes.find((node) => node.id === anchoredEdge.source);
        const target = nodes.find((node) => node.id === anchoredEdge.target);
        if (!source || !target) return null;
        const from = connectionEndpoint(
          { position: source.position, ...nodeSize(source) },
          anchoredEdge.sourceHandle,
          Position.Right,
        );
        const to = connectionEndpoint(
          { position: target.position, ...nodeSize(target) },
          anchoredEdge.targetHandle,
          Position.Left,
        );
        const [, x, y] = getBezierPath({
          sourceX: from.x,
          sourceY: from.y,
          sourcePosition: from.position,
          targetX: to.x,
          targetY: to.y,
          targetPosition: to.position,
        });
        const screen = flowRef.current?.flowToScreenPosition({ x, y });
        return screen ? { ...screen, width: 0, height: 0 } : null;
      })()
    : null;
  const zoom = viewportRef.current.zoom || 1;
  const propertyNode =
    toolbarNode && detailsTarget === toolbarNode.id ? toolbarNode : null;
  const propertyPosition = propertyNode
    ? (() => {
        const screen = flowRef.current?.flowToScreenPosition(
          propertyNode.position,
        );
        if (!screen) return undefined;
        return {
          x: screen.x,
          y: screen.y,
          width: nodeSize(propertyNode).width * zoom,
          height: nodeSize(propertyNode).height * zoom,
        };
      })()
    : undefined;
  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const connection = edge.data?.connection;
        if (!connection) return edge;
        const label = connectionDisplayLabel(
          connection,
          labels,
          typeof edge.label === "string" ? edge.label : undefined,
        );
        return {
          ...edge,
          label:
            editingEdge?.edgeId === edge.id
              ? undefined
              : label?.includes("\n")
                ? label.split("\n").map((line, index, lines) => (
                    <tspan
                      key={index}
                      x={0}
                      dy={
                        index === 0
                          ? `${-(lines.length - 1) * 0.625}em`
                          : "1.25em"
                      }
                    >
                      {line || "\u00a0"}
                    </tspan>
                  ))
                : label,
          labelStyle: {
            fontSize: 12,
            ...nodeTextStyle(connection.textStyle ?? {}),
            fill:
              connection.textStyle?.textColor ??
              "var(--zmd-board-text, #111827)",
          },
          labelBgStyle: {
            fill: "var(--zmd-board-surface, #fff)",
            fillOpacity: 1,
          },
          labelBgPadding: [12, 7] as [number, number],
          labelBgBorderRadius: 8,
        };
      }),
    [edges, labels, editingEdge],
  );

  return (
    <WhiteboardLabelsProvider value={labels}>
      <div
        ref={canvasHostRef}
        style={
          {
            "--zmd-board-bg": THEME_TOKENS[theme].bg,
            "--zmd-board-surface": THEME_TOKENS[theme].surface,
            "--zmd-board-hover": THEME_TOKENS[theme].surface2,
            "--zmd-board-border":
              theme === "dark"
                ? THEME_TOKENS.dark.borderStrong
                : THEME_TOKENS.light.border,
            "--zmd-board-text": THEME_TOKENS[theme].text,
            "--zmd-board-muted": THEME_TOKENS[theme].textMuted,
            "--zmd-board-accent": THEME_TOKENS[theme].accent,
            "--zmd-board-accent-soft": THEME_TOKENS[theme].accentSoft,
            "--zmd-control-size": `${UI_METRICS.control}px`,
            "--zmd-compact-control-size": `${UI_METRICS.compactControl}px`,
            "--zmd-icon-size": `${UI_METRICS.icon}px`,
            "--zmd-menu-shadow": `${UI_METRICS.menuShadow} ${THEME_TOKENS[theme].menuShadow}`,
          } as CSSProperties
        }
        className={`zmd-board-host${eraser ? " is-eraser" : ""}${activeTool === "hand" ? " is-hand" : ""}${isDrawTool(activeTool) ? " is-draw" : ""}`}
        data-theme={theme}
        tabIndex={-1}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        onDoubleClick={(event) => {
          if (activeTool !== "select" || editing || editingEdge) return;
          const target = event.target as HTMLElement | null;
          if (
            target?.closest(
              ".react-flow__node, .react-flow__edge, .react-flow__controls, .zmd-board-toolbars",
            )
          )
            return;
          if (!target?.closest(".react-flow__pane")) return;
          event.preventDefault();
          addNode(
            "note",
            flowRef.current?.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            }),
          );
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || editing) return;
          if (!isDrawTool(activeToolRef.current)) return;
          const target = event.target as HTMLElement | null;
          if (!target?.closest(".react-flow__pane")) return;
          event.preventDefault();
          beginDraw(event, activeToolRef.current);
        }}
      >
        <TopIsland
          labels={labels}
          theme={theme}
          activeTool={activeTool}
          onSelectTool={(tool) => {
            if (tool === "literature") addNode("literature");
            else setActiveTool(tool);
          }}
          noteTemplates={noteTemplates}
          activeNoteTemplateId={activeNoteTemplateId}
          onSelectNoteTemplate={setActiveNoteTemplateId}
          saveState={saveState}
          selectedNodeCount={selectedNodes.length}
          selectedEdgeCount={selectedEdges.length}
          onUndo={undoCanvas}
          onRedo={redoCanvas}
          onAddFile={() => openFilePicker("attachment")}
          onSave={() => propsRef.current.onSave()}
          onSwitchWindow={props.onSwitchWindow}
          onExportPng={() => exportAs("png")}
          onExportSvg={() => exportAs("svg")}
          onExportMarkdown={() => exportAs("md")}
          exportBusy={exportStatus === "busy"}
          onFitView={fitView}
          onFitSelection={fitSelection}
          onGroupSelection={groupSelection}
          onAutoLayout={autoLayout}
          onDuplicate={() => copyNode()}
          onSearch={() => setSearchOpen(true)}
          onOpenShortcuts={() => setHelpOpen(true)}
          onAlign={alignSelected}
          onDistribute={distributeSelected}
          onEdgeColor={() =>
            selectedEdges[0] && cycleEdgeColor(selectedEdges[0].id)
          }
          onEdgeDash={() =>
            selectedEdges[0] && toggleEdgeDashed(selectedEdges[0].id)
          }
          onEdgeArrow={() =>
            selectedEdges[0] && toggleEdgeArrow(selectedEdges[0].id)
          }
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFileInputChange}
          aria-hidden="true"
        />
        {searchOpen ? (
          <div
            className="zmd-board-search"
            role="search"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") setSearchOpen(false);
              if (event.key === "Enter" && searchResults.length) {
                event.preventDefault();
                focusSearchResult(
                  searchIndex < 0
                    ? event.shiftKey
                      ? searchResults.length - 1
                      : 0
                    : (searchIndex +
                        (event.shiftKey ? -1 : 1) +
                        searchResults.length) %
                        searchResults.length,
                );
              }
            }}
          >
            <input
              autoFocus
              aria-label={labels.searchCanvas ?? "Search canvas"}
              placeholder={labels.searchCanvas ?? "Search canvas"}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchIndex(-1);
              }}
            />
            <span role="status">
              {searchResults.length
                ? `${Math.min(searchIndex + 1, searchResults.length)} / ${searchResults.length}`
                : "0"}
            </span>
            <button
              type="button"
              disabled={!searchResults.length}
              aria-label={labels.fitSelection ?? "Focus result"}
              onClick={() =>
                focusSearchResult(
                  Math.max(0, searchIndex) % searchResults.length,
                )
              }
            >
              ↵
            </button>
            <button
              type="button"
              aria-label={labels.close ?? "Close"}
              onClick={() => setSearchOpen(false)}
            >
              ×
            </button>
          </div>
        ) : null}
        {exportStatus ? (
          <div
            className="zmd-board-notice"
            role={exportStatus === "error" ? "alert" : "status"}
            data-tone={exportStatus === "error" ? "error" : "info"}
          >
            <span>
              {exportStatus === "busy"
                ? labels.exporting
                : labels.exportRenderFailed}
            </span>
            {exportStatus === "error" ? (
              <button
                type="button"
                aria-label={labels.close}
                onClick={() => setExportStatus(null)}
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}
        <CanvasNoticeRegion
          labels={labels}
          notice={canvasNotice}
          onDismiss={clearCanvasNotice}
        />
        {fileNotice ? (
          <div className="zmd-board-notice" data-tone="error">
            <span role="alert">{fileNotice}</span>
            <button
              type="button"
              aria-label={labels.close}
              onClick={() => setFileNotice(null)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ) : null}
        {imageViewer ? (
          <div
            className="zmd-board-image-viewer-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={fileLabel(labels, "filePreview", "Preview")}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setImageViewer(null);
            }}
          >
            <div className="zmd-board-image-viewer">
              <button
                type="button"
                className="zmd-board-image-viewer-close"
                aria-label={labels.close}
                onClick={() => setImageViewer(null)}
              >
                ×
              </button>
              <img src={imageViewer.image} alt={imageViewer.title} />
              <span>{imageViewer.title}</span>
            </div>
          </div>
        ) : null}
        <PropertiesPanel
          labels={labels}
          node={propertyNode}
          position={propertyPosition}
          sourceState={
            selectedNodes.length === 1
              ? sourceStatesRef.current.get(selectedNodes[0].id)
              : undefined
          }
          onClose={() => {
            setDetailsTarget(null);
            window.requestAnimationFrame(() =>
              detailsButtonRef.current?.focus(),
            );
          }}
          onOpen={openNode}
          onRefreshSource={refreshNodeSource}
          onViewAnnotations={openAnnotationBrowser}
          viewAnnotationsRef={viewAnnotationsRef}
          onCopy={copyNode}
          onDelete={deleteNode}
          onRemoveFromGroup={removeFromGroup}
          noteTemplates={noteTemplates}
          onBadgeChange={changeNoteBadge}
          onTypeChange={changeSelectedNoteType}
          onApplyTemplate={applyTemplateToNote}
          onSaveTemplate={saveNoteAsTemplate}
          onRenameTemplate={renameTemplate}
          onDuplicateTemplate={duplicateTemplate}
          onDeleteTemplate={deleteTemplate}
        />
        {annotationBrowser ? (
          <AnnotationBrowser
            labels={{
              title: labels.annotationBrowserTitle,
              search: labels.searchAnnotations,
              loading: labels.annotationsLoading,
              empty: labels.annotationsEmpty,
              unavailable: labels.annotationsUnavailable,
              partialFailure: labels.annotationsPartialFailure,
              alreadyAdded: labels.annotationAlreadyAdded,
              focusExisting: labels.focusExistingAnnotation,
              addSelected: labels.addSelectedAnnotations,
              page: labels.annotationPage,
              close: labels.close,
            }}
            state={annotationBrowser.state}
            query={annotationBrowser.query}
            selectedKeys={annotationBrowser.selectedKeys}
            existingKeys={existingAnnotationKeys(workingSnapshot())}
            returnFocusRef={viewAnnotationsRef}
            onQueryChange={(query) =>
              setAnnotationBrowser((current) =>
                current ? { ...current, query } : current,
              )
            }
            onToggle={(annotationKey, checked) =>
              setAnnotationBrowser((current) =>
                current
                  ? {
                      ...current,
                      selectedKeys: toggleAnnotationSelection(
                        current.selectedKeys,
                        annotationKey,
                        checked,
                      ),
                    }
                  : current,
              )
            }
            onClose={closeAnnotationBrowser}
            onFocusExisting={focusExistingAnnotation}
            onAddSelected={addSelectedAnnotations}
          />
        ) : null}
        <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
          colorMode={theme}
          nodes={nodes}
          edges={displayEdges}
          nodeTypes={canvasNodeTypes}
          defaultViewport={initial.viewport}
          fitView={fitInitialView}
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.1}
          connectionMode={ConnectionMode.Loose}
          connectionLineType={ConnectionLineType.Bezier}
          connectionRadius={28}
          reconnectRadius={7}
          defaultEdgeOptions={{
            type: "default",
            interactionWidth: 24,
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          }}
          snapToGrid={activeTool === "select"}
          snapGrid={[16, 16]}
          deleteKeyCode={null}
          panActivationKeyCode={null}
          onKeyDownCapture={(event) => {
            captureCanvasArrowKey(event, Boolean(editing), nudgeSelected);
          }}
          panOnDrag={activeTool === "hand" ? true : [1, 2]}
          panOnScroll={spacePressed && activeTool === "hand"}
          selectionOnDrag={activeTool === "select"}
          elementsSelectable={activeTool === "select"}
          nodesDraggable={!eraser && !editing && activeTool === "select"}
          nodesConnectable={!eraser && activeTool === "select"}
          edgesReconnectable={!eraser && !editing && activeTool === "select"}
          onInit={(instance) => {
            flowRef.current = instance;
            if (fitPendingViewRef.current) fitPendingView();
            else if (!fitInitialView)
              void instance.setViewport(viewportRef.current);
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onNodeClick={(event, node) => {
            const image = (event.target as Element).closest?.(
              ".zmd-board-pdf-image, .zmd-board-attachment-image, .zmd-board-card img",
            );
            if (image) {
              const info = embeddedImageInfo(node.data.model);
              if (info) {
                event.preventDefault();
                event.stopPropagation();
                setImageViewer(info);
                return;
              }
            }
            const link = (event.target as Element).closest?.(
              "a[href], [data-zmd-wikilink]",
            );
            if (link) {
              event.preventDefault();
              event.stopPropagation();
              const wiki = link.getAttribute("data-zmd-wikilink");
              const href = wiki
                ? `[[${wiki}]]`
                : link.getAttribute("href") || "";
              if (href.startsWith("#")) {
                const target = [
                  ...(link
                    .closest(".zmd-board-card-markdown")
                    ?.querySelectorAll("[id]") ?? []),
                ].find((element) => element.id === href.slice(1));
                target?.scrollIntoView({ block: "nearest" });
              } else if (propsRef.current.onOpenLink)
                propsRef.current.onOpenLink(href);
              else if (/^https?:/.test(href))
                window.open(href, "_blank", "noopener,noreferrer");
              return;
            }
            if (!eraser) return;
            event.preventDefault();
            eraseNode(node.id);
          }}
          zoomOnDoubleClick={false}
          onNodeDoubleClick={(event, node) => {
            if (
              (event.target as Element).closest?.(
                "a[href], [data-zmd-wikilink]",
              )
            )
              return;
            event.preventDefault();
            setEditingEdge(null);
            const origin = flowRef.current?.flowToScreenPosition(node.position);
            const size = nodeSize(node);
            const zoom = viewportRef.current.zoom || 1;
            const kind = node.data.model.kind;
            if (origin) {
              const local = {
                x: (event.clientX - origin.x) / zoom,
                y: (event.clientY - origin.y) / zoom,
              };
              if (
                !(event.target as Element).closest?.(
                  ".zmd-board-stroke-label",
                ) &&
                isBorderHit(local, {
                  width: size.width,
                  height: size.height,
                  kind,
                  shape: node.data.model.style?.shape,
                })
              ) {
                editingRevisionRef.current += 1;
                setEditing(null);
                setDetailsTarget(null);
                return;
              }
            }
            if (
              isLibraryKind(kind) ||
              kind === "literature" ||
              kind === "quote"
            ) {
              openNode(node);
              return;
            }
            startEdit(node.id);
          }}
          onEdgeClick={(event, edge) => {
            if (!eraser) return;
            event.preventDefault();
            eraseEdge(edge.id);
          }}
          onEdgeDoubleClick={(event, edge) => {
            if (eraser || activeTool !== "select") return;
            event.preventDefault();
            startEdgeEdit(edge.id);
          }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            openContextMenu(event, node.id);
          }}
          onPaneClick={(event) => {
            setMenu(null);
            setDetailsTarget(null);
            if (eraser) {
              setActiveTool("select");
              return;
            }
            if (isDrawTool(activeTool) || drawRef.current) return;
            if (!isStampTool(activeTool) && activeTool !== "literature") return;
            const position = flowRef.current?.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            });
            addNode(activeTool, position);
          }}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            if (activeTool !== "select") return;
            openContextMenu(
              event,
              "",
              flowRef.current?.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
              }),
            );
          }}
          onNodeDragStart={beginNodeDrag}
          onNodeDragStop={finishNodeDrag}
          onMoveEnd={(_, viewport) => {
            const previous = viewportRef.current;
            if (
              previous.x === viewport.x &&
              previous.y === viewport.y &&
              previous.zoom === viewport.zoom
            ) {
              return;
            }
            viewportRef.current = viewport;
            requestVisibleSources();
            bump();
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
          <ViewportPortal>
            {editing && editingNode && editingTextStyle ? (
              <div
                className={`zmd-board-editor is-in-shape nodrag nopan nowheel${editingStroke ? " is-stroke-label" : ""}`}
                data-kind={editingNode.type}
                data-shape={editingNode.data.model.style?.shape}
                style={{
                  borderWidth:
                    editingNode.type === "note" || editingNode.type === "text"
                      ? (editingNode.data.model.style?.strokeWidth ??
                        editingSurfaceDefaults?.strokeWidth ??
                        1)
                      : undefined,
                  left: editingNode.position.x,
                  top: editingNode.position.y,
                  width: nodeSize(editingNode).width,
                  height: nodeSize(editingNode).height,
                  borderRadius:
                    editingNode.type === "ellipse"
                      ? 999
                      : (editingNode.data.model.style?.radius ??
                        editingSurfaceDefaults?.radius ??
                        8),
                  ...verticalAlignmentStyle(editingTextStyle),
                  ...(editingStrokeCenter
                    ? {
                        left: editingNode.position.x + editingStrokeCenter.x,
                        top: editingNode.position.y + editingStrokeCenter.y,
                        width: "max-content",
                        height: "auto",
                        borderRadius: 8,
                      }
                    : {}),
                }}
              >
                <div className="zmd-board-edit-content">
                  {editingNode.type === "text" || editingStroke ? (
                    <span
                      className="zmd-board-edit-measure"
                      aria-hidden="true"
                      style={labelTextStyle(editingTextStyle)}
                    >
                      {editing.value + "\u200b"}
                    </span>
                  ) : null}
                  <textarea
                    cols={editingStroke ? 1 : undefined}
                    ref={(element) => {
                      editingTextareaRef.current = element;
                      if (
                        element &&
                        (editingNode.type === "note" ||
                          editingNode.data.model.style?.shape === "diamond")
                      ) {
                        element.style.height = "0px";
                        element.style.height = `${element.scrollHeight}px`;
                      }
                    }}
                    rows={
                      editingNode.type === "text" || editingStroke
                        ? 1
                        : undefined
                    }
                    autoFocus
                    aria-label={
                      editingNode.type === "note"
                        ? labels.editNoteBody
                        : labels.editText
                    }
                    placeholder={
                      editingNode.data.model.kind === "note"
                        ? noteTypePrompt(
                            labels,
                            getNoteType(editingNode.data.model),
                          )
                        : undefined
                    }
                    className="zmd-board-in-shape-edit"
                    value={editing.value}
                    style={{
                      ...labelTextStyle(editingTextStyle),
                      ...(editingNode.data.model.style?.shape === "diamond"
                        ? { width: "54%" }
                        : {}),
                      lineHeight: editingNode.type === "note" ? 1.45 : 1.25,
                    }}
                    onChange={(event) => {
                      editingRevisionRef.current += 1;
                      setEditing({
                        nodeId: editing.nodeId,
                        value: event.target.value,
                      });
                    }}
                    onPaste={(event) => {
                      const item = Array.from(
                        event.clipboardData.items ?? [],
                      ).find((candidate) =>
                        candidate.type.startsWith("image/"),
                      );
                      const file = item?.getAsFile();
                      if (!file) return;
                      event.preventDefault();
                      void addImagesToEditing([file], editing.nodeId);
                    }}
                    onBlur={() => {
                      handleEditBlur(holdEditFocusRef, commitEdit);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.nativeEvent.isComposing ||
                        event.keyCode === 229
                      )
                        return;
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key.toLowerCase() === "b"
                      ) {
                        event.preventDefault();
                        updateNode(editing.nodeId, (current) =>
                          toggleEditingBold(current, editing.value),
                        );
                        return;
                      }
                      if (
                        event.key === "Enter" &&
                        (editingNode.type === "note"
                          ? event.metaKey || event.ctrlKey
                          : !event.shiftKey)
                      ) {
                        event.preventDefault();
                        commitEdit();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                  />
                  {editingNode.type === "note" ||
                  editingNode.type === "text" ? (
                    <button
                      type="button"
                      className="zmd-board-edit-file"
                      aria-label={labels.addFile}
                      title={labels.addFile}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        armEditFocusHold(holdEditFocusRef);
                        openFilePicker("markdown");
                      }}
                    >
                      {labels.addFile}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </ViewportPortal>
        </ReactFlow>
        {menu ? (
          <div
            className="zmd-board-context-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            aria-label={labels.more}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setMenu(null);
            }}
          >
            {menuNode ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    startEdit(menuNode.id);
                  }}
                >
                  <IconEdit />
                  <span>{labels.editText}</span>
                </button>
                {hasOpenTarget(menuNode) && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      openNode(menuNode);
                    }}
                  >
                    <IconOpen />
                    <span>
                      {embeddedFileInfo(menuNode.data.model)
                        ? fileLabel(labels, "fileOpen", "Open file")
                        : sourceDescriptor(menuNode.data.model)
                          ? labels.openSource
                          : labels.openItem}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    copyNode(menuNode.id);
                  }}
                >
                  <IconCopy />
                  <span>{labels.copy}</span>
                </button>
                {selectedNodes.some(
                  (node) => node.data.model.kind !== "frame",
                ) ? (
                  <button type="button" onClick={groupSelection}>
                    <IconCopy />
                    <span>{labels.groupSelection}</span>
                  </button>
                ) : null}
                {"frameId" in menuNode.data.model &&
                menuNode.data.model.frameId ? (
                  <button
                    type="button"
                    onClick={() => removeFromGroup(menuNode.id)}
                  >
                    <IconOpen />
                    <span>{labels.removeFromGroup}</span>
                  </button>
                ) : null}
                <button type="button" onClick={() => deleteNode(menuNode.id)}>
                  <IconTrash />
                  <span>{labels.delete}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const position = menu.flowPosition;
                    setMenu(null);
                    addNode("note", position);
                  }}
                >
                  <IconEdit />
                  <span>{labels.addNote}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const position = menu.flowPosition;
                    setMenu(null);
                    openFilePicker("attachment", position);
                  }}
                >
                  <IconOpen />
                  <span>{labels.addFile}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const position = menu.flowPosition;
                    setMenu(null);
                    addNode("literature", position);
                  }}
                >
                  <IconOpen />
                  <span>{labels.kindLiterature}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const position = menu.flowPosition;
                    setMenu(null);
                    addNode("frame", position);
                  }}
                >
                  <IconCopy />
                  <span>{labels.addFrame}</span>
                </button>
                {([1, 2, 4] as const).map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    disabled={exportStatus === "busy"}
                    onClick={() => exportAs("png", scale)}
                  >
                    <IconExport />
                    <span>
                      {labels.exportPng} · {scale}×
                    </span>
                  </button>
                ))}
                <button type="button" onClick={() => exportAs("svg")}>
                  <IconExport />
                  <span>{labels.exportSvg}</span>
                </button>
                <button type="button" onClick={() => exportAs("md")}>
                  <IconExport />
                  <span>{labels.exportMarkdown}</span>
                </button>
              </>
            )}
          </div>
        ) : null}
        {editing && editingNode && editingScreen ? (
          <TextStyleBar
            node={editingNode}
            labels={labels}
            theme={theme}
            left={
              editingScreen.x +
              (nodeSize(editingNode).width * (viewportRef.current.zoom || 1)) /
                2 -
              280
            }
            top={Math.max(8, editingScreen.y - 56)}
            anchor={{
              x: editingScreen.x,
              y: editingScreen.y,
              width: nodeSize(editingNode).width * zoom,
              height: nodeSize(editingNode).height * zoom,
            }}
            onHoldFocus={() => {
              armEditFocusHold(holdEditFocusRef);
            }}
            onChange={(patch) => {
              updateNode(editing.nodeId, (current) =>
                mergeEditingStyle(current, editing.value, patch),
              );
            }}
          />
        ) : null}
        {editingEdge && edgeToolbarAnchor ? (
          <ConnectionEditor
            key={editingEdge.edgeId}
            labels={labels}
            value={editingEdge.value}
            left={edgeToolbarAnchor.x}
            top={edgeToolbarAnchor.y}
            zoom={zoom}
            textStyle={anchoredEdge?.data?.connection.textStyle}
            onHeightChange={setEdgeEditorHeight}
            onCommit={commitEdgeEdit}
            onCancel={cancelEdgeEdit}
          />
        ) : null}
        {editingEdge && anchoredEdge && edgeToolbarAnchor ? (
          <TextStyleBar
            textStyle={{
              fontSize: 12,
              ...anchoredEdge.data?.connection.textStyle,
            }}
            labels={labels}
            theme={theme}
            left={edgeToolbarAnchor.x}
            top={edgeToolbarAnchor.y - 56}
            anchor={{
              ...edgeToolbarAnchor,
              y: edgeToolbarAnchor.y - (edgeEditorHeight * zoom) / 2,
            }}
            onChange={(patch) => {
              pushHistory();
              setEdges((current) =>
                current.map((edge) =>
                  edge.id === editingEdge.edgeId && edge.data
                    ? {
                        ...edge,
                        data: {
                          ...edge.data,
                          connection: {
                            ...edge.data.connection,
                            textStyle: {
                              ...edge.data.connection.textStyle,
                              ...patch,
                            },
                          },
                        },
                      }
                    : edge,
                ),
              );
              bump();
            }}
          />
        ) : null}
        {toolbarNode && toolbarScreen ? (
          <StyleBar
            key={toolbarNode.id}
            node={toolbarNode}
            labels={labels}
            theme={theme}
            left={
              toolbarScreen.x + (nodeSize(toolbarNode).width * zoom) / 2 - 280
            }
            top={Math.max(8, toolbarScreen.y - 56)}
            anchor={{
              x: toolbarScreen.x,
              y: toolbarScreen.y,
              width: nodeSize(toolbarNode).width * zoom,
              height: nodeSize(toolbarNode).height * zoom,
            }}
            onEdit={() => startEdit(toolbarNode.id)}
            onToggleDetails={() => {
              setDetailsTarget((current) =>
                current === toolbarNode.id ? null : toolbarNode.id,
              );
              setMenu(null);
            }}
            detailsOpen={propertyNode?.id === toolbarNode.id}
            detailsButtonRef={detailsButtonRef}
            onChange={(patch) => {
              const { width, height, x, y, ...style } = patch;
              if (x !== undefined || y !== undefined) {
                pushHistory();
                applyNodePositions([
                  {
                    ...toolbarNode,
                    position: {
                      x: x ?? toolbarNode.position.x,
                      y: y ?? toolbarNode.position.y,
                    },
                  },
                ]);
                bump();
                return;
              }
              updateNode(toolbarNode.id, (current) => {
                const next = updateFlowNodeModel(current, (model) => ({
                  ...model,
                  style: { ...(model.style ?? {}), ...style },
                }));
                return {
                  ...next,
                  width: width ?? current.width,
                  height: height ?? current.height,
                  style: {
                    width: width ?? nodeSize(current).width,
                    height: height ?? nodeSize(current).height,
                  },
                };
              });
            }}
          />
        ) : null}
        {toolbarEdge && edgeToolbarAnchor ? (
          <EdgeStyleBar
            key={toolbarEdge.id}
            edge={toolbarEdge}
            labels={labels}
            theme={theme}
            anchor={edgeToolbarAnchor}
            onChange={(patch) => changeEdgeStyle(toolbarEdge.id, patch)}
            onEdit={() => startEdgeEdit(toolbarEdge.id)}
          />
        ) : null}
        {helpOpen ? (
          <ShortcutsOverlay
            labels={labels}
            onClose={() => setHelpOpen(false)}
          />
        ) : null}
      </div>
    </WhiteboardLabelsProvider>
  );
}
