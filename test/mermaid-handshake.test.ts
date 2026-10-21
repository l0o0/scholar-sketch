import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import ts from "typescript";
import * as protocol from "../src/modules/markdown/mermaid-protocol.ts";

// Execute the production listener, replacing only its imported renderer.
// Handshake tests must not need to initialize Mermaid's layout engine.
const bootstrap = ts.transpileModule(
  readFileSync(new URL("../src/mermaid/bootstrap.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function port() {
  return {
    started: false,
    onmessage: undefined as
      ((event: { data: Record<string, unknown> }) => Promise<void>) | undefined,
    messages: [] as Array<Record<string, unknown>>,
    start() {
      this.started = true;
    },
    postMessage(message: Record<string, unknown>) {
      this.messages.push(message);
    },
  };
}

function fixture(
  scheme: "chrome:" | "https:",
  rendering?: { window: Window; svg: string },
) {
  const parent = {};
  let listener:
    | ((event: {
        source: object | null;
        data: Record<string, unknown>;
        ports: ReturnType<typeof port>[];
      }) => void)
    | undefined;
  runInNewContext(bootstrap, {
    exports: {},
    require(name: string) {
      if (name === "mermaid")
        return {
          __esModule: true,
          default: rendering
            ? {
                mermaidAPI: {
                  defaultConfig: { securityLevel: "strict", maxEdges: 500 },
                },
                initialize() {},
                async render() {
                  return { svg: rendering.svg };
                },
              }
            : {},
        };
      if (name.endsWith("/mermaid-protocol")) return protocol;
      throw new Error(`Unexpected bootstrap import: ${name}`);
    },
    location: { hash: "#document-channel", protocol: scheme },
    document: rendering?.window.document,
    DOMParser: rendering?.window.DOMParser,
    XMLSerializer: rendering?.window.XMLSerializer,
    parent,
    window: {
      addEventListener(type: string, callback: typeof listener) {
        assert.equal(type, "message");
        listener = callback;
      },
    },
  });
  assert.ok(listener);
  const connect = (
    receiver: ReturnType<typeof port> | undefined,
    options: {
      source?: object | null;
      data?: Record<string, unknown>;
    } = {},
  ) => {
    listener!({
      source: Object.hasOwn(options, "source") ? options.source! : parent,
      data: {
        source: protocol.MERMAID_MESSAGE_SOURCE,
        channel: "document-channel",
        type: "connect",
        ...options.data,
      },
      ports: receiver ? [receiver] : [],
    });
  };
  return { parent, connect };
}

async function renderSVG(window: Window, svg: string) {
  const f = fixture("chrome:", { window, svg });
  const receiver = port();
  f.connect(receiver, { source: null });
  await receiver.onmessage!({
    data: {
      source: protocol.MERMAID_MESSAGE_SOURCE,
      channel: "document-channel",
      type: "render",
      id: 1,
      text: "flowchart LR\nA((Paper)) --> B[Notes]",
      theme: "light",
    },
  });
  const result = receiver.messages.at(-1)!;
  assert.equal(result.type, "result");
  assert.equal(result.id, 1);
  assert.equal(typeof result.svg, "string");
  assert.equal(window.document.body.childElementCount, 0);
  return new window.DOMParser().parseFromString(
    result.svg as string,
    "image/svg+xml",
  ).documentElement;
}

test("chrome renderer accepts Gecko's null-source handshake and replies through its private port", () => {
  const f = fixture("chrome:");
  const receiver = port();
  f.connect(receiver, { source: null });
  assert.equal(receiver.started, true);
  assert.equal(typeof receiver.onmessage, "function");
  assert.equal(receiver.messages.length, 1);
  assert.equal(receiver.messages[0].type, "ready");
  assert.equal(receiver.messages[0].channel, "document-channel");
  assert.equal(receiver.messages[0].source, protocol.MERMAID_MESSAGE_SOURCE);
});

test("web renderer rejects null-source handshakes while accepting the embedding parent", () => {
  const f = fixture("https:");
  const rejected = port();
  f.connect(rejected, { source: null });
  assert.equal(rejected.started, false);
  assert.equal(rejected.messages.length, 0);
  const accepted = port();
  f.connect(accepted);
  assert.equal(accepted.started, true);
  assert.equal(accepted.messages[0].type, "ready");
});

test("chrome handshake still rejects other windows, wrong channels, malformed protocols, and missing ports", () => {
  const f = fixture("chrome:");
  for (const options of [
    { source: {} },
    { source: null, data: { channel: "another-document" } },
    { source: null, data: { source: "another-protocol" } },
    { source: null, data: { type: "render" } },
  ]) {
    const receiver = port();
    f.connect(receiver, options);
    assert.equal(receiver.started, false);
    assert.equal(receiver.messages.length, 0);
  }
  f.connect(undefined, { source: null });
  const accepted = port();
  f.connect(accepted, { source: null });
  assert.equal(accepted.started, true);
});

test("a successful handshake cannot be replaced by another transferred port", () => {
  const f = fixture("chrome:");
  const original = port();
  f.connect(original, { source: null });
  const replacement = port();
  f.connect(replacement, { source: null });
  f.connect(replacement);
  assert.equal(original.messages.length, 1);
  assert.equal(original.started, true);
  assert.equal(replacement.started, false);
  assert.equal(replacement.messages.length, 0);
  assert.equal(replacement.onmessage, undefined);
});

test("rendered circular-node labels with no horizontal offset are anchored at their center", async (t) => {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const output = await renderSVG(
    window,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
      <g class="node" transform="translate(60,40)">
        <circle cx="0" cy="0" r="30"/>
        <g class="label" transform="translate(0,-9)">
          <text y="-9"><tspan class="text-outer-tspan" x="0" dy="1.1em"><tspan class="text-inner-tspan">论文</tspan></tspan></text>
        </g>
      </g>
    </svg>`,
  );
  assert.equal(output.querySelector(".label text")?.textContent, "论文");
  assert.equal(
    output.querySelector(".label text")?.getAttribute("text-anchor"),
    "middle",
  );
  assert.equal(
    output.querySelector(".label")?.getAttribute("transform"),
    "translate(0,-9)",
  );
});

test("rendering preserves labels already shifted by half their width and explicit text anchors", async (t) => {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const output = await renderSVG(
    window,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 80">
      <g class="node" id="rectangle" transform="translate(60,40)">
        <rect x="-40" y="-25" width="80" height="50"/>
        <g class="label" transform="translate(-28,-9)"><text>Notes</text></g>
      </g>
      <g class="node" id="explicit" transform="translate(170,40)">
        <circle cx="0" cy="0" r="30"/>
        <g class="label" transform="translate(0,-9)"><text text-anchor="end">End</text></g>
      </g>
    </svg>`,
  );
  assert.equal(
    output.querySelector("#rectangle .label")?.getAttribute("transform"),
    "translate(-28,-9)",
  );
  assert.equal(
    output.querySelector("#rectangle text")?.hasAttribute("text-anchor"),
    false,
  );
  assert.equal(
    output.querySelector("#explicit text")?.getAttribute("text-anchor"),
    "end",
  );
});

test("rendering removes SVG external content and handlers while retaining local marker references and link labels", async (t) => {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const output = await renderSVG(
    window,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 90" onload="alert(1)">
      <style>@import "https://example.test/external.css"; .remote {fill:url("https://example.test/fill.svg")} .local {marker-end:url("#arrow")}</style>
      <defs><marker id="arrow"><path d="M0 0 L5 5"/></marker></defs>
      <script>alert(1)</script>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Embedded HTML</div></foreignObject>
      <image href="https://example.test/image.svg"/>
      <a href="https://example.test/"><text>Keep this label</text></a>
      <path id="edge" d="M0 0 L50 0" marker-end="url('#arrow')" onmouseover="alert(2)"/>
      <use id="local" href="#arrow"/>
      <use id="remote" href="https://example.test/shape.svg#shape"/>
    </svg>`,
  );
  assert.equal(
    output.querySelectorAll("script, foreignObject, image, a").length,
    0,
  );
  assert.equal(output.hasAttribute("onload"), false);
  assert.equal(
    output.querySelector("#edge")?.hasAttribute("onmouseover"),
    false,
  );
  assert.equal(output.querySelector("text")?.textContent, "Keep this label");
  assert.equal(output.querySelector("#remote")?.hasAttribute("href"), false);
  assert.equal(output.querySelector("#local")?.getAttribute("href"), "#arrow");
  assert.equal(
    output.querySelector("#edge")?.getAttribute("marker-end"),
    "url('#arrow')",
  );
  const styles = output.querySelector("style")?.textContent ?? "";
  assert.doesNotMatch(styles, /https:|@import/);
  assert.match(styles, /url\("#arrow"\)/);
  assert.equal(output.getAttribute("width"), "180");
  assert.equal(output.getAttribute("height"), "90");
});
