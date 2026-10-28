import { getLocaleID, getString } from "../utils/locale";
import { isMarkdownAttachment } from "./markdown/detect";
import { createMarkdownSidebar } from "./markdown/sidebar";
import {
  childAttachmentIDs,
  SidebarControllerRegistry,
} from "./markdown/sidebar-state";
import { isWhiteboardAttachment } from "./whiteboard/detect";
import { WhiteboardSidebar } from "./whiteboard/sidebar";

type ViewKind = "markdown" | "whiteboard";
type SidebarView = ReturnType<typeof createMarkdownSidebar>;

const controllers = new SidebarControllerRegistry<
  Window,
  HTMLElement,
  ScholarSketchSidebar
>();
const closing = new Map<Promise<void>, Window>();
let sectionKey: string | null = null;

/** One native section; each view retains ownership of its own draft and save path. */
class ScholarSketchSidebar {
  private switcher?: HTMLElement;
  private readonly buttons = new Map<ViewKind, HTMLButtonElement>();
  private readonly views = new Map<
    ViewKind,
    { body: HTMLElement; controller: SidebarView }
  >();
  private active: ViewKind = "markdown";
  private item: Zotero.Item | null = null;
  private editable = false;
  private summary: (value: string) => void = () => {};
  private disposed = false;
  private closePromise?: Promise<void>;

  constructor(
    readonly win: _ZoteroTypes.MainWindow,
    readonly body: HTMLElement,
  ) {}

  render(
    item: Zotero.Item | null,
    editable: boolean,
    summary: (value: string) => void,
  ) {
    if (this.disposed) return;
    const changed = this.item?.id !== item?.id;
    this.item = item;
    this.editable = editable;
    this.summary = summary;
    if (!this.switcher) this.createSwitcher();
    const regular = !!item?.isRegularItem();
    const markdown = !!item && isMarkdownAttachment(item);
    const whiteboard = !!item && isWhiteboardAttachment(item);
    this.switcher!.hidden = !regular;
    if (markdown) this.active = "markdown";
    else if (whiteboard) this.active = "whiteboard";
    else if (changed && regular && item) {
      // A parent with only one supported attachment type opens that type.
      // Parents with both (or neither) keep this pane's previous choice.
      const attachments = childAttachmentIDs(item).map((id) =>
        Zotero.Items.get(id),
      );
      const hasMarkdown = attachments.some(isMarkdownAttachment);
      const hasWhiteboard = attachments.some(isWhiteboardAttachment);
      if (hasMarkdown !== hasWhiteboard)
        this.active = hasMarkdown ? "markdown" : "whiteboard";
    }
    this.renderActiveView();
  }

  private createSwitcher() {
    const doc = this.body.ownerDocument;
    this.switcher = doc.createElement("div");
    this.switcher.className = "scholar-sketch-pane-switcher";
    this.switcher.setAttribute("role", "tablist");
    this.switcher.setAttribute("aria-label", "Scholar Sketch");
    for (const kind of ["markdown", "whiteboard"] as const) {
      const button = doc.createElement("button");
      button.type = "button";
      button.dataset.view = kind;
      button.setAttribute("role", "tab");
      button.textContent = getString(`sidebar-view-${kind}`);
      button.addEventListener("click", () => this.selectView(kind));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        const next =
          event.key === "Home"
            ? "markdown"
            : event.key === "End"
              ? "whiteboard"
              : kind === "markdown"
                ? "whiteboard"
                : "markdown";
        this.selectView(next);
        this.buttons.get(next)!.focus();
      });
      this.buttons.set(kind, button);
      this.switcher.append(button);
    }
    this.body.append(this.switcher);
  }

  private selectView(kind: ViewKind) {
    if (this.disposed || this.active === kind) return;
    this.active = kind;
    this.renderActiveView();
  }

  private renderActiveView() {
    for (const [kind, view] of this.views) {
      view.controller.setActive(kind === this.active);
      view.body.hidden = kind !== this.active;
    }
    for (const [kind, button] of this.buttons) {
      button.setAttribute("aria-selected", String(kind === this.active));
      button.tabIndex = kind === this.active ? 0 : -1;
    }
    let view = this.views.get(this.active);
    if (!view) {
      const body = this.body.ownerDocument.createElement("div");
      body.className = "scholar-sketch-pane-view";
      body.dataset.view = this.active;
      this.body.append(body);
      const controller =
        this.active === "markdown"
          ? createMarkdownSidebar(this.win, body)
          : new WhiteboardSidebar(this.win);
      view = { body, controller };
      this.views.set(this.active, view);
    }
    this.summary("");
    const kind = this.active;
    const itemID = this.item?.id;
    view.controller.render(view.body, this.item, this.editable, (value) => {
      if (!this.disposed && this.active === kind && this.item?.id === itemID)
        this.summary(value);
    });
  }

  destroy(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.disposed = true;
    this.closePromise = (async () => {
      // Native onDestroy is synchronous; the owner tracks this work so window
      // and addon shutdown still wait for both views' final saves.
      const results = await Promise.allSettled(
        [...this.views.values()].map(({ controller }) => controller.destroy()),
      );
      this.views.clear();
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })();
    return this.closePromise;
  }
}

function closeController(controller: ScholarSketchSidebar): Promise<void> {
  const task = controller.destroy();
  closing.set(task, controller.win);
  void task.then(
    () => closing.delete(task),
    (error) => {
      closing.delete(task);
      ztoolkit.log("Scholar Sketch sidebar cleanup failed", error);
    },
  );
  return task;
}

export function registerItemPane() {
  if (sectionKey || !Zotero.ItemPaneManager?.registerSection) return;
  const icon = `chrome://${addon.data.config.addonRef}/content/icons/scholar-sketch-toolbar.svg`;
  const key = Zotero.ItemPaneManager.registerSection({
    paneID: "scholar-sketch",
    pluginID: addon.data.config.addonID,
    header: { icon, l10nID: getLocaleID("sidebar-section-label") },
    sidenav: { icon, l10nID: getLocaleID("sidebar-section-tooltip") },
    onInit: ({ doc, body }) => {
      const win = doc.defaultView as _ZoteroTypes.MainWindow | null;
      if (!win) return;
      const old = controllers.release(win, body);
      if (old) void closeController(old);
      controllers.bind(win, body, new ScholarSketchSidebar(win, body));
    },
    onRender: ({ body, item, editable, setSectionSummary }) => {
      controllers.get(body)?.render(item, editable, setSectionSummary);
    },
    onDestroy: ({ doc, body }) => {
      const controller = controllers.release(doc.defaultView!, body);
      if (controller) void closeController(controller);
    },
  });
  if (key !== false) sectionKey = key;
}

async function awaitClosing(tasks: Promise<void>[]) {
  const results = await Promise.allSettled(tasks);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

export async function disposeItemPaneForWindow(win: Window) {
  for (const controller of controllers.releaseWindow(win))
    void closeController(controller);
  await awaitClosing(
    [...closing].filter(([, owner]) => owner === win).map(([task]) => task),
  );
}

export async function unregisterItemPane() {
  for (const controller of controllers.all()) {
    controllers.release(controller.win, controller.body);
    void closeController(controller);
  }
  try {
    await awaitClosing([...closing.keys()]);
  } finally {
    if (sectionKey) Zotero.ItemPaneManager?.unregisterSection(sectionKey);
    sectionKey = null;
  }
}
