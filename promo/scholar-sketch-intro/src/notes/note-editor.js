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
import {T, TODO_TEXT, TODO_UNITS, LINK_UNITS, PAPER_TITLE, typedUnits, past} from './time.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, tries = 150) {
  for (let i = 0; i < tries && !cond(); i++) await sleep(4);
  await frame(); await frame();
  return cond();
}
/** Let editor <-> host postMessage round trips (outline, outlineActive, linkSearch, theme) land. */
async function settleMessages() { for (let i = 0; i < 3; i++) { await sleep(0); await frame(); } }

// Documents along the film (all derived from the shared NOTE_TEXT).
const PARA_END = NOTE_TEXT.indexOf('\n', NOTE_TEXT.indexOf('本周精读'));   // end of paragraph 1
if (PARA_END < 5) throw new Error('note fixture: paragraph 1 anchor not found');
// #8 types the new task on the blank line right under the existing one (the note goes on below it)
const TASK_LINE = '- [x] 把引文放进研究白板\n';
const TODO_AT = NOTE_TEXT.indexOf(TASK_LINE) + TASK_LINE.length;
if (TODO_AT < TASK_LINE.length) throw new Error('note fixture: task list anchor not found');
const typedDoc = text => NOTE_TEXT.slice(0, TODO_AT) + text + NOTE_TEXT.slice(TODO_AT);

/** Phases whose sidebar "active outline" entry is recorded once and restored on seeks. */
const PHASES = [['base', -Infinity], ['scrolled', T.scrollDown[1]], ['typing', T.writeType], ['written', T.writeEnter],
  ['unscrolled', T.scrollUp[1]], ['caret', T.linksCaret], ['query', T.linksType], ['chosen', T.linksInsert], ['off', T.caretOff], ['dark', T.darkSwitch]];
const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);   // power2.inOut
const span = (t, [a, b]) => ease((t - a) / (b - a));
/** Editor scroll as a fraction of the #8 target scrollTop (a wheel scroll in the real editor). */
const scrollAt = t => (t < T.linksStart - 0.5 ? span(t, T.scrollDown) : 1 - span(t, T.scrollUp));
const phaseAt = t => PHASES.filter(([, at]) => past(t, at)).pop()[0];

