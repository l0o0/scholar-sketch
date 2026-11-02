import { canvasNodeUiSurfaceDefaults } from "../model/academic";
import { NoteTypeIcon } from "../whiteboard/icons";
import { noteTypePrompt } from "./labels";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { WhiteboardLabels, WhiteboardTheme } from "../model/protocol";
import type { NoteTemplate } from "../model/note-template";
import {
  IconAlignBottom,
  IconAlignHCenter,
  IconAlignLeft,
  IconAlignRight,
  IconAlignTop,
  IconAlignVCenter,
  IconArrow,
  IconCheck,
  IconChevronDown,
  IconDiamond,
  IconDistributeH,
  IconDistributeV,
  IconEllipse,
  IconEraser,
  IconFile,
  IconFitView,
  IconFrame,
  IconGroup,
  IconHand,
  IconZotero,
  IconLayout,
  IconLine,
  IconMore,
  IconOpen,
  IconRect,
  IconRoundedRect,
  IconRedo,
  IconSave,
  IconExport,
  IconSelect,
  IconText,
  IconUndo,
} from "../whiteboard/icons";
import type { CanvasTool } from "./tools";
import { SidebarToolbar, type SidebarAction } from "./SidebarToolbar";

type ToolbarLabel =
  | "drawTools"
  | "groupSelection"
  | "fitSelection"
  | "addRoundedRect"
  | "addDiamond";

function toolbarLabel(
  labels: WhiteboardLabels,
  key: ToolbarLabel,
  fallback: string,
): string {
  return (
    (labels as WhiteboardLabels & Partial<Record<ToolbarLabel, string>>)[key] ??
    fallback
  );
}

interface ToolButton<T extends string = CanvasTool> {
  tool: T;
  title: string;
  icon: ReactElement;
}

export interface TopIslandProps {
  sidebar?: boolean;
  sidebarFocused?: boolean;
  onOpenTab?: () => void;
  onToggleSidebarFocus?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  editable?: boolean;
  labels: WhiteboardLabels;
  theme?: WhiteboardTheme;
  activeTool: CanvasTool;
  onSelectTool: (tool: CanvasTool) => void;
  noteTemplates: NoteTemplate[];
  activeNoteTemplateId: string;
  onSelectNoteTemplate: (templateId: string) => void;
  saveState: "saved" | "saving" | "error";
  selectedNodeCount: number;
  selectedEdgeCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onAddFile: () => void;
  onHoldEditFocus?: () => void;
  onSave: () => void;
  onSwitchWindow?: () => void;
  onOpenSettings?: () => void;
  onExportPng?: () => void;
  onExportSvg?: () => void;
  onExportMarkdown?: () => void;
  onGroupSelection?: () => void;
  onFitSelection?: () => void;
  exportBusy?: boolean;
  onFitView: () => void;
  onAutoLayout: () => void;
  onDuplicate?: () => void;
  onSearch?: () => void;
  onAlign: (
    mode: "left" | "right" | "top" | "bottom" | "horizontal" | "vertical",
  ) => void;
  onDistribute: (direction: "horizontal" | "vertical") => void;
  onOpenShortcuts: () => void;
}

