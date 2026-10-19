// Generate the whiteboard's Chinese UI labels from the product's own sources (read-only):
//   - src/modules/whiteboard/tab.ts : which label key maps to which Fluent message id
//   - addon/locale/zh-CN/addon.ftl  : the shipped Chinese strings
// Output: src/fixtures/wb-labels.zh.json (consumed by the whiteboard shot as the `labels` prop).
// Usage: node tools/gen-wb-labels.mjs [repoDir]
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';

const repo = process.argv[2] || '/home/user/scholar-sketch';
const tab = await readFile(path.join(repo, 'src/modules/whiteboard/tab.ts'), 'utf8');
const ftl = await readFile(path.join(repo, 'addon/locale/zh-CN/addon.ftl'), 'utf8');

// --- tiny Fluent reader: id = value (+ indented continuation lines), select on $count, $args ---
const messages = new Map();
let cur = null;
for (const line of ftl.split('\n')) {
  const m = line.match(/^([A-Za-z][\w-]*)\s*=\s*(.*)$/);
  if (m) { cur = {id: m[1], lines: [m[2]]}; messages.set(m[1], cur); continue; }
  if (cur && /^\s+\S/.test(line)) { cur.lines.push(line.trim()); continue; }
  if (!line.trim() || line.startsWith('#')) cur = null;
}
function format(id, args = {}) {
  const msg = messages.get(id);
  if (!msg) return undefined;
  let text = msg.lines.filter(Boolean).join('\n');
  if (text.includes('->')) {
    const variants = {}; let def = null;
    for (const v of text.matchAll(/(\*?)\[(\w+)\]\s*([^\n]*)/g)) { variants[v[2]] = v[3].trim(); if (v[1]) def = v[2]; }
    const n = Number(args.count);
    const key = n === 1 && variants.one !== undefined ? 'one' : (variants.other !== undefined ? 'other' : def);
    text = variants[key] ?? variants[def];
  }
  return text.replace(/\{\s*\$(\w+)\s*\}/g, (_, name) => (args[name] !== undefined ? String(args[name]) : `{${name}}`)).trim();
}

// --- labels block of tab.ts: `key: getString("id"[, {args: {...}}])`, possibly across lines ---
const start = tab.indexOf('labels: {');
const block = tab.slice(start, tab.indexOf('\n    },\n', start));
const labels = {};
const missing = [];
for (const m of block.matchAll(/(\w+):\s*getString\(\s*(?:[^"]*?\?\s*)?"([\w-]+)"\s*(?:,\s*\{\s*args:\s*\{([^}]*)\}\s*\})?/g)) {
  const [, key, id, rawArgs] = m;
  if (['one', 'other'].includes(key)) continue;
  const args = {};
  for (const a of (rawArgs || '').matchAll(/(\w+):\s*("([^"]*)"|\d+)/g)) args[a[1]] = a[3] ?? Number(a[2]);
  const value = format(id, args);
  if (value === undefined) missing.push(`${key} -> ${id}`); else labels[key] = value;
}
// plural object and the window-switch ternary (surface === "window" ? tab : window)
labels.annotations = {one: format('whiteboard-annotations', {count: 1}), other: format('whiteboard-annotations', {count: 2})};
labels.switchWindow = format('more-open-window') ?? labels.switchWindow;

await mkdir('src/fixtures', {recursive: true});
await writeFile('src/fixtures/wb-labels.zh.json', JSON.stringify(labels, null, 2) + '\n');
console.log(JSON.stringify({labels: Object.keys(labels).length, missing}));
