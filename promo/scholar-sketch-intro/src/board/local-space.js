// Display adapter: make the product see its own 1× coordinate space while the film scales it.
//
// The whiteboard positions its floating chrome (style bar, flyouts, properties panel) by mixing
// getBoundingClientRect() (screen px) with CSS left/top (local px), and xyflow's
// flowToScreenPosition adds the pane's screen origin to renderer-local coordinates. That is exact
// at 1×, but under the film's scale (.wb-scale) or any camera transform on an ancestor it drifts
// by the scale factor (e.g. the style bar lands off-centre). For elements inside `.wb-scale`, report
// rects in the scaled layer's own CSS px, as if the product were rendered unscaled at (0, 0).
// Synthetic events sent by the film's drivers use the same local coordinates (drive.js), so
// pointer math in xyflow/d3 stays consistent too. Elements outside the layer are untouched.
const HOST = '.wb-scale';
const elementRect = Element.prototype.getBoundingClientRect;
const elementRects = Element.prototype.getClientRects;
const rangeRect = Range.prototype.getBoundingClientRect;

/** Unpatched screen rect (for film-side measuring: cursor overlays, camera aims). */
export const screenRect = el => elementRect.call(el);

function frameOf(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const host = el?.closest?.(HOST);
  if (!host) return null;
  const h = elementRect.call(host);
  const k = host.offsetWidth ? h.width / host.offsetWidth : 1;
  return {host, x: h.left, y: h.top, k: k || 1};
}
const toLocal = (r, f) => new DOMRect((r.left - f.x) / f.k, (r.top - f.y) / f.k, r.width / f.k, r.height / f.k);

/** Local (product px) → screen, for APIs that need real viewport coordinates (elementFromPoint). */
export function localToScreen(p, anyInside) {
  const f = frameOf(anyInside);
  return f ? {x: f.x + p.x * f.k, y: f.y + p.y * f.k} : p;
}

// The product clamps menus to window.innerWidth/innerHeight. Inside the scaled layer the "window" the
// product believes in is the layer itself, so report its size. (Film code never reads innerWidth; the
// drivers run before the engine toggles shot visibility, so do not gate this on visibility.)
function patchWindowSize() {
  for (const [prop, dim] of [['innerWidth', 'offsetWidth'], ['innerHeight', 'offsetHeight']]) {
    const d = Object.getOwnPropertyDescriptor(window, prop) || Object.getOwnPropertyDescriptor(Window.prototype, prop);
    const real = d?.get ? () => d.get.call(window) : () => d?.value;
    Object.defineProperty(window, prop, {configurable: true, get() {
      const host = document.querySelector(HOST);
      return host ? host[dim] : real();
    }});
  }
}

let installed = false;
export function installLocalSpace() {
  if (installed) return; installed = true;
  patchWindowSize();
  Element.prototype.getBoundingClientRect = function () {
    const r = elementRect.call(this);
    const f = frameOf(this);
    if (!f) return r;
    if (this === f.host) return new DOMRect(0, 0, this.offsetWidth, this.offsetHeight);
    return toLocal(r, f);
  };
  Element.prototype.getClientRects = function () {
    const list = elementRects.call(this);
    const f = frameOf(this);
    if (!f) return list;
    const out = Array.from(list, r => toLocal(r, f));
    out.item = i => out[i] ?? null;
    return out;
  };
  Range.prototype.getBoundingClientRect = function () {
    const r = rangeRect.call(this);
    const f = frameOf(this.commonAncestorContainer);
    return f ? toLocal(r, f) : r;
  };
}
