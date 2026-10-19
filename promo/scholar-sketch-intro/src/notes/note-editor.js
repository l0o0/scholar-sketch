// The REAL Markdown tab of chapter 2: outline sidebar (outline-sidebar.ts), the production editor iframe
// (src/editor/bootstrap.ts through createMarkdownEditor, src/md/editor-iframe.js) and the backlinks panel
// (backlinks.ts mountNoteBacklinks), all running on the film's one fake Zotero (src/library/zotero.js).
//
// One idempotent driver: wanted(t) is a pure function of film time; drive(t) compares it with the live
// product and acts only on differences, through real interactions (minimal-diff typing dispatched to the
// EditorView exactly like keyboard input, real clicks on the [[ popup's own buttons, the real theme pref).
// States that only a real interaction can produce (the inserted link) are recorded once in the builder by
// performing that interaction, then restored directly on random seeks.
import {frame} from '../engine.js';
import {currentItem} from '../md/zotero-host.js';
import {injectMarkdownStyles} from '@plugin/modules/markdown/styles.ts';
import {mountOutlineSidebar} from '@plugin/modules/markdown/outline-sidebar.ts';
import {mountNoteBacklinks} from '@plugin/modules/markdown/backlinks.ts';
import {mountIframeEditor} from '../md/editor-iframe.js';
import {NOTE_TEXT, OTHER_NOTES, ITEMS} from '../library/fixture.js';
import {zh} from '../md/zh.js';
import {T, TODO_TEXT, TODO_UNITS, LINK_UNITS, PAPER_TITLE, typedUnits} from './time.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, tries = 150) {
  for (let i = 0; i < tries && !cond(); i++) await sleep(4);
  await frame(); await frame();
  return cond();
}
/** Let editor <-> host postMessage round trips (outline, outlineActive, linkSearch, theme) land. */
async function settleMessages() { for (let i = 0; i < 3; i++) { await sleep(0); await frame(); } }

// Documents along the film (all derived from the shared NOTE_TEXT).
const PARA_END = NOTE_TEXT.indexOf('里的结论。') + '里的结论。'.length;   // end of paragraph 1
if (PARA_END < 5) throw new Error('note fixture: paragraph 1 anchor not found');
const WRITTEN = NOTE_TEXT + TODO_TEXT + '\n';                            // after #8: new task + Enter
const withQuery = q => WRITTEN.slice(0, PARA_END) + q + WRITTEN.slice(PARA_END);

/** Phases whose sidebar "active outline" entry is recorded once and restored on seeks. */
const PHASES = [['base', -Infinity], ['scrolled', T.scrollDown[1]], ['typing', T.writeType], ['written', T.writeEnter],
  ['unscrolled', T.scrollUp[1]], ['caret', T.linksCaret], ['query', T.linksType], ['chosen', T.linksInsert], ['off', T.caretOff], ['dark', T.darkSwitch]];
const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);   // power2.inOut
const span = (t, [a, b]) => ease((t - a) / (b - a));
/** Editor scroll as a fraction of the current document's maximum (a wheel scroll in the real editor). */
const scrollAt = t => (t < T.linksStart - 0.5 ? span(t, T.scrollDown) : 1 - span(t, T.scrollUp));
const phaseAt = t => PHASES.filter(([, at]) => t >= at).pop()[0];

