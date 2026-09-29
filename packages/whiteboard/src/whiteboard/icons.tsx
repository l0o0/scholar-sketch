import type { NoteType } from "../model/academic";
/// <reference lib="dom" />

/**
 * Minimal Lucide-style SVG icons (MIT) for the whiteboard toolbar.
 * Inline paths avoid pulling the full lucide package into the plugin bundle.
 */

import type { ReactElement, SVGProps } from "react";

function Icon({
  children,
  ...rest
}: SVGProps<SVGSVGElement> & { children: ReactElement | ReactElement[] }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconSave = () => (
  <Icon>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </Icon>
);

export const IconZotero = () => (
  <Icon stroke="#cc2936" strokeWidth="2.8">
    <path d="M5 5h14L5 19h14" />
  </Icon>
);

export const IconUndo = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const IconRedo = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export const IconChevronDown = () => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const IconCheck = () => (
  <Icon>
    <path d="m5 12 4 4L19 6" />
  </Icon>
);

export const IconQuote = () => (
  <Icon>
    <path d="M10 11H4V5h6v8a6 6 0 0 1-6 6M20 11h-6V5h6v8a6 6 0 0 1-6 6" />
  </Icon>
);

export const IconSelect = () => (
  <Icon>
    <path d="M4 4 11 20 13 13 20 11Z" />
  </Icon>
);

export const IconHand = () => (
  <Icon>
    <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
    <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.3L4 16" />
  </Icon>
);

export const IconItem = () => (
  <Icon>
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    <path d="M10 2v8l3-2 3 2V2" />
  </Icon>
);

export const IconNote = () => (
  <Icon>
    <path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" />
    <path d="M15 3v6h6" />
  </Icon>
);

export const IconQuestion = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-.9.5-1.5 1.1-1.5 2" />
    <path d="M12 17h.01" />
  </Icon>
);

export const IconClaim = () => (
  <Icon>
    <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
    <path d="m8 11 2.5 2.5L16 8" />
  </Icon>
);

export const IconGroup = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
    <rect x="7" y="7" width="4" height="4" rx="0.5" />
    <rect x="13" y="13" width="4" height="4" rx="0.5" />
  </Icon>
);

export const IconFrame = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="7" y="7" width="4" height="4" rx="0.5" />
    <rect x="13" y="13" width="4" height="4" rx="0.5" />
  </Icon>
);

export const IconPdf = () => (
  <Icon>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" x2="8" y1="13" y2="13" />
    <line x1="16" x2="8" y1="17" y2="17" />
  </Icon>
);

export const IconFile = () => (
  <Icon>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Icon>
);

export const IconImage = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </Icon>
);

export const IconAudio = () => (
  <Icon>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Icon>
);

export const IconVideo = () => (
  <Icon>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
  </Icon>
);

export const IconArchive = () => (
  <Icon>
    <path d="M4 4h16v4H4z" />
    <path d="M6 8v12h12V8" />
    <path d="M10 12h4" />
  </Icon>
);

export const IconText = () => (
  <Icon>
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" x2="15" y1="20" y2="20" />
    <line x1="12" x2="12" y1="4" y2="20" />
  </Icon>
);

export const IconTextFile = () => (
  <Icon>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" x2="8" y1="13" y2="13" />
    <line x1="16" x2="8" y1="17" y2="17" />
  </Icon>
);

export const IconRect = () => (
  <Icon>
    <rect width="18" height="18" x="3" y="3" rx="2" />
  </Icon>
);

export const IconRoundedRect = () => (
  <Icon>
    <rect width="18" height="16" x="3" y="4" rx="6" />
  </Icon>
);

export const IconEllipse = () => (
  <Icon>
    <circle cx="12" cy="12" r="10" />
  </Icon>
);

export const IconDiamond = () => (
  <Icon>
    <path d="m12 3 9 9-9 9-9-9 9-9Z" />
  </Icon>
);

export const IconLine = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);

export const IconArrow = () => (
  <Icon>
    <path d="M18 8 22 12 18 16" />
    <path d="M2 12h20" />
  </Icon>
);

export const IconEraser = () => (
  <Icon>
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </Icon>
);

export const IconEdit = () => (
  <Icon>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </Icon>
);

export const IconCopy = () => (
  <Icon>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Icon>
);

export const IconTrash = () => (
  <Icon>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </Icon>
);

export const IconOpen = () => (
  <Icon>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" x2="21" y1="14" y2="3" />
  </Icon>
);

export const IconFitView = () => (
  <Icon>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </Icon>
);

export const IconLayout = () => (
  <Icon>
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </Icon>
);

export const IconAlignLeft = () => (
  <Icon>
    <line x1="21" x2="3" y1="6" y2="6" />
    <line x1="15" x2="3" y1="12" y2="12" />
    <line x1="17" x2="3" y1="18" y2="18" />
  </Icon>
);

export const IconAlignRight = () => (
  <Icon>
    <line x1="3" x2="21" y1="6" y2="6" />
    <line x1="9" x2="21" y1="12" y2="12" />
    <line x1="7" x2="21" y1="18" y2="18" />
  </Icon>
);

export const IconAlignTop = () => (
  <Icon>
    <line x1="6" x2="6" y1="3" y2="21" />
    <line x1="12" x2="12" y1="3" y2="15" />
    <line x1="18" x2="18" y1="3" y2="17" />
  </Icon>
);

export const IconAlignBottom = () => (
  <Icon>
    <line x1="6" x2="6" y1="21" y2="3" />
    <line x1="12" x2="12" y1="21" y2="9" />
    <line x1="18" x2="18" y1="21" y2="7" />
  </Icon>
);

