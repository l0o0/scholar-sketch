import type { WhiteboardHandle } from "./editor";
import type { WhiteboardSaveCoordinator } from "./save-coordinator";
import type { ProgressiveSourceScheduler } from "./source-scheduler";

export interface WhiteboardView {
  root: HTMLElement;
  host: HTMLElement;
}

export interface WhiteboardSession {
  tabID: string;
  canvasId: string;
  itemID: number;
  win: Window;
  surface?: "tab" | "window" | "sidebar";
  transitioning?: boolean;
  closePromise?: Promise<boolean>;
  closeHost?: () => void;
  path: string;
  fileRevision?: { content: string };
  title: string;
  saveCoordinator?: WhiteboardSaveCoordinator;
  sourceScheduler?: ProgressiveSourceScheduler;
  sourceGeneration?: number;
  editor?: WhiteboardHandle;
  view?: WhiteboardView;
  closing?: boolean;
  autosaveTimer?: number;
  unbindTheme?: () => void;
  unsubscribeTemplates?: () => void;
}

export class WhiteboardSessionRegistry {
  private readonly byTab = new Map<string, WhiteboardSession>();
  private readonly byItem = new Map<number, string>();
  private readonly byWindow = new WeakMap<Window, Set<string>>();
  private readonly itemOperations = new Map<number, Promise<unknown>>();
  private readonly listeners = new Set<(itemID: number) => void>();

  subscribe(listener: (itemID: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(itemID: number) {
    for (const listener of [...this.listeners]) {
      try {
        listener(itemID);
      } catch {
        // One view must not block session mutations or other subscribers.
      }
    }
  }

  /** Keep opening/loading a canvas and replacing its saved file mutually exclusive. */
  async withItemLock<T>(
    itemID: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.itemOperations.get(itemID) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.itemOperations.set(itemID, current);
    try {
      return await current;
    } finally {
      if (this.itemOperations.get(itemID) === current) {
        this.itemOperations.delete(itemID);
      }
    }
  }

  async waitForOperations(): Promise<void> {
    while (this.itemOperations.size) {
      await Promise.allSettled([...this.itemOperations.values()]);
    }
  }

  get(tabID: string) {
    return this.byTab.get(tabID);
  }

  findByItem(itemID: number) {
    const tabID = this.byItem.get(itemID);
    return tabID ? this.byTab.get(tabID) : undefined;
  }

  register(session: WhiteboardSession) {
    this.byTab.set(session.tabID, session);
    this.byItem.set(session.itemID, session.tabID);
    let tabs = this.byWindow.get(session.win);
    if (!tabs) {
      tabs = new Set();
      this.byWindow.set(session.win, tabs);
    }
    tabs.add(session.tabID);
    this.notify(session.itemID);
  }

  unregister(tabID: string) {
    const session = this.byTab.get(tabID);
    if (!session) return;
    session.sourceScheduler?.dispose();
    session.unsubscribeTemplates?.();
    this.byTab.delete(tabID);
    this.byItem.delete(session.itemID);
    this.byWindow.get(session.win)?.delete(tabID);
    this.notify(session.itemID);
  }

  sessionsForWindow(win: Window) {
    const tabs = this.byWindow.get(win);
    if (!tabs) return [];
    return [...tabs]
      .map((tabID) => this.byTab.get(tabID))
      .filter((session): session is WhiteboardSession => !!session);
  }

  all() {
    return [...this.byTab.values()];
  }
}

export const whiteboardRegistry = new WhiteboardSessionRegistry();
