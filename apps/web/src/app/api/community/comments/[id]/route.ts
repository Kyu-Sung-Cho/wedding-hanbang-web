import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { COMMUNITY_COMMENT_PUBLIC_SELECT } from "@/lib/community/commentSelect";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_PATCH_BODY_BYTES = 16 * 1024;
const MAX_COMMENT_LENGTH = 2_000;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
async function authenticatedUser(req: NextRequest) {
  const supabase = await createClientFromRequest(req);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return {
      user: null,
      response: NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (!user) {
    return {
      user: null,
      response: NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { user, response: null };
}

type CommentBodyResult =
  | { ok: true; content: string }
  | { ok: false; status: 400 | 413; error: string };

async function parseCommentBody(req: NextRequest): Promise<CommentBodyResult> {
  if (isBodyTooLarge(req, MAX_PATCH_BODY_BYTES)) {
    return { ok: false, status: 413, error: "댓글 수정 내용이 너무 깁니다." };
  }

  const rawBody = await req.text().catch(() => null);
  if (rawBody === null) {
    return { ok: false, status: 400, error: "댓글 수정 형식이 올바르지 않습니다." };
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_PATCH_BODY_BYTES) {
    return { ok: false, status: 413, error: "댓글 수정 내용이 너무 깁니다." };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "댓글 수정 형식이 올바르지 않습니다." };
  }

  if (
    !isRecord(body) ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "content") ||
    typeof body.content !== "string" ||
    body.content.length > MAX_COMMENT_LENGTH
  ) {
    return { ok: false, status: 400, error: "댓글 수정 형식이 올바르지 않습니다." };
  }

  // Comments are rendered as plain text. Store the same representation users
  // will see so markup is never preserved as misleading literal text.
  const content = sanitizeText(body.content);
  if (!content || content.length > MAX_COMMENT_LENGTH) {
    return { ok: false, status: 400, error: "댓글 내용을 확인해주세요." };
  }
  return { ok: true, content };
}

export async function PATCH(
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

    const { user, response } = await authenticatedUser(req);
    if (!user) return response!;

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:comment:update", req, user.id),
      { maxRequests: 30, windowMs: 60 * 60 * 1_000 },
      user.id,
    );
    if (limited) return limited;

    const parsed = await parseCommentBody(req);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: parsed.status, headers: NO_STORE_HEADERS },
      );
    }

    // service_role 사용 시에도 행 조건에 인증된 작성자를 포함한다. 관리자
    // 처리는 별도 moderation API에서만 수행하고 이 공개 경로는 작성자 전용이다.
    const { data: comment, error } = await createAdminClient()
      .from("community_comments")
      .update({ content: parsed.content, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("author_id", user.id)
      .eq("is_deleted", false)
      .select(COMMUNITY_COMMENT_PUBLIC_SELECT)
      .maybeSingle();

    if (error) {
      console.error("Update comment failed");
      return NextResponse.json(
        { error: "댓글 수정에 실패했습니다." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    if (!comment) {
      return NextResponse.json(
        { error: "수정할 수 있는 댓글을 찾을 수 없습니다." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { comment: { ...comment, viewer_is_author: true } },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("Update comment request failed");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function DELETE(
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

    const { user, response } = await authenticatedUser(req);
    if (!user) return response!;

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:comment:delete", req, user.id),
      { maxRequests: 10, windowMs: 60 * 60 * 1_000 },
      user.id,
    );
    if (limited) return limited;

    // RPC가 댓글 행을 잠그고 actor=author를 다시 확인한 뒤 댓글·게시글·프로필
    // 집계를 한 트랜잭션에서 갱신한다. 재시도된 삭제는 집계를 중복 차감하지 않는다.
    const { data, error } = await createAdminClient().rpc(
      "community_soft_delete_comment",
      { p_actor_id: user.id, p_comment_id: id },
    );

    if (error) {
      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "삭제할 수 있는 댓글을 찾을 수 없습니다." },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }
      console.error("Delete comment failed");
      return NextResponse.json(
        { error: "댓글 삭제에 실패했습니다." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.comment_id !== id || result.author_id !== user.id) {
      console.error("Delete comment verification failed");
      return NextResponse.json(
        { error: "댓글 삭제 결과를 확인하지 못했습니다." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { success: true, alreadyDeleted: result.deleted === false },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("Delete comment request failed");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
