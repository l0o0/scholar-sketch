// Builders for the film's own cards. Times come from plan.json (shot() / actionTime()); every frame is a
// pure function of t: continuous motion is on the paused GSAP master timeline, discrete switches
// (which copy of the logo is shown, the dark caption flip, the files page under the turn) are onRender
// comparisons against t. No product state is touched here.
// Seek purity: an element's first tween may be a fromTo (it owns the start state); every later tween on
// the same property is a plain tl.to (or tl.set), never fromTo(..., {immediateRender:false}) — rewinding
// such a tween writes its `from` back over the earlier tween's end state (blank wordmark after a backward seek).
// A plain tl.to records its start values the first time it renders, so it must first render in time order.
// That is not the case on the master while builders run: the board rehearsal leaves its playhead at ≈ 31 s,
// and GSAP renders a child added behind the playhead at once (_postAddChecks), i.e. a tl.to added straight to
// the master would record the build-time state (opacity 0 from a fromTo's immediate render) and fade 0 → 0.
// So each builder fills its own child timeline (playhead 0, nothing renders early) and adds it to the master
// at 0 when complete; the child then renders its tweens in time order. Times stay absolute film seconds.
import gsap from 'gsap';
import {shot, onRender} from '../engine.js';
import {revealCaption} from '../stage/captions.jsx';
import {actionTime} from '../stage/layout.js';
import {paintCursor} from '../kit/cursor.jsx';
import {LOGO, INK, TOOL, TOOL_SCALE, HEADER_ICON, CURSOR} from './geometry.js';

const part = build => master => { const tl = gsap.timeline(); build(tl); master.add(tl, 0); };
const sec = id => document.querySelector(`section[data-shot="${id}"]`);
const $ = (id, sel) => { const el = sec(id).querySelector(sel); if (!el) throw new Error(`${id}: no ${sel}`); return el; };
const $$ = (id, sel) => [...sec(id).querySelectorAll(sel)];
const clamp01 = x => Math.min(1, Math.max(0, x));
const RISE = 12;   // DIRECTION §5.6: film copy fades in and rises 12 px
const fadeRise = (tl, el, at, duration = 0.45) =>
  tl.fromTo(el, {opacity: 0, y: RISE}, {opacity: 1, y: 0, duration, ease: 'power2.out'}, at);
const fadeTo = (tl, el, to, at, duration = 0.3, ease = 'power1.in') =>
  tl.to(el, {opacity: to, duration, ease}, at);
const frameRect = el => {   // frame coordinates (the film root sits at 0,0 at 1×)
  const r = el.getBoundingClientRect(), f = document.getElementById('film').getBoundingClientRect();
  return {x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height, cx: r.left - f.left + r.width / 2, cy: r.top - f.top + r.height / 2};
};

/** Part of the convex polygon `poly` where x + y >= c (the fold wipe, a 45° line). */
function clipHalf(poly, c) {
  const inside = p => p[0] + p[1] >= c, outPts = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = inside(a), ib = inside(b);
    if (ia) outPts.push(a);
    if (ia !== ib) { const fa = a[0] + a[1] - c, fb = b[0] + b[1] - c, k = fa / (fa - fb); outPts.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  }
  return outPts.length > 2 ? outPts.map(p => p.map(v => v.toFixed(2)).join(',')).join(' ') : '';
}

