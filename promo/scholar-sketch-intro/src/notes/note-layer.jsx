// Layer "note": the chapter-2 page (DIRECTION.md §5.2 layout T, §6 #8–#11). It sits under the board layer;
// the first page turn (32.0, stage/turns.js) reveals it already in its chapter-2 state.
//   - chapter header: real attachment-markdown.svg + “Markdown 笔记” above the band title
//   - note window (.win, base NOTE_WIN 1792×774) at LAYOUT.T; inside, a camera wrapper (push-ins) and the
//     REAL Markdown tab at 1.6 (native 1120 × 483.75): outline sidebar, editor iframe, backlinks panel
//   - film pointer in frame coordinates (positions measured on the real product elements)
import React from 'react';
import gsap from 'gsap';
import {onDriveRange, onRenderRange} from '../engine.js';
import {LAYOUT, NOTE_WIN} from '../stage/layout.js';
import {zh} from '../md/zh.js';
import {Cursor} from '../kit/cursor.jsx';
import {createNoteEditor} from './note-editor.js';
import {T, past} from './time.js';
import './notes.css';

const NATIVE = {w: NOTE_WIN.w / NOTE_WIN.scale, h: NOTE_WIN.h / NOTE_WIN.scale};   // 1120 × 483.75
const BACK_TOTAL = 2.6;   // #10 引用此笔记 push: 1.6 × camera 1.625 (the [[ push and #11 are fitted to measurements)
// Film pointer: the arrow is drawn at a constant size in frame px whatever the camera (DIRECTION §5.6 30 px:
// the black arrow measures 31 px from tip to tail, 33 px with its white stroke; svg box 38 px, set in
// notes.css); TIP is where the arrow's tip sits inside the scaled svg (viewBox 24, tip at 5,2.5).
const POINTER_PX = 38, TIP = {x: 5 / 24 * POINTER_PX, y: 2.5 / 24 * POINTER_PX};

export function NoteLayerView() {
  return <>
    <div className="chapter-header note-header">
      <img src="addon-icons/attachment-markdown.svg" alt="" />
      <span><span className="en" lang="en">Markdown</span><span lang="zh-CN"> 笔记</span></span>
    </div>
    <div className="win note-win">
      <div className="note-cam">
        <div className="note-product" style={{width: NATIVE.w, height: NATIVE.h}}>
          {/* same DOM skeleton and classes as mountEditorUI() in src/modules/markdown/tab.ts (toolbar and
              status bar not mounted: the window frames the outline, editor and backlinks) */}
          <div className="zotero-markdown-tab-content md-tab">
            <div className="zotero-markdown-root mode-live theme-light"
              style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
              <div className="zotero-markdown-body">
                <nav className="zotero-markdown-outline-sidebar" aria-label={zh('markdown-outline-title')}>
                  <div className="zotero-markdown-sidebar-title">{zh('markdown-outline-title')}</div>
                  <div className="zotero-markdown-outline-list" role="tree" />
                </nav>
                <div className="zotero-markdown-workspace">
                  <div className="zotero-markdown-editor-host" />
                  <div className="zotero-markdown-preview-host" />
                </div>
                <aside className="zotero-markdown-backlinks-sidebar" aria-label={zh('note-backlinks-title')} />
              </div>
              <button type="button" className="md-outline-toggle" hidden aria-expanded="true" />
            </div>
          </div>
        </div>
      </div>
    </div>
    <Cursor id="note" />
  </>;
}

