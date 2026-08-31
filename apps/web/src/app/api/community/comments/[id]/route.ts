import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeText } from "@/utils/sanitize";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import {
  findObviousPublicPersonalInfo,
  PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
} from "@/lib/community/publicPersonalInfo";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { log } from "@/utils/log";

const MAX_COMMENT_PATCH_BODY_BYTES = 8 * 1024;

function logContentFreeFailure(
  scope: string,
  category: "database" | "unexpected",
  sourceCode: unknown,
) {
  const code =
    typeof sourceCode === "string" && /^[A-Z0-9_]{1,64}$/u.test(sourceCode)
      ? sourceCode
      : "UNCLASSIFIED";
  log.error(scope, { category, code });
}

function getServiceClient() {
  return createAdminClient();
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await getServiceClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();
  return data?.is_admin === true;
}

// 댓글 수정 (작성자만)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const serviceClient = getServiceClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status },
      );
    }

    // Authenticated direct writes are revoked. Re-read the authoritative row
    // with the server client, then explicitly enforce author/admin ownership
    // before using that same boundary for the mutation.
    const { data: existingComment } = await serviceClient
      .from("community_comments")
      .select("author_id, is_deleted")
      .eq("id", id)
      .single();

    if (!existingComment) {
      return NextResponse.json(
        { error: "댓글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existingComment.is_deleted) {
      return NextResponse.json(
        { error: "삭제된 댓글은 수정할 수 없습니다." },
        { status: 400 }
      );
    }

    const userIsAdmin =
      existingComment.author_id !== user.id && (await isAdmin(user.id));
    if (existingComment.author_id !== user.id && userIsAdmin) {
      return NextResponse.json(
        {
          error: "관리자 운영 조치는 감사 기록이 남는 moderation 경로를 사용해 주세요.",
          code: "COMMUNITY_ADMIN_EDIT_REQUIRES_AUDITED_ACTION",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (existingComment.author_id !== user.id) {
      return NextResponse.json(
        { error: "수정 권한이 없습니다." },
        { status: 403 }
      );
    }

    const bodyResult = await readBoundedUtf8Text(
      req,
      MAX_COMMENT_PATCH_BODY_BYTES,
    );
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: "댓글 수정 요청을 읽을 수 없습니다." },
        {
          status: bodyResult.reason === "too_large" ? 413 : 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyResult.text) as unknown;
    } catch {
      return NextResponse.json(
        { error: "댓글 수정 요청 형식을 확인해 주세요." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (
      !isRecord(body)
      || Object.keys(body).some((field) => field !== "content")
      || typeof body.content !== "string"
    ) {
      return NextResponse.json(
        { error: "댓글 수정 요청 필드를 확인해 주세요." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const rawContent = body.content;

    // 댓글 내용 검증 및 정화
    // Public comments are plain text. Strip markup and every attribute before
    // PII inspection so mailto/src/alt/title values cannot survive an edit.
    const content = sanitizeText(rawContent ?? "").slice(0, 5000).trim();

    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: "댓글 내용을 입력해주세요." },
        { status: 400 }
      );
    }

    const personalInfoKinds = findObviousPublicPersonalInfo(content);
    if (personalInfoKinds.length > 0) {
      return NextResponse.json(
        {
          error: PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
          code: "COMMUNITY_PERSONAL_INFO_DETECTED",
          detected: personalInfoKinds,
        },
        { status: 422 }
      );
    }

    const updateQuery = serviceClient
      .from("community_comments")
      .update({
        content,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("is_deleted", false)
      // Repeat ownership in the write predicate so a stale or replaced row
      // cannot cross the authorization boundary between read and update.
      .eq("author_id", user.id);
    const { data: updatedComment, error } = await updateQuery
      .select("*")
      .single();

    if (!updatedComment && (!error || error.code === "PGRST116")) {
      return NextResponse.json(
        { error: "댓글을 찾을 수 없습니다." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (error) {
      logContentFreeFailure(
        "[community.comments.patch]",
        "database",
        error.code,
      );
      return NextResponse.json(
        { error: "댓글 수정에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ comment: updatedComment });
  } catch {
    logContentFreeFailure(
      "[community.comments.patch]",
      "unexpected",
      "UNHANDLED_EXCEPTION",
    );
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 댓글 삭제 (소프트 삭제 - 스레드 구조 유지)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const serviceClient = getServiceClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Direct client writes are revoked. Read the authoritative moderation and
    // author-intent state through the service boundary before deciding whether
    // this is a duplicate author deletion.
    const { data: existingComment } = await serviceClient
      .from("community_comments")
      .select("author_id, post_id, is_deleted, author_deleted_at")
      .eq("id", id)
      .single();

    if (!existingComment) {
      return NextResponse.json(
        { error: "댓글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const deletingAsAdmin =
      existingComment.author_id !== user.id && (await isAdmin(user.id));
    if (deletingAsAdmin) {
      return NextResponse.json(
        {
          error: "관리자 삭제는 작성자 의사와 분리된 감사 조치 경로를 사용해야 합니다.",
          code: "COMMUNITY_ADMIN_DELETE_REQUIRES_AUDITED_ACTION",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (existingComment.author_id !== user.id) {
      return NextResponse.json(
        { error: "삭제 권한이 없습니다." },
        { status: 403 }
      );
    }

    // DB가 작성자와 댓글을 잠그고 작성자 삭제 의사 및 두 카운터를 한
    // 트랜잭션으로 반영한다. 동일 요청은 이미 완료된 상태를 성공 재생한다.
    const { data: deletion, error } = await serviceClient.rpc(
      "community_delete_comment_service",
      { p_actor_id: user.id, p_comment_id: id },
    );
    if (error) {
      const message = `${error.code ?? ""} ${error.message ?? ""}`;
      if (message.includes("COMMUNITY_COMMENT_NOT_FOUND")) {
        return NextResponse.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
      }
      if (message.includes("COMMUNITY_COMMENT_DELETE_FORBIDDEN")) {
        return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
      }
      logContentFreeFailure(
        "[community.comments.delete]",
        "database",
        error.code,
      );
      return NextResponse.json(
        {
          error: "댓글 삭제 상태를 안전하게 저장하지 못했습니다.",
          code: "COMMUNITY_COMMENT_DELETE_UNAVAILABLE",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const result = deletion as {
      comment_id?: unknown;
      post_comment_count?: unknown;
    } | null;
    if (
      !result
      || result.comment_id !== id
      || Object.hasOwn(result, "replayed")
      || !Number.isSafeInteger(result.post_comment_count)
    ) {
      return NextResponse.json(
        {
          error: "댓글 삭제 결과를 확인하지 못했습니다.",
          code: "COMMUNITY_COMMENT_DELETE_UNCONFIRMED",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({
      success: true,
      comment_id: result.comment_id,
      post_comment_count: result.post_comment_count,
    });
  } catch {
    logContentFreeFailure(
      "[community.comments.delete]",
      "unexpected",
      "UNHANDLED_EXCEPTION",
    );
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
