// Builders for the film's own cards. Times come from plan.json (shot() / actionTime()); every frame is a
// pure function of t: continuous motion is on the paused GSAP master timeline, discrete switches
// (which copy of the logo is shown, the dark caption flip, the files page under the turn) are onRender
// comparisons against t. No product state is touched here.
import gsap from 'gsap';
import {shot, onRender} from '../engine.js';
import {revealCaption} from '../stage/captions.jsx';
import {actionTime} from '../stage/layout.js';
import {paintCursor} from '../kit/cursor.jsx';
import {LOGO, INK, TOOL, TOOL_SCALE, HEADER_ICON} from './geometry.js';

const sec = id => document.querySelector(`section[data-shot="${id}"]`);
const $ = (id, sel) => { const el = sec(id).querySelector(sel); if (!el) throw new Error(`${id}: no ${sel}`); return el; };
const $$ = (id, sel) => [...sec(id).querySelectorAll(sel)];
const clamp01 = x => Math.min(1, Math.max(0, x));
const RISE = 12;   // DIRECTION §5.6: film copy fades in and rises 12 px
const fadeRise = (tl, el, at, duration = 0.45) =>
  tl.fromTo(el, {opacity: 0, y: RISE}, {opacity: 1, y: 0, duration, ease: 'power2.out'}, at);
const fadeTo = (tl, el, from, to, at, duration = 0.3, ease = 'power1.in') =>
  tl.fromTo(el, {opacity: from}, {opacity: to, duration, ease, immediateRender: false}, at);
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
export function buildBrand(tl) {
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
  // 3.70–4.00 quiet exit: the line and wordmark fade; the page shrinks up into #2's toolbar icon
  const s = shot('brand'), tOut = s.end - 0.30;
  fadeTo(tl, line, 1, 0, tOut, 0.30);
  fadeTo(tl, wordMove, 1, 0, tOut, 0.22);
  tl.fromTo(iconCrop, {x: 0, y: 0, scale: 1}, {x: TOOL.cx - (LOGO.x + LOGO.page.cx), y: TOOL.cy - (LOGO.y + LOGO.page.cy), scale: TOOL_SCALE,
    duration: 0.30, ease: 'power2.inOut', immediateRender: false}, tOut);
  fadeTo(tl, iconMove, 1, 0, tOut + 0.14, 0.16, 'none');

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
}

// ---------------------------------------------------------------- #2 entry
export function buildEntry(tl) {
  const s = shot('entry');
  sec('entry').style.opacity = '1';
  const tool = $('entry', '.en-tool'), well = $('entry', '.en-well'), rule = $('entry', '.en-rule'), mark = $('entry', '.en-mark');
  const [rowMd, rowWb] = $$('entry', '.en-row');
  const hover = rowWb.querySelector('.en-hover'), wbIcon = rowWb.querySelector('.en-ico'), wbLabel = rowWb.querySelector('.en-label');
  const fly = $('entry', '.en-fly'), curWrap = $('entry', '.en-cursor'), cursor = $('entry', '.film-cursor');
  // measure before any tween writes a transform
  const ico = frameRect(wbIcon), label = frameRect(wbLabel);

  const tClick = actionTime('entry-click'), tItems = actionTime('entry-items'), tFly = actionTime('entry-fly');
  const tIn = shot('brand').end - 0.30;   // co-moves with the shrinking logo page (3.70–4.00)
  tl.fromTo(tool, {x: 0, y: (LOGO.y + LOGO.page.cy) - TOOL.cy, scale: 1 / TOOL_SCALE}, {x: 0, y: 0, scale: 1, duration: 0.30, ease: 'power2.inOut'}, tIn);
  tl.fromTo(tool, {opacity: 0}, {opacity: 1, duration: 0.16, ease: 'none'}, tIn + 0.10);
  // click: the button reads as pressed/open while the items show
  tl.fromTo(tool, {scale: 0.94}, {scale: 1, duration: 0.24, ease: 'power2.out', immediateRender: false}, tClick);
  tl.fromTo(well, {opacity: 0}, {opacity: 1, duration: 0.12, ease: 'power1.out'}, tClick);
  tl.fromTo(rule, {scaleY: 0}, {scaleY: 1, duration: 0.35, ease: 'power2.out'}, tItems - 0.08);
  fadeRise(tl, rowMd, tItems, 0.35);
  fadeRise(tl, rowWb, tItems + 0.20, 0.35);
  tl.fromTo(mark, {opacity: 0}, {opacity: 1, duration: 0.3, ease: 'power1.out'}, tItems + 0.30);
  const tHover = 5.40 - 0.02;   // DIRECTION #2: 5.50 the cursor rests on 新建白板…
  tl.fromTo(hover, {opacity: 0}, {opacity: 1, duration: 0.15, ease: 'power1.out'}, tHover);
  revealCaption(tl, 'entry', {at: 0.10});
  // 6.90–7.50: the canvas icon flies to the chapter-1 header slot; everything else is gone by 7.50
  tl.fromTo(fly, {left: ico.x, top: ico.y, width: ico.w, height: ico.h},
    {left: HEADER_ICON.x, top: HEADER_ICON.y, width: HEADER_ICON.size, height: HEADER_ICON.size, duration: s.end - tFly, ease: 'power2.inOut'}, tFly);
  for (const el of [tool, well, rule, rowMd, rowWb, mark]) fadeTo(tl, el, 1, 0, tFly, 0.35);
  tl.fromTo(curWrap, {opacity: 0}, {opacity: 1, duration: 0.15, ease: 'none'}, tIn + 0.15);
  fadeTo(tl, curWrap, 1, 0, tFly, 0.25);

  const tip = {x: TOOL.cx - 10, y: TOOL.cy - 12};   // on the page, clear of the sage fold
  const keys = [{at: tIn + 0.15, x: 800, y: 520}, {at: tClick - 0.06, ...tip}, {at: 4.95, ...tip},
    {at: tHover + 0.07, x: label.x + 64, y: label.cy + 10}];
  onRender('entry', (_local, t) => {
    paintCursor(cursor, t, keys, [tClick]);
    const flying = t >= tFly && t < s.end;
    fly.style.visibility = flying ? '' : 'hidden';
    wbIcon.style.visibility = t >= tFly ? 'hidden' : '';
  });
}

