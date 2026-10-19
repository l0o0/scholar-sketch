// Chapter 1 "研究白板" (shots drop, annotations, cards, painter, align + the board's role in #11 dark).
// Merge into src/shots/index.js: LAYERS (note layer first, board layer second), SHOT_VIEWS, SHOT_BUILDERS,
// LAYER_BUILDERS.
import {BoardLayerView} from '../canvas/board-layer.jsx';
import {buildBoardLayer} from '../canvas/board-build.js';
import {CAPTION_VIEWS, captionBuilder, checkCopy} from '../canvas/captions.jsx';

const SHOTS = ['drop', 'annotations', 'cards', 'painter', 'align'];
export const layers = [{id: 'board', View: BoardLayerView}];
export const views = CAPTION_VIEWS;
export const builders = Object.fromEntries(SHOTS.map(id => [id, captionBuilder(id)]));
// async: rehearses the real interactions once (measures cursor targets, solves the dot-match viewport)
export const layerBuilders = [tl => { checkCopy(); return buildBoardLayer(tl); }];
export default {layers, views, builders, layerBuilders};
