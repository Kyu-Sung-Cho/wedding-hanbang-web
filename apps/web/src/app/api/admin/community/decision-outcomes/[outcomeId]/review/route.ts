import { NextRequest, NextResponse } from "next/server";

import { parseDecisionOutcomeReviewReceipt } from "@/lib/community/decisionOutcomeReviewApi";
import { hasExactCompletedDecisionPublicationCommand } from "@/lib/community/decisionThreadApi";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import {
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import {
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      Vary: "Authorization, Cookie, Origin, Sec-Fetch-Site",
      ...headers,
    },
  });
}

function schemaUnavailable(error: { code?: string; message?: string } | null) {
  return Boolean(
    error
      && (
        ["42P01", "42703", "42883", "PGRST202"].includes(error.code ?? "")
        || error.message?.includes("community_review_decision_outcome")
      ),
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ outcomeId: string }> },
) {
  if (!isTrustedMutationRequest(request)) {
    return json({ error: "Forbidden" }, 403);
  }

  try {
    const { authorized, userId: adminId } = await verifyAdmin(request);
    if (!authorized || !adminId || !isUuid(adminId)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { outcomeId } = await context.params;
    const operationKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!isUuid(outcomeId) || !isUuid(operationKey)) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_INVALID",
          error: "검수 대상과 요청 식별자를 확인해 주세요.",
        },
        400,
      );
    }

    const mediaType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== "application/json") {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_CONTENT_TYPE_INVALID",
          error: "JSON 형식의 요청만 처리할 수 있어요.",
        },
        415,
      );
    }

    const raw = await readBoundedUtf8Text(request, 2_500);
    if (!raw.ok) {
      return json(
        {
          code: raw.reason === "too_large"
            ? "COMMUNITY_DECISION_PUBLICATION_BODY_TOO_LARGE"
            : "COMMUNITY_DECISION_PUBLICATION_REVIEW_INVALID",
          error: raw.reason === "too_large"
            ? "검수 사유가 너무 길어요."
            : "검수 요청을 읽지 못했어요.",
        },
        raw.reason === "too_large" ? 413 : 400,
      );
    }

    const body: unknown = (() => {
      try {
        return JSON.parse(raw.text) as unknown;
      } catch {
        return null;
      }
    })();
    if (
      !isRecord(body)
      || Object.keys(body).sort().join(",")
        !== ["decision", "policyVersion", "reason"].sort().join(",")
    ) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_INVALID",
          error: "검수 요청 항목을 확인해 주세요.",
        },
        400,
      );
    }
    const decision = body.decision;
    const reason = typeof body.reason === "string"
      ? sanitizeText(body.reason)
      : "";
    const policyVersion = typeof body.policyVersion === "string"
      ? body.policyVersion.trim()
      : "";
    if (
      (decision !== "publish" && decision !== "reject")
      || reason.length < 3
      || reason.length > 500
      || !/^[A-Za-z0-9._-]{1,64}$/u.test(policyVersion)
    ) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_INVALID",
          error: "승인 여부와 검수 사유, 정책 버전을 확인해 주세요.",
        },
        400,
      );
    }

    const operation = decision === "publish" ? "review_publish" : "review_reject";
    const serviceClient = getServiceClient();
    const limited = await checkRateLimitPersistent(
      rateLimitKey("admin-decision-outcome-review", request, adminId),
      { maxRequests: 60, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    if (limited) {
      const exactReplay = await hasExactCompletedDecisionPublicationCommand(
        {
          actorId: adminId,
          operation,
          operationKey,
          outcomeId,
          payload: {
            outcomeId,
            decision,
            reason,
            policyVersion,
          },
        },
        serviceClient,
      );
      if (!exactReplay) return limited;
    }

    const { data, error } = await serviceClient.rpc(
      "community_review_decision_outcome" as never,
      {
        p_admin_id: adminId,
        p_outcome_id: outcomeId,
        p_decision: decision,
        p_reason: reason,
        p_policy_version: policyVersion,
        p_operation_key: operationKey,
      } as never,
    );
    if (error) {
      const message = error.message ?? "";
      console.error("COMMUNITY_DECISION_OUTCOME_REVIEW_RPC_FAILED");
      if (schemaUnavailable(error)) {
        return json(
          {
            code: "COMMUNITY_DECISION_PUBLICATION_SCHEMA_UNAVAILABLE",
            error: "결과 검수 기능이 아직 준비되지 않았어요.",
          },
          503,
          { "Retry-After": "60" },
        );
      }
      if (error.code === "P0002") {
        return json(
          {
            code: "COMMUNITY_DECISION_PUBLICATION_NOT_FOUND",
            error: "검수할 결과를 찾지 못했어요.",
          },
          404,
        );
      }
      if (error.code === "23505" || message.includes("IDEMPOTENCY_CONFLICT")) {
        return json(
          {
            code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_CONFLICT",
            error: "같은 요청 식별자가 다른 검수 내용에 사용됐어요.",
          },
          409,
        );
      }
      if (error.code === "42501") {
        return json(
          {
            code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_FORBIDDEN",
            error: "이 결과를 검수할 권한이 없어요.",
          },
          403,
        );
      }
      if (error.code === "22023") {
        return json(
          {
            code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_INVALID",
            error: "검수 요청 내용을 확인해 주세요.",
          },
          400,
        );
      }
      if (error.code === "55000") {
        return json(
          {
            code: message.includes("SOURCE_UNAVAILABLE")
              ? "COMMUNITY_DECISION_PUBLICATION_SOURCE_UNAVAILABLE"
              : "COMMUNITY_DECISION_PUBLICATION_REVIEW_CONFLICT",
            error: message.includes("SOURCE_UNAVAILABLE")
              ? "원문이나 근거가 현재 공개 가능한 상태가 아니어서 승인할 수 없어요."
              : "이미 처리되었거나 현재 검수할 수 없는 결과예요.",
          },
          409,
        );
      }
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_FAILED",
          error: "결과 검수를 안전하게 기록하지 못했어요.",
        },
        503,
        { "Retry-After": "30" },
      );
    }

    const publicationState = decision === "publish" ? "published" : "rejected";
    const receipt = parseDecisionOutcomeReviewReceipt(data, {
      operationKey,
      outcomeId,
      publicationState,
    });
    if (!receipt) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_UNCONFIRMED",
          error: "검수 결과가 정확히 기록됐는지 확인하지 못했어요.",
        },
        503,
        { "Retry-After": "30" },
      );
    }
    return json(receipt);
  } catch {
    console.error("COMMUNITY_DECISION_OUTCOME_REVIEW_FAILED");
    return json(
      {
        code: "COMMUNITY_DECISION_PUBLICATION_REVIEW_FAILED",
        error: "결과 검수를 안전하게 기록하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
