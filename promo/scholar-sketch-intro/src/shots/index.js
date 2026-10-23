// Registry. Every plan.json shot id → a view and a builder (shots without a view show a placeholder).
// LAYERS are persistent full-frame layers (product windows, chapter headers) that live across shots;
// each layer's builder controls its own visibility on the master timeline.
// Paint order: the note window sits under the board window (the first page turn lifts the board away).
// Builder order matters for drivers (they run in registration order every seek): the note driver runs
// after the board driver so the editor keeps focus while the note is on screen.
import brand from './brand.js';
import canvas from './canvas.js';
import notes from './notes.js';
import {buildTurns} from '../stage/turns.js';

const parts = [brand, canvas, notes];
export const LAYERS = [...notes.layers, ...canvas.layers];
export const SHOT_VIEWS = Object.assign({}, ...parts.map(p => p.views));
export const SHOT_BUILDERS = Object.assign({}, ...parts.map(p => p.builders));
export const LAYER_BUILDERS = [tl => buildTurns(tl), ...canvas.layerBuilders, ...notes.layerBuilders];
