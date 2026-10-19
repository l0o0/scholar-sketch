// node tools/probe-shot.mjs <qs> <t> <script.js> <out.png>: seek, run an async page script (may click), screenshot.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {serve} from '../server.mjs';
const [qs = '', t = '5', file, out = '/tmp/probe.png'] = process.argv.slice(2);
const plan = JSON.parse(await readFile('plan.json', 'utf8'));
const body = await readFile(file, 'utf8');
const {server, url} = await serve();
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
try {
  const page = await browser.newPage({viewport: {width: plan.width, height: plan.height}});
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror ' + e.message));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.type() + ' ' + m.text()); });
  await page.goto(url + (qs ? '?' + qs : ''), {waitUntil: 'networkidle'});
  await page.evaluate(() => window.__filmReady);
  await page.evaluate(x => window.seek(x), Number(t));
  const res = await page.evaluate(`(async () => { ${body} })()`);
  await page.screenshot({path: out});
  console.log(JSON.stringify({res, errors}, null, 1));
} finally { await browser.close(); server.close(); }
