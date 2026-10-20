// Geometry for the film's own cards (#1 brand, #2 entry, #12 files, #13 end). Frame pixels at 1080p.
// Logo numbers were measured on public/brand/logo-lockup.png (856×367, RGBA) with PIL:
//   page outline outer edge x 40.2–259.8, y 40.1–327.5; ink stroke 18.9–20.2 px (≈ 8.9 % of the
//   219.6 px icon width); outer corner radius ≈ 20.7 (TL / TR / BL); bottom-right curve: circle
//   centre ≈ (188.4, 257.0), outer radius 70.9. Sage fold triangle: x 166–240, y 229–306, flat colour
//   #728c7a, its 45° crease (sage → ink) sits on x + y = 475.5 (pixel-edge coordinates).
//   Wordmark "Scholar Sketch" starts at x 322, so x = 300 splits icon and wordmark cleanly.
import ftl from '@addon/locale/zh-CN/addon.ftl';

export const LOGO = {
  src: 'brand/logo-lockup.png', w: 856, h: 367,
  x: 532, y: 277,                         // integer placement, 1× → pixel-identical to the PNG
  split: 300,                             // icon | wordmark
  page: {cx: 150, cy: 183.8, w: 219.6, h: 287.4},
};
/** Page-outline centre line, clockwise from the top-left (PNG px). Split in three so the wide
 *  companion stroke (B) can share arc length with the main stroke (A). */
const PRE = 'M49.75 60.5A10.75 10.75 0 0 1 60.5 49.75H239.5A10.75 10.75 0 0 1 250.25 60.5V226';
const MID = 'V256.5A61.25 61.25 0 0 1 189 317.75H158';
const POST = 'H60.5A10.75 10.75 0 0 1 49.75 307V60.5';
export const INK = {
  pre: PRE, a: PRE + MID + POST, b: 'M250.25 226' + MID,
  widthA: 30,   // covers the 19.5 px ink line with margin; its edges stay in transparent pixels
  widthB: 84,   // reaches the crease from the bottom-right curve, so the ink corner fills with the line
  /** Sage fold region (convex), excluded from the ink mask and revealed by the fold wipe. */
  fold: [[164, 227.5], [241, 227.5], [241, 234.5], [168.5, 307], [164, 307]],
  crease: 475.5, foldEnd: 391.5,          // wipe line x + y = c, from the crease to the fold's corner
};

/** Toolbar icon in #2 (real scholar-sketch-toolbar.svg, 96 px). Its page centre is the logo's page
 *  centre shrunk and moved up (DIRECTION #1 → #2 "缩小上移"). */
export const TOOL = {x: 634, y: 352, size: 96, cx: 682, cy: 400};
// The toolbar SVG's page (outer stroke edge) is 67.5 × 85.5 px at 96 px; the logo page is 219.6 × 287.4.
export const TOOL_SCALE = (67.5 / 219.6 + 85.5 / 287.4) / 2;
export const ROWS = {x: 778, y: 320, rowH: 72, gap: 16, icon: 48};
export const HEADER_ICON = {x: 96, y: 96, size: 44};   // chapter-1 header icon (layout L)
/** Film cursor box in #2 (px). The arrow path spans ≈ 0.81 of the box plus its white stroke: 35 px → ≈ 30 px
 *  tall on screen (DIRECTION §5.6). Keep in sync with .en-cursor .film-cursor svg in brand.css. */
export const CURSOR = 35;

/** Exact product strings from the shipped zh-CN locale. */
export function ftlString(key) {
  const m = ftl.match(new RegExp('^' + key.replace(/-/g, '\\-') + ' = (.*)$', 'm'));
  if (!m) throw new Error(`addon.ftl: missing ${key}`);
  return m[1].trim();
}
