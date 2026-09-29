import assert from "node:assert/strict";
import test from "node:test";
import {
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
  isParentToWhiteboardMessageForChannel,
} from "../packages/whiteboard/src/model/protocol.ts";

const base = {
  source: WHITEBOARD_MESSAGE_SOURCE,
  channel: "tab-1:canvas-1",
  v: WHITEBOARD_PROTOCOL_VERSION,
} as const;

test("whiteboard appearance accepts validated init and live settings", () => {
  const appearance = { fontFamily: "serif", backgroundColor: "#ABCDEF" };
  assert.equal(
    isParentToWhiteboardMessageForChannel(
      {
        ...base,
        type: "init",
        payload: { theme: "light", appearance },
      },
      base.channel,
    ),
    true,
  );
  assert.equal(
    isParentToWhiteboardMessageForChannel(
      {
        ...base,
        type: "setAppearance",
        payload: { appearance: { fontFamily: "mono", backgroundColor: "" } },
      },
      base.channel,
    ),
    true,
  );
});

test("whiteboard appearance rejects invalid colors, fonts, and extra fields", () => {
  const valid = {
    fontFamily: "system",
    backgroundColor: "#abcdef",
  };
  for (const appearance of [
    { ...valid, backgroundColor: "#abc" },
    { ...valid, backgroundColor: "red" },
    { ...valid, fontFamily: "comic" },
    { ...valid, extra: true },
  ]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        {
          ...base,
          type: "setAppearance",
          payload: { appearance },
        },
        base.channel,
      ),
      false,
    );
  }
});
