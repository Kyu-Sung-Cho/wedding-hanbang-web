import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";
import type { ReportReason } from "@/types/community.types";

const MAX_REPORT_BODY_BYTES = 8 * 1024;
const MAX_REPORT_DETAILS_LENGTH = 500;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const VALID_REASONS = ["spam", "abuse", "ad", "inappropriate", "other"] as const;

type ReportBodyResult =
  | { ok: true; reason: ReportReason; details: string | null }
  | { ok: false; status: 400 | 413; error: string };

async function parseReportBody(req: NextRequest): Promise<ReportBodyResult> {
  if (isBodyTooLarge(req, MAX_REPORT_BODY_BYTES)) {
    return { ok: false, status: 413, error: "신고 내용이 너무 깁니다." };
  }

  const rawBody = await req.text().catch(() => null);
  if (rawBody === null) {
    return { ok: false, status: 400, error: "신고 형식이 올바르지 않습니다." };
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REPORT_BODY_BYTES) {
    return { ok: false, status: 413, error: "신고 내용이 너무 깁니다." };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "신고 형식이 올바르지 않습니다." };
  }

  if (!isRecord(body)) {
    return { ok: false, status: 400, error: "신고 형식이 올바르지 않습니다." };
  }
  const keys = Object.keys(body);
  if (
    keys.some((key) => key !== "reason" && key !== "details") ||
    !Object.prototype.hasOwnProperty.call(body, "reason") ||
    typeof body.reason !== "string" ||
    !(VALID_REASONS as readonly string[]).includes(body.reason) ||
    (Object.prototype.hasOwnProperty.call(body, "details") &&
      typeof body.details !== "string") ||
    (typeof body.details === "string" && body.details.length > MAX_REPORT_DETAILS_LENGTH)
  ) {
    return { ok: false, status: 400, error: "신고 형식이 올바르지 않습니다." };
  }

  const details = typeof body.details === "string"
    ? sanitizeText(body.details).slice(0, MAX_REPORT_DETAILS_LENGTH) || null
    : null;
  return { ok: true, reason: body.reason as ReportReason, details };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "댓글 ID가 올바르지 않습니다." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:comment:report", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1_000 },
      user.id,
    );
    if (limited) return limited;

    const parsed = await parseReportBody(req);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: parsed.status, headers: NO_STORE_HEADERS },
      );
    }

    // 사용자 세션의 RLS를 통과하는, 아직 삭제되지 않은 정확한 댓글만 신고한다.
    const viewerActorId = await getCommunityActorIdForUser(user.id);
    const { data: comment, error: commentError } = await supabase
      .from("community_comments")
      .select("id, author_id:author_public_id, is_deleted")
      .eq("id", id)
      .maybeSingle();
    if (commentError) {
      console.error("Report comment visibility check failed");
      return NextResponse.json(
        { error: "댓글 상태를 확인하지 못했습니다." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    if (!comment || comment.is_deleted) {
      return NextResponse.json(
        { error: "신고할 댓글을 찾을 수 없습니다." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    if (viewerActorId && comment.author_id === viewerActorId) {
      return NextResponse.json(
        { error: "본인이 작성한 댓글은 신고할 수 없습니다." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { error } = await createAdminClient()
      .from("community_reports")
      .insert({
        reporter_id: user.id,
        comment_id: id,
        reason: parsed.reason,
        description: parsed.details,
        status: "pending",
      });
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "이미 신고한 댓글입니다." },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "신고할 댓글을 찾을 수 없습니다." },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }
      console.error("Report comment failed");
      return NextResponse.json(
        { error: "신고 접수에 실패했습니다." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch {
    console.error("Report comment request failed");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
