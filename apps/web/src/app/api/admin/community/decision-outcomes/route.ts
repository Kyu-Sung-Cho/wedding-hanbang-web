import { NextRequest, NextResponse } from "next/server";

import {
  DECISION_PUBLICATION_STATES,
  parseDecisionOutcomeReviewQueue,
  type DecisionPublicationState,
} from "@/lib/community/decisionOutcomeReviewApi";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isUuid } from "@/utils/requestValidation";

const ALLOWED_QUERY = new Set(["state", "cursorAt", "cursorId", "limit"]);

function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      Vary: "Authorization, Cookie",
      ...headers,
    },
  });
}

function unavailable(error: { code?: string; message?: string } | null) {
  return Boolean(
    error
      && (
        ["42P01", "42703", "42883", "PGRST202"].includes(error.code ?? "")
        || error.message?.includes("community_list_decision_outcome_reviews")
      ),
  );
}

export async function GET(request: NextRequest) {
  try {
    const { authorized } = await verifyAdmin(request);
    if (!authorized) return json({ error: "Unauthorized" }, 401);

    const params = request.nextUrl.searchParams;
    if (
      [...params.keys()].some((key) => !ALLOWED_QUERY.has(key))
      || [...ALLOWED_QUERY].some((key) => params.getAll(key).length > 1)
    ) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_INVALID",
          error: "검수 대기열 조건을 확인해 주세요.",
        },
        400,
      );
    }

    const rawState = params.get("state") ?? "pending_review";
    if (!DECISION_PUBLICATION_STATES.includes(
      rawState as DecisionPublicationState,
    )) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_INVALID",
          error: "검수 상태를 확인해 주세요.",
        },
        400,
      );
    }
    const state = rawState as DecisionPublicationState;

    const rawLimit = params.get("limit") ?? "20";
    if (!/^[0-9]+$/u.test(rawLimit)) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_INVALID",
          error: "한 번에 불러올 결과 수를 확인해 주세요.",
        },
        400,
      );
    }
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_INVALID",
          error: "한 번에 1개에서 50개까지 확인할 수 있어요.",
        },
        400,
      );
    }

    const rawCursorAt = params.get("cursorAt");
    const rawCursorId = params.get("cursorId");
    if ((rawCursorAt === null) !== (rawCursorId === null)) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_INVALID",
          error: "다음 페이지 위치를 확인해 주세요.",
        },
        400,
      );
    }
    let cursorAt: string | null = null;
    let cursorId: string | null = null;
    if (rawCursorAt !== null && rawCursorId !== null) {
      const timestamp = Date.parse(rawCursorAt);
      if (!Number.isFinite(timestamp) || !isUuid(rawCursorId)) {
        return json(
          {
            code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_INVALID",
            error: "다음 페이지 위치를 확인해 주세요.",
          },
          400,
        );
      }
      cursorAt = new Date(timestamp).toISOString();
      cursorId = rawCursorId;
    }

    const { data, error } = await getServiceClient().rpc(
      "community_list_decision_outcome_reviews" as never,
      {
        p_state: state,
        p_cursor_at: cursorAt,
        p_cursor_id: cursorId,
        p_limit: limit,
      } as never,
    );
    if (error) {
      console.error("COMMUNITY_DECISION_OUTCOME_QUEUE_RPC_FAILED");
      if (unavailable(error)) {
        return json(
          {
            code: "COMMUNITY_DECISION_PUBLICATION_SCHEMA_UNAVAILABLE",
            error: "결과 검수 기능이 아직 준비되지 않았어요.",
          },
          503,
          { "Retry-After": "60" },
        );
      }
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_FAILED",
          error: "결과 검수 대기열을 불러오지 못했어요.",
        },
        503,
        { "Retry-After": "30" },
      );
    }

    const queue = parseDecisionOutcomeReviewQueue(data, state);
    if (!queue) {
      return json(
        {
          code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_UNCONFIRMED",
          error: "검수 대기열의 안전한 형태를 확인하지 못했어요.",
        },
        503,
        { "Retry-After": "30" },
      );
    }
    return json(queue);
  } catch {
    console.error("COMMUNITY_DECISION_OUTCOME_QUEUE_FAILED");
    return json(
      {
        code: "COMMUNITY_DECISION_PUBLICATION_QUEUE_FAILED",
        error: "결과 검수 대기열을 불러오지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
