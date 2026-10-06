import type {
  AcademicSourceDescriptor,
  SourceResolutionPriority,
  SourceResolutionResult,
} from "./protocol";

export type SourcePriority = SourceResolutionPriority;

export interface SourceResolutionJob {
  nodeId: string;
  generation: number;
  priority: SourcePriority;
  descriptor: AcademicSourceDescriptor;
  cacheKey: string;
}

interface PendingSource {
  cacheKey: string;
  priority: SourcePriority;
  sequence: number;
  running: boolean;
  waiters: Map<string, SourceResolutionJob>;
}

interface CachedSource {
  result: SourceResolutionResult;
  textBytes: number;
}

const PRIORITY_ORDER: Record<SourcePriority, number> = {
  selected: 0,
  visible: 1,
  idle: 2,
};

export class ProgressiveSourceScheduler {
  private readonly concurrency: number;
  private readonly cacheMaxEntries: number;
  private readonly cacheMaxBytes: number;
  private readonly runJob: (
    job: SourceResolutionJob,
  ) => Promise<SourceResolutionResult>;
  private readonly emitResults: (results: SourceResolutionResult[]) => void;
  private readonly pending = new Map<string, PendingSource>();
  private readonly completed = new Map<string, CachedSource>();
  private readonly cancelledGenerations = new Set<number>();
  private completionBatch: SourceResolutionResult[] = [];
  private active = 0;
  private sequence = 0;
  private pumpScheduled = false;
  private emitScheduled = false;
  private disposed = false;
  private paused = false;
  private cachedTextBytes = 0;

