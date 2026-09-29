import { getLocaleID, getString } from "../../utils/locale";
import {
  SidebarControllerRegistry,
  childAttachmentIDs,
} from "../markdown/sidebar-state";
import { isWhiteboardAttachment } from "./detect";
import { createWhiteboardAttachment } from "./create";
import { whiteboardRegistry } from "./session-registry";
import {
  closeWhiteboardSession,
  openWhiteboardSidebar,
  openWhiteboardTab,
} from "./tab";

const controllers = new SidebarControllerRegistry<
  Window,
  HTMLElement,
  WhiteboardSidebar
>();
let sectionKey: string | null = null;

export class WhiteboardSidebar {
  private host?: HTMLElement;
  private select?: HTMLSelectElement;
  private message?: HTMLElement;
  private open?: HTMLButtonElement;
  private create?: HTMLButtonElement;
  private item?: Zotero.Item;
  private targetID?: number;
  private sessionID?: string;
  private editable = false;
  private disposed = false;
  private revision = 0;
  private pending: Promise<void> = Promise.resolve();

  constructor(private win: _ZoteroTypes.MainWindow) {}

  render(
    body: HTMLElement,
    item: Zotero.Item | null,
    editable: boolean,
    summary: (value: string) => void,
  ) {
    if (this.disposed) return;
    if (!this.host) {
      const doc = body.ownerDocument;
      const toolbar = doc.createElement("div");
      toolbar.style.cssText =
        "display:flex;gap:6px;align-items:center;margin-bottom:6px";
      this.select = doc.createElement("select");
      this.select.style.cssText = "flex:1;min-width:0";
      this.select.setAttribute("aria-label", getString("whiteboard-tab-title"));
      this.select.addEventListener("change", () => {
        this.targetID = Number(this.select!.value);
        this.schedule();
      });
      this.open = doc.createElement("button");
      this.open.textContent = "↗";
      this.open.title = getString("sidebar-open-tab");
      this.open.setAttribute("aria-label", this.open.title);
      this.open.addEventListener("click", () => {
        const target = this.targetID && Zotero.Items.get(this.targetID);
        if (target)
          void openWhiteboardTab(target, { win: this.win })
            .then(() => this.schedule())
            .catch((error) => this.report(error));
      });
      this.create = doc.createElement("button");
      this.create.textContent = "+";
      this.create.title = getString("whiteboard-create");
      this.create.setAttribute("aria-label", this.create.title);
      this.create.addEventListener("click", () => {
        const parent = this.item;
        if (!parent || !this.editable) return;
        this.create!.disabled = true;
        void createWhiteboardAttachment(parent, { select: false })
          .then((attachment) => {
            if (attachment && !this.disposed && this.item?.id === parent.id) {
              this.targetID = attachment.id;
              this.render(body, parent, this.editable, summary);
            }
          })
          .catch((error) => this.report(error))
          .finally(() => {
            if (this.create) this.create.disabled = !this.editable;
          });
      });
      toolbar.append(this.select, this.open, this.create);
      this.message = doc.createElement("div");
      this.message.style.cssText =
        "padding:8px;font-size:12px;color:var(--fill-secondary)";
      this.host = doc.createElement("div");
      this.host.style.cssText =
        "height:560px;min-height:320px;min-width:0;resize:vertical;overflow:hidden;display:flex";
      body.replaceChildren(toolbar, this.message, this.host);
    }
    const changed = this.item?.id !== item?.id;
    this.item = item ?? undefined;
    this.editable = editable;
    const attachments = !item
      ? []
      : isWhiteboardAttachment(item)
        ? [item]
        : childAttachmentIDs(item)
            .map((id) => Zotero.Items.get(id))
            .filter(
              (child): child is Zotero.Item =>
                !!child && isWhiteboardAttachment(child),
            );
    if (
      changed ||
      !attachments.some((attachment) => attachment.id === this.targetID)
    )
      this.targetID = attachments[0]?.id;
    this.select!.replaceChildren(
      ...attachments.map((attachment) => {
        const option = body.ownerDocument.createElement("option");
        option.value = String(attachment.id);
        option.textContent = String(
          attachment.getDisplayTitle() ||
            attachment.getField("title") ||
            attachment.attachmentFilename,
        );
        return option;
      }),
    );
    this.select!.value = String(this.targetID ?? "");
    this.select!.disabled = !attachments.length;
    this.open!.disabled = !this.targetID || !editable;
    this.create!.hidden = !item?.isRegularItem() || !editable;
    this.create!.disabled = !editable;
    summary(String(attachments.length || ""));
    this.schedule();
  }

