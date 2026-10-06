import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { bindWhiteboardSourceVisibility } from "../src/modules/whiteboard/source-visibility.ts";
import type { WhiteboardSession } from "../src/modules/whiteboard/session-registry.ts";
import { ProgressiveSourceScheduler } from "../src/modules/whiteboard/source-scheduler.ts";

function setup(t: TestContext, surface: WhiteboardSession["surface"] = "tab") {
  const win = new Window();
  const root = win.document.createElement("div");
  win.document.body.append(root);
  const tabs = { selectedID: "pdf-tab" };
  Object.assign(win, { Zotero_Tabs: tabs });
  let hidden = false;
  Object.defineProperty(win.document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  const observers = new Map<
    string,
    { notify(event: string, type: string): void }
  >();
  let nextID = 0;
  const notifier = {
    registerObserver(observer: { notify(event: string, type: string): void }) {
      const id = `observer-${nextID++}`;
      observers.set(id, observer);
      return id;
    },
    unregisterObserver(id: string) {
      observers.delete(id);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    writable: true,
    value: { Notifier: notifier },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Zotero", previous);
    else Reflect.deleteProperty(globalThis, "Zotero");
  });
  const pauses: boolean[] = [];
  const session: WhiteboardSession = {
    tabID: "canvas-tab",
    canvasId: "canvas",
    itemID: 1,
    win: win as never,
    surface,
    path: "test.canvas",
    title: "Canvas",
    view: { root: root as never, host: root as never },
    sourceScheduler: {
      setPaused: (paused: boolean) => pauses.push(paused),
    } as never,
  };
  t.after(() => win.close());
  const notify = () => {
    for (const observer of observers.values()) observer.notify("select", "tab");
  };
  const visibility = (value: boolean) => {
    hidden = value;
    win.document.dispatchEvent(new win.Event("visibilitychange"));
  };
  return {
    win,
    root,
    tabs,
    session,
    pauses,
    observers,
    notifier,
    notify,
    visibility,
  };
}

test("background tabs queue source lookups and resume in their own window without touching saving", async (t) => {
  const env = setup(t);
  const started: string[] = [];
  const emitted: string[] = [];
  let saveCalls = 0;
  env.session.saveCoordinator = {
    request: () => {
      saveCalls += 1;
    },
  } as never;
  const scheduler = new ProgressiveSourceScheduler({
    run: async (job) => {
      started.push(job.nodeId);
      return {
        nodeId: job.nodeId,
        generation: 1,
        status: "resolved",
        acquisition: {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: "PAPER" },
          snapshot: { title: "Paper" },
        },
      };
    },
    emit: (results) => emitted.push(...results.map((result) => result.nodeId)),
  });
  env.session.sourceScheduler = scheduler;
  const unbind = bindWhiteboardSourceVisibility(env.session);
  t.after(() => {
    unbind();
    scheduler.dispose();
  });
  scheduler.enqueue({
    nodeId: "paper",
    generation: 1,
    priority: "visible",
    cacheKey: "paper",
    descriptor: {
      kind: "literature",
      source: { library: { type: "user" }, itemKey: "PAPER" },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, []);
  env.notify(); // A select in another window does not activate this window's tab.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, []);
  env.tabs.selectedID = "canvas-tab";
  env.notify();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["paper"]);
  assert.deepEqual(emitted, ["paper"]);
  assert.equal(saveCalls, 0);
  unbind();
  unbind();
  assert.equal(env.observers.size, 0);
});

test("tab activity and document visibility are combined and redundant events are ignored", (t) => {
  const env = setup(t);
  const unbind = bindWhiteboardSourceVisibility(env.session);
  t.after(unbind);
  assert.deepEqual(env.pauses, [true]);
  env.visibility(true);
  env.tabs.selectedID = "canvas-tab";
  env.notify();
  assert.deepEqual(env.pauses, [true]);
  env.visibility(false);
  assert.deepEqual(env.pauses, [true, false]);
  env.notify();
  env.win.dispatchEvent(new env.win.Event("focus"));
  assert.deepEqual(env.pauses, [true, false]);
  env.tabs.selectedID = "another-canvas";
  env.notify();
  assert.deepEqual(env.pauses, [true, false, true]);
});

test("a visible native window keeps resolving when unfocused and follows its own document visibility", (t) => {
  const env = setup(t, "window");
  const unbind = bindWhiteboardSourceVisibility(env.session);
  assert.deepEqual(env.pauses, [false]);
  assert.equal(env.observers.size, 0);
  env.win.dispatchEvent(new env.win.Event("blur"));
  env.notify();
  assert.deepEqual(env.pauses, [false]);
  env.visibility(true);
  env.visibility(false);
  assert.deepEqual(env.pauses, [false, true, false]);
  unbind();
  env.visibility(true);
  env.win.dispatchEvent(new env.win.Event("focus"));
  assert.deepEqual(env.pauses, [false, true, false]);
});

test("sidebar intersection and owner-document visibility independently pause and resume", (t) => {
  const env = setup(t, "sidebar");
  let observe: IntersectionObserverCallback | undefined;
  let disconnected = false;
  Object.assign(env.win, {
    IntersectionObserver: class {
      constructor(callback: IntersectionObserverCallback) {
        observe = callback;
      }
      observe(target: unknown) {
        assert.equal(target, env.root);
      }
      disconnect() {
        disconnected = true;
      }
    },
  });
  const unbind = bindWhiteboardSourceVisibility(env.session);
  const intersect = (isIntersecting: boolean) =>
    observe!(
      [
        {
          target: env.root,
          isIntersecting,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  assert.deepEqual(env.pauses, [false]); // Layout has not been observed yet.
  intersect(false);
  env.visibility(true);
  intersect(true);
  assert.deepEqual(env.pauses, [false, true]);
  env.visibility(false);
  assert.deepEqual(env.pauses, [false, true, false]);
  unbind();
  assert.equal(disconnected, true);
  intersect(false);
  assert.deepEqual(env.pauses, [false, true, false]);
});

test("missing host observers fail open and do not strand queued sources", (t) => {
  const env = setup(t);
  t.mock.method(env.notifier, "registerObserver", () => {
    throw new Error("Unavailable");
  });
  const unbind = bindWhiteboardSourceVisibility(env.session);
  t.after(unbind);
  assert.deepEqual(env.pauses, [false]);
  const sidebar = { ...env.session, surface: "sidebar" as const };
  Object.assign(env.win, { IntersectionObserver: undefined });
  const unbindSidebar = bindWhiteboardSourceVisibility(sidebar);
  t.after(unbindSidebar);
  assert.deepEqual(env.pauses, [false, false]);
});
