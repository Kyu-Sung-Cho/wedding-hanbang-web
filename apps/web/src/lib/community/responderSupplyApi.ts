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
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const RESPONDER_COMMERCIAL_RELATIONSHIPS = [
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

export type ResponderCommercialRelationship =
  (typeof RESPONDER_COMMERCIAL_RELATIONSHIPS)[number];

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, Cookie, Origin, Sec-Fetch-Site",
};

export function responderJson(
  body: unknown,
  status: number,
  extraHeaders?: HeadersInit,
) {
  return NextResponse.json(body, {
    status,
    headers: { ...PRIVATE_NO_STORE_HEADERS, ...extraHeaders },
  });
}

export function isResponderAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

type PrepareResponderMutationOptions = {
  maxBodyBytes: number;
  ratePrefix: string;
  rateLimit: RateLimitConfig;
  requireWriteAccess: boolean;
};

type PreparedResponderMutation = {
  ok: true;
  userId: string;
  idempotencyKey: string;
  enforceMutableGates: () => Promise<NextResponse | null>;
};

type RejectedResponderMutation = {
  ok: false;
  response: NextResponse;
};

export async function prepareResponderMutation(
  request: Request,
  options: PrepareResponderMutationOptions,
): Promise<PreparedResponderMutation | RejectedResponderMutation> {
  if (!isTrustedMutationRequest(request)) {
    return {
      ok: false,
      response: responderJson(
        {
          code: "COMMUNITY_RESPONDER_ORIGIN_REJECTED",
          error: "요청 출처를 확인할 수 없어요.",
        },
        403,
      ),
    };
  }
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: responderJson(
        {
          code: "COMMUNITY_RESPONDER_CONTENT_TYPE_INVALID",
          error: "JSON 형식의 요청만 처리할 수 있어요.",
        },
        415,
      ),
    };
  }
  if (isBodyTooLarge(request, options.maxBodyBytes)) {
    return {
      ok: false,
      response: responderJson(
        {
          code: "COMMUNITY_RESPONDER_BODY_TOO_LARGE",
          error: "응답자 요청이 너무 커요.",
        },
        413,
      ),
    };
  }

  const authClient = await createClientFromRequest(request);
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: responderJson(
        { code: "COMMUNITY_AUTH_REQUIRED", error: "로그인이 필요해요." },
        401,
      ),
    };
  }
  if (!isUuid(user.id)) {
    return {
      ok: false,
      response: responderJson(
        {
          code: "COMMUNITY_AUTH_INVALID",
          error: "로그인 정보를 안전하게 확인하지 못했어요.",
        },
        401,
      ),
    };
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!isUuid(idempotencyKey)) {
    return {
      ok: false,
      response: responderJson(
        {
          code: "COMMUNITY_RESPONDER_IDEMPOTENCY_REQUIRED",
          error: "요청 식별자가 올바르지 않아요.",
        },
        400,
      ),
    };
  }

  return {
    ok: true,
    userId: user.id,
    idempotencyKey,
    enforceMutableGates: async () => {
      if (options.requireWriteAccess) {
        const writeAccess = await checkCommunityWriteAccess(authClient, user.id);
        if (!writeAccess.allowed) {
          return responderJson(
            { code: writeAccess.code, error: writeAccess.message },
            writeAccess.status,
            writeAccess.status === 503 ? { "Retry-After": "60" } : undefined,
          );
        }
      }

      const limited = await checkRateLimitPersistent(
        rateLimitKey(options.ratePrefix, request, user.id),
        options.rateLimit,
        { failClosed: true },
      );
      if (limited) {
        limited.headers.set("Cache-Control", PRIVATE_NO_STORE_HEADERS["Cache-Control"]);
        limited.headers.set("Vary", PRIVATE_NO_STORE_HEADERS.Vary);
        return limited as NextResponse;
      }
      return null;
    },
  };
}

export async function readResponderJsonObject(
  request: Request,
  maxBodyBytes: number,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const rawBody = await readBoundedUtf8Text(request, maxBodyBytes);
  if (!rawBody.ok) {
    return {
      ok: false,
      response: responderJson(
        {
          code: rawBody.reason === "too_large"
            ? "COMMUNITY_RESPONDER_BODY_TOO_LARGE"
            : "COMMUNITY_RESPONDER_BODY_INVALID",
          error: rawBody.reason === "too_large"
            ? "응답자 요청이 너무 커요."
            : "응답자 요청을 읽을 수 없어요.",
        },
        rawBody.reason === "too_large" ? 413 : 400,
      ),
    };
  }

  try {
    const body = JSON.parse(rawBody.text) as unknown;
    if (!isRecord(body)) throw new TypeError("object body required");
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: responderJson(
        {
          code: "COMMUNITY_RESPONDER_BODY_INVALID",
          error: "응답자 요청 내용을 확인해 주세요.",
        },
        400,
      ),
    };
  }
}

type ResponderRpcError = {
  code?: string | null;
  message?: string | null;
};

