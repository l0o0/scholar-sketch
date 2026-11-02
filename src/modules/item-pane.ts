import { getLocaleID } from "../utils/locale";
import { isMarkdownAttachment } from "./markdown/detect";
import { createMarkdownSidebar } from "./markdown/sidebar";
import { SidebarControllerRegistry } from "./markdown/sidebar-state";
import { isWhiteboardAttachment } from "./whiteboard/detect";
import { WhiteboardSidebar } from "./whiteboard/sidebar";

type ViewKind = "markdown" | "whiteboard";
type SidebarView = ReturnType<typeof createMarkdownSidebar>;
type CollapsibleSection = HTMLElement & { open: boolean; collapsible: boolean };

function viewForItem(item: Zotero.Item | null): ViewKind | undefined {
  if (item && isMarkdownAttachment(item)) return "markdown";
  if (item && isWhiteboardAttachment(item)) return "whiteboard";
  return undefined;
}

const controllers = new SidebarControllerRegistry<
  Window,
  HTMLElement,
  ScholarSketchSidebar
>();
const closing = new Map<Promise<void>, Window>();
let sectionKey: string | null = null;

/** One native section; each view retains ownership of its own draft and save path. */
class ScholarSketchSidebar {
  private readonly views = new Map<
    ViewKind,
    { body: HTMLElement; controller: SidebarView }
  >();
  private active?: ViewKind;
  private section?: Element;
  private collapsible?: CollapsibleSection;
  private wasOpen = false;
  private wasCollapsible = true;
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
    this.item = item;
    this.editable = editable;
    this.summary = summary;
    this.active = viewForItem(item);
    this.renderActiveView();
  }

  private renderActiveView() {
    for (const [kind, view] of this.views) {
      view.controller.setActive(kind === this.active);
      view.body.hidden = kind !== this.active;
    }
    this.summary("");
    if (!this.active) {
      this.restoreNativeSection();
      return;
    }
    this.prepareNativeSection();
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
    const kind = this.active;
    const itemID = this.item?.id;
    view.controller.render(view.body, this.item, this.editable, (value) => {
      if (!this.disposed && this.active === kind && this.item?.id === itemID)
        this.summary(value);
    });
  }

  private prepareNativeSection() {
    if (this.section) return;
    const section = this.body.closest("item-pane-custom-section");
    if (!section) return;
    this.section = section;
    this.collapsible =
      section.querySelector<CollapsibleSection>("collapsible-section") ??
      undefined;
    if (this.collapsible) {
      this.wasOpen = this.collapsible.open;
      this.wasCollapsible = this.collapsible.collapsible;
      this.collapsible.open = true;
      this.collapsible.collapsible = false;
    }
    section.classList.add("scholar-sketch-attachment-section");
  }

  private restoreNativeSection() {
    this.section?.classList.remove("scholar-sketch-attachment-section");
    if (this.collapsible) {
      this.collapsible.open = this.wasOpen;
      this.collapsible.collapsible = this.wasCollapsible;
    }
    this.section = undefined;
    this.collapsible = undefined;
  }

  destroy(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.disposed = true;
    for (const { controller } of this.views.values())
      controller.setActive(false);
    this.restoreNativeSection();
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
    onItemChange: ({ body, item, setEnabled }) => {
      const enabled = !!viewForItem(item);
      if (!enabled) controllers.get(body)?.render(null, false, () => {});
      setEnabled(enabled);
    },
    onRender: ({ body, item, editable, setSectionSummary, setEnabled }) => {
      controllers.get(body)?.render(item, editable, setSectionSummary);
      setEnabled(!!viewForItem(item));
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
