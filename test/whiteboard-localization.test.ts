import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { getString, initLocale } from "../src/utils/locale.ts";

test("addon reload reads new translations without reusing Zotero's shared Fluent cache", (t) => {
  let fileMessages = { "bamboo-whiteboard-color-custom": "Old translation" };
  const registries: Registry[] = [];
  class Source {
    messages = { ...fileMessages };
    constructor(
      readonly name: string,
      _meta: string,
      readonly locales: string[],
      readonly path: string,
    ) {}
  }
  class Registry {
    sources: Source[] = [];
    constructor() {
      registries.push(this);
    }
    registerSources(sources: Source[]) {
      this.sources = sources;
    }
  }
  class Locale {
    constructor(
      _ids: string[],
      _sync: boolean,
      readonly registry: Registry,
    ) {}
    formatMessagesSync(requests: { id: keyof typeof fileMessages }[]) {
      return requests.map(({ id }) => ({
        value: this.registry.sources[0].messages[id] ?? null,
        attributes: null,
      }));
    }
  }
  const globals = {
    addon: { data: {} },
    rootURI: "file:///plugin/",
    ztoolkit: {
      getGlobal: (name: string) =>
        ({
          Localization: Locale,
          L10nRegistry: Registry,
          L10nFileSource: Source,
        })[name],
      log: () => {},
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  initLocale();
  assert.equal(getString("whiteboard-color-custom"), "Old translation");
  fileMessages = { "bamboo-whiteboard-color-custom": "Updated translation" };
  initLocale();
  assert.equal(getString("whiteboard-color-custom"), "Updated translation");
  assert.notEqual(registries[0], registries[1]);
  assert.equal(
    registries[1].sources[0].path,
    "file:///plugin/locale/{locale}/",
  );
  assert.deepEqual(registries[1].sources[0].locales, ["en-US", "zh-CN"]);
});

const hostKeys = [
  "whiteboard-add-item",
  "whiteboard-file-image",
  "whiteboard-file-pdf",
  "whiteboard-file-text",
  "whiteboard-file-audio",
  "whiteboard-file-video",
  "whiteboard-file-generic",
  "whiteboard-file-open",
  "whiteboard-file-details",
  "whiteboard-file-preview",
  "whiteboard-file-too-large",
  "whiteboard-file-import-failed",
  "whiteboard-file-unavailable",
  "whiteboard-file-dimensions",
  "whiteboard-file-pages",
  "whiteboard-canvas",
  "whiteboard-group-selection",
  "whiteboard-remove-from-group",
  "whiteboard-fit-selection",
  "whiteboard-draw-tools",
  "whiteboard-selection-details",
  "whiteboard-edge-label",
  "whiteboard-edge-relation",
  "whiteboard-edge-style",
  "whiteboard-edge-arrows",
  "whiteboard-arrow-none",
  "whiteboard-arrow-forward",
  "whiteboard-arrow-reverse",
  "whiteboard-arrow-both",
  "whiteboard-edge-selection",
  "whiteboard-stroke-width",
  "whiteboard-geometry",
  "whiteboard-node-width",
  "whiteboard-node-height",
  "whiteboard-position-x",
  "whiteboard-position-y",
  "whiteboard-relation-none",
  "whiteboard-relation-related",
  "whiteboard-relation-supports",
  "whiteboard-relation-contradicts",
  "whiteboard-select",
  "whiteboard-hand",
  "whiteboard-more",
  "whiteboard-shortcuts-title",
  "whiteboard-close",
  "whiteboard-stroke",
  "whiteboard-background",
  "whiteboard-transparent",
  "whiteboard-style",
  "whiteboard-solid",
  "whiteboard-dashed",
  "whiteboard-corners",
  "whiteboard-format",
  "whiteboard-color",
  "whiteboard-size",
  "whiteboard-alignment",
  "whiteboard-text-alignment",
  "whiteboard-vertical-alignment",
  "whiteboard-font-system",
  "whiteboard-font-georgia",
  "whiteboard-font-times",
  "whiteboard-font-inter",
  "whiteboard-font-menlo",
  "whiteboard-font-serif-sc",
  "whiteboard-weight-regular",
  "whiteboard-weight-bold",
  "whiteboard-colors-common",
  "whiteboard-colors-recent",
  "whiteboard-color-opacity",
  "whiteboard-color-custom",
  "whiteboard-color-reset",
  "whiteboard-shortcut-select",
  "whiteboard-shortcut-hand",
  "whiteboard-shortcut-free-move",
  "whiteboard-shortcut-nudge",
  "whiteboard-shortcut-nudge-large",
  "whiteboard-shortcut-rect",
  "whiteboard-shortcut-ellipse",
  "whiteboard-shortcut-arrow",
  "whiteboard-shortcut-line",
  "whiteboard-shortcut-text",
  "whiteboard-shortcut-eraser",
  "whiteboard-shortcut-constrain",
  "whiteboard-shortcut-cancel",
  "whiteboard-shortcut-delete",
  "whiteboard-shortcut-undo",
  "whiteboard-shortcut-redo",
  "whiteboard-add-question",
  "whiteboard-add-claim",
  "whiteboard-add-frame",
  "whiteboard-kind-literature",
  "whiteboard-kind-quote",
  "whiteboard-kind-note",
  "whiteboard-note-empty",
  "whiteboard-badge",
  "whiteboard-apply-template",
  "whiteboard-choose-template",
  "whiteboard-save-as-template",
  "whiteboard-template-name",
  "whiteboard-include-template-content",
  "whiteboard-custom-templates",
  "whiteboard-no-custom-templates",
  "whiteboard-rename-template",
  "whiteboard-duplicate-template",
  "whiteboard-delete-template",
  "whiteboard-template-conflict-copy",
  "whiteboard-kind-frame",
  "whiteboard-annotation-color",
  "whiteboard-annotations",
  "whiteboard-source-status",
  "whiteboard-source-idle",
  "whiteboard-source-available",
  "whiteboard-source-loading",
  "whiteboard-source-missing",
  "whiteboard-acquisition-summary",
  "whiteboard-drop-malformed",
  "whiteboard-drop-unsupported",
  "whiteboard-acquisition-failed",
  "whiteboard-source-open-failed",
  "whiteboard-source-refresh-failed",
  "whiteboard-failure-library-missing",
  "whiteboard-failure-item-missing",
  "whiteboard-failure-wrong-kind",
  "whiteboard-failure-parent-mismatch",
  "whiteboard-failure-attachment-unavailable",
  "whiteboard-failure-annotation-unavailable",
  "whiteboard-failure-resolution-failed",
  "whiteboard-failure-open-failed",
  "whiteboard-failure-list-failed",
  "whiteboard-selection",
  "whiteboard-note-refresh-failed",
  "whiteboard-open-source",
  "whiteboard-refresh-source",
  "whiteboard-refresh-note",
  "whiteboard-view-annotations",
  "whiteboard-annotation-browser-title",
  "whiteboard-search-annotations",
  "whiteboard-annotations-loading",
  "whiteboard-annotations-empty",
  "whiteboard-annotations-unavailable",
  "whiteboard-annotations-partial-failure",
  "whiteboard-annotation-already-added",
  "whiteboard-focus-existing-annotation",
  "whiteboard-add-selected-annotations",
  "whiteboard-annotation-page",
  "whiteboard-note-overwrite-title",
  "whiteboard-note-overwrite-body",
  "whiteboard-confirm",
  "whiteboard-cancel",
  "whiteboard-shortcut-question",
  "whiteboard-shortcut-claim",
  "whiteboard-shortcut-frame",
];

const tutorialLabels = [
  ["title", "whiteboard-tutorial-title"],
  ["welcome", "whiteboard-tutorial-welcome"],
  ["welcomeBody", "whiteboard-tutorial-welcome-body"],
  ["quickStart", "whiteboard-tutorial-quick-start"],
  ["quickStartBody", "whiteboard-tutorial-quick-start-body"],
  ["sourceNotice", "whiteboard-tutorial-source-notice"],
  ["addLiterature", "whiteboard-tutorial-add-literature"],
  ["addLiteratureBody", "whiteboard-tutorial-add-literature-body"],
  ["browseQuotes", "whiteboard-tutorial-browse-quotes"],
  ["browseQuotesBody", "whiteboard-tutorial-browse-quotes-body"],
  ["writeNote", "whiteboard-tutorial-write-note"],
  ["writeNoteBody", "whiteboard-tutorial-write-note-body"],
  ["questionBadge", "whiteboard-tutorial-question-badge"],
  ["claimBadge", "whiteboard-tutorial-claim-badge"],
  ["organize", "whiteboard-tutorial-organize"],
  ["organizeBody", "whiteboard-tutorial-organize-body"],
  ["practice", "whiteboard-tutorial-practice"],
  ["practiceBody", "whiteboard-tutorial-practice-body"],
  ["supports", "whiteboard-tutorial-supports"],
  ["exampleSource", "whiteboard-tutorial-example-source"],
  ["exampleSourceBody", "whiteboard-tutorial-example-source-body"],
  ["exampleQuote", "whiteboard-tutorial-example-quote"],
  ["exampleQuoteBody", "whiteboard-tutorial-example-quote-body"],
  ["imageTitle", "whiteboard-tutorial-image-title"],
  ["imageBody", "whiteboard-tutorial-image-body"],
  ["attachmentTitle", "whiteboard-tutorial-attachment-title"],
  ["attachmentBody", "whiteboard-tutorial-attachment-body"],
  ["attachmentContent", "whiteboard-tutorial-attachment-content"],
  ["colorNote", "whiteboard-tutorial-color-note"],
  ["colorSummary", "whiteboard-tutorial-color-summary"],
  ["organizeAction", "whiteboard-tutorial-organize-action"],
  ["colorEvidence", "whiteboard-tutorial-color-evidence"],
  ["colorQuestion", "whiteboard-tutorial-color-question"],
  ["colorClaim", "whiteboard-tutorial-color-claim"],
  ["colorBody", "whiteboard-tutorial-color-body"],
  ["share", "whiteboard-tutorial-share"],
  ["shareBody", "whiteboard-tutorial-share-body"],
] as const;

test("both host locales define every whiteboard chrome label", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const source = readFileSync(`addon/locale/${locale}/addon.ftl`, "utf8");
    for (const key of hostKeys) {
      assert.match(
        source,
        new RegExp(`^${key}\\s*=`, "m"),
        `${locale}: ${key}`,
      );
    }
  }
});

