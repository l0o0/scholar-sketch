// Fixture board for the whiteboard shot, built only with the product's own model helpers
// (packages/whiteboard/src/model) the same way model/tutorial.ts builds the onboarding board.
// Literature / quote / Zotero-note cards take source + snapshot from the production gateway.
import {
  CANVAS_DOCUMENT_VERSION,
  createAcademicNode,
  createAcademicConnection,
  parseCanvasDocument,
  colorPalette,
} from '@wb/model';

// Product palette (model/colorSchemes.ts, "traditional"). The colour picker lists light tints first in
// the light theme and dark shades first in the dark theme (colorPalette(lightFirst)); follow it so the
// styled card keeps the contrast a real user would get. Light: #dcece3 / #519a73, dark: #2b5c43 / #519a73.
const greenFor = theme => { const p = colorPalette(theme !== 'dark', 'traditional'); return {fill: p[2], stroke: p[8]}; };

/** Card ids used by the shot's drivers and camera. */
export const IDS = {
  frame: 'film-frame-park', litA: 'film-lit-park', quote: 'film-quote-threshold', litB: 'film-lit-greenway',
  question: 'film-question', claim: 'film-claim', zNote: 'film-zotero-note', md: 'film-markdown',
};

export function buildFilmBoard(acquire, {viewport = {x: 40, y: 72, zoom: 1}, theme = 'light'} = {}) {
  const GREEN = greenFor(theme);
  const lit = (id, key, x, y, extra = {}) => {
    const a = acquire(key);
    return {...createAcademicNode('literature', {x, y}, id, {source: a.source, snapshot: a.snapshot}), ...extra};
  };
  const quote = (id, key, x, y, extra = {}) => {
    const a = acquire(key);
    return {...createAcademicNode('quote', {x, y}, id, {source: a.source, snapshot: a.snapshot}), ...extra};
  };
  const note = (id, x, y, width, height, content, noteType, extra = {}) =>
    ({...createAcademicNode('note', {x, y}, id, {width, height, content, ...(noteType ? {noteType} : {})}), ...extra});

  // Group (frame) holding the paper and its highlight.
  const frame = {...createAcademicNode('frame', {x: 0, y: 0}, IDS.frame), width: 640, height: 268, title: '公园尺度'};
  const litA = lit(IDS.litA, 'PARKCOOL', 20, 48, {frameId: frame.id});
  const q1 = quote(IDS.quote, 'ANNOT001', 340, 52, {frameId: frame.id});
  const question = note(IDS.question, 720, 0, 260, 128, '小绿地能不能也降温？', 'question');
  const claim = note(IDS.claim, 720, 300, 260, 150, '把小绿地连成网络，比单独扩大公园更有效。', 'claim');
  // Styled with the product palette so the format painter has something visible to copy.
  const litB = lit(IDS.litB, 'GREENWAY', 360, 300, {style: {...GREEN, strokeWidth: 2, radius: 12}});
  // A Zotero note card (linked back to the library note; "refresh from Zotero" works on it).
  const zn = acquire('PARKNOTE');
  const zNote = {...note(IDS.zNote, 20, 330, 280, 150, zn.content), source: zn.source, ...(zn.sourceSnapshot ? {sourceSnapshot: zn.sourceSnapshot} : {})};

  const nodes = [frame, litA, q1, question, claim, litB, zNote];
  const connections = [
    {...createAcademicConnection('film-c-lit-quote', litA.id, q1.id, 'related'), color: '#64748b', dashed: true, arrow: false, label: ''},
    {...createAcademicConnection('film-c-quote-question', q1.id, question.id, 'related'), sourceHandle: 'right', targetHandle: 'left'},
    {...createAcademicConnection('film-c-greenway-claim', litB.id, claim.id, 'supports'), color: '#2f855a', arrow: true, sourceHandle: 'right', targetHandle: 'left'},
    {...createAcademicConnection('film-c-question-claim', question.id, claim.id, 'contradicts'), color: '#c2413a', dashed: true, arrow: true, sourceHandle: 'bottom', targetHandle: 'top'},
  ];
  const doc = {version: CANVAS_DOCUMENT_VERSION, nodes, connections, viewport, metadata: {title: '城市绿地降温'}};
  const parsed = parseCanvasDocument(doc);   // the product's own validator
  if (parsed.issues?.length) console.warn('[film] fixture board issues', parsed.issues);
  return parsed.document;
}
