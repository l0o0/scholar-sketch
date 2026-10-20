import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { MermaidRenderer } from "../src/modules/markdown/mermaid.ts";
import { mountMermaidBlock } from "../src/modules/markdown/mermaid-view.ts";
import {
  MAX_MERMAID_SOURCE,
  MAX_MERMAID_SVG,
  MERMAID_MESSAGE_SOURCE,
} from "../src/modules/markdown/mermaid-protocol.ts";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>甲 → 乙</text></svg>';
const diagram = "flowchart LR\nA --> B";

interface RenderMessage {
  source: string;
  channel: string;
  type: string;
  id: number;
  text: string;
  theme: string;
}

class TestPort {
  peer?: TestPort;
  onmessage?: (event: { data: unknown }) => void;
  started = false;
  closed = false;

  start() {
    this.started = true;
  }

  close() {
    this.closed = true;
  }

  postMessage(data: unknown) {
    if (!this.closed && this.peer && !this.peer.closed)
      this.peer.onmessage?.({ data });
  }
}

function fixture(context: TestContext) {
  const window = new Window({
    url: "https://mermaid.test/",
    settings: { disableIframePageLoading: true },
  });
  const connections: Array<{ port1: TestPort; port2: TestPort }> = [];
  Object.assign(window, {
    MessageChannel: class {
      port1 = new TestPort();
      port2 = new TestPort();

      constructor() {
        this.port1.peer = this.port2;
        this.port2.peer = this.port1;
        connections.push(this);
      }
    },
  });
  const document = window.document as unknown as Document;
  const renderer = new MermaidRenderer(
    document,
    "https://mermaid.test/renderer.html",
  );
  const peers: Window[] = [];
  const disposers: Array<() => void> = [];
  context.after(async () => {
    for (const dispose of disposers) dispose();
    // Shared renderers created by mountMermaidBlock also own idle timers.
    window.dispatchEvent(new window.Event("pagehide"));
    renderer.dispose();
    for (const { port1, port2 } of connections) {
      port1.close();
      port2.close();
    }
    for (const peer of peers) await peer.happyDOM.close();
    await window.happyDOM.close();
  });
  const connect = (loadFromChildDocument = false) => {
    const iframe = document.querySelector("iframe")!;
    assert.ok(iframe, "rendering should create the lazy iframe");
    const peer = new Window({ url: "https://mermaid.test/peer/" });
    peers.push(peer);
    Object.defineProperty(iframe, "contentWindow", { value: peer });
    const posted: RenderMessage[] = [];
    const channel = new URL(iframe.src).hash.slice(1);
    let rendererPort: TestPort | undefined;
    peer.postMessage = ((
      data: RenderMessage,
      targetOrigin: string,
      ports: TestPort[],
    ) => {
      assert.equal(data.type, "connect");
      assert.equal(data.source, MERMAID_MESSAGE_SOURCE);
      assert.equal(data.channel, channel);
      assert.equal(targetOrigin, "*");
      assert.equal(ports.length, 1);
      rendererPort = ports[0];
      rendererPort.onmessage = (event) => {
        posted.push(event.data as RenderMessage);
      };
      rendererPort.start();
    }) as typeof peer.postMessage;
    if (loadFromChildDocument) {
      // Happy DOM keeps document trees separate; expose Gecko chrome's
      // cross-document event path without making the load event bubble.
      Object.defineProperty(peer.document, "parentNode", {
        configurable: true,
        value: iframe,
      });
      try {
        peer.document.dispatchEvent(new peer.Event("load"));
      } finally {
        Reflect.deleteProperty(peer.document, "parentNode");
      }
    } else {
      iframe.dispatchEvent(new window.Event("load"));
    }
    assert.ok(rendererPort, "load must transfer a private MessagePort");
    const connection = connections.at(-1)!;
    assert.equal(connection.port1.started, true);
    const send = (
      data: Record<string, unknown>,
      overrides: {
        channel?: string;
        protocolSource?: string;
      } = {},
    ) => {
      rendererPort!.postMessage({
        source: overrides.protocolSource ?? MERMAID_MESSAGE_SOURCE,
        channel: overrides.channel ?? channel,
        ...data,
      });
    };
    const sendWindow = (
      data: Record<string, unknown>,
      source: WindowProxy | null = null,
    ) => {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          source,
          data: {
            source: MERMAID_MESSAGE_SOURCE,
            channel,
            ...data,
          },
        }),
      );
    };
    const ready = () => send({ type: "ready" });
    const result = (
      id = posted.at(-1)!.id,
      payload: Record<string, unknown> = { svg },
    ) => send({ type: "result", id, ...payload });
    return {
      iframe,
      peer,
      connection,
      posted,
      send,
      sendWindow,
      ready,
      result,
    };
  };
  const container = () => {
    const element = document.createElement("div");
    document.body.append(element);
    return element;
  };
  return {
    window,
    document,
    renderer,
    connections,
    connect,
    container,
    disposers,
  };
}

