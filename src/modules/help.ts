export const GITHUB_URL = "https://github.com/l0o0/scholar-sketch";
export const USER_GUIDE_URL =
  "https://zotero-chinese.com/user-guide/plugins/scholar-sketch";
export const USER_GUIDE_FALLBACK_URL =
  "https://github.com/l0o0/wiki/blob/e6255094a830193881a96e38e925b81183500598/user-guide/plugins/scholar-sketch.md";
export const USER_GUIDE_ENGLISH_URL = `${GITHUB_URL}/blob/main/docs/user-guide.en.md`;

let guideAvailable = false;
let openingGuide: Promise<void> | undefined;

/** Resolve the guide on an explicit click; only the Chinese Wiki needs a publication check. */
export function openUserGuide(): Promise<void> {
  if (openingGuide) return openingGuide;
  openingGuide = (async () => {
    if (!Zotero.locale.startsWith("zh")) {
      Zotero.launchURL(USER_GUIDE_ENGLISH_URL);
      return;
    }
    if (!guideAvailable) {
      try {
        const response = await Zotero.HTTP.request("HEAD", USER_GUIDE_URL, {
          timeout: 1500,
          errorDelayMax: 0,
          successCodes: false,
        });
        guideAvailable = response.status === 200;
      } catch {
        // The repository copy is also useful when the Wiki cannot be reached.
      }
    }
    Zotero.launchURL(guideAvailable ? USER_GUIDE_URL : USER_GUIDE_FALLBACK_URL);
  })()
    .catch((error) => ztoolkit.log("Could not open the user guide", error))
    .finally(() => {
      openingGuide = undefined;
    });
  return openingGuide;
}

export function openReleaseNotes(): void {
  Zotero.launchURL(
    `${GITHUB_URL}/releases/tag/v${encodeURIComponent(__buildVersion__)}`,
  );
}

export function openProjectRepository(): void {
  Zotero.launchURL(GITHUB_URL);
}
