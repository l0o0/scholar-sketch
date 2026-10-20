import React from 'react';
import './brand.css';
import {shot} from '../engine.js';
import {Caption, Mixed} from '../stage/captions.jsx';
import {Cursor} from '../kit/cursor.jsx';
import {ITEMS, FILENAMES, KEYS} from '../library/fixture.js';
import {LOGO, INK, TOOL, ROWS, ftlString} from './geometry.js';
// Views for the film's own cards. Everything here is film layer except the real product icons
// (addon/content/icons/*.svg, copied to public/addon-icons/) and the official logo PNG.
// Reconstructions (the two menu rows in #2, the attachment list in #12) carry a "示意" mark.

const ICONS = 'addon-icons/';
const pts = list => list.map(p => p.join(',')).join(' ');

/** The official lockup drawn as one ink stroke: two masked copies of the SAME PNG (ink outline, fold),
 *  then the plain PNG in two crops (icon | wordmark). Nothing is redrawn: every visible pixel is the PNG. */
function Logo() {
  const {w, h, src, split} = LOGO;
  return <div className="bd-logo" style={{left: LOGO.x, top: LOGO.y, width: w, height: h}}>
    <svg className="bd-ink" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <mask id="bd-mask-ink" maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
          <path className="bd-a" d={INK.a} fill="none" stroke="#fff" strokeWidth={INK.widthA} />
          <path className="bd-b" d={INK.b} fill="none" stroke="#fff" strokeWidth={INK.widthB} />
          <polygon points={pts(INK.fold)} fill="#000" shapeRendering="crispEdges" />
        </mask>
        <mask id="bd-mask-fold" maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
          <polygon className="bd-fold" points="" fill="#fff" shapeRendering="crispEdges" />
        </mask>
        <path className="bd-pre" d={INK.pre} />
      </defs>
      <image href={src} x="0" y="0" width={w} height={h} mask="url(#bd-mask-ink)" />
      <image href={src} x="0" y="0" width={w} height={h} mask="url(#bd-mask-fold)" />
    </svg>
    <div className="bd-crop bd-icon" style={{width: split, height: h}}><div className="bd-move"><img src={src} alt="" width={w} height={h} /></div></div>
    <div className="bd-crop bd-word" style={{left: split, width: w - split, height: h}}><div className="bd-move"><img src={src} alt="" width={w} height={h} style={{left: -split}} /></div></div>
  </div>;
}

export function BrandView() {
  return <div className="bd-stage">
    <Logo />
    <p className="bd-line" lang="zh-CN"><Mixed text={shot('brand').description} /></p>
  </div>;
}

/** #2: the real toolbar icon, a film cursor, and the menu's two creation items as plain rows on paper. */
export function EntryView() {
  const md = ftlString('toolbar-create-markdown'), wb = ftlString('menuitem-new-whiteboard');
  return <div className="en-stage">
    <div className="en-well" style={{left: TOOL.cx - 66, top: TOOL.cy - 66}} />
    <div className="en-tool" style={{left: TOOL.x, top: TOOL.y, width: TOOL.size, height: TOOL.size}}>
      <img src={ICONS + 'scholar-sketch-toolbar.svg'} alt="" width={TOOL.size} height={TOOL.size} />
    </div>
    <div className="en-rule" style={{left: ROWS.x - 18, top: ROWS.y + 4, height: ROWS.rowH * 2 + ROWS.gap - 8}} />
    <div className="en-rows" style={{left: ROWS.x, top: ROWS.y}}>
      <div className="en-row" data-row="md" style={{height: ROWS.rowH}}>
        <i className="en-hover" />
        <img className="en-ico" src={ICONS + 'attachment-markdown.svg'} alt="" width={ROWS.icon} height={ROWS.icon} />
        <span className="en-label"><Mixed text={md} /></span>
      </div>
      <div className="en-row" data-row="wb" style={{height: ROWS.rowH, marginTop: ROWS.gap}}>
        <i className="en-hover" />
        <img className="en-ico" src={ICONS + 'attachment-canvas.svg'} alt="" width={ROWS.icon} height={ROWS.icon} />
        <span className="en-label"><Mixed text={wb} /></span>
      </div>
      <div className="en-mark"><span className="recon-mark">示意</span></div>
    </div>
    <img className="en-fly" src={ICONS + 'attachment-canvas.svg'} alt="" />
    <Caption id="entry" variant="card" />
    <div className="en-cursor"><Cursor id="entry" color="#1a2527" /></div>
  </div>;
}