export function TopIsland(props: TopIslandProps) {
  const { labels, activeTool, onSelectTool } = props;
  const [openMenu, setOpenMenu] = useState<
    "templates" | "draw" | "more" | null
  >(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const templateTriggerRef = useRef<HTMLButtonElement>(null);
  const drawTriggerRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const closeMoreMenu = () => {
    setOpenMenu(null);
    if (props.sidebar) moreTriggerRef.current?.focus();
  };

  useEffect(() => {
    if (!openMenu) return;
    if (props.sidebar) {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(
          '[role="menu"] button:not(:disabled)',
        )
        ?.focus();
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const trigger =
          openMenu === "templates"
            ? templateTriggerRef.current
            : openMenu === "draw"
              ? drawTriggerRef.current
              : moreTriggerRef.current;
        if (props.sidebar) {
          event.preventDefault();
          event.stopPropagation();
        }
        setOpenMenu(null);
        (trigger ?? moreTriggerRef.current)?.focus();
        return;
      }
      if (event.key === "Tab" && props.sidebar) {
        if (
          menuRef.current
            ?.querySelector('[role="menu"]')
            ?.contains(event.target as Node)
        ) {
          const trigger =
            openMenu === "templates"
              ? templateTriggerRef.current
              : openMenu === "draw"
                ? drawTriggerRef.current
                : moreTriggerRef.current;
          (trigger ?? moreTriggerRef.current)?.focus();
        }
        setOpenMenu(null);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }
      const menu = menuRef.current?.querySelector<HTMLElement>(
        openMenu === "templates"
          ? ".zmd-board-template-menu"
          : openMenu === "draw"
            ? ".zmd-board-draw-menu"
            : ".zmd-board-more-menu",
      );
      const trigger =
        openMenu === "templates"
          ? templateTriggerRef.current
          : openMenu === "draw"
            ? drawTriggerRef.current
            : moreTriggerRef.current;
      const target = event.target;
      if (
        !(target instanceof Node) ||
        (!menu?.contains(target) && !trigger?.contains(target))
      ) {
        return;
      }
      const items = Array.from(
        menu?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"], [role="menuitemradio"]',
        ) ?? [],
      ).filter((item) => !item.disabled);
      if (!items.length) return;
      const current = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : current < 0
              ? event.key === "ArrowUp"
                ? items.length - 1
                : 0
              : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
                items.length;
      event.preventDefault();
      event.stopPropagation();
      items[next]?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openMenu, props.sidebar]);
  const activeNoteTemplate =
    props.noteTemplates.find(
      (template) => template.id === props.activeNoteTemplateId,
    ) ?? props.noteTemplates[0];
  const groups: ToolButton<CanvasTool | "file">[][] = [
    [
      { tool: "select", title: labels.select, icon: <IconSelect /> },
      { tool: "hand", title: labels.hand, icon: <IconHand /> },
    ],
    [{ tool: "literature", title: labels.addItem, icon: <IconZotero /> }],
    [{ tool: "file", title: labels.addFile, icon: <IconFile /> }],
    [
      {
        tool: "frame",
        title: `${labels.addFrame} (F)`,
        icon: <IconFrame />,
      },
    ],
    [{ tool: "text", title: `${labels.addText} (T)`, icon: <IconText /> }],
  ];
  const drawTools: ToolButton[] = [
    { tool: "rect", title: `${labels.addRect} (R)`, icon: <IconRect /> },
    {
      tool: "roundedRect",
      title: `${toolbarLabel(labels, "addRoundedRect", "Rounded rectangle")}`,
      icon: <IconRoundedRect />,
    },
    {
      tool: "ellipse",
      title: `${labels.addEllipse} (O)`,
      icon: <IconEllipse />,
    },
    {
      tool: "diamond",
      title: toolbarLabel(labels, "addDiamond", "Diamond"),
      icon: <IconDiamond />,
    },
    { tool: "arrow", title: `${labels.addArrow} (A)`, icon: <IconArrow /> },
    { tool: "line", title: `${labels.addLine} (L)`, icon: <IconLine /> },
    { tool: "eraser", title: `${labels.eraser} (E)`, icon: <IconEraser /> },
  ];
  const drawToolsOpen = openMenu === "draw";
  const hasSelectionActions =
    (props.selectedNodeCount >= 2 && !!props.onGroupSelection) ||
    (props.selectedNodeCount >= 1 && !!props.onFitSelection);

  const templateMenu =
    openMenu === "templates" ? (
      <div
        className="zmd-board-template-menu"
        role="menu"
        aria-label={labels.addNote}
      >
        {props.noteTemplates.map((template) => {
          const active = template.id === props.activeNoteTemplateId;
          const surface = {
            ...canvasNodeUiSurfaceDefaults(
              "note",
              props.theme ?? "light",
              template.noteType,
            ),
            ...template.style,
          };
          return (
            <button
              key={template.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              disabled={props.sidebar && props.editable === false}
              onClick={() => {
                props.onSelectNoteTemplate(template.id);
                props.onSelectTool("note");
                setOpenMenu(null);
                (templateTriggerRef.current ?? moreTriggerRef.current)?.focus();
              }}
            >
              {template.noteType ? (
                <span
                  className="zmd-board-template-preview"
                  style={{
                    background: surface.fill,
                    borderColor: surface.stroke,
                    borderRadius: surface.radius / 2,
                    borderStyle: template.style.dashed
                      ? "dashed"
                      : surface.strokeStyle,
                    borderWidth: surface.strokeWidth,
                  }}
                >
                  <NoteTypeIcon type={template.noteType} />
                </span>
              ) : null}
              <span className="zmd-board-template-option">
                <span>{template.name}</span>
                {template.noteType ? (
                  <small>{noteTypePrompt(labels, template.noteType)}</small>
                ) : null}
              </span>
              {active ? <IconCheck /> : null}
            </button>
          );
        })}
      </div>
    ) : null;
  const drawMenu = drawToolsOpen ? (
    <div className="zmd-board-draw-menu" role="menu">
      {drawTools
        .filter((item) => !props.sidebar || item.tool !== "arrow")
        .map((item) => (
          <button
            key={item.tool}
            type="button"
            role="menuitemradio"
            aria-label={item.title}
            aria-checked={activeTool === item.tool}
            disabled={props.sidebar && props.editable === false}
            className={activeTool === item.tool ? "is-active" : ""}
            onClick={() => {
              setOpenMenu(null);
              onSelectTool(item.tool);
              (drawTriggerRef.current ?? moreTriggerRef.current)?.focus();
            }}
          >
            {item.icon}
            <span>{item.title}</span>
          </button>
        ))}
    </div>
  ) : null;
  const moreMenuContent = (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          closeMoreMenu();
          props.onSearch?.();
        }}
      >
        {labels.searchCanvas ?? "Search canvas"} · Ctrl/⌘ F
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={
          !props.selectedNodeCount ||
          (props.sidebar && props.editable === false)
        }
        onClick={() => {
          closeMoreMenu();
          props.onDuplicate?.();
        }}
      >
        {labels.duplicateSelection ?? "Duplicate selection"}
      </button>
      {props.selectedNodeCount >= 2 &&
      (!props.sidebar || props.editable !== false) ? (
        <div className="zmd-board-menu-section" role="group">
          <span className="zmd-board-menu-section-label">
            {labels.alignment}
          </span>
          <button
            type="button"
            role="menuitem"
            title={labels.alignLeft}
            onClick={() => props.onAlign("left")}
          >
            <IconAlignLeft />
            <span>{labels.alignLeft}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            title={labels.alignRight}
            onClick={() => props.onAlign("right")}
          >
            <IconAlignRight />
            <span>{labels.alignRight}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            title={labels.alignTop}
            onClick={() => props.onAlign("top")}
          >
            <IconAlignTop />
            <span>{labels.alignTop}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            title={labels.alignBottom}
            onClick={() => props.onAlign("bottom")}
          >
            <IconAlignBottom />
            <span>{labels.alignBottom}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            title={labels.alignHorizontal}
            onClick={() => props.onAlign("horizontal")}
          >
            <IconAlignHCenter />
            <span>{labels.alignHorizontal}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            title={labels.alignVertical}
            onClick={() => props.onAlign("vertical")}
          >
            <IconAlignVCenter />
            <span>{labels.alignVertical}</span>
          </button>
          {props.selectedNodeCount >= 3 ? (
            <>
              <button
                type="button"
                role="menuitem"
                title={labels.distributeHorizontal}
                onClick={() => props.onDistribute("horizontal")}
              >
                <IconDistributeH />
                <span>{labels.distributeHorizontal}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                title={labels.distributeVertical}
                onClick={() => props.onDistribute("vertical")}
              >
                <IconDistributeV />
                <span>{labels.distributeVertical}</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        role="menuitem"
        disabled={props.sidebar && props.editable === false}
        onClick={() => {
          closeMoreMenu();
          props.onSave();
        }}
      >
        <IconSave />
        <span>{labels.save}</span>
      </button>
      {props.onExportPng ? (
        <button
          type="button"
          role="menuitem"
          disabled={props.exportBusy}
          onClick={() => {
            closeMoreMenu();
            props.onExportPng?.();
          }}
        >
          <IconExport />
          <span>{labels.exportPng} · 2×</span>
        </button>
      ) : null}
      {props.onExportSvg ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeMoreMenu();
            props.onExportSvg?.();
          }}
        >
          <IconExport />
          <span>{labels.exportSvg}</span>
        </button>
      ) : null}
      {props.onExportMarkdown ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeMoreMenu();
            props.onExportMarkdown?.();
          }}
        >
          <IconExport />
          <span>{labels.exportMarkdown}</span>
        </button>
      ) : null}
      {!props.sidebar ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeMoreMenu();
            props.onFitView();
          }}
        >
          <IconFitView />
          <span>{labels.fitView}</span>
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        disabled={props.sidebar && props.editable === false}
        onClick={() => {
          closeMoreMenu();
          props.onAutoLayout();
        }}
      >
        <IconLayout />
        <span>{labels.autoLayout}</span>
      </button>
      {props.onSwitchWindow ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeMoreMenu();
            props.onSwitchWindow?.();
          }}
        >
          {labels.switchWindow}
        </button>
      ) : null}
      {props.onOpenSettings ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeMoreMenu();
            props.onOpenSettings?.();
          }}
        >
          {labels.settings}
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          closeMoreMenu();
          props.onOpenShortcuts();
        }}
      >
        {labels.shortcutsTitle}
      </button>

      {props.sidebar && props.onToggleSidebarFocus ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeMoreMenu();
            props.onToggleSidebarFocus?.();
          }}
        >
          {props.sidebarFocused
            ? (labels.sidebarExitFocus ?? "Exit sidebar focus")
            : (labels.sidebarFocus ?? "Focus sidebar")}
        </button>
      ) : null}
    </>
  );

  if (props.sidebar) {
    const editable = props.editable !== false;
    const toolAction = (
      tool: CanvasTool,
      label: string,
      icon: ReactElement,
      priority: number,
    ): SidebarAction => ({
      id: tool,
      label,
      icon,
      priority,
      selected: activeTool === tool,
      disabled: tool !== "select" && tool !== "hand" && !editable,
      holdEditFocus: tool === "literature" ? props.onHoldEditFocus : undefined,
      run: () => {
        setOpenMenu(null);
        onSelectTool(tool);
      },
    });
    const actions: SidebarAction[] = [
      toolAction("select", labels.select, <IconSelect />, 0),
      toolAction("hand", labels.hand, <IconHand />, 1),
      {
        id: "templates",
        label: labels.addNote,
        icon: <NoteTypeIcon type={activeNoteTemplate?.noteType ?? "note"} />,
        priority: 4,
        selected: activeTool === "note",
        disabled: !editable,
        menu: "templates",
        triggerRef: templateTriggerRef,
        run: () =>
          setOpenMenu((current) =>
            current === "templates" ? null : "templates",
          ),
      },
      toolAction("arrow", `${labels.addArrow} (A)`, <IconArrow />, 5),
      toolAction("text", `${labels.addText} (T)`, <IconText />, 6),
      toolAction("literature", labels.addItem, <IconZotero />, 8),
      {
        id: "file",
        label: labels.addFile,
        icon: <IconFile />,
        priority: 9,
        disabled: !editable,
        holdEditFocus: props.onHoldEditFocus,
        run: () => {
          setOpenMenu(null);
          props.onAddFile();
        },
      },
      {
        id: "draw",
        label: toolbarLabel(labels, "drawTools", labels.more),
        icon: drawTools.find(
          (item) => item.tool !== "arrow" && item.tool === activeTool,
        )?.icon ?? <IconRect />,
        priority: 10,
        selected: drawTools.some(
          (item) => item.tool !== "arrow" && item.tool === activeTool,
        ),
        disabled: !editable,
        menu: "draw",
        triggerRef: drawTriggerRef,
        run: () =>
          setOpenMenu((current) => (current === "draw" ? null : "draw")),
      },
      {
        id: "undo",
        label: labels.undo,
        icon: <IconUndo />,
        priority: 11,
        group: "history",
        disabled: !editable || props.canUndo === false,
        run: props.onUndo,
      },
      {
        id: "redo",
        label: labels.redo,
        icon: <IconRedo />,
        priority: 11,
        group: "history",
        disabled: !editable || props.canRedo === false,
        run: props.onRedo,
      },
      {
        id: "fit",
        label: labels.fitView,
        icon: <IconFitView />,
        priority: 2,
        run: props.onFitView,
      },
      ...(props.onOpenTab
        ? [
            {
              id: "open-tab",
              label: labels.openTab ?? "Open in tab",
              icon: <IconOpen />,
              priority: 3,
              run: props.onOpenTab,
            },
          ]
        : []),
    ];
    const extraActions = (
      <>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={activeTool === "frame"}
          disabled={!editable}
          onClick={() => {
            closeMoreMenu();
            onSelectTool("frame");
          }}
        >
          <IconFrame />
          <span>{labels.addFrame} (F)</span>
        </button>
        {props.selectedNodeCount >= 2 && props.onGroupSelection ? (
          <button
            type="button"
            role="menuitem"
            disabled={!editable}
            onClick={() => {
              closeMoreMenu();
              props.onGroupSelection?.();
            }}
          >
            <IconGroup />
            <span>
              {toolbarLabel(labels, "groupSelection", labels.addFrame)}
            </span>
          </button>
        ) : null}
        {props.selectedNodeCount >= 1 && props.onFitSelection ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMoreMenu();
              props.onFitSelection?.();
            }}
          >
            <IconFitView />
            <span>{toolbarLabel(labels, "fitSelection", labels.fitView)}</span>
          </button>
        ) : null}
        {moreMenuContent}
      </>
    );
    return (
      <div
        ref={menuRef}
        className="zmd-board-toolbars zmd-board-sidebar-toolbars"
      >
        <SidebarToolbar
          actions={actions}
          label={labels.canvas}
          moreLabel={labels.more}
          openMenu={openMenu}
          onMenuChange={setOpenMenu}
          moreTriggerRef={moreTriggerRef}
          templateMenu={templateMenu}
          drawMenu={drawMenu}
          moreContent={extraActions}
        />
      </div>
    );
  }

  return (
    <div ref={menuRef} className="zmd-board-toolbars">
      <div
        className="zmd-board-top-island"
        role="toolbar"
        aria-label={labels.canvas}
      >
        {groups.map((group, index) => (
          <div key={index} className="zmd-board-top-group">
            {group.map((item) => (
              <button
                key={item.tool}
                type="button"
                title={item.title}
                aria-label={item.title}
                aria-pressed={
                  item.tool === "file" ? undefined : activeTool === item.tool
                }
                className={activeTool === item.tool ? "is-active" : ""}
                onPointerDown={(event) => {
                  if (item.tool === "file" || item.tool === "literature") {
                    props.onHoldEditFocus?.();
                    event.preventDefault();
                  }
                }}
                onClick={() => {
                  setOpenMenu(null);
                  if (item.tool === "file") props.onAddFile();
                  else onSelectTool(item.tool);
                }}
              >
                {item.icon}
              </button>
            ))}
            {group.some((item) => item.tool === "file") ? (
              <div className="zmd-board-template">
                <button
                  ref={templateTriggerRef}
                  type="button"
                  className={`zmd-board-template-trigger${activeTool === "note" ? " is-active" : ""}`}
                  title={labels.addNote}
                  aria-label={labels.addNote}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === "templates"}
                  onClick={() =>
                    setOpenMenu((current) =>
                      current === "templates" ? null : "templates",
                    )
                  }
                >
                  <NoteTypeIcon type={activeNoteTemplate?.noteType ?? "note"} />
                  <span>{activeNoteTemplate?.name ?? labels.addNote}</span>
                  <IconChevronDown />
                </button>
                {templateMenu}
              </div>
            ) : null}
          </div>
        ))}
        <div className="zmd-board-draw-tools">
          <button
            ref={drawTriggerRef}
            type="button"
            title={toolbarLabel(labels, "drawTools", labels.more)}
            aria-label={toolbarLabel(labels, "drawTools", labels.more)}
            aria-haspopup="menu"
            aria-expanded={drawToolsOpen}
            aria-pressed={drawTools.some((item) => item.tool === activeTool)}
            className={
              drawToolsOpen ||
              drawTools.some((item) => item.tool === activeTool)
                ? "is-active"
                : ""
            }
            onClick={() =>
              setOpenMenu((current) => (current === "draw" ? null : "draw"))
            }
          >
            {drawTools.find((item) => item.tool === activeTool)?.icon ?? (
              <IconRect />
            )}
            <IconChevronDown />
          </button>
          {drawMenu}
        </div>
        {hasSelectionActions ? (
          <div className="zmd-board-top-group zmd-board-selection-tools">
            {props.selectedNodeCount >= 2 && props.onGroupSelection ? (
              <button
                type="button"
                title={toolbarLabel(labels, "groupSelection", labels.addFrame)}
                aria-label={toolbarLabel(
                  labels,
                  "groupSelection",
                  labels.addFrame,
                )}
                onClick={props.onGroupSelection}
              >
                <IconGroup />
              </button>
            ) : null}
            {props.onFitSelection ? (
              <button
                type="button"
                title={toolbarLabel(labels, "fitSelection", labels.fitView)}
                aria-label={toolbarLabel(
                  labels,
                  "fitSelection",
                  labels.fitView,
                )}
                onClick={props.onFitSelection}
              >
                <IconFitView />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="zmd-board-top-group zmd-board-history-tools">
          <button type="button" title={labels.undo} onClick={props.onUndo}>
            <IconUndo />
          </button>
          <button type="button" title={labels.redo} onClick={props.onRedo}>
            <IconRedo />
          </button>
        </div>
        <div className="zmd-board-more">
          <button
            ref={moreTriggerRef}
            type="button"
            title={labels.more}
            aria-label={labels.more}
            aria-haspopup="menu"
            aria-expanded={openMenu === "more"}
            className={openMenu === "more" ? "is-active" : ""}
            onClick={() =>
              setOpenMenu((current) => (current === "more" ? null : "more"))
            }
          >
            <IconMore />
          </button>
          {openMenu === "more" ? (
            <div className="zmd-board-more-menu" role="menu">
              {moreMenuContent}
            </div>
          ) : null}
        </div>
        <span className={`zmd-board-save-state is-${props.saveState}`}>
          {props.saveState === "saving"
            ? labels.saving
            : props.saveState === "error"
              ? labels.saveFailed
              : labels.saved}
        </span>
      </div>
    </div>
  );
}
