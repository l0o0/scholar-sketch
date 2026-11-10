import { config } from "../../../package.json";

export type ReadingTranslationResult =
  | { status: "translated"; text: string }
  | { status: "unavailable" }
  | { status: "failed" };

interface PdfTranslateAPI {
  translate(text: string, options: { pluginID: string }): Promise<unknown>;
}

/** Use Translate for Zotero's custom-text API and its configured service. */
export async function translateReadingSelection(
  text: string,
): Promise<ReadingTranslationResult> {
  const api = (
    Zotero as typeof Zotero & {
      PDFTranslate?: { api?: PdfTranslateAPI };
    }
  ).PDFTranslate?.api;
  if (typeof api?.translate !== "function") return { status: "unavailable" };

  try {
    // Passing itemID lets the provider infer and modify a parent item's
    // language field. Custom text needs no item context in this read-only view.
    const task = await api.translate(text, { pluginID: config.addonID });
    if (
      task !== null &&
      typeof task === "object" &&
      "status" in task &&
      task.status === "success" &&
      "result" in task &&
      typeof task.result === "string" &&
      task.result.trim()
    )
      return { status: "translated", text: task.result };

    ztoolkit.log("Reading selection translation failed", {
      reason: "provider-result",
    });
  } catch {
    // Provider tasks and errors can contain selected text, request URLs and
    // credentials. Keep provider diagnostics with that plugin, not our logs.
    ztoolkit.log("Reading selection translation failed", {
      reason: "provider-request",
    });
  }
  return { status: "failed" };
}
