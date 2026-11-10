import { getString } from "../../utils/locale";
import { getMarkdownStyleCssReference } from "./style-css";

/** Generates clipboard text only; the user chooses an AI tool and sends it. */
export function markdownStylePrompt(css: string): string {
  return [
    getString("settings-style-prompt-instructions"),
    getString("settings-style-prompt-request"),
    getMarkdownStyleCssReference(),
    getString("settings-style-prompt-current"),
    "```css\n" + css + "\n```",
    getString("settings-style-prompt-sample"),
    "```markdown\n" + getString("settings-style-sample") + "\n```",
  ].join("\n\n");
}
