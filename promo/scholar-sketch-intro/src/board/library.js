// Film-side "Zotero library" for the whiteboard shot. Mirrors packages/whiteboard/src/devHost.ts:
// the fake Zotero (packages/fake-zotero, aliased to its TS source) + the PRODUCTION source gateway
// (src/modules/whiteboard/source-gateway.ts). Cards get their source/snapshot from the same
// gateway the plugin uses, so titles/authors/years/annotation fields have the real shape.
// All names below are fictional demo data written for the film (no user data).
import {createFakeZotero} from '@zotero-plugin/fake-zotero';
import {createZoteroSourceGateway} from '@plugin/modules/whiteboard/source-gateway';

export const LIBRARY_ITEMS = [
  {id: 1, key: 'PARKCOOL', itemType: 'journalArticle',
    fields: {title: '城市公园冷岛效应的尺度阈值', date: '2024-03-18', publicationTitle: '城市环境研究', creators: '林晓、周宁'},
    creators: [{lastName: '林', firstName: '晓', creatorType: 'author'}, {lastName: '周', firstName: '宁', creatorType: 'author'}],
    tags: [{tag: '城市绿地'}, {tag: '热岛'}]},
  {id: 2, key: 'PARKPDF1', itemType: 'attachment', parentID: 1, attachmentContentType: 'application/pdf', fields: {title: '林晓_2024.pdf'}},
  {id: 3, key: 'ANNOT001', itemType: 'annotation', parentID: 2, annotationType: 'highlight',
    annotationText: '公园面积超过 2 公顷后，降温距离不再明显增加。',
    annotationComment: '阈值效应：小公园怎么办？',
    annotationColor: '#ffd400', annotationPageLabel: '5', annotationPosition: '{"pageIndex":4}', annotationSortIndex: '00004|000120|00001'},
  {id: 4, key: 'ANNOT002', itemType: 'annotation', parentID: 2, annotationType: 'highlight',
    annotationText: '水体与林地组合的降温最强，平均低 1.8 ℃。',
    annotationColor: '#5fb236', annotationPageLabel: '7', annotationPosition: '{"pageIndex":6}', annotationSortIndex: '00006|000340|00001'},
  {id: 5, key: 'GREENWAY', itemType: 'journalArticle',
    fields: {title: '街区绿道网络与夏季地表温度', date: '2025-06-02', publicationTitle: '景观与规划', creators: '陈思远'},
    creators: [{lastName: '陈', firstName: '思远', creatorType: 'author'}],
    tags: [{tag: '绿道'}, {tag: '连通性'}]},
  {id: 6, key: 'PARKNOTE', itemType: 'note', parentID: 1,
    note: '<p>读书笔记</p><p>冷岛范围约为公园半径的 1.5 倍；</p><p>水体能再加强降温。</p>'},
];

/** Install the fake library once, return the production gateway and WhiteboardApp callbacks. */
export function createFilmLibrary() {
  const fake = createFakeZotero({items: LIBRARY_ITEMS});
  fake.install();
  const gateway = createZoteroSourceGateway();
  const item = key => fake.Zotero.Items.getByLibraryAndKey(1, key);
  const acquire = key => gateway.acquireItem(item(key));
  let runtime = null;
  const callbacks = {
    onReady(api) { runtime = api; },
    onChange() {},
    onSave() { runtime?.setSaveState('saved'); },
    onPickAcademicSource() {},
    onDropAcademicSources() {},
    onOpenItem() {},
    onExportFile() {},
    async onResolveAcademicSources(_requestId, generation, _priority, sources) {
      const results = await Promise.all(sources.map(({nodeId, source}) => gateway.resolve(nodeId, generation, source)));
      runtime?.applySourceResolutionBatch(generation, results);
    },
    async onListLiteratureAnnotations(requestId, source) {
      const result = await gateway.listAnnotations(source);
      runtime?.applyAnnotationCandidates(requestId, source, result.candidates, result.failures);
    },
    async onRefreshZoteroNote(requestId, nodeId, source) {
      runtime?.applyNoteRefresh(requestId, nodeId, await gateway.refreshNote(source));
    },
    async onOpenAcademicSource(requestId, nodeId, source) {
      runtime?.acceptSourceAction(requestId, nodeId, 'open', source);
    },
  };
  return {fake, gateway, acquire, callbacks, get runtime() { return runtime; }};
}
