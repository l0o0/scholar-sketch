import assert from "node:assert/strict";
import test from "node:test";
import { forwardAcademicParentMessage } from "../packages/whiteboard/src/bootstrapState.ts";
import {
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
  type ParentToWhiteboardMessage,
} from "../packages/whiteboard/src/model/protocol.ts";
import { handleListLiteratureAnnotations } from "../src/modules/whiteboard/tab.ts";
import {
  createZoteroSourceGateway,
  type SourceGatewayDependencies,
} from "../src/modules/whiteboard/source-gateway.ts";

function zoteroItem(
  kind: "regular" | "attachment" | "annotation",
  values: Record<string, unknown>,
) {
  return {
    id: 1,
    key: "KEY",
    libraryID: 1,
    attachmentContentType: undefined,
    annotationType: undefined,
    annotationText: undefined,
    annotationSortIndex: undefined,
    annotationComment: undefined,
    annotationPageLabel: undefined,
    annotationColor: undefined,
    parentItem: undefined,
    getField: () => "",
    getAttachments: () => [],
    getAnnotations: () => [],
    isRegularItem: () => kind === "regular",
    isAttachment: () => kind === "attachment",
    isFileAttachment: () => kind === "attachment",
    isAnnotation: () => kind === "annotation",
    isNote: () => false,
    ...values,
  } as unknown as Zotero.Item;
}

function gatewayWithPartialFailure() {
  const regular = zoteroItem("regular", { key: "ITEM" });
  const attachment = zoteroItem("attachment", {
    key: "PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
    getField: () => "Paper.pdf",
  });
  const otherAttachment = zoteroItem("attachment", {
    key: "OTHER-PDF",
    parentItem: regular,
    attachmentContentType: "application/pdf",
  });
  const valid = zoteroItem("annotation", {
    key: "VALID",
    parentItem: attachment,
    annotationType: "highlight",
    annotationText: "Evidence",
    annotationSortIndex: "0001",
  });
  const invalid = zoteroItem("annotation", {
    key: "INVALID",
    parentItem: otherAttachment,
    annotationType: "highlight",
    annotationText: "Mismatched",
    annotationSortIndex: "0002",
  });
  Object.assign(attachment, { getAnnotations: () => [valid, invalid] });
  Object.assign(regular, { getAttachments: () => [attachment] });
  const deps: SourceGatewayDependencies = {
    userLibraryID: 1,
    getLibrary: () => ({ libraryType: "user" }),
    groupLibraryID: () => null,
    getByLibraryAndKey: (_libraryID, key) => (key === "ITEM" ? regular : null),
    cleanTags: (value) => value,
    unescapeHTML: (value) => value,
    openItem: async () => undefined,
    openNote: async () => undefined,
    readAnnotationImage: async () => undefined,
    openAnnotation: async () => false,
    openAttachmentPage: async () => undefined,
  };
  return createZoteroSourceGateway(deps);
}

test("partial gateway results cross the host bridge into the correlated runtime", async () => {
  const source = { library: { type: "user" as const }, itemKey: "ITEM" };
  const runtimeCalls: unknown[] = [];
  const runtime = {
    rejectAcademicRequest: () => undefined,
    applySourceResolutionBatch: () => undefined,
    applyNoteRefresh: () => undefined,
    applyAnnotationCandidates: (...args: unknown[]) =>
      runtimeCalls.push(["result", ...args]),
    rejectAnnotationList: (...args: unknown[]) =>
      runtimeCalls.push(["failure", ...args]),
  };
  const deliver = (message: ParentToWhiteboardMessage) => {
    assert.equal(forwardAcademicParentMessage(runtime, message), true);
  };
  const editor = {
    applyAnnotationCandidates(
      requestId: string,
      returnedSource: typeof source,
      candidates: Parameters<typeof runtime.applyAnnotationCandidates>[2],
      failures: Parameters<typeof runtime.applyAnnotationCandidates>[3],
    ) {
      deliver({
        source: WHITEBOARD_MESSAGE_SOURCE,
        channel: "canvas",
        v: WHITEBOARD_PROTOCOL_VERSION,
        type: "annotationsListed",
        payload: {
          requestId,
          source: returnedSource,
          candidates,
          failures,
        },
      });
    },
    rejectAnnotationList() {
      assert.fail("success path must not reject the list");
    },
  };

  await handleListLiteratureAnnotations(
    { editor } as never,
    "request-1",
    source,
    gatewayWithPartialFailure(),
  );

  assert.equal(runtimeCalls.length, 1);
  const [, requestId, returnedSource, candidates, failures] =
    runtimeCalls[0] as [
      string,
      string,
      typeof source,
      Array<{ acquisition: { source: { annotationKey: string } } }>,
      Array<{ code: string; annotationKey?: string }>,
    ];
  assert.equal(requestId, "request-1");
  assert.deepEqual(returnedSource, source);
  assert.deepEqual(
    candidates.map((candidate) => candidate.acquisition.source.annotationKey),
    ["VALID"],
  );
  assert.deepEqual(
    failures.map((failure) => [failure.code, failure.annotationKey]),
    [["annotation-unavailable", "INVALID"]],
  );
  assert.doesNotMatch(JSON.stringify(runtimeCalls), /itemID|attachmentID/);
});

test("terminal gateway errors retain their code through host and runtime", async () => {
  const source = {
    library: { type: "group" as const, groupID: 99 },
    itemKey: "ITEM",
  };
  const failures: unknown[] = [];
  const editor = {
    applyAnnotationCandidates: () => assert.fail("failure path must not apply"),
    rejectAnnotationList(
      requestId: string,
      returnedSource: typeof source,
      failure: unknown,
    ) {
      failures.push([requestId, returnedSource, failure]);
    },
  };
  const gateway = createZoteroSourceGateway({
    ...({} as SourceGatewayDependencies),
    userLibraryID: 1,
    groupLibraryID: () => null,
  });

  await handleListLiteratureAnnotations(
    { editor } as never,
    "request-2",
    source,
    gateway,
  );

  assert.deepEqual(failures, [
    [
      "request-2",
      source,
      {
        code: "library-missing",
        message: "The Zotero library is unavailable.",
      },
    ],
  ]);
});

test("late annotation replies cannot update a replaced or closing editor", async () => {
  for (const terminal of [
    "replace",
    "close",
    "generation",
    "failure",
  ] as const) {
    const calls: unknown[] = [];
    const source = {
      library: { type: "user" as const },
      attachmentKey: "FILE",
    };
    const editor = {
      applyAnnotationCandidates: (...args: unknown[]) => calls.push(args),
      rejectAnnotationList: (...args: unknown[]) => calls.push(args),
    };
    const session = { editor, closing: false, sourceGeneration: 1 };
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const work = handleListLiteratureAnnotations(
      session as never,
      "late",
      source,
      {
        async listAnnotations() {
          await pending;
          if (terminal === "failure") throw new Error("Late failure");
          return { candidates: [], failures: [] };
        },
      },
    );
    if (terminal === "replace" || terminal === "failure")
      session.editor = { ...editor };
    if (terminal === "close") session.closing = true;
    if (terminal === "generation") session.sourceGeneration = 2;
    finish();
    await work;
    assert.deepEqual(calls, [], terminal);
  }
});
