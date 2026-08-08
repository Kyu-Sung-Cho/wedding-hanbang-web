import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { sanitizeText } from "@/utils/sanitize";
import {
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import type { ReportReason } from "@/types/community.types";

const MAX_REPORT_BODY_BYTES = 8 * 1024;

const VALID_REASONS: ReadonlySet<ReportReason> = new Set([
  "spam",
  "abuse",
  "ad",
  "privacy",
  "inappropriate",
  "other",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DatabaseErrorShape = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function databaseErrorText(error: DatabaseErrorShape): string {
  return [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function isCommunityReportSchemaUnavailable(
  error: DatabaseErrorShape | null | undefined,
): boolean {
  if (!error) return false;
  const code = typeof error.code === "string" ? error.code : "";
  if (
    code === "42703" ||
    code === "42P01" ||
    code === "PGRST200" ||
    code === "PGRST204" ||
    code === "PGRST205"
  ) {
    return true;
  }

  const text = databaseErrorText(error);
  return (
    text.includes("content_origin") ||
    text.includes("community_reports") ||
    text.includes("schema cache")
  );
}

function schemaUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "신고 기능의 안전 설정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      code: "COMMUNITY_REPORT_SCHEMA_UNAVAILABLE",
    },
    {
      status: 503,
      headers: { "Retry-After": "60" },
    },
  );
}

function duplicateReportResponse() {
  return NextResponse.json(
    {
      error:
        "이미 접수한 답변이에요. 운영팀의 검토 결과를 기다려 주세요.",
      code: "COMMUNITY_REPORT_ALREADY_EXISTS",
    },
    { status: 409 },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      {
        error: "요청 출처를 확인할 수 없어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
        code: "COMMUNITY_REPORT_ORIGIN_REJECTED",
      },
      { status: 403 },
    );
  }
  if (isBodyTooLarge(req, MAX_REPORT_BODY_BYTES)) {
    return NextResponse.json(
      {
        error: "신고 내용이 너무 길어요.",
        code: "COMMUNITY_REPORT_BODY_TOO_LARGE",
      },
      { status: 413 },
    );
  }

  try {
    const { id: commentId } = await params;
    if (!UUID_PATTERN.test(commentId)) {
      return NextResponse.json(
        {
          error: "신고할 답변을 확인하지 못했어요.",
          code: "COMMUNITY_COMMENT_ID_INVALID",
        },
        { status: 400 },
      );
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "로그인 후 신고할 수 있어요.",
          code: "COMMUNITY_AUTH_REQUIRED",
        },
        { status: 401 },
      );
    }

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        {
          error: writeAccess.message,
          code: writeAccess.code,
        },
        {
          status: writeAccess.status,
          headers:
            writeAccess.status === 503 ? { "Retry-After": "60" } : undefined,
        },
      );
    }

    const rateLimitResponse = await checkRateLimitPersistent(
      rateLimitKey("community:comment:report", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 },
    );
    if (rateLimitResponse) return rateLimitResponse;

    const bodyResult = await readBoundedUtf8Text(req, MAX_REPORT_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        {
          error:
            bodyResult.reason === "too_large"
              ? "신고 내용이 너무 길어요."
              : "신고 내용을 읽을 수 없어요.",
          code:
            bodyResult.reason === "too_large"
              ? "COMMUNITY_REPORT_BODY_TOO_LARGE"
              : "COMMUNITY_REPORT_BODY_INVALID",
        },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }

    let body: { reason?: unknown; details?: unknown };
    try {
      body = JSON.parse(bodyResult.text) as {
        reason?: unknown;
        details?: unknown;
      };
    } catch {
      return NextResponse.json(
        {
          error: "신고 내용을 확인해 주세요.",
          code: "COMMUNITY_REPORT_BODY_INVALID",
        },
        { status: 400 },
      );
    }

    const reason =
      typeof body.reason === "string" &&
      VALID_REASONS.has(body.reason as ReportReason)
        ? (body.reason as ReportReason)
        : null;
    if (!reason) {
      return NextResponse.json(
        {
          error: "신고 이유를 선택해 주세요.",
          code: "COMMUNITY_REPORT_REASON_INVALID",
        },
        { status: 400 },
      );
    }

    const description =
      typeof body.details === "string"
        ? sanitizeText(body.details).trim().slice(0, 1000) || null
        : null;

    // user-scoped 조회로 대상 답변과 그 부모 글을 현재 사용자도 열람할 수 있는지 확인한다.
    // content_origin을 함께 요청해 신뢰 마이그레이션이 없으면 신고 쓰기를 중단한다.
    const { data: comment, error: commentError } = await supabase
      .from("community_comments")
      .select("id, post_id, author_id, is_deleted, content_origin")
      .eq("id", commentId)
      .maybeSingle();

    if (commentError) {
      if (isCommunityReportSchemaUnavailable(commentError)) {
        return schemaUnavailableResponse();
      }
      console.error("[community comment report] target lookup failed:", {
        code: commentError.code,
      });
      return NextResponse.json(
        {
          error:
            "신고할 답변의 접근 권한을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "COMMUNITY_COMMENT_ACCESS_UNAVAILABLE",
        },
        {
          status: 503,
          headers: { "Retry-After": "30" },
        },
      );
    }

    if (!comment || comment.is_deleted === true) {
      return NextResponse.json(
        {
          error: "신고할 답변을 찾을 수 없거나 현재 볼 수 없어요.",
          code: "COMMUNITY_COMMENT_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    if (comment.author_id === user.id) {
      return NextResponse.json(
        {
          error: "본인이 작성한 답변은 신고할 수 없어요.",
          code: "COMMUNITY_SELF_REPORT_NOT_ALLOWED",
        },
        { status: 400 },
      );
    }

    const { data: post, error: postError } = await supabase
      .from("community_posts")
      .select("id, author_id, visibility, under_review")
      .eq("id", comment.post_id)
      .maybeSingle();

    if (postError) {
      if (isCommunityReportSchemaUnavailable(postError)) {
        return schemaUnavailableResponse();
      }
      console.error("[community comment report] parent post lookup failed:", {
        code: postError.code,
      });
      return NextResponse.json(
        {
          error:
            "답변이 있는 글의 접근 권한을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "COMMUNITY_POST_ACCESS_UNAVAILABLE",
        },
        {
          status: 503,
          headers: { "Retry-After": "30" },
        },
      );
    }

    if (!post || !canReadCommunityPost(post, { userId: user.id })) {
      return NextResponse.json(
        {
          error: "신고할 답변을 찾을 수 없거나 현재 볼 수 없어요.",
          code: "COMMUNITY_COMMENT_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    const serviceClient = createAdminClient();
    const { data: existingReport, error: duplicateCheckError } =
      await serviceClient
        .from("community_reports")
        .select("id")
        .eq("reporter_id", user.id)
        .eq("comment_id", commentId)
        .maybeSingle();

    if (duplicateCheckError) {
      if (isCommunityReportSchemaUnavailable(duplicateCheckError)) {
        return schemaUnavailableResponse();
      }
      console.error(
        "[community comment report] duplicate check failed:",
        { code: duplicateCheckError.code },
      );
      return NextResponse.json(
        {
          error:
            "기존 신고 여부를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "COMMUNITY_REPORT_CHECK_UNAVAILABLE",
        },
        {
          status: 503,
          headers: { "Retry-After": "30" },
        },
      );
    }

    if (existingReport) return duplicateReportResponse();

    const { error: insertError } = await serviceClient
      .from("community_reports")
      .insert({
        reporter_id: user.id,
        post_id: null,
        comment_id: commentId,
        reason,
        description,
        status: "pending",
      });

    if (insertError) {
      if (insertError.code === "23505") return duplicateReportResponse();
      if (isCommunityReportSchemaUnavailable(insertError)) {
        return schemaUnavailableResponse();
      }
      console.error("[community comment report] insert failed:", {
        code: insertError.code,
      });
      return NextResponse.json(
        {
          error:
            "신고를 안전하게 접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "COMMUNITY_REPORT_SUBMISSION_UNAVAILABLE",
        },
        {
          status: 503,
          headers: { "Retry-After": "30" },
        },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "신고를 접수했어요. 운영팀이 맥락을 함께 확인할게요.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[community comment report] unexpected error:", error);
    return NextResponse.json(
      {
        error:
          "신고 서비스를 잠시 사용할 수 없어요. 잠시 후 다시 시도해 주세요.",
        code: "COMMUNITY_REPORT_UNAVAILABLE",
      },
      {
        status: 503,
        headers: { "Retry-After": "30" },
      },
    );
  }
}
