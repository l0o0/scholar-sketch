// The [[ popup renders host-validated chrome:// icons (isEditorLinkIcon): chrome://bamboo/content/icons/…
// (in repo: addon/content/icons, copied to public/addon-icons) and chrome://zotero/skin/item-type/16/…
// (Zotero's own icons, NOT in the repo). Map to film-served files; a Zotero icon that was not supplied in
// public/zotero-skin gets the product's own "no icon" state (link-completion.ts hides the <img>).
const SKIN = new Set(__ZOTERO_SKIN_FILES__);   // build-time list (integration.config.mjs define)
const ADDON = 'chrome://bamboo/content/icons/', ZOTERO = 'chrome://zotero/skin/';

function fix(img) {
  const src = img.getAttribute('src') || '';
  if (src.startsWith(ADDON)) img.setAttribute('src', 'addon-icons/' + src.slice(ADDON.length));
  else if (src.startsWith(ZOTERO)) {
    const rel = src.slice(ZOTERO.length);
    if (SKIN.has(rel)) img.setAttribute('src', 'zotero-skin/' + rel);
    else { img.removeAttribute('src'); img.style.visibility = 'hidden'; (window.__filmMissingIcons ||= new Set()).add(src); }
  }
}
/** Rewrite icons as soon as popup rows are inserted (MutationObserver runs before paint). */
export function watchLinkIcons(root) {
  new MutationObserver(records => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      for (const img of n.matches('img.zmd-link-icon') ? [n] : n.querySelectorAll('img.zmd-link-icon')) fix(img);
    }
  }).observe(root, {subtree: true, childList: true});
}
