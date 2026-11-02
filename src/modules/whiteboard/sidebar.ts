import { getString } from "../../utils/locale";
import { isWhiteboardAttachment } from "./detect";
import { WhiteboardSidebarLayout } from "./sidebar-layout";
import { whiteboardRegistry } from "./session-registry";
import {
  closeWhiteboardSession,
  openWhiteboardSidebar,
  openWhiteboardTab,
} from "./tab";

export class WhiteboardSidebar {
  private host?: HTMLElement;
  private message?: HTMLElement;
  private open?: HTMLButtonElement;
  private retry?: HTMLButtonElement;
  private layout?: WhiteboardSidebarLayout;
  private targetID?: number;
  private sessionID?: string;
  private active = true;
  private editable = false;
  private disposed = false;
  private revision = 0;
  private pending: Promise<void> = Promise.resolve();
  private readonly unsubscribeRegistry: () => void;

  constructor(private win: _ZoteroTypes.MainWindow) {
    this.unsubscribeRegistry = whiteboardRegistry.subscribe((itemID) => {
      if (!this.disposed && itemID === this.targetID) this.schedule();
    });
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      ++this.revision;
      this.layout?.setFocused(false);
    }
  }

  render(
    body: HTMLElement,
    item: Zotero.Item | null,
    editable: boolean,
    summary: (value: string) => void,
  ) {
    if (this.disposed || !this.active) return;
    if (!this.host) {
      const doc = body.ownerDocument;
      this.open = doc.createElement("button");
      this.open.textContent = getString("sidebar-open-tab");
      this.open.hidden = true;
      this.open.addEventListener("click", () => {
        const target = this.targetID && Zotero.Items.get(this.targetID);
        if (target)
          void openWhiteboardTab(target, { win: this.win })
            .then(() => this.schedule())
            .catch((error) => this.report(error));
      });
      this.message = doc.createElement("div");
      this.message.className = "scholar-sketch-whiteboard-message";
      this.retry = doc.createElement("button");
      this.retry.textContent = getString("whiteboard-sidebar-retry-save");
      this.retry.dataset.action = "retry-save";
      this.retry.hidden = true;
      this.retry.addEventListener("click", () => this.schedule());
      this.host = doc.createElement("div");
      this.host.className = "scholar-sketch-whiteboard-host";
      body.replaceChildren(this.message, this.open, this.retry, this.host);
      this.layout = new WhiteboardSidebarLayout(
        this.win,
        body,
        this.host,
        (focused) => {
          const session =
            this.sessionID && whiteboardRegistry.get(this.sessionID);
          if (session) {
            if (session.sidebar) session.sidebar.focused = focused;
            session.editor?.setSidebarFocus(focused);
          }
        },
      );
    }
    this.editable = editable;
    const targetID = item && isWhiteboardAttachment(item) ? item.id : undefined;
    if (targetID !== this.targetID || !editable) this.layout!.setFocused(false);
    this.targetID = targetID;
    const current = this.sessionID && whiteboardRegistry.get(this.sessionID);
    if (!editable || !current || current.itemID !== targetID)
      this.setEditorVisible(false);
    this.open!.disabled = !this.targetID || !editable;
    summary("");
    this.schedule();
  }

  private report(error: unknown) {
    ztoolkit.log("Whiteboard sidebar failed", error);
    if (this.message) {
      this.message.hidden = false;
      this.message.textContent = getString("whiteboard-save-failed");
    }
  }

  private setEditorVisible(visible: boolean) {
    this.host!.style.display = visible ? "flex" : "none";
    this.host!.inert = !visible;
  }

  private reportBlockedSave(title: string, error: unknown) {
    this.report(error);
    this.layout!.setFocused(false);
    this.setEditorVisible(false);
    this.open!.hidden = true;
    this.retry!.hidden = false;
    this.message!.textContent = getString("whiteboard-sidebar-save-blocked", {
      args: { title },
    });
  }

  private schedule() {
    if (!this.active || this.disposed) return;
    const revision = ++this.revision;
    this.retry!.disabled = true;
    this.pending = this.pending
      .then(async () => {
        if (this.disposed || revision !== this.revision) return;
        const current =
          this.sessionID && whiteboardRegistry.get(this.sessionID);
        if (current && current.itemID === this.targetID && this.editable) {
          this.setEditorVisible(true);
          this.message!.hidden = true;
          this.open!.hidden = true;
          this.retry!.hidden = true;
          return;
        }
        this.setEditorVisible(false);
        this.open!.hidden = true;
        this.retry!.hidden = true;
        if (current) {
          try {
            if (!(await closeWhiteboardSession(current.tabID))) {
              if (!this.disposed && revision === this.revision)
                this.reportBlockedSave(
                  current.title,
                  new Error("Unable to save sidebar before switching"),
                );
              return;
            }
          } catch (error) {
            if (!this.disposed && revision === this.revision)
              this.reportBlockedSave(current.title, error);
            return;
          }
        }
        this.sessionID = undefined;
        if (this.disposed || revision !== this.revision) return;
        const target = this.targetID && Zotero.Items.get(this.targetID);
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
          () => {
            this.layout!.setFocused(false);
            this.schedule();
          },
          {
            focused: this.layout!.focused,
            onToggleFocus: () => {
              if (
                this.active &&
                !this.disposed &&
                this.editable &&
                this.targetID === target.id &&
                !this.host!.inert
              )
                this.layout!.setFocused(!this.layout!.focused);
            },
          },
        );
        this.sessionID = id ?? undefined;
        if (this.disposed || revision !== this.revision) return;
        this.setEditorVisible(!!id);
        this.message!.hidden = !!id;
        this.open!.hidden = !!id;
        if (!id)
          this.message!.textContent = getString("whiteboard-sidebar-open");
      })
      .catch((error) => {
        if (!this.disposed && revision === this.revision) this.report(error);
      })
      .finally(() => {
        if (!this.disposed && revision === this.revision)
          this.retry!.disabled = false;
      });
  }

  async destroy() {
    if (this.disposed) return;
    this.unsubscribeRegistry();
    this.disposed = true;
    ++this.revision;
    this.layout?.destroy();
    await this.pending;
    if (this.sessionID && !(await closeWhiteboardSession(this.sessionID)))
      throw new Error("Unable to save whiteboard sidebar before closing");
  }
}
