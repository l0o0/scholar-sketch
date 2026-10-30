export const annotationDialogCSS = `
.ss-annotation-dialog {
  box-sizing: border-box; width: min(720px, 92vw); height: min(660px, 86vh);
  padding: 0; border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas);
  border-radius: 12px; background: Canvas; color: CanvasText;
  box-shadow: 0 20px 64px #0003; font: 13px/1.5 system-ui, sans-serif;
}
.ss-annotation-dialog[open] { display: flex; flex-direction: column; }
.ss-annotation-dialog::backdrop { background: #10182855; }
.ss-annotation-dialog * { box-sizing: border-box; }
.ss-annotation-dialog [hidden] { display: none !important; }
.ss-annotation-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px 6px; flex: 0 0 auto; }
.ss-annotation-dialog h2 { min-width: 0; margin: 0; font-size: 16px; font-weight: 600; }
.ss-annotation-header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; }
.ss-annotation-dialog button, .ss-annotation-dialog input, .ss-annotation-dialog select { font: inherit; color: inherit; }
/* Zotero's macOS button height cap and margins clip these padded HTML controls. */
.ss-annotation-dialog button { appearance: none; display: inline-flex; align-items: center; justify-content: center; height: auto; min-height: 0; max-height: none; margin: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; padding: 6px 10px; cursor: pointer; }
.ss-annotation-dialog button:hover { background: color-mix(in srgb, CanvasText 7%, Canvas); }
.ss-annotation-dialog button:disabled { opacity: .45; cursor: default; }
.ss-annotation-dialog :is(button, input, select):focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
.ss-annotation-dialog :is(.ss-annotation-close, .ss-annotation-help-trigger) { width: 28px; height: 28px; padding: 0; line-height: 1; }
.ss-annotation-dialog .ss-annotation-close { font-size: 24px; }
.ss-annotation-help { position: relative; display: flex; }
.ss-annotation-help-trigger > span { display: grid; place-items: center; width: 16px; height: 16px; border: 1px solid currentColor; border-radius: 50%; font-size: 12px; font-weight: 600; }
.ss-annotation-guidance { position: absolute; z-index: 4; top: 100%; inset-inline-end: 0; width: min(300px, calc(92vw - 60px)); margin: 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas); border-radius: 7px; background: Canvas; color: CanvasText; box-shadow: 0 4px 16px #0003; font-size: 12px; line-height: 1.6; }
.ss-annotation-filters { padding: 0 14px; flex: 0 0 auto; }
.ss-annotation-search { width: 100%; padding: 6px 10px; background: color-mix(in srgb, CanvasText 4%, Canvas); border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas); border-radius: 7px; }
.ss-annotation-filter-row { display: flex; align-items: center; gap: 6px; margin: 6px 0 4px; }
.ss-annotation-types { display: flex; flex: 0 1 auto; min-width: 0; overflow-x: auto; gap: 4px; }
.ss-annotation-types button { flex: 0 0 auto; min-height: 30px; padding: 4px 8px; white-space: nowrap; }
.ss-annotation-dialog button[aria-pressed="true"] { background: color-mix(in srgb, Highlight 12%, Canvas); border-color: color-mix(in srgb, Highlight 55%, Canvas); }
.ss-annotation-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.ss-annotation-tools:not(:empty) { margin-bottom: 4px; }
.ss-annotation-tag-filter { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.ss-annotation-tag-filter select { max-width: 180px; padding: 4px 8px; border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas); border-radius: 6px; background: Canvas; }
.ss-annotation-color-picker { position: relative; flex: 0 0 auto; padding-inline-start: 6px; border-inline-start: 1px solid color-mix(in srgb, CanvasText 18%, Canvas); }
.ss-annotation-dialog .ss-annotation-color-trigger { display: flex; align-items: center; justify-content: center; gap: 3px; width: 38px; height: 30px; padding: 0 4px; }
.ss-annotation-color-trigger svg { display: block; flex: 0 0 auto; width: 18px; height: 18px; }
.ss-annotation-color-trigger span { font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ss-annotation-color-trigger[aria-expanded="true"], .ss-annotation-color-trigger[data-filtered="true"] { background: color-mix(in srgb, CanvasText 7%, Canvas); }
.ss-annotation-colors { position: absolute; z-index: 3; top: calc(100% + 6px); inset-inline-end: 0; width: max-content; min-width: 112px; padding: 6px; border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas); border-radius: 9px; background: Canvas; box-shadow: 0 8px 24px #0003; }
.ss-annotation-colors button { font-size: 11px; }
.ss-annotation-dialog .ss-annotation-all-colors { justify-content: flex-start; width: 100%; min-height: 24px; padding: 0 6px; text-align: start; }
.ss-annotation-color-grid { display: grid; gap: 3px; margin-top: 4px; }
.ss-annotation-dialog .ss-annotation-color { position: relative; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; }
.ss-annotation-color > span { width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px #0002; }
.ss-annotation-color[aria-pressed="true"]::after { content: "✓"; position: absolute; inset-inline-end: 0; bottom: 0; width: 10px; height: 10px; border-radius: 50%; background: Canvas; color: CanvasText; font-size: 9px; line-height: 10px; }
.ss-annotation-result-count { flex: 0 0 auto; margin: 0; margin-inline-start: auto; text-align: end; white-space: nowrap; font-size: 12px; color: color-mix(in srgb, CanvasText 65%, Canvas); }
.ss-annotation-results { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 14px 8px; overscroll-behavior: contain; }
.ss-annotation-card { margin: 8px 0; border: 1px solid color-mix(in srgb, CanvasText 13%, Canvas); border-inline-start: 3px solid color-mix(in srgb, CanvasText 25%, Canvas); border-radius: 7px; background: Canvas; }
.ss-annotation-card:has(input:checked) { background: color-mix(in srgb, Highlight 4%, Canvas); }
.ss-annotation-card label { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; cursor: pointer; }
.ss-annotation-card input { flex: 0 0 auto; margin: 4px 0 0; accent-color: Highlight; }
.ss-annotation-content { display: flex; flex-direction: column; gap: 7px; min-width: 0; flex: 1; }
.ss-annotation-meta, .ss-annotation-tags { font-size: 11px; color: color-mix(in srgb, CanvasText 60%, Canvas); }
.ss-annotation-text, .ss-annotation-comment { white-space: pre-wrap; overflow-wrap: anywhere; font-weight: 400; }
.ss-annotation-comment { padding: 7px 10px; border-radius: 5px; background: color-mix(in srgb, CanvasText 5%, Canvas); font-size: 12px; }
.ss-annotation-card.is-collapsed :is(.ss-annotation-text, .ss-annotation-comment) { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.ss-annotation-dialog .ss-annotation-expand { margin: 0 0 6px 32px; font-size: 12px; padding: 2px 6px; }
.ss-annotation-empty { padding: 48px 24px; text-align: center; color: color-mix(in srgb, CanvasText 65%, Canvas); }
.ss-annotation-dialog footer { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 6px; align-items: center; border-top: 1px solid color-mix(in srgb, CanvasText 13%, Canvas); padding: 8px 14px; }
.ss-annotation-dialog footer button { min-height: 34px; white-space: nowrap; }
.ss-annotation-selected { margin-inline-end: auto; font-size: 12px; }
.ss-annotation-dialog .ss-annotation-primary { background: #2563eb; color: white; padding: 6px 12px; }
.ss-annotation-dialog .ss-annotation-primary:hover { background: #1d4ed8; }
.ss-annotation-error { flex: 0 0 auto; margin: 0; padding: 8px 20px; color: light-dark(#b42318, #ffb4ab); }
@media (max-width: 560px) {
  .ss-annotation-dialog footer { padding: 8px 12px; }
  .ss-annotation-selected { flex-basis: 100%; }
  .ss-annotation-dialog .ss-annotation-primary { margin-inline-start: auto; }
}
`;