test("both host locales define the complete tutorial label set", () => {
  const expectedKeys = tutorialLabels.map(([, key]) => key).sort();
  for (const locale of ["en-US", "zh-CN"]) {
    const source = readFileSync(`addon/locale/${locale}/addon.ftl`, "utf8");
    const actualKeys = [
      ...source.matchAll(/^(whiteboard-tutorial-[\w-]+)\s*=/gm),
    ]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(actualKeys, expectedKeys, locale);
    assert.match(
      source,
      /^whiteboard-tutorial-title\s*=\s*\S.*\.canvas$/m,
      `${locale}: localized title must be a .canvas filename`,
    );
  }
});

test("the Chinese tutorial uses the UI term for Claim", () => {
  const source = readFileSync("addon/locale/zh-CN/addon.ftl", "utf8");
  assert.match(source, /^whiteboard-tutorial-claim-badge = 观点$/m);
  assert.match(
    source,
    /^whiteboard-tutorial-write-note-body = 打开顶部“笔记”菜单，选择卡片类型，再点击画布开始写作。$/m,
  );
  assert.doesNotMatch(source, /^whiteboard-tutorial-.*论点/m);
});

test("host maps every tutorial label directly through typed localization", () => {
  const source = readFileSync("src/modules/whiteboard/tutorial.ts", "utf8");
  for (const [field, key] of tutorialLabels) {
    assert.match(
      source,
      new RegExp(`${field}:\\s*getString\\("${key}"\\)`),
      `${field}: ${key}`,
    );
  }
  assert.doesNotMatch(source, /FluentMessageId/);
});

