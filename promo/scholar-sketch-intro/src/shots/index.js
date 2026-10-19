// Registry. Every plan.json shot id → a view and a builder (shots without a view show a placeholder).
// LAYERS are persistent full-frame layers (product windows, chapter headers) that live across shots;
// each layer's builder controls its own visibility on the master timeline.
export const LAYERS = [];
export const SHOT_VIEWS = {};
export const SHOT_BUILDERS = {};
export const LAYER_BUILDERS = [];
