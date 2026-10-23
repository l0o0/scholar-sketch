// CJK fonts are split by unicode-range and load lazily; a glyph that first appears mid-film could render one
// frame in a fallback face. Load every glyph the film can show, for every family/weight, before frame 0.
import {NOTE_TEXT, OTHER_NOTES, ITEMS} from '../library/fixture.js';
import labels from '../fixtures/wb-labels.zh.json';
import ftl from '@addon/locale/zh-CN/addon.ftl';

/** Text that appears only later (typed input, product menus, popups). */
export const EXTRA_GLYPHS = [NOTE_TEXT, ...Object.values(OTHER_NOTES), JSON.stringify(ITEMS), JSON.stringify(labels), ftl,
  '把小绿地连成网络再验证另见公园阅读整理思考示意桌面版支持文档白板'].join('');
const FACES = [['Film Sans SC', [300, 400, 500, 600, 700, 900]], ['PingFang SC', [400, 700]]];

export async function preloadGlyphs(doc, text) {
  const chars = [...new Set(text)].filter(c => c.codePointAt(0) > 0x2e7f).join('');
  const jobs = [];
  for (const [family, weights] of FACES) for (const w of weights) jobs.push(doc.fonts.load(`${w} 16px "${family}"`, chars).catch(() => []));
  await Promise.all(jobs);
}
