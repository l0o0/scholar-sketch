import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createStatusFeedback } from "../src/modules/markdown/status-feedback.ts";

function fixture() {
  const win = new Window();
  const element = win.document.createElement("span");
  element.className = "zotero-markdown-save-status is-saved";
  element.textContent = "Autosave on";
  win.document.body.append(element);
  const feedback = createStatusFeedback(element as unknown as HTMLElement, {
    labels: { details: "Details", close: "Close", dismiss: "Dismiss" },
  });
  return { win, element, feedback };
}

test("status keeps a task visible through autosave and returns to the latest save state", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { element, feedback } = fixture();
  const task = feedback.begin("Downloading images");
  feedback.setSave("saving", "Saving");
  feedback.setSave("saved", "Saved at 11:30");
  assert.equal(element.textContent, "Downloading images");
  assert.equal(element.dataset.statusState, "busy");
  task.update("Downloading 2/3");
  assert.equal(element.textContent, "Downloading 2/3");
  task.succeed("Downloaded 3 images");
  feedback.setSave("dirty", "Unsaved changes");
  t.mock.timers.tick(5999);
  assert.equal(element.textContent, "Downloaded 3 images");
  t.mock.timers.tick(1);
  assert.equal(element.textContent, "Unsaved changes");
  assert.equal(element.dataset.statusSource, "save");
  assert.equal(element.dataset.statusState, "dirty");
  feedback.destroy();
});

test("save failures interrupt task feedback and pending task feedback resumes after recovery", () => {
  const { element, feedback } = fixture();
  const task = feedback.begin("Checking images");
  feedback.setSave("error", "Save failed");
  task.update("Checking 3 images");
  assert.equal(element.textContent, "Save failed");
  assert.equal(element.dataset.statusSource, "save");
  assert.equal(element.dataset.statusState, "error");
  feedback.setSave("saved", "Saved");
  assert.equal(element.textContent, "Checking 3 images");
  assert.equal(element.dataset.statusSource, "task");
  task.cancel();
  assert.equal(element.textContent, "Saved");
  feedback.destroy();
});

test("old async work and old notice deadlines cannot replace a newer task", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { element, feedback } = fixture();
  const old = feedback.begin("First task");
  old.succeed("First finished");
  t.mock.timers.tick(2000);
  const current = feedback.begin("Second task");
  old.update("Late progress");
  old.warn("Late result");
  old.cancel();
  t.mock.timers.tick(4000);
  assert.equal(element.textContent, "Second task");
  current.warn("2 downloaded, 1 failed");
  assert.equal(element.dataset.statusState, "warning");
  t.mock.timers.tick(5999);
  assert.equal(element.textContent, "2 downloaded, 1 failed");
  t.mock.timers.tick(1);
  assert.equal(element.textContent, "2 downloaded, 1 failed");
  feedback.destroy();
});

test("partial success and errors use distinct icons and accessible plain text", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { element, feedback } = fixture();
  const task = feedback.begin("Cleaning images");
  task.warn("Removed 2; skipped 1");
  const warningIcon = element.querySelector("path")?.getAttribute("d");
  feedback.begin("Checking").fail("Check failed <retry>");
  assert.notEqual(
    element.querySelector("path")?.getAttribute("d"),
    warningIcon,
  );
  assert.equal(element.dataset.statusState, "error");
  assert.equal(element.textContent, "Check failed <retry>");
  assert.equal(element.title, "Check failed <retry>");
  assert.equal(element.querySelector("retry"), null);
  assert.equal(element.getAttribute("role"), "status");
  assert.equal(element.getAttribute("aria-live"), "polite");
  assert.equal(element.getAttribute("aria-atomic"), "true");
  assert.equal(
    element.querySelector("svg")?.getAttribute("aria-hidden"),
    "true",
  );
  assert.equal(
    element.querySelector("svg")?.namespaceURI,
    "http://www.w3.org/2000/svg",
  );
  assert.equal(
    element.querySelector(".zmd-status-text")?.namespaceURI,
    "http://www.w3.org/1999/xhtml",
  );
  feedback.destroy();
});

