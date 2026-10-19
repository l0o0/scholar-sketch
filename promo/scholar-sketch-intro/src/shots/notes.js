// Chapter 2 "Markdown 笔记" (#8 write, #9 links, #10 backlinks, and the note page in #11 dark).
// The note layer is a persistent full-frame layer (product window + chapter header); the three shots only
// add their band captions. Merge: layers (note layer first, board layer second), views, builders, layerBuilders.
import {NoteLayerView, buildNoteLayer} from '../notes/note-layer.jsx';
import {captionView, captionBuilder} from '../notes/captions.jsx';

const SHOTS = ['write', 'links', 'backlinks'];
export const layers = [{id: 'note', View: NoteLayerView}];
export const views = Object.fromEntries(SHOTS.map(id => [id, captionView(id)]));
export const builders = Object.fromEntries(SHOTS.map(id => [id, captionBuilder(id)]));
export const layerBuilders = [tl => buildNoteLayer(tl)];
export default {layers, views, builders, layerBuilders};
