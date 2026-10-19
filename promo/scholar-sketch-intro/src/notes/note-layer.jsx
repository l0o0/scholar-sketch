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
import {T} from './time.js';
import './notes.css';

const NATIVE = {w: NOTE_WIN.w / NOTE_WIN.scale, h: NOTE_WIN.h / NOTE_WIN.scale};   // 1120 × 483.75
const ZOOM = {links: 1.25};   // camera on top of 1.6: total 2.0 for the [[ popup (引用此笔记: see backCam)

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
  const p = pathAt(seg.keys, t);
  // native tab px → camera px (×1.6) → window px (camera transform) → frame px (window transform)
  const g = (node, k) => Number(gsap.getProperty(node, k));
  const cx = g(cam, 'x') + g(cam, 'scaleX') * p.x * NOTE_WIN.scale, cy = g(cam, 'y') + g(cam, 'scaleY') * p.y * NOTE_WIN.scale;
  const fx = g(win, 'x') + g(win, 'scaleX') * cx, fy = g(win, 'y') + g(win, 'scaleY') * cy;
  el.style.opacity = String(Math.max(0, alpha));
  el.style.transform = `translate(${(fx - 6).toFixed(2)}px, ${(fy - 3).toFixed(2)}px)`;
  const since = (seg.clicks || []).map(c => t - c).filter(d => d >= 0 && d < 0.45)[0];
  el.querySelector('svg').style.transform = since !== undefined && since < 0.18 ? `scale(${0.84 + 0.16 * since / 0.18})` : '';
  const r = el.querySelector('.film-ripple');
  r.style.opacity = since !== undefined ? String(1 - since / 0.45) : '0';
  r.style.transform = since !== undefined ? `scale(${0.4 + since * 3})` : '';
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
  // [[ push: paragraph 1 (with the typed query) + the popup under 全部, its tallest state
  const para = M.paraTop, pop = M.popupAll;
  const box = {x0: Math.min(para.x, pop.x) - 24, x1: pop.x + pop.w + 24, y0: para.y - 28, y1: pop.y + pop.h + 20};
  // left-aligned: the outline stays whole at the window's own edge instead of being cut mid-word
  const linksCam = camFor(ZOOM.links, Math.min(0, box.x0), Math.min(box.y0, box.y1 - NATIVE.h / ZOOM.links));
  // 引用此笔记 right-aligned; the zoom is chosen so the left edge lands in the editor's margin, 23 native px
  // before the text column (at the planned 2.08 the edge would cut the first character of every line)
  const backLeft = para.x - 23, backCam = camFor(NATIVE.w / (NATIVE.w - backLeft), NATIVE.w, 0);
  note.REC.cams = {linksCam, backCam, box};

  const ID = {x: 0, y: 0, scale: 1};
  const cmove = (from, to, at, dur) => tl.fromTo(cam, {x: from.x, y: from.y, scale: from.scale},
    {x: to.x, y: to.y, scale: to.scale, duration: dur, ease: 'power2.inOut', immediateRender: false}, at);
  tl.set(cam, {transformOrigin: '0 0', ...ID}, 0);
  cmove(ID, linksCam, T.pushIn[0], T.pushIn[1] - T.pushIn[0]);
  cmove(linksCam, ID, T.pullBack[0], T.pullBack[1] - T.pullBack[0]);
  cmove(ID, backCam, T.backPush[0], T.backPush[1] - T.backPush[0]);
  cmove(backCam, ID, T.darkMove[0], T.darkMove[1] - T.darkMove[0]);

  const L = LAYOUT.T.note, D = LAYOUT.D.note;
  tl.set(win, {transformOrigin: '0 0', x: L.x, y: L.y, scale: L.s}, 0);
  tl.fromTo(win, {x: L.x, y: L.y, scale: L.s}, {x: D.x, y: D.y, scale: D.s, duration: T.darkMove[1] - T.darkMove[0], ease: 'power2.inOut', immediateRender: false}, T.darkMove[0]);
  tl.fromTo(header, {opacity: 1}, {opacity: 0, duration: 0.3, ease: 'power1.in', immediateRender: false}, T.headerOut);
  tl.set(layer, {opacity: 1}, T.layerOn);
  tl.set(layer, {opacity: 0}, T.layerOff);

  // ---- pointer (native tab px; clicks are the real clicks the driver performs at the same times) ----
  const c = r => ({x: r.x + r.w / 2, y: r.y + r.h / 2});
  const regular = c(M.regularBtn), paper = {x: M.paperRow.x + 64, y: M.paperRow.y + M.paperRow.h * 0.42};
  const entry = {x: M.backlink.x + 64, y: M.backlink.y + 15};
  const segments = [
    {show: [T.cursorIn, T.caretOff + 0.35], clicks: [T.linksFilter, T.linksInsert], keys: [
      {at: T.cursorIn, x: pop.x + pop.w + 46, y: pop.y + 14},
      {at: T.cursorIn + 0.15, hold: true, x: pop.x + pop.w + 46, y: pop.y + 14},
      {at: T.linksFilter - 0.07, x: regular.x + 6, y: regular.y + 2},
      {at: T.linksFilter + 0.17, hold: true, x: regular.x + 6, y: regular.y + 2},
      {at: T.linksInsert - 0.06, x: paper.x, y: paper.y},
      {at: T.linksInsert + 0.15, hold: true, x: paper.x, y: paper.y},
      {at: T.caretOff + 0.35, x: paper.x + 40, y: paper.y + 70},
    ]},
    {show: [T.backPush[1] - 0.35, T.headerOut + 0.15], keys: [
      {at: T.backPush[1] - 0.35, x: entry.x - 150, y: entry.y + 150},
      {at: T.backPush[1] - 0.15, hold: true, x: entry.x - 150, y: entry.y + 150},
      {at: T.backHover - 0.03, x: entry.x, y: entry.y},
    ]},
  ];

  onDriveRange(T.layerOn, T.layerOff, (_l, t) => note.drive(t));
  onRenderRange(T.layerOn, T.layerOff, (_l, t) => {
    win.classList.toggle('is-dark', t >= T.darkSwitch);
    paintPointer(pointer, {win, cam}, t, segments);
  });
  window.__notes = note;
}
