import { getPref, setPref } from "../../../utils/prefs";
import { getString } from "../../../utils/locale";
import { pickZoteroItems } from "../../item-picker";
import type { OpenSession } from "../session-registry";
import { sessionRegistry } from "../session-registry";
import { resolveImageAssets } from "../images/service";
import { imageAssetFromMap } from "../images/model";
import { exportBasename } from "../export-document";
import { renderMermaid } from "../mermaid";
import { choosePaperSettings, type PaperSettings } from "./dialog";
import { convertPaper, publishPaper, PaperExportError } from "./export";
import {
  runPandoc,
  resolvePaperReference,
  paperCitationForItem,
  rasterizePaperImage,
} from "./host";

const operations = new WeakMap<OpenSession, AbortController>();
export function cancelPaperExport(session: OpenSession) {
  operations.get(session)?.abort();
}

function sessionCurrent(session: OpenSession) {
  return !session.closing && sessionRegistry.get(session.tabID) === session;
}

export async function insertPaperCitation(
  session: OpenSession,
  editable: () => boolean,
) {
  const editor = session.editor;
  if (!editor || !sessionCurrent(session) || !editable()) return;
  if (editor.isComposing()) throw new Error(getString("note-export-composing"));
  const source = await editor.requestSnapshot();
  if (!sessionCurrent(session) || session.editor !== editor) return;
  const ids = pickZoteroItems(session.win, { onlyRegularItems: true });
  if (!ids) return;
  const keys = ids.map((id) => {
    const item = Zotero.Items.get(id);
    if (!item) throw new PaperExportError("citation", String(id));
    return paperCitationForItem(item);
  });
  let locator = "";
  if (keys.length === 1) {
    const result = session.win.prompt(getString("paper-citation-locator"), "");
    if (result === null) return;
    locator = result.trim();
    if (/[[\];\n\r]/.test(locator))
      throw new Error(getString("paper-citation-locator-invalid"));
  }
  if (!sessionCurrent(session) || session.editor !== editor || !editable())
    return;
  if (editor.getValue() !== source || editor.isComposing())
    throw new Error(getString("paper-citation-changed"));
  editor.insertText(
    `[${keys.map((key) => `@${key}${locator ? `, ${locator}` : ""}`).join("; ")}]`,
  );
  editor.focus();
}

async function initialSettings(): Promise<PaperSettings> {
  let pandocPath = getPref("paperPandocPath") || "";
  if (!pandocPath && !Zotero.isWin) {
    for (const path of [
      "/opt/homebrew/bin/pandoc",
      "/usr/local/bin/pandoc",
      "/usr/bin/pandoc",
    ]) {
      if (await IOUtils.exists(path)) {
        pandocPath = path;
        break;
      }
    }
  }
  return {
    pandocPath,
    styleID: getPref("paperStyleID") || "",
    referenceDoc: getPref("paperReferenceDoc") || "",
  };
}