// ---------------------------------------------------------------- #1 brand
export const buildBrand = part(tl => {
  sec('brand').style.opacity = '1';
  const pathA = $('brand', '.bd-a'), pathB = $('brand', '.bd-b'), pre = $('brand', '.bd-pre'), fold = $('brand', '.bd-fold');
  const svg = $('brand', '.bd-ink'), crops = $$('brand', '.bd-crop');
  const iconCrop = $('brand', '.bd-icon'), iconMove = $('brand', '.bd-icon .bd-move'), wordMove = $('brand', '.bd-word .bd-move'), line = $('brand', '.bd-line');
  const lenA = pathA.getTotalLength(), lenB = pathB.getTotalLength(), sB0 = pre.getTotalLength();
  pathA.setAttribute('stroke-dasharray', `${lenA} ${lenA + 4}`);
  pathB.setAttribute('stroke-dasharray', `${lenB} ${lenB + 4}`);
  pathB.setAttribute('stroke-dashoffset', String(lenB));

  const tDraw = actionTime('brand-draw'), tFold = actionTime('brand-fold'), tLine = actionTime('brand-line');
  const tWord = tFold + 0.30, foldEase = gsap.parseEase('power2.out');
  // poster frame (SKILL: first frame is a complete picture): opaque 0–0.30, gone by 0.60
  const poster = document.getElementById('poster');
  if (poster) tl.fromTo(poster, {opacity: 1}, {opacity: 0, duration: 0.3, ease: 'none'}, 0.3);
  // 0.20–1.20 one ink stroke along the page outline, clockwise from the top-left
  tl.fromTo(pathA, {attr: {'stroke-dashoffset': lenA}}, {attr: {'stroke-dashoffset': 0}, duration: tFold - tDraw, ease: 'power1.inOut'}, tDraw);
  // 1.50–1.90 wordmark (part of the same PNG); 1.60–2.05 the line
  fadeRise(tl, wordMove, tWord, 0.40);
  fadeRise(tl, line, tLine, 0.45);
  // 3.70–4.04 quiet exit: the wordmark and the line fade; the page shrinks up into #2's toolbar icon
  const s = shot('brand'), tOut = s.end - 0.30;
  fadeTo(tl, line, 0, tOut + 0.04, 0.30);   // ends 4.04, as #2's title starts: the hand-off is never empty
  fadeTo(tl, wordMove, 0, tOut, 0.22);
  tl.to(iconCrop, {x: TOOL.cx - (LOGO.x + LOGO.page.cx), y: TOOL.cy - (LOGO.y + LOGO.page.cy), scale: TOOL_SCALE,
    duration: 0.30, ease: 'power2.inOut'}, tOut);
  fadeTo(tl, iconMove, 0, tOut + 0.14, 0.16, 'none');

  onRender('brand', (_local, t) => {
    // the wide companion stroke shares the main stroke's head (same arc length), so the ink corner fills with it
    const sNow = lenA - (parseFloat(pathA.getAttribute('stroke-dashoffset')) || 0);
    pathB.setAttribute('stroke-dashoffset', String(lenB - Math.min(lenB, Math.max(0, sNow - sB0))));
    // 1.20–1.50 the sage corner folds in: a 45° wipe from the crease to the fold's corner
    const u = clamp01((t - tFold) / (tWord - tFold));
    fold.setAttribute('points', u > 0 ? clipHalf(INK.fold, INK.crease - (INK.crease - INK.foldEnd) * foldEase(u)) : '');
    // from 1.50 the plain PNG (two crops at the same integer position) replaces the masked copy
    const plain = t >= tWord;
    // only ever 'hidden' or '' (inherit): an inline 'visible' would outlive the section's own visibility
    svg.style.visibility = plain ? 'hidden' : '';
    for (const c of crops) c.style.visibility = plain ? '' : 'hidden';
  });
});

