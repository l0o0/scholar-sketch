import type { QuoteSnapshot } from "../model/academic";
import type { CanvasNodeStyle } from "../model/core";

export function quoteNodeStyle(
  snapshot: Pick<QuoteSnapshot, "color">,
  style: Partial<CanvasNodeStyle> = {},
): Partial<CanvasNodeStyle> {
  if (
    style.fill !== undefined ||
    !snapshot.color ||
    !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(snapshot.color)
  )
    return style;
  return { ...style, fill: snapshot.color };
}
