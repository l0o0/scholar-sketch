import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { version } from "../package.json";
import { releaseHighlights } from "../src/modules/release-highlights.ts";
import type { FeatureUpdateSurface } from "../src/modules/feature-updates.ts";

type FeatureModule = typeof import("../src/modules/feature-updates.ts");
const source = readFileSync(
  new URL("../src/modules/feature-updates.ts", import.meta.url),
  "utf8",
);
const { outputText } = transpileModule(source, {
  compilerOptions: {
    module: ModuleKind.CommonJS,
    target: ScriptTarget.ES2022,
  },
});

function fixture(t: TestContext, saved = new Map<string, unknown>()) {
  const exports = {} as FeatureModule;
  const observers = new Map<
    number,
    { notify(event: string, type: string): void }
  >();
  let nextObserver = 0;
  let currentVersion = version;
  const writes: Array<[string, unknown]> = [];
  const links: string[] = [];
  const dependencies = {
    "../utils/prefs": {
      getPref: (key: string) => saved.get(key),
      setPref(key: string, value: unknown) {
        saved.set(key, value);
        writes.push([key, value]);
      },
    },
    "../utils/locale": {
      getString: (key: string) => key,
    },
    "./help": {
      openUserGuide: async () => {
        links.push("guide");
      },
      openReleaseNotes: () => {
        links.push("releases");
      },
    },
    "./release-highlights": {
      featureUpdateVersion: () => currentVersion,
      releaseHighlights: () => releaseHighlights(currentVersion),
    },
  };
  runInNewContext(outputText, {
    exports,
    require(id: keyof typeof dependencies) {
      assert.ok(dependencies[id], `Unexpected dependency ${id}`);
      return dependencies[id];
    },
    Zotero: {
      Notifier: {
        registerObserver(observer: {
          notify(event: string, type: string): void;
        }) {
          const id = ++nextObserver;
          observers.set(id, observer);
          return id;
        },
        unregisterObserver(id: number) {
          observers.delete(id);
        },
      },
    },
  });
  const windows: Window[] = [];
  t.after(async () => {
    exports.disposeFeatureUpdates();
    for (const win of windows) await win.happyDOM.close();
  });
  const notify = () => {
    for (const observer of [...observers.values()])
      observer.notify("select", "tab");
  };
  const surface = (
    active = true,
    ready: Promise<unknown> = Promise.resolve(),
  ) => {
    const win = new Window();
    windows.push(win);
    let focused = true;
    let hidden = false;
    let width = 900;
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    win.setTimeout = ((callback: () => void) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    }) as typeof win.setTimeout;
    win.clearTimeout = ((id: number) =>
      timers.delete(id)) as typeof win.clearTimeout;
    win.document.hasFocus = () => focused;
    Object.defineProperty(win.document, "visibilityState", {
      get: () => (hidden ? "hidden" : "visible"),
    });
    const root = win.document.createElement("div");
    const input = win.document.createElement("input");
    root.append(input);
    win.document.body.append(root);
    input.focus();
    root.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      bottom: 700,
      right: width,
      width,
      height: 700,
      toJSON: () => ({}),
    });
    const dispose = exports.bindFeatureUpdates({
      win,
      root,
      ready,
      isActive: () => active,
    } as unknown as FeatureUpdateSurface);
    return {
      win,
      root,
      input,
      timers,
      dispose,
      card: () => win.document.querySelector(".scholar-feature-updates"),
      async flush() {
        await Promise.resolve();
        for (const [id, callback] of [...timers]) {
          timers.delete(id);
          callback();
        }
      },
      activate(value: boolean) {
        active = value;
        notify();
      },
      visibility(value: boolean) {
        hidden = !value;
        win.document.dispatchEvent(new win.Event("visibilitychange"));
      },
      focus(value: boolean) {
        focused = value;
        win.dispatchEvent(new win.Event(value ? "focus" : "blur"));
      },
      width(value: number) {
        width = value;
        win.dispatchEvent(new win.Event("resize"));
      },
    };
  };
  return {
    api: exports,
    surface,
    saved,
    writes,
    links,
    observers,
    notify,
    version(value: string) {
      currentVersion = value;
    },
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("waits for successful editor readiness and keeps typing focus intact", async (t) => {
  const f = fixture(t);
  const ready = deferred();
  const s = f.surface(true, ready.promise);
  await s.flush();
  assert.equal(s.card(), null);
  assert.equal(f.writes.length, 0);
  ready.resolve();
  await s.flush();
  assert.ok(s.card());
  assert.equal(s.win.document.activeElement, s.input);
  assert.equal(s.card()?.getAttribute("role"), "region");
  assert.equal(s.card()?.getAttribute("aria-modal"), null);
  assert.equal(f.saved.get("featureUpdatesSeenVersion"), version);
});

test("failed or closed editors do not consume a release notice", async (t) => {
  const f = fixture(t);
  const failed = deferred();
  const s = f.surface(true, failed.promise);
  failed.reject(new Error("iframe load failed"));
  await s.flush();
  assert.equal(s.card(), null);
  assert.equal(f.observers.size, 0);
  const closed = deferred();
  const closing = f.surface(true, closed.promise);
  closing.dispose();
  closed.resolve();
  await closing.flush();
  assert.equal(f.writes.length, 0);
  assert.equal(closing.card(), null);
});

test("a restored background document waits until its own tab is selected", async (t) => {
  const f = fixture(t);
  const s = f.surface(false);
  await s.flush();
  assert.equal(f.writes.length, 0);
  s.activate(true);
  await s.flush();
  assert.ok(s.card());
  assert.equal(f.writes.length, 1);
});

test("hidden, unfocused and collapsed surfaces cannot claim the update", async (t) => {
  const f = fixture(t);
  const s = f.surface();
  s.visibility(false);
  await s.flush();
  s.visibility(true);
  s.focus(false);
  await s.flush();
  s.focus(true);
  s.width(0);
  await s.flush();
  assert.equal(f.writes.length, 0);
  s.width(900);
  await s.flush();
  assert.ok(s.card());
});

test("workspace restoration can suspend temporary focus without consuming a notice", async (t) => {
  const f = fixture(t);
  const resume = f.api.suspendFeatureUpdates();
  const early = f.surface(true);
  await early.flush();
  early.activate(false);
  const last = f.surface(true);
  await last.flush();
  assert.equal(f.writes.length, 0);
  resume();
  resume();
  await early.flush();
  await last.flush();
  assert.equal(early.card(), null);
  assert.ok(last.card());
  assert.equal(f.writes.length, 1);
});

test("MD, canvas and another window compete for a single persisted presentation", async (t) => {
  const f = fixture(t);
  const md = f.surface();
  const canvas = f.surface();
  await md.flush();
  await canvas.flush();
  assert.ok(md.card());
  assert.equal(canvas.card(), null);
  assert.equal(f.writes.length, 1);
  md.dispose();
  canvas.activate(true);
  await canvas.flush();
  assert.equal(canvas.card(), null);
});

test("once-per-version survives a restart and new versions remain eligible", async (t) => {
  const saved = new Map<string, unknown>([
    ["featureUpdatesSeenVersion", version],
  ]);
  const f = fixture(t, saved);
  const old = f.surface();
  await old.flush();
  assert.equal(old.card(), null);
  f.version("99.0.0");
  const next = f.surface();
  await next.flush();
  assert.ok(next.card());
  assert.equal(saved.get("featureUpdatesSeenVersion"), "99.0.0");
});

test("settings can reopen a dismissed notice and its guide/release actions work", async (t) => {
  const f = fixture(t);
  const s = f.surface();
  await s.flush();
  const button = (text: string) =>
    [
      ...s.win.document.querySelectorAll(".scholar-feature-updates button"),
    ].find((node) => node.textContent === text) as unknown as HTMLButtonElement;
  button("feature-updates-dismiss").click();
  assert.equal(s.card(), null);
  f.api.showFeatureUpdates(s.win as unknown as Window & globalThis.Window);
  assert.ok(s.card());
  button("feature-updates-guide").click();
  button("feature-updates-release-notes").click();
  assert.deepEqual(f.links, ["guide", "releases"]);
  assert.equal(
    s.win.document.querySelectorAll(".scholar-feature-updates").length,
    1,
  );
  f.api.showFeatureUpdates(s.win as unknown as globalThis.Window);
  assert.equal(
    s.win.document.querySelectorAll(".scholar-feature-updates").length,
    1,
  );
  s.card()!.querySelector<HTMLButtonElement>(".ss-update-close")!.click();
  assert.equal(s.card(), null);
});

test("closing a surface cancels pending work, removes its card and unregisters listeners", async (t) => {
  const f = fixture(t);
  const pending = f.surface();
  await Promise.resolve();
  assert.equal(pending.timers.size, 1);
  pending.dispose();
  await pending.flush();
  assert.equal(pending.card(), null);
  assert.equal(pending.timers.size, 0);
  assert.equal(f.observers.size, 0);
  const opened = f.surface();
  await opened.flush();
  assert.ok(opened.card());
  opened.dispose();
  assert.equal(opened.card(), null);
  assert.equal(f.observers.size, 0);
});

test("switching away hides the card rather than displaying it over another document", async (t) => {
  const f = fixture(t);
  const s = f.surface();
  await s.flush();
  s.activate(false);
  assert.equal(s.card(), null);
  s.activate(true);
  await s.flush();
  assert.equal(s.card(), null);
});

test("shutdown removes automatic and manual cards without waiting on editors", async (t) => {
  const f = fixture(t);
  const s = f.surface();
  await s.flush();
  f.api.showFeatureUpdates(s.win as unknown as globalThis.Window);
  assert.ok(s.card());
  f.api.disposeFeatureUpdates();
  assert.equal(s.card(), null);
  assert.equal(f.observers.size, 0);
  f.api.showFeatureUpdates(s.win as unknown as globalThis.Window);
  assert.equal(s.card(), null);
});

test("shutdown blocks late editor readiness and restoration from registering new notices", async (t) => {
  const f = fixture(t);
  const resume = f.api.suspendFeatureUpdates();
  const ready = deferred();
  const s = f.surface(true, ready.promise);
  f.api.disposeFeatureUpdates();
  ready.resolve();
  resume();
  await s.flush();
  const late = f.surface();
  await late.flush();
  f.api.showFeatureUpdates(late.win as unknown as globalThis.Window);
  assert.equal(s.card(), null);
  assert.equal(late.card(), null);
  assert.equal(f.observers.size, 0);
  assert.equal(f.writes.length, 0);
});

test("child frame lifecycle events cannot dismiss the host notice", async (t) => {
  const f = fixture(t);
  const s = f.surface();
  await s.flush();
  const frameEvent = new s.win.Event("pagehide");
  Object.defineProperty(frameEvent, "target", {
    value: s.win.document.createElement("iframe"),
  });
  s.win.dispatchEvent(frameEvent);
  assert.ok(s.card());
  s.win.document.dispatchEvent(new s.win.Event("pagehide", { bubbles: true }));
  assert.equal(s.card(), null);
});
