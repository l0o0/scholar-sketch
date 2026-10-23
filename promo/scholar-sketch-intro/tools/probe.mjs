// Probe the built film in headless Chromium: node tools/probe.mjs <query-string> <t> <js-expression-file>
// Seeks to t, evaluates the expression file's default-exported function body in the page, prints JSON.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {serve} from '../server.mjs';
const [qs = '', t = '5', exprFile] = process.argv.slice(2);
const plan = JSON.parse(await readFile('plan.json', 'utf8'));
const body = exprFile ? await readFile(exprFile, 'utf8') : 'return null';
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
  const out = await page.evaluate(new Function(body));
  console.log(JSON.stringify({out, errors}, null, 1));
} finally { await browser.close(); server.close(); }
