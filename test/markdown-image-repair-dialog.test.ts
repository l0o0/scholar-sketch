import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  openImageRepairDialog,
  type ImageRepairDialogLabels,
} from "../src/modules/markdown/images/repair-dialog.ts";
import type { ImageAssetRepairReport } from "../src/modules/markdown/images/repair.ts";

const labels: ImageRepairDialogLabels = {
  title: "Check images",
  description: "Check saved references. Repair saves this note first.",
  inspecting: "Inspecting",
  repairing: "Repairing",
  inspect: "Check again",
  repair: "Repair",
  close: "Close",
  readOnly: "Read-only attachment",
  syncHint: "Finish syncing this computer before syncing another computer.",
  noImages: "No saved image references",
  candidates: "Images to restore",
  unresolved: "Images needing attention",
  source: "Original",
  target: "Destination",
  statuses: {
    healthy: "Healthy",
    repairable: "Repairable",
    repaired: "Restored",
    missing: "Missing",
    conflict: "Conflict",
    failed: "Failed",
  },
  summary: (report) => `Checked ${report.checked}; restored ${report.repaired}`,
  retained: (count) => `Kept ${count} original files`,
  skipped: (count) => `Skipped ${count} unrelated files`,
};

function report(
  overrides: Partial<ImageAssetRepairReport> = {},
): ImageAssetRepairReport {
  return {
    checked: 1,
    healthy: 0,
    repairable: 1,
    repaired: 0,
    missing: 0,
    conflicts: 0,
    failed: 0,
    retainedOriginals: 0,
    canRepair: true,
    skippedPaths: [],
    entries: [
      {
        reference: "assets/image.png",
        status: "repairable",
        sourcePath: "/note/assetsimage.png",
        targetPath: "/note/assets/image.png",
      },
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

function fixture(
  options: {
    inspect?: () => Promise<ImageAssetRepairReport>;
    repair?: () => Promise<ImageAssetRepairReport>;
  } = {},
) {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML =
    '<button id="opener">Menu</button><main class="zotero-markdown-root theme-dark"></main>';
  const opener = doc.querySelector<HTMLButtonElement>("#opener")!;
  opener.focus();
  let inspections = 0;
  let repairs = 0;
  let closes = 0;
  const handle = openImageRepairDialog({
    document: doc as unknown as Document,
    mount: doc.querySelector("main") as unknown as HTMLElement,
    labels,
    inspect: () => {
      inspections++;
      return options.inspect?.() ?? Promise.resolve(report());
    },
    repair: () => {
      repairs++;
      return (
        options.repair?.() ??
        Promise.resolve(
          report({
            repairable: 0,
            repaired: 1,
            entries: [{ reference: "assets/image.png", status: "repaired" }],
          }),
        )
      );
    },
    onClose: () => {
      closes++;
    },
  });
  const action = (name: string) =>
    doc.querySelector<HTMLButtonElement>(
      `[data-image-repair-action="${name}"]`,
    )!;
  return {
    win,
    doc,
    opener,
    handle,
    action,
    inspections: () => inspections,
    repairs: () => repairs,
    closes: () => closes,
  };
}

test("opening inspects saved references without requesting a repair", async () => {
  const ui = fixture();
  await settle();
  assert.equal(ui.inspections(), 1);
  assert.equal(ui.repairs(), 0);
  assert.ok(ui.doc.querySelector(".theme-dark [role=dialog][aria-modal=true]"));
  assert.equal(
    ui.doc.querySelector("[role=dialog]")?.getAttribute("aria-busy"),
    "false",
  );
  assert.match(ui.doc.body.textContent, /Original: \/note\/assetsimage\.png/);
  assert.equal(ui.action("repair").hidden, false);
  ui.handle.destroy();
});

test("repair is explicit and a pending operation cannot be entered twice", async () => {
  const pending = deferred<ImageAssetRepairReport>();
  const ui = fixture({ repair: () => pending.promise });
  await settle();
  ui.action("repair").focus();
  ui.action("repair").click();
  assert.equal(ui.repairs(), 1);
  assert.equal(ui.action("repair").disabled, true);
  assert.equal(ui.action("inspect").disabled, true);
  // Dispatching a synthetic event must also respect the busy guard.
  ui.action("repair").dispatchEvent(new ui.win.MouseEvent("click"));
  ui.action("inspect").dispatchEvent(new ui.win.MouseEvent("click"));
  assert.equal(ui.repairs(), 1);
  assert.equal(ui.inspections(), 1);
  pending.resolve(
    report({
      repairable: 0,
      repaired: 1,
      retainedOriginals: 1,
      entries: [
        {
          reference: "assets/image.png",
          status: "repaired",
          reason: "Old file retained",
        },
      ],
    }),
  );
  await settle();
  assert.match(ui.doc.body.textContent, /Kept 1 original files/);
  assert.match(ui.doc.body.textContent, /Finish syncing this computer/);
  assert.match(ui.doc.body.textContent, /Old file retained/);
  assert.equal(ui.action("repair").hidden, true);
  assert.equal(ui.action("inspect").disabled, false);
  assert.equal(ui.doc.activeElement, ui.action("inspect"));
  ui.handle.destroy();
});

test("missing, conflicting and skipped files are visible as plain text", async () => {
  const ui = fixture({
    inspect: async () =>
      report({
        checked: 2,
        repairable: 0,
        missing: 1,
        conflicts: 1,
        entries: [
          { reference: "assets/missing.png", status: "missing" },
          {
            reference: "assets/<script>.png",
            status: "conflict",
            reason: "<img src=x onerror=alert(1)>",
          },
        ],
        skippedPaths: ["/note/assets-unrelated.png"],
      }),
  });
  await settle();
  assert.equal(ui.doc.querySelectorAll("[data-image-repair-entry]").length, 2);
  assert.match(ui.doc.body.textContent, /Images needing attention/);
  assert.match(
    ui.doc.querySelector("details")!.textContent,
    /Skipped 1 unrelated files/,
  );
  assert.match(ui.doc.body.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(ui.doc.querySelector("script,img"), null);
  assert.equal(ui.action("repair").hidden, true);
  ui.action("repair").dispatchEvent(new ui.win.MouseEvent("click"));
  assert.equal(ui.repairs(), 0);
  ui.handle.destroy();
});

test("read-only reports disable repair even with repairable images", async () => {
  const ui = fixture({ inspect: async () => report({ canRepair: false }) });
  await settle();
  assert.match(ui.doc.body.textContent, /Read-only attachment/);
  assert.equal(ui.action("repair").hidden, true);
  ui.action("repair").dispatchEvent(new ui.win.MouseEvent("click"));
  assert.equal(ui.repairs(), 0);
  ui.handle.destroy();
});

test("closing during scan prevents later display and restores focus once", async () => {
  const pending = deferred<ImageAssetRepairReport>();
  const ui = fixture({ inspect: () => pending.promise });
  ui.action("close").click();
  assert.equal(ui.doc.activeElement, ui.opener);
  pending.resolve(report());
  await settle();
  assert.equal(ui.doc.querySelector("[role=dialog]"), null);
  assert.equal(ui.repairs(), 0);
  ui.handle.destroy();
  assert.equal(ui.closes(), 1);
});

test("closing during repair ignores asynchronous failures", async () => {
  const pending = deferred<ImageAssetRepairReport>();
  const ui = fixture({ repair: () => pending.promise });
  await settle();
  ui.action("repair").click();
  ui.handle.destroy();
  pending.reject(new Error("Disk full"));
  await settle();
  assert.equal(ui.doc.querySelector("[role=dialog]"), null);
  assert.doesNotMatch(ui.doc.body.textContent, /Disk full/);
  assert.equal(ui.closes(), 1);
});

test("failed repair requires a new inspection before retry", async () => {
  const ui = fixture({
    repair: async () => {
      throw new Error("Save conflict");
    },
  });
  await settle();
  ui.action("repair").click();
  await settle();
  assert.match(
    ui.doc.querySelector("[role=alert]")!.textContent,
    /Save conflict/,
  );
  assert.equal(ui.action("repair").hidden, true);
  ui.action("inspect").click();
  await settle();
  assert.equal(ui.inspections(), 2);
  assert.equal(ui.action("repair").hidden, false);
  assert.equal(ui.doc.querySelector<HTMLElement>("[role=alert]")!.hidden, true);
  ui.handle.destroy();
});

test("Tab stays inside dialog and Escape closes it", async () => {
  const ui = fixture();
  await settle();
  ui.action("repair").focus();
  ui.doc.dispatchEvent(
    new ui.win.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(ui.doc.activeElement, ui.action("close"));
  ui.doc.dispatchEvent(
    new ui.win.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(ui.doc.activeElement, ui.action("repair"));
  ui.doc.dispatchEvent(
    new ui.win.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(ui.doc.querySelector("[role=dialog]"), null);
  assert.equal(ui.doc.activeElement, ui.opener);
});

test("window unload removes dialog and its keyboard handlers", async () => {
  const ui = fixture();
  await settle();
  ui.win.dispatchEvent(new ui.win.Event("unload"));
  const escape = new ui.win.KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  ui.doc.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, false);
  assert.equal(ui.closes(), 1);
  assert.equal(ui.doc.querySelector("[role=dialog]"), null);
});
