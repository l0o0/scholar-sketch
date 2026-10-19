// Product integration for the video project (never edit the product repo).
// Scholar Sketch mounts two real product surfaces:
// - the whiteboard: packages/whiteboard exports TS source and imports two plugin modules by relative path
//   (src/ui/theme.ts, src/modules/markdown/preview-render-core.ts); esbuild bundles the TS directly.
// - the Markdown editor: the production iframe page (addon/content/editor/index.html + src/editor/bootstrap.ts)
//   is built as its own page (framePages) and mounted through the production bridge createMarkdownEditor();
//   host-side modules (outline, backlinks, [[ link search) run against the repo's own fake Zotero.
// fake-zotero's dist is a devDependency build output (not installed): alias the package name to its source.
import path from 'node:path';
import {existsSync, readdirSync} from 'node:fs';
const repo = '/home/user/scholar-sketch';
// Zotero's own item-type icons (chrome://zotero/skin/…) are NOT in this repo. Drop real files into
// public/zotero-skin/item-type/16/{light,dark}/*.svg (from a Zotero install) and they are used;
// until then the [[ popup shows the product's own "no icon" state instead of a 404.
const skinDir = new URL('./public/zotero-skin', import.meta.url).pathname;
const zoteroSkin = existsSync(skinDir) ? readdirSync(skinDir, {recursive: true}).map(f => String(f).split(path.sep).join('/')) : [];
export default {
  repoDir: repo,
  aliases: {
    '@wb': path.join(repo, 'packages/whiteboard/src'),        // film-side shorthand for the whiteboard source
    '@plugin': path.join(repo, 'src'),                         // plugin modules (source gateway, markdown host)
    '@addon': path.join(repo, 'addon'),                        // shipped locale files (zh-CN Fluent strings)
    '@zotero-plugin/fake-zotero': path.join(repo, 'packages/fake-zotero/src/index.ts'),
    // whiteboard/export.ts uses renderToStaticMarkup; pick the browser server build explicitly
    // (the default server.js pulls in node built-ins).
    'react-dom/server': path.resolve('node_modules/react-dom/server.browser.js'),
  },
  // generated CJK font faces (src/fonts.generated.css) point at /fonts/*.woff2 copied from public/
  external: ['/fonts/*'],
  // real zh-CN Fluent strings are read as text; KaTeX fonts are inlined the same way production does.
  loaders: {'.ftl': 'text', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl'},
  define: {__ZOTERO_SKIN_FILES__: JSON.stringify(zoteroSkin), __HAS_POSTER__: JSON.stringify(existsSync(new URL('./public/poster.png', import.meta.url).pathname))},
  esbuild: {
    // The root tsconfig extends zotero-types/entries/sandbox (devDependency, not installed). Mirror its
    // compiler options (zotero-types@4.1.3 entries/base: target ES2022, experimentalDecorators) so the
    // display build compiles the product's TS the same way the release build does.
    tsconfigRaw: {compilerOptions: {jsx: 'react-jsx', target: 'ES2022', useDefineForClassFields: true, experimentalDecorators: true, verbatimModuleSyntax: false}},
  },
  // The editor's own iframe page: addon/content/editor/index.html with the production bootstrap
  // (src/editor/bootstrap.ts) bundled by the film instead of chrome://bamboo/content/editor/editor.js.
  framePages: [{
    entry: 'src/md/editor-frame.js', out: 'md-editor',
    html: {from: path.join(repo, 'addon/content/editor/index.html'), scriptPattern: /chrome:\/\/[^"]*\/editor\.js[^"]*/},
    // CodeMirror's base-theme focus ring (1px dotted) on a .cm-editor that fills the iframe: Chromium paints
    // it along the iframe's top/right edge; the product screenshots show no such line. Display-only fix.
    css: '#editor-root .cm-editor.cm-focused{outline:none}',
  }],
};