export const IconAlignHCenter = () => (
  <Icon>
    <line x1="12" x2="12" y1="3" y2="21" />
    <line x1="4" x2="20" y1="9" y2="9" />
    <line x1="4" x2="20" y1="15" y2="15" />
  </Icon>
);

export const IconAlignVCenter = () => (
  <Icon>
    <line x1="12" x2="12" y1="3" y2="21" />
    <line x1="3" x2="21" y1="12" y2="12" />
  </Icon>
);

export const IconDistributeH = () => (
  <Icon>
    <line x1="4" x2="20" y1="8" y2="8" />
    <line x1="4" x2="20" y1="16" y2="16" />
    <line x1="8" x2="8" y1="5" y2="19" />
    <line x1="16" x2="16" y1="5" y2="19" />
  </Icon>
);

export const IconDistributeV = () => (
  <Icon>
    <line x1="8" x2="8" y1="4" y2="20" />
    <line x1="16" x2="16" y1="4" y2="20" />
    <line x1="5" x2="19" y1="8" y2="8" />
    <line x1="5" x2="19" y1="16" y2="16" />
  </Icon>
);

export const IconExport = () => (
  <Icon>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </Icon>
);

export const IconMore = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
  </svg>
);

export const IconBold = () => (
  <Icon>
    <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
  </Icon>
);

export const IconItalic = () => (
  <Icon>
    <line x1="19" x2="10" y1="4" y2="4" />
    <line x1="14" x2="5" y1="20" y2="20" />
    <line x1="15" x2="9" y1="4" y2="20" />
  </Icon>
);

export const IconUnderline = () => (
  <Icon>
    <path d="M6 4v6a6 6 0 0 0 12 0V4" />
    <line x1="4" x2="20" y1="20" y2="20" />
  </Icon>
);

export const IconStrike = () => (
  <Icon>
    <path d="M16 4H9a3 3 0 0 0 0 6h6" />
    <path d="M8 20h7a3 3 0 0 0 0-6H8" />
    <line x1="4" x2="20" y1="12" y2="12" />
  </Icon>
);

export const IconValignTop = () => (
  <Icon>
    <path d="M4 4h16" />
    <rect x="8" y="8" width="8" height="12" rx="1" />
  </Icon>
);

export const IconValignMiddle = () => (
  <Icon>
    <path d="M4 12h16" />
    <rect x="8" y="5" width="8" height="14" rx="1" />
  </Icon>
);

export const IconValignBottom = () => (
  <Icon>
    <path d="M4 20h16" />
    <rect x="8" y="4" width="8" height="12" rx="1" />
  </Icon>
);

export const IconAlignTextLeft = () => (
  <Icon>
    <line x1="21" x2="3" y1="6" y2="6" />
    <line x1="15" x2="3" y1="12" y2="12" />
    <line x1="17" x2="3" y1="18" y2="18" />
  </Icon>
);

export const IconAlignTextCenter = () => (
  <Icon>
    <line x1="21" x2="3" y1="6" y2="6" />
    <line x1="17" x2="7" y1="12" y2="12" />
    <line x1="19" x2="5" y1="18" y2="18" />
  </Icon>
);

export const IconAlignTextRight = () => (
  <Icon>
    <line x1="21" x2="3" y1="6" y2="6" />
    <line x1="21" x2="9" y1="12" y2="12" />
    <line x1="21" x2="7" y1="18" y2="18" />
  </Icon>
);

export function NoteTypeIcon({ type }: { type: NoteType }) {
  switch (type) {
    case "question":
      return <IconQuestion />;
    case "claim":
      return <IconClaim />;
    case "evidence":
      return <IconQuote />;
    case "summary":
      return (
        <Icon>
          <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
        </Icon>
      );
    default:
      return <IconNote />;
  }
}

export function IconStrokePreview({
  dashed = false,
  width = 2,
  start = false,
  end = false,
}: {
  dashed?: boolean;
  width?: number;
  start?: boolean;
  end?: boolean;
}) {
  return (
    <svg
      width="28"
      height="20"
      viewBox="0 0 40 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={`M${start ? 8 : 3} 12H${end ? 32 : 37}`}
        stroke="currentColor"
        strokeWidth={width}
        strokeDasharray={dashed ? "5 4" : undefined}
      />
      {start ? <path d="M2 12l8-5v10Z" fill="currentColor" /> : null}
      {end ? <path d="M38 12l-8-5v10Z" fill="currentColor" /> : null}
    </svg>
  );
}

export function IconCorners({ radius }: { radius: number }) {
  return (
    <Icon>
      <rect x="4" y="4" width="16" height="16" rx={Math.min(8, radius / 4)} />
    </Icon>
  );
}

export const IconProperties = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16M6 8h5M6 12h3" />
  </Icon>
);

export const IconPalette = () => (
  <Icon>
    <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4c-.8-.8-.2-2.1.9-2.1H17a4 4 0 0 0 4-4A8.5 8.5 0 0 0 12 3Z" />
    <circle cx="7" cy="11" r="1" />
    <circle cx="10" cy="7" r="1" />
    <circle cx="15" cy="7" r="1" />
  </Icon>
);

export const IconStrokeWeight = () => (
  <Icon>
    <path d="M4 5h16" strokeWidth="1" />
    <path d="M4 11h16" strokeWidth="2" />
    <path d="M4 18h16" strokeWidth="4" />
  </Icon>
);
