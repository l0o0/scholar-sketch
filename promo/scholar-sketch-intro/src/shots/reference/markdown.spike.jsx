import React from 'react';
import {shot, onDrive, frame} from '../engine.js';
import {currentItem} from '../md/zotero-host.js';   // installs fake Zotero + addon/ztoolkit globals first
import {injectMarkdownStyles} from '/home/user/scholar-sketch/src/modules/markdown/styles.ts';
import {mountOutlineSidebar} from '/home/user/scholar-sketch/src/modules/markdown/outline-sidebar.ts';
import {mountNoteBacklinks} from '/home/user/scholar-sketch/src/modules/markdown/backlinks.ts';
import {mountIframeEditor} from '../md/editor-iframe.js';
import {mountInlineEditor} from '../md/editor-inline.js';
import {NOTE_TEXT, TYPE_ANCHOR, TYPED_QUERY} from '../md/fixture.js';
import {zh} from '../md/zh.js';
import {typed} from '../kit/interact.js';

// Native product size (CSS px of the Zotero tab content) and the on-screen scale.
// Editor body text = 15px (addon/prefs.js fontSize default) x 1.6 = 24px in the 1080p frame (rule: >= 22px).
export const MD_NATIVE = {w: 1100, h: 600};
export const MD_SCALE = 1.6;

// Shot-local timeline (seconds). One source of truth for drive() and the recorded states.
const T = {typeAt: 1.2, cps: 8, regularAt: 2.4, notesAt: 2.9, openAt: 3.4, allAt: 3.9, chooseAt: 4.2, navAt: 4.8, sourceAt: 5.5, liveAt: 6.1, darkAt: 6.5};
const insertAt = NOTE_TEXT.indexOf(TYPE_ANCHOR) + TYPE_ANCHOR.length;
const withInsert = s => NOTE_TEXT.slice(0, insertAt) + s + NOTE_TEXT.slice(insertAt);
const NAV_HEADING = '下一步';
const PHASES = [['base', 0], ['typing', T.typeAt], ['chosen', T.chooseAt], ['nav', T.navAt], ['source', T.sourceAt], ['live2', T.liveAt], ['dark', T.darkAt]];
const phaseAt = local => (PHASES.filter(([, at]) => local >= at).pop() ?? PHASES[0])[0];
let stylesInjected = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, tries = 150) {
  for (let i = 0; i < tries && !cond(); i++) await sleep(4);
  await frame(); await frame();
  return cond();
}
/** Let editor<->host postMessage round trips (outline, outlineActive, change) land. */
async function settleMessages() { for (let i = 0; i < 3; i++) { await sleep(0); await frame(); } }

/**
 * One Markdown shot = the Zotero Markdown tab skeleton (same classes as mountEditorUI in
 * src/modules/markdown/tab.ts) + real outline sidebar + real backlinks + the real editor,
 * mounted either through the production iframe bridge ('iframe', recommended) or inline ('inline').
 */
