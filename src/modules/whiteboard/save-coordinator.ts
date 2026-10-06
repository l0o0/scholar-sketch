import type { CanvasDocument } from "./snapshot";

export type WhiteboardSaveState = "saved" | "saving" | "error";

export interface WhiteboardSaveSnapshot {
  rev: number;
  document: CanvasDocument;
}

export interface WhiteboardSaveCoordinatorOptions {
  initialDocument?: CanvasDocument;
  getSnapshot: () => WhiteboardSaveSnapshot | Promise<WhiteboardSaveSnapshot>;
  write: (snapshot: WhiteboardSaveSnapshot) => Promise<void>;
  onStateChange?: (state: WhiteboardSaveState) => void;
}

/** Object insertion order is not an edit; array order still carries meaning. */
function documentFingerprint(document: CanvasDocument): string {
  const normalized = {
    ...document,
    viewport: document.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
  return JSON.stringify(normalized, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

export class WhiteboardSaveCoordinator {
  currentRev = 0;
  savedRev = 0;
  writing = false;
  lastError: Error | undefined;

  private tail: Promise<void> = Promise.resolve();
  private compareDocuments: boolean;
  private savedFingerprint: string | undefined;

  constructor(private readonly options: WhiteboardSaveCoordinatorOptions) {
    this.compareDocuments = options.initialDocument !== undefined;
    this.savedFingerprint = options.initialDocument
      ? documentFingerprint(options.initialDocument)
      : undefined;
  }

  get dirty(): boolean {
    return this.currentRev > this.savedRev;
  }

  markChanged(rev: number): void {
    if (Number.isFinite(rev)) this.currentRev = Math.max(this.currentRev, rev);
  }

  /** A transferred draft starts a new iframe revision epoch and remains unsaved. */
  adoptUnsavedSnapshot(error?: Error): void {
    this.savedRev = Math.min(this.savedRev, this.currentRev - 1);
    this.savedFingerprint = undefined;
    if (error) this.lastError = error;
    this.options.onStateChange?.(this.lastError ? "error" : "saving");
  }

  /** Call after loading a document read from disk into the replacement iframe. */
  adoptPersistedSnapshot(snapshot: WhiteboardSaveSnapshot): void {
    this.compareDocuments = true;
    this.savedFingerprint = documentFingerprint(snapshot.document);
    this.currentRev = Math.max(this.currentRev, snapshot.rev);
    this.savedRev = this.currentRev;
    this.lastError = undefined;
    this.options.onStateChange?.("saved");
  }

  request(options: { force?: boolean } = {}): Promise<void> {
    const save = this.tail.then(
      () => this.drain(Boolean(options.force)),
      () => this.drain(Boolean(options.force)),
    );
    this.tail = save.catch(() => undefined);
    return save;
  }

  async flush(): Promise<void> {
    await this.request();
  }

  private async drain(force: boolean): Promise<void> {
    if (!force && !this.dirty) return;

    this.writing = true;
    this.options.onStateChange?.("saving");
    try {
      do {
        const snapshot = await this.options.getSnapshot();
        this.currentRev = Math.max(this.currentRev, snapshot.rev);
        const fingerprint = documentFingerprint(snapshot.document);
        if (
          !this.compareDocuments ||
          this.lastError ||
          fingerprint !== this.savedFingerprint
        ) {
          // A document may change before a revision notification, or in a new epoch.
          // Preserve an unsaved state even if this write fails with rev === savedRev.
          this.savedRev = Math.min(this.savedRev, snapshot.rev - 1);
          await this.options.write(snapshot);
          this.savedFingerprint = fingerprint;
          this.lastError = undefined;
        }
        this.savedRev = Math.max(this.savedRev, snapshot.rev);
        force = false;
      } while (this.dirty);
      this.lastError = undefined;
      this.options.onStateChange?.("saved");
    } catch (error) {
      this.lastError =
        error instanceof Error ? error : new Error(String(error));
      this.options.onStateChange?.("error");
      throw this.lastError;
    } finally {
      this.writing = false;
    }
  }
}
