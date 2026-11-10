import { config } from "../../../package.json";

export type ReadingTranslationResult =
  | { status: "translated"; text: string }
  | { status: "unavailable" }
  | { status: "failed" };

export interface ReadingTranslationService {
  id: string;
  name: string;
}

export type ReadingTranslationServices =
  | { status: "available"; services: ReadingTranslationService[] }
  | { status: "unavailable" }
  | { status: "failed" };

interface PdfTranslateAPI {
  translate?(
    text: string,
    options: { pluginID: string; service?: string },
  ): Promise<unknown>;
  getServices?(): unknown;
}

function getAPI(): PdfTranslateAPI | undefined {
  return (
    Zotero as typeof Zotero & {
      PDFTranslate?: { api?: PdfTranslateAPI };
    }
  ).PDFTranslate?.api;
}

/** List sentence services without exposing provider configuration or secrets. */
export function getReadingTranslationServices(): ReadingTranslationServices {
  const api = getAPI();
  if (typeof api?.getServices !== "function") return { status: "unavailable" };

  try {
    const services = api.getServices();
    if (!Array.isArray(services)) {
      ztoolkit.log("Reading translation services failed", {
        reason: "provider-services-result",
      });
      return { status: "failed" };
    }
    const result: ReadingTranslationService[] = [];
    for (const service of services) {
      if (
        service === null ||
        typeof service !== "object" ||
        (service.type !== "sentence" && service.type !== "word") ||
        typeof service.id !== "string" ||
        !service.id.trim()
      ) {
        ztoolkit.log("Reading translation services failed", {
          reason: "provider-services-result",
        });
        return { status: "failed" };
      }
      // The provider's sentence selector excludes word/dictionary services.
      if (service.type !== "sentence") continue;
      result.push({
        id: service.id,
        // Most bundled services omit name. Their localized labels are private.
        name:
          typeof service.name === "string" && service.name.trim()
            ? service.name
            : service.id,
      });
    }
    return { status: "available", services: result };
  } catch {
    ztoolkit.log("Reading translation services failed", {
      reason: "provider-services-request",
    });
    return { status: "failed" };
  }
}

/** Omit serviceID to follow Translate for Zotero's current configured service. */
export async function translateReadingSelection(
  text: string,
  serviceID?: string,
): Promise<ReadingTranslationResult> {
  const api = getAPI();
  if (typeof api?.translate !== "function") return { status: "unavailable" };

  try {
    // Passing itemID lets the provider infer and modify a parent item's
    // language field. Custom text needs no item context in this read-only view.
    const task = await api.translate(text, {
      pluginID: config.addonID,
      ...(serviceID === undefined ? {} : { service: serviceID }),
    });
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
