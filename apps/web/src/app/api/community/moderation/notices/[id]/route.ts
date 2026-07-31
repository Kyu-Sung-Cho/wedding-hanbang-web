import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      {
        error: "요청 출처를 확인할 수 없어요.",
        code: "COMMUNITY_MODERATION_NOTICE_ORIGIN_REJECTED",
      },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        {
          error: "운영 알림을 확인하지 못했어요.",
          code: "COMMUNITY_MODERATION_NOTICE_ID_INVALID",
        },
        { status: 400 }
      );
    }

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

    const client = supabase as unknown as SupabaseClient;
    const { error } = await client
      .from("community_moderation_notices")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);

    if (error) {
      const schemaUnavailable =
        error.code === "42P01" ||
        error.code === "PGRST204" ||
        error.code === "PGRST205";
      return NextResponse.json(
        {
          error: schemaUnavailable
            ? "운영 알림 기능이 아직 준비되지 않았어요."
            : "읽음 상태를 저장하지 못했어요.",
          code: schemaUnavailable
            ? "COMMUNITY_MODERATION_NOTICE_SCHEMA_UNAVAILABLE"
            : "COMMUNITY_MODERATION_NOTICE_UPDATE_FAILED",
        },
        { status: schemaUnavailable ? 503 : 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[community moderation notice read] unexpected:", error);
    return NextResponse.json(
      {
        error: "읽음 상태를 저장하지 못했어요.",
        code: "COMMUNITY_MODERATION_NOTICE_UPDATE_FAILED",
      },
      { status: 500 }
    );
  }
}
