// The film's two page turns (DIRECTION.md 手法 1): chapter 1 → chapter 2, and #11 (dark) → #12 (files).
import {registerTurns} from './fold.js';
import {actionTime} from './layout.js';

export function buildTurns(tl) {
  const toNotes = actionTime('write-turn');
  // The board layer is transparent around its window, so the outgoing page gets a paper sheet under it.
  tl.set('#paper-sheet', {opacity: 1}, toNotes);
  tl.set('#paper-sheet', {opacity: 0}, toNotes + 0.7);
  registerTurns([
    {id: 'to-notes', start: toNotes, dur: 0.7,
      outgoing: ['#paper-sheet', '.layer-board', 'section[data-shot="align"]'],
      release: actionTime('dark-switch') - 1.2},   // the board window comes back for #11
    {id: 'to-files', start: actionTime('files-turn'), dur: 0.7,
      outgoing: ['.layer-board', '.layer-note', 'section[data-shot="dark"]', '#paper-dark']},
  ]);
}
