// The film's one demo library (invented research project "城市公园冷岛"; no real user data, invented
// authors, titles, journals and numbers). Shapes follow packages/fake-zotero (FakeItemData) and
// src/dev/markdown-demo.ts. Both product surfaces read it: the whiteboard through the production
// source gateway, the Markdown editor through the production link search / backlink index.

const author = (lastName, firstName) => ({lastName, firstName, creatorType: 'author'});

/** Zotero keys used across shots. PARKCOOL is the paper that travels through the whole film. */
export const KEYS = {
  paper: 'PARKCOOL', pdf: 'PARKPDF1', greenway: 'GREENWAY', water: 'WATERWOD',
  annThreshold: 'ANNOT001', annWater: 'ANNOT002', annSmall: 'ANNOT003', readingNote: 'PARKNOTE',
  note: 'MDNOTE01', greenwayNote: 'MDNOTE02', planNote: 'MDNOTE03', canvas: 'CANVAS01',
};

export const ITEMS = [
  {id: 1, key: KEYS.paper, itemType: 'journalArticle',
    fields: {title: '城市公园冷岛效应的尺度阈值', date: '2024-03-18', publicationTitle: '城市环境研究', creators: '林晓、周宁'},
    creators: [author('林', '晓'), author('周', '宁')], tags: [{tag: '城市绿地'}, {tag: '热岛'}]},
  {id: 2, key: KEYS.pdf, itemType: 'attachment', parentID: 1, attachmentContentType: 'application/pdf',
    fields: {title: '城市公园冷岛效应的尺度阈值.pdf'}},
  {id: 3, key: KEYS.annThreshold, itemType: 'annotation', parentID: 2, annotationType: 'highlight',
    annotationText: '公园面积超过 2 公顷后，降温距离不再明显增加。', annotationComment: '阈值效应：小公园怎么办？',
    annotationColor: '#ffd400', annotationPageLabel: '5', annotationPosition: '{"pageIndex":4}', annotationSortIndex: '00004|000120|00001'},
  {id: 4, key: KEYS.annWater, itemType: 'annotation', parentID: 2, annotationType: 'highlight',
    annotationText: '水体加林地降温最强，平均低 1.8\u00a0°C。',   // no-break space: number and unit never split
    annotationColor: '#5fb236', annotationPageLabel: '7', annotationPosition: '{"pageIndex":6}', annotationSortIndex: '00006|000340|00001'},
  {id: 5, key: KEYS.annSmall, itemType: 'annotation', parentID: 2, annotationType: 'highlight',
    annotationText: '小于 0.5 公顷的绿地，降温范围只有几十米。',
    annotationColor: '#ffd400', annotationPageLabel: '9', annotationPosition: '{"pageIndex":8}', annotationSortIndex: '00008|000210|00001'},
  {id: 6, key: KEYS.readingNote, itemType: 'note', parentID: 1,
    note: '<p>读书笔记</p><p>冷岛约为公园半径的 1.5 倍；</p><p>水体能再加强降温。</p>'},
  {id: 7, key: KEYS.greenway, itemType: 'journalArticle',
    fields: {title: '街区绿道网络与夏季地表温度', date: '2025-06-02', publicationTitle: '景观与规划', creators: '陈思远'},
    creators: [author('陈', '思远')], tags: [{tag: '绿道'}, {tag: '连通性'}]},
  {id: 8, key: KEYS.water, itemType: 'journalArticle',
    fields: {title: '水体与林地组合的降温效应', date: '2023-09-12', publicationTitle: '生态城市', creators: '沈一帆'},
    creators: [author('沈', '一帆')], tags: [{tag: '水体'}]},
  {id: 10, key: KEYS.note, parentID: 1, itemType: 'attachment', attachmentContentType: 'text/markdown', fields: {title: '公园尺度阅读笔记'}},
  {id: 11, key: KEYS.greenwayNote, parentID: 7, itemType: 'attachment', attachmentContentType: 'text/markdown', fields: {title: '绿道网络阅读笔记'}},
  {id: 12, key: KEYS.planNote, itemType: 'attachment', attachmentContentType: 'text/markdown', fields: {title: '研究计划 · 第三章'}},
  {id: 13, key: KEYS.canvas, parentID: 1, itemType: 'attachment', attachmentContentType: 'application/json', fields: {title: '公园尺度研究'}},
];

/** Attachment file names (the plugin stores notes as .md and boards as JSON Canvas .canvas). */
export const FILENAMES = {
  [KEYS.note]: '公园尺度阅读笔记.md',
  [KEYS.greenwayNote]: '绿道网络阅读笔记.md',
  [KEYS.planNote]: '研究计划-第三章.md',
  [KEYS.canvas]: '公园尺度研究.canvas',
};

/** The note open in the editor (chapter 2). No frontmatter or footnotes: live preview shows those as
 *  source text, which is real behaviour but not what this film is about.
 *  Layout notes (measured at the 1.6 window): paragraph 1 stays on ONE line both with the typed
 *  “原文见 [[公园” (#9) and with the inserted paper link; “## 关键结论” has no blank line under it so that at
 *  scroll 0 the window's bottom edge falls in the blank line under “下一步” instead of cutting the heading;
 *  “## 相关文献” below the task list gives the editor room to scroll “下一步” up to mid-window in #8. */
export const NOTE_TEXT = `# 公园尺度阅读笔记

本周精读这篇论文，对照 [[绿道网络阅读笔记]]。

## 关键结论
公园面积超过 2 公顷后，降温距离不再明显增加。降温强度记为 $\\Delta T = T_{\\text{城区}} - T_{\\text{公园}}$。

| 公园面积 | 降温距离 | 平均降温 |
| --- | --- | --- |
| 小于 0.5 公顷 | 约 50 米 | 0.6 °C |
| 2 公顷以上 | 约 300 米 | 1.8 °C |

## 下一步

- [x] 把引文放进研究白板

## 相关文献

- 水体与林地组合的降温效应
`;

/** Other notes that link back to the open note (the "引用此笔记" panel lists them). */
export const OTHER_NOTES = {
  [KEYS.greenwayNote]: `# 绿道网络阅读笔记

连通的小绿地能把降温延续下去，正好补上 [[公园尺度阅读笔记]] 里的阈值结论。
`,
  [KEYS.planNote]: `# 研究计划 · 第三章

第三章的样地选择沿用 [[公园尺度阅读笔记]] 的面积分组。
`,
};

/** Reader tabs open in the fake Zotero window (the "已打开" filter): the PDF and the open note. */
export const OPEN_TAB_ITEM_IDS = [2, 10];
/** Zotero's own localized item-type names (zh-CN Zotero UI wording). */
export const ITEM_TYPE_ZH = {journalArticle: '期刊文章', conferencePaper: '会议论文', book: '图书', note: '笔记', attachment: '附件'};
/** Zotero 7+ item-type icon file names (chrome://zotero/skin/item-type/16/<theme>/<name>.svg). */
export const ITEM_TYPE_ICON = {journalArticle: 'journal-article', conferencePaper: 'conference-paper', book: 'book', note: 'note', pdf: 'attachment-pdf', attachment: 'attachment-file'};
