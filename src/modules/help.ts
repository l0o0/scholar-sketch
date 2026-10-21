export const USER_GUIDE_URL =
  "https://zotero-chinese.com/user-guide/plugins/scholar-sketch";
export const USER_GUIDE_FALLBACK_URL =
  "https://github.com/l0o0/wiki/blob/123b2d11ddaf509cfa2061f2a27f03552c624b6e/user-guide/plugins/scholar-sketch.md";

let guideAvailable = false;
let openingGuide: Promise<void> | undefined;

/** Check only on an explicit click, while the Wiki contribution is awaiting publication. */
export function openUserGuide(): Promise<void> {
  if (openingGuide) return openingGuide;
  openingGuide = (async () => {
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
    `https://github.com/l0o0/scholar-sketch/releases/tag/v${encodeURIComponent(__buildVersion__)}`,
  );
}
