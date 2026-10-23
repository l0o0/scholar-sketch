// Film-side "Zotero library" for the whiteboard. Mirrors packages/whiteboard/src/devHost.ts: the film's
// shared fake Zotero (src/library/zotero.js) + the PRODUCTION source gateway
// (src/modules/whiteboard/source-gateway.ts). Cards get their source/snapshot from the same gateway the
// plugin uses, so titles/authors/years/annotation fields have the real shape.
import {fake, itemByKey} from '../library/zotero.js';
import {createZoteroSourceGateway} from '@plugin/modules/whiteboard/source-gateway';

/** WhiteboardApp callbacks wired to the production gateway (as the plugin's whiteboard tab does). */
export function createFilmLibrary() {
  const gateway = createZoteroSourceGateway();
  const acquire = key => gateway.acquireItem(itemByKey(key));
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