  private report(error: unknown) {
    ztoolkit.log("Whiteboard sidebar failed", error);
    if (this.message) {
      this.message.hidden = false;
      this.message.textContent = getString("whiteboard-save-failed");
    }
  }

  private schedule() {
    const revision = ++this.revision;
    this.pending = this.pending
      .then(async () => {
        if (this.disposed || revision !== this.revision) return;
        const current =
          this.sessionID && whiteboardRegistry.get(this.sessionID);
        if (current && current.itemID === this.targetID && this.editable)
          return;
        if (current && !(await closeWhiteboardSession(current.tabID))) {
          // Keep the unsaved editor mounted when switching fails.
          this.targetID = current.itemID;
          this.select!.value = String(current.itemID);
          this.report(new Error("Unable to save sidebar before switching"));
          return;
        }
        this.sessionID = undefined;
        if (this.disposed || revision !== this.revision) return;
        const target = this.targetID && Zotero.Items.get(this.targetID);
        this.host!.style.display = "none";
        this.message!.hidden = false;
        this.message!.textContent = getString(
          !this.editable && target
            ? "whiteboard-sidebar-readonly"
            : "whiteboard-sidebar-empty",
        );
        if (!target || !this.editable) return;
        this.host!.style.display = "flex";
        const id = await openWhiteboardSidebar(
          target,
          this.win,
          this.host!,
          () => this.schedule(),
        );
        this.sessionID = id ?? undefined;
        this.host!.style.display = id ? "flex" : "none";
        this.message!.hidden = !!id;
        if (!id)
          this.message!.textContent = getString("whiteboard-sidebar-open");
      })
      .catch((error) => this.report(error));
  }

  async destroy() {
    this.disposed = true;
    ++this.revision;
    await this.pending;
    if (this.sessionID) await closeWhiteboardSession(this.sessionID);
  }
}

export function registerWhiteboardSidebar() {
  if (sectionKey || !Zotero.ItemPaneManager?.registerSection) return;
  const icon = `chrome://${addon.data.config.addonRef}/content/icons/attachment-canvas.svg`;
  const key = Zotero.ItemPaneManager.registerSection({
    paneID: "scholar-sketch-whiteboard",
    pluginID: addon.data.config.addonID,
    header: { icon, l10nID: getLocaleID("whiteboard-sidebar-label") },
    sidenav: { icon, l10nID: getLocaleID("whiteboard-sidebar-tooltip") },
    onInit: ({ doc, body }) => {
      const win = doc.defaultView as _ZoteroTypes.MainWindow | null;
      if (!win) return;
      void controllers.release(win, body)?.destroy();
      controllers.bind(win, body, new WhiteboardSidebar(win));
    },
    onRender: ({ body, item, editable, setSectionSummary }) => {
      controllers.get(body)?.render(body, item, editable, setSectionSummary);
    },
    onDestroy: ({ doc, body }) => {
      if (doc.defaultView)
        void controllers.release(doc.defaultView, body)?.destroy();
    },
  });
  if (key !== false) sectionKey = key;
}

export async function disposeWhiteboardSidebarForWindow(win: Window) {
  await Promise.all(
    controllers.releaseWindow(win).map((controller) => controller.destroy()),
  );
}

export async function unregisterWhiteboardSidebar() {
  if (sectionKey) Zotero.ItemPaneManager?.unregisterSection(sectionKey);
  sectionKey = null;
  await Promise.all(
    Zotero.getMainWindows().map(disposeWhiteboardSidebarForWindow),
  );
}
