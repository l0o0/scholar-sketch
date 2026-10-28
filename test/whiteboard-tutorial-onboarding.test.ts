import assert from "node:assert/strict";
import test from "node:test";
import type {
  TutorialCanvasLabels,
  TutorialCanvasSample,
} from "../packages/whiteboard/src/model/tutorial.ts";
import {
  ensureTutorialWhiteboard,
  createExampleWhiteboard,
  type TutorialOnboardingDependencies,
} from "../src/modules/whiteboard/tutorial.ts";

const labels: TutorialCanvasLabels = {
  title: "Scholar Sketch Tutorial.canvas",
  welcome: "Welcome",
  welcomeBody: "Learn Scholar Sketch",
  quickStart: "Quick controls",
  quickStartBody: "Hold Space and drag to pan.",
  sourceNotice: "Your sources stay unchanged",
  addLiterature: "Add literature",
  addLiteratureBody: "Drag an item here",
  browseQuotes: "Browse quotes",
  browseQuotesBody: "Add useful evidence",
  writeNote: "Write a note",
  writeNoteBody: "Develop a thought",
  questionBadge: "Question",
  claimBadge: "Viewpoint",
  organize: "Organize",
  organizeBody: "Group related ideas",
  practice: "Practice",
  practiceBody: "Try it here",
  supports: "Supports",
  exampleSource: "Your first source",
  exampleSourceBody:
    "Drag a paper from your library here. Its title and source stay together, so you can always return to the original.",
  exampleQuote: "Make room for evidence",
  exampleQuoteBody:
    "Add an excerpt that matters to your question. Keep the original words, then write your interpretation in a separate note. Connect the two to make your reasoning visible.",
  imageTitle: "Images & PDF snapshots",
  imageBody: "Keep a visual beside your ideas.",
  attachmentTitle: "Reading notes.md",
  attachmentBody: "Right-click to open the Markdown attachment.",
  attachmentContent:
    "## Reading notes\n\n- Collect evidence\n- Ask a question\n- Write a viewpoint",
  colorNote: "Capture a reading note.",
  colorEvidence: "Keep a useful passage and its source.",
  colorSummary: "Bring together agreements and differences.",
  organizeAction: "Arrange and personalize",
  colorQuestion: "What remains uncertain?",
  colorClaim: "Connect evidence to your own interpretation.",
  colorBody: "Select a card to change its fill, border, and text colors.",
  share: "Share your thinking",
  shareBody:
    "Right-click the canvas to export PNG. Choose 2× or 4× for a crisp image of the whole board.",
};

const attachment = { id: 7 } as Zotero.Item;

function dependencies(
  overrides: Partial<TutorialOnboardingDependencies> = {},
): TutorialOnboardingDependencies {
  return {
    completed: () => false,
    markCompleted: () => {},
    labels: () => labels,
    selectSample: async () => undefined,
    create: async () => ({ canvas: attachment, created: true }),
    open: async () => true,
    log: () => {},
    ...overrides,
  };
}

test("creates, marks, and opens the tutorial in lifecycle order", async () => {
  const events: string[] = [];
  let filename = "";
  const deps = dependencies({
    selectSample: async () => {
      events.push("select");
      return undefined;
    },
    create: async (document, value) => {
      events.push("create");
      filename = value;
      assert.ok(document.nodes.length > 0);
      return { canvas: attachment, created: true };
    },
    markCompleted: () => events.push("mark"),
    open: async () => events.push("open"),
  });

  await ensureTutorialWhiteboard(deps);

  assert.deepEqual(events, ["select", "create", "mark", "open"]);
  assert.equal(filename, labels.title);
});

test("an existing completion marker skips tutorial work", async () => {
  let selectCalls = 0;
  let createCalls = 0;
  await ensureTutorialWhiteboard(
    dependencies({
      completed: () => true,
      selectSample: async () => {
        selectCalls += 1;
        return undefined;
      },
      create: async () => {
        createCalls += 1;
        return { canvas: attachment, created: true };
      },
    }),
  );
  assert.equal(selectCalls, 0);
  assert.equal(createCalls, 0);
});

test("manual example requests reconcile and open without changing onboarding completion", async () => {
  const events: string[] = [];
  const deps = dependencies({
    completed: () => {
      throw new Error("manual creation must not read completion");
    },
    markCompleted: () => {
      throw new Error("manual creation must not change completion");
    },
    create: async (document) => {
      assert.ok(document.nodes.length > 0);
      events.push("create");
      return { canvas: attachment, created: true };
    },
    open: async () => {
      events.push("open");
    },
  });
  await createExampleWhiteboard(deps);
  await createExampleWhiteboard(deps);
  assert.deepEqual(events, ["create", "open", "create", "open"]);
});