// ---- pointer in frame coordinates ------------------------------------------------------------------
const ease = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);   // power2.inOut
/** keys: [{at, x, y}] in native tab px (held before the first / after the last key). */
function pathAt(keys, t) {
  if (t <= keys[0].at) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t < b.at) {
      if (b.hold) return a;
      const u = ease((t - a.at) / (b.at - a.at));
      return {x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u};
    }
  }
  return keys[keys.length - 1];
}
function paintPointer(el, {win, cam}, t, segments) {
  const seg = segments.find(s => t >= s.show[0] && t < s.show[1]);
  if (!seg) { el.style.opacity = '0'; return; }
  const fade = 0.15;
  const alpha = Math.min(1, (t - seg.show[0]) / fade, (seg.show[1] - t) / fade);
  // native tab px → camera px (×1.6) → window px (camera transform) → frame px (window transform)
  const g = (node, k) => Number(gsap.getProperty(node, k));
  const toFrame = q => {
    const cx = g(cam, 'x') + g(cam, 'scaleX') * q.x * NOTE_WIN.scale, cy = g(cam, 'y') + g(cam, 'scaleY') * q.y * NOTE_WIN.scale;
    return {x: g(win, 'x') + g(win, 'scaleX') * cx, y: g(win, 'y') + g(win, 'scaleY') * cy};
  };
  const f = toFrame(pathAt(seg.keys, t));
  el.style.opacity = String(Math.max(0, alpha));
  el.style.transform = `translate(${(f.x - TIP.x).toFixed(2)}px, ${(f.y - TIP.y).toFixed(2)}px)`;
  const click = (seg.clicks || []).find(c => t - c >= 0 && t - c < 0.45), since = click === undefined ? undefined : t - click;
  el.querySelector('svg').style.transform = since !== undefined && since < 0.18 ? `scale(${0.84 + 0.16 * since / 0.18})` : '';
  // the ripple stays where the click landed (on the product), even when the pointer moves on
  const r = el.querySelector('.film-ripple');
  const at = click === undefined ? f : toFrame(pathAt(seg.keys, click));
  r.style.opacity = since !== undefined ? String(1 - since / 0.45) : '0';
  r.style.transform = since !== undefined ? `translate(${(at.x - f.x).toFixed(2)}px, ${(at.y - f.y).toFixed(2)}px) scale(${0.4 + since * 3})` : '';
}

/** Camera that shows the native region [ox, ox + w/k] × [oy, oy + h/k] (clamped to the tab). */
function camFor(k, ox, oy) {
  const vw = NATIVE.w / k, vh = NATIVE.h / k;
  ox = Math.min(Math.max(ox, 0), NATIVE.w - vw); oy = Math.min(Math.max(oy, 0), NATIVE.h - vh);
  return {x: -ox * NOTE_WIN.scale * k, y: -oy * NOTE_WIN.scale * k, scale: k, ox, oy};
}

