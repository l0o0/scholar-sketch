import React from 'react';
import {shot as shotById} from '../engine.js';
// Page-margin notes: the film's own words sit beside the product window like a reader's margin notes
// (DIRECTION.md 手法 4). Text comes from plan.json (headline / description / tag). Separate spans
// for Latin product names are produced by <Mixed> so Chinese and Latin each get their assigned font.
const LATIN = /([A-Za-z][A-Za-z0-9.\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.\-]*)*|\[\[|\d+(?:\.\d+)*)/g;
export function Mixed({text}) {
  const parts = String(text).split(LATIN);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="en" lang="en">{p}</span> : p ? <span key={i} lang="zh-CN">{p}</span> : null))}</>;
}
/** Manual line breaks: use "\n" in headline text (plan.json keeps the unbroken version). */
export function Lines({text, className}) {
  return <span className={className}>{String(text).split('\n').map((l, i) => <span key={i} className="line"><Mixed text={l} /></span>)}</span>;
}

/** Margin caption for layout L (left column) or the top band for T / D. */
export function Caption({id, variant = 'margin', title, desc, tag}) {
  const s = shotById(id);
  return <div className={'caption caption-' + variant} data-caption={id}>
    {(tag ?? s.tag) && <div className="cap-tag"><Mixed text={tag ?? s.tag} /></div>}
    <h2 className="cap-title"><Lines text={title ?? s.headline} /></h2>
    <p className="cap-desc"><Lines text={desc ?? s.description} /></p>
  </div>;
}

/** Standard caption motion on the master timeline: tag outline → title → description; exit before the cut. */
export function revealCaption(tl, id, {at, exit, rise = 12} = {}) {
  const s = shotById(id);
  const root = document.querySelector(`[data-caption="${id}"]`);
  if (!root) throw new Error(`No caption for ${id}`);
  const t0 = s.start + (at ?? 0.15), descAt = s.start + Math.max(s.descriptionAt ?? 0, (at ?? 0.15) + 0.25);
  const tag = root.querySelector('.cap-tag'), title = root.querySelector('.cap-title'), desc = root.querySelector('.cap-desc');
  tl.set(root, {opacity: 1}, s.start - 0.01);
  if (tag) tl.fromTo(tag, {opacity: 0, y: rise}, {opacity: 1, y: 0, duration: 0.4, ease: 'power2.out'}, t0 - 0.1);
  tl.fromTo(title, {opacity: 0, y: rise}, {opacity: 1, y: 0, duration: 0.45, ease: 'power2.out'}, t0);
  tl.fromTo(desc, {opacity: 0, y: rise}, {opacity: 1, y: 0, duration: 0.45, ease: 'power2.out'}, descAt);
  const out = exit ?? s.end - 0.3;
  if (out !== false) tl.to(root, {opacity: 0, duration: 0.3, ease: 'power1.in'}, out);
}
