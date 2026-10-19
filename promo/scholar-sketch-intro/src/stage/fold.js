// Page turn from the logo's folded corner (DIRECTION.md 手法 1). A 45° crease sweeps from the bottom-right
// corner to the top-left; behind it the outgoing page is cut away and the next page shows; on the
// outgoing side of the crease a flat sage band is the folded-back paper, with a 1px ink crease line.
// Pure function of time: registered with onRenderRange, it sets clip-path on the outgoing elements.
import {onRenderRange} from '../engine.js';
import {FRAME, COLOR} from './layout.js';

const W = FRAME.w, H = FRAME.h, BAND = 230;   // band width measured along x + y
const ease = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);   // power2.inOut

/** Region of the frame where x + y < c, as polygon points. */
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
/** Band between two crease positions: points of {lo < x + y < hi} inside the frame. */
function band(lo, hi) {
  const a = below(hi), b = below(Math.max(lo, 0));
  if (!a.length) return [];
  // walk the hi region and then the lo region backwards (both start at the top-left corner)
  return b.length ? [...a.slice(1), ...b.slice(1).reverse()] : a;
}
const pts = list => list.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');

/**
 * turn({start, dur, outgoing: () => [elements]}) — elements are full-frame layers (inset 0), so clip
 * coordinates are frame coordinates. Before `start` they are untouched; after the turn they get
 * clip-path polygon(0 0,0 0,0 0) (nothing) until `hideUntil` (the caller hides them on the timeline).
 */
export function pageTurn({start, dur = 0.7, outgoing}) {
  const flap = () => document.querySelector('#fold-flap .flap');
  const crease = () => document.querySelector('#fold-flap .crease');
  onRenderRange(start - 0.8, start + dur + 0.8, (_local, t) => {
    const u = Math.min(1, Math.max(0, (t - start) / dur));
    const active = t >= start && t < start + dur;
    const c = (W + H + BAND) * (1 - ease(u));
    for (const el of outgoing()) {
      if (!el) continue;
      if (t < start) el.style.clipPath = '';
      else el.style.clipPath = u >= 1 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${below(c).map(([x, y]) => `${x}px ${y}px`).join(', ') || '0 0, 0 0, 0 0'})`;
    }
    const f = flap(), k = crease();
    if (!f || !k) return;
    // Only this turn owns the flap while it is active; outside, leave it to the other turn.
    if (!active) { if (t >= start - 0.8 && t < start) { f.setAttribute('points', ''); k.style.opacity = '0'; } else if (t >= start + dur) { f.setAttribute('points', ''); k.style.opacity = '0'; } return; }
    f.setAttribute('points', pts(band(c - BAND, c)));
    f.style.fill = COLOR.sage;
    // crease: the visible segment of x + y = c
    const x1 = Math.max(0, c - H), y1 = Math.min(H, c), x2 = Math.min(W, c), y2 = Math.max(0, c - W);
    Object.assign(k.style, {opacity: c > 0 && c < W + H ? '1' : '0', stroke: COLOR.ink, strokeWidth: '2px'});
    k.setAttribute('x1', x1); k.setAttribute('y1', y1); k.setAttribute('x2', x2); k.setAttribute('y2', y2);
  });
}
