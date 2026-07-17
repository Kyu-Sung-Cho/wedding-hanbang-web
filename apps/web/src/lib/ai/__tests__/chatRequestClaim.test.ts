import { describe, expect, it, vi } from "vitest";

import {
  ChatRequestClaimError,
  claimChatRequest,
  completeChatRequest,
  failChatRequest,
  reconcileChatRequest,
} from "@/lib/ai/chatRequestClaim";

const BASE = {
  coupleId: "10000000-0000-4000-8000-000000000001",
  requestKey:
    "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000099",
  userId: "00000000-0000-4000-8000-000000000001",
  userMessageId: "30000000-0000-4000-8000-000000000001",
  visibility: "shared" as const,
};

function makeAdmin(results: Array<{ data: unknown; error: unknown }>) {
  return {
    rpc: vi.fn(() => Promise.resolve(results.shift() ?? { data: null, error: null })),
  };
}

describe("chat request claim client", () => {
  it("binds a normal chat claim to its durable user message", async () => {
    const admin = makeAdmin([
      { data: { action: "acquired", attempt_count: 1, reclaimed: false }, error: null },
    ]);

    await claimChatRequest(BASE, admin as never);

    expect(admin.rpc).toHaveBeenCalledWith("claim_amora_chat_request", {
      p_couple_id: BASE.coupleId,
      p_request_key: BASE.requestKey,
      p_user_id: BASE.userId,
      p_visibility: BASE.visibility,
      p_user_message_id: BASE.userMessageId,
    });
  });

  it("parses acquired and in-progress contracts conservatively", async () => {
    const admin = makeAdmin([
      { data: { action: "acquired", attempt_count: 2, reclaimed: true }, error: null },
      { data: { action: "in_progress", attempt_count: 2, retry_after_ms: 2500 }, error: null },
    ]);
    await expect(claimChatRequest(BASE, admin as never)).resolves.toEqual({
      action: "acquired",
      attemptCount: 2,
      reclaimed: true,
    });
    await expect(claimChatRequest(BASE, admin as never)).resolves.toEqual({
      action: "in_progress",
      attemptCount: 2,
      retryAfterMs: 2500,
    });
  });

  it("requires a message id for completed replay", async () => {
    const admin = makeAdmin([
      { data: { action: "completed", attempt_count: 1 }, error: null },
    ]);
    await expect(claimChatRequest(BASE, admin as never)).rejects.toBeInstanceOf(
      ChatRequestClaimError,
    );
  });

  it.each(["acquired", "completed", "in_progress"])(
    "rejects a %s claim without a positive generation fence",
    async (action) => {
      const admin = makeAdmin([{
        data: {
          action,
          ...(action === "completed"
            ? { message_id: "20000000-0000-4000-8000-000000000001" }
            : {}),
          ...(action === "in_progress" ? { retry_after_ms: 2_500 } : {}),
        },
        error: null,
      }]);

      await expect(claimChatRequest(BASE, admin as never)).rejects.toBeInstanceOf(
        ChatRequestClaimError,
      );
    },
  );

  it("fails closed on malformed or database error responses", async () => {
    const malformed = makeAdmin([{ data: { action: "unknown" }, error: null }]);
    await expect(claimChatRequest(BASE, malformed as never)).rejects.toBeInstanceOf(
      ChatRequestClaimError,
    );

    const failed = makeAdmin([{ data: null, error: { message: "db unavailable" } }]);
    await expect(claimChatRequest(BASE, failed as never)).rejects.toBeInstanceOf(
      ChatRequestClaimError,
    );
  });

  it("requires durable completion and sends only stable failure codes", async () => {
    const admin = makeAdmin([
      { data: true, error: null },
      { data: true, error: null },
    ]);
    await expect(
      completeChatRequest({ ...BASE, messageId: "20000000-0000-4000-8000-000000000001" }, admin as never),
    ).resolves.toBeUndefined();
    await expect(
      failChatRequest({ ...BASE, failureCode: "PROVIDER_TIMEOUT" }, admin as never),
    ).resolves.toBeUndefined();
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "fail_amora_chat_request", {
      p_couple_id: BASE.coupleId,
      p_request_key: BASE.requestKey,
      p_user_id: BASE.userId,
      p_failure_code: "PROVIDER_TIMEOUT",
    });
  });

  it("reconciles an exact persisted response before replay", async () => {
    const admin = makeAdmin([{ data: true, error: null }]);
    const messageId = "20000000-0000-4000-8000-000000000001";
    await expect(reconcileChatRequest(
      { ...BASE, messageId },
      admin as never,
    )).resolves.toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("reconcile_amora_chat_response", {
      p_couple_id: BASE.coupleId,
      p_request_key: BASE.requestKey,
      p_user_id: BASE.userId,
      p_visibility: BASE.visibility,
      p_message_id: messageId,
    });
  });
});
