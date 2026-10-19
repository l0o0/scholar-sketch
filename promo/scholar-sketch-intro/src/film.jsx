import React from 'react';
import {ShotContext} from './film-store.js';
import {shots} from './engine.js';
import {SHOT_VIEWS, LAYERS} from './shots/index.js';
import {Placeholder} from './stage/placeholder.jsx';
// Paint order: paper → persistent product windows (layers) → per-shot sections (captions, cards) →
// page-turn flap → poster. Layers live across several shots; their builders control their visibility.
export function Film() {
  return <main id="film" className="film-theme">
    <div id="paper" />
    {LAYERS.map(L => <div key={L.id} className={'layer layer-' + L.id} data-layer={L.id}><L.View /></div>)}
    {shots.map((s, i) => {
      const View = SHOT_VIEWS[s.id] || Placeholder;
      return <section key={s.id} data-shot={s.id} className={'shot shot-' + s.id} style={{zIndex: 20 + i}}>
        <ShotContext.Provider value={s}><View shot={s} /></ShotContext.Provider>
      </section>;
    })}
    <svg id="fold-flap" width="1920" height="1080" viewBox="0 0 1920 1080"><polygon className="flap" points="" /><line className="crease" /></svg>
    {__HAS_POSTER__ && <img id="poster" src="poster.png" alt="" />}
  </main>;
}
