import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import ts from "typescript";

// Keep ownership and execution in one registry. An unknown test must be reviewed
// before it can run in Node; in particular, Zotero's Mocha tests cannot run there.
export const testRoots = ["test", "packages/fake-zotero/test"];

export const testSuites = {
  unit: {
    runtime: "node",
    patterns: [
      "test/api-frontmatter-patch.test.ts",
      "test/async-render.test.ts",
      "test/attachment-icons.test.ts",
      "test/attachment-sync.test.ts",
      "test/attachment-zip-compat.test.ts",
      "test/bamboo-branding.test.ts",
      "test/creation-toolbar.test.ts",
      "test/document-link-filters.test.ts",
      "test/document-links*.test.ts",
      "test/document-sync.test.ts",
      "test/editor-channel.test.ts",
      "test/editor-composition.test.ts",
      "test/editor-conditional-apply.test.ts",
      "test/editor-image-import.test.ts",
      "test/editor-keyboard-shortcuts.test.ts",
      "test/editor-link-completion.test.ts",
      "test/editor-link-target.test.ts",
      "test/editor-outline-bridge.test.ts",
      "test/editor-outline.test.ts",
      "test/editor-slash-commands.test.ts",
      "test/editor-stats.test.ts",
      "test/editor-table-cell-edit.test.ts",
      "test/editor-table-edge-actions.test.ts",
      "test/editor-table-menu.test.ts",
      "test/editor-table-operations.test.ts",
      "test/editor-table-selection.test.ts",
      "test/editor-table.test.ts",
      "test/editor-theme.test.ts",
      "test/feature-updates.test.ts",
      "test/file-history-ui.test.ts",
      "test/file-safety.test.ts",
      "test/frontmatter-title-sync.test.ts",
      "test/help.test.ts",
      "test/image-asset-cache.test.ts",
      "test/image-import-safety.test.ts",
      "test/lezer-link-parser.test.ts",
      "test/live-preview-*.test.ts",
      "test/markdown-api-guards.test.ts",
      "test/markdown-change-scheduling.test.ts",
      "test/markdown-context-menu.test.ts",
      "test/markdown-create-target.test.ts",
      "test/markdown-error-i18n.test.ts",
      "test/markdown-export-flush.test.ts",
      "test/markdown-filename.test.ts",
      "test/markdown-iframe-drop.test.ts",
      "test/markdown-image-auto-repair.test.ts",
      "test/markdown-image-auto-session.test.ts",
      "test/markdown-image-compat.test.ts",
      "test/markdown-image-insert-session.test.ts",
      "test/markdown-image-operations.test.ts",
      "test/markdown-image-repair-dialog.test.ts",
      "test/markdown-image-repair-session.test.ts",
      "test/markdown-image-repair.test.ts",
      "test/markdown-images.test.ts",
      "test/markdown-math.test.ts",
      "test/markdown-modal.test.ts",
      "test/markdown-note-conversion.test.ts",
      "test/markdown-note-translator.test.ts",
      "test/markdown-outline-sidebar.test.ts",
      "test/markdown-rename.test.ts",
      "test/markdown-responsive-toolbar.test.ts",
      "test/markdown-settings-entry.test.ts",
      "test/markdown-settings-pages.test.ts",
      "test/markdown-shortcut.test.ts",
      "test/markdown-sidebar-motion.test.ts",
      "test/markdown-sidebar.test.ts",
      "test/markdown-status-feedback.test.ts",
      "test/markdown-status.test.ts",
      "test/markdown-storage-filename.test.ts",
      "test/markdown-sync-persist.test.ts",
      "test/markdown-toolbar.test.ts",
      "test/markdown-transfer.test.ts",
      "test/markdown-window-registry.test.ts",
      "test/markdown-window.test.ts",
      "test/mermaid-build.test.ts",
      "test/mermaid-handshake.test.ts",
      "test/mermaid-preview.test.ts",
      "test/mermaid-runtime.test.ts",
      "test/more-menu.test.ts",
      "test/preview-document.test.ts",
      "test/preview-render-state.test.ts",
      "test/preview-worker-client.test.ts",
      "test/preview-worker-protocol.test.ts",
      "test/release-candidate.test.ts",
      "test/release-config.test.ts",
      "test/release-highlights.test.ts",
      "test/remaining-features.test.ts",
      "test/save-coordinator.test.ts",
      "test/session-registry.test.ts",
      "test/test-suites.test.ts",
      "test/whiteboard-*.test.ts",
      "test/zotero-pane-compat.test.ts",
    ],
  },
  fake: {
    runtime: "node",
    patterns: [
      "test/fake-zotero-*.test.ts",
      "packages/fake-zotero/test/*.test.js",
    ],
  },
  zotero: {
    runtime: "zotero",
    patterns: ["test/startup.test.ts"],
  },
};

export function collectTests(root = process.cwd()) {
  const tests = [];
  function visit(directory) {
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.test\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
        tests.push({ path, source: readFileSync(join(root, path), "utf8") });
      }
    }
  }
  for (const directory of testRoots) visit(directory);
  return tests.sort((a, b) => a.path.localeCompare(b.path));
}

function matches(pattern, path) {
  // Only * is supported, and it never crosses a directory boundary.
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${expression}$`).test(path);
}

function importsNodeTest({ path, source }) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return file.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "node:test",
  );
}

export function resolveTestSuites(tests, suites = testSuites) {
  const errors = [];
  const owners = new Map(tests.map((test) => [test.path, []]));
  const resolved = Object.fromEntries(
    Object.keys(suites).map((name) => [name, []]),
  );

  for (const [name, suite] of Object.entries(suites)) {
    if (!["node", "zotero"].includes(suite.runtime)) {
      errors.push(`${name}: unknown runtime ${suite.runtime}`);
    }
    if (!suite.patterns.length) errors.push(`${name}: no test patterns`);
    for (const pattern of suite.patterns) {
      const matched = tests.filter((test) => matches(pattern, test.path));
      if (!matched.length) errors.push(`${name}: stale pattern ${pattern}`);
      for (const test of matched) {
        owners.get(test.path).push(`${name} (${pattern})`);
        resolved[name].push(test.path);
        const nodeTest = importsNodeTest(test);
        if (suite.runtime === "node" && !nodeTest) {
          errors.push(
            `${test.path}: ${name} requires a direct node:test import; review host/runtime ownership`,
          );
        } else if (suite.runtime === "zotero" && nodeTest) {
          errors.push(
            `${test.path}: node:test cannot belong to the Zotero suite`,
          );
        }
      }
    }
  }
  for (const [path, matches] of owners) {
    if (!matches.length) errors.push(`${path}: no test suite owns this file`);
    if (matches.length > 1) {
      errors.push(`${path}: duplicate ownership: ${matches.join(", ")}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  for (const files of Object.values(resolved)) files.sort();
  return resolved;
}
