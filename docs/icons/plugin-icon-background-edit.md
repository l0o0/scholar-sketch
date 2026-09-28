# Plugin icon background edit

Edited with the built-in ImageGen tool. The source was the existing `addon/content/icons/favicon.png`; the edited PNG replaces it at the same path. The README logo is separate.

## Prompt

Use case: background-extraction. Edit target: the provided Scholar Sketch plugin icon PNG. Remove ONLY the flat white square background outside the rounded-square ivory app-icon tile, including the broad cast shadow outside the tile. Output a square PNG with genuine alpha transparency outside the tile, not a checkerboard or solid color. Preserve the existing rounded-square ivory tile itself, its lightly textured surface, and the EXACT dark charcoal folded-page emblem and muted sage-green folded corner inside it. Keep emblem shape, stroke thickness, proportions, position within the tile and colors faithful to the input; do not redesign the logo, add lettering, add an M, or add new elements. The rounded tile should occupy approximately 88–90 percent of the output canvas with small, even transparent margins, so the emblem remains legible when rendered as a 32px or 48px plugin icon. Clean smoothly antialiased rounded edges, no white rectangular matte and no white halo outside the rounded tile. The interior tile stays light so the dark emblem reads on both dark and light host UI backgrounds. Deliver one production icon, not a mockup or comparison sheet.

## Verification

The output is a 1254 × 1254 RGBA PNG with real transparent pixels. The rounded ivory tile and folded-page emblem remain visible. Browser previews cover light and dark surfaces at 16, 32, 48 and 64 CSS pixels; these are not native Zotero screenshots.
