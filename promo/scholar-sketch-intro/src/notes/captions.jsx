// Band captions for #8–#10 (layout T). Copy is plan.json's headline / description; only manual line
// breaks are added (band title column 820px at 56px, description column 848px at 32px).
import React from 'react';
import {Caption, revealCaption} from '../stage/captions.jsx';
import {shot} from '../engine.js';

const BREAKS = {
  write: {desc: '表格、公式和待办直接显示排好的样子，\n边写边排版。'},
  links: {desc: '文库里的论文、笔记和白板都能搜到，\n点一下就插入链接。'},
  backlinks: {},
};
// write: the title waits for the page turn (32.00–32.70) to finish
const REVEAL = {write: {at: 0.75}, links: {}, backlinks: {}};

export const captionView = id => function NoteCaption() {
  return <Caption id={id} variant="band" {...BREAKS[id]} />;
};
export const captionBuilder = id => tl => {
  const s = shot(id);
  tl.set(`section[data-shot="${id}"]`, {opacity: 1}, s.start);
  revealCaption(tl, id, REVEAL[id]);
};
export const CAPTION_BREAKS = BREAKS;
