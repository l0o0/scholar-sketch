// Recommended mount: the production parent bridge createMarkdownEditor() (src/modules/markdown/editor.ts)
// creates the real <iframe class="zmd-codemirror-iframe"> pointing at the film-built copy of the editor
// page (dist/md-editor.html = addon/content/editor/index.html + production bootstrap).
// Everything inside the iframe uses its own viewport (popup position:fixed, innerWidth clamps), exactly
// as in Zotero, so camera transforms on the outer film layers never break product positioning.
import {createMarkdownEditor, applyMarkdownEditorPreferences} from '@plugin/modules/markdown/editor.ts';
import {EDITOR_MESSAGE_SOURCE, EDITOR_PROTOCOL_VERSION} from '@plugin/modules/markdown/editor-protocol.ts';
import {DEFAULT_TABLE_LABELS} from '@plugin/editor/table-labels.ts';
import {fake, linkSearch} from './zotero-host.js';
import {zh} from './zh.js';
import {frame} from '../engine.js';

export function mountIframeEditor(host, {channel, doc, onOutline, onOutlineActive}) {
  const handle = createMarkdownEditor(host, {
    pageURL: new URL('md-editor.html', location.href).href,
    channel, doc, win: window,
    onOutline, onOutlineActive,
    onLinkSearch: (query, filter) => linkSearch(query, filter, frameView()?.state.doc.toString()),
    onResolveAsset: async () => ({error: 'no images in this fixture'}),
  });
  const iframe = host.querySelector('iframe.zmd-codemirror-iframe');
  const win = () => iframe.contentWindow;
  const frameView = () => win()?.__filmEditor?.view() ?? null;
  /** Parent -> iframe, delivered synchronously (source = this window = iframe's window.parent). */
  const sendSync = (type, payload) => {
    const W = win();
    const data = {source: EDITOR_MESSAGE_SOURCE, channel, v: EDITOR_PROTOCOL_VERSION, type, ...(payload !== undefined ? {payload} : {})};
    W.dispatchEvent(new W.MessageEvent('message', {data, source: window}));
  };
  /** Same payload the bridge sends on "ready" (editor.ts), used to re-create the view in place. */
  const initPayload = (mode, value) => ({
    doc: value, readOnly: false, fontSize: Number(fake.Zotero.Prefs.get('extensions.zotero.bamboo.fontSize', true) || 15),
    appearance: {fontFamily: 'system', backgroundColor: ''}, theme: currentTheme(), mode, surface: 'default',
    linkLabels: {all: zh('document-link-filter-all'), regular: zh('document-link-filter-regular'), notesAttachments: zh('document-link-filter-notes-attachments'), open: zh('document-link-filter-open'), empty: zh('document-link-filter-empty'), loading: zh('document-link-filter-loading')},
    tableLabels: Object.fromEntries(Object.keys(DEFAULT_TABLE_LABELS).map(k => [k, zh(`table-${k}`)])),
    imageLabels: {toolbar: zh('image-size-toolbar'), width: zh('image-size-width'), small: zh('image-size-small'), medium: zh('image-size-medium'), large: zh('image-size-large'), auto: zh('image-size-auto'), original: zh('image-view-original'), close: zh('image-view-close'), resize: zh('image-size-resize')},
  });
  const currentTheme = () => (fake.Zotero.Prefs.get('extensions.zotero.bamboo.theme', true) === 'dark' ? 'dark' : 'light');

  return {
    handle, iframe, view: frameView, doc: () => iframe.contentDocument, sendSync,
    async ready() {
      await handle.ready;
      for (let i = 0; i < 200 && !frameView(); i++) await new Promise(r => setTimeout(r, 10));
      await iframe.contentDocument.fonts.ready;
      await frame(); await frame();
    },
    mode: () => (frameView()?.dom.classList.contains('zmd-mode-source') ? 'source' : 'live'),
    /** Idempotent. Live->Source uses the real bridge (editor.setMode). Source->Live cannot: v0.2.9's
     *  livePreviewMathDecorations.update reads startState.field(liveStructure) and throws on that
     *  reconfigure, so the film re-creates the view with the bridge's own init payload instead. */
    setMode(mode) {
      if (this.mode() === mode) return false;
      if (mode === 'source') handle.setMode('source');
      else {
        const v = frameView();
        const {anchor, head} = v.state.selection.main;
        sendSync('init', {...initPayload('live', v.state.doc.toString()), viewState: {anchor, head, scrollTop: v.scrollDOM.scrollTop}});
        handle.setMode('live');   // keep the bridge's own currentMode in sync (no-op in the iframe now)
      }
      return true;
    },
    /** Real preference path: Zotero pref "theme" + applyMarkdownEditorPreferences() (as the prefs pane does). */
    setTheme(theme) {
      if (currentTheme() === theme && host.closest('.zotero-markdown-root')?.classList.contains('theme-' + theme)) return false;
      fake.Zotero.Prefs.set('extensions.zotero.bamboo.theme', theme, true);
      applyMarkdownEditorPreferences();
      return true;
    },
  };
}
