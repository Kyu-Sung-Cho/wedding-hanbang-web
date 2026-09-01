import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/utils/log";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isUuid } from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const ORIGINS = [
  "member",
  "operator",
  "ai",
  "industry_professional",
  "legacy_unverified",
] as const;

const CLASSIFIABLE_ORIGINS = ORIGINS.filter(
  (origin) => origin !== "legacy_unverified"
);

function isSchemaUnavailable(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "42703" ||
    error?.code === "42P01" ||
    error?.code === "42883" ||
    error?.code === "PGRST202" ||
    error?.code === "PGRST204" ||
    error?.message?.includes("content_origin") === true ||
    error?.message?.includes("community_reclassify_content_origin") === true
  );
}

function schemaUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "콘텐츠 출처 분류 스키마가 아직 적용되지 않아 목록이나 변경을 제공할 수 없습니다.",
      code: "COMMUNITY_PROVENANCE_SCHEMA_UNAVAILABLE",
    },
    { status: 503, headers: { "Retry-After": "60" } }
  );
}

function textPreview(value: unknown) {
  return typeof value === "string"
    ? sanitizeText(value.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300)
    : "";
}

export async function GET(request: NextRequest) {
  try {
    const { authorized } = await verifyAdmin(request);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const origin = url.searchParams.get("origin") ?? "legacy_unverified";
    const target = url.searchParams.get("target") ?? "all";
    const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 50;

    if (!ORIGINS.includes(origin as (typeof ORIGINS)[number])) {
      return NextResponse.json(
        { error: "올바른 출처 상태가 아닙니다." },
        { status: 400 }
      );
    }
    if (!["all", "post", "comment"].includes(target)) {
      return NextResponse.json(
        { error: "올바른 콘텐츠 유형이 아닙니다." },
        { status: 400 }
      );
    }

    const client = getServiceClient() as unknown as SupabaseClient;
    const postRequest =
      target === "comment"
        ? Promise.resolve({ data: [], error: null })
        : client
            .from("community_posts")
            .select(
              "id, author_id, content_origin, title, content, visibility, created_at"
            )
            .eq("content_origin", origin)
            .order("created_at", { ascending: true })
            .limit(limit);
    const commentRequest =
      target === "post"
        ? Promise.resolve({ data: [], error: null })
        : client
            .from("community_comments")
            .select(
              "id, post_id, author_id, content_origin, content, is_deleted, created_at"
            )
            .eq("content_origin", origin)
            .order("created_at", { ascending: true })
            .limit(limit);

    const [postResult, commentResult] = await Promise.all([
      postRequest,
      commentRequest,
    ]);
    if (postResult.error) {
      if (isSchemaUnavailable(postResult.error)) {
        return schemaUnavailableResponse();
      }
      throw postResult.error;
    }
    if (commentResult.error) {
      if (isSchemaUnavailable(commentResult.error)) {
        return schemaUnavailableResponse();
      }
      throw commentResult.error;
    }

    const rawItems = [
      ...(postResult.data ?? []).map((post) => ({
        target_type: "post" as const,
        id: post.id as string,
        post_id: post.id as string,
        author_id: post.author_id as string,
        content_origin: post.content_origin as string,
        title: textPreview(post.title),
        preview: textPreview(post.content),
        state: post.visibility as string,
        created_at: post.created_at as string,
      })),
      ...(commentResult.data ?? []).map((comment) => ({
        target_type: "comment" as const,
        id: comment.id as string,
        post_id: comment.post_id as string,
        author_id: comment.author_id as string,
        content_origin: comment.content_origin as string,
        title: "답변",
        preview: textPreview(comment.content),
        state: comment.is_deleted ? "deleted" : "visible",
        created_at: comment.created_at as string,
      })),
    ].sort(
      (left, right) =>
        new Date(left.created_at).getTime() -
        new Date(right.created_at).getTime()
    );

    const authorIds = [...new Set(rawItems.map((item) => item.author_id))];
    let authorMap = new Map<
      string,
      { nickname: string; is_suspended: boolean }
    >();
    if (authorIds.length > 0) {
      const { data: profiles, error: profileError } = await client
        .from("community_profiles")
        .select("user_id, nickname, is_suspended")
        .in("user_id", authorIds);
      if (profileError) throw profileError;
      authorMap = new Map(
        (profiles ?? []).map((profile) => [
          profile.user_id as string,
          {
            nickname: (profile.nickname as string | null) ?? "익명",
            is_suspended: profile.is_suspended === true,
          },
        ])
      );
    }

    return NextResponse.json({
      items: rawItems.slice(0, limit).map((item) => ({
        ...item,
        author: authorMap.get(item.author_id) ?? {
          nickname: "프로필 없음",
          is_suspended: false,
        },
      })),
      limit,
    });
  } catch (error) {
    log.error("api/admin/community/provenance", error);
    console.error("[admin community provenance] list failed:", error);
    return NextResponse.json(
      {
        error: "출처 분류 대기열을 불러오지 못했습니다.",
        code: "COMMUNITY_PROVENANCE_READ_FAILED",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      {
        error: "요청 출처를 확인할 수 없습니다.",
        code: "COMMUNITY_PROVENANCE_ORIGIN_REJECTED",
      },
      { status: 403 }
    );
  }

  try {
    const { authorized, userId: adminId } = await verifyAdmin(request);
    if (!authorized || !adminId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "분류 요청을 확인해 주세요." },
        { status: 400 }
      );
    }

    const targetType =
      "target_type" in body ? String(body.target_type) : "";
    const targetId = "target_id" in body ? body.target_id : null;
    const newOrigin = "new_origin" in body ? String(body.new_origin) : "";
    const reason =
      "reason" in body ? sanitizeText(String(body.reason)).trim() : "";

    if (!["post", "comment"].includes(targetType) || !isUuid(targetId)) {
      return NextResponse.json(
        { error: "분류할 콘텐츠를 확인하지 못했습니다." },
        { status: 400 }
      );
    }
    if (
      !CLASSIFIABLE_ORIGINS.includes(
        newOrigin as (typeof CLASSIFIABLE_ORIGINS)[number]
      )
    ) {
      return NextResponse.json(
        { error: "확정할 출처를 선택해 주세요." },
        { status: 400 }
      );
    }
    if (reason.length < 5 || reason.length > 2_000) {
      return NextResponse.json(
        { error: "확인 근거를 5자 이상 2,000자 이하로 입력해 주세요." },
        { status: 400 }
      );
    }

    const client = getServiceClient() as unknown as SupabaseClient;
    const { data, error } = await client.rpc(
      "community_reclassify_content_origin",
      {
        p_target_type: targetType,
        p_target_id: targetId,
        p_new_origin: newOrigin,
        p_reason: reason,
        p_admin_id: adminId,
      }
    );

    if (error) {
      if (isSchemaUnavailable(error)) return schemaUnavailableResponse();
      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "분류할 콘텐츠를 찾을 수 없습니다." },
          { status: 404 }
        );
      }
      console.error("[admin community provenance] reclassify failed:", {
        code: error.code,
      });
      return NextResponse.json(
        {
          error: "출처 변경을 감사 기록과 함께 저장하지 못했습니다.",
          code: "COMMUNITY_PROVENANCE_WRITE_FAILED",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    log.error("api/admin/community/provenance", error);
    console.error("[admin community provenance] unexpected:", error);
    return NextResponse.json(
      {
        error: "출처 변경을 감사 기록과 함께 저장하지 못했습니다.",
        code: "COMMUNITY_PROVENANCE_WRITE_FAILED",
      },
      { status: 500 }
    );
  }
}