test("a throwing completion read returns a resolving promise", async () => {
  const failure = new Error("completed failed");
  const logs: unknown[][] = [];
  let result: Promise<void> | undefined;
  assert.doesNotThrow(() => {
    result = ensureTutorialWhiteboard(
      dependencies({
        completed: () => {
          throw failure;
        },
        log: (...args) => logs.push(args),
      }),
    );
  });
  await assert.doesNotReject(result!);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1], failure);
});

test("default dependency failures return a resolving promise", async (t) => {
  const previous = (globalThis as { Zotero?: unknown }).Zotero;
  delete (globalThis as { Zotero?: unknown }).Zotero;
  t.after(() => {
    (globalThis as { Zotero?: unknown }).Zotero = previous;
  });
  let result: Promise<void> | undefined;
  assert.doesNotThrow(() => {
    result = ensureTutorialWhiteboard();
  });
  await assert.doesNotReject(result!);
});

test("a null attachment leaves completion unset and logs the failure", async () => {
  let markCalls = 0;
  let openCalls = 0;
  const logs: unknown[][] = [];
  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        create: async () => null,
        markCompleted: () => {
          markCalls += 1;
        },
        open: async () => {
          openCalls += 1;
        },
        log: (...args) => logs.push(args),
      }),
    ),
  );
  assert.equal(markCalls, 0);
  assert.equal(openCalls, 0);
  assert.equal(logs.length, 1);
});

test("a creation exception resolves, logs, and leaves completion unset", async () => {
  const failure = new Error("create failed");
  let markCalls = 0;
  const logs: unknown[][] = [];
  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        create: async () => {
          throw failure;
        },
        markCompleted: () => {
          markCalls += 1;
        },
        log: (...args) => logs.push(args),
      }),
    ),
  );
  assert.equal(markCalls, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1], failure);
});

test("a malformed sample skips creation, completion, and opening", async () => {
  const events: string[] = [];
  const logs: unknown[][] = [];
  const malformedSample = {
    literature: {
      kind: "literature",
      source: { library: { type: "user" }, itemKey: "" },
      snapshot: { title: "Malformed source" },
    },
    quotes: [],
  } as TutorialCanvasSample;

  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        selectSample: async () => malformedSample,
        create: async () => {
          events.push("create");
          return { canvas: attachment, created: true };
        },
        markCompleted: () => events.push("mark"),
        open: async () => events.push("open"),
        log: (...args) => logs.push(args),
      }),
    ),
  );

  assert.deepEqual(events, []);
  assert.equal(logs.length, 1);
  assert.match(String(logs[0][0]), /creation or opening failed/i);
  assert.match(String(logs[0][1]), /malformed-node/);
});

test("an open exception resolves after completion is marked", async () => {
  const events: string[] = [];
  const failure = new Error("open failed");
  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        create: async () => {
          events.push("create");
          return { canvas: attachment, created: true };
        },
        markCompleted: () => events.push("mark"),
        open: async () => {
          events.push("open");
          throw failure;
        },
        log: (_message, error) => {
          events.push("log");
          assert.equal(error, failure);
        },
      }),
    ),
  );
  assert.deepEqual(events, ["create", "mark", "open", "log"]);
});

test("a selection exception logs and falls back to a static tutorial", async () => {
  const failure = new Error("selection failed");
  const events: string[] = [];
  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        selectSample: async () => {
          events.push("select");
          throw failure;
        },
        create: async (document) => {
          events.push("create");
          assert.deepEqual(
            document.nodes.filter((node) => "source" in node),
            [],
          );
          return { canvas: attachment, created: true };
        },
        markCompleted: () => events.push("mark"),
        open: async () => events.push("open"),
        log: (_message, error) => {
          events.push("log");
          assert.equal(error, failure);
        },
      }),
    ),
  );
  assert.deepEqual(events, ["select", "log", "create", "mark", "open"]);
});

test("a throwing logger cannot escape a selection failure", async () => {
  let createCalls = 0;
  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        selectSample: async () => {
          throw new Error("selection failed");
        },
        create: async () => {
          createCalls += 1;
          return { canvas: attachment, created: true };
        },
        log: () => {
          throw new Error("log failed");
        },
      }),
    ),
  );
  assert.equal(createCalls, 1);
});

test("a throwing logger cannot escape a null creation result", async () => {
  let markCalls = 0;
  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        create: async () => null,
        markCompleted: () => {
          markCalls += 1;
        },
        log: () => {
          throw new Error("log failed");
        },
      }),
    ),
  );
  assert.equal(markCalls, 0);
});

