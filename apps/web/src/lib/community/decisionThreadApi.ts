import { NextResponse } from "next/server";

import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  checkRateLimitPersistent,
  rateLimitKey,
  type RateLimitConfig,
} from "@/utils/rateLimit";
import {
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { sanitizeText } from "@/utils/sanitize";

export const DECISION_EXPERIENCE_SCOPES = [
  "contract_terms",
  "extra_charge",
  "vendor_response",
  "cancellation_refund",
] as const;

export const DECISION_STAGES = [
  "vendor_search",
  "contract_review",
  "contracted",
  "dispute_or_cancellation",
] as const;

export const DECISION_CONTRACT_PHASES = [
  "before_contract",
  "after_contract",
  "cancellation_or_refund",
] as const;

export const DECISION_EXPERIENCE_PERIODS = [
  "within_3_months",
  "within_6_months",
  "within_12_months",
  "over_12_months",
] as const;

export const DECISION_RELATIONSHIPS = [
  "none",
  "gift",
  "discount",
  "refund",
  "affiliate",
  "paid",
  "employee",
  "owner_or_family",
  "platform_research_compensation",
] as const;

export const DECISION_APPLICABILITY = [
  "applies",
  "conditions_differ",
  "need_more_info",
  "taken_as_next_action",
] as const;

export const DECISION_STATES = [
  "open",
  "answered",
  "resolved",
  "followup_scheduled",
  "completed",
  "closed",
] as const;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, Cookie, Origin, Sec-Fetch-Site",
};

export function decisionJson(
  payload: unknown,
  status: number,
  extraHeaders?: HeadersInit,
) {
  return NextResponse.json(payload, {
    status,
    headers: { ...PRIVATE_HEADERS, ...extraHeaders },
  });
}

export function isAllowed<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return (
    typeof value === "string" &&
    (values as readonly string[]).includes(value)
  );
}

export function hasExactKeys(
  body: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const expected = new Set(required);
  const actual = Object.keys(body);
  return (
    actual.length === expected.size &&
    actual.every((key) => expected.has(key))
  );
}

export function cleanRequiredText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== "string") return null;
  const cleaned = sanitizeText(value);
  return cleaned.length >= minimum && cleaned.length <= maximum
    ? cleaned
    : null;
}

export function cleanNullableText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const cleaned = sanitizeText(value);
  return cleaned.length >= minimum && cleaned.length <= maximum
    ? cleaned
    : undefined;
}

export function containsExactCalendarDate(value: string): boolean {
  return /(?:19|20)\d{2}\s*(?:[-./]\s*(?:0?[1-9]|1[0-2])\s*[-./]\s*(?:0?[1-9]|[12]\d|3[01])|년\s*(?:0?[1-9]|1[0-2])\s*월\s*(?:0?[1-9]|[12]\d|3[01])\s*일?)/u.test(
    value,
  );
}

type PrepareOptions = {
  maxBodyBytes: number;
  ratePrefix: string;
  rateLimit: RateLimitConfig;
  requireWriteAccess?: boolean;
  operation?:
    | "decision_thread_publish"
    | "decision_thread_answer"
    | "decision_thread_applicability"
    | "decision_thread_resolve"
    | "decision_thread_outcome"
    | "decision_thread_withdraw";
  publicationReplay?: {
    operation: "review_publish" | "review_reject" | "author_withdraw";
    outcomeId: string;
    payload: Record<string, unknown>;
    expectedBodyKeys: readonly string[];
  };
};

