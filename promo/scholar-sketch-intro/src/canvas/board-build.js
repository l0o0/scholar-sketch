// Chapter 1 "研究白板" — ONE board driver for the whole range the board layer is on screen (7.5–50.2):
// real interactions with the production WhiteboardApp at the plan's action times, the in-product camera
// (xyflow setViewport) and the window "camera" (GSAP on .cv-win), plus the film cursor / drag ghost.
//
// Seek safety: steps are discrete real interactions that run once, in order; seeking backwards restores the
// board with the product's own runtime.loadSnapshot() and replays the steps. Before each step the time-driven
// context (window pose on the master timeline, xyflow viewport, theme) is brought to that step's own time,
// so a step behaves the same whether we got there by playing forward or by jumping.
import {onDriveRange, onRenderRange, frame} from '../engine.js';
import {actionTime, LAYOUT, BOARD_WIN} from '../stage/layout.js';
import {$, $$, nodeEl, at, realClick, hover, drag, contextClick} from '../board/drive.js';
import {screenRect} from '../board/local-space.js';
import {IDS, SLOT, ALIGN} from '../board/fixture.js';
import {KEYS, ITEMS} from '../library/fixture.js';
import labels from '../fixtures/wb-labels.zh.json';
import {flushSync} from 'react-dom';
import {wb, initialBoard, S, PW, PH, DARK_AT, STRIP_ROWS, systemTheme, themeAt} from './board-layer.jsx';

const A = id => actionTime(id);
export const T = {
  on: 7.5, slideEnd: 8.4, grab: A('drop-grab'), release: A('drop-release'), stripOut: 10.1, pushFrom: 10.7,
  select: A('drop-select'), details: A('ann-details'), open: A('ann-open'), zoomOutFrom: 13.7,
  tick1: A('ann-tick-1'), tick2: A('ann-tick-2'), add: A('ann-add'), settleFrom: 15.9, settleTo: 16.9,
  // #5: pull out to the whole board, REST on it for 1.0 s inside the shot, push to the quote before the right-click
  overviewFrom: 18.0, overviewTo: 18.6, overviewHold: 19.6, pushQuoteTo: 20.3, context: A('cards-context'), newClaim: A('cards-new-claim'),
  // #6 opens on a hard cut to the painter framing (no whip pan between shots)
  typeFrom: 21.5, commitClaim: 22.95, paintFrom: 23.5, paintSelect: A('paint-select'), paintArm: A('paint-arm'),
  paintHover: 26.05, paintApply: A('paint-apply'), paintDeselect: 27.1,
  // #6 → #7: one calm 0.95 s move after the painter's deselect (27.10) and read hold
  alignFrom: 28.1, alignTo: 29.05, alignGrab: A('align-grab'), alignSnap: A('align-snap'), alignRelease: A('align-release'),
  alignDeselect: 30.95, cursorOff: 31.4, turnEnd: A('write-turn') + 0.7,
  darkOn: 45.9, darkFrom: 46.0, darkTo: 46.6, dark: DARK_AT, filesTurnEnd: A('files-turn') + 0.7,
};
// The reading note is dragged up ALIGN.drop (61) flow px: speeds up over 0.1 s, moves at 118 flow px/s, eases into
// the row. While it is more than 6 screen px from the row the product snaps it to its 16 px grid
// (smartGuides.ts computeSmartSnap), so the card visibly steps up with the pointer on frames 880 / 884 / 888
// (29.333 / 29.467 / 29.600); on frame 892 (29.733) it comes within the snap distance: it jumps 13 px into the row and
// the guide appears, 0.57 s before the release (30.30). align-snap is that frame.
const DRAG = {from: 29.2, accel: 0.1, speed: 118, ease: 0.06};
function dragMoved(t) {
  const {from, accel, speed: v, ease: c} = DRAG, d = ALIGN.drop, a0 = v * accel / 2, bEnd = d - v * c / 2;
  if (t <= from) return 0;
  if (t < from + accel) return a0 * ((t - from) / accel) ** 2;
  const tb = from + accel + (bEnd - a0) / v;
  if (t < tb) return a0 + v * (t - from - accel);
  const tau = Math.min(c, t - tb);
  return bEnd + v * tau - v * tau * tau / (2 * c);
}
/** The claim typed into the new card (real input into the product's textarea, 12 characters a second). */
export const CLAIM = {text: '小公园也该留出水面和林地。', cps: 12};

