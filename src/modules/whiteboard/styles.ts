export function injectWhiteboardStyles(win: Window) {
  const doc = win.document;
  const id = `${addon.data.config.addonRef}-whiteboard-styles`;
  doc.getElementById(id)?.remove();

  const style = doc.createElement("style");
  style.id = id;
  style.textContent = `
.zotero-whiteboard-tab-content {
  /* Contain the absolute positioning inherited from the Markdown theme root. */
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.zotero-whiteboard-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  background: var(--zmd-bg, #fbfbfc);
  color: var(--zmd-text, #111827);
  font-family: var(--zmd-font-ui, system-ui, sans-serif);
}
.zotero-whiteboard-toolbar {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 4px 30px 4px 34px;
  border-bottom: 1px solid var(--zmd-border, #e5e7eb);
  box-sizing: border-box;
}
.zotero-whiteboard-title {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  color: var(--zmd-text-muted, #6b7280);
}
.zotero-whiteboard-actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
  margin-left: 12px;
}
.zotero-whiteboard-btn {
  appearance: none;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--zmd-border, #e5e7eb);
  border-radius: 6px;
  background: var(--zmd-surface, #fff);
  color: var(--zmd-text, #111827);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.zotero-whiteboard-btn:hover {
  background: var(--zmd-surface-2, #f3f4f6);
}
.zotero-whiteboard-host,
.zmd-whiteboard-wrap {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
}
.zmd-whiteboard-iframe {
  flex: 1 1 auto;
  min-height: 0;
}
`;
  doc.documentElement.appendChild(style);
}