/** #11: copy only (the two product windows are another layer); the band turns dark with the desk. */
export function DarkView() {
  return <div className="dk-stage"><div className="dk-wrap"><Caption id="dark" variant="band" /></div></div>;
}

function FileGlyph() {   // neutral file shape for the PDF (no Zotero item-type icon)
  return <svg className="fl-ico fl-file" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
    <path d="M11 5.5h12.5L30 12v21.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 10 33.5V7a1.5 1.5 0 0 1 1-1.5Z" fill="none" stroke="#9aa1a0" strokeWidth="2" strokeLinejoin="round" />
    <path d="M23.5 5.5V12H30" fill="none" stroke="#9aa1a0" strokeWidth="2" strokeLinejoin="round" />
    <path d="M15 19h10M15 24h10M15 29h6" stroke="#c3c8c6" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
const ext = name => { const i = name.lastIndexOf('.'); return [name.slice(0, i), name.slice(i)]; };
function FileName({name}) { const [stem, dot] = ext(name); return <span className="fl-name"><span lang="zh-CN">{stem}</span><span className="en" lang="en">{dot}</span></span>; }

/** #12: a neutral attachment list (reconstruction) with the real attachment icons and type names. */
export function FilesView() {
  const paper = ITEMS.find(i => i.key === KEYS.paper);
  const pdf = ITEMS.find(i => i.parentID === paper.id && i.attachmentContentType === 'application/pdf');
  const authors = paper.creators.map(c => c.lastName + c.firstName).join('、');
  const year = paper.fields.date.slice(0, 4);
  const rows = [
    {id: 'pdf', icon: <FileGlyph />, name: pdf.fields.title, type: null},
    {id: 'md', icon: <img className="fl-ico" src={ICONS + 'attachment-markdown.svg'} alt="" width="40" height="40" />, name: FILENAMES[KEYS.note], type: ftlString('document-link-kind-markdown')},
    {id: 'canvas', icon: <img className="fl-ico" src={ICONS + 'attachment-canvas.svg'} alt="" width="40" height="40" />, name: FILENAMES[KEYS.canvas], type: ftlString('document-link-kind-canvas')},
  ];
  return <div className="fl-stage">
    <Caption id="files" variant="card" />
    <div className="fl-list">
      <div className="fl-row fl-paper" data-row="paper">
        <svg className="fl-chev" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="#9aa1a0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="fl-title" lang="zh-CN">{paper.fields.title}</span>
        <span className="fl-meta"><span lang="zh-CN">{authors}</span><span className="en" lang="en"> · {year}</span></span>
      </div>
      {rows.map(r => <div key={r.id} className={'fl-row fl-child fl-' + r.id} data-row={r.id}>
        <i className="fl-card" />
        <span className="fl-icon-slot">{r.icon}</span>
        <FileName name={r.name} />
        {r.type && <span className="fl-type"><Mixed text={r.type} /></span>}
      </div>)}
      <div className="fl-mark"><span className="recon-mark">示意</span></div>
    </div>
  </div>;
}

/** plan.json end.platformLine verbatim; each Latin run (version, "Zotero 9 / 10 / 11") in one Inter span,
 *  the Chinese and the separators around it in Film Sans SC. */
const LATIN_RUN = /([A-Za-z0-9](?:[A-Za-z0-9.\/ ]*[A-Za-z0-9])?)/;
function Platform({text}) {
  return <>{String(text).split(LATIN_RUN).map((p, i) => (i % 2
    ? <span key={i} className="en" lang="en">{p}</span>
    : p ? <span key={i} lang="zh-CN">{p}</span> : null))}</>;
}

/** #13: the same PNG at the same place as #1, the Chinese tagline and the platform line. */
export function EndView() {
  return <div className="ed-stage">
    <div className="ed-push">
      <img className="ed-logo" src={LOGO.src} alt="" width={LOGO.w} height={LOGO.h} style={{left: LOGO.x, top: LOGO.y}} />
      <p className="ed-tag" lang="zh-CN">{shot('end').description}</p>
      <p className="ed-platform"><Platform text={shot('end').platformLine} /></p>
    </div>
  </div>;
}
