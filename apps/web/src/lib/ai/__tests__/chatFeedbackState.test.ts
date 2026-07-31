import { describe, expect, it } from "vitest";
import {
  MAX_STORED_CHAT_FEEDBACK,
  addStoredChatFeedback,
  parseStoredChatFeedback,
} from "@/lib/ai/chatFeedbackState";

describe("chat feedback local state", () => {
  it("fails closed for malformed or unexpected storage values", () => {
    expect(parseStoredChatFeedback("{")).toEqual({});
    expect(parseStoredChatFeedback("[]")).toEqual({});
    expect(parseStoredChatFeedback('"good"')).toEqual({});
  });

  it("keeps only bounded message ids and supported ratings", () => {
    const parsed = parseStoredChatFeedback(JSON.stringify({
      valid: "good",
      invalid: "maybe",
      constructor: "bad",
      ["x".repeat(129)]: "good",
    }));

    expect({ ...parsed }).toEqual({ valid: "good" });
  });

  it("retains the newest bounded entries when adding feedback", () => {
    let state: ReturnType<typeof parseStoredChatFeedback> = {};
    for (let index = 0; index < MAX_STORED_CHAT_FEEDBACK + 5; index += 1) {
      state = addStoredChatFeedback(state, `message-${index}`, "good");
    }

    expect(Object.keys(state)).toHaveLength(MAX_STORED_CHAT_FEEDBACK);
    expect(state["message-0"]).toBeUndefined();
    expect(state[`message-${MAX_STORED_CHAT_FEEDBACK + 4}`]).toBe("good");
  });
});