  constructor(options: {
    concurrency?: number;
    cacheMaxEntries?: number;
    cacheMaxBytes?: number;
    run(job: SourceResolutionJob): Promise<SourceResolutionResult>;
    emit(results: SourceResolutionResult[]): void;
  }) {
    const concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(
        "Source scheduler concurrency must be a positive integer.",
      );
    }
    this.concurrency = concurrency;
    this.cacheMaxEntries = options.cacheMaxEntries ?? 128;
    this.cacheMaxBytes = options.cacheMaxBytes ?? 2 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.cacheMaxEntries) ||
      this.cacheMaxEntries < 0 ||
      !Number.isSafeInteger(this.cacheMaxBytes) ||
      this.cacheMaxBytes < 0
    ) {
      throw new Error("Source cache limits must be nonnegative integers.");
    }
    this.runJob = options.run;
    this.emitResults = options.emit;
  }

  enqueue(job: SourceResolutionJob): void {
    if (this.disposed || this.cancelledGenerations.has(job.generation)) return;

    const cached = this.completed.get(job.cacheKey);
    if (cached) {
      this.completed.delete(job.cacheKey);
      this.completed.set(job.cacheKey, cached);
      this.queueCompletion(copyResultForJob(cached.result, job));
      return;
    }

    const waiterKey = `${job.generation}:${job.nodeId}`;
    const existing = this.pending.get(job.cacheKey);
    if (existing) {
      existing.waiters.set(waiterKey, job);
      if (PRIORITY_ORDER[job.priority] < PRIORITY_ORDER[existing.priority]) {
        existing.priority = job.priority;
      }
      this.schedulePump();
      return;
    }

    this.pending.set(job.cacheKey, {
      cacheKey: job.cacheKey,
      priority: job.priority,
      sequence: this.sequence++,
      running: false,
      waiters: new Map([[waiterKey, job]]),
    });
    this.schedulePump();
  }

  promote(cacheKey: string, priority: SourcePriority): void {
    if (this.disposed) return;
    const source = this.pending.get(cacheKey);
    if (
      !source ||
      PRIORITY_ORDER[priority] >= PRIORITY_ORDER[source.priority]
    ) {
      return;
    }
    source.priority = priority;
    this.schedulePump();
  }

  invalidate(cacheKey: string): void {
    if (this.disposed) return;
    this.removeCached(cacheKey);
  }

  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.schedulePump();
  }

  cancelGeneration(generation: number): void {
    if (this.disposed) return;
    this.cancelledGenerations.add(generation);
    this.completionBatch = this.completionBatch.filter(
      (result) => result.generation !== generation,
    );

    for (const [cacheKey, source] of this.pending) {
      for (const [waiterKey, waiter] of source.waiters) {
        if (waiter.generation === generation) {
          source.waiters.delete(waiterKey);
        }
      }
      if (!source.waiters.size && !source.running) {
        this.pending.delete(cacheKey);
      } else if (!source.running) {
        source.priority = highestPriority(source.waiters.values());
      }
    }
    this.schedulePump();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    this.completed.clear();
    this.cachedTextBytes = 0;
    this.cancelledGenerations.clear();
    this.completionBatch = [];
  }

  private schedulePump() {
    if (this.disposed || this.paused || this.pumpScheduled) return;
    this.pumpScheduled = true;
    scheduleMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump() {
    if (this.disposed || this.paused) return;
    while (!this.disposed && !this.paused && this.active < this.concurrency) {
      let next: PendingSource | undefined;
      for (const source of this.pending.values()) {
        if (source.running || !source.waiters.size) continue;
        if (
          !next ||
          PRIORITY_ORDER[source.priority] < PRIORITY_ORDER[next.priority] ||
          (source.priority === next.priority && source.sequence < next.sequence)
        ) {
          next = source;
        }
      }
      if (!next) return;
      this.start(next);
    }
  }

  private start(source: PendingSource) {
    const first = source.waiters.values().next().value as
      SourceResolutionJob | undefined;
    if (!first) {
      this.pending.delete(source.cacheKey);
      return;
    }
    source.running = true;
    this.active += 1;
    const job = { ...first, priority: source.priority };

    let lookup: Promise<SourceResolutionResult>;
    try {
      lookup = this.runJob(job);
    } catch (error) {
      lookup = Promise.reject(error);
    }
    void lookup.then(
      (result) => this.finish(source, result),
      (error) => this.finish(source, failedResult(job, error)),
    );
  }

  private finish(source: PendingSource, result?: SourceResolutionResult) {
    this.active -= 1;
    if (this.disposed) return;
    if (this.pending.get(source.cacheKey) === source) {
      this.pending.delete(source.cacheKey);
    }

    const activeWaiters = [...source.waiters.values()].filter(
      (waiter) => !this.cancelledGenerations.has(waiter.generation),
    );
    if (result && activeWaiters.length) {
      if (result.status === "resolved") {
        this.remember(source.cacheKey, result);
      }
      for (const waiter of activeWaiters) {
        this.queueCompletion(copyResultForJob(result, waiter));
      }
    }
    this.pump();
  }

  private removeCached(cacheKey: string) {
    const cached = this.completed.get(cacheKey);
    if (!cached) return;
    this.cachedTextBytes -= cached.textBytes;
    this.completed.delete(cacheKey);
  }

  private remember(cacheKey: string, result: SourceResolutionResult) {
    this.removeCached(cacheKey);
    const textBytes = utf16TextBytes(result) + cacheKey.length * 2;
    if (!this.cacheMaxEntries || textBytes > this.cacheMaxBytes) return;

    while (
      this.completed.size >= this.cacheMaxEntries ||
      this.cachedTextBytes + textBytes > this.cacheMaxBytes
    ) {
      const oldest = this.completed.keys().next().value;
      if (oldest === undefined) return;
      this.removeCached(oldest);
    }
    this.completed.set(cacheKey, { result, textBytes });
    this.cachedTextBytes += textBytes;
  }

  private queueCompletion(result: SourceResolutionResult) {
    if (this.disposed || this.cancelledGenerations.has(result.generation)) {
      return;
    }
    this.completionBatch.push(result);
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    scheduleMicrotask(() => {
      this.emitScheduled = false;
      if (this.disposed) return;
      const batch = this.completionBatch.filter(
        (item) => !this.cancelledGenerations.has(item.generation),
      );
      this.completionBatch = [];
      if (batch.length) this.emitResults(batch);
    });
  }
}

/** Protocol results contain text, metadata and arrays, without binary buffers. */
function utf16TextBytes(value: unknown): number {
  if (typeof value === "string") return value.length * 2;
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce(
    (total: number, child: unknown) => total + utf16TextBytes(child),
    0,
  );
}

function highestPriority(jobs: Iterable<SourceResolutionJob>): SourcePriority {
  let priority: SourcePriority = "idle";
  for (const job of jobs) {
    if (PRIORITY_ORDER[job.priority] < PRIORITY_ORDER[priority]) {
      priority = job.priority;
    }
  }
  return priority;
}

function copyResultForJob(
  result: SourceResolutionResult,
  job: SourceResolutionJob,
): SourceResolutionResult {
  return { ...result, nodeId: job.nodeId, generation: job.generation };
}

function failedResult(
  job: SourceResolutionJob,
  error: unknown,
): SourceResolutionResult {
  return {
    nodeId: job.nodeId,
    generation: job.generation,
    status: "unavailable",
    code: "resolution-failed",
    message:
      error instanceof Error && error.message
        ? error.message
        : "Academic source resolution failed.",
  };
}

function scheduleMicrotask(callback: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }
  void Promise.resolve().then(callback);
}