test("completing a task seals its result until its notice expires", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { element, feedback } = fixture();
  const task = feedback.begin("Downloading");
  task.succeed("Downloaded");
  task.update("Late progress");
  task.fail("Late failure");
  assert.equal(element.textContent, "Downloaded");
  t.mock.timers.tick(6000);
  task.update("Even later progress");
  assert.equal(element.textContent, "Autosave on");
  feedback.destroy();
});

test("destroy clears the pending notice timeout and ignores late task and save updates", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const clearTimeoutSpy = t.mock.method(globalThis, "clearTimeout");
  const { element, feedback } = fixture();
  const task = feedback.begin("Downloading");
  task.succeed("Downloaded");
  feedback.destroy();
  assert.equal(clearTimeoutSpy.mock.callCount(), 1);
  t.mock.timers.tick(6000);
  task.update("Ignored");
  task.fail("Ignored");
  feedback.setSave("error", "Ignored");
  feedback.begin("Ignored").succeed("Ignored");
  assert.equal(element.textContent, "Downloaded");
  assert.equal(element.hasAttribute("aria-live"), false);
});

test("an expired result does not conceal a persistent save error", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { element, feedback } = fixture();
  const task = feedback.begin("Downloading");
  feedback.setSave("error", "Save failed");
  task.succeed("Downloaded");
  t.mock.timers.tick(6000);
  assert.equal(element.textContent, "Save failed");
  feedback.setSave("saved", "Saved again");
  assert.equal(element.textContent, "Saved again");
  feedback.destroy();
});

for (const result of ["warn", "fail"] as const) {
  test(`task ${result} persists until another task starts`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { element, feedback } = fixture();
    feedback.begin("Working")[result]("Needs attention");
    t.mock.timers.tick(60000);
    feedback.setSave("saved", "Saved");
    assert.equal(
      element.querySelector(".zmd-status-text")?.textContent,
      "Needs attention",
    );
    feedback.begin("Next task");
    assert.equal(
      element.querySelector(".zmd-status-text")?.textContent,
      "Next task",
    );
    feedback.destroy();
  });
}

test("status details are keyboard reachable, dismiss task failures but never save failures", () => {
  const { win, element, feedback } = fixture();
  feedback.begin("Checking").fail("A long error with recovery instructions");
  const summary = element.querySelector<HTMLButtonElement>(
    ".zmd-status-summary",
  )!;
  summary.click();
  const panel = element.querySelector(".zmd-status-details")!;
  assert.equal(
    panel.querySelector("p")?.textContent,
    "A long error with recovery instructions",
  );
  const buttons = panel.querySelectorAll<HTMLButtonElement>("button");
  assert.equal(win.document.activeElement, buttons[1]);
  buttons[1].dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(win.document.activeElement, summary);
  assert.equal(element.querySelector(".zmd-status-details"), null);
  summary.click();
  element
    .querySelector<HTMLButtonElement>(".zmd-status-details button")!
    .click();
  assert.equal(
    element.querySelector(".zmd-status-text")?.textContent,
    "Autosave on",
  );
  feedback.setSave("error", "Save failed");
  summary.click();
  assert.equal(
    element.querySelector<HTMLButtonElement>(".zmd-status-details button")!
      .hidden,
    true,
  );
  feedback.destroy();
  summary.click();
  assert.equal(element.querySelector(".zmd-status-details"), null);
});

test("status button names the current message and closes details when focus returns to the iframe", () => {
  const { win, element, feedback } = fixture();
  feedback.begin("Downloading").fail("Remote image unavailable");
  const summary = element.querySelector<HTMLButtonElement>(
    ".zmd-status-summary",
  )!;
  assert.equal(
    summary.getAttribute("aria-label"),
    "Details: Remote image unavailable",
  );
  summary.click();
  assert.ok(element.querySelector(".zmd-status-details"));
  win.dispatchEvent(new win.Event("blur"));
  assert.equal(element.querySelector(".zmd-status-details"), null);
  assert.equal(
    element.querySelector(".zmd-status-text")?.textContent,
    "Remote image unavailable",
  );
  feedback.destroy();
});
