import assert from "node:assert/strict";
import test from "node:test";
import {
  isPreviewWorkerRequest,
  isPreviewWorkerResponse,
} from "../src/modules/markdown/preview-worker-protocol.ts";

test("validates versioned preview worker messages", () => {
  assert.equal(
    isPreviewWorkerRequest({ version: 1, requestID: 2, source: "# A" }),
    true,
  );
  assert.equal(
    isPreviewWorkerResponse({
      version: 1,
      requestID: 2,
      ok: true,
      title: "A",
      bodyHtml: "<h1>A</h1>",
    }),
    true,
  );
  assert.equal(isPreviewWorkerResponse({ requestID: 2, ok: true }), false);
  const request = { version: 1, requestID: 3, source: "# A" };
  assert.equal(
    isPreviewWorkerRequest({
      ...request,
      fragment: { maxChars: 12000, heading: "A" },
    }),
    true,
  );
  for (const fragment of [
    { maxChars: 0 },
    { maxChars: 1e9 },
    { maxChars: 12, heading: 3 },
  ]) {
    assert.equal(isPreviewWorkerRequest({ ...request, fragment }), false);
  }
  const response = {
    version: 1,
    requestID: 3,
    ok: true,
    title: "A",
    bodyHtml: "",
  };
  assert.equal(
    isPreviewWorkerResponse({ ...response, headingFound: false }),
    true,
  );
  assert.equal(
    isPreviewWorkerResponse({ ...response, headingFound: "false" }),
    false,
  );
});
