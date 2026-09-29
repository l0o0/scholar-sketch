import {
  registerWhiteboardSidebar,
  unregisterWhiteboardSidebar,
  disposeWhiteboardSidebarForWindow,
} from "./modules/whiteboard/sidebar";
import {
  retainWorkspaceOnShutdown,
  restoreWorkspace,
  resumeWorkspaceTracking,
} from "./modules/workspace-state";
import { closeNoteIndex } from "./modules/markdown/note-index";
import {
  createMarkdownAttachment,
  flushAllSessions,
  flushSessionsForWindow,
  injectMarkdownStyles,
  openMarkdownAttachment,
  closeAllMarkdownWindows,
  registerFileOpenInterceptor,
  registerMarkdownTabHooks,
  registerMenus,
  registerItemContextMenu,
  registerShortcuts,
  unregisterFileOpenInterceptor,
  unregisterMenus,
  unregisterItemContextMenu,
  unregisterShortcuts,
} from "./modules/markdown";
import {
  closeAllWhiteboards,
  closeWhiteboardsForWindow,
  ensureTutorialWhiteboard,
  flushAllWhiteboards,
  injectWhiteboardStyles,
  registerWhiteboardFileOpenInterceptor,
  registerWhiteboardMenus,
  registerWhiteboardTabHooks,
  unregisterWhiteboardFileOpenInterceptor,
  unregisterWhiteboardMenus,
} from "./modules/whiteboard";
import { canvasApi } from "./modules/whiteboard/api";
import { markdownApi } from "./modules/markdown/api";
import {
  disposeSidebarForWindow,
  registerSidebarSection,
  unregisterSidebarSection,
} from "./modules/markdown/sidebar";
import { ensureDOMGlobals } from "./utils/dom";
import { getString, initLocale } from "./utils/locale";
import { bindMarkdownSettingsPreferencePane } from "./modules/markdown/settings";
import { disposeMarkdownRenderer } from "./modules/markdown/async-render";
import {
  clearNoteLibraries,
  registerNoteLibraryObserver,
} from "./modules/markdown/note-library";
import {
  registerAttachmentIcons,
  unregisterAttachmentIcons,
} from "./modules/attachment-icons";

let tutorialStartup: Promise<void> | undefined;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerPrefs();
  await registerAttachmentIcons();
  registerFileOpenInterceptor();
  registerWhiteboardFileOpenInterceptor();
  // Register global toolbar menus first. registerMenus() performs a global
  // cleanup, so per-window item context menus must be mounted afterwards.
  registerMenus();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  registerNoteLibraryObserver();
  registerSidebarSection();
  registerWhiteboardSidebar();
  tutorialStartup = ensureTutorialWhiteboard();

  addon.api = {
    version: 3,
    openMarkdown: openMarkdownAttachment,
    createMarkdown: createMarkdownAttachment,
    markdown: markdownApi,
    canvas: canvasApi,
    getString,
  };
  addon.data.initialized = true;
  const mainWindow = Zotero.getMainWindow();
  if (mainWindow)
    void restoreWorkspace(mainWindow).catch((error) =>
      ztoolkit.log("Workspace restoration failed", error),
    );
  ztoolkit.log(`${addon.data.config.addonName} initialized`);
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Plugin sandbox has no browser `document`; bridge from chrome window
  // so DOM libraries work (also via ztoolkit.getGlobal).
  ensureDOMGlobals(win);
  resumeWorkspaceTracking();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  // Idempotent: KeyboardManager listens on all windows (via Services.wm),
  // so shortcuts must be registered only once per ztoolkit instance.
  registerShortcuts();

  registerMarkdownTabHooks(win);
  registerWhiteboardTabHooks(win);
  registerItemContextMenu(win);
  registerWhiteboardMenus(win);
  injectMarkdownStyles(win);
  injectWhiteboardStyles(win);

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 3000,
  })
    .createLine({
      text: getString("startup-finish"),
      type: "success",
      progress: 100,
    })
    .show();
  popupWin.startCloseTimer(3000);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  // Do NOT call ztoolkit.unregisterAll() here: it is a global teardown that
  // removes listeners from ALL windows (e.g. KeyboardManager removes every
  // window's keydown listeners), breaking shortcuts in other windows.
  // Per-window cleanup is handled by the toolkit's own Services.wm
  // onCloseWindow callbacks (unInitKeyboardListener for the closing window).
  if (Zotero.getMainWindows().length <= 1) retainWorkspaceOnShutdown();
  await flushSessionsForWindow(_win);
  unregisterItemContextMenu(_win);
  unregisterWhiteboardMenus(_win);
  await disposeWhiteboardSidebarForWindow(_win);
  await closeWhiteboardsForWindow(_win);
  await disposeSidebarForWindow(_win);
}

async function onShutdown(): Promise<void> {
  retainWorkspaceOnShutdown();
  await unregisterAttachmentIcons();
  if (tutorialStartup) {
    await tutorialStartup;
    tutorialStartup = undefined;
  }
  await closeAllMarkdownWindows();
  await flushAllSessions();
  await flushAllWhiteboards();
  await unregisterWhiteboardSidebar();
  await closeAllWhiteboards();
  await unregisterSidebarSection();
  disposeMarkdownRenderer();
  clearNoteLibraries();
  await closeNoteIndex();
  unregisterFileOpenInterceptor();
  unregisterWhiteboardFileOpenInterceptor();
  unregisterMenus();
  unregisterShortcuts();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      bindMarkdownSettingsPreferencePane(data.window.document);
      break;
    default:
      break;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
