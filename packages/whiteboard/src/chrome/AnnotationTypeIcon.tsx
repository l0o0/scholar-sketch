/**
 * Zotero annotation glyphs, licensed under GNU AGPL version 3.
 * Copyright © 2018 Corporation for Digital Scholarship; © 2006–2017
 * Roy Rosenzweig Center for History and New Media, George Mason University.
 *
 * Source: zotero/zotero at cc951f9916c49dae7ea74c8b0029c698aa293ca0,
 * chrome/skin/default/zotero/16/universal/annotate-{highlight,underline,note,text,area,ink}.svg
 * https://github.com/zotero/zotero/tree/cc951f9916c49dae7ea74c8b0029c698aa293ca0/chrome/skin/default/zotero/16/universal
 * See the repository LICENSE for the AGPL text. SVG geometry is unchanged;
 * context-fill uses currentColor and ink clipping IDs are unique per instance.
 */
import { useId } from "react";
import type { AnnotationType } from "../model/academic";

const paths: Record<AnnotationType, string> = {
  highlight:
    "M2 2H14V14H2V2ZM1 1H2H14H15V2V14V15H14H2H1V14V2V1ZM13 13L8.75 3H7.25L3 13H4.62985L5.90485 10H10.0952L11.3702 13H13ZM8 5.07023L6.32985 9H9.67015L8 5.07023Z",
  underline:
    "M13 13L8.75 3H7.25L3 13H4.62985L5.90485 10H10.0952L11.3702 13H13ZM8 5.07023L6.32985 9H9.67015L8 5.07023ZM15 15V14H1V15H15Z",
  note: "M7.5 14.5H14.5V1.5H1.5V8.5M7.5 14.5L1.5 8.5M7.5 14.5V8.5H1.5",
  text: "M13 1.5H3V3H7.24997V14H8.74997V3H13V1.5Z",
  image:
    "M10.0001 1H6.00015V2H10.0001V1ZM12.0001 4H4.00015V12H12.0001V4ZM3.00015 3V13H13.0001V3H3.00015ZM14.0001 14V12H15V15H12V14H14.0001ZM15.0001 6H14.0001V10H15.0001V6ZM1.0001 6H2.0001V10H1.0001V6ZM6.0001 14H10.0001V15H6.0001V14ZM12.0002 2L14.0003 2.00001L14.0002 4H15.0002V1H12.0002V2ZM2.0001 2.00001V4.00001H1.0001L1.0001 1.00001L4.0001 1.00001V2L2.0001 2.00001ZM4 14L2.00015 14L2.00015 12H1L1 15L4 15V14Z",
  ink: "M12.2379 1.96038C7.35382 -0.685304 3.87074 -0.185451 2.14056 1.6023C1.09277 2.68497 0.770104 4.18435 1.20189 5.49993C0.859503 5.9151 0.586015 6.39922 0.406392 6.94321C-0.251619 8.93602 0.392748 11.5506 3.14369 14.3518L3.55138 13.3325C1.22808 10.8298 0.880354 8.69716 1.35597 7.25675C1.44524 6.98637 1.56492 6.73451 1.70984 6.50322C2.01734 6.9348 2.42776 7.31991 2.94254 7.62876C5.08604 8.91477 7.00043 8.47453 7.78686 7.27398C8.17397 6.68302 8.24618 5.93402 7.87663 5.2695C7.51213 4.61407 6.76938 4.12858 5.69987 3.91011C4.4187 3.64842 3.08109 3.95856 2.04205 4.71173C1.9233 3.869 2.19892 2.97994 2.85915 2.29774C4.12914 0.98549 7.04616 0.285329 11.7616 2.83966L12.2379 1.96038ZM3.45701 6.77126C2.98486 6.48799 2.62971 6.12157 2.39003 5.71152C3.22891 4.98627 4.3888 4.66296 5.49973 4.88988C6.38853 5.07143 6.82496 5.43594 7.00268 5.75551C7.17534 6.06599 7.1528 6.41698 6.95036 6.72602C6.55769 7.32546 5.31375 7.88522 3.45701 6.77126ZM13.2929 4C13.6834 3.60948 14.3166 3.60948 14.7071 4L15.5 4.79289C15.8905 5.18342 15.8905 5.81658 15.5 6.20711L7.42612 14.281C7.33036 14.3767 7.21615 14.4521 7.09041 14.5024L4.6857 15.4642L3.60247 15.8975L4.03576 14.8143L4.99765 12.4096C5.04794 12.2839 5.12325 12.1696 5.21902 12.0739L13.2929 4ZM12.5 6.20715L5.92612 12.781L5.39753 14.1025L6.71902 13.5739L13.2929 7.00004L12.5 6.20715ZM13.2071 5.50004L14 6.29293L14.7929 5.5L14 4.70711L13.2071 5.50004Z",
};

export function AnnotationTypeIcon({ type }: { type: AnnotationType }) {
  const clipId = useId();
  const path = (
    <path
      d={paths[type]}
      fill={type === "note" ? "none" : "currentColor"}
      stroke={type === "note" ? "currentColor" : undefined}
      fillRule={type === "note" ? undefined : "evenodd"}
      clipRule={type === "note" ? undefined : "evenodd"}
    />
  );
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {type === "ink" ? (
        <>
          <g clipPath={`url(#${clipId})`}>{path}</g>
          <defs>
            <clipPath id={clipId}>
              <rect width="16" height="16" fill="white" />
            </clipPath>
          </defs>
        </>
      ) : (
        path
      )}
    </svg>
  );
}
