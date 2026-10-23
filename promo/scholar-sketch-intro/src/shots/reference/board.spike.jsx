// Whiteboard shot: mounts the REAL production WhiteboardApp (packages/whiteboard/src/whiteboard/app.tsx)
// with a fixture board, Chinese product labels and a fake Zotero library behind the production gateway.
//   .wb-cam    film camera (GSAP transform on an outer wrapper)
//   .wb-scale  video scale: the product root is laid out at (W/S × H/S) CSS px and scaled by S
//   #whiteboard-root  same root styles as addon/content/whiteboard/index.html
import React, {useEffect} from 'react';
import {ReactFlowProvider, useReactFlow} from '@xyflow/react';
import {WhiteboardApp} from '@wb/whiteboard/app';
import labels from '../fixtures/wb-labels.zh.json';
import {createFilmLibrary} from '../board/library.js';
import {buildFilmBoard, IDS} from '../board/fixture.js';
import {$, nodeEl, at, realClick, hover, drag, timeline} from '../board/drive.js';
import {installLocalSpace} from '../board/local-space.js';
import {Cursor, paintCursor} from '../kit/cursor.jsx';
import {shot, onDrive, onRender, frame} from '../engine.js';
import plan from '../../plan.json';

const params = new URLSearchParams(location.search);
export const BOARD_SCALE = Number(params.get('wbScale')) || 1.85;   // 12px card body → 22.2px on a 1080p frame
const THEME = params.get('wbTheme') === 'dark' ? 'dark' : 'light';
if (params.get('wbLocal') !== '0') installLocalSpace();   // ?wbLocal=0 shows the unpatched behaviour
const library = createFilmLibrary();
export const initialBoard = buildFilmBoard(library.acquire, {theme: THEME});
export const wb = {library, flow: null, runtime: null};
window.__wb = wb;
window.__wbDrive = {$, nodeEl, at, realClick, hover, drag, IDS: null};   // console/probe access

function FlowBridge() {   // xyflow public instance API (setViewport / getViewport) for the in-product camera
  const flow = useReactFlow();
  useEffect(() => { wb.flow = flow; }, [flow]);
  return null;
}

export function BoardView() {
  const W = plan.width / BOARD_SCALE, H = plan.height / BOARD_SCALE;
  return <div className={'wb-stage is-' + THEME}>
    <div className="wb-cam">
      <div className="wb-scale" style={{width: W, height: H, transform: `scale(${BOARD_SCALE})`}}>
        <div id="whiteboard-root" className="wb-root" data-theme={THEME}>
          <ReactFlowProvider>
            <WhiteboardApp
              {...library.callbacks}
              theme={THEME}
              editable
              colorScheme="traditional"
              appearance={{fontFamily: 'system', backgroundColor: ''}}
              labels={labels}
              initialSnapshot={initialBoard}
              onReady={api => { library.callbacks.onReady(api); wb.runtime = api; }}
            />
            <FlowBridge />
          </ReactFlowProvider>
        </div>
        <Cursor id="wb" />
      </div>
    </div>
  </div>;
}