// ---------------------------------------------------------------- geometry helpers (product px = local px)
const TOP = 52;                                   // TopIsland band at the top of the app (kept clear of subjects)
const CENTER = {x: PW / 2, y: (PH + TOP) / 2};
const view = (cx, cy, zoom) => ({zoom, x: CENTER.x - cx * zoom, y: CENTER.y - cy * zoom});
const fitView = ({x0, y0, x1, y1}, pad = 14) => {
  const zoom = Math.min((PW - 2 * pad) / (x1 - x0), (PH - TOP - 2 * pad) / (y1 - y0));
  return view((x0 + x1) / 2, (y0 + y1) / 2, zoom);
};
const flowToLocal = (v, p) => ({x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y});
/** Viewport that puts flow point f at local (product px) point l. */
const place = (f, l, zoom) => ({zoom, x: l.x - f.x * zoom, y: l.y - f.y * zoom});
// Product chrome in local px (measured): top toolbar y 16–62, format-painter status y 465–507 (x 220–454),
// zoom controls x 633–659 / y 430–508.
const LIT = {x: SLOT.x, y: SLOT.y, w: 280, h: 200};                  // ACADEMIC_SOURCE_CARD_SIZE.literature
const Q2 = {x: SLOT.x + 608, y: SLOT.y, w: 280, h: 192};             // sourceState.ts QUOTE_LAYOUT (2nd column)
const ROW2 = {y: 288, x0: 20, x1: 600};                               // greenway … claim (the question card starts at 664)
// In-product camera views (xyflow viewport). `dot` is solved during the rehearsal (手法 3).
const views = {
  drop: {x: 222, y: 80, zoom: 1},                                     // the 反驳 label stays below the frame
  // #3→#4: the hero card on the LEFT of the board (local x 20, y 285 = frame y 583). With room on its right, the
  // product's placePropertiesPanel puts 详细属性 beside the card (it tries right / left before bottom / top), clear of
  // the selection style bar above the card, the top toolbar and the zoom controls (panel ends at local x 632); the
  // card title stays uncovered. Row 2 starts at the bottom edge, so no card or edge label is cut there.
  lit: place(LIT, {x: 20, y: 285}, 1.0),
  // settle after the dot-match jump: both quotes, the paper card fully OUT on the left (no sliver at the window edge)
  quotes: view(SLOT.x + 304 + (280 + 24 + 280) / 2 + 24, SLOT.y + 96 - 6, 1.0),
  // the whole board before #5's new claim: group + its two quotes (928 flow px wide), the five card types and the
  // align row with the reading note still in its low start position
  overview: fitView({x0: 0, y0: 0, x1: 928, y1: ALIGN.rowY + ALIGN.drop + ALIGN.h}, 10),
  // quote p.7 + the claim it grows (956–1216) at 1.1; row 2 (the question card, the 相关 edge and its label) just
  // below the frame, so nothing of it is cut at an edge
  q2: view(922, 72, 1.1),
  // #6 at zoom 1.0: the dropped paper (target, y 48) and the green source card (ends 424) fit between the toolbar
  // and the product's format-painter status bar, which then sits on empty canvas (the 反驳 label to its right);
  // the first quote and the claim are whole, the right edge falls just before the 相关 label; the frame ends at
  // flow y 498, just above the align row.
  paint: place({x: LIT.x, y: LIT.y}, {x: 86, y: 73}, 1.0),
  // #7 at zoom 1.0: row 2 fully below the toolbar (greenway top at local 96; the group's footers sit under the
  // toolbar), the align row at frame y 628–887 and the note's start position (bottom at frame y 999) in view.
  align: place({x: ROW2.x0, y: ROW2.y}, {x: 32, y: 96}, 1.0),
  // #11 dark (window at 0.70): only default-styled cards — both quotes, claim, question — at 1.1; the two mint
  // literature cards (x 20–300) are out on the left, the align row out below.
  dark: place({x: 616, y: Q2.y}, {x: 337, y: 88.8}, 1.1),       // the 反驳 label just below the frame
  dot: null,
};
// Camera keys: hold between equal views, ease (quad in-out; 'cubic' = power2.inOut) between different ones,
// `cut` = jump.
const CAM = [
  [T.on, 'drop'], [T.pushFrom, 'drop'], [T.select, 'lit'], [T.add, 'lit'], [T.add, 'dot', 'cut'],
  [T.settleFrom, 'dot'], [T.settleTo, 'quotes'], [T.overviewFrom, 'quotes'], [T.overviewTo, 'overview'],
  [T.overviewHold, 'overview'], [T.pushQuoteTo, 'q2'], [T.paintFrom, 'q2'], [T.paintFrom, 'paint', 'cut'],
  [T.alignFrom, 'paint'], [T.alignTo, 'align', 'cubic'],
  [T.darkOn - 0.1, 'align'], [T.darkOn - 0.1, 'dark', 'cut'],
];
const ease2 = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const ease3 = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
function viewportAt(t) {
  const v = name => views[name] || views.lit;
  if (t < CAM[0][0]) return v(CAM[0][1]);
  let cur = v(CAM[0][1]);
  for (let i = 1; i < CAM.length; i++) {
    const [at1, n1, mode] = CAM[i], [at0, n0] = CAM[i - 1];
    if (t < at1) {
      if (mode === 'cut' || n0 === n1) return v(n0);
      const u = (mode === 'cubic' ? ease3 : ease2)((t - at0) / (at1 - at0)), p = v(n0), q = v(n1);
      // interpolate the viewed centre and log-zoom so a push-in travels in a straight line on screen
      const z = Math.exp(Math.log(p.zoom) + (Math.log(q.zoom) - Math.log(p.zoom)) * u);
      const pc = {x: (CENTER.x - p.x) / p.zoom, y: (CENTER.y - p.y) / p.zoom}, qc = {x: (CENTER.x - q.x) / q.zoom, y: (CENTER.y - q.y) / q.zoom};
      return view(pc.x + (qc.x - pc.x) * u, pc.y + (qc.y - pc.y) * u, z);
    }
    cur = v(n1);
  }
  return cur;
}