test("Mermaid stays unloaded until valid content requests a render and waits for ready", async (t) => {
  const f = fixture(t);
  assert.equal(f.document.querySelector("iframe"), null);
  await assert.rejects(f.renderer.render(" \n", "light"), /empty/);
  await assert.rejects(
    f.renderer.render("x".repeat(MAX_MERMAID_SOURCE + 1), "light"),
    /too large/,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(f.renderer.render(diagram, "light", cancelled.signal), {
    name: "AbortError",
  });
  assert.equal(f.document.querySelector("iframe"), null);

  const pending = f.renderer.render(diagram, "light");
  const peer = f.connect();
  assert.equal(peer.iframe.getAttribute("sandbox"), "allow-scripts");
  assert.equal(peer.iframe.getAttribute("aria-hidden"), "true");
  assert.equal(peer.iframe.getAttribute("tabindex"), "-1");
  assert.equal(peer.posted.length, 0);
  peer.ready();
  assert.equal(peer.posted.length, 1);
  assert.equal(peer.posted[0].text, diagram);
  assert.equal(peer.posted[0].theme, "light");
  peer.result();
  const result = await pending;
  assert.equal(result.svg, svg);
  assert.equal(
    result.dataUrl,
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
});

test("ready and result messages require the private port, channel, protocol, and request ID", async (t) => {
  const f = fixture(t);
  const pending = f.renderer.render(diagram, "dark");
  const peer = f.connect();
  peer.sendWindow({ type: "ready" });
  peer.sendWindow({ type: "ready" }, peer.peer as unknown as WindowProxy);
  peer.send({ type: "ready" }, { channel: "other-document" });
  peer.send({ type: "ready" }, { protocolSource: "other-protocol" });
  assert.equal(peer.posted.length, 0);
  peer.ready();
  peer.ready();
  assert.equal(peer.posted.length, 1);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  const id = peer.posted[0].id;
  peer.result(id + 1);
  peer.sendWindow({ type: "result", id, svg });
  peer.send({ type: "result", id, svg }, { channel: "wrong-channel" });
  peer.send({ type: "result", id, svg }, { protocolSource: "wrong-protocol" });
  await Promise.resolve();
  assert.equal(settled, false);
  peer.result(id);
  assert.equal((await pending).svg, svg);
});

test("capturing a non-bubbling child-document load establishes exactly one renderer connection", async (t) => {
  const f = fixture(t);
  const pending = f.renderer.render(diagram, "light");
  let loadTarget: EventTarget | null = null;
  let bubbledLoads = 0;
  const frame = f.document.querySelector("iframe")!;
  frame.addEventListener(
    "load",
    (event) => {
      loadTarget = event.target;
      assert.equal(event.bubbles, false);
    },
    true,
  );
  frame.addEventListener("load", () => bubbledLoads++);
  const peer = f.connect(true);
  assert.ok(loadTarget === peer.peer.document);
  assert.equal(bubbledLoads, 0);
  assert.equal(f.connections.length, 1);
  peer.ready();
  frame.dispatchEvent(new f.window.Event("load"));
  assert.equal(f.connections.length, 1, "later load must not replace the port");
  assert.equal(peer.connection.port1.closed, false);
  peer.result();
  assert.equal((await pending).svg, svg);
  f.renderer.dispose();
  assert.equal(peer.connection.port1.closed, true);
  assert.equal(f.document.querySelector("iframe"), null);
});

test("identical queued diagrams share one rendered result while themes keep separate caches", async (t) => {
  const f = fixture(t);
  const first = f.renderer.render(diagram, "light");
  const duplicate = f.renderer.render(diagram, "light");
  const dark = f.renderer.render(diagram, "dark");
  const another = f.renderer.render("sequenceDiagram\nA->>B: hello", "light");
  const peer = f.connect();
  peer.ready();
  assert.equal(peer.posted.length, 1);
  peer.result();
  const firstResult = await first;
  assert.equal(await duplicate, firstResult);
  assert.equal(peer.posted.length, 2);
  assert.equal(peer.posted[1].theme, "dark");
  peer.result();
  const darkResult = await dark;
  assert.notEqual(darkResult, firstResult);
  assert.equal(peer.posted.length, 3);
  assert.match(peer.posted[2].text, /^sequenceDiagram/);
  peer.result();
  await another;
  assert.equal(await f.renderer.render(diagram, "light"), firstResult);
  assert.equal(await f.renderer.render(diagram, "dark"), darkResult);
  assert.equal(peer.posted.length, 3);
});

test("invalid SVG results fail locally and allow the next queued diagram to render", async (t) => {
  const f = fixture(t);
  let peer: ReturnType<typeof f.connect> | undefined;
  const failures = [
    { error: true },
    { svg: "<html>not SVG</html>" },
    { svg: `<svg>${"x".repeat(MAX_MERMAID_SVG)}</svg>` },
  ];
  for (const [index, invalid] of failures.entries()) {
    const first = f.renderer.render(`bad ${index}`, "light");
    const rejected = assert.rejects(first, /could not be rendered/);
    const next = f.renderer.render(`valid ${index}`, "light");
    // Connect only once; replacing a peer while work is queued would itself
    // simulate a document navigation rather than a renderer error.
    peer ??= f.connect();
    peer.ready();
    peer.result(undefined, invalid);
    await rejected;
    assert.match(peer.posted.at(-1)!.text, /^valid/);
    peer.result();
    assert.equal((await next).svg, svg);
  }
});

test("cancelling queued and active requests never blocks subsequent rendering", async (t) => {
  const f = fixture(t);
  const activeAbort = new AbortController();
  const queuedAbort = new AbortController();
  const first = f.renderer.render(diagram, "light", activeAbort.signal);
  const queued = f.renderer.render(
    "flowchart LR\nB --> C",
    "light",
    queuedAbort.signal,
  );
  const next = f.renderer.render("flowchart LR\nC --> D", "light");
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const queuedRejected = assert.rejects(queued, { name: "AbortError" });
  const peer = f.connect();
  peer.ready();
  queuedAbort.abort();
  activeAbort.abort();
  await Promise.all([firstRejected, queuedRejected]);
  assert.equal(peer.posted.length, 1);
  // The active isolated layout finishes, but the removed consumer is not updated.
  peer.result();
  assert.equal(peer.posted.length, 2);
  assert.equal(peer.posted[1].text, "flowchart LR\nC --> D");
  peer.result();
  await next;
});

test("disposing rejects active and queued work, removes the iframe, and prevents recreation", async (t) => {
  const f = fixture(t);
  const active = f.renderer.render(diagram, "light");
  const queued = f.renderer.render(diagram, "dark");
  const errors = Promise.all([
    assert.rejects(active, /closed/),
    assert.rejects(queued, /closed/),
  ]);
  const peer = f.connect();
  peer.ready();
  f.renderer.dispose();
  await errors;
  assert.equal(f.document.querySelector("iframe"), null);
  assert.equal(peer.connection.port1.closed, true);
  peer.result();
  await assert.rejects(f.renderer.render(diagram, "light"), /closed/);
  assert.equal(f.document.querySelector("iframe"), null);
});

for (const owner of ["document", "window"] as const) {
  test(`child frame pagehide preserves rendering and the later owner ${owner} pagehide still disposes it`, async (t) => {
    const f = fixture(t);
    const first = f.renderer.render(diagram, "light");
    const peer = f.connect();
    let childEventsAtOwner = 0;
    f.window.addEventListener("pagehide", (event) => {
      if (event.target === peer.iframe) childEventsAtOwner++;
    });

    // Gecko chrome windows receive child pagehide during iframe navigation.
    // Bubble from the child element to reproduce its distinct event target.
    peer.iframe.dispatchEvent(
      new f.window.Event("pagehide", { bubbles: true }),
    );
    assert.equal(childEventsAtOwner, 1);
    assert.equal(f.document.querySelector("iframe"), peer.iframe);
    peer.ready();
    assert.equal(peer.posted.length, 1);
    peer.iframe.dispatchEvent(
      new f.window.Event("pagehide", { bubbles: true }),
    );
    assert.equal(childEventsAtOwner, 2);
    peer.result();
    assert.equal((await first).svg, svg);

    const active = f.renderer.render(diagram, "dark");
    const queued = f.renderer.render("flowchart LR\nB --> C", "light");
    const rejected = Promise.all([
      assert.rejects(active, /closed/),
      assert.rejects(queued, /closed/),
    ]);
    const target = owner === "document" ? f.document : f.window;
    target.dispatchEvent(new f.window.Event("pagehide", { bubbles: true }));
    assert.equal(f.document.querySelector("iframe"), null);
    await rejected;
    await assert.rejects(f.renderer.render(diagram, "light"), /closed/);
  });
}

test("queue bounds reject excess work without discarding existing requests", async (t) => {
  const f = fixture(t);
  const pending = Array.from({ length: 64 }, (_, i) =>
    f.renderer.render(`flowchart LR\nA --> B${i}`, "light"),
  );
  const errors = pending.map((result) => assert.rejects(result, /closed/));
  await assert.rejects(
    f.renderer.render("flowchart LR\nA --> overflow", "light"),
    /Too many pending/,
  );
  f.renderer.dispose();
  await Promise.all(errors);
});

test("renderer load timeout releases queued work and allows a fresh frame on retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  const pending = f.renderer.render(diagram, "light");
  const rejected = assert.rejects(pending, /could not be loaded/);
  const oldFrame = f.document.querySelector("iframe");
  t.mock.timers.tick(20_000);
  await rejected;
  assert.equal(f.document.querySelector("iframe"), null);
  const retry = f.renderer.render(diagram, "light");
  const peer = f.connect();
  assert.notEqual(peer.iframe, oldFrame);
  peer.ready();
  peer.result();
  assert.equal((await retry).svg, svg);
});

for (const failureAt of ["channel creation", "port transfer"] as const) {
  test(`a synchronous ${failureAt} error rejects pending rendering immediately and permits retry`, async (t) => {
    const f = fixture(t);
    const originalChannel = f.window.MessageChannel;
    const error = new Error(`Synthetic ${failureAt} failure`);
    if (failureAt === "channel creation") {
      Object.assign(f.window, {
        MessageChannel: class {
          constructor() {
            throw error;
          }
        },
      });
    }
    const active = f.renderer.render(diagram, "light");
    const queued = f.renderer.render(diagram, "dark");
    const rejected = Promise.all([
      assert.rejects(active, error),
      assert.rejects(queued, error),
    ]);
    const frame = f.document.querySelector("iframe")!;
    Object.defineProperty(frame, "contentWindow", {
      value: {
        postMessage() {
          throw error;
        },
      },
    });
    frame.dispatchEvent(new f.window.Event("load"));
    assert.equal(f.document.querySelector("iframe"), null);
    await rejected;
    if (failureAt === "port transfer") {
      assert.equal(f.connections.at(-1)?.port1.closed, true);
      assert.equal(f.connections.at(-1)?.port2.closed, true);
    }

    Object.assign(f.window, { MessageChannel: originalChannel });
    const retry = f.renderer.render(diagram, "light");
    const peer = f.connect();
    peer.ready();
    peer.result();
    assert.equal((await retry).svg, svg);
  });
}

test("idle renderer is removed while recently rendered diagrams remain cached", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  const pending = f.renderer.render(diagram, "light");
  const peer = f.connect();
  peer.ready();
  peer.result();
  const rendered = await pending;
  t.mock.timers.tick(30_000);
  assert.equal(f.document.querySelector("iframe"), null);
  assert.equal(peer.connection.port1.closed, true);
  assert.equal(await f.renderer.render(diagram, "light"), rendered);
  assert.equal(f.document.querySelector("iframe"), null);
});

