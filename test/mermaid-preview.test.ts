import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Window } from "happy-dom";
import { renderMarkdownCore } from "../src/modules/markdown/preview-render-core.ts";
import {
  disposePreviewMermaid,
  hydratePreviewImages,
  mountPreviewHtml,
} from "../src/modules/markdown/preview.ts";
import {
  buildExportHtml,
  openPrintableDocument,
} from "../src/modules/markdown/export-document.ts";
import type { renderMermaid } from "../src/modules/markdown/mermaid.ts";
import type { mountMermaidBlock } from "../src/modules/markdown/mermaid-view.ts";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><text x="10" y="30">A → B</text></svg>';
const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function dom(context: TestContext) {
  const window = new Window({ url: "https://preview.test/" });
  context.after(() => window.happyDOM.close());
  return {
    window,
    document: window.document as unknown as Document,
    parse: (html: string) => {
      const root = window.document.createElement("div");
      root.innerHTML = html;
      return root;
    },
  };
}

test("worker-safe Mermaid fences preserve escaped source without executing HTML or Markdown", (t) => {
  const { parse } = dom(t);
  const source =
    'flowchart LR\nA["<script>alert(1)</script> & [[Paper]]"] --> B\n';
  for (const fence of [
    `\`\`\`mermaid\n${source}\`\`\``,
    `~~~MERMAID\n${source}~~~`,
    `> \`\`\`mermaid\n> ${source.replaceAll("\n", "\n> ")}\`\`\``,
  ]) {
    const output = parse(renderMarkdownCore(fence));
    const block = output.querySelector("[data-zmd-mermaid]");
    assert.ok(block);
    assert.equal(block.querySelector("code")?.textContent, source);
    assert.equal(
      block.querySelectorAll("script, img, a, [data-zmd-wikilink]").length,
      0,
    );
  }
});

test("inline, indented and nested fence examples are not promoted to diagrams, while math and highlighted code still render", (t) => {
  const { parse } = dom(t);
  const html = renderMarkdownCore(
    [
      "`mermaid`",
      "",
      "    ```mermaid",
      "    flowchart LR",
      "    A --> B",
      "    ```",
      "",
      "````md",
      "```mermaid",
      "A --> B",
      "```",
      "````",
      "",
      "```js",
      "const answer = 42;",
      "```",
      "",
      "```math",
      "x^2",
      "```",
    ].join("\n"),
  );
  const output = parse(html);
  assert.equal(output.querySelectorAll("[data-zmd-mermaid]").length, 0);
  assert.ok(output.querySelector(".hljs-keyword"));
  assert.ok(output.querySelector("math"));
});

test("Mermaid fence metadata stays ordinary code, matching live preview", (t) => {
  const { parse } = dom(t);
  const output = parse(
    renderMarkdownCore('```mermaid title="demo"\nflowchart LR\nA --> B\n```'),
  );
  assert.equal(output.querySelectorAll("[data-zmd-mermaid]").length, 0);
  assert.equal(
    output.querySelector("pre > code")?.textContent,
    "flowchart LR\nA --> B\n",
  );
});

test("HTML/PDF export awaits diagrams and embeds static themed images without scripts", async (t) => {
  const { document, parse } = dom(t);
  let resolveDiagram!: () => void;
  const waiting = new Promise<void>((resolve) => {
    resolveDiagram = resolve;
  });
  const calls: Array<{ source: string; document: Document; theme: string }> =
    [];
  const renderDiagram: typeof renderMermaid = async (source, options) => {
    calls.push({ source, document: options.document, theme: options.theme });
    await waiting;
    return { svg, dataUrl };
  };
  let completed = false;
  const pending = buildExportHtml(
    {
      source:
        "# Diagram\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n```mermaid\nmindmap\n  root((Notes))\n```",
      document,
      theme: "dark",
    },
    { renderDiagram },
  );
  void pending.then(() => {
    completed = true;
  });
  await delay(0);
  assert.equal(completed, false);
  assert.equal(calls[0].source, "flowchart LR\nA --> B\n");
  resolveDiagram();
  const html = await pending;
  const result = parse(html);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((call) => call.document === document && call.theme === "dark"),
  );
  assert.equal(result.querySelectorAll("[data-zmd-mermaid] img").length, 2);
  for (const image of result.querySelectorAll("[data-zmd-mermaid] img")) {
    assert.equal(image.getAttribute("src"), dataUrl);
    assert.ok(image.getAttribute("alt"));
  }
  assert.equal(
    result.querySelectorAll("script, [data-zmd-mermaid] code").length,
    0,
  );
});