// ---------------------------------------------------------------- product handles
const pane = () => $('.react-flow__pane');
const host = () => $('.zmd-board-host');
const snapshot = () => wb.runtime.getSnapshot();
const quoteId = annotationKey => snapshot().nodes.find(n => n.kind === 'quote' && n.source?.annotationKey === annotationKey)?.id;
const claimFromQuote = () => snapshot().nodes.find(n => n.kind === 'note' && n.noteType === 'claim' && n.id !== IDS.claim)?.id;
const byText = (sel, text) => $$(sel).find(el => el.textContent.trim().includes(text));
const annRow = text => $$('.zmd-board-annotation-group li').find(li => li.textContent.includes(text));
const ANN = {first: '公园面积超过 2 公顷后', second: '水体加林地降温'};
const settle = async () => {
  await new Promise(r => setTimeout(r, 0));
  // the board resolves sources on requestIdleCallback; let it run before the frame is taken
  await new Promise(r => (window.requestIdleCallback ? requestIdleCallback(r, {timeout: 60}) : setTimeout(r, 0)));
  await new Promise(r => setTimeout(r, 0));
  await frame(); await frame();
};
async function waitFor(cond, what, tries = 200) {
  for (let i = 0; i < tries; i++) { if (cond()) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error(`[canvas] timed out waiting for ${what}`);
}
const keydown = key => window.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
/** An empty spot of the canvas at film time t (flow point known to be free of cards and edges). */
const blankAt = (t, p) => flowToLocal(viewportAt(t), p);
const BLANK = {afterAdd: {x: 332, y: 278}, claim: {x: 1080, y: 250}, paint: {x: 332, y: 270}, align: {x: 330, y: 452}};
const editor = () => $('textarea.zmd-board-in-shape-edit');
const typedAt = t => Array.from(CLAIM.text).slice(0, Math.max(0, Math.min(Array.from(CLAIM.text).length, Math.floor((t - T.typeFrom) * CLAIM.cps) + 1))).join('');
function typeInto(value) {
  const field = editor();
  if (!field || field.value === value) return false;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', {bubbles: true}));
  return true;
}

// ---------------------------------------------------------------- steps (absolute film seconds)
// target(): element acted on; aim(el): where the pointer tip goes (product px) — an icon or the empty part of a card,
// never the middle of the words the viewer is reading; the real events are sent at that same point.
// point(): explicit point (empty canvas); click:false = no ripple.
const iconOf = el => at(el.querySelector('svg') || el);
const aimOf = step => { const el = step.target?.(); return step.point ? step.point() : step.aim ? step.aim(el) : at(el, step.fx ?? 0.5, step.fy ?? 0.5); };
let grabOffset = {x: 0, y: 0};
const STEPS = [
  {at: T.release, name: 'drop', point: () => blankAt(T.release, SLOT), async run() {
    const p = blankAt(T.release, SLOT);
    // what the Zotero host does after resolveNativeAcademicDrop accepts a `zotero/item` drag (tab.ts / editor.ts)
    wb.runtime.beginAcademicDrop('film-drop-1', IDS.lit, p, [{library: {type: 'user'}, itemKey: KEYS.paper}]);
    await waitFor(() => $('.zmd-board-notice button'), 'drop notice');
    realClick($('.zmd-board-notice button'));          // "已添加 1 个来源…" closed with its own ×, same seek step
  }},
  // the empty lower right of the card (below the tags)
  {at: T.select, name: 'select-lit', target: () => nodeEl(IDS.lit), fx: 0.75, fy: 0.66, run() { realClick(this.target(), aimOf(this)); }},
  {at: T.details, name: 'details', target: () => $('.zmd-board-style-bar .zmd-board-selection-details'), aim: iconOf, run() { realClick(this.target(), aimOf(this)); }},
  {at: T.open, name: 'open-annotations', target: () => byText('.zmd-board-properties button', labels.viewAnnotations), aim: iconOf, async run() {
    realClick(this.target(), aimOf(this));
    await waitFor(() => annRow(ANN.second), 'annotation list');
  }},
  {at: T.tick1, name: 'tick-1', target: () => annRow(ANN.first).querySelector('input'), run() { realClick(this.target(), aimOf(this)); }},
  {at: T.tick2, name: 'tick-2', target: () => annRow(ANN.second).querySelector('input'), run() { realClick(this.target(), aimOf(this)); }},
  // a text-only button: the tip at the left edge of its label
  {at: T.add, name: 'add-quotes', target: () => $('.zmd-board-annotation-browser > footer button'), fx: 0.1, fy: 0.6, async run() {
    realClick(this.target(), aimOf(this));
    await waitFor(() => quoteId('ANNOT002'), 'quote cards');
    await frame();
    // same step: close the properties panel and deselect (a click on empty canvas), so no chrome is anchored
    // to a selection when the viewport jumps
    realClick(pane(), blankAt(T.add - 1e-3, BLANK.afterAdd));
  }},
  // right-click in the empty part of the quote card, below its text
  {at: T.context, name: 'context-quote', target: () => nodeEl(quoteId('ANNOT002')), fx: 0.8, fy: 0.62, run() {
    contextClick(this.target(), aimOf(this));
  }},
  {at: T.newClaim, name: 'new-claim', target: () => byText('.zmd-board-context-menu button, [role="menu"] button', labels.quoteCreateClaim), aim: iconOf, async run() {
    realClick(this.target(), aimOf(this));
    await waitFor(() => claimFromQuote(), 'claim from quote');
  }},
  {at: T.commitClaim, name: 'commit-claim', point: () => blankAt(T.commitClaim, BLANK.claim), async run() {
    if (typeInto(CLAIM.text)) await frame();             // a jump straight here still commits the whole sentence
    realClick(pane(), blankAt(T.commitClaim, BLANK.claim));
  }},
  {at: T.paintSelect, name: 'select-source', target: () => nodeEl(IDS.greenway), fx: 0.85, fy: 0.45, run() { realClick(this.target(), aimOf(this)); }},
  {at: T.paintArm, name: 'arm-painter', target: () => $('.zmd-board-style-bar .zmd-board-format-paint'), aim: iconOf, run() { realClick(this.target(), aimOf(this)); }},
  {at: T.paintHover, name: 'hover-target', click: false, target: () => nodeEl(IDS.lit), fx: 0.82, fy: 0.52, run() { hover(this.target(), aimOf(this)); }},
  {at: T.paintApply, name: 'paint-target', target: () => nodeEl(IDS.lit), fx: 0.82, fy: 0.52, run() { realClick(this.target(), aimOf(this)); }},
  {at: T.paintDeselect, name: 'deselect-paint', point: () => blankAt(T.paintDeselect, BLANK.paint), run() { realClick(pane(), blankAt(T.paintDeselect, BLANK.paint)); }},
  // the header row of the note card, right of its 笔记 label
  {at: T.alignGrab, name: 'grab-note', target: () => nodeEl(IDS.zNote), fy: 0.14, run() {
    const p = aimOf(this); drag.start = p; drag.down(this.target(), p);
  }},
  {at: T.alignRelease, name: 'release-note', click: false, async run() {
    drag.move(dragPoint(ALIGN.drop)); await frame();     // a jump straight here still ends the drag where it should
    drag.up(dragPoint(ALIGN.drop)); drag.start = null;
  }},
  {at: T.alignDeselect, name: 'deselect-note', point: () => blankAt(T.alignDeselect, BLANK.align), run() { realClick(pane(), blankAt(T.alignDeselect, BLANK.align)); }},
];
// With local-space.js the drag runs in product px: a flow delta d is a mouse delta d × xyflow zoom.
// xyflow spends the 2 px kick on its drag threshold, so after it the card follows the mouse 1:1 (÷ zoom).
// m = flow px moved since the kick (dragMoved).
const dragPoint = m => ({x: drag.start.x, y: drag.start.y - 2 - m * views.align.zoom});

// ---------------------------------------------------------------- context (window pose, viewport, theme)
let master = null;
async function applyContext(t) {
  master.seek(t, true);                                  // window pose / layer visibility for this time
  const layer = document.querySelector('.layer-board');
  if (layer) layer.style.clipPath = '';                  // the page-turn hook re-clips after the drivers ran
  const theme = themeAt(t);
  if (systemTheme.get() !== theme) flushSync(() => systemTheme.set(theme));
  if (host()?.dataset.theme !== theme) await waitFor(() => host()?.dataset.theme === theme, 'theme ' + theme);
  const want = viewportAt(t), cur = wb.flow.getViewport();
  if (Math.abs(cur.x - want.x) + Math.abs(cur.y - want.y) + Math.abs(cur.zoom - want.zoom) * 100 <= 0.005) return;
  await wb.flow.setViewport(want, {duration: 0});
  // WhiteboardApp re-anchors its chrome in xyflow's onMoveEnd (fired from setTimeout 0)
  await new Promise(r => setTimeout(r, 0)); await frame(); await frame();
}
let done = 0;
async function reset() {
  if (drag.start) { try { drag.up(drag.start); } catch {} drag.start = null; }
  keydown('Escape');                                     // product: closes menus / properties panel, painter
  wb.runtime.loadSnapshot(initialBoard);                 // product: restores the document, closes editors
  await settle();
  if ($$('.react-flow__node.selected').length) realClick(pane(), {x: 4, y: PH - 4});
  done = 0;
  await settle();
}
// plan times like 15.167 fall 0.3 ms after the 30 fps frame 15.1667: let a step land on that frame
const FRAME_EPS = 0.002;
async function driveTo(t) {
  const want = STEPS.filter(s => t >= s.at - FRAME_EPS).length;
  if (want < done) await reset();
  while (done < want) {
    const s = STEPS[done];
    await applyContext(s.at - 1e-4);
    await s.run();
    done++;
    await settle();
  }
  await applyContext(t);
  if (t >= T.typeFrom && done === STEPS.findIndex(s => s.name === 'commit-claim')) {
    if (typeInto(typedAt(t))) await frame();
  }
  if (t >= DRAG.from && drag.start && done === STEPS.findIndex(s => s.name === 'release-note')) {
    drag.move(dragPoint(dragMoved(t)));
    await frame();
  }
  // Capture-browser workaround (see canvas.css .cv-win): after the product state has painted once, flip the
  // window's overflow between visible and clip — identical pixels, but Chromium then repaints the scaled
  // product subtree from the current DOM instead of keeping stale paint from before the interaction.
  await frame(); await frame();
  const win = document.querySelector('.layer-board .cv-win');
  win.style.overflow = win.style.overflow === 'clip' ? 'visible' : 'clip';
}

// ---------------------------------------------------------------- cursor path (measured in the rehearsal)
// The pointer is on screen only while it acts: each window starts with the pointer coming in towards its first
// target and ends after its last action (fades of 0.12 s). It is hidden while the camera moves without it (the
// push before #3's select, the dot-match jump and settle, #5's overview, the typing, the cut, the painter → align
// move), so it never slides over the board in screen space.
const SHOW = [[8.15, 10.25], [11.3, 15.95], [19.95, 21.4], [22.4, 23.3], [23.9, 27.45], [28.8, T.cursorOff]];
const FADE = 0.12;
const ENTER = {x: 64, y: 84};                            // a window's first move starts this far below-right of its target
const cursor = {keys: [], clicks: []};
const TRAVEL = 0.62;
function addKey(at, p) { cursor.keys.push({at, x: p.x, y: p.y}); }
// Constant on-screen size: the arrow is 26 px tall in its own px; the overlay is scaled by the product scale S and
// the window pose, so counter-scale to 30 frame px. (The overlay is outside the xyflow viewport: its zoom does
// not apply.)
const CURSOR_PX = 30, ARROW_PX = 26;

// ---------------------------------------------------------------- builder
export async function buildBoardLayer(tl) {
  master = tl;
  const layer = document.querySelector('.layer-board');
  const win = layer.querySelector('.cv-win'), header = layer.querySelector('.cv-header'), strip = layer.querySelector('.cv-strip');
  const L = LAYOUT.L.board, D = LAYOUT.D.board;
  // layer visibility: on with the chapter, off between the first page turn and #11, off after the second turn
  tl.set(layer, {opacity: 0}, 0);
  tl.set(layer, {opacity: 1}, T.on);
  tl.set(layer, {opacity: 0}, T.turnEnd + 0.05);
  tl.set(layer, {opacity: 1}, T.darkOn);
  tl.set(layer, {opacity: 0}, T.filesTurnEnd);
  // chapter header: the icon lands at 7.5 (the entry shot's flying icon), the name and sage rule fade in
  const name = header.querySelector('.cv-header-name');
  tl.set(header, {opacity: 0, '--cv-rule': 0}, 0);
  tl.set(name, {opacity: 0, y: 8}, 0);   // the name fades in after T.on; keep it hidden on the frames before
  tl.set(header, {opacity: 1}, T.on);
  tl.fromTo(name, {opacity: 0, y: 8}, {opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', immediateRender: false}, T.on + 0.05);
  tl.fromTo(header, {'--cv-rule': 0}, {'--cv-rule': 1, duration: 0.4, ease: 'power2.out', immediateRender: false}, T.on + 0.2);
  tl.set(header, {opacity: 0}, T.turnEnd);
  // board window: slides in from the right (layout L); window camera 0.92 for the annotation popup; layout D in #11
  const zoomed = {x: L.x + BOARD_WIN.w * 0.04, y: L.y + BOARD_WIN.h * 0.04, scale: 0.92};
  tl.set(win, {x: FRAME_OFF, y: L.y, scale: 1, transformOrigin: '0 0'}, 0);
  tl.fromTo(win, {x: FRAME_OFF, y: L.y, scale: 1}, {x: L.x, y: L.y, scale: 1, duration: T.slideEnd - T.on, ease: 'power2.inOut', immediateRender: false}, T.on);
  tl.fromTo(win, {x: L.x, y: L.y, scale: 1}, {...zoomed, duration: 0.4, ease: 'power2.inOut', immediateRender: false}, T.zoomOutFrom);
  tl.fromTo(win, {...zoomed}, {x: L.x, y: L.y, scale: 1, duration: T.settleTo - T.settleFrom, ease: 'power2.inOut', immediateRender: false}, T.settleFrom);
  tl.fromTo(win, {x: FRAME_OFF, y: D.y, scale: D.s}, {x: D.x, y: D.y, scale: D.s, duration: T.darkTo - T.darkFrom, ease: 'power2.inOut', immediateRender: false}, T.darkFrom);
  // the sample-library strip: drop beat only
  tl.set(strip, {opacity: 0}, 0);
  tl.set(strip, {opacity: 1}, T.on);
  tl.to(strip, {opacity: 0, duration: 0.6, ease: 'power1.inOut'}, T.stripOut);

  // Fonts: unicode-range subsets load lazily; load every glyph the board can show before any frame is taken.
  const glyphs = [...new Set(JSON.stringify(labels) + JSON.stringify(initialBoard) + layer.textContent + CLAIM.text + '已添加个来源无法添加批注条从这条新建观点' + JSON.stringify(STRIP_ROWS) + JSON.stringify(ITEMS) + '\u00a0°')].join('');
  await Promise.all([
    ...['400', '700'].map(w => document.fonts.load(`${w} 16px "PingFang SC"`, glyphs).catch(() => [])),
    ...['400', '500', '700'].map(w => document.fonts.load(`${w} 16px "Film Sans SC"`, glyphs).catch(() => [])),
  ]);

  // Rehearse once: run the real steps with each step's own context, record where each click lands and solve
  // the dot-match viewport, then restore the board. The cursor path is measured, not guessed.
  await reset();
  const row = strip.querySelector('.cv-row');
  const rowLocal = {x: (strip.offsetLeft + row.offsetLeft + 64) / S, y: (strip.offsetTop + row.offsetTop + row.offsetHeight * 0.45) / S};
  grabOffset = {x: rowLocal.x - (strip.offsetLeft + row.offsetLeft) / S, y: rowLocal.y - (strip.offsetTop + row.offsetTop) / S};
  addKey(SHOW[0][0], {x: rowLocal.x + 190, y: rowLocal.y + 96});     // enters from the canvas side
  addKey(T.grab, rowLocal);
  cursor.clicks.push(T.grab);
  let last = rowLocal;
  for (const step of STEPS) {
    await applyContext(step.at - 1e-4);
    const el = step.target?.();
    if (step.target && !el) throw new Error(`[canvas] step ${step.name}: target missing`);
    const p = step.point || step.target ? aimOf(step) : null;
    let popupDot = null;
    if (step.name === 'add-quotes') { const d = annRow(ANN.first).querySelector('.zmd-board-annotation-color'); popupDot = at(d); }
    if (p) {
      const prev = cursor.keys[cursor.keys.length - 1];
      const win = SHOW.find(([a, b]) => step.at >= a && step.at < b);
      if (win && prev.at < win[0]) {
        // first action of a window: come in from below-right of the target (hidden before the window starts)
        addKey(win[0] - 1e-3, last);
        addKey(win[0], {x: p.x + ENTER.x, y: p.y + ENTER.y});
        addKey(step.at, p);
      } else {
        const travel = step.name === 'drop' ? step.at - 0.13 - T.grab : Math.min(TRAVEL, step.at - prev.at - 0.12);
        addKey(step.at - travel - (step.name === 'drop' ? 0.13 : 0), last);
        addKey(step.at - (step.name === 'drop' ? 0.13 : 0), p);
        if (step.name === 'drop') addKey(step.at, p);
      }
      last = p;
    }
    if (step.click !== false) cursor.clicks.push(step.at - FRAME_EPS);
    await step.run();
    done++;
    await settle();
    if (popupDot) {
      // 手法 3: jump the viewport so the first new quote's yellow dot sits exactly where the popup's dot was
      const q = nodeEl(quoteId('ANNOT001')).querySelector('.zmd-board-quote-color'), v = wb.flow.getViewport();
      const d = at(q), flow = {x: (d.x - v.x) / v.zoom, y: (d.y - v.y) / v.zoom}, z = views.lit.zoom;
      views.dot = {zoom: z, x: popupDot.x - flow.x * z, y: popupDot.y - flow.y * z};
      dotCheck.popup = popupDot;
    }
    // the drag itself is drawn from the real pointer path (cursorAt); after the release it rests where it let go
    if (step.name === 'grab-note') { dragStart = {...drag.start}; last = dragPoint(ALIGN.drop); addKey(T.alignRelease, last); }
    // after arming the painter the brush leaves the 格式刷 button within 3 frames (up-right, towards the paper card
    // it will paint), then waits for the move to the target
    if (step.name === 'arm-painter') { last = {x: p.x + 100, y: p.y - 56}; addKey(step.at + 0.1, last); }
  }
  addKey(T.cursorOff, last);
  await reset();

  onDriveRange(T.on, T.filesTurnEnd, (_local, t) => driveTo(t));
  onRenderRange(T.on, T.filesTurnEnd, (_local, t) => renderOverlay(layer, t));
}
const FRAME_OFF = 1940;                                  // window parked just right of the frame
export const dotCheck = {popup: null};
window.__cvDot = dotCheck;

let dragStart = null;                                    // the note-card grab point measured in the rehearsal
/** Where the pointer tip is at film time t (product px): the measured key path, or the real drag path. */
function cursorAt(t) {
  if (dragStart && t >= T.alignGrab - FRAME_EPS && t < T.alignRelease) {
    const m = t < DRAG.from ? 0 : dragMoved(t);
    return {x: dragStart.x, y: dragStart.y - 2 - m * views.align.zoom};
  }
  return pointAt(t);
}
function paintBoardCursor(el, t, win) {
  const o = Math.max(0, ...SHOW.map(([a, b]) => Math.min(1, (t - a) / FADE, (b - t) / FADE)));
  el.style.opacity = String(o);
  if (!o) return;
  const p = cursorAt(t);
  const k = CURSOR_PX / (ARROW_PX * S * (screenRect(win).width / BOARD_WIN.w || 1));
  el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${k})`;
  const since = cursor.clicks.map(c => t - c).filter(d => d >= 0 && d < 0.45)[0];
  el.querySelector('svg').style.transform = since !== undefined && since < 0.18 ? `scale(${0.84 + 0.16 * since / 0.18})` : '';
  const r = el.querySelector('.film-ripple');
  r.style.opacity = since !== undefined ? String(1 - since / 0.45) : '0';
  r.style.transform = since !== undefined ? `scale(${0.4 + since * 3})` : '';
}

/** Film overlay: cursor (or the product's own painter cursor), the strip row highlight, the drag ghost. */
function renderOverlay(layer, t) {
  const el = layer.querySelector('.film-cursor');
  paintBoardCursor(el, t, layer.querySelector('.cv-win'));
  const painting = !!layer.querySelector('.zmd-board-host.is-format-painter');
  const svg = el.querySelector('svg'); let img = el.querySelector('img');
  if (painting) {
    const m = getComputedStyle(layer.querySelector('.react-flow__pane')).cursor.match(/url\("?(.*?)"?\)/);
    if (m && !img) { img = document.createElement('img'); el.prepend(img); }
    if (m) img.src = m[1];
  }
  if (img) img.style.display = painting ? 'block' : 'none';
  svg.style.display = painting ? 'none' : 'block';
  const grabbed = t >= T.grab && t < T.release;
  layer.querySelector('.cv-row.is-first').classList.toggle('is-grabbed', grabbed);
  const ghost = layer.querySelector('.cv-ghost');
  if (grabbed) {
    const p = pointAt(t);
    ghost.style.opacity = t < T.grab + 0.1 ? String((t - T.grab) / 0.1) : '1';
    ghost.style.transform = `translate(${p.x - grabOffset.x}px, ${p.y - grabOffset.y}px)`;
  } else ghost.style.opacity = '0';
}
const easeCur = x => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2);
function pointAt(t) {   // same interpolation as paintCursor
  const k = cursor.keys; let p = k[0];
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t >= b.at) { p = b; continue; }
    if (t >= a.at) { const u = easeCur((t - a.at) / (b.at - a.at)); p = {x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u}; }
    break;
  }
  return p;
}