test("library acquisition uses the Zotero materials label in both host locales", () => {
  for (const [locale, expected] of [
    ["en-US", "Add Zotero materials"],
    ["zh-CN", "添加 Zotero 资料"],
  ]) {
    const source = readFileSync(`addon/locale/${locale}/addon.ftl`, "utf8");
    assert.match(
      source,
      new RegExp(`^whiteboard-add-item = ${expected}$`, "m"),
    );
  }
});

test("host wires every academic label into the whiteboard protocol", () => {
  const source = readFileSync("src/modules/whiteboard/tab.ts", "utf8");
  for (const [field, key] of [
    ["canvas", "whiteboard-canvas"],
    ["selection", "whiteboard-selection"],
    ["addQuestion", "whiteboard-add-question"],
    ["addClaim", "whiteboard-add-claim"],
    ["addFrame", "whiteboard-add-frame"],
    ["kindLiterature", "whiteboard-kind-literature"],
    ["kindQuote", "whiteboard-kind-quote"],
    ["kindNote", "whiteboard-kind-note"],
    ["emptyNote", "whiteboard-note-empty"],
    ["badge", "whiteboard-badge"],
    ["applyTemplate", "whiteboard-apply-template"],
    ["chooseTemplate", "whiteboard-choose-template"],
    ["saveAsTemplate", "whiteboard-save-as-template"],
    ["templateName", "whiteboard-template-name"],
    ["includeTemplateContent", "whiteboard-include-template-content"],
    ["customTemplates", "whiteboard-custom-templates"],
    ["noCustomTemplates", "whiteboard-no-custom-templates"],
    ["renameTemplate", "whiteboard-rename-template"],
    ["duplicateTemplate", "whiteboard-duplicate-template"],
    ["deleteTemplate", "whiteboard-delete-template"],
    ["kindFrame", "whiteboard-kind-frame"],
    ["annotationColor", "whiteboard-annotation-color"],
    ["sourceStatus", "whiteboard-source-status"],
    ["sourceIdle", "whiteboard-source-idle"],
    ["sourceAvailable", "whiteboard-source-available"],
    ["sourceLoading", "whiteboard-source-loading"],
    ["sourceMissing", "whiteboard-source-missing"],
    ["dropMalformed", "whiteboard-drop-malformed"],
    ["dropUnsupported", "whiteboard-drop-unsupported"],
    ["acquisitionFailed", "whiteboard-acquisition-failed"],
    ["sourceOpenFailed", "whiteboard-source-open-failed"],
    ["sourceRefreshFailed", "whiteboard-source-refresh-failed"],
    ["noteRefreshFailed", "whiteboard-note-refresh-failed"],
    ["failureLibraryMissing", "whiteboard-failure-library-missing"],
    ["failureItemMissing", "whiteboard-failure-item-missing"],
    ["failureWrongKind", "whiteboard-failure-wrong-kind"],
    ["failureParentMismatch", "whiteboard-failure-parent-mismatch"],
    [
      "failureAttachmentUnavailable",
      "whiteboard-failure-attachment-unavailable",
    ],
    [
      "failureAnnotationUnavailable",
      "whiteboard-failure-annotation-unavailable",
    ],
    ["failureResolutionFailed", "whiteboard-failure-resolution-failed"],
    ["failureOpenFailed", "whiteboard-failure-open-failed"],
    ["failureListFailed", "whiteboard-failure-list-failed"],
    ["openSource", "whiteboard-open-source"],
    ["refreshSource", "whiteboard-refresh-source"],
    ["refreshNote", "whiteboard-refresh-note"],
    ["viewAnnotations", "whiteboard-view-annotations"],
    ["annotationBrowserTitle", "whiteboard-annotation-browser-title"],
    ["searchAnnotations", "whiteboard-search-annotations"],
    ["annotationsLoading", "whiteboard-annotations-loading"],
    ["annotationsEmpty", "whiteboard-annotations-empty"],
    ["annotationsUnavailable", "whiteboard-annotations-unavailable"],
    ["annotationsPartialFailure", "whiteboard-annotations-partial-failure"],
    ["annotationAlreadyAdded", "whiteboard-annotation-already-added"],
    ["focusExistingAnnotation", "whiteboard-focus-existing-annotation"],
    ["addSelectedAnnotations", "whiteboard-add-selected-annotations"],
    ["annotationPage", "whiteboard-annotation-page"],
    ["noteOverwriteTitle", "whiteboard-note-overwrite-title"],
    ["noteOverwriteBody", "whiteboard-note-overwrite-body"],
    ["confirm", "whiteboard-confirm"],
    ["cancel", "whiteboard-cancel"],
    ["shortcutQuestion", "whiteboard-shortcut-question"],
    ["shortcutClaim", "whiteboard-shortcut-claim"],
    ["shortcutFrame", "whiteboard-shortcut-frame"],
    ["shortcutFreeMove", "whiteboard-shortcut-free-move"],
    ["shortcutNudge", "whiteboard-shortcut-nudge"],
    ["shortcutNudgeLarge", "whiteboard-shortcut-nudge-large"],
  ]) {
    assert.match(
      source,
      new RegExp(`${field}:\\s*getString\\(\\s*"${key}"\\s*,?\\s*\\)`),
      `${field}: ${key}`,
    );
  }
  assert.match(
    source,
    /annotations:\s*\{[\s\S]*one:\s*getString\("whiteboard-annotations",\s*\{[\s\S]*count:\s*1[\s\S]*other:\s*getString\("whiteboard-annotations",\s*\{[\s\S]*count:\s*2/s,
  );
  assert.match(
    source,
    /acquisitionSummary:\s*getString\("whiteboard-acquisition-summary"/,
  );
});

test("multi-source summary is localized with both outcome counts", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const source = readFileSync(`addon/locale/${locale}/addon.ftl`, "utf8");
    const message = source.match(
      /^whiteboard-acquisition-summary\s*=([^\n]*(?:\n[ \t]+[^\n]*)*)/m,
    )?.[1];
    assert.ok(message, `${locale}: missing acquisition summary`);
    assert.match(message, /\$successCount/);
    assert.match(message, /\$failureCount/);
  }
});

test("annotation labels use Fluent plural selection", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const source = readFileSync(`addon/locale/${locale}/addon.ftl`, "utf8");
    const message = source.match(
      /^whiteboard-annotations\s*=([^\n]*(?:\n[ \t]+[^\n]*)*)/m,
    )?.[1];
    assert.ok(message, `${locale}: missing annotation selector`);
    assert.match(message, /\{\s*\$count\s*->/);
    assert.match(message, /\[one\]/);
    assert.match(message, /\*\[other\]/);
  }
});

test("host picker protocol keeps the Note toolbar local while accepting Zotero Notes generically", () => {
  const protocol = readFileSync(
    "packages/whiteboard/src/model/protocol.ts",
    "utf8",
  );
  const editor = readFileSync("src/modules/whiteboard/editor.ts", "utf8");
  const tab = readFileSync("src/modules/whiteboard/tab.ts", "utf8");
  assert.doesNotMatch(protocol, /"item" \| "pdf" \| "note" \| "attachment"/);
  assert.doesNotMatch(editor, /"item" \| "pdf" \| "note" \| "attachment"/);
  assert.match(
    tab,
    /item\.isRegularItem(?:\?\.)?\(\)\s*\|\|\s*item\.isNote(?:\?\.)?\(\)\s*\|\|\s*item\.isAttachment(?:\?\.)?\(\)/,
  );
  assert.doesNotMatch(protocol, /kind: "literature" \| "note"/);
});

test("isolated whiteboard package contains no hard-coded CJK text", () => {
  const root = "packages/whiteboard/src";
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => `${root}/${file}`);
  const offenders = files.filter((file) =>
    /[\u3400-\u9fff]/u.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(offenders, []);
});