export function responderRpcErrorResponse(error: ResponderRpcError) {
  const message = error.message?.toLowerCase() ?? "";
  if (error.code === "P0002") {
    return responderJson(
      { code: "COMMUNITY_RESPONDER_TARGET_NOT_FOUND", error: "응답 요청을 찾을 수 없어요." },
      404,
    );
  }
  if (
    error.code === "42501"
    && message.includes("eligible human responder required")
  ) {
    return responderJson(
      {
        code: "COMMUNITY_RESPONDER_NOT_ELIGIBLE",
        error: "현재 이 응답 요청을 처리할 수 없어요.",
      },
      403,
    );
  }
  if (
    error.code === "42501"
    && (
      message.includes("only the requested responder can decide")
      || message.includes("only the slot owner can revoke opt-in")
    )
  ) {
    return responderJson(
      { code: "COMMUNITY_RESPONDER_TARGET_NOT_FOUND", error: "응답 요청을 찾을 수 없어요." },
      404,
    );
  }
  if (
    error.code === "42501"
    && (
      message.includes("commercial relationship changed")
      || message.includes("request no longer has conflict-free confirmed capacity")
    )
  ) {
    return responderJson(
      {
        code: "COMMUNITY_RESPONDER_STATE_CONFLICT",
        error: "공개 관계나 응답 가능 상태가 바뀌어 새 확인이 필요해요.",
      },
      409,
    );
  }
  if (error.code === "42501") {
    return responderJson(
      {
        code: "COMMUNITY_RESPONDER_SERVICE_BOUNDARY_UNAVAILABLE",
        error: "응답자 권한 경계를 안전하게 확인하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
  if (error.code === "22023") {
    const conflict = message.includes("idempotency key reused");
    return responderJson(
      {
        code: conflict
          ? "COMMUNITY_RESPONDER_IDEMPOTENCY_CONFLICT"
          : "COMMUNITY_RESPONDER_REQUEST_INVALID",
        error: conflict
          ? "같은 요청 식별자를 다른 내용에 다시 사용할 수 없어요."
          : "응답자 요청 내용을 확인해 주세요.",
      },
      conflict ? 409 : 400,
    );
  }
  if (
    error.code === "55000"
    && message.includes("not accepting new work")
  ) {
    return responderJson(
      {
        code: "COMMUNITY_RESPONDER_RUNTIME_BLOCKED",
        error: "현재 새 응답 수락을 잠시 멈췄어요.",
      },
      503,
      { "Retry-After": "60" },
    );
  }
  if (
    error.code === "55000"
    && (message.includes("receipt") || message.includes("command is unavailable"))
  ) {
    return responderJson(
      {
        code: "COMMUNITY_RESPONDER_RECEIPT_UNAVAILABLE",
        error: "저장된 응답자 처리 결과를 안전하게 확인하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
  if (error.code === "55000" || error.code === "23505") {
    return responderJson(
      {
        code: "COMMUNITY_RESPONDER_STATE_CONFLICT",
        error: "이미 처리되었거나 현재 상태에서는 처리할 수 없는 요청이에요.",
      },
      409,
    );
  }
  return responderJson(
    {
      code: "COMMUNITY_RESPONDER_SAVE_FAILED",
      error: "응답자 요청을 안전하게 저장하지 못했어요.",
    },
    503,
    { "Retry-After": "30" },
  );
}

export type ResponderDecisionResult = {
  request_id: string;
  status: "accepted" | "declined";
  question_state: "private_waitlist" | "ready_for_review" | "withdrawn";
};

export function isResponderDecisionResult(
  value: unknown,
  requestId: string,
  expectedStatus: ResponderDecisionResult["status"],
): value is ResponderDecisionResult {
  return isRecord(value)
    && value.request_id === requestId
    && value.status === expectedStatus
    && isResponderAllowed(value.question_state, [
      "private_waitlist",
      "ready_for_review",
      "withdrawn",
    ] as const)
    && !Object.hasOwn(value, "replayed");
}

export type ResponderCommandOperation =
  | "register_capacity"
  | "respond_request"
  | "revoke_capacity";

type ResponderReplayResult =
  | {
      ok: true;
      kind: "new";
      serviceClient: ReturnType<typeof createAdminClient>;
    }
  | {
      ok: true;
      kind: "receipt";
      receipt: unknown;
      serviceClient: ReturnType<typeof createAdminClient>;
    }
  | { ok: false; response: NextResponse };

export async function preflightResponderCommand(
  actorId: string,
  operation: ResponderCommandOperation,
  idempotencyKey: string,
  payload: Record<string, unknown>,
): Promise<ResponderReplayResult> {
  const serviceClient = createAdminClient();
  const { data, error } = await serviceClient.rpc(
    "community_replay_responder_command_service" as never,
    {
      p_actor_id: actorId,
      p_operation: operation,
      p_idempotency_key: idempotencyKey,
      p_payload: payload,
    } as never,
  ) as { data: unknown; error: ResponderRpcError | null };
  if (error) return { ok: false, response: responderRpcErrorResponse(error) };
  return data === null
    ? { ok: true, kind: "new", serviceClient }
    : { ok: true, kind: "receipt", receipt: data, serviceClient };
}
