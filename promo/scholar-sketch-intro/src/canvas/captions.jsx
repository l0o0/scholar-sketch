// Chapter 1 margin notes (layout L, DIRECTION.md 手法 4). Copy is plan.json headline / description / tag
// verbatim; only manual line breaks are added (title ≤ 8 characters a line, description ≤ 14, no orphan
// punctuation). Motion is the shared revealCaption (fade + rise) on the master timeline.
import React from 'react';
import {Caption, revealCaption} from '../stage/captions.jsx';
import {shot} from '../engine.js';

export const BREAKS = {
  drop: {title: '把文献拖进白板', desc: '从文库拖来一篇论文，\n就生成一张带作者、年份\n和期刊的文献卡片。'},
  annotations: {title: 'PDF 高亮，\n变成引文卡片', desc: '勾选 PDF 里的高亮，\n点“添加所选批注”，\n每条都变成一张\n带页码的引文卡片。'},
  cards: {title: '五种卡片，\n一条思路', desc: '问题、观点、证据、总结\n各有颜色和边框；\n从引文直接新建观点，\n自动连好线。'},
  painter: {title: '用格式刷\n复制样式', desc: '点“格式刷”再点另一张卡，\n颜色和边框复制过去，\n内容不变。'},
  align: {title: '拖动时自动对齐', desc: '靠近其他卡片会出现参考线，\n松手就贴齐。'},
};
const strip = s => s.replace(/\n/g, '');

const view = id => function CanvasCaption() {
  const b = BREAKS[id];
  return <Caption id={id} variant="margin" title={b.title} desc={b.desc} />;
};
export const CAPTION_VIEWS = Object.fromEntries(Object.keys(BREAKS).map(id => [id, view(id)]));

/** Fails the build if a manual break changed the plan's copy. */
export function checkCopy() {
  for (const [id, b] of Object.entries(BREAKS)) {
    const s = shot(id);
    if (strip(b.title) !== s.headline || strip(b.desc) !== s.description) throw new Error(`[canvas] caption copy for ${id} differs from plan.json`);
  }
}

export const captionBuilder = id => tl => {
  const s = shot(id);
  const section = document.querySelector(`section[data-shot="${id}"]`);
  tl.set(section, {opacity: 1}, s.start);
  // align stays on the page: the first page turn (32.0) takes it away with the board (src/stage/turns.js)
  revealCaption(tl, id, id === 'align' ? {exit: false} : {});
};