/** Convert a snapshot in isolation and publish only a complete, current result. */
export async function exportSessionPaper(
  session: OpenSession,
): Promise<string | null> {
  const editor = session.editor;
  const mount = session.view?.root;
  if (!editor || !mount || !sessionCurrent(session) || operations.has(session))
    return null;
  const controller = new AbortController();
  operations.set(session, controller);
  const { signal } = controller;
  const unload = () => controller.abort();
  session.win.addEventListener("unload", unload, { once: true });
  let workspace: string | undefined;
  let feedback:
    ReturnType<NonNullable<OpenSession["statusFeedback"]>["begin"]> | undefined;
  const assertCurrent = () => {
    if (!sessionCurrent(session) || session.editor !== editor)
      controller.abort();
    signal.throwIfAborted();
  };
  try {
    const initial = await initialSettings();
    await Zotero.Styles.init();
    assertCurrent();
    const settings = await choosePaperSettings({
      mount,
      initial,
      signal,
      styles: Zotero.Styles.getVisible().map(
        (style: { styleID: string; title: string }) => ({
          id: style.styleID,
          title: style.title,
        }),
      ),
      pickFile: (kind) =>
        new ztoolkit.FilePicker(
          getString(kind === "pandoc" ? "paper-pandoc" : "paper-template"),
          "open",
          kind === "template"
            ? [["Word", "*.docx"]]
            : [[getString("paper-pandoc"), Zotero.isWin ? "*.exe" : "*"]],
          undefined,
          session.win,
        )
          .open()
          .then((path) => path || null),
    });
    if (!settings) return null;
    assertCurrent();
    const target = await new ztoolkit.FilePicker(
      getString("paper-export-title"),
      "save",
      [["Word", "*.docx"]],
      `${exportBasename(editor.getValue())}.docx`,
      session.win,
    ).open();
    if (!target) return null;
    assertCurrent();
    if (!/\.docx$/i.test(target))
      throw new Error(getString("paper-export-extension"));
    const readTarget = async () =>
      (await IOUtils.exists(target)) ? IOUtils.read(target) : null;
    const baseline = await readTarget();
    if (editor.isComposing())
      throw new Error(getString("note-export-composing"));
    const source = await editor.requestSnapshot();
    assertCurrent();
    feedback = session.statusFeedback?.begin(getString("paper-exporting"));
    setPref("paperPandocPath", settings.pandocPath);
    setPref("paperStyleID", settings.styleID);
    setPref("paperReferenceDoc", settings.referenceDoc);
    workspace = PathUtils.join(
      Zotero.getTempDirectory().path,
      `scholar-paper-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await IOUtils.makeDirectory(workspace);
    const path = (...names: string[]) => PathUtils.join(workspace!, ...names);
    let csl: string | undefined;
    if (settings.styleID) {
      const style = Zotero.Styles.get(settings.styleID);
      if (!style) throw new Error(getString("paper-style-missing"));
      csl = path("style.csl");
      await IOUtils.writeUTF8(csl, style.getXML());
    }
    const item = Zotero.Items.get(session.itemID);
    if (!item) throw new Error(getString("error-attachment-gone"));
    const assets = await resolveImageAssets(item, source);
    const bytes = await convertPaper(
      { source, csl, referenceDoc: settings.referenceDoc || undefined, signal },
      {
        path,
        writeText: async (path, content) => {
          await IOUtils.makeDirectory(PathUtils.parent(path)!, {
            ignoreExisting: true,
            createAncestors: true,
          });
          await IOUtils.writeUTF8(path, content);
        },
        readText: (path) => IOUtils.readUTF8(path),
        readBytes: (path) => IOUtils.read(path),
        run: (args, signal) =>
          runPandoc(settings.pandocPath, args, workspace!, signal),
        reference: resolvePaperReference,
        image: async (reference, signal) => {
          const dataUrl = reference.startsWith("data:")
            ? reference
            : imageAssetFromMap(reference, assets)?.dataUrl;
          if (!dataUrl) throw new PaperExportError("image", reference);
          return rasterizePaperImage(session.win.document, dataUrl, signal);
        },
        diagram: async (source, signal) => {
          const rendered = await renderMermaid(source, {
            document: session.win.document,
            theme: "light",
            signal,
          });
          return rasterizePaperImage(
            session.win.document,
            rendered.dataUrl,
            signal,
          );
        },
      },
    );
    const temporary = `${target}.scholar-${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await publishPaper(bytes, baseline, {
        read: readTarget,
        assertCurrent,
        write: async (bytes) => {
          await IOUtils.write(target, bytes, {
            tmpPath: temporary,
            flush: true,
          });
        },
      });
    } finally {
      try {
        await IOUtils.remove(temporary, { ignoreAbsent: true });
      } catch (error) {
        ztoolkit.log("Paper export temporary file cleanup failed", error);
      }
    }
    feedback?.succeed(getString("paper-export-complete"));
    return target;
  } catch (error) {
    if (signal.aborted) {
      feedback?.cancel();
      return null;
    }
    feedback?.fail(getString("paper-export-failed"));
    throw error;
  } finally {
    session.win.removeEventListener("unload", unload);
    controller.abort();
    operations.delete(session);
    if (workspace) {
      try {
        await IOUtils.remove(workspace, { recursive: true });
      } catch (error) {
        ztoolkit.log("Paper export workspace cleanup failed", error);
      }
    }
  }
}

export function reportPaperError(error: unknown) {
  ztoolkit.log("Markdown paper operation failed", error);
  const text =
    error instanceof PaperExportError
      ? getString(`paper-error-${error.code}`, {
          args: { detail: error.detail.slice(0, 500) },
        })
      : error instanceof Error
        ? error.message
        : String(error);
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({ text, type: "fail" })
    .show();
}
