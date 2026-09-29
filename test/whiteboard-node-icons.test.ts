import { IconFile } from "../packages/whiteboard/src/whiteboard/icons.tsx";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { WhiteboardLabelsProvider } from "../packages/whiteboard/src/chrome/labels.tsx";
import {
  createBasicNode,
  type CanvasNode,
} from "../packages/whiteboard/src/model/index.ts";
import { getNodeSpec } from "../packages/whiteboard/src/nodes/index.ts";

const labels = new Proxy(
  {
    addText: "Text",
    addPdf: "PDF",
    addFile: "File",
    fileImage: "Image",
    filePdf: "PDF",
    fileText: "Text",
    fileAudio: "Audio",
    fileVideo: "Video",
    fileGeneric: "File",
    attachmentNotDownloaded: "Not downloaded",
  } as Record<string, unknown>,
  {
    get: (target, property) =>
      Reflect.get(target, property) ?? String(property),
  },
);

function renderNode(model: CanvasNode) {
  const Component = getNodeSpec(model.kind).Component;
  return renderToStaticMarkup(
    createElement(
      WhiteboardLabelsProvider,
      { value: labels as never },
      createElement(
        ReactFlowProvider,
        null,
        createElement(Component, {
          id: model.id,
          type: model.kind,
          data: { model },
          selected: false,
          width: model.width,
          height: model.height,
        } as never),
      ),
    ),
  );
}

test("text node keeps its type accessible while showing only the text icon", () => {
  const markup = renderNode(createBasicNode("text", { x: 0, y: 0 }, "text-1"));
  const header = markup.match(/<header[^>]*>[\s\S]*?<\/header>/)?.[0];
  assert.ok(header);
  assert.match(header, /title="Text"/);
  assert.match(header, /aria-label="Text"/);
  assert.match(header, /role="img" aria-label="Text"/);
  assert.match(header, /<svg/);
  assert.doesNotMatch(header, /class="zmd-board-card-kind"/);
});

test("PDF and attachment headers share the paperclip icon without visible labels", () => {
  const pdf = renderNode(createBasicNode("pdf", { x: 0, y: 0 }, "pdf-1"));
  const attachment = createBasicNode("attachment", { x: 0, y: 0 }, "file-1");
  attachment.data = {
    ...attachment.data,
    title: "recording.mp3",
    contentType: "audio/mpeg",
  };
  const audio = renderNode(attachment);
  for (const [markup, label] of [
    [pdf, "PDF"],
    [audio, "Audio"],
  ] as const) {
    const header = markup.match(/<header[^>]*>[\s\S]*?<\/header>/)?.[0];
    assert.ok(header);
    assert.match(header, new RegExp(`title="${label}"`));
    assert.match(header, new RegExp(`aria-label="${label}"`));
    assert.match(header, new RegExp(`role="img" aria-label="${label}"`));
    assert.ok(header.includes(renderToStaticMarkup(createElement(IconFile))));
    assert.doesNotMatch(header, /class="zmd-board-card-kind"/);
  }
});
