import './fake-api.js';
import './library/zotero.js';   // the film's one fake Zotero, installed before any product module
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Film} from './film.jsx';
import {seek, frame, master} from './engine.js';
import {SHOT_BUILDERS, LAYER_BUILDERS} from './shots/index.js';
import plan from '../plan.json';
import {preloadGlyphs, EXTRA_GLYPHS} from './stage/glyphs.js';
// If the product uses motion/framer-motion, make its micro-animations jump to the end state:
//   import {MotionGlobalConfig} from 'motion/react'; MotionGlobalConfig.skipAnimations = true;

const root = createRoot(document.getElementById('film-root'));
flushSync(() => root.render(<Film />));
window.seek = seek;
window.__master = master;
window.__filmReady = (async () => {
  await document.fonts.ready;
  await new Promise(r => setTimeout(r, 800));   // fixture fetches and effects settle
  await preloadGlyphs(document, document.body.textContent + JSON.stringify(plan) + EXTRA_GLYPHS);
  await frame(); await frame();
  // Builders run after layout exists: they can measure real component positions.
  // Builders may be async. Only await real Promises: a GSAP timeline is thenable and a paused one
  // never resolves, so `tl => tl.set(...)` returning the timeline must not be awaited.
  // Each builder starts with the master playhead at 0: the board's rehearsal seeks the master to measure
  // camera targets, and GSAP renders a child added behind the playhead at once (recording wrong start values).
  for (const build of [...LAYER_BUILDERS, ...Object.values(SHOT_BUILDERS)]) { master.seek(0, true); const r = build(master); if (r instanceof Promise) await r; }
  master.seek(0, true);
  await seek(0);
})();
let t0 = null, req = null;
window.playFilm = () => { cancelAnimationFrame(req); t0 = null; const loop = async now => { t0 ??= now; await seek((now - t0) / 1000); req = requestAnimationFrame(loop); }; req = requestAnimationFrame(loop); };
window.stopFilm = () => cancelAnimationFrame(req);
