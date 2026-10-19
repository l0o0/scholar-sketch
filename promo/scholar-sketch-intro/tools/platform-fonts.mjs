import {chromium} from 'playwright';
import {serve} from '../server.mjs';
const {server, url} = await serve();
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  await page.goto(url, {waitUntil: 'networkidle'});
  await page.evaluate(() => window.__filmReady);
  await page.evaluate(() => window.seek(5)); await page.waitForTimeout(Number(process.env.WAIT || 0)); console.log(JSON.stringify(await page.evaluate(() => [...document.fonts].filter(f => f.status !== 'unloaded').map(f => f.status).reduce((a, s) => (a[s] = (a[s] || 0) + 1, a), {}))));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const {root} = await cdp.send('DOM.getDocument', {depth: -1});
  const out = {};
  for (const sel of ['.zmd-board-card-title', '.zmd-board-card-meta', '.zmd-board-card-content', '.react-flow__edge-text', '.zmd-board-top-island button']) {
    const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId, selector: 'section[data-shot="component"] ' + sel});
    if (!nodeId) continue;
    const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId});
    out[sel] = fonts;
  }
  console.log(JSON.stringify(out));
} finally { await browser.close(); server.close(); }
