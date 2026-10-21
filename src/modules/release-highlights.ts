import { version } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";

export interface ReleaseHighlights {
  version: string;
  /** The first introduction includes useful features from earlier releases. */
  overview?: boolean;
  features: Array<{ title: FluentMessageId; body: FluentMessageId }>;
}

/**
 * Add the release being published here when changing package.json's version.
 * Keep these concise; the complete release notes live on GitHub. The release
 * coverage test prevents a version bump from silently reusing old highlights.
 */
export const RELEASE_HIGHLIGHTS: readonly ReleaseHighlights[] = [
  {
    version: "0.2.11",
    overview: true,
    features: [
      {
        title: "feature-updates-image-repair-title",
        body: "feature-updates-image-repair-body",
      },
      {
        title: "feature-updates-mermaid-title",
        body: "feature-updates-mermaid-body",
      },
      {
        title: "feature-updates-links-title",
        body: "feature-updates-links-body",
      },
      {
        title: "feature-updates-guide-title",
        body: "feature-updates-guide-body",
      },
    ],
  },
];

export function featureUpdateVersion(): string {
  return typeof __buildVersion__ === "string" ? __buildVersion__ : version;
}

export function releaseHighlights(release = featureUpdateVersion()) {
  return RELEASE_HIGHLIGHTS.find((entry) => entry.version === release);
}
