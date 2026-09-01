import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/utils/log";
import { NextRequest, NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";

type DatabaseErrorShape = {
  code?: string;
  message?: string;
};

function isSchemaUnavailable(error: DatabaseErrorShape | null) {
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST200" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("community_moderation_") === true
  );
}

function unavailableResponse() {
  return NextResponse.json(
    {
      error:
        "운영 알림과 이의제기 기능을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      code: "COMMUNITY_MODERATION_NOTICE_SCHEMA_UNAVAILABLE",
    },
    { status: 503, headers: { "Retry-After": "60" } }
  );
}

export async function GET(request: NextRequest) {
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

    // Generated types intentionally lag forward migrations; RLS remains the
    // authorization boundary and limits both tables to the current user.
    const client = supabase as unknown as SupabaseClient;
    const { data: notices, error: noticeError } = await client
      .from("community_moderation_notices")
      .select(
        "id, event_id, target_type, target_id, action, reason, appeal_available, read_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (noticeError) {
      if (isSchemaUnavailable(noticeError)) return unavailableResponse();
      console.error("[community moderation notices] lookup failed:", {
        code: noticeError.code,
      });
      return NextResponse.json(
        {
          error: "운영 알림을 불러오지 못했어요.",
          code: "COMMUNITY_MODERATION_NOTICE_READ_FAILED",
        },
        { status: 500 }
      );
    }

    const eventIds = (notices ?? [])
      .map((notice) => notice.event_id)
      .filter((id): id is string => typeof id === "string");
    let appealByEvent = new Map<string, {
      id: string;
      status: string;
      reason: string;
      resolution_reason: string | null;
      created_at: string;
      resolved_at: string | null;
    }>();

    if (eventIds.length > 0) {
      const { data: appeals, error: appealError } = await client
        .from("community_moderation_appeals")
        .select(
          "id, event_id, status, reason, resolution_reason, created_at, resolved_at"
        )
        .in("event_id", eventIds);

      if (appealError) {
        if (isSchemaUnavailable(appealError)) return unavailableResponse();
        console.error("[community moderation notices] appeal lookup failed:", {
          code: appealError.code,
        });
        return NextResponse.json(
          {
            error: "이의제기 상태를 불러오지 못했어요.",
            code: "COMMUNITY_MODERATION_APPEAL_READ_FAILED",
          },
          { status: 500 }
        );
      }

      appealByEvent = new Map(
        (appeals ?? []).map((appeal) => [
          appeal.event_id as string,
          {
            id: appeal.id as string,
            status: appeal.status as string,
            reason: appeal.reason as string,
            resolution_reason:
              (appeal.resolution_reason as string | null) ?? null,
            created_at: appeal.created_at as string,
            resolved_at: (appeal.resolved_at as string | null) ?? null,
          },
        ])
      );
    }

    return NextResponse.json({
      notices: (notices ?? []).map((notice) => ({
        ...notice,
        appeal: appealByEvent.get(notice.event_id as string) ?? null,
      })),
    });
  } catch (error) {
    log.error("api/community/moderation/notices", error);
    console.error("[community moderation notices] unexpected:", error);
    return NextResponse.json(
      {
        error: "운영 알림을 불러오지 못했어요.",
        code: "COMMUNITY_MODERATION_NOTICE_READ_FAILED",
      },
      { status: 500 }
    );
  }
}