test("a throwing logger cannot escape a creation exception", async () => {
  let markCalls = 0;
  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        create: async () => {
          throw new Error("create failed");
        },
        markCompleted: () => {
          markCalls += 1;
        },
        log: () => {
          throw new Error("log failed");
        },
      }),
    ),
  );
  assert.equal(markCalls, 0);
});

test("a throwing logger cannot escape an open exception", async () => {
  let markCalls = 0;
  await assert.doesNotReject(() =>
    ensureTutorialWhiteboard(
      dependencies({
        markCompleted: () => {
          markCalls += 1;
        },
        open: async () => {
          throw new Error("open failed");
        },
        log: () => {
          throw new Error("log failed");
        },
      }),
    ),
  );
  assert.equal(markCalls, 1);
});

test("simultaneous calls share one tutorial operation", async () => {
  let createCalls = 0;
  let markCalls = 0;
  let releaseCreate: (() => void) | undefined;
  const createPending = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const deps = dependencies({
    create: async () => {
      createCalls += 1;
      await createPending;
      return { canvas: attachment, created: true };
    },
    markCompleted: () => {
      markCalls += 1;
    },
  });

  const first = ensureTutorialWhiteboard(deps);
  const second = ensureTutorialWhiteboard(deps);
  assert.equal(first, second);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(createCalls, 1);
  releaseCreate?.();
  await Promise.all([first, second]);
  assert.equal(markCalls, 1);
});

test("an in-flight call is returned before completion is read again", async () => {
  let completedCalls = 0;
  let releaseCreate: (() => void) | undefined;
  const createPending = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const deps = dependencies({
    completed: () => {
      completedCalls += 1;
      if (completedCalls > 1) throw new Error("completed read twice");
      return false;
    },
    create: async () => {
      await createPending;
      return { canvas: attachment, created: true };
    },
  });

  const first = ensureTutorialWhiteboard(deps);
  let second: Promise<void> | undefined;
  assert.doesNotThrow(() => {
    second = ensureTutorialWhiteboard(deps);
  });
  assert.equal(second, first);
  assert.equal(completedCalls, 1);
  releaseCreate?.();
  await first;
});

test("manual and startup requests share one in-flight reconciliation", async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const deps = dependencies({
    create: async () => {
      calls++;
      await pending;
      return { canvas: attachment, created: true };
    },
  });
  const startup = ensureTutorialWhiteboard(deps);
  const manual = createExampleWhiteboard(deps);
  const secondManual = createExampleWhiteboard(deps);
  assert.equal(startup, manual);
  assert.equal(manual, secondManual);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await startup;
});

test("adopting a current existing tutorial marks completion without automatically opening it", async () => {
  const events: string[] = [];
  await ensureTutorialWhiteboard(
    dependencies({
      completed: async () => false,
      create: async () => ({ canvas: attachment, created: false }),
      markCompleted: () => events.push("mark"),
      open: async () => events.push("open"),
    }),
  );
  assert.deepEqual(events, ["mark"]);
});

test("the Help command opens an existing tutorial without requiring a newly created copy", async () => {
  let opened: Zotero.Item | undefined;
  await createExampleWhiteboard(
    dependencies({
      create: async () => ({ canvas: attachment, created: false }),
      open: async (item) => {
        opened = item;
      },
    }),
  );
  assert.equal(opened, attachment);
});

test("asynchronous completion failure aborts tutorial creation and reports the error", async () => {
  const error = new Error("lookup failed");
  const logs: unknown[][] = [];
  await ensureTutorialWhiteboard(
    dependencies({
      completed: async () => {
        throw error;
      },
      create: async () => {
        assert.fail("must not create after an uncertain lookup");
      },
      log: (...args) => {
        logs.push(args);
      },
    }),
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1], error);
});

test("startup and Help pass distinct restoration intent to the attachment lifecycle", async () => {
  const intents: boolean[] = [];
  const deps = dependencies({
    create: async (_document, _filename, manual) => {
      intents.push(manual);
      return { canvas: attachment, created: false };
    },
  });
  await ensureTutorialWhiteboard(deps);
  await createExampleWhiteboard(deps);
  assert.deepEqual(intents, [false, true]);
});

test("deletion detected during creation does not mark completion or open an attachment", async () => {
  const events: string[] = [];
  await ensureTutorialWhiteboard(
    dependencies({
      create: async () => ({ deleted: true }),
      markCompleted: () => events.push("mark"),
      open: async () => events.push("open"),
      log: () => events.push("log"),
    }),
  );
  assert.deepEqual(events, []);
});
