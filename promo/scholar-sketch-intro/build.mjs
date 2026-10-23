import {build} from 'esbuild';
import {readFile, writeFile, mkdir, cp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import integration from './integration.config.mjs';
// Client-mounted film: product components run in the browser (fixture /api in src/fake-api.js),
// one paused GSAP timeline + per-shot render hooks drive every frame through window.seek(t).
const plan = JSON.parse(await readFile('plan.json', 'utf8'));
const repoDir = integration.repoDir || plan.repo;
// CJK fonts (Noto Sans SC as "PingFang SC" + "Film Sans SC") are generated from node_modules, not committed.
if (!existsSync('src/fonts.generated.css') || !existsSync('public/fonts')) execFileSync('node', ['tools/gen-cjk-font.mjs'], {stdio: 'inherit'});
const fontsCss = await readFile('src/fonts.generated.css', 'utf8');
await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});
const result = await build({
  entryPoints: ['src/client.jsx'], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
  outfile: '.build/client.js', metafile: true, minify: !process.env.FILM_DEBUG, sourcemap: process.env.FILM_DEBUG ? 'inline' : false, legalComments: 'none',
  // Resolve product dependencies from the product's own node_modules first.
  nodePaths: [...(repoDir ? [path.resolve(repoDir, 'node_modules')] : []), path.resolve('node_modules')],
  // One React runtime shared by the film and every bundled product component.
  alias: {...integration.aliases, react: path.resolve('node_modules/react'), 'react-dom': path.resolve('node_modules/react-dom')},
  define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}', 'process.platform': '"darwin"', ...integration.define},
  external: integration.external || [],
  loader: {'.js': 'jsx', '.css': 'css', '.module.css': 'local-css', '.png': 'file', '.jpg': 'file', '.svg': 'file', '.woff': 'file', '.woff2': 'file', '.ttf': 'file', ...integration.loaders},
  assetNames: 'assets/[name]-[hash]', logLevel: 'error',
  ...(integration.esbuild || {}),   // e.g. tsconfigRaw to relax the product's compiler options for a display build
});
await mkdir('evidence', {recursive: true});
await writeFile('evidence/component-imports.json', JSON.stringify(result.metafile, null, 2));
const bundle = await readFile('.build/client.js', 'utf8');
if (!plan.demo && bundle.includes('data-skill-placeholder')) throw new Error('Technical fixture is still on screen. Connect the actual product feature components before production.');
let css = '';
for (const f of ['src/fonts.generated.css', 'assets/fallback/tokens.css', 'src/product.css', '.build/client.css', 'src/film.css']) if (existsSync(f)) css += '\n' + await readFile(f, 'utf8');
await writeFile('dist/index.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${plan.product || 'film'}</title><style>${css}</style><body><div id="film-root"></div><script src="client.js"></script></body></html>`);
await cp('.build/client.js', 'dist/client.js');
if (existsSync('public')) await cp('public', 'dist', {recursive: true});
if (existsSync('assets')) await cp('assets', 'dist/assets', {recursive: true});
for (const file of Object.keys(result.metafile.outputs)) {
  if (/\.(?:js|css|map)$/.test(file)) continue;
  const dest = path.join('dist', path.relative('.build', file));
  await mkdir(path.dirname(dest), {recursive: true}); await cp(file, dest);
}
// Extra product pages loaded in same-origin iframes (e.g. the Markdown editor's chrome:// page).
// integration.framePages: [{entry, out, html: {from, scriptPattern}}]; film freeze CSS is injected.
for (const pg of integration.framePages || []) {
  const r = await build({
    entryPoints: [pg.entry], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    outfile: path.join('dist', pg.out + '.js'), metafile: true, minify: !process.env.FILM_DEBUG, sourcemap: process.env.FILM_DEBUG ? 'inline' : false, legalComments: 'none',
    nodePaths: [...(repoDir ? [path.resolve(repoDir, 'node_modules')] : []), path.resolve('node_modules')],
    alias: {...integration.aliases}, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}', ...integration.define},
    loader: {'.js': 'jsx', '.css': 'css', ...integration.loaders}, logLevel: 'error', ...(integration.esbuild || {}),
  });
  await writeFile(`evidence/component-imports.${pg.out}.json`, JSON.stringify(r.metafile, null, 2));
  const freeze = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}';
  const html = (await readFile(pg.html.from, 'utf8')).replace(pg.html.scriptPattern, pg.out + '.js').replace('</style>', fontsCss + '\n' + freeze + '\n' + (pg.css || '') + '\n</style>');
  if (!html.includes(pg.out + '.js')) throw new Error(`framePages: script tag not replaced in ${pg.html.from}`);
  await writeFile(path.join('dist', pg.out + '.html'), html);
}
// render.mjs refuses a dist/ built from another plan.json (renders must follow the current plan)
const {createHash} = await import('node:crypto');
await writeFile('dist/build-info.json', JSON.stringify({planSha256: createHash('sha256').update(await readFile('plan.json')).digest('hex')}) + '\n');
console.log('Built dist/index.html; imports recorded in evidence/component-imports.json');