type DecisionCommandLookup = {
  from: (table: "community_commands") => {
    select: (columns: "status,result_payload") => {
      eq: (column: "actor_id", value: string) => {
        eq: (column: "operation", value: string) => {
          eq: (column: "idempotency_key", value: string) => {
            maybeSingle: () => Promise<{
              data: {
                status?: unknown;
                result_payload?: unknown;
              } | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };
};

async function hasDurableDecisionReceipt(
  actorId: string,
  operation: PrepareOptions["operation"],
  idempotencyKey: string,
) {
  if (!operation) return false;
  try {
    const admin = createAdminClient() as unknown as DecisionCommandLookup;
    const { data, error } = await admin
      .from("community_commands")
      .select("status,result_payload")
      .eq("actor_id", actorId)
      .eq("operation", operation)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    return !error
      && (data?.status === "succeeded" || data?.status === "terminal")
      && isRecord(data.result_payload);
  } catch {
    return false;
  }
}

type PublicationReplayClient = {
  rpc: (
    operation: string,
    params: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: unknown;
  }>;
};

export async function hasExactCompletedDecisionPublicationCommand(
  input: {
    actorId: string;
    operation: "review_publish" | "review_reject" | "author_withdraw";
    operationKey: string;
    outcomeId: string;
    payload: Record<string, unknown>;
  },
  client: unknown = createAdminClient(),
) {
  if (
    !isUuid(input.actorId)
    || !isUuid(input.operationKey)
    || !isUuid(input.outcomeId)
    || !isRecord(input.payload)
  ) return false;
  try {
    const { data, error } = await (client as PublicationReplayClient).rpc(
      "community_has_completed_decision_publication_command",
      {
        p_actor_id: input.actorId,
        p_operation: input.operation,
        p_operation_key: input.operationKey,
        p_outcome_id: input.outcomeId,
        p_payload: input.payload,
      },
    );
    return !error && data === true;
  } catch {
    return false;
  }
}

async function hasDurableMutationReceipt(
  actorId: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
  options: PrepareOptions,
) {
  if (await hasDurableDecisionReceipt(
    actorId,
    options.operation,
    idempotencyKey,
  )) return true;

  const replay = options.publicationReplay;
  return Boolean(
    replay
    && hasExactKeys(body, replay.expectedBodyKeys)
    && await hasExactCompletedDecisionPublicationCommand({
      actorId,
      operation: replay.operation,
      operationKey: idempotencyKey,
      outcomeId: replay.outcomeId,
      payload: replay.payload,
    })
  );
}

export async function prepareDecisionMutation(
  request: Request,
  options: PrepareOptions,
): Promise<
  | {
      ok: true;
      userId: string;
      idempotencyKey: string;
      body: Record<string, unknown>;
    }
  | { ok: false; response: NextResponse }
> {
  if (!isTrustedMutationRequest(request)) {
    return {
      ok: false,
      response: decisionJson(
        {
          code: "COMMUNITY_DECISION_ORIGIN_REJECTED",
          error: "요청 출처를 확인할 수 없어요.",
        },
        403,
      ),
    };
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: decisionJson(
        {
          code: "COMMUNITY_DECISION_CONTENT_TYPE_INVALID",
          error: "JSON 형식의 요청만 처리할 수 있어요.",
        },
        415,
      ),
    };
  }

  const authClient = await createClientFromRequest(request);
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return {
      ok: false,
      response: decisionJson(
        { code: "COMMUNITY_AUTH_REQUIRED", error: "로그인이 필요해요." },
        401,
      ),
    };
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!isUuid(idempotencyKey)) {
    return {
      ok: false,
      response: decisionJson(
        {
          code: "COMMUNITY_DECISION_IDEMPOTENCY_REQUIRED",
          error: "올바른 요청 식별자가 필요해요.",
        },
        400,
      ),
    };
  }

  const raw = await readBoundedUtf8Text(request, options.maxBodyBytes);
  if (!raw.ok) {
    const tooLarge = raw.reason === "too_large";
    return {
      ok: false,
      response: decisionJson(
        {
          code: tooLarge
            ? "COMMUNITY_DECISION_BODY_TOO_LARGE"
            : "COMMUNITY_DECISION_BODY_INVALID",
          error: tooLarge
            ? "요청 내용이 너무 커요."
            : "요청 내용을 읽을 수 없어요.",
        },
        tooLarge ? 413 : 400,
      ),
    };
  }

  try {
    const body = JSON.parse(raw.text) as unknown;
    if (!isRecord(body)) throw new TypeError("object required");

    if (options.requireWriteAccess !== false) {
      const access = await checkCommunityWriteAccess(authClient, user.id);
      if (!access.allowed) {
        const isDurableReplay = await hasDurableMutationReceipt(
          user.id,
          idempotencyKey,
          body,
          options,
        );
        if (!isDurableReplay) {
          return {
            ok: false,
            response: decisionJson(
              { code: access.code, error: access.message },
              access.status,
              access.status === 503 ? { "Retry-After": "60" } : undefined,
            ),
          };
        }
        return { ok: true, userId: user.id, idempotencyKey, body };
      }
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey(options.ratePrefix, request, user.id),
      options.rateLimit,
      { failClosed: true },
    );
    if (limited) {
      const isDurableReplay = await hasDurableMutationReceipt(
        user.id,
        idempotencyKey,
        body,
        options,
      );
      if (!isDurableReplay) return { ok: false, response: limited };
    }

    return { ok: true, userId: user.id, idempotencyKey, body };
  } catch {
    return {
      ok: false,
      response: decisionJson(
        {
          code: "COMMUNITY_DECISION_BODY_INVALID",
          error: "요청 내용을 확인해 주세요.",
        },
        400,
      ),
    };
  }
}

type RpcError = { code?: string | null; message?: string | null };

export function decisionRpcError(error: RpcError) {
  const message = error.message ?? "";
  if (error.code === "P0002") {
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_NOT_FOUND",
        error: "결정 질문을 찾을 수 없어요.",
      },
      404,
    );
  }
  if (message.includes("IDEMPOTENCY_CONFLICT") || error.code === "23505") {
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_CONFLICT",
        error:
          "같은 요청 식별자를 다른 내용에 다시 사용할 수 없거나 상태가 바뀌었어요.",
      },
      409,
    );
  }
  if (message.includes("STATE_UNCONFIRMED")) {
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
        error:
          "반영 여부를 확인 중이에요. 같은 요청 식별자로 다시 실행하지 마세요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
  if (error.code === "42501") {
    return decisionJson(
      {
        code: message.includes("INTERACTION_BLOCKED")
          ? "COMMUNITY_INTERACTION_BLOCKED"
          : "COMMUNITY_DECISION_FORBIDDEN",
        error: "현재 이 작업을 할 수 없어요.",
      },
      403,
    );
  }
  if (error.code === "22023") {
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_INVALID",
        error: "입력 내용을 확인해 주세요.",
      },
      400,
    );
  }
  if (error.code === "55000") {
    const runtimeBlocked = message.includes("RUNTIME_BLOCKED");
    return decisionJson(
      {
        code: runtimeBlocked
          ? "COMMUNITY_DECISION_RUNTIME_BLOCKED"
          : "COMMUNITY_DECISION_STATE_CONFLICT",
        error: runtimeBlocked
          ? "현재 커뮤니티 쓰기가 잠시 중단되었어요."
          : "현재 상태에서는 이 작업을 할 수 없어요.",
      },
      runtimeBlocked ? 503 : 409,
      runtimeBlocked ? { "Retry-After": "60" } : undefined,
    );
  }
  return decisionJson(
    {
      code: "COMMUNITY_DECISION_SAVE_FAILED",
      error: "안전하게 저장하지 못했어요.",
    },
    503,
    { "Retry-After": "30" },
  );
}

export function isRpcObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function invalidDecisionBody(error = "입력 내용을 확인해 주세요.") {
  return decisionJson(
    { code: "COMMUNITY_DECISION_INVALID", error },
    422,
  );
}

export function stateUnconfirmedResponse() {
  return decisionJson(
    {
      code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
      error: "저장 결과를 안전하게 확인하지 못했어요.",
    },
    503,
    { "Retry-After": "30" },
  );
}
