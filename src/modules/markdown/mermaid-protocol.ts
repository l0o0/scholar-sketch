export const MERMAID_MESSAGE_SOURCE = "scholar-sketch-mermaid";
export const MAX_MERMAID_SOURCE = 40_000;
export const MAX_MERMAID_SVG = 2 * 1024 * 1024;
export type MermaidTheme = "light" | "dark";
export interface MermaidResult {
  svg: string;
  dataUrl: string;
}