test("a broken diagram preserves its source and reports a local error without losing other export content", async (t) => {
  const { document, parse } = dom(t);
  const invalid = 'not-a-diagram <script>alert("bad")</script>\n';
  const html = await buildExportHtml(
    {
      source: `# Still readable\n\n\`\`\`mermaid\n${invalid}\`\`\`\n\nAfter the diagram.\n\n\`\`\`mermaid\nflowchart LR\nA --> B\n\`\`\``,
      document,
    },
    {
      renderDiagram: async (source) => {
        if (source === invalid) throw new Error("Synthetic syntax error");
        return { svg, dataUrl };
      },
    },
  );
  const output = parse(html);
  assert.equal(output.querySelector("h1")?.textContent, "Still readable");
  assert.equal(
    output.querySelector("[data-zmd-mermaid] code")?.textContent,
    invalid,
  );
  assert.equal(output.querySelectorAll(".zmd-mermaid-error").length, 1);
  assert.equal(output.querySelectorAll("[data-zmd-mermaid] img").length, 1);
  assert.equal(output.querySelectorAll("script").length, 0);
  assert.match(output.textContent, /After the diagram/);
});

test("ordinary exports require neither a document nor Mermaid initialization", async () => {
  const html = await buildExportHtml(
    { source: "# Plain note\n\nNo diagrams." },
    {
      renderDiagram: async () => {
        throw new Error("Mermaid must stay unloaded");
      },
    },
  );
  assert.match(html, /<h1>Plain note<\/h1>/);
});

test("preview remount, theme change and disposal release old diagrams while preserving their source", async (t) => {
  const { document } = dom(t);
  const root = document.createElement("div");
  root.className = "zotero-markdown-root theme-dark";
  const host = document.createElement("div");
  root.append(host);
  document.body.append(root);
  const calls: Array<{ source: string; theme: string; disposed: boolean }> = [];
  const mountDiagram: typeof mountMermaidBlock = (
    container,
    source,
    options,
  ) => {
    const call = { source, theme: options.theme, disposed: false };
    calls.push(call);
    container.replaceChildren(document.createElement("img"));
    return () => {
      call.disposed = true;
    };
  };
  const rendered = {
    title: "Test",
    bodyHtml: renderMarkdownCore("```mermaid\nflowchart LR\nA --> B\n```"),
  };
  mountPreviewHtml(host, rendered, [], { mountDiagram });
  assert.equal(calls[0].theme, "dark");
  root.classList.remove("theme-dark");
  await delay(0);
  assert.equal(calls[0].disposed, true);
  assert.equal(calls[1].theme, "light");
  assert.equal(calls[1].source, "flowchart LR\nA --> B\n");
  mountPreviewHtml(host, rendered, [], { mountDiagram });
  assert.equal(calls[1].disposed, true);
  assert.equal(calls[2].disposed, false);
  disposePreviewMermaid(host);
  assert.equal(calls[2].disposed, true);
  root.classList.add("theme-dark");
  await delay(0);
  assert.equal(
    calls.length,
    3,
    "disposed previews must stop observing theme changes",
  );
});

test("attachment hydration keeps generated diagram images while hydrating actual attachments", (t) => {
  const { parse } = dom(t);
  const output = parse(
    `<div data-zmd-mermaid=""><img src="${dataUrl}"></div><img src="assets/figure.png">`,
  );
  hydratePreviewImages(output as unknown as HTMLElement, {
    "assets/figure.png": { dataUrl: "data:image/png;base64,example" },
  });
  const images = [...output.querySelectorAll("img")];
  assert.equal(images.length, 2);
  assert.equal(images[0].getAttribute("src"), dataUrl);
  assert.equal(images[1].getAttribute("src"), "data:image/png;base64,example");
  assert.equal(output.querySelector(".zotero-markdown-image-missing"), null);
});

test("printing waits for image decoding instead of omitting pending diagram images", async (t) => {
  const { window, document } = dom(t);
  let printed = 0;
  const pendingTimers: Array<() => unknown> = [];
  Object.defineProperty(window, "focus", { value: () => {} });
  Object.defineProperty(window, "print", {
    value: () => {
      printed++;
    },
  });
  Object.defineProperty(window, "setTimeout", {
    value: (callback: () => unknown) => {
      pendingTimers.push(callback);
      return pendingTimers.length;
    },
  });
  Object.defineProperty(window, "clearTimeout", { value: () => {} });
  const host = { open: () => window } as unknown as globalThis.Window;
  assert.equal(openPrintableDocument(host, `<img src="${dataUrl}">`), true);
  const image = document.querySelector("img")!;
  Object.defineProperty(image, "complete", { value: false });
  const printing = pendingTimers[0]();
  assert.equal(printed, 0);
  image.dispatchEvent(new window.Event("load") as unknown as Event);
  await printing;
  assert.equal(printed, 1);
});
