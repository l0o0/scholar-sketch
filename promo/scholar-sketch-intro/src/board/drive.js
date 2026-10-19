// Real, time-driven interactions with the production whiteboard (registered with onDrive).
// Idempotent: discrete steps run once in order; seeking backwards resets the board through the
// product's own runtime.loadSnapshot() and replays the steps up to the wanted time.
import {frame} from '../engine.js';
import {localToScreen} from './local-space.js';
// Coordinates: with local-space.js installed, rects inside .wb-scale are in product px, and so are the
// clientX/clientY of every event sent here — the same space the product computes in.

// The board lives in the persistent full-frame layer `.layer-board` (src/canvas/board-layer.jsx).
let ROOT = '.layer-board';
export const setDriveRoot = sel => { ROOT = sel; };
const root = () => document.querySelector(ROOT);
export const $ = sel => root()?.querySelector(sel);
export const $$ = sel => [...(root()?.querySelectorAll(sel) ?? [])];
export const nodeEl = id => $(`.react-flow__node[data-id="${id}"]`);

/** Point of an element in product px (fx, fy = fraction of its box). */
export function at(el, fx = 0.5, fy = 0.5) {
  const r = el.getBoundingClientRect();
  return {x: r.left + r.width * fx, y: r.top + r.height * fy};
}
const hit = p => { const s = localToScreen(p, $('.wb-root')); return document.elementFromPoint(s.x, s.y) || document.body; };
function fire(el, type, p, extra = {}) {
  const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
  const pressed = /down|move/.test(type) && extra.buttons !== 0;
  el.dispatchEvent(new Ctor(type, {bubbles: true, cancelable: true, composed: true, view: window,
    clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, button: 0, buttons: pressed ? 1 : 0,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, detail: 1, ...extra}));
}
/** Hover: React synthesises onMouseEnter from mouseover/out, xyflow listens to mouseenter via React. */
export function hover(el, p = at(el)) {
  fire(el, 'pointerover', p, {buttons: 0}); fire(el, 'pointerenter', p, {buttons: 0, bubbles: false});
  fire(el, 'mouseover', p, {buttons: 0}); fire(el, 'mouseenter', p, {buttons: 0, bubbles: false});
  fire(el, 'pointermove', p, {buttons: 0}); fire(el, 'mousemove', p, {buttons: 0});
}
/** A full mouse click as the browser sends it. */
export function realClick(el, p = at(el)) {
  hover(el, p);
  fire(el, 'pointerdown', p); fire(el, 'mousedown', p);
  fire(el, 'pointerup', p); fire(el, 'mouseup', p);
  fire(el, 'click', p);
}
/** Right click: the browser sends pointerdown/mousedown (button 2), pointerup/mouseup, then contextmenu. */
export function contextClick(el, p = at(el)) {
  hover(el, p);
  const b = {button: 2, buttons: 2};
  fire(el, 'pointerdown', p, b); fire(el, 'mousedown', p, b);
  fire(el, 'pointerup', p, {button: 2, buttons: 0}); fire(el, 'mouseup', p, {button: 2, buttons: 0});
  fire(el, 'contextmenu', p, {button: 2, buttons: 0});
}
/** Press on el, then move the window-level mouse (d3-drag listens on window) and release. */
export const drag = {
  // xyflow only starts a node drag on the first move past nodeDragThreshold (1px) and moves the node
  // from the next move on, so press + a 2px "kick" like a real hand, then every later move counts.
  down(el, p) { hover(el, p); fire(el, 'pointerdown', p); fire(el, 'mousedown', p); this.move({x: p.x, y: p.y - 2}); },
  move(p) { fire(hit(p), 'pointermove', p); window.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, cancelable: true, view: window, clientX: p.x, clientY: p.y, buttons: 1})); },
  up(p) { fire(hit(p), 'pointerup', p); window.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, view: window, clientX: p.x, clientY: p.y, button: 0})); },
};

/**
 * steps: [{at, run}] discrete actions (local time). continuous: [{from, to, run(u, local)}] e.g. drag moves.
 * reset(): restore the initial product state (called when seeking backwards).
 * before(time): bring time-driven context (cameras) to `time`. Each step runs in the context of its OWN
 * time, so a step behaves the same whether we got here by playing forward or by jumping.
 */
export function timeline(steps, {reset, before, continuous = []}) {
  let done = 0;
  return async local => {
    const want = steps.filter(s => local >= s.at).length;
    if (want < done) { await reset(); done = 0; await frame(); await frame(); }
    while (done < want) { if (before) await before(steps[done].at); await steps[done].run(local); done++; await frame(); await frame(); }
    if (before) await before(local);
    for (const c of continuous) if (local >= c.from && local < c.to && c.when?.() !== false) { await c.run((local - c.from) / (c.to - c.from), local); await frame(); }
  };
}