test("diagram view starts only near the viewport and replaces its loading state with an inert image", async (t) => {
  const f = fixture(t);
  let intersect!: (visible: boolean) => void;
  let disconnected = 0;
  let observed: Element | undefined;
  Object.assign(f.window, {
    IntersectionObserver: class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = (visible) =>
          callback(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe(element: Element) {
        observed = element;
      }
      disconnect() {
        disconnected++;
      }
    },
  });
  const element = f.container();
  let layouts = 0;
  f.disposers.push(
    mountMermaidBlock(element, diagram, {
      theme: "dark",
      onLayout: () => layouts++,
    }),
  );
  assert.equal(observed, element);
  assert.match(element.textContent ?? "", /Rendering/);
  assert.equal(f.document.querySelector("iframe"), null);
  intersect(false);
  assert.equal(f.document.querySelector("iframe"), null);
  intersect(true);
  assert.equal(disconnected, 1);
  const peer = f.connect();
  peer.ready();
  intersect(true);
  assert.equal(peer.posted.length, 1);
  assert.equal(peer.posted[0].theme, "dark");
  peer.result();
  await Promise.resolve();
  const image = element.querySelector("img")!;
  assert.ok(image);
  assert.equal(
    image.src,
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
  assert.equal(element.querySelector("svg"), null);
  assert.equal(element.querySelector('[role="status"]'), null);
  // Happy DOM can load a data URL before the promise continuation runs.
  assert.ok(layouts >= 1);
  image.dispatchEvent(new f.window.Event("load"));
  assert.equal(layouts, 2);
});

test("diagram errors retain literal source, and edit activation supports mouse and keyboard", async (t) => {
  const f = fixture(t);
  Object.assign(f.window, { IntersectionObserver: undefined });
  const element = f.container();
  const source = '<script>alert("unsafe")</script>\nnot a diagram';
  let edits = 0;
  const dispose = mountMermaidBlock(element, source, {
    theme: "light",
    labels: { loading: "正在绘制", error: "无法绘制", edit: "编辑源码" },
    onEdit: () => edits++,
  });
  f.disposers.push(dispose);
  assert.equal(element.getAttribute("role"), "button");
  assert.equal(element.getAttribute("aria-label"), "编辑源码");
  assert.equal(element.tabIndex, 0);
  const peer = f.connect();
  peer.ready();
  peer.result(undefined, { error: true });
  await Promise.resolve();
  assert.equal(element.querySelector("code")?.textContent, source);
  assert.equal(element.querySelector("script"), null);
  assert.equal(
    element.querySelector('[role="status"]')?.textContent,
    "无法绘制",
  );
  assert.equal(element.classList.contains("is-error"), true);

  element.dispatchEvent(new f.window.MouseEvent("mousedown", { button: 2 }));
  element.dispatchEvent(
    new f.window.KeyboardEvent("keydown", { key: "Escape" }),
  );
  assert.equal(edits, 0);
  element.dispatchEvent(new f.window.MouseEvent("mousedown", { button: 0 }));
  element.dispatchEvent(
    new f.window.KeyboardEvent("keydown", { key: "Enter" }),
  );
  element.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: " " }));
  assert.equal(edits, 3);
  dispose();
  element.dispatchEvent(
    new f.window.KeyboardEvent("keydown", { key: "Enter" }),
  );
  assert.equal(edits, 3);
});

test("disposing a diagram view prevents late results and layout callbacks from mutating it", async (t) => {
  const f = fixture(t);
  Object.assign(f.window, { IntersectionObserver: undefined });
  const element = f.container();
  let layouts = 0;
  const dispose = mountMermaidBlock(element, diagram, {
    theme: "light",
    onLayout: () => layouts++,
  });
  f.disposers.push(dispose);
  const peer = f.connect();
  peer.ready();
  dispose();
  const before = element.innerHTML;
  peer.result();
  await Promise.resolve();
  assert.equal(element.innerHTML, before);
  assert.equal(element.querySelector("img"), null);
  assert.equal(layouts, 0);
});
