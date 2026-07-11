import { createHmac, type Hash, type Hmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const REQUEST_KEY_NAMESPACE = "amora-chat-request-key-v1";
const REQUEST_HASH_NAMESPACE = "amora-chat-request-payload-v1";

type ChatVisibility = "shared" | "bride_private" | "groom_private";

export class ChatExecutionClaimError extends Error {
  constructor(
    message: string,
    readonly code:
      | "claim_unavailable"
      | "request_mismatch"
      | "request_in_progress"
      | "request_failed"
      | "replay_unavailable"
  ) {
    super(message);
    this.name = "ChatExecutionClaimError";
  }
}

export type ChatExecutionClaim =
  | { action: "execute" }
  | { action: "replay"; messageId: string };

function updateCanonicalHash(hash: Hash | Hmac, value: unknown): void {
  if (value === null) {
    hash.update("n;");
    return;
  }
  switch (typeof value) {
    case "string":
      hash.update(`s${Buffer.byteLength(value, "utf8")}:`);
      hash.update(value, "utf8");
      hash.update(";");
      return;
    case "boolean":
      hash.update(value ? "b1;" : "b0;");
      return;
    case "number":
      hash.update(Number.isFinite(value) ? `d${String(value)};` : `x${String(value)};`);
      return;
    case "undefined":
      hash.update("u;");
      return;
    case "bigint":
      hash.update(`i${value.toString()};`);
      return;
    case "symbol":
    case "function":
      hash.update(`x${typeof value};`);
      return;
    case "object":
      if (Array.isArray(value)) {
        hash.update(`a${value.length}[`);
        for (const item of value) updateCanonicalHash(hash, item);
        hash.update("];");
        return;
      }
      const object = value as Record<string, unknown>;
      const keys = Object.keys(object).sort();
      hash.update(`o${keys.length}{`);
      for (const key of keys) {
        updateCanonicalHash(hash, key);
        updateCanonicalHash(hash, object[key]);
      }
      hash.update("};");
  }
}

export function createChatRequestIdentity(params: {
  userId: string;
  coupleId: string;
  clientRequestId: string;
  payload: unknown;
}): { requestKey: string; requestHash: string } {
  const dedicatedSecret = process.env.AMORA_IDEMPOTENCY_SECRET?.trim() ?? "";
  const localFallback = process.env.NODE_ENV === "production"
    ? ""
    : process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const secret = dedicatedSecret || localFallback;
  const looksLikePlaceholder =
    /(?:replace[-_ ]?with|at[-_ ]?least[-_ ]?32|your[-_ ]?secret|example|placeholder)/i.test(secret);
  if (secret.length < 32 || looksLikePlaceholder) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "[ai-config] production에는 전용 AMORA_IDEMPOTENCY_SECRET(32자 이상)이 필요합니다."
        : "[ai-config] AMORA_IDEMPOTENCY_SECRET 또는 로컬용 service role key(32자 이상)가 필요합니다."
    );
  }
  const requestKey = createHmac("sha256", secret)
    .update(
      [
        REQUEST_KEY_NAMESPACE,
        params.userId,
        params.coupleId,
        params.clientRequestId,
      ].join("\u0000"),
      "utf8"
    )
    .digest("hex");
  const payloadHash = createHmac("sha256", secret).update(
    `${REQUEST_HASH_NAMESPACE}\u0000${requestKey}\u0000`,
    "utf8"
  );
  updateCanonicalHash(payloadHash, params.payload);
  return { requestKey, requestHash: payloadHash.digest("hex") };
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error && (error.code === "23505" || /duplicate|unique/i.test(error.message ?? ""))
  );
}

export async function claimChatExecution(
  admin: SupabaseClient,
  params: {
    requestKey: string;
    requestHash: string;
    visibility: ChatVisibility;
  }
): Promise<ChatExecutionClaim> {
  const { error: insertError } = await admin.from("amora_request_claims").insert({
    request_key: params.requestKey,
    request_hash: params.requestHash,
    visibility: params.visibility,
    status: "in_progress",
  });
  if (!insertError) return { action: "execute" };
  if (!isUniqueViolation(insertError)) {
    throw new ChatExecutionClaimError(
      "요청 중복 실행 방지 장부를 기록하지 못했습니다.",
      "claim_unavailable"
    );
  }

  const { data, error } = await admin
    .from("amora_request_claims")
    .select("request_hash, status, message_id, lease_expires_at")
    .eq("request_key", params.requestKey)
    .maybeSingle();
  if (error || !data) {
    throw new ChatExecutionClaimError(
      "기존 요청 상태를 확인하지 못했습니다.",
      "claim_unavailable"
    );
  }
  if (data.request_hash !== params.requestHash) {
    throw new ChatExecutionClaimError(
      "같은 요청 ID가 다른 내용에 재사용되었습니다.",
      "request_mismatch"
    );
  }
  if (data.status === "completed" && typeof data.message_id === "string") {
    return { action: "replay", messageId: data.message_id };
  }
  if (data.status === "completed") {
    throw new ChatExecutionClaimError(
      "완료된 요청의 응답은 다시 표시할 수 없습니다.",
      "replay_unavailable"
    );
  }
  if (data.status === "in_progress") {
    const leaseExpiresAt = Date.parse(
      typeof data.lease_expires_at === "string" ? data.lease_expires_at : ""
    );
    if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= Date.now()) {
      const { data: expired, error: expireError } = await admin.rpc(
        "expire_stale_amora_chat_request",
        {
          p_request_key: params.requestKey,
          p_request_hash: params.requestHash,
        }
      );
      if (expireError) {
        throw new ChatExecutionClaimError(
          "멈춘 요청의 상태를 안전하게 정리하지 못했습니다.",
          "claim_unavailable"
        );
      }
      if (expired === true) {
        throw new ChatExecutionClaimError(
          "이전 요청이 중단되어 새 요청 ID로 다시 시도해야 합니다.",
          "request_failed"
        );
      }
    }
  }
  if (data.status === "failed") {
    throw new ChatExecutionClaimError(
      "이 요청은 결과가 불확실해 안전하게 다시 실행할 수 없습니다.",
      "request_failed"
    );
  }
  throw new ChatExecutionClaimError(
    "같은 요청이 이미 처리 중입니다.",
    "request_in_progress"
  );
}

/** 실패 표시에 실패해도 in_progress tombstone이 남아 재실행을 막으므로 fail-closed다. */
export async function markChatExecutionFailed(
  admin: SupabaseClient,
  requestKey: string,
  requestHash: string
): Promise<void> {
  const { error } = await admin
    .from("amora_request_claims")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("request_key", requestKey)
    .eq("request_hash", requestHash)
    .eq("status", "in_progress");
  if (error) console.error("[chat-claim] failed 상태 기록 실패:", error.message);
}
