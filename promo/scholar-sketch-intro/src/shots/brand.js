// Part "brand": the film's own cards and the dark-shot copy (DIRECTION.md #1, #2, #11 copy + desk, #12, #13).
// Merge into src/shots/index.js: views and builders by shot id; no persistent layers.
import {BrandView, EntryView, DarkView, FilesView, EndView} from '../brand/views.jsx';
import {buildBrand, buildEntry, buildDark, buildFiles, buildEnd} from '../brand/build.js';

export const layers = [];
export const views = {brand: BrandView, entry: EntryView, dark: DarkView, files: FilesView, end: EndView};
export const builders = {brand: buildBrand, entry: buildEntry, dark: buildDark, files: buildFiles, end: buildEnd};
export const layerBuilders = [];
export default {layers, views, builders, layerBuilders};
