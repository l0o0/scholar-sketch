// Entry of dist/md-editor.html — the film's copy of the editor iframe page
// (addon/content/editor/index.html). It runs the unmodified production bootstrap, plus a tiny
// film hook so the parent film page can reach the live EditorView synchronously (same origin).
import '@plugin/editor/bootstrap.ts';
import {EditorView} from '@codemirror/view';

window.__filmEditor = {
  view() {
    const dom = document.querySelector('#editor-root .cm-editor');
    return dom ? EditorView.findFromDOM(dom) : null;
  },
};

import {watchLinkIcons} from './link-icons.js';
watchLinkIcons(document.documentElement);
