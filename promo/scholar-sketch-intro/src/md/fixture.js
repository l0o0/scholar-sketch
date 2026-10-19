// Invented demo library for the Markdown shots (no real user data, invented authors/titles).
// Shapes follow packages/fake-zotero (FakeItemData) and src/dev/markdown-demo.ts in the product.

export const NOTE_KEY = 'MDNOTE01';

/** The note open in the editor. Contains frontmatter, headings, a paper link, a wiki link,
 *  a table, an inline formula and a footnote. */
export const NOTE_TEXT = `---
title: 长文本检索阅读笔记
tags: [阅读笔记, 检索]
---
# 长文本检索阅读笔记

本周精读 [稀疏注意力与长文本检索](zotero://select/library/items/PAPER001)，并对照 [[检索增强综述--MDNOTE02|检索增强综述]] 里的结论。

## 关键结论

上下文从 4k 扩到 32k 后，召回率提升约 8.6 个百分点[^1]，注意力开销约为 $O(n \\log n)$。

| 方法 | 召回率 | 显存占用 |
| --- | --- | --- |
| 稠密注意力 | 71.2% | 高 |
| 稀疏注意力 | 79.8% | 中 |

## 下一步

- [ ] 复现第 4 节的消融实验
- [x] 把结论放进研究白板

[^1]: 见原文表 3，测试集为 LongQA-zh。
`;

/** Where the film types the "[[" query: end of the first paragraph (visible without scrolling). */
export const TYPE_ANCHOR = '里的结论。';
export const TYPED_QUERY = '另见 [[稀疏';

export const OTHER_NOTES = {
  MDNOTE02: `# 检索增强综述

## 评测

长上下文的对照实验见 [[长文本检索阅读笔记--MDNOTE01|长文本检索阅读笔记]]。
`,
  MDNOTE03: `# 稀疏注意力实验记录

第 4 节消融实验的参数沿用 [[长文本检索阅读笔记--MDNOTE01#关键结论|关键结论]]。
`,
};

export const FILENAMES = {
  MDNOTE01: '长文本检索阅读笔记.md',
  MDNOTE02: '检索增强综述.md',
  MDNOTE03: '稀疏注意力实验记录.md',
  CANVAS01: '检索方法白板.canvas',
};

const author = (lastName, firstName) => ({lastName, firstName, creatorType: 'author'});
export const ITEMS = [
  {id: 1, key: 'PAPER001', itemType: 'journalArticle', fields: {title: '稀疏注意力与长文本检索', date: '2025'}, creators: [author('林', '知远')]},
  {id: 2, key: 'PAPER002', itemType: 'journalArticle', fields: {title: '检索增强生成的评测方法', date: '2024'}, creators: [author('周', '可')]},
  {id: 3, key: 'PAPER003', itemType: 'conferencePaper', fields: {title: '稀疏路由的效率边界', date: '2025'}, creators: [author('沈', '一帆')]},
  {id: 4, key: 'BOOK0001', itemType: 'book', fields: {title: '长文本建模实践', date: '2023'}, creators: [author('陈', '默')]},
  {id: 10, key: 'MDNOTE01', parentID: 1, itemType: 'attachment', attachmentContentType: 'text/markdown', fields: {title: '长文本检索阅读笔记'}},
  {id: 11, key: 'MDNOTE02', parentID: 2, itemType: 'attachment', attachmentContentType: 'text/markdown', fields: {title: '检索增强综述'}},
  {id: 12, key: 'MDNOTE03', parentID: 1, itemType: 'attachment', attachmentContentType: 'text/markdown', fields: {title: '稀疏注意力实验记录'}},
  {id: 13, key: 'PDF00001', parentID: 1, itemType: 'attachment', attachmentContentType: 'application/pdf', fields: {title: '稀疏注意力与长文本检索.pdf'}},
  {id: 14, key: 'NOTE0001', parentID: 1, itemType: 'note', note: '<p>稀疏注意力：方法要点</p><p>窗口 + 全局 token。</p>'},
  {id: 15, key: 'CANVAS01', parentID: 3, itemType: 'attachment', attachmentContentType: 'application/json', fields: {title: '稀疏路由白板'}},
];
/** Zotero reader tabs open in the fake main window (drives the "已打开" filter). */
export const OPEN_TAB_ITEM_IDS = [13, 10];

/** Zotero's own localized item-type names (zh-CN Zotero UI wording). */
export const ITEM_TYPE_ZH = {journalArticle: '期刊文章', conferencePaper: '会议论文', book: '图书', note: '笔记', attachment: '附件'};
/** Zotero 7+ item-type icon file names (chrome://zotero/skin/item-type/16/<theme>/<name>.svg). */
export const ITEM_TYPE_ICON = {journalArticle: 'journal-article', conferencePaper: 'conference-paper', book: 'book', note: 'note', pdf: 'attachment-pdf', attachment: 'attachment-file'};