// ---------------------------------------------------------------- #11 dark (copy + desk)
/** The desk fades to brand ink over 0.35 s; the caption flips to its dark styling at the moment the desk
 *  is equally far (in contrast) from both text colours, so it never drops below ≈3.6:1. */
function flipTime(t0, dur, light = [26, 37, 39], dark = [232, 234, 237]) {
  const ease = gsap.parseEase('power1.inOut');
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const paper = [242, 242, 238], ink = [26, 37, 39];
  const target = Math.sqrt((lum(light) + 0.05) * (lum(dark) + 0.05)) - 0.05;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; const p = ease(m); if (lum(paper.map((c, k) => c + (ink[k] - c) * p)) > target) lo = m; else hi = m; }
  return t0 + dur * hi;
}
export function buildDark(tl) {
  sec('dark').style.opacity = '1';
  revealCaption(tl, 'dark');
  const tSwitch = actionTime('dark-switch'), dur = 0.35;
  tl.fromTo('#paper-dark', {opacity: 0}, {opacity: 1, duration: dur, ease: 'power1.inOut'}, tSwitch);
  const flip = flipTime(tSwitch, dur), wrap = $('dark', '.dk-wrap');
  window.__brandDarkFlip = flip;
  onRender('dark', (_local, t) => { wrap.classList.toggle('is-dark', t >= flip); });
}

// ---------------------------------------------------------------- #12 files
export function buildFiles(tl) {
  const s = shot('files'), section = sec('files');
  const rows = Object.fromEntries($$('files', '.fl-row').map(r => [r.dataset.row, r]));
  const mark = $('files', '.fl-mark');
  const lifted = [rows.md, rows.canvas], rest = [rows.paper, rows.pdf];
  const slots = lifted.map(r => r.querySelector('.fl-icon-slot'));
  const centres = slots.map(frameRect);   // measured before any transform
  const tLift = actionTime('files-lift');
  revealCaption(tl, 'files', {at: 0.55});
  // 50.50: the two plugin files lift; the paper and its PDF step back
  for (const r of lifted) {
    tl.fromTo(r, {y: 0}, {y: -6, duration: 0.35, ease: 'power2.out'}, tLift);
    tl.fromTo(r.querySelector('.fl-card'), {opacity: 0}, {opacity: 1, duration: 0.35, ease: 'power2.out'}, tLift);
  }
  for (const r of rest) fadeTo(tl, r, 1, 0.4, tLift, 0.35, 'power1.out');
  // 53.30–54.10 hand-off to #13: the list clears, the two icons drift into the logo's page and fade
  const tOut = s.end - 0.20;
  for (const r of lifted) for (const el of r.querySelectorAll('.fl-card, .fl-name, .fl-type')) fadeTo(tl, el, 1, 0, tOut, 0.3);
  for (const r of rest) fadeTo(tl, r, 0.4, 0, tOut, 0.3);
  fadeTo(tl, mark, 1, 0, tOut, 0.3);
  const target = {x: LOGO.x + LOGO.page.cx, y: LOGO.y + LOGO.page.cy};
  slots.forEach((el, i) => {
    const ty = target.y + (i ? 38 : -38);   // keep the two files apart: they settle one above the other inside the page
    tl.fromTo(el, {x: 0, y: 0, scale: 1}, {x: target.x - centres[i].cx, y: ty - (centres[i].cy - 6), scale: 1.6,
      duration: 0.6, ease: 'sine.inOut', immediateRender: false}, s.end);
    fadeTo(tl, el, 1, 0, s.end + 0.22, 0.38, 'power1.in');
  });
  // the files page lies under the dark page and is uncovered by the turn at 49.50 (src/stage/turns.js)
  onRender('files', (_local, t) => { section.style.opacity = t >= s.start ? '1' : '0'; });
}

// ---------------------------------------------------------------- #13 end
export function buildEnd(tl) {
  const s = shot('end');
  sec('end').style.opacity = '1';
  const logo = $('end', '.ed-logo'), tag = $('end', '.ed-tag'), plat = $('end', '.ed-platform'), push = $('end', '.ed-push');
  tl.fromTo(logo, {opacity: 0}, {opacity: 1, duration: 0.5, ease: 'power1.inOut'}, s.start + 0.10);
  const tChord = actionTime('end-chord');
  fadeRise(tl, tag, tChord, 0.45);
  fadeRise(tl, plat, tChord + 0.50, 0.45);
  tl.fromTo(push, {scale: 1}, {scale: 1.015, duration: s.end - s.start, ease: 'sine.inOut'}, s.start);
}
