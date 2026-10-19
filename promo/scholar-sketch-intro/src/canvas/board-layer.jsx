// Chapter 1 "研究白板": the persistent board layer (full frame; the page-turn system clips `.layer-board`).
//   .cv-header   chapter header (real attachment-canvas.svg + 研究白板), frame px
//   .win.cv-win  the board window, base 1248 × 968 frame px; layouts move/scale it (GSAP x/y/scale, origin 0 0)
//     .wb-scale        the REAL WhiteboardApp laid out at 674.6 × 523.2 product px and scaled by S = 1.85
//     .cv-strip        "示例文库 · 示意" reconstruction strip (frame px), drop beat only
//     .cv-overlay      film cursor + drag ghost in product px (same scale as .wb-scale, above the strip)
import React, {useEffect, useSyncExternalStore} from 'react';
import {ReactFlowProvider, useReactFlow} from '@xyflow/react';
import {WhiteboardApp} from '@wb/whiteboard/app';
import labels from '../fixtures/wb-labels.zh.json';
import {createFilmLibrary} from '../board/library.js';
import {buildFilmBoard} from '../board/fixture.js';
import {installLocalSpace} from '../board/local-space.js';
import {itemByKey} from '../library/zotero.js';
import {ITEMS, KEYS} from '../library/fixture.js';
import {Cursor} from '../kit/cursor.jsx';
import {BOARD_WIN, actionTime} from '../stage/layout.js';
import '../board/board-shot.css';
import './canvas.css';

installLocalSpace();
export const S = BOARD_WIN.scale;                                  // 1.85
// 674 × 523 product px (whole CSS px: Chromium snaps a box's background to whole local px before the 1.85 scale,
// so a fractional size would paint ~1 frame px past the window edge).
export const PW = Math.floor(BOARD_WIN.w / S), PH = Math.floor(BOARD_WIN.h / S);
export const DARK_AT = actionTime('dark-switch');
export const library = createFilmLibrary();
export const initialBoard = buildFilmBoard(library.acquire, {theme: 'light'});
export const wb = {library, flow: null, runtime: null};
window.__cv = wb;

// Host side of a Zotero drag (src/modules/whiteboard/tab.ts handleDropAcademicSources): look the dropped
// items up and acquire them through the PRODUCTION gateway, then hand the batch back to the runtime.
// gateway.acquireItem is synchronous here, so the placeholder ("Loading…") never reaches a frame.
const callbacks = {
  ...library.callbacks,
  onDropAcademicSources(requestId, nodeId, sources) {
    const successes = sources.map((source, index) => ({index, acquisition: library.gateway.acquireItem(itemByKey(source.itemKey ?? source.attachmentKey))}));
    wb.runtime?.resolveAcademicAcquisitionBatch(requestId, nodeId, successes, []);
  },
};

function FlowBridge() {   // xyflow public instance API (setViewport / getViewport) for the in-product camera
  const flow = useReactFlow();
  useEffect(() => { wb.flow = flow; }, [flow]);
  return null;
}

// The host sets WhiteboardApp's `theme` from prefers-color-scheme (src/modules/whiteboard/tab.ts:118-140);
// in the film the "system" turns dark at the dark-switch action. The board driver owns this value (it replays
// earlier steps in their own light context when seeking), so it is a store the driver sets, not the film clock.
export const themeAt = t => (t >= DARK_AT - 0.002 ? 'dark' : 'light');   // lands on frame 1415 (47.1667)
let themeValue = 'light';
const themeListeners = new Set();
export const systemTheme = {
  get: () => themeValue,
  set(v) { if (v === themeValue) return; themeValue = v; themeListeners.forEach(fn => fn()); },
  subscribe(fn) { themeListeners.add(fn); return () => themeListeners.delete(fn); },
};
const useTheme = () => useSyncExternalStore(systemTheme.subscribe, systemTheme.get, () => 'light');

/** The three invented papers of the demo library (src/library/fixture.js), as neutral rows. */
export const STRIP_ROWS = [KEYS.paper, KEYS.greenway, KEYS.water].map(key => {
  const it = ITEMS.find(i => i.key === key);
  const who = it.creators.map(c => c.lastName + c.firstName).join('、');
  return {key, title: it.fields.title, meta: `${who} · ${it.fields.date.slice(0, 4)}`};
});

export function BoardLayerView() {
  const theme = useTheme();
  return <div className="cv-board">
    <div className="chapter-header cv-header">
      <img className="cv-header-icon" src="addon-icons/attachment-canvas.svg" alt="" />
      <span className="cv-header-name">研究白板</span>
    </div>
    <div className={'win cv-win' + (theme === 'dark' ? ' is-dark' : '')} style={{width: BOARD_WIN.w, height: BOARD_WIN.h}}>
      <div className="wb-scale" style={{width: PW, height: PH, transform: `scale(${S})`}}>
        <div id="whiteboard-root" className="wb-root" data-theme={theme}>
          <ReactFlowProvider>
            <WhiteboardApp
              {...callbacks}
              theme={theme}
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
      </div>
      <div className="cv-strip">
        <div className="cv-strip-head"><span>示例文库</span><span className="recon-mark cv-recon">示意</span></div>
        {STRIP_ROWS.map((r, i) => <div key={r.key} className={'cv-row' + (i === 0 ? ' is-first' : '')}>
          <div className="cv-row-title">{r.title}</div><div className="cv-row-meta">{r.meta}</div>
        </div>)}
      </div>
      <div className="cv-overlay" style={{width: PW, height: PH, transform: `scale(${S})`}}>
        <div className="cv-ghost"><div className="cv-row-title">{STRIP_ROWS[0].title}</div><div className="cv-row-meta">{STRIP_ROWS[0].meta}</div></div>
        <Cursor id="board" />
      </div>
    </div>
  </div>;
}
