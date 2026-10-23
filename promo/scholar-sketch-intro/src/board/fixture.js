// Chapter 1 "研究白板" fixture board (DIRECTION.md shot table #3–#7), built only with the product's own model
// helpers (packages/whiteboard/src/model) the way model/tutorial.ts builds the onboarding board, then checked by
// the product's own parseCanvasDocument. Literature / Zotero-note cards take source + snapshot from the
// production source gateway (src/board/library.js). All text is invented for the film's demo project 公园冷岛.
//
// Layout (flow px); every camera beat of the chapter frames a part of it:
//   y 0     group 公园尺度 (928 × 268). The slot at (20, 48) is EMPTY: the main paper is dropped there (#3).
//           "添加所选批注" then places its two quotes at slot.x + 304 and slot.x + 608
//           (sourceState.ts createQuoteBatchRuntime), which fills the group; the claim made from the second
//           quote lands at quote.x + 328 (continuation.ts createNoteFromQuote), right of the group (#5).
//   y 288   GREENWAY literature card right under the slot (manual green = format-painter source, #6; 136 tall so
//           the dropped paper + this card fit between the top toolbar and the painter status bar at zoom 1.0),
//           the claim card (hub of the existing 支持 / 反驳 / 相关 connections), the question card.
//   y 499   align row (#7): the reading-note card starts 61 px LOWER (y 560) and LEFT of a wide gap, the evidence
//           and summary cards sit together on the right. All three are 140 tall, so between y 560 and 499 none of the
//           note's edges or centre meets another card's (the product would snap and draw a guide there); the row is
//           off the 16 px grid so the last step into the row is the product's alignment snap, not a grid step.
//           The row starts below what the painter framing shows (#6 shows flow y 48–498).
import {
  CANVAS_DOCUMENT_VERSION,
  createAcademicNode,
  createAcademicConnection,
  parseCanvasDocument,
  colorPalette,
} from '@wb/model';

// Product palette (model/colorSchemes.ts, "traditional"); the colour picker lists light tints first in the
// light theme (colorPalette(lightFirst)): fill #dcece3, stroke #519a73 and the family's dark shade #2b5c43 as
// text colour — what a user picks for a green card. A manual text colour keeps the title readable when the
// system later turns dark (#11): manual styles are kept as they are by the product in either theme.
const greenFor = theme => { const p = colorPalette(theme !== 'dark', 'traditional'); return {fill: p[2], stroke: p[8], textColor: colorPalette(true, 'traditional')[14]}; };

/** Card ids used by the chapter's driver and cameras. `lit` is the id the drop step gives the dropped paper. */
export const IDS = {
  frame: 'film-frame-park', lit: 'film-lit-park', greenway: 'film-lit-greenway',
  question: 'film-question', claim: 'film-claim', evidence: 'film-evidence', summary: 'film-summary',
  zNote: 'film-zotero-note',
};
/** Where the dropped paper's top-left lands (flow px), and the align row with the reading note's offset. */
export const SLOT = {x: 20, y: 48};
export const ALIGN = {rowY: 499, drop: 61, h: 140};
/** Board extents after the whole chapter (flow px): group + the claim created right of it + the align row. */
export const EXTENT = {x0: 0, y0: 0, x1: 1216, y1: ALIGN.rowY + ALIGN.drop + ALIGN.h};

export function buildFilmBoard(acquire, {viewport = {x: 230, y: 52, zoom: 1}, theme = 'light'} = {}) {
  const GREEN = greenFor(theme);
  const lit = (id, key, x, y, extra = {}) => {
    const a = acquire(key);
    return {...createAcademicNode('literature', {x, y}, id, {source: a.source, snapshot: a.snapshot}), ...extra};
  };
  const note = (id, x, y, width, height, content, noteType, extra = {}) =>
    ({...createAcademicNode('note', {x, y}, id, {width, height, content, ...(noteType ? {noteType} : {})}), ...extra});

  const frame = {...createAcademicNode('frame', {x: 0, y: 0}, IDS.frame), width: 928, height: 268, title: '公园尺度'};
  // Second paper, styled by hand with the product palette: the source the format painter copies from (#6).
  const greenway = lit(IDS.greenway, 'GREENWAY', SLOT.x, 288, {height: 136, style: {...GREEN, strokeWidth: 2, radius: 12}});
  const claim = note(IDS.claim, 364, 288, 236, 130, '把小绿地连成网络，比单独扩大公园更有效。', 'claim');
  const question = note(IDS.question, 664, 288, 216, 100, '小绿地能不能也降温？', 'question');
  // Align row: the reading note (a Zotero note card, linked to the library note) starts 61 px low at x 32 (on the
  // grid, and 12 px off the literature cards' left edges so no vertical guide shows while it moves; 196 wide so
  // 冷岛约为公园半径的 1.5 倍； stays on one line). The 84 px gap
  // to the evidence card is where the product's guide crosses empty canvas.
  const zn = acquire('PARKNOTE');
  const zNote = {...note(IDS.zNote, 32, ALIGN.rowY + ALIGN.drop, 196, ALIGN.h, zn.content), source: zn.source,
    ...(zn.sourceSnapshot ? {sourceSnapshot: zn.sourceSnapshot} : {})};
  const evidence = note(IDS.evidence, 312, ALIGN.rowY, 136, ALIGN.h, '大公园的降温强度是小绿地的 3 倍。', 'evidence');
  const summary = note(IDS.summary, 472, ALIGN.rowY, 136, ALIGN.h, '面积有阈值，连通性也许更关键。', 'summary');

  const nodes = [frame, greenway, claim, question, zNote, evidence, summary];
  const connections = [
    {...createAcademicConnection('film-c-greenway-claim', greenway.id, claim.id, 'supports'), color: '#2f855a', arrow: true, sourceHandle: 'right', targetHandle: 'left'},
    {...createAcademicConnection('film-c-evidence-claim', evidence.id, claim.id, 'contradicts'), color: '#c2413a', dashed: true, arrow: true, sourceHandle: 'top', targetHandle: 'bottom'},
    {...createAcademicConnection('film-c-question-claim', question.id, claim.id, 'related'), sourceHandle: 'left', targetHandle: 'right'},
  ];
  const doc = {version: CANVAS_DOCUMENT_VERSION, nodes, connections, viewport, metadata: {title: '公园尺度研究'}};
  const parsed = parseCanvasDocument(doc);   // the product's own validator
  if (parsed.issues?.length) console.warn('[film] fixture board issues', parsed.issues);
  return parsed.document;
}
