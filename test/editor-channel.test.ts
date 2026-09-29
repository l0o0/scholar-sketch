import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_MESSAGE_SOURCE,
  applyDocChanges,
  isEditorProtocolMessageForChannel,
} from "../src/modules/markdown/editor-protocol.ts";

test("accepts editor messages only from the matching session channel", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "tab-3:item-303",
    type: "change",
    payload: {
      rev: 3,
      changes: [{ from: 0, to: 0, insert: "third document" }],
    },
  };

  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-3:item-303"),
    true,
  );
  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-1:item-101"),
    false,
  );
});

test("rejects unscoped editor messages when a channel is required", () => {
  assert.equal(
    isEditorProtocolMessageForChannel(
      { source: EDITOR_MESSAGE_SOURCE, type: "ready" },
      "tab-1:item-101",
    ),
    false,
  );
});

test("applies original-document changes from last to first", () => {
  assert.equal(
    applyDocChanges("hello world", [
      { from: 0, to: 5, insert: "hey" },
      { from: 6, to: 11, insert: "there" },
    ]),
    "hey there",
  );
});

test("does not accept another tab's outline update", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "tab-3:item-303",
    type: "outline",
    payload: {
      items: [{ id: "h1:0", level: 1, text: "Third", from: 0 }],
      activeID: "h1:0",
    },
  };

  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-1:item-101"),
    false,
  );
});

test("validates document-link bridge payloads and candidates", () => {
  assert.equal(
    isEditorProtocolMessageForChannel(
      {
        source: EDITOR_MESSAGE_SOURCE,
        channel: "tab-1:item-101",
        type: "openLink",
        payload: { href: "zotero://select/library/items/AB12CD34" },
      },
      "tab-1:item-101",
    ),
    true,
  );
  assert.equal(
    isEditorProtocolMessageForChannel(
      {
        source: EDITOR_MESSAGE_SOURCE,
        channel: "tab-1:item-101",
        type: "linkSearch",
        payload: { requestId: -1, query: "x" },
      },
      "tab-1:item-101",
    ),
    false,
  );
  assert.equal(
    isEditorProtocolMessageForChannel(
      {
        source: EDITOR_MESSAGE_SOURCE,
        channel: "tab-1:item-101",
        type: "linkSearchResults",
        payload: {
          requestId: 1,
          query: "x",
          results: [
            {
              key: "AB12CD34",
              libraryID: 1,
              title: "Doc",
              kind: "markdown",
              href: "javascript:alert(1)",
            },
          ],
        },
      },
      "tab-1:item-101",
    ),
    false,
  );
});

test("appearance messages accept only supported fonts and plain hex colors", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "settings",
    type: "setAppearance",
    payload: { fontFamily: "serif", backgroundColor: "#f7efdc" },
  };
  assert.equal(isEditorProtocolMessageForChannel(message, "settings"), true);
  for (const payload of [
    null,
    {},
    { fontFamily: "url(x)", backgroundColor: "" },
    { fontFamily: "serif", backgroundColor: "url(x)" },
  ]) {
    assert.equal(
      isEditorProtocolMessageForChannel({ ...message, payload }, "settings"),
      false,
    );
  }
});