export function createNoteEditor(root) {
  const q = sel => root.querySelector(sel);
  // entered: doc + caret after the real Enter (#8); chosen: after the real [[ completion (#9);
  // scroll.write: editor scrollTop (px) of the #8 wheel scroll, measured once on the real layout
  const REC = {entered: null, chosen: null, offAnchor: null, active: {}, lists: {}, scroll: {write: 0}};
  let ed = null, outline = null, outlineItems = [], outlineSeq = 0, activeSeq = 0;

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
    const theme = past(t, T.darkSwitch) ? 'dark' : 'light';   // same frame as the board (frame-snapped action time)
    const focus = past(t, T.focusFrom);
    if (past(t, T.linksInsert) && REC.chosen) {
      return {doc: REC.chosen.doc, anchor: past(t, T.caretOff) ? REC.offAnchor : REC.chosen.anchor, filter: null, theme, focus};
    }
    if (past(t, T.linksCaret) && REC.entered) {
      const text = typedUnits(LINK_UNITS, t, T.linksType), doc = REC.entered.doc;
      const filter = text.includes('[[') ? (past(t, T.linksFilter) ? 'regular' : 'all') : null;
      return {doc: doc.slice(0, PARA_END) + text + doc.slice(PARA_END), anchor: PARA_END + text.length, filter, theme, focus};
    }
    if (past(t, T.writeEnter) && REC.entered) return {doc: REC.entered.doc, anchor: REC.entered.anchor, filter: null, theme, focus};
    const text = typedUnits(TODO_UNITS, t, T.writeType);
    return {doc: typedDoc(text), anchor: TODO_AT + text.length, filter: null, theme, focus};
  }
  const wanted = t => ({...wantedCore(t), scroll: Math.round(REC.scroll.write * scrollAt(t)), active: REC.active[phaseAt(t)]});

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
    const seq0 = outlineSeq, act0 = activeSeq;
    // after an edit the product re-publishes the outline ~100 ms later (bootstrap.ts scheduleOutlineUpdate):
    // wait for it so the sidebar never depends on wall-clock timing
    const changed = setDoc(v, w.doc, w.anchor);
    // scroll after CodeMirror has measured the edit (its scroll anchoring would otherwise move a scrollTop set
    // in the same tick, e.g. pin it to the bottom) and before the product's outline timer reads it; absolute
    // px: the Enter in #8 grows the note below the window, it must not move what is on screen
    if (changed === 'doc') await frame();
    const sd = v.scrollDOM;
    let scrolled = false;
    for (let i = 0; i < 4; i++) {
      const top = Math.min(w.scroll, Math.max(0, sd.scrollHeight - sd.clientHeight));
      if (Math.abs(sd.scrollTop - top) <= 0.5) break;
      sd.scrollTop = top; scrolled = true; await frame();
    }
    if (changed === 'doc') await waitFor(() => outlineSeq > seq0, 120);
    if (changed || scrolled || activeSeq !== act0) await settleMessages();
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
    // #10 backlinks: the film pointer only points (in the panel's left margin, beside an entry); the product
    // has no hover state there and a click would open the citing note, so nothing is dispatched.
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
      onOutlineActive: activeID => { activeSeq++; outline.setActive(activeID); },
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
    // #8 scroll target: wheel down until the window's top edge sits in the blank line above the table
    // (~24 px above its top border), which brings 下一步 to mid-window; the bottom edge then falls between lines
    // both before and after the Enter (the note goes on below the task list). Kept 5 px short of the end:
    // CodeMirror pins a view scrolled within 4 px of the bottom to the bottom when the doc grows (the Enter
    // would then move the page), and the product's outline would mark the last heading (相关文献) active.
    {
      const v = ed.view(), sd = v.scrollDOM, table = ed.doc().querySelector('.cm-line.zmd-lp-table-header');
      if (!table) throw new Error('[notes] table not rendered');
      const top = table.getBoundingClientRect().top - sd.getBoundingClientRect().top + sd.scrollTop;
      REC.scroll.write = Math.floor(Math.min(top - 24, sd.scrollHeight - sd.clientHeight - 5));
    }
    // #8 Enter: the real keymap (lang-markdown insertNewlineContinueMarkup continues the task list)
    await drive(T.writeEnter - 0.01);
    {
      const v = ed.view(), W = ed.iframe.contentWindow;
      v.contentDOM.dispatchEvent(new W.KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true}));
      await frame(); await settleMessages();
      REC.entered = {doc: v.state.doc.toString(), anchor: v.state.selection.main.head};
      const head = NOTE_TEXT.slice(0, TODO_AT) + TODO_TEXT, tail = NOTE_TEXT.slice(TODO_AT);
      if (!REC.entered.doc.startsWith(head) || !REC.entered.doc.endsWith(tail) || REC.entered.anchor <= head.length)
        throw new Error('[notes] unexpected Enter result: ' + JSON.stringify(REC.entered.doc.slice(head.length - 8, head.length + 16)));
    }
    // [[ results under each filter (reported in the build notes)
    await drive(T.linksFilter - 0.01);
    REC.lists.all = rowTexts();
    REC.measure = {popupAll: popup() && nativeRect(popup()), regularBtn: nativeRect(popup().querySelector('button[data-link-filter="regular"]')),
      paraTop: nativePos(NOTE_TEXT.indexOf('本周精读')), caret: nativePos(ed.view().state.selection.main.head),
      backlink: nativeRect(backlinkButtons()[0]), backlinks: backlinkButtons().map(b => b.textContent),
      backTitles: backlinkButtons().map(b => nativeRect(b.querySelector('strong'))),
      h1Text: (() => { const l = ed.doc().querySelector('.cm-line.zmd-lp-h1'), rg = ed.doc().createRange(); rg.selectNodeContents(l);
        const r = rg.getBoundingClientRect(), o = frameOffset(); return {x: o.x + r.left, y: o.y + r.top, w: r.width, h: r.height}; })(),
      aside: nativeRect(q('.zotero-markdown-backlinks-sidebar')), workspace: nativeRect(q('.zotero-markdown-workspace'))};
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
    // (the product publishes it asynchronously: 100 ms outline timer after an edit, rAF after a scroll; wait
    // for both so the value recorded belongs to this phase and not to the previous one)
    for (const [name, at] of PHASES) {
      await drive(Math.max(at, T.layerOn) + 0.01);
      await sleep(180); await settleMessages();
      REC.active[name] = activeOutline();
    }
    await drive(T.layerOn);
  }

  return {
    mount, record, drive, wanted, nativeRect, nativePos, REC,
    get ed() { return ed; }, popup, backlinkButtons, rowTexts,
  };
}
