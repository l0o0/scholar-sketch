import { THEME_TOKENS as SHARED_THEME_TOKENS } from "../../ui/theme";

export { themeTokenCss, type ThemeTokenSet } from "../../ui/theme";

// Markdown keeps a quiet reading surface without changing the canvas palette.
export const THEME_TOKENS = {
  light: {
    ...SHARED_THEME_TOKENS.light,
    surface2: "#f7f8fa",
    border: "#e6e8ec",
    text: "#24272c",
    codeBlockBg: "#f6f7f9",
  },
  dark: SHARED_THEME_TOKENS.dark,
};
