import { describe, expect, it } from "vitest";

import {
  amoraPersonalizationPendingStorageKey,
  clearPendingAmoraPersonalizationChoice,
  findAmoraPersonalizationReplyId,
  readPendingAmoraPersonalizationChoice,
  rememberPendingAmoraPersonalizationChoice,
  resolveAmoraPersonalizationReply,
  shouldOfferAmoraQuickStart,
  type PendingAmoraPersonalizationChoice,
} from "@/components/app/chat/amoraPersonalizationFlow";
import { AMORA_QUICK_START_OPTIONS } from "@/lib/amora/personalization";
import type { ChatMessage } from "@/types/database.types";

function message(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, "id">,
): ChatMessage {
  const { id, ...rest } = overrides;
  return {
    id,
    couple_id: "couple",
    sender_id: null,
    sender_role: "ai",
    content: "안녕하세요",
    metadata: null,
    visibility: "shared",
    created_at: "2026-07-31T08:00:00.000Z",
    ...rest,
  };
}

describe("Amora personalization chat flow", () => {
  it("offers one quick start only after the greeting and before this user asks Amora", () => {
    const base = {
      enabled: true,
      status: "ready" as const,
      hasSavedProfile: false,
      hasPendingChoice: false,
      busy: false,
      activeTab: "shared" as const,
      currentUserId: "me",
    };

    expect(
      shouldOfferAmoraQuickStart({ ...base, messages: [] }),
    ).toBe(false);
    expect(
      shouldOfferAmoraQuickStart({
        ...base,
        messages: [
          message({ id: "greeting" }),
          message({
            id: "partner-message",
            sender_id: "partner",
            sender_role: "groom",
            content: "질문",
          }),
        ],
      }),
    ).toBe(true);
    expect(
      shouldOfferAmoraQuickStart({
        ...base,
        messages: [
          message({ id: "greeting" }),
          message({
            id: "my-message",
            sender_id: "me",
            sender_role: "bride",
            content: "이미 질문했어요",
          }),
        ],
      }),
    ).toBe(false);
  });

  it("opens confirmation only for the AI row tied to the new choice message", () => {
    const option = AMORA_QUICK_START_OPTIONS[0];
    const pending: PendingAmoraPersonalizationChoice = {
      option,
      existingUserMessageIds: ["old-choice"],
      ownerUserId: "me",
      coupleId: "couple",
    };
    const messages = [
      message({
        id: "old-choice",
        sender_id: "me",
        sender_role: "bride",
        content: option.message,
        metadata: { target: "ai" },
      }),
      message({
        id: "new-choice",
        sender_id: "me",
        sender_role: "bride",
        content: option.message,
        metadata: { target: "ai" },
        created_at: "2026-07-31T09:00:00.000Z",
      }),
      message({
        id: "other-reply",
        metadata: { in_reply_to_user_message_id: "partner-message" },
      }),
      message({
        id: "exact-reply",
        metadata: { in_reply_to_user_message_id: "new-choice" },
      }),
    ];

    expect(findAmoraPersonalizationReplyId(messages, "me", "couple", pending)).toBe(
      "exact-reply",
    );
    expect(
      findAmoraPersonalizationReplyId(
        messages.filter((item) => item.id !== "exact-reply"),
        "me",
        "couple",
        pending,
      ),
    ).toBeNull();
  });

  it("stores only the selected mode in a user-and-couple scoped session key", () => {
    sessionStorage.clear();
    const option = AMORA_QUICK_START_OPTIONS[0];

    const pending = rememberPendingAmoraPersonalizationChoice({
      currentUserId: "user/one",
      coupleId: "couple:one",
      option,
      existingUserMessageIds: ["already-there"],
    });

    expect(pending).toEqual({
      option,
      existingUserMessageIds: ["already-there"],
      ownerUserId: "user/one",
      coupleId: "couple:one",
    });
    expect(
      sessionStorage.getItem(
        amoraPersonalizationPendingStorageKey("user/one", "couple:one"),
      ),
    ).toBe(option.mode);
    expect(
      readPendingAmoraPersonalizationChoice("other-user", "couple:one"),
    ).toBeNull();
    expect(
      readPendingAmoraPersonalizationChoice("user/one", "other-couple"),
    ).toBeNull();
    expect(
      readPendingAmoraPersonalizationChoice("user/one", "couple:one"),
    ).toEqual({
      option,
      existingUserMessageIds: [],
      ownerUserId: "user/one",
      coupleId: "couple:one",
    });

    clearPendingAmoraPersonalizationChoice("user/one", "couple:one");
    expect(
      sessionStorage.getItem(
        amoraPersonalizationPendingStorageKey("user/one", "couple:one"),
      ),
    ).toBeNull();
  });

  it("removes malformed or unknown session values instead of restoring them", () => {
    sessionStorage.clear();
    const key = amoraPersonalizationPendingStorageKey("me", "couple");
    sessionStorage.setItem(key, JSON.stringify({ mode: "recommendation" }));

    expect(
      readPendingAmoraPersonalizationChoice("me", "couple"),
    ).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();

    sessionStorage.setItem(key, "unknown-mode");
    expect(
      readPendingAmoraPersonalizationChoice("me", "couple"),
    ).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("fails closed for another scope, private or partner turns, and stale later AI turns", () => {
    const option = AMORA_QUICK_START_OPTIONS[0];
    const pending: PendingAmoraPersonalizationChoice = {
      option,
      existingUserMessageIds: [],
      ownerUserId: "me",
      coupleId: "couple",
    };
    const exactUser = message({
      id: "selected",
      sender_id: "me",
      sender_role: "bride",
      content: option.message,
      metadata: { target: "ai" },
    });
    const exactReply = message({
      id: "reply",
      metadata: { in_reply_to_user_message_id: "selected" },
    });

    expect(
      resolveAmoraPersonalizationReply(
        [exactUser, exactReply],
        "other-user",
        "couple",
        pending,
      ),
    ).toEqual({ state: "stale", replyMessageId: null });
    expect(
      resolveAmoraPersonalizationReply(
        [exactUser, exactReply],
        "me",
        "other-couple",
        pending,
      ),
    ).toEqual({ state: "stale", replyMessageId: null });
    expect(
      resolveAmoraPersonalizationReply(
        [
          message({
            ...exactUser,
            id: "private-choice",
            visibility: "bride_private",
          }),
          message({
            ...exactReply,
            id: "private-reply",
            visibility: "bride_private",
            metadata: {
              in_reply_to_user_message_id: "private-choice",
            },
          }),
        ],
        "me",
        "couple",
        pending,
      ),
    ).toEqual({ state: "waiting", replyMessageId: null });
    expect(
      resolveAmoraPersonalizationReply(
        [
          message({
            ...exactUser,
            id: "partner-choice",
            metadata: { target: "partner" },
          }),
          message({
            ...exactReply,
            id: "partner-reply",
            metadata: {
              in_reply_to_user_message_id: "partner-choice",
            },
          }),
        ],
        "me",
        "couple",
        pending,
      ),
    ).toEqual({ state: "waiting", replyMessageId: null });

    expect(
      resolveAmoraPersonalizationReply(
        [
          exactUser,
          exactReply,
          message({
            id: "new-ai-turn",
            sender_id: "partner",
            sender_role: "groom",
            content: "새 질문",
            metadata: { target: "ai" },
          }),
        ],
        "me",
        "couple",
        pending,
      ),
    ).toEqual({ state: "stale", replyMessageId: null });
  });
});
