// Spike helper: node measure-md.mjs <outPng>  -> on-screen font sizes at t=5 + a dark-theme popup still
import {chromium} from 'playwright';
import {serve} from '../server.mjs';
const out = process.argv[2];
const {server, url} = await serve();
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
await page.goto(url, {waitUntil: 'networkidle'});
await page.evaluate(() => window.__filmReady);
await page.evaluate(() => window.seek(5));
console.log(JSON.stringify(await page.evaluate(() => {
  const {ed} = window.__md.md; const d = ed.doc(); const W = ed.iframe.contentWindow;
  const scale = ed.iframe.getBoundingClientRect().width / ed.iframe.offsetWidth;
  const px = (el, w = window) => el ? +(parseFloat(w.getComputedStyle(el).fontSize) * scale).toFixed(1) : null;
  const sec = document.querySelector('section[data-shot="md"]');
  return {scale: +scale.toFixed(3),
    body: px(d.querySelector('.cm-line:not(.zmd-lp-h1):not(.zmd-lp-h2)'), W), h1: px(d.querySelector('.cm-line.zmd-lp-h1'), W), h2: px(d.querySelector('.cm-line.zmd-lp-h2'), W),
    table: px(d.querySelector('.zmd-lp-table-cell'), W),
    popupTitle: px(d.querySelector('.zmd-link-results [role=option] span span'), W), popupKind: px(d.querySelector('.zmd-link-results [role=option] span span:last-child'), W), popupFilter: px(d.querySelector('.zmd-link-filters button'), W),
    outlineItem: px(sec.querySelector('.zotero-markdown-outline-item')), sidebarTitle: px(sec.querySelector('.zotero-markdown-sidebar-title')),
    backlinkTitle: px(sec.querySelector('.zmd-backlinks summary')), backlinkBody: px(sec.querySelector('.zmd-backlinks li, .zmd-backlinks button:not(.zmd-backlinks-refresh), .zmd-backlinks p')),
    missingZoteroIcons: [...(W.__filmMissingIcons || [])]};
})));
// dark theme with the popup open (theme is a seekable state: pref + applyMarkdownEditorPreferences)
await page.evaluate(async () => { const {ed} = window.__md.md; ed.setTheme('dark'); await new Promise(r => setTimeout(r, 200)); });
await page.screenshot({path: out});
await browser.close(); server.close();
