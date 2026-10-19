// The film's one Zotero host. Installs the product's own fake Zotero (packages/fake-zotero, aliased to its
// TS source) ONCE for the whole page and adds the item/file adapters of src/dev/markdown-demo.ts, so the
// REAL product modules run on top of it: the whiteboard's production source gateway
// (src/modules/whiteboard/source-gateway.ts) and the Markdown host's link search and backlink index
// (src/modules/markdown/document-links.ts, note-library.ts). Import this before any product module.
import {createFakeZotero} from '@zotero-plugin/fake-zotero';
import {zhOr} from '../md/zh.js';
import {ITEMS, FILENAMES, NOTE_TEXT, OTHER_NOTES, OPEN_TAB_ITEM_IDS, ITEM_TYPE_ZH, ITEM_TYPE_ICON, KEYS} from './fixture.js';

const ADDON_REF = 'bamboo';
// Globals the product modules expect from the plugin runtime (bootstrap.js / addon.ts).
// getString() resolves through addon.data.locale.current.formatMessagesSync -> real zh-CN ftl.
globalThis.addon = {
  data: {
    config: {addonRef: ADDON_REF, addonID: 'bamboo@@linxzh.com', addonInstance: 'ScholarSketch', prefsPrefix: 'extensions.zotero.bamboo'},
    locale: {current: {formatMessagesSync: ids => ids.map(({id}) => {
      const key = id.startsWith(ADDON_REF + '-') ? id.slice(ADDON_REF.length + 1) : id;
      const value = zhOr(key, null);
      return value == null ? undefined : {value, attributes: null};
    })}},
  },
};
globalThis.ztoolkit = {log() {}};

// theme "light" instead of the shipped default "system": the film decides when the system turns dark (#11).
export const fake = createFakeZotero({prefs: {'extensions.zotero.bamboo.fontSize': 15, 'extensions.zotero.bamboo.theme': 'light'}, items: ITEMS});
fake.install();
const Z = fake.Zotero;

const contents = {[KEYS.note]: NOTE_TEXT, ...OTHER_NOTES};
const pathFor = key => `/fixtures/${key}/${FILENAMES[key]}`;
const keyForPath = p => Object.keys(FILENAMES).find(k => pathFor(k) === p);
Object.assign(Z, {
  Attachments: {LINK_MODE_IMPORTED_FILE: 0, LINK_MODE_LINKED_FILE: 2, LINK_MODE_LINKED_URL: 3},
  File: {
    getContentsAsync: async p => contents[keyForPath(p)] ?? '',
    putContentsAsync: async () => {},   // the film never writes files
  },
  ItemTypes: {getLocalizedString: id => ITEM_TYPE_ZH[id] || String(id)},
  CreatorTypes: {getID: name => (name === 'author' ? 1 : 0)},
  hiDPISuffix: '',
});
// Main window: Zotero_Tabs for the "已打开" filter; matchMedia for icon theme.
const mainWindow = Z.getMainWindow();
Z.getMainWindow = () => Object.assign(mainWindow, {
  Zotero_Tabs: {getState: () => [{type: 'library'}, ...OPEN_TAB_ITEM_IDS.map(itemID => ({type: 'reader', data: {itemID}}))]},
  matchMedia: q => window.matchMedia(q),
});

/** chrome:// icon the real Zotero host would return (Item.getImageSrc, patched by attachment-icons.ts). */
function imageSrcFor(item) {
  if (item.itemType === 'attachment') {
    const name = FILENAMES[item.key] || '';
    if (name.endsWith('.md')) return `chrome://${ADDON_REF}/content/icons/attachment-markdown.svg`;
    if (name.endsWith('.canvas')) return `chrome://${ADDON_REF}/content/icons/attachment-canvas.svg`;
    return `chrome://zotero/skin/item-type/16/light/${item.attachmentContentType === 'application/pdf' ? ITEM_TYPE_ICON.pdf : ITEM_TYPE_ICON.attachment}.svg`;
  }
  return `chrome://zotero/skin/item-type/16/light/${ITEM_TYPE_ICON[item.itemType] || 'document'}.svg`;
}
// Same adapters for every item as src/dev/markdown-demo.ts (the link search reads them on regular items too).
for (const data of ITEMS) {
  const item = Z.Items.get(data.id);
  Object.assign(item, {
    attachmentFilename: FILENAMES[item.key] ?? (data.itemType === 'attachment' ? data.fields?.title : undefined),
    attachmentLinkMode: 0,
    itemTypeID: item.itemType,
    getFilePathAsync: async () => pathFor(item.key),
    isTrashed: () => false,
    isEditable: () => true,
    isPDFAttachment: () => item.attachmentContentType === 'application/pdf',
    getImageSrc: () => imageSrcFor(item),
    // distinct per icon, like Zotero's names (attachmentPDF, bamboo-attachment-markdown, …):
    // document-links.ts caches icons by this name
    getItemTypeIconName: () => imageSrcFor(item).split('/').pop().replace(/\.svg$/, ''),
  });
}

export const Zotero = Z;
export const itemByKey = key => Z.Items.getByLibraryAndKey(1, key);
