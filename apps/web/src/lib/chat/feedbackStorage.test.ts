import { beforeEach, describe, expect, it } from "vitest";

import {
  clearChatFeedbackStorage,
  LEGACY_CHAT_FEEDBACK_STORAGE_KEY,
  readChatFeedbackState,
  writeChatFeedbackState,
} from "./feedbackStorage";

describe("chat feedback browser storage boundary", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps message feedback separated by authenticated user", () => {
    writeChatFeedbackState("user-a", "message-a", "good");
    writeChatFeedbackState("user-b", "message-b", "bad");

    expect(readChatFeedbackState("user-a")).toEqual({ "message-a": "good" });
    expect(readChatFeedbackState("user-b")).toEqual({ "message-b": "bad" });
    expect(readChatFeedbackState(null)).toEqual({});
  });

  it("does not restore the legacy account-unscoped key", () => {
    localStorage.setItem(
      LEGACY_CHAT_FEEDBACK_STORAGE_KEY,
      JSON.stringify({ "private-message-id": "good" }),
    );

    expect(readChatFeedbackState("user-b")).toEqual({});
    expect(localStorage.getItem(LEGACY_CHAT_FEEDBACK_STORAGE_KEY)).toBeNull();
  });

  it("purges legacy and scoped feedback while preserving unrelated storage", () => {
    localStorage.setItem(LEGACY_CHAT_FEEDBACK_STORAGE_KEY, "{}");
    writeChatFeedbackState("user-a", "message-a", "good");
    writeChatFeedbackState("user-b", "message-b", "bad");
    localStorage.setItem("unrelated", "keep");

    clearChatFeedbackStorage();

    expect(readChatFeedbackState("user-a")).toEqual({});
    expect(readChatFeedbackState("user-b")).toEqual({});
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});
