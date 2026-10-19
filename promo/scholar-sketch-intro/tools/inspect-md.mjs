// Debug helper: node tools/inspect-md.mjs <shotId> <t...>  -> dump real product state after seek(t)
import {chromium} from 'playwright';
import {serve} from '../server.mjs';
const [id, ...rest] = process.argv.slice(2);
const times = rest.map(Number);
const {server, url} = await serve();
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
page.on('pageerror', e => console.log('pageerror', e.message));
page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) console.log('console.error', m.text()); });
await page.goto(url, {waitUntil: 'networkidle'});
await page.evaluate(() => window.__filmReady);
console.log('REC', JSON.stringify(await page.evaluate(id => { const r = window.__md[id].REC; return {navScroll: r.navScroll, sourceScroll: r.sourceScroll, chosenTail: r.chosen?.doc.slice(60, 200)}; }, id)));
for (const t of times) {
  const t0 = Date.now();
  await page.evaluate(x => window.seek(x), t);
  const ms = Date.now() - t0;
  console.log(t, ms + 'ms', JSON.stringify(await page.evaluate(id => {
    const {ed} = window.__md[id]; const v = ed.view(); const d = ed.doc();
    const p = d.querySelector('.zmd-link-completion'); const r = p?.getBoundingClientRect();
    const sec = document.querySelector(`section[data-shot="${id}"]`);
    return {
      mode: ed.mode(), focused: v.hasFocus, theme: sec.querySelector('.zotero-markdown-root').className.match(/theme-\w+/)[0],
      popup: p ? {filter: p.querySelector('button[aria-pressed="true"]')?.dataset.linkFilter, busy: p.querySelector('.zmd-link-results')?.getAttribute('aria-busy'),
        rows: [...p.querySelectorAll('[role=option]')].map(b => b.textContent), style: [p.style.left, p.style.top, p.style.width, p.style.visibility].join(' '), rectInOwnDoc: r && [r.x, r.y, r.width, r.height].map(Math.round)} : null,
      outline: [...sec.querySelectorAll('.zotero-markdown-outline-item')].map(b => (b.classList.contains('is-active') ? '*' : '') + b.textContent).join(' | '),
      scrollTop: v.scrollDOM.scrollTop, sel: v.state.selection.main.head, docLen: v.state.doc.length,
      fontPx: getComputedStyle(v.contentDOM).fontSize,
    };
  }, id)));
}
await browser.close(); server.close();
