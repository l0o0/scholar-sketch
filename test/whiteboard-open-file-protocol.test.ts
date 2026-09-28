import assert from "node:assert/strict";
import test from "node:test";
import {
  isWhiteboardToParentMessageForChannel,
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
} from "../packages/whiteboard/src/model/protocol.ts";

const envelope = {
  source: WHITEBOARD_MESSAGE_SOURCE,
  channel: "tab:canvas",
  v: WHITEBOARD_PROTOCOL_VERSION,
};

test("openFile accepts only the current node id", () => {
  assert.equal(
    isWhiteboardToParentMessageForChannel(
      {
        ...envelope,
        type: "openFile",
        payload: { nodeId: "attachment-1" },
      },
      envelope.channel,
    ),
    true,
  );
  assert.equal(
    isWhiteboardToParentMessageForChannel(
      {
        ...envelope,
        type: "openFile",
        payload: { nodeId: "attachment-1", fileData: "data:..." },
      },
      envelope.channel,
    ),
    false,
  );
});
