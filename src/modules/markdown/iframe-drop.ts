/** Route drops on the outer iframe element through CodeMirror's existing handlers. */
export function attachMarkdownIframeDrop(
  wrapper: HTMLElement,
  iframe: HTMLIFrameElement,
  editable: () => boolean,
): () => void {
  const forward = (event: DragEvent) => {
    if (!editable() || !event.dataTransfer) return;
    const types = Array.from(event.dataTransfer.types);
    if (
      !types.some((type) =>
        ["Files", "text/plain", "text/html", "zotero/item"].includes(type),
      )
    )
      return;
    const doc = iframe.contentDocument;
    const content = doc?.querySelector<HTMLElement>(".cm-content");
    const win = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!content || !win) return;
    const rect = iframe.getBoundingClientRect();
    const forwarded = new win.DragEvent(event.type, {
      bubbles: true,
      cancelable: true,
      dataTransfer: event.dataTransfer,
      clientX: event.clientX - rect.left,
      clientY: event.clientY - rect.top,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    });
    content.dispatchEvent(forwarded);
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "drop") event.dataTransfer.dropEffect = "copy";
  };
  for (const type of ["dragenter", "dragover", "drop"] as const)
    wrapper.addEventListener(type, forward, true);
  return () => {
    for (const type of ["dragenter", "dragover", "drop"] as const)
      wrapper.removeEventListener(type, forward, true);
  };
}
