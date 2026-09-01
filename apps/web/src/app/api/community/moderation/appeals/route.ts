import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/utils/log";
import { NextRequest, NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import {
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_APPEAL_BODY_BYTES = 8 * 1024;

export async function POST(request: NextRequest) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      {
        error: "요청 출처를 확인할 수 없어요.",
        code: "COMMUNITY_MODERATION_APPEAL_ORIGIN_REJECTED",
      },
      { status: 403 }
    );
  }

  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다.", code: "COMMUNITY_AUTH_REQUIRED" },
        { status: 401 }
      );
    }

    // 정지된 이용자도 본인에게 내려진 조치에는 이의를 제기할 수 있다.
    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:moderation:appeal", request, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 }
    );
    if (limited) return limited;

    const bodyResult = await readBoundedUtf8Text(
      request,
      MAX_APPEAL_BODY_BYTES
    );
    if (!bodyResult.ok) {
      return NextResponse.json(
        {
          error: "이의제기 내용을 읽을 수 없어요.",
          code: "COMMUNITY_MODERATION_APPEAL_BODY_INVALID",
        },
        { status: bodyResult.reason === "too_large" ? 413 : 400 }
      );
    }

    let body: { event_id?: unknown; reason?: unknown };
    try {
      body = JSON.parse(bodyResult.text) as {
        event_id?: unknown;
        reason?: unknown;
      };
    } catch {
      return NextResponse.json(
        {
          error: "이의제기 내용을 확인해 주세요.",
          code: "COMMUNITY_MODERATION_APPEAL_BODY_INVALID",
        },
        { status: 400 }
      );
    }

    const eventId = isUuid(body.event_id) ? body.event_id : null;
    const reason =
      typeof body.reason === "string"
        ? sanitizeText(body.reason).trim().slice(0, 2_000)
        : "";
    if (!eventId || reason.length < 10) {
      return NextResponse.json(
        {
          error: "조치 알림과 이의제기 사유를 10자 이상 입력해 주세요.",
          code: "COMMUNITY_MODERATION_APPEAL_INVALID",
        },
        { status: 400 }
      );
    }

    const client = supabase as unknown as SupabaseClient;
    const { data, error } = await client
      .from("community_moderation_appeals")
      .insert({
        event_id: eventId,
        appellant_id: user.id,
        reason,
      })
      .select("id, event_id, status, reason, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error: "이미 접수한 이의제기예요.",
            code: "COMMUNITY_MODERATION_APPEAL_ALREADY_EXISTS",
          },
          { status: 409 }
        );
      }
      if (error.code === "42501") {
        return NextResponse.json(
          {
            error: "이 조치에는 이의를 제기할 수 없어요.",
            code: "COMMUNITY_MODERATION_APPEAL_FORBIDDEN",
          },
          { status: 403 }
        );
      }
      if (
        error.code === "42P01" ||
        error.code === "PGRST204" ||
        error.code === "PGRST205"
      ) {
        return NextResponse.json(
          {
            error: "이의제기 기능이 아직 준비되지 않았어요.",
            code: "COMMUNITY_MODERATION_APPEAL_SCHEMA_UNAVAILABLE",
          },
          { status: 503, headers: { "Retry-After": "60" } }
        );
      }

      console.error("[community moderation appeal] insert failed:", {
        code: error.code,
      });
      return NextResponse.json(
        {
          error: "이의제기를 접수하지 못했어요.",
          code: "COMMUNITY_MODERATION_APPEAL_CREATE_FAILED",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ appeal: data }, { status: 201 });
  } catch (error) {
    log.error("api/community/moderation/appeals", error);
    console.error("[community moderation appeal] unexpected:", error);
    return NextResponse.json(
      {
        error: "이의제기를 접수하지 못했어요.",
        code: "COMMUNITY_MODERATION_APPEAL_CREATE_FAILED",
      },
      { status: 500 }
    );
  }
}
