import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ChatRequestClaimResult =
  | { action: "acquired"; attemptCount: number; reclaimed: boolean }
  | { action: "completed"; attemptCount: number; messageId: string }
  | { action: "in_progress"; attemptCount: number; retryAfterMs: number }
  | { action: "conflict" };

export class ChatRequestClaimError extends Error {
  readonly code = "CHAT_REQUEST_CLAIM_FAILED";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ChatRequestClaimError";
  }
}

interface ClaimParams {
  coupleId: string;
  requestKey: string;
  userId: string;
  /** Durable user row that establishes the exact normal-chat intent. */
  userMessageId?: string;
  visibility: "shared" | "bride_private" | "groom_private";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export async function claimChatRequest(
  params: ClaimParams,
  admin: AdminClient = createAdminClient(),
): Promise<ChatRequestClaimResult> {
  const { data, error } = await admin.rpc("claim_amora_chat_request", {
    p_couple_id: params.coupleId,
    p_request_key: params.requestKey,
    p_user_id: params.userId,
    p_visibility: params.visibility,
    ...(params.userMessageId
      ? { p_user_message_id: params.userMessageId }
      : {}),
  });

  if (error || !isRecord(data)) {
    throw new ChatRequestClaimError("Could not claim chat request", {
      cause: error,
    });
  }

  const attemptCount = asPositiveInteger(data.attempt_count);

  if (data.action === "acquired" && attemptCount !== null) {
    return {
      action: "acquired",
      attemptCount,
      reclaimed: data.reclaimed === true,
    };
  }
  if (
    data.action === "completed"
    && attemptCount !== null
    && typeof data.message_id === "string"
  ) {
    return {
      action: "completed",
      attemptCount,
      messageId: data.message_id,
    };
  }
  if (data.action === "in_progress" && attemptCount !== null) {
    return {
      action: "in_progress",
      attemptCount,
      retryAfterMs:
        typeof data.retry_after_ms === "number" && data.retry_after_ms > 0
          ? Math.min(data.retry_after_ms, 30_000)
          : 2_000,
    };
  }
  if (data.action === "conflict") return { action: "conflict" };

  throw new ChatRequestClaimError("Chat claim response was invalid");
}

export async function completeChatRequest(
  params: ClaimParams & { messageId: string },
  admin: AdminClient = createAdminClient(),
): Promise<void> {
  const { data, error } = await admin.rpc("complete_amora_chat_request", {
    p_couple_id: params.coupleId,
    p_request_key: params.requestKey,
    p_user_id: params.userId,
    p_message_id: params.messageId,
  });
  if (error || data !== true) {
    throw new ChatRequestClaimError("Could not complete chat request", {
      cause: error,
    });
  }
}

/** Repair an exact message-first legacy split before replaying the response. */
export async function reconcileChatRequest(
  params: ClaimParams & { messageId: string },
  admin: AdminClient = createAdminClient(),
): Promise<boolean> {
  const { data, error } = await admin.rpc("reconcile_amora_chat_response", {
    p_couple_id: params.coupleId,
    p_request_key: params.requestKey,
    p_user_id: params.userId,
    p_visibility: params.visibility,
    p_message_id: params.messageId,
  });
  if (error || typeof data !== "boolean") {
    throw new ChatRequestClaimError("Could not reconcile chat request", {
      cause: error,
    });
  }
  return data;
}

export async function failChatRequest(
  params: ClaimParams & { failureCode: string },
  admin: AdminClient = createAdminClient(),
): Promise<void> {
  const { error } = await admin.rpc("fail_amora_chat_request", {
    p_couple_id: params.coupleId,
    p_request_key: params.requestKey,
    p_user_id: params.userId,
    p_failure_code: params.failureCode,
  });
  if (error) {
    throw new ChatRequestClaimError("Could not fail chat request", {
      cause: error,
    });
  }
}
