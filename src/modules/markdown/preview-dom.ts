/** Mount vetted renderer output while preserving Zotero links in chrome documents. */
export function mountRenderedMarkdown(
  container: HTMLElement,
  html: string,
): void {
  const document = container.ownerDocument;
  const Parser = document.defaultView!.DOMParser;
  const parsed = new Parser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  const content = parsed.body.firstElementChild!;
  container.replaceChildren(
    ...Array.from(content.childNodes, (child) =>
      document.importNode(child, true),
    ),
  );
}
