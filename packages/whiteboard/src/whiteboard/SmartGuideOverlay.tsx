import type { AlignmentGuide, GapGuide } from "./smartGuides";

export interface SmartGuidesProps {
  guides: readonly AlignmentGuide[];
  gaps: readonly GapGuide[];
  zoom: number;
}

/** World-coordinate overlay for ViewportPortal; decorations stay screen-sized. */
export function SmartGuides({ guides, gaps, zoom }: SmartGuidesProps) {
  if (!guides.length && !gaps.length) return null;
  const unit = 1 / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  const tick = 3 * unit;
  const gapTick = 4 * unit;

  return (
    <svg
      className="zmd-board-smart-guides"
      width={1}
      height={1}
      aria-hidden="true"
      focusable="false"
      pointerEvents="none"
      data-testid="smart-guides"
    >
      {guides.map((guide, index) => {
        const vertical = guide.axis === "x";
        const line = vertical
          ? `M ${guide.position} ${guide.start} V ${guide.end}`
          : `M ${guide.start} ${guide.position} H ${guide.end}`;
        const ends = vertical
          ? `M ${guide.position - tick} ${guide.start} h ${tick * 2} M ${guide.position - tick} ${guide.end} h ${tick * 2}`
          : `M ${guide.start} ${guide.position - tick} v ${tick * 2} M ${guide.end} ${guide.position - tick} v ${tick * 2}`;

        return (
          <g
            key={`alignment-${guide.axis}-${index}`}
            className="zmd-board-smart-alignment"
            data-axis={guide.axis}
          >
            <path
              className="zmd-board-smart-guide-halo"
              d={line}
              strokeWidth={3 * unit}
            />
            <path
              className="zmd-board-smart-guide-line"
              d={line}
              strokeWidth={unit}
            />
            <path
              className="zmd-board-smart-guide-tick"
              d={ends}
              strokeWidth={unit}
            />
            {guide.anchors.map((anchor, anchorIndex) => (
              <circle
                key={anchorIndex}
                className="zmd-board-smart-guide-anchor"
                cx={vertical ? guide.position : anchor}
                cy={vertical ? anchor : guide.position}
                r={2.25 * unit}
                strokeWidth={unit}
              />
            ))}
          </g>
        );
      })}
      {gaps.map((guide, index) => {
        const horizontal = guide.axis === "x";
        const line = horizontal
          ? `M ${guide.start} ${guide.cross} H ${guide.end}`
          : `M ${guide.cross} ${guide.start} V ${guide.end}`;
        const ends = horizontal
          ? `M ${guide.start} ${guide.cross - gapTick} v ${gapTick * 2} M ${guide.end} ${guide.cross - gapTick} v ${gapTick * 2}`
          : `M ${guide.cross - gapTick} ${guide.start} h ${gapTick * 2} M ${guide.cross - gapTick} ${guide.end} h ${gapTick * 2}`;
        const label = String(Math.round(guide.gap * 10) / 10);
        const width = Math.max(32, label.length * 6.5 + 16);
        const middle = (guide.start + guide.end) / 2;
        const labelX = horizontal
          ? middle
          : guide.cross + (14 + width / 2) * unit;
        const labelY = horizontal ? guide.cross - 14 * unit : middle;

        return (
          <g
            key={`gap-${guide.axis}-${index}`}
            className="zmd-board-smart-gap"
            data-axis={guide.axis}
          >
            <path
              className="zmd-board-smart-guide-halo"
              d={line}
              strokeWidth={3 * unit}
            />
            <path
              className="zmd-board-smart-guide-line"
              d={line}
              strokeWidth={unit}
            />
            <path
              className="zmd-board-smart-guide-tick"
              d={ends}
              strokeWidth={unit}
            />
            <g transform={`translate(${labelX} ${labelY}) scale(${unit})`}>
              <foreignObject x={-width / 2} y={-10} width={width} height={20}>
                <div className="zmd-board-smart-gap-label">{label}</div>
              </foreignObject>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
