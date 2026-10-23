// Chapter 2 (Markdown 笔记) timing. Every time comes from plan.json through actionTime()/shotOf();
// the few in-between beats (DIRECTION.md §6 #8–#11) are written relative to those anchors.
// All thresholds sit on the frame grid (actionTime() is frame-snapped; in-between beats are snapped
// here) and are compared with past(t, x), so every layer flips on the same frame as the board / the cue.
import plan from '../../plan.json';
import {actionTime, shotOf} from '../stage/layout.js';

export const EPS = 1e-6;
/** t has reached threshold x (x on the frame grid; t = frame / fps). */
export const past = (t, x) => t >= x - EPS;
const snap = x => Math.round(x * plan.fps) / plan.fps;

const write = shotOf('write'), links = shotOf('links'), back = shotOf('backlinks'), dark = shotOf('dark');
const writeType = actionTime('write-type');          // 33.50 真实输入一行待办
const linksType = actionTime('links-type');          // 37.30 真实输入“原文见 [[公园”
const linksPopup = actionTime('links-popup');        // 37.90 引用选择器弹出（已有结果）

// Typing as it lands in the editor: ASCII key by key, Chinese as IME commits (whole words), at offsets (s)
// from the action time; a unit lands on the first frame at or after its time.
// #9: the popup opens exactly once, already narrowed to the 公园 results: the second “[” lands together with
// the 公园 commit on links-popup (37.90), so the picker never shows its unfiltered 9-row state.
export const TODO_UNITS = [[0, '-'], [0.07, ' '], [0.14, '['], [0.21, ' '], [0.28, ']'], [0.35, ' '],
  [0.5, '把'], [0.66, '小绿地'], [0.84, '连成'], [1.0, '网络'], [1.14, '再'], [1.28, '验证']];   // last 34.78
export const LINK_UNITS = [[0, '原文见'], [0.15, ' '], [0.395, '['], [0.595, '[公园']];   // last 37.895 → frame 37.90
const joinUnits = units => units.map(([, s]) => s).join('');
export const TODO_TEXT = joinUnits(TODO_UNITS);     // '- [ ] 把小绿地连成网络再验证'
export const LINK_QUERY = joinUnits(LINK_UNITS);    // '原文见 [[公园'
/** Text typed by film time t (pure). */
export const typedUnits = (units, t, at) => units.filter(([o]) => t >= at + o - EPS).map(([, s]) => s).join('');
export const PAPER_TITLE = '城市公园冷岛效应的尺度阈值';

const backHover = actionTime('back-click');          // 43.833 pointer rests beside the first backlink
export const T = {
  layerOn: write.start,                               // 32.00: the first turn starts; the paper sheet under the board page hides it until the crease passes
  turn: actionTime('write-turn'),                     // 32.00 page turn reveals chapter 2 (stage/turns.js)
  focusFrom: write.start,                             // the editor takes focus once its page is revealed
  scrollDown: [writeType - 0.5, writeType - 0.05],   // 33.00–33.45 scroll (wheel) down to 下一步: the note is taller than the window
  writeType,                                          // TODO_UNITS: last commit lands at 34.78
  writeEnter: snap(writeType + 1.4),                  // 34.90 Enter (real keymap: continues the task list) → checkbox
  linksStart: links.start,                            // 36.50 camera push to the end of paragraph 1 (→ 37.20)
  pushIn: [links.start, links.start + 0.7],
  scrollUp: [links.start - 0.05, links.start + 0.55],  // 36.45–37.05 scroll back to the top, inside the push
  linksCaret: snap(linksType - 0.1),                  // 37.20 caret placed at the end of paragraph 1
  linksType,                                          // LINK_UNITS: “[公园” commits at 37.895 (frame 37.90)
  linksPopup,
  cursorIn: snap(linksPopup + 0.55),                  // 38.47 pointer enters
  linksFilter: actionTime('links-filter'),            // 39.167 real click 常规条目
  linksInsert: actionTime('links-insert'),            // 39.833 real click on the paper
  caretOff: snap(40.1),                               // caret moves to the next line: the link collapses to blue text
  pullBack: [40.1, 40.75],                            // camera back to 1.6
  backStart: back.start,                              // 42.50 camera push to 引用此笔记 (→ 43.30)
  backPush: [back.start, back.start + 0.8],
  backHover,                                          // 43.833 pointer rests in the margin beside the first backlink
  backNext: [snap(backHover + 0.667), snap(backHover + 1.167)],   // 44.50–45.00 pointer moves down to the second backlink (no click)
  headerOut: dark.start - 0.3,                        // 45.70 chapter header leaves before #11
  darkMove: [dark.start, dark.start + 0.6],           // 46.00–46.60 note window to layout D (same beat as the board window)
  darkSwitch: actionTime('dark-switch'),              // 47.167 (frame 1415) real preference path → dark, same frame as the board
  layerOff: actionTime('files-turn') + 0.7,           // 50.20 end of the second page turn
};
