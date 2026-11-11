import { getString } from "../utils/locale";

interface GardenForumAPI {
  openForumPostDraft?(input: {
    contentMarkdown: string;
    topicType: "QUESTION";
  }):
    | { ok: true; draftId: string }
    | { ok: false; reason: "INVALID_CONTENT" | "BUSY" };
}

function garden() {
  return (Zotero as typeof Zotero & { Garden?: { api?: GardenForumAPI } })
    .Garden;
}

export function hasGarden(): boolean {
  return Boolean(garden());
}

export function promptGardenDownload(win: Window): void {
  const { prompt } = ztoolkit.getGlobal("Services") as typeof Services;
  const choice = prompt.confirmEx(
    win as Window & mozIDOMWindowProxy,
    getString("settings-garden-question"),
    getString("settings-garden-required"),
    prompt.BUTTON_POS_0! * prompt.BUTTON_TITLE_IS_STRING! +
      prompt.BUTTON_POS_1! * prompt.BUTTON_TITLE_CANCEL!,
    getString("settings-garden-download"),
    "",
    "",
    "",
    { value: false },
  );
  if (choice === 0)
    Zotero.launchURL(
      "https://ftp.zotero-chinese.com/addons/Garden-for-Zotero/",
    );
}

/** Garden owns draft review and publication; only versions enter the template. */
export function openGardenQuestion(): void {
  const openDraft = garden()?.api?.openForumPostDraft;
  if (typeof openDraft !== "function")
    throw new Error(getString("settings-garden-unavailable"));

  let result: ReturnType<NonNullable<GardenForumAPI["openForumPostDraft"]>>;
  try {
    result = openDraft({
      topicType: "QUESTION",
      contentMarkdown: getString("garden-question-template", {
        args: {
          pluginVersion: __buildVersion__,
          zoteroVersion: Zotero.version,
        },
      }),
    });
  } catch (error) {
    ztoolkit.log("Could not open Garden question draft", error);
    throw new Error(getString("settings-garden-failed"), { cause: error });
  }
  // BUSY selects the existing draft without replacing its content.
  if (!result.ok && result.reason !== "BUSY") {
    ztoolkit.log("Garden rejected question draft", result.reason);
    throw new Error(getString("settings-garden-failed"));
  }
}
