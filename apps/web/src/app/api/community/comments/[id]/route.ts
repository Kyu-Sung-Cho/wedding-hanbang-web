import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeHtmlWithInputLimit } from "@/utils/sanitize";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { COMMUNITY_COMMENT_PUBLIC_SELECT } from "@/lib/community/commentSelect";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { verifyAdmin } from "@/lib/utils/adminAuth";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

const MAX_BODY_BYTES = 32 * 1024;

function getServiceClient() {
  return createAdminClient();
}

// 댓글 수정 (작성자만)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isTrustedMutationRequest(req)) {
      return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
    }

    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:comment:update", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 },
    );
    if (limited) return limited;

    // 작성자 확인
    const { data: existingComment } = await getServiceClient()
      .from("community_comments")
      .select("author_id, is_deleted")
      .eq("id", id)
      .maybeSingle();

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

    let allowAdminOverride = false;
    if (existingComment.author_id !== user.id) {
      const adminVerification = await verifyAdmin(req);
      if (!adminVerification.authorized || adminVerification.userId !== user.id) {
        return NextResponse.json(
          { error: "수정 권한이 없습니다." },
          { status: 403 }
        );
      }
      allowAdminOverride = true;
    }

    const bodyResult = await readBoundedJsonValue(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const rawContent = isRecord(bodyResult.value)
      && typeof bodyResult.value.content === "string"
      ? bodyResult.value.content
      : "";

    // 댓글 내용 검증 및 정화
    const content = sanitizeHtmlWithInputLimit(rawContent ?? "", 5000);

    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: "댓글 내용을 입력해주세요." },
        { status: 400 }
      );
    }

    // Recheck ownership, suspension, and deletion state in the mutation
    // transaction so a concurrent moderation action cannot be raced.
    const { data: updatedComment, error } = await getServiceClient()
      .rpc("community_update_comment_for_actor", {
        p_actor_id: user.id,
        p_comment_id: id,
        p_content: content,
        p_allow_admin_override: allowAdminOverride,
      })
      .select(COMMUNITY_COMMENT_PUBLIC_SELECT)
      .single();

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      console.error("Update comment error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "댓글 수정에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ comment: updatedComment });
  } catch (err) {
    console.error("Update comment error:", safeErrorDiagnostic(err));
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
  try {
    if (!isTrustedMutationRequest(req)) {
      return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
    }

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


    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:comment:delete", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 },
    );
    if (limited) return limited;

    // 작성자 확인
    const { data: existingComment, error: commentLookupError } = await serviceClient
      .from("community_comments")
      .select("author_id, is_deleted")
      .eq("id", id)
      .single();

    if (commentLookupError) {
      console.error(
        "Delete comment lookup error:",
        safeErrorDiagnostic(commentLookupError),
      );
      return NextResponse.json(
        { error: "댓글을 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    if (!existingComment) {
      return NextResponse.json(
        { error: "댓글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existingComment.is_deleted) {
      return NextResponse.json(
        { error: "이미 삭제된 댓글입니다." },
        { status: 400 }
      );
    }

    let allowAdminOverride = false;
    if (existingComment.author_id !== user.id) {
      const adminVerification = await verifyAdmin(req);
      if (!adminVerification.authorized || adminVerification.userId !== user.id) {
        return NextResponse.json(
          { error: "삭제 권한이 없습니다." },
          { status: 403 }
        );
      }
      allowAdminOverride = true;
    }

    // 소프트 삭제도 actor gate와 동일 트랜잭션에서 수행한다.
    const { data: deleted, error } = await serviceClient.rpc(
      "community_delete_comment_for_actor",
      {
        p_actor_id: user.id,
        p_comment_id: id,
        p_allow_admin_override: allowAdminOverride,
      },
    );

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      console.error("Delete comment error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "댓글 삭제에 실패했습니다." },
        { status: 500 }
      );
    }

    if (deleted !== true) {
      console.error("Delete comment RPC returned an invalid result");
      return NextResponse.json(
        { error: "댓글 삭제 결과를 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete comment error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
