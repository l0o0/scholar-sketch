import {
  isPreviewWorkerRequest,
  type PreviewWorkerResponse,
} from "../modules/markdown/preview-worker-protocol";
import {
  documentTitleCore,
  renderMarkdownCore,
  markdownPreviewFragment,
} from "../modules/markdown/preview-render-core";

declare const self: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: PreviewWorkerResponse): void;
};

self.addEventListener("message", (event) => {
  if (!isPreviewWorkerRequest(event.data)) return;
  const { requestID, source, title, fragment } = event.data;
  try {
    const selected = fragment
      ? markdownPreviewFragment(source, fragment)
      : { source };
    self.postMessage({
      version: 1,
      requestID,
      ok: true,
      title: title || documentTitleCore(source),
      bodyHtml:
        selected.headingFound === false
          ? ""
          : renderMarkdownCore(selected.source),
      ...(selected.headingFound !== undefined
        ? { headingFound: selected.headingFound }
        : {}),
    });
  } catch (error) {
    self.postMessage({
      version: 1,
      requestID,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
