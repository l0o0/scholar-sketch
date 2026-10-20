import type { ImageAssetMap } from "./editor-protocol";
import { buildStandaloneDocumentFromRendered, documentTitle } from "./preview";
import { renderMarkdownAsync } from "./async-render";
import { getString } from "../../utils/locale";
import { renderMermaid } from "./mermaid";

export function exportBasename(source: string): string {
  return (
    documentTitle(source)
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Markdown"
  );
}

export async function buildExportHtml(
  options: {
    source: string;
    assets?: ImageAssetMap;
    theme?: "light" | "dark";
    title?: string;
    document?: Document;
  },
  {
    renderDiagram = renderMermaid,
  }: { renderDiagram?: typeof renderMermaid } = {},
): Promise<string> {
  const rendered = await renderMarkdownAsync({
    source: options.source,
    title: options.title,
  });
  // Ordinary exports need no browser or Mermaid runtime. Upgrade only the
  // renderer's own inert placeholders and embed finished images without scripts.
  if (
    rendered.bodyHtml.includes(
      '<div class="zmd-mermaid-block" data-zmd-mermaid="">',
    )
  ) {
    const document = options.document;
    if (!document)
      throw new Error("A document is required to export Mermaid diagrams.");
    const Parser = document.defaultView?.DOMParser;
    const body = Parser
      ? new Parser().parseFromString(rendered.bodyHtml, "text/html").body
      : document.createElement("div");
    if (!Parser) body.innerHTML = rendered.bodyHtml;
    for (const block of body.querySelectorAll<HTMLElement>(
      "[data-zmd-mermaid]",
    )) {
      const source = block.querySelector("code")?.textContent ?? "";
      try {
        const renderedDiagram = await renderDiagram(source, {
          document,
          theme: options.theme ?? "light",
        });
        const image = body.ownerDocument.createElement("img");
        image.className = "zmd-mermaid-image";
        image.setAttribute("src", renderedDiagram.dataUrl);
        image.setAttribute("alt", getString("mermaid-diagram"));
        block.replaceChildren(image);
      } catch {
        // A malformed diagram must not block the rest of the export, or silently
        // disappear. Retain the escaped code alongside a localized explanation.
        const error = body.ownerDocument.createElement("p");
        error.className = "zmd-mermaid-error";
        error.textContent = getString("mermaid-error");
        block.prepend(error);
      }
    }
    rendered.bodyHtml = body.innerHTML;
  }
  return buildStandaloneDocumentFromRendered({
    ...rendered,
    assets: options.assets,
    theme: options.theme,
  }).standaloneHtml;
}

export async function saveHtmlFile(
  win: Window,
  html: string,
  suggestedName: string,
): Promise<string | null> {
  const path = await new ztoolkit.FilePicker(
    getString("export-html-title"),
    "save",
    [["HTML", "*.html"]],
    `${suggestedName}.html`,
    win,
  ).open();
  if (!path) return null;
  await Zotero.File.putContentsAsync(path, html);
  return path;
}

/** Open the same standalone document for printing / Save as PDF. */
export function openPrintableDocument(win: Window, html: string): boolean {
  const printWin = win.open(
    "about:blank",
    "_blank",
    "chrome,centerscreen,resizable,width=920,height=760",
  );
  if (!printWin) return false;
  try {
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  } catch (error) {
    ztoolkit.log("Failed to open print document", error);
    try {
      printWin.close();
    } catch {
      // ignore
    }
    return false;
  }
  printWin.focus();
  printWin.setTimeout(async () => {
    try {
      await waitForPrintableImages(printWin);
      if (printWin.closed) return;
      printWin.print();
    } catch (error) {
      ztoolkit.log("Print dialog failed", error);
    }
  }, 50);
  return true;
}

/** Even embedded SVGs decode asynchronously; printing early can omit diagrams. */
async function waitForPrintableImages(win: Window): Promise<void> {
  await Promise.all(
    [...win.document.querySelectorAll("img")].map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          const done = () => {
            win.clearTimeout(timeout);
            image.removeEventListener("load", done);
            image.removeEventListener("error", done);
            resolve();
          };
          const timeout = win.setTimeout(done, 3000);
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
        }),
    ),
  );
}