export function makeMarkdownShot(id, kind) {
  const q = sel => document.querySelector(`section[data-shot="${id}"] ${sel}`);
  const REC = {chosen: null, navScroll: null, sourceScroll: null, active: {}};
  let ed = null, outline = null, outlineItems = [], outlineSeq = 0;
  // Outline positions arrive ~100 ms after a doc change (scheduleOutlineUpdate timer in bootstrap.ts).
  // Before clicking an outline entry, wait until the sidebar holds positions for the current doc.
  const outlineFresh = () => {
    const v = ed.view();
    return !!v && outlineItems.length > 0 && outlineItems.every(it => /^#{1,6}\s/.test(v.state.doc.sliceString(it.from, it.from + 8)));
  };

  function View() {
    return <div className="md-frame">
      <div className="md-cam" style={{width: MD_NATIVE.w, height: MD_NATIVE.h}}>
        <div className="zotero-markdown-tab-content md-tab">
          <div className="zotero-markdown-root mode-live theme-light">
            <div className="zotero-markdown-body">
              <nav className="zotero-markdown-outline-sidebar" aria-label={zh('markdown-outline-title')}>
                <div className="zotero-markdown-sidebar-title">{zh('markdown-outline-title')}</div>
                <div className="zotero-markdown-outline-list" role="tree" />
              </nav>
              <div className="zotero-markdown-workspace">
                <div className="zotero-markdown-editor-host" />
                <div className="zotero-markdown-preview-host" />
              </div>
              <aside className="zotero-markdown-backlinks-sidebar" aria-label={zh('note-backlinks-title')} />
            </div>
            <button type="button" className="md-outline-toggle" hidden aria-expanded="true" />
          </div>
        </div>
      </div>
    </div>;
  }

  const popup = () => ed.doc().querySelector('.zmd-link-completion');
  const popupFilter = () => popup()?.querySelector('button[aria-pressed="true"]')?.dataset.linkFilter ?? null;
  const popupSettled = () => {
    const p = popup();
    return !!p && p.querySelector('.zmd-link-results')?.getAttribute('aria-busy') === 'false' && p.style.visibility === 'visible';
  };
  const activeOutline = () => q('.zotero-markdown-outline-item.is-active')?.textContent ?? null;

  function wanted(local) {
    return {...wantedCore(local), active: REC.active[phaseAt(local)]};
  }
  function wantedCore(local) {
    const theme = local >= T.darkAt ? 'dark' : 'light';
    const mode = local >= T.sourceAt && local < T.liveAt ? 'source' : 'live';
    if (local >= T.chooseAt && REC.chosen) {
      const nav = local >= T.navAt;
      const navPos = REC.chosen.doc.indexOf('## ' + NAV_HEADING);
      return {doc: REC.chosen.doc, anchor: nav ? navPos : REC.chosen.anchor, filter: null, mode, theme,
        // scroll: recorded value (null while recording -> perform the real outline click)
        scroll: !nav ? 0 : local >= T.sourceAt ? REC.sourceScroll : REC.navScroll, navClick: nav && local < T.sourceAt, nav};
    }
    const filter = local >= T.allAt ? 'all' : local >= T.openAt ? 'open' : local >= T.notesAt ? 'notes-attachments' : local >= T.regularAt ? 'regular' : 'all';
    const text = typed(TYPED_QUERY, local, T.typeAt, T.cps);
    if (!text) return {doc: NOTE_TEXT, anchor: NOTE_TEXT.length, filter: null, mode, theme, scroll: 0};
    return {doc: withInsert(text), anchor: insertAt + text.length, filter: text.includes('[[') ? filter : null, mode, theme, scroll: 0};
  }

  /** Doc + caret: minimal diff dispatched to the live EditorView (same path as typing; idempotent). */
  function setDoc(v, text, anchor) {
    const cur = v.state.doc.toString();
    if (cur !== text) {
      let a = 0; while (a < cur.length && a < text.length && cur[a] === text[a]) a++;
      let b = 0; while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++;
      v.dispatch({changes: {from: a, to: cur.length - b, insert: text.slice(a, text.length - b)}, selection: {anchor}, userEvent: 'input.type'});
      return true;
    }
    const sel = v.state.selection.main;
    if (sel.anchor !== anchor || sel.head !== anchor) { v.dispatch({selection: {anchor}}); return true; }
    return false;
  }

  /** Idempotent: compare the live product state with wanted(local); act only on differences. */
  async function drive(local) {
    const w = wanted(local);
    if (ed.setTheme(w.theme)) await settleMessages();
    if (ed.setMode(w.mode)) { await waitFor(() => ed.mode() === w.mode); await settleMessages(); }
    const v = ed.view(); if (!v) return;
    if (!v.hasFocus) { v.focus(); await waitFor(() => v.dom.classList.contains('cm-focused'), 30); }
    const seq0 = outlineSeq;
    // after an edit the product re-publishes the outline (and its active entry) ~100 ms later: wait for it,
    // otherwise the sidebar's active item depends on wall-clock timing
    if (setDoc(v, w.doc, w.anchor)) { await frame(); await waitFor(() => outlineSeq > seq0, 120); }
    if (w.filter) {
      await waitFor(popupSettled);
      if (popupFilter() !== w.filter) {
        popup().querySelector(`button[data-link-filter="${w.filter}"]`).click();   // real click, real filter
        await waitFor(() => popupSettled() && popupFilter() === w.filter);
      }
    }
    const needNav = w.navClick && v.scrollDOM.scrollTop === 0 && (w.scroll == null || w.scroll > 1);
    if (needNav || (w.scroll != null && Math.abs(v.scrollDOM.scrollTop - w.scroll) > 1)) {
      if (needNav) {
        await waitFor(outlineFresh, 100);
        [...document.querySelectorAll(`section[data-shot="${id}"] .zotero-markdown-outline-item`)].find(b => b.textContent === NAV_HEADING).click();   // real outline click
        await waitFor(() => v.scrollDOM.scrollTop > 0);
      } else v.scrollDOM.scrollTop = w.scroll;   // restore a recorded scroll state (backward/random seek)
      await settleMessages();
    }
    // Outline "active" entry is sidebar UI state fed by async messages and by the click itself
    // (tab.ts navigateToOutlineItem calls setActive). Restore the value recorded for this phase.
    if (w.active !== undefined && activeOutline() !== w.active) {
      await settleMessages();
      const item = outlineItems.find(it => it.text === w.active);
      if (activeOutline() !== w.active) outline.setActive(item ? item.id : null);
    }
    await frame(); await frame();
  }

  async function build(tl) {
    const s = shot(id);
    const section = document.querySelector(`section[data-shot="${id}"]`);
    if (!stylesInjected) { injectMarkdownStyles(window); stylesInjected = true; }   // product CSS
    outline = mountOutlineSidebar({
      root: q('.zotero-markdown-root'), sidebar: q('.zotero-markdown-outline-sidebar'), list: q('.zotero-markdown-outline-list'),
      toolbarToggle: q('.md-outline-toggle'), emptyLabel: zh('markdown-outline-empty'),
      getExpanded: () => true, onExpandedChange() {},
      // same as navigateToOutlineItem() in tab.ts: mark active, then reveal in the editor
      onNavigate: item => { outline.setActive(item.id); kind === 'iframe' ? ed.handle.revealPosition(item.from) : ed.sendSync('revealPosition', {position: item.from}); },
    });
    mountNoteBacklinks(q('.zotero-markdown-backlinks-sidebar'), currentItem(), window, {
      fullHeight: true, onNavigateNote: () => true,
      labels: {title: zh('note-backlinks-title'), refresh: zh('note-backlinks-refresh'), loading: zh('note-backlinks-loading'), empty: zh('note-backlinks-empty'), incomplete: zh('note-backlinks-incomplete'), failed: zh('note-backlinks-failed')},
    });
    const opts = {doc: NOTE_TEXT, onOutline: (items, activeID) => { outlineSeq++; outlineItems = items; outline.update(items, activeID); }, onOutlineActive: activeID => { outlineSeq++; outline.setActive(activeID); }};
    ed = kind === 'iframe'
      ? mountIframeEditor(q('.zotero-markdown-editor-host'), {channel: 'film-' + id, ...opts})
      : mountInlineEditor(q('.zotero-markdown-editor-host'), opts);
    await ed.ready();
    await waitFor(() => !!activeOutline() && /\d/.test(q('.zmd-backlinks-count')?.textContent || ''));

    // Record the states that later phases restore directly, by performing the REAL interactions once.
    await drive(T.chooseAt - 0.01);
    if (await waitFor(popupSettled)) {
      popup().querySelector('.zmd-link-results [role="option"]').click();   // real completion (first row)
      await frame();
      const v = ed.view();
      REC.chosen = {doc: v.state.doc.toString(), anchor: v.state.selection.main.head};
    } else console.error(`[${id}] link popup never settled; completion not recorded`);
    await drive(T.navAt); REC.navScroll = ed.view().scrollDOM.scrollTop;
    await drive(T.sourceAt); REC.sourceScroll = ed.view().scrollDOM.scrollTop;
    // forward pass once more to record the outline active entry of every phase
    for (const [name, at] of PHASES) { await drive(at + 0.01); await settleMessages(); REC.active[name] = activeOutline(); }
    await drive(0);
    window.__md = window.__md || {}; window.__md[id] = {ed, REC, wanted, drive};

    tl.set(section, {opacity: 1}, s.start);
    tl.fromTo(q('.md-cam'), {opacity: 0, y: 24}, {opacity: 1, y: 0, duration: 0.6, ease: 'power3.out'}, s.start);
    onDrive(id, local => drive(local));
  }
  return {View, build};
}

export const mdShot = makeMarkdownShot('md', 'iframe');
export const mdxShot = makeMarkdownShot('mdx', 'inline');
