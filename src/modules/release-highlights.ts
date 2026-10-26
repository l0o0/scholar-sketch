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
    version: "0.2.17",
    features: [
      {
        title: "feature-updates-about-settings-title",
        body: "feature-updates-about-settings-body",
      },
      {
        title: "feature-updates-guide-language-title",
        body: "feature-updates-guide-language-body",
      },
    ],
  },
  {
    version: "0.2.16",
    features: [
      {
        title: "feature-updates-note-conversion-fix-title",
        body: "feature-updates-note-conversion-fix-body",
      },
    ],
  },
  {
    version: "0.2.15",
    features: [
      {
        title: "feature-updates-annotation-preview-title",
        body: "feature-updates-annotation-preview-body",
      },
      {
        title: "feature-updates-quote-details-title",
        body: "feature-updates-quote-details-body",
      },
    ],
  },
  {
    version: "0.2.14",
    features: [
      {
        title: "feature-updates-slash-menu-title",
        body: "feature-updates-slash-menu-body",
      },
      {
        title: "feature-updates-note-conversion-title",
        body: "feature-updates-note-conversion-body",
      },
    ],
  },
  {
    version: "0.2.13",
    features: [
      {
        title: "feature-updates-attachment-annotations-title",
        body: "feature-updates-attachment-annotations-body",
      },
      {
        title: "feature-updates-local-image-shortcut-title",
        body: "feature-updates-local-image-shortcut-body",
      },
      {
        title: "feature-updates-canvas-notices-title",
        body: "feature-updates-canvas-notices-body",
      },
      {
        title: "feature-updates-example-reuse-title",
        body: "feature-updates-example-reuse-body",
      },
    ],
  },
  {
    version: "0.2.12",
    features: [
      {
        title: "feature-updates-shortcuts-title",
        body: "feature-updates-shortcuts-body",
      },
      {
        title: "feature-updates-status-title",
        body: "feature-updates-status-body",
      },
      {
        title: "feature-updates-image-download-title",
        body: "feature-updates-image-download-body",
      },
    ],
  },
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