// ---------------------------------------------------------------- #2 entry
export const buildEntry = part(tl => {
  const s = shot('entry');
  sec('entry').style.opacity = '1';
  const tool = $('entry', '.en-tool'), well = $('entry', '.en-well'), rule = $('entry', '.en-rule'), mark = $('entry', '.en-mark');
  const [rowMd, rowWb] = $$('entry', '.en-row');
  const hover = rowWb.querySelector('.en-hover'), wbIcon = rowWb.querySelector('.en-ico');
  const fly = $('entry', '.en-fly'), curWrap = $('entry', '.en-cursor'), cursor = $('entry', '.film-cursor');
  // measure before any tween writes a transform
  const ico = frameRect(wbIcon);

  const tClick = actionTime('entry-click'), tItems = actionTime('entry-items'), tFly = actionTime('entry-fly');
  const tIn = shot('brand').end - 0.30;   // co-moves with the shrinking logo page (3.70–4.00)
  tl.fromTo(tool, {x: 0, y: (LOGO.y + LOGO.page.cy) - TOOL.cy, scale: 1 / TOOL_SCALE}, {x: 0, y: 0, scale: 1, duration: 0.30, ease: 'power2.inOut'}, tIn);
  tl.fromTo(tool, {opacity: 0}, {opacity: 1, duration: 0.16, ease: 'none'}, tIn + 0.10);
  // the button's tile is in place behind the landing page by 4.04, so the hand-off never goes empty
  tl.fromTo(well, {opacity: 0}, {opacity: 1, duration: 0.22, ease: 'power1.out'}, tIn + 0.12);
  // click: the button presses while the items show
  tl.set(tool, {scale: 0.94}, tClick);
  tl.to(tool, {scale: 1, duration: 0.24, ease: 'power2.out'}, tClick);
  tl.fromTo(rule, {scaleY: 0}, {scaleY: 1, duration: 0.35, ease: 'power2.out'}, tItems - 0.08);
  fadeRise(tl, rowMd, tItems, 0.35);
  fadeRise(tl, rowWb, tItems + 0.20, 0.35);
  tl.fromTo(mark, {opacity: 0}, {opacity: 1, duration: 0.3, ease: 'power1.out'}, tItems + 0.30);
  const tHover = 5.40 - 0.02;   // DIRECTION #2: 5.50 the cursor rests on 新建白板…
  tl.fromTo(hover, {opacity: 0}, {opacity: 1, duration: 0.15, ease: 'power1.out'}, tHover);
  // the title arrives as the logo page lands (4.00); it stays until 7.70 so #3's board window has started
  // to slide in before #2 is gone (no empty frames at 7.50–7.65)
  revealCaption(tl, 'entry', {at: 0.0, exit: s.end - 0.10});
  // 6.90–7.50: the canvas icon flies to the chapter-1 header slot. Its straight path crosses the toolbar
  // button's place at ≈ 7.10 (an arc cannot clear both the button tile and the Markdown row's icon), so the
  // button and its tile are gone by 6.94 — the icon never reads as a badge on the button. The menu rows
  // clear after the icon has left them.
  tl.fromTo(fly, {left: ico.x, top: ico.y, width: ico.w, height: ico.h},
    {left: HEADER_ICON.x, top: HEADER_ICON.y, width: HEADER_ICON.size, height: HEADER_ICON.size, duration: s.end - tFly, ease: 'power2.inOut'}, tFly);
  for (const el of [tool, well]) fadeTo(tl, el, 0, tFly - 0.28, 0.32);
  for (const el of [rule, rowMd, rowWb, mark]) fadeTo(tl, el, 0, tFly + 0.08, 0.36);
  // cursor: hidden until the page has landed (4.05), then a short settle onto the button
  tl.fromTo(curWrap, {opacity: 0}, {opacity: 1, duration: 0.10, ease: 'none'}, 4.05);
  fadeTo(tl, curWrap, 0, tFly - 0.05, 0.22);

  // The cursor is drawn at CURSOR px (≈ 30 px tall arrow incl. its white stroke, DIRECTION §5.6). paintCursor
  // offsets the box by (6, 3) for a 32 px arrow; at CURSOR px the tip sits at (5, 2.5) × CURSOR / 24, so the
  // key points are corrected by the difference to put the tip exactly on the target.
  const tipFix = ({x, y}) => ({x: x - (5 * CURSOR / 24 - 6), y: y - (2.5 * CURSOR / 24 - 3)});
  const tip = tipFix({x: TOOL.cx - 10, y: TOOL.cy - 12});   // on the page, clear of the sage fold
  // the 新建白板… row: tip on the lower-left of its canvas icon (left end of the row), clear of the label text
  const rowTip = tipFix({x: ico.x + 8, y: ico.y + 30});
  const keys = [{at: 4.03, x: tip.x + 22, y: tip.y + 30}, {at: tClick - 0.04, ...tip}, {at: 4.95, ...tip},
    {at: tHover + 0.07, ...rowTip}];
  onRender('entry', (_local, t) => {
    paintCursor(cursor, t, keys, [tClick]);
    const flying = t >= tFly && t < s.end;
    fly.style.visibility = flying ? '' : 'hidden';
    wbIcon.style.visibility = t >= tFly ? 'hidden' : '';
  });
});