// ---- interaction script (local seconds inside the shot) ----
const pane = () => $('.react-flow__pane');
const DRAG = {from: 6.6, to: 8.0, dy: -30};             // zNote starts 30px low → snaps to litB/claim tops
// Outer film camera (GSAP on .wb-cam) and in-product camera (xyflow viewport) windows.
const OUTER = {from: 11.0, to: 11.8, scale: 1.3, focus: IDS.claim};
const XY = [{at: 8.6, view: 'home'}, {at: 9.8, view: 'quote'}, {at: 10.2, view: 'quote'}, {at: 11.0, view: 'home'}];
const fillBtn = () => $('.zmd-board-style-bar button[data-color-target="fill"]');
export const STEPS = [
  {at: 0.9, name: 'select-source', target: () => nodeEl(IDS.litB), fy: 0.35, run() { realClick(nodeEl(IDS.litB), at(nodeEl(IDS.litB), 0.5, 0.35)); }},
  {at: 1.6, name: 'arm-format-painter', target: () => $('.zmd-board-style-bar .zmd-board-format-paint'), run() { realClick($('.zmd-board-style-bar .zmd-board-format-paint')); }},
  {at: 1.9, name: 'hover-target', click: false, target: () => nodeEl(IDS.litA), fy: 0.35, run() { hover(nodeEl(IDS.litA), at(nodeEl(IDS.litA), 0.5, 0.35)); }},
  {at: 2.5, name: 'paint-target', target: () => nodeEl(IDS.litA), fy: 0.35, run() { realClick(nodeEl(IDS.litA), at(nodeEl(IDS.litA), 0.5, 0.35)); }},
  {at: 3.6, name: 'deselect', target: () => pane(), point: () => at(nodeEl(IDS.claim), 0.5, -0.25), run() { realClick(pane(), at(nodeEl(IDS.claim), 0.5, -0.25)); }},
  {at: 4.2, name: 'select-claim', target: () => nodeEl(IDS.claim), run() { realClick(nodeEl(IDS.claim)); }},
  {at: 4.8, name: 'open-fill-menu', target: fillBtn, run() { realClick(fillBtn()); }},
  {at: 6.0, name: 'close-menu', target: () => pane(), point: () => at(nodeEl(IDS.question), 0.5, 1.35), run() { realClick(pane(), at(nodeEl(IDS.question), 0.5, 1.35)); }},
  {at: DRAG.from, name: 'drag-down', target: () => nodeEl(IDS.zNote), point: () => at(nodeEl(IDS.zNote), 0.5, 0.3), run() { const p = at(nodeEl(IDS.zNote), 0.5, 0.3); drag.start = p; drag.down(nodeEl(IDS.zNote), p); }},
  {at: DRAG.to, name: 'drag-up', click: false, run() { drag.move(dragPoint(1)); drag.up(dragPoint(1)); }},
  {at: 8.3, name: 'deselect-2', target: () => pane(), point: () => at(nodeEl(IDS.zNote), 0.5, 1.12), run() { realClick(pane(), at(nodeEl(IDS.zNote), 0.5, 1.12)); }},
  // under the outer camera push-in: the product must still anchor its chrome correctly
  {at: 11.9, name: 'select-claim-zoomed', target: () => nodeEl(IDS.claim), fy: 0.4, run() { realClick(nodeEl(IDS.claim), at(nodeEl(IDS.claim), 0.5, 0.4)); }},
  {at: 12.4, name: 'open-fill-menu-zoomed', target: fillBtn, run() { realClick(fillBtn()); }},
];
// With local-space.js the drag runs in product px: a flow delta d is a mouse delta d × xyflow zoom.
const dragPoint = u => {
  const k = Math.min(1, u * 1.15), e = 1 - Math.pow(1 - k, 3);    // ease out, arrive a little early to hold the snap
  const z = wb.flow?.getViewport().zoom ?? 1;
  return {x: drag.start.x, y: drag.start.y + DRAG.dy * z * e};
};
// In-product camera: xyflow's own viewport, driven through useReactFlow().setViewport().
const views = {};
const ease3 = u => (u < 0.5 ? 4 * u ** 3 : 1 - Math.pow(-2 * u + 2, 3) / 2);
function viewportAt(local) {
  const v = n => views[n] || initialBoard.viewport;
  if (local < XY[0].at) return v(XY[0].view);
  for (let i = 0; i < XY.length - 1; i++) {
    const a = XY[i], b = XY[i + 1];
    if (local < b.at) { const e = ease3((local - a.at) / (b.at - a.at)), p = v(a.view), q = v(b.view); return {x: p.x + (q.x - p.x) * e, y: p.y + (q.y - p.y) * e, zoom: p.zoom + (q.zoom - p.zoom) * e}; }
  }
  return v(XY[XY.length - 1].view);
}

const cursor = {keys: [], clicks: []};
async function resetBoard() {
  if (drag.start) { try { drag.up(drag.start); } catch {} }
  wb.runtime.loadSnapshot(initialBoard);
  await frame(); await frame();
}