export function createNoteEditor(root) {
  const q = sel => root.querySelector(sel);
  const REC = {chosen: null, offAnchor: null, active: {}, lists: {}, scroll: {}};
  let ed = null, outline = null, outlineItems = [], outlineSeq = 0, hovered = false;

  const popup = () => ed.doc().querySelector('.zmd-link-completion');
  const popupFilter = () => popup()?.querySelector('button[aria-pressed="true"]')?.dataset.linkFilter ?? null;
  const popupSettled = () => {
    const p = popup();
    return !!p && p.querySelector('.zmd-link-results')?.getAttribute('aria-busy') === 'false' && p.style.visibility === 'visible';
  };
  const popupRows = () => [...(popup()?.querySelectorAll('.zmd-link-results [role="option"]') || [])];
  const rowTexts = () => popupRows().map(b => [...b.querySelectorAll('span > span')].map(s => s.textContent).join(' · '));
  const activeOutline = () => q('.zotero-markdown-outline-item.is-active')?.textContent ?? null;
  const backlinkButtons = () => [...root.querySelectorAll('.zmd-backlinks > div > button')];

  function wantedCore(t) {
    const theme = t >= T.darkSwitch ? 'dark' : 'light';
    const focus = t >= T.focusFrom;
    if (t >= T.linksInsert && REC.chosen) {
      return {doc: REC.chosen.doc, anchor: t >= T.caretOff ? REC.offAnchor : REC.chosen.anchor, filter: null, theme, focus};
    }
    if (t >= T.linksCaret) {
      const text = typedUnits(LINK_UNITS, t, T.linksType);
      const filter = text.includes('[[') ? (t >= T.linksFilter ? 'regular' : 'all') : null;
      return {doc: withQuery(text), anchor: PARA_END + text.length, filter, theme, focus};
    }
    if (t >= T.writeEnter) return {doc: WRITTEN, anchor: WRITTEN.length, filter: null, theme, focus};
    const text = typedUnits(TODO_UNITS, t, T.writeType);
    return {doc: NOTE_TEXT + text, anchor: NOTE_TEXT.length + text.length, filter: null, theme, focus};
  }
  const wanted = t => ({...wantedCore(t), scroll: scrollAt(t), active: REC.active[phaseAt(t)], hover: t >= T.backHover && t < T.darkMove[0]});

  /** Doc + caret as one minimal-diff transaction (the same path typed input takes; idempotent). */
  function setDoc(v, text, anchor) {
    const cur = v.state.doc.toString();
    if (cur !== text) {
      let a = 0; while (a < cur.length && a < text.length && cur[a] === text[a]) a++;
      let b = 0; while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++;
      v.dispatch({changes: {from: a, to: cur.length - b, insert: text.slice(a, text.length - b)}, selection: {anchor}, userEvent: 'input.type'});
      return 'doc';
    }
    const sel = v.state.selection.main;
    if (sel.anchor !== anchor || sel.head !== anchor) { v.dispatch({selection: {anchor}, userEvent: 'select'}); return 'selection'; }
    return false;
  }

  /** Idempotent: compare the live product with wanted(t); act only on differences. */
  async function drive(t) {
    const w = wanted(t);
    if (ed.setTheme(w.theme)) await settleMessages();
    const v = ed.view(); if (!v) return;
    if (w.focus && !v.hasFocus) { v.focus(); await waitFor(() => v.dom.classList.contains('cm-focused'), 30); }
    const seq0 = outlineSeq;
    // after an edit the product re-publishes the outline ~100 ms later (bootstrap.ts scheduleOutlineUpdate):
    // wait for it so the sidebar never depends on wall-clock timing
    const changed = setDoc(v, w.doc, w.anchor);
    // scroll right after the edit, before the product's outline timer reads it
    const sd = v.scrollDOM, top = Math.round(w.scroll * Math.max(0, sd.scrollHeight - sd.clientHeight));
    const scrolled = Math.abs(sd.scrollTop - top) > 0.5;
    if (scrolled) sd.scrollTop = top;
    if (changed === 'doc') { await frame(); await waitFor(() => outlineSeq > seq0, 120); }
    else if (changed || scrolled) await settleMessages();
    if (w.filter) {
      // the popup is closed by any window blur (link-completion.ts onWindowBlur): re-request it the way a
      // caret move does (requestLinkSearch runs on every selectionSet)
      if (!popup()) { v.dispatch({selection: {anchor: w.anchor}, userEvent: 'select'}); }
      if (!(await waitFor(popupSettled))) console.error('[notes] [[ popup did not settle at', t);
      if (popupFilter() !== w.filter) {
        popup().querySelector(`button[data-link-filter="${w.filter}"]`).click();   // real click, real filter
        await waitFor(() => popupSettled() && popupFilter() === w.filter);
      }
    }
    // backlink entry: pointer rests on it (a click would open the citing note in a new tab and leave this one)
    const first = backlinkButtons()[0];
    if (first && w.hover !== hovered) {
      for (const type of w.hover ? ['pointerover', 'pointerenter', 'mouseover', 'pointermove'] : ['pointerout', 'pointerleave', 'mouseout'])
        first.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, {bubbles: !/enter|leave/.test(type)}));
      hovered = w.hover;
    }
    // Sidebar "active" entry is UI state fed by async messages: restore the value recorded for this phase.
    if (w.active !== undefined && activeOutline() !== w.active) {
      await settleMessages();
      if (activeOutline() !== w.active) outline.setActive(outlineItems.find(it => it.text === w.active)?.id ?? null);
    }
    await frame(); await frame();
  }

  /** Native tab px (the .note-product box before any scaling) of the iframe's top-left corner, and the scale. */
  function frameOffset() {
    const tab = q('.zotero-markdown-tab-content'), prod = tab.getBoundingClientRect();
    const s = prod.width / tab.offsetWidth, f = ed.iframe.getBoundingClientRect();
    return {x: (f.left - prod.left) / s, y: (f.top - prod.top) / s, s, prod};
  }
  /** Rect of an element inside the product, in native tab px. Elements inside the editor iframe are laid
   *  out in the iframe's own (unscaled) viewport, so only the iframe's offset is added. */
  function nativeRect(el) {
    const o = frameOffset(), r = el.getBoundingClientRect();
    if (el.ownerDocument !== document) return {x: o.x + r.left, y: o.y + r.top, w: r.width, h: r.height};
    return {x: (r.left - o.prod.left) / o.s, y: (r.top - o.prod.top) / o.s, w: r.width / o.s, h: r.height / o.s};
  }
  /** CodeMirror document position → native tab px. */
  function nativePos(pos) {
    const o = frameOffset(), c = ed.view().coordsAtPos(pos);
    return {x: o.x + c.left, y: o.y + c.top, h: c.bottom - c.top};
  }

  async function mount() {
    injectMarkdownStyles(window);   // product CSS (tokens, outline, backlinks, editor wrap)
    outline = mountOutlineSidebar({
      root: q('.zotero-markdown-root'), sidebar: q('.zotero-markdown-outline-sidebar'), list: q('.zotero-markdown-outline-list'),
      toolbarToggle: q('.md-outline-toggle'), emptyLabel: zh('markdown-outline-empty'),
      getExpanded: () => true, onExpandedChange() {},
      // same as navigateToOutlineItem() in tab.ts (not clicked in this film)
      onNavigate: item => { outline.setActive(item.id); ed.handle.revealPosition(item.from); },
    });
    mountNoteBacklinks(q('.zotero-markdown-backlinks-sidebar'), currentItem(), window, {
      fullHeight: true,
      // tab.ts handles only links to the open note itself; others open a new tab (never clicked here)
      onNavigateNote: note => note.key === currentItem().key,
      labels: {title: zh('note-backlinks-title'), refresh: zh('note-backlinks-refresh'), loading: zh('note-backlinks-loading'), empty: zh('note-backlinks-empty'), incomplete: zh('note-backlinks-incomplete'), failed: zh('note-backlinks-failed')},
    });
    ed = mountIframeEditor(q('.zotero-markdown-editor-host'), {
      channel: 'film-note', doc: NOTE_TEXT,
      onOutline: (items, activeID) => { outlineSeq++; outlineItems = items; outline.update(items, activeID); },
      onOutlineActive: activeID => { outlineSeq++; outline.setActive(activeID); },
    });
    await ed.ready();
    // The editor iframe is its own document: its CJK web fonts (unicode-range subsets) load lazily, so a glyph
    // typed mid-film could paint one frame in a fallback face. Load every glyph it can show before frame 0
    // (same idea as src/stage/glyphs.js for the film page).
    const chars = [...new Set(NOTE_TEXT + TODO_TEXT + LINK_UNITS.map(([, s]) => s).join('') + Object.values(OTHER_NOTES).join('') + JSON.stringify(ITEMS))]
      .filter(c => c.codePointAt(0) > 0x2e7f).join('');
    await Promise.all([400, 700].map(w => ed.doc().fonts.load(`${w} 16px "PingFang SC"`, chars).catch(() => [])));
    if (!(await waitFor(() => !!activeOutline() && /\(\d+\)/.test(q('.zmd-backlinks-count')?.textContent || ''), 400)))
      console.error('[notes] outline/backlinks never loaded');
  }

  /** Perform the real interactions once, in order, and record what later seeks restore. */
  async function record() {
    // [[ results under each filter (reported in the build notes)
    await drive(T.linksFilter - 0.01);
    REC.lists.all = rowTexts();
    REC.measure = {popupAll: popup() && nativeRect(popup()), regularBtn: nativeRect(popup().querySelector('button[data-link-filter="regular"]')),
      paraTop: nativePos(NOTE_TEXT.indexOf('本周精读')), caret: nativePos(ed.view().state.selection.main.head),
      backlink: nativeRect(backlinkButtons()[0]), backlinks: backlinkButtons().map(b => b.textContent)};
    await drive(T.linksInsert - 0.01);
    REC.lists.regular = rowTexts();
    const row = popupRows().find(b => b.textContent.includes(PAPER_TITLE) && !b.textContent.includes('.pdf'));
    if (!row) throw new Error('[notes] paper not offered under 常规条目: ' + JSON.stringify(REC.lists.regular));
    REC.measure.paperRow = nativeRect(row);
    REC.measure.popupRegular = nativeRect(popup());
    row.dispatchEvent(new PointerEvent('pointermove', {bubbles: true}));   // pointer over the row (product highlights it)
    row.click();                                                          // real completion
    await frame(); await settleMessages();
    const v = ed.view();
    REC.chosen = {doc: v.state.doc.toString(), anchor: v.state.selection.main.head};
    REC.offAnchor = REC.chosen.doc.indexOf('\n', REC.chosen.anchor) + 1;   // start of the next (blank) line
    if (popup()) console.error('[notes] popup still open after choosing');
    // forward pass: the sidebar's active outline entry for every phase
    for (const [name, at] of PHASES) { await drive(Math.max(at, T.layerOn) + 0.01); await settleMessages(); REC.active[name] = activeOutline(); }
    await drive(T.layerOn);
  }

  return {
    mount, record, drive, wanted, nativeRect, nativePos, REC,
    get ed() { return ed; }, popup, backlinkButtons, rowTexts,
  };
}