// ---------------------------------------------------------------- #11 dark (copy + desk)
/** Hard cut at the dark switch (DIRECTION §5.5: no crossfade): on the frame the product themes turn dark
 *  (frame-snapped actionTime, same tolerance as the board's themeAt), the desk becomes brand ink and the
 *  caption takes its dark colours. No tween, so there is never a mid-gray frame. */
export const buildDark = part(tl => {
  sec('dark').style.opacity = '1';
  revealCaption(tl, 'dark');
  const tSwitch = actionTime('dark-switch') - 0.002, wrap = $('dark', '.dk-wrap');
  tl.set('#paper-dark', {opacity: 1}, tSwitch);
  onRender('dark', (_local, t) => { wrap.classList.toggle('is-dark', t >= tSwitch); });
});

// ---------------------------------------------------------------- #12 files
export const buildFiles = part(tl => {
  const s = shot('files'), section = sec('files');
  const rows = Object.fromEntries($$('files', '.fl-row').map(r => [r.dataset.row, r]));
  const mark = $('files', '.fl-mark');
  const lifted = [rows.md, rows.canvas], rest = [rows.paper, rows.pdf];
  const slots = lifted.map(r => r.querySelector('.fl-icon-slot'));
  const centres = slots.map(frameRect);   // measured before any transform
  const tLift = actionTime('files-lift');
  // title as the turn uncovers the page, description right after it (plan descriptionAt 0.4): it reads ≥ 3.3 s
  revealCaption(tl, 'files', {at: 0.15});
  // 50.50: the two plugin files lift; the paper and its PDF step back
  for (const r of lifted) {
    tl.fromTo(r, {y: 0}, {y: -6, duration: 0.35, ease: 'power2.out'}, tLift);
    tl.fromTo(r.querySelector('.fl-card'), {opacity: 0}, {opacity: 1, duration: 0.35, ease: 'power2.out'}, tLift);
  }
  for (const r of rest) fadeTo(tl, r, 0.4, tLift, 0.35, 'power1.out');
  // 53.05–54.10 hand-off to #13: the paper and PDF rows (they sit under the logo) clear first; the two file
  // rows are still at 40 % at 53.50, when #13's logo starts to fade in, and their icons fly into its page
  const tOut = s.end - 0.30, outDur = 0.5;
  for (const r of lifted) for (const el of r.querySelectorAll('.fl-card, .fl-name, .fl-type')) fadeTo(tl, el, 0, tOut, outDur, 'none');
  for (const r of rest) fadeTo(tl, r, 0, tOut - 0.15, 0.4, 'none');
  fadeTo(tl, mark, 0, tOut, outDur, 'none');
  const target = {x: LOGO.x + LOGO.page.cx, y: LOGO.y + LOGO.page.cy};
  slots.forEach((el, i) => {
    const ty = target.y + (i ? 38 : -38);   // keep the two files apart: they settle one above the other inside the page
    tl.to(el, {x: target.x - centres[i].cx, y: ty - (centres[i].cy - 6), scale: 1.6, duration: 0.6, ease: 'sine.inOut'}, s.end);
    fadeTo(tl, el, 0, s.end + 0.22, 0.38, 'power1.in');
  });
  // the files page lies under the dark page and is uncovered by the turn at 49.50 (src/stage/turns.js)
  onRender('files', (_local, t) => { section.style.opacity = t >= s.start ? '1' : '0'; });
});

// ---------------------------------------------------------------- #13 end
export const buildEnd = part(tl => {
  const s = shot('end');
  sec('end').style.opacity = '1';
  const logo = $('end', '.ed-logo'), tag = $('end', '.ed-tag'), plat = $('end', '.ed-platform'), push = $('end', '.ed-push');
  // fades in from 53.50 while #12's list is still at ≈ 40 %, so the two file icons fly into a visible logo
  tl.fromTo(logo, {opacity: 0}, {opacity: 1, duration: 0.5, ease: 'power1.out'}, s.start);
  const tChord = actionTime('end-chord');
  fadeRise(tl, tag, tChord, 0.45);
  fadeRise(tl, plat, tChord + 0.50, 0.45);
  tl.fromTo(push, {scale: 1}, {scale: 1.015, duration: s.end - s.start, ease: 'sine.inOut'}, s.start);
});
