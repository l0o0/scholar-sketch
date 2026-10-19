// The film's frame system (DIRECTION.md §5). All values are 1080p frame pixels.
export const FRAME = {w: 1920, h: 1080};
export const SAFE = {left: 96, right: 96, top: 56, bottom: 140};   // film copy stays above y = 940

/** Product windows have a fixed base size; layouts only move/scale them (transform, origin top-left),
 *  so the product inside never re-lays out while the film changes layout. */
export const BOARD_WIN = {w: 1248, h: 968, scale: 1.85};    // WhiteboardApp at S = 1.85 → 674.6 × 523.2 product px
export const NOTE_WIN = {w: 1792, h: 774, scale: 1.6};      // Markdown tab at 1.6 → 1120 × 483.75 product px

/** Window placements per layout: {x, y, s}. */
export const LAYOUT = {
  // L — chapter 1 (研究白板): margin notes on the left, board window on the right.
  L: {board: {x: 608, y: 56, s: 1}, margin: {x: 96, w: 464}},
  // T — chapter 2 (Markdown 笔记): copy in a top band, note window full width below.
  T: {note: {x: 64, y: 250, s: 1}, band: {x: 96, y: 56, h: 180}},
  // D — #11 深色: two pages on the desk, note behind-left, board in front-right; copy in the top band.
  D: {note: {x: 64, y: 252, s: 0.62}, board: {x: 956, y: 300, s: 0.72}, band: {x: 96, y: 56, h: 180}},
};

export const COLOR = {
  paper: '#f2f2ee', paperDark: '#1a2527', ink: '#1a2527', sage: '#718b7a',
  title: '#1a2527', body: '#454d50', muted: '#596066', hint: '#9aa1a0',
  titleDark: '#e8eaed', bodyDark: '#b4bcc6', mutedDark: '#9aa3b2',
};

/** Shot window helper: time of a named action in film seconds. */
import plan from '../../plan.json';
export function actionTime(actionId) {
  for (const s of plan.shots) for (const a of s.actions || []) if (a.id === actionId) return s.start + a.at;
  throw new Error(`Unknown action "${actionId}"`);
}
export const shotOf = id => plan.shots.find(s => s.id === id);
