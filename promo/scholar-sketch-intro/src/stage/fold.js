// Page turn from the logo's folded corner (DIRECTION.md 手法 1). A 45° crease sweeps from the bottom-right
// corner to the top-left; behind it the outgoing page is cut away and the next page shows; on the
// outgoing side of the crease a flat sage band is the folded-back paper, with a thin ink crease line.
// One render hook over the whole film owns every outgoing element's clip-path and z-index, so several
// turns can share an element (the board layer leaves at the first turn and comes back for #11).
import {onRenderRange} from '../engine.js';
import {FRAME, COLOR} from './layout.js';
import plan from '../../plan.json';

const W = FRAME.w, H = FRAME.h, BAND = 230;   // sage band width measured along x + y
const ease = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);   // power2.inOut

/** Region of the frame where x + y < c, as polygon points (clockwise from the top-left corner). */
function below(c) {
  if (c <= 0) return [];
  if (c >= W + H) return [[0, 0], [W, 0], [W, H], [0, H]];
  const pts = [[0, 0]];
  pts.push(c <= W ? [c, 0] : [W, 0]);
  if (c > W) pts.push([W, c - W]);
  if (c > H) pts.push([c - H, H]);
  pts.push(c <= H ? [0, c] : [0, H]);
  return pts;
}
/** Points of the band {lo < x + y < hi} inside the frame. */
function band(lo, hi) {
  const a = below(hi), b = below(Math.max(lo, 0));
  if (!a.length) return [];
  return b.length ? [...a.slice(1), ...b.slice(1).reverse()] : a;
}
const svgPts = list => list.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
const NONE = 'polygon(0 0, 0 0, 0 0)';
/** Crease position for a turn at time t (W + H + BAND → 0). */
const creaseAt = (turn, t) => (W + H + BAND) * (1 - ease(Math.min(1, Math.max(0, (t - turn.start) / turn.dur))));

/**
 * registerTurns([{id, start, dur, outgoing: [selector…], release}]) — outgoing elements must be full-frame
 * (inset 0) so clip coordinates are frame coordinates. Before a turn they are untouched; during it they are
 * cut along the crease and lifted above everything else; after it they stay fully clipped until `release`
 * (film seconds; omit = forever), when the clip is removed so the element can come back.
 */
export function registerTurns(turns) {
  const sorted = [...turns].sort((a, b) => a.start - b.start);
  const selectors = [...new Set(sorted.flatMap(t => t.outgoing))];
  onRenderRange(0, plan.duration, (_local, t) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      let clip = '', lifted = false;
      for (const turn of sorted) {
        if (!turn.outgoing.includes(sel) || t < turn.start) continue;
        if (t < turn.start + turn.dur) { clip = `polygon(${below(creaseAt(turn, t)).map(([x, y]) => `${x}px ${y}px`).join(', ') || '0 0, 0 0, 0 0'})`; lifted = true; }
        else clip = t < (turn.release ?? Infinity) ? NONE : '';
      }
      el.style.clipPath = clip;
      if (!('z0' in el.dataset)) el.dataset.z0 = el.style.zIndex;   // sections carry an inline z-index (film.jsx)
      el.style.zIndex = lifted ? '85' : el.dataset.z0;
    }
    const flap = document.querySelector('#fold-flap .flap'), crease = document.querySelector('#fold-flap .crease');
    const active = sorted.find(turn => t >= turn.start && t < turn.start + turn.dur);
    if (!active) { flap.setAttribute('points', ''); crease.style.opacity = '0'; return; }
    const c = creaseAt(active, t);
    flap.setAttribute('points', svgPts(band(c - BAND, c)));
    flap.style.fill = COLOR.sage;
    const x1 = Math.max(0, c - H), y1 = Math.min(H, c), x2 = Math.min(W, c), y2 = Math.max(0, c - W);
    Object.assign(crease.style, {opacity: c > 0 && c < W + H ? '1' : '0', stroke: COLOR.ink, strokeWidth: '2px'});
    crease.setAttribute('x1', x1); crease.setAttribute('y1', y1); crease.setAttribute('x2', x2); crease.setAttribute('y2', y2);
  });
}
