import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptAnnotationListFailure,
  acceptAnnotationListResult,
  closeAnnotationBrowserSession,
  openAnnotationBrowserSession,
  replaceDocumentAnnotationBrowserSession,
} from "../packages/whiteboard/src/whiteboard/annotationBrowserState.ts";
import type { AnnotationCandidate } from "../packages/whiteboard/src/model/protocol.ts";

const source = {
  library: { type: "user" as const },
  itemKey: "ITEM1234",
};
const otherLibrary = {
  library: { type: "group" as const, groupID: 42 },
  itemKey: "ITEM1234",
};
const candidate: AnnotationCandidate = {
  attachmentTitle: "Paper.pdf",
  sortIndex: "0001",
  acquisition: {
    kind: "quote",
    source: {
      ...source,
      attachmentKey: "PDF12345",
      annotationKey: "ANN12345",
    },
    snapshot: { text: "Evidence" },
  },
};

test("annotation replies require both request ID and full Literature source", () => {
  const loading = openAnnotationBrowserSession("request-1", source);
  assert.equal(
    acceptAnnotationListResult(loading, "request-1", otherLibrary, {
      candidates: [candidate],
      failures: [],
    }),
    loading,
  );
  assert.equal(
    acceptAnnotationListFailure(loading, "request-other", source, {
      code: "item-missing",
      message: "Missing",
    }),
    loading,
  );
  assert.equal(
    acceptAnnotationListResult(loading, "request-1", source, {
      candidates: [candidate],
      failures: [],
    })?.state.status,
    "ready",
  );
});

test("close, document replacement, and reopen make old replies inert", () => {
  const first = openAnnotationBrowserSession("request-1", source);
  assert.equal(closeAnnotationBrowserSession(first), null);
  assert.equal(replaceDocumentAnnotationBrowserSession(first), null);
  assert.equal(
    acceptAnnotationListResult(null, "request-1", source, {
      candidates: [candidate],
      failures: [],
    }),
    null,
  );

  const reopened = openAnnotationBrowserSession("request-2", source);
  assert.equal(
    acceptAnnotationListResult(reopened, "request-1", source, {
      candidates: [candidate],
      failures: [],
    }),
    reopened,
  );
});

test("attachment annotation replies require exact attachment and library identity", () => {
  const source = { library: { type: "user" as const }, attachmentKey: "FILE" };
  const loading = openAnnotationBrowserSession("file-request", source);
  for (const mismatch of [
    { ...source, attachmentKey: "OTHER" },
    { ...source, library: { type: "group" as const, groupID: 42 } },
    { library: source.library, itemKey: "FILE" },
  ]) {
    assert.equal(
      acceptAnnotationListResult(loading, "file-request", mismatch, {
        candidates: [],
        failures: [],
      }),
      loading,
    );
  }
  assert.equal(
    acceptAnnotationListResult(loading, "file-request", source, {
      candidates: [],
      failures: [],
    })?.state.status,
    "ready",
  );
});