export const buildBoard = id => async tl => {
  const s = shot(id);
  const section = document.querySelector(`section[data-shot="${id}"]`);
  const cam = section.querySelector('.wb-cam');
  tl.set(section, {opacity: 1}, s.start);
  tl.fromTo(cam, {opacity: 0}, {opacity: 1, duration: 0.4, ease: 'none'}, s.start);

  // Unicode-range font subsets load lazily; load every glyph the shot can show before any frame is taken.
  const glyphs = [...new Set(JSON.stringify(labels) + JSON.stringify(initialBoard) + section.textContent)].join('');
  await Promise.all(['400', '700'].map(w => document.fonts.load(`${w} 16px "PingFang SC"`, glyphs).catch(() => [])));
  // Rehearse once at build time: run the real steps, record where each click lands (product px),
  // then restore the board. The film cursor path is therefore measured, not guessed.
  section.style.visibility = 'visible';
  let last = at(nodeEl(IDS.claim), 0.9, 1.2);
  cursor.keys.push({at: 0, ...last});
  for (const step of STEPS) {
    const el = step.target?.();
    const p = el ? (step.point ? step.point() : at(el, 0.5, step.fy ?? 0.5)) : null;
    if (p) { cursor.keys.push({at: step.at - 0.45, ...last}, {at: step.at, ...p}); last = p; }
    if (step.click !== false) cursor.clicks.push(step.at);
    await step.run(); await frame(); await frame();
    if (step.name === 'drag-down') { const end = dragPoint(1); cursor.keys.push({at: DRAG.to, ...end}); last = end; }
  }
  await resetBoard();
  // Camera targets measured from the real layout (product px of the 1× layer).
  const host = $('.zmd-board-host');
  const fit = (nodeId, zoom, dy = 0) => { const n = initialBoard.nodes.find(m => m.id === nodeId); return {zoom, x: host.clientWidth / 2 - (n.position.x + n.width / 2) * zoom, y: host.clientHeight / 2 + dy - (n.position.y + n.height / 2) * zoom}; };
  views.home = initialBoard.viewport;
  views.quote = fit(IDS.quote, 1.45, 20);
  const c = at(nodeEl(OUTER.focus)), S = BOARD_SCALE, k = OUTER.scale;          // product px → frame px is × S
  tl.fromTo(cam, {x: 0, y: 0, scale: 1, transformOrigin: '0 0'}, {x: plan.width / 2 - k * S * c.x, y: plan.height / 2 - k * S * c.y, scale: k, duration: OUTER.to - OUTER.from, ease: 'power2.inOut', immediateRender: false}, s.start + OUTER.from);
  section.style.visibility = '';

  // xyflow camera. setViewport is synchronous for the transform, but WhiteboardApp re-anchors its chrome
  // in onMoveEnd, which xyflow fires from setTimeout(0): wait for it, then for layout.
  async function applyCameras(local) {
    tl.seek(s.start + local, true);   // outer (GSAP) camera
    const want = viewportAt(local), cur = wb.flow.getViewport();
    if (Math.abs(cur.x - want.x) + Math.abs(cur.y - want.y) + Math.abs(cur.zoom - want.zoom) * 100 <= 0.01) return;
    await wb.flow.setViewport(want, {duration: 0});
    await new Promise(r => setTimeout(r, 0)); await frame(); await frame();
  }
  const steps = timeline(STEPS, {reset: resetBoard, before: applyCameras, continuous: [{from: DRAG.from, to: DRAG.to, run: u => drag.move(dragPoint(u))}]});
  onDrive(id, local => steps(local));   // engine then seeks the master timeline to t as usual
  onRender(id, local => {
    const el = section.querySelector('.film-cursor');
    paintCursor(el, local, cursor.keys, cursor.clicks, [0.2, 13]);
    // While the product is in format-painter mode, show the product's own painter cursor image.
    const painting = !!section.querySelector('.zmd-board-host.is-format-painter');
    const svg = el.querySelector('svg'); let img = el.querySelector('img');
    if (painting) {
      const m = getComputedStyle(section.querySelector('.react-flow__pane')).cursor.match(/url\("?(.*?)"?\)/);
      if (m && !img) { img = document.createElement('img'); img.style.cssText = 'position:relative;z-index:2;display:block;width:28px;height:28px'; el.prepend(img); }
      if (m) img.src = m[1];
    }
    if (img) img.style.display = painting ? 'block' : 'none';
    svg.style.display = painting ? 'none' : 'block';
  });
};
window.__wbDrive.IDS = IDS;
export {IDS};