let note = null;
export async function buildNoteLayer(tl) {
  const layer = document.querySelector('.layer-note');
  const win = layer.querySelector('.note-win'), cam = layer.querySelector('.note-cam');
  const header = layer.querySelector('.note-header'), pointer = layer.querySelector('[data-cursor="note"]');
  // film.css gives every film element border-box; the product subtree keeps the browser default like in
  // Zotero (product rules that set box-sizing still win: this one has zero specificity and comes last)
  const st = document.createElement('style');
  st.textContent = ':where(.layer-note .note-product, .layer-note .note-product *) { box-sizing: content-box; }';
  document.head.append(st);

  note = createNoteEditor(layer);
  await note.mount();
  await note.record();
  const M = note.REC.measure;

  // ---- camera targets (measured on the real product) ----
  const para = M.paraTop, pop = M.popupAll, divider = M.aside.x;   // 引用此笔记 panel's left edge (native px)
  // [[ push (total ≈ 2.08): the outline stays whole at the window's left edge and the 引用此笔记 divider sits
  // exactly on the window's right edge, so no panel glyphs are sliced; paragraph 1 + the popup (its tallest
  // state, 4 results under 全部) fit vertically.
  const kLinks = NATIVE.w / divider;
  const box = {y0: para.y - 28, y1: pop.y + pop.h + 20};
  const linksCam = camFor(kLinks, 0, Math.min(box.y0, Math.max(0, box.y1 - NATIVE.h / kLinks)));
  // 引用此笔记 push (total 2.6): the panel's right edge on the window edge, the panel as large as the push
  // allows (≈ 38 % of the window); the note's text runs off the window's left edge
  const kBack = BACK_TOTAL / NOTE_WIN.scale, backCam = camFor(kBack, NATIVE.w, 0);
  // #11 (layout D, window at LAYOUT.D.note.s): the editor column alone, from the editor's left margin to the
  // 引用此笔记 divider, which lands exactly on the board window's left edge (LAYOUT.D.board.x): the board covers
  // the panel and no glyph is sliced at the overlap.
  const Dn = LAYOUT.D.note, Db = LAYOUT.D.board, edgeWin = (Db.x - Dn.x) / Dn.s;   // board edge in note-window px
  const darkLeft = M.workspace.x + 2;                                       // just inside the outline's border
  const kDark = edgeWin / ((divider - darkLeft) * NOTE_WIN.scale);
  // Where the note window rises above the board (Dn.y < Db.y) the top of the 引用此笔记 panel shows in a strip
  // above the board: start the view just under the note's title line so that strip holds only the panel's
  // empty band between its header and the first entry (no half glyphs at the board's top edge).
  const strip = Math.max(0, (Db.y - Dn.y) / (Dn.s * NOTE_WIN.scale * kDark));   // native px
  let darkTop = 0;
  if (strip > 0) {
    const lo = M.h1Text.y + M.h1Text.h + 1, hi = M.backTitles[0].y - strip - 1;
    if (lo > hi) console.error('[notes] #11: no clean top for the note window', {lo, hi, strip});
    darkTop = (lo + hi) / 2;
  }
  const darkCam = camFor(kDark, darkLeft, darkTop);
  note.REC.cams = {linksCam, backCam, darkCam, box, divider, strip};

  const ID = {x: 0, y: 0, scale: 1};
  const cmove = (from, to, at, dur) => tl.fromTo(cam, {x: from.x, y: from.y, scale: from.scale},
    {x: to.x, y: to.y, scale: to.scale, duration: dur, ease: 'power2.inOut', immediateRender: false}, at);
  tl.set(cam, {transformOrigin: '0 0', ...ID}, 0);
  cmove(ID, linksCam, T.pushIn[0], T.pushIn[1] - T.pushIn[0]);
  cmove(linksCam, ID, T.pullBack[0], T.pullBack[1] - T.pullBack[0]);
  cmove(ID, backCam, T.backPush[0], T.backPush[1] - T.backPush[0]);
  cmove(backCam, darkCam, T.darkMove[0], T.darkMove[1] - T.darkMove[0]);

  const L = LAYOUT.T.note, D = LAYOUT.D.note;
  tl.set(win, {transformOrigin: '0 0', x: L.x, y: L.y, scale: L.s}, 0);
  tl.fromTo(win, {x: L.x, y: L.y, scale: L.s}, {x: D.x, y: D.y, scale: D.s, duration: T.darkMove[1] - T.darkMove[0], ease: 'power2.inOut', immediateRender: false}, T.darkMove[0]);
  tl.fromTo(header, {opacity: 1}, {opacity: 0, duration: 0.3, ease: 'power1.in', immediateRender: false}, T.headerOut);
  tl.set(layer, {opacity: 1}, T.layerOn);
  tl.set(layer, {opacity: 0}, T.layerOff);

  // ---- pointer (native tab px; clicks are the real clicks the driver performs at the same times) ----
  // Tips go to the leading edge of what is clicked (never onto the label being read):
  //   常规条目: the button's left padding, on the label's centre line
  //   the paper row: the row's empty icon column (papers have no Zotero item icon here), on the title line
  //   backlinks: the panel's left margin, beside each entry's title (pointing only)
  const regular = {x: M.regularBtn.x + 7, y: M.regularBtn.y + M.regularBtn.h * 0.42};
  const paper = {x: M.paperRow.x + 9, y: M.paperRow.y + M.paperRow.h * 0.3};
  const beside = r => ({x: divider + 6, y: r.y + r.h * 0.3});
  const [entry1, entry2] = M.backTitles.map(beside);
  const segments = [
    {show: [T.cursorIn, T.caretOff + 0.35], clicks: [T.linksFilter, T.linksInsert], keys: [
      {at: T.cursorIn, x: pop.x + pop.w - 36, y: pop.y + pop.h - 16},
      {at: T.cursorIn + 0.15, hold: true, x: pop.x + pop.w - 36, y: pop.y + pop.h - 16},
      {at: T.linksFilter - 0.07, x: regular.x, y: regular.y},
      {at: T.linksFilter + 0.17, hold: true, x: regular.x, y: regular.y},
      {at: T.linksInsert - 0.06, x: paper.x, y: paper.y},
      {at: T.linksInsert + 0.15, hold: true, x: paper.x, y: paper.y},
      {at: T.caretOff + 0.35, x: pop.x + pop.w - 36, y: paper.y + 30},
    ]},
    {show: [T.backPush[1] - 0.35, T.headerOut + 0.15], keys: [
      {at: T.backPush[1] - 0.35, x: entry1.x - 90, y: entry1.y + 110},
      {at: T.backPush[1] - 0.15, hold: true, x: entry1.x - 90, y: entry1.y + 110},
      {at: T.backHover - 0.03, x: entry1.x, y: entry1.y},
      {at: T.backNext[0], hold: true, x: entry1.x, y: entry1.y},
      {at: T.backNext[1], x: entry2.x, y: entry2.y},
    ]},
  ];

  onDriveRange(T.layerOn, T.layerOff, (_l, t) => note.drive(t));
  onRenderRange(T.layerOn, T.layerOff, (_l, t) => {
    win.classList.toggle('is-dark', past(t, T.darkSwitch));
    paintPointer(pointer, {win, cam}, t, segments);
  });
  window.__notes = note;
}
