/// <reference lib="dom" />
import mermaid from "mermaid";
import {
  MAX_MERMAID_SOURCE,
  MAX_MERMAID_SVG,
  MERMAID_MESSAGE_SOURCE,
} from "../modules/markdown/mermaid-protocol";

const channel = location.hash.slice(1);
let busy = false;
let port: MessagePort | undefined;
const send = (message: Record<string, unknown>) =>
  port?.postMessage({ source: MERMAID_MESSAGE_SOURCE, channel, ...message });

function localURLsOnly(value: string): string {
  return value
    .replace(/@import[^;]+;?/gi, "")
    .replace(/url\s*\(([^)]*)\)/gi, (match, raw: string) => {
      const url = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
      return /^#[\w:.-]+$/.test(url) ? match : "none";
    });
}

// Mermaid's dark mind-map defaults use almost-black branches on dark paper.
const darkPalette = [
  "#93c5fd",
  "#99f6e4",
  "#d8b4fe",
  "#fcd34d",
  "#fda4af",
  "#a5b4fc",
];
const darkDiagramColors = {
  git0: "#93c5fd",
  gitBranchLabel0: "#172033",
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      [`cScale${i}`, darkPalette[i % darkPalette.length]],
      [`cScaleLabel${i}`, "#172033"],
    ]).flat(),
  ),
};

async function render(event: MessageEvent) {
  const data = event.data;
  if (
    data?.source !== MERMAID_MESSAGE_SOURCE ||
    data.channel !== channel ||
    data.type !== "render" ||
    !Number.isSafeInteger(data.id) ||
    typeof data.text !== "string" ||
    data.text.length > MAX_MERMAID_SOURCE ||
    (data.theme !== "dark" && data.theme !== "light") ||
    busy
  )
    return;
  busy = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // Diagram frontmatter/directives must not override host restrictions.
      secure: [...Object.keys(mermaid.mermaidAPI.defaultConfig), "secure"],
      theme: data.theme === "dark" ? "dark" : "default",
      themeVariables: data.theme === "dark" ? darkDiagramColors : {},
      fontFamily: "Arial, sans-serif",
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      maxTextSize: MAX_MERMAID_SOURCE,
      maxEdges: 500,
      suppressErrorRendering: true,
    });
    const { svg } = await mermaid.render(
      `zmd-mermaid-${data.id}`,
      data.text,
      container,
    );
    if (svg.length > MAX_MERMAID_SVG) throw new Error("Diagram too large");
    // Images provide an additional inert SVG boundary in every viewing surface.
    // Remove URL-bearing content before returning it, including in exports.
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = parsed.documentElement;
    if (root.localName !== "svg" || parsed.querySelector("parsererror"))
      throw new Error("Invalid SVG");
    // Mermaid's SVG-only circle labels are positioned at x=0, but mind maps
    // omit their text anchor. Labels already shifted by half their width (for
    // rectangular nodes) and explicitly aligned labels must stay unchanged.
    for (const label of root.querySelectorAll(".node > .label")) {
      if (
        !/^translate\(\s*0(?:\s*,|\s+)/.test(
          label.getAttribute("transform") || "",
        )
      )
        continue;
      for (const text of label.querySelectorAll("text:not([text-anchor])"))
        text.setAttribute("text-anchor", "middle");
    }
    for (const node of root.querySelectorAll(
      "script, foreignObject, iframe, object, embed, image, a, animate, set",
    )) {
      if (node.localName === "a")
        node.replaceWith(...Array.from(node.childNodes));
      else node.remove();
    }
    for (const node of [root, ...root.querySelectorAll("*")]) {
      for (const attr of Array.from(node.attributes)) {
        if (
          /^on/i.test(attr.name) ||
          (/href$/i.test(attr.name) && !attr.value.startsWith("#"))
        )
          node.removeAttributeNode(attr);
        else if (/@import|url\s*\(/i.test(attr.value))
          attr.value = localURLsOnly(attr.value);
      }
      if (node.localName === "style") {
        node.textContent = localURLsOnly(node.textContent || "");
      }
    }
    // Mermaid uses width:100% + max-width; exported images need intrinsic size.
    const box = root
      .getAttribute("viewBox")
      ?.split(/[\s,]+/)
      .map(Number);
    if (
      box?.length === 4 &&
      box.every(Number.isFinite) &&
      box[2] > 0 &&
      box[3] > 0
    ) {
      root.setAttribute("width", String(box[2]));
      root.setAttribute("height", String(box[3]));
    }
    send({
      type: "result",
      id: data.id,
      svg: new XMLSerializer().serializeToString(root),
    });
  } catch {
    send({ type: "result", id: data.id, error: true });
  } finally {
    container.remove();
    busy = false;
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  if (
    port ||
    // Gecko hides the sender of privileged chrome messages (source = null).
    (event.source !== parent &&
      !(event.source === null && location.protocol === "chrome:")) ||
    event.data?.source !== MERMAID_MESSAGE_SOURCE ||
    event.data.channel !== channel ||
    event.data.type !== "connect" ||
    !event.ports[0]
  )
    return;
  port = event.ports[0];
  port.onmessage = (event) => render(event as MessageEvent);
  port.start();
  send({ type: "ready" });
});
