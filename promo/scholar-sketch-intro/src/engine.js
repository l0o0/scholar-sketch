// Deterministic film engine. seek(t) is a pure function of t:
//   1. publish t to React (discrete product states re-render synchronously)
//   2. run DOM drivers (real interactions: typing, clicks, popovers) and await them
//   3. seek the paused GSAP master timeline
//   4. toggle shot visibility, then call per-shot render hooks (canvas / WebGL layers)
// Besides per-shot hooks, this film has persistent layers (the product windows live across several
// shots), so drivers and render hooks can also be registered for an absolute time range.
import gsap from 'gsap';
import {flushSync} from 'react-dom';
import plan from '../plan.json';
import {FilmClock} from './film-store.js';

gsap.ticker.sleep();                       // never tick on wall-clock time
export const master = gsap.timeline({paused: true});
export const shots = plan.shots;
export const shot = id => {
  const s = shots.find(x => x.id === id);
  if (!s) throw new Error(`Unknown shot "${id}"`);
  return s;
};
const renders = [], drivers = [];
/** Canvas/WebGL/text work that must be recomputed every frame. fn(localTime, filmTime). */
export const onRender = (id, fn) => { const s = shot(id); renders.push({start: s.start, end: s.end, fn}); };
/** Real product interaction for a shot. fn(localTime) may return a Promise (e.g. wait for a popover). */
export const onDrive = (id, fn) => { const s = shot(id); drivers.push({start: s.start, end: s.end, fn}); };
/** Same as onRender / onDrive for an absolute film-time range; fn receives (time - start, time). */
export const onRenderRange = (start, end, fn) => renders.push({start, end, fn});
export const onDriveRange = (start, end, fn) => drivers.push({start, end, fn});
export const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const PAD = 0.8;   // shots stay mounted/visible this long around their window so transitions can overlap
const near = (s, t) => t >= s.start - PAD && t < s.end + PAD;

export async function seek(seconds) {
  const t = Math.min(Math.max(Number(seconds) || 0, 0), plan.duration - 1 / plan.fps);
  flushSync(() => FilmClock.set(t));
  // Drivers run in registration order and one at a time: persistent product layers share global state.
  for (const d of drivers) if (near(d, t)) await d.fn(t - d.start, t);
  master.seek(t, true);
  for (const s of shots) {
    const el = document.querySelector(`section[data-shot="${s.id}"]`);
    if (el) el.style.visibility = near(s, t) ? 'visible' : 'hidden';
  }
  for (const r of renders) if (near(r, t)) r.fn(t - r.start, t);
  window.CURRENT_TIME = t;
}
