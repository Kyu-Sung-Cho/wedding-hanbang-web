import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

const ALLOWED_ACTIONS = ["hide", "unhide", "delete"] as const;
type ModerateAction = (typeof ALLOWED_ACTIONS)[number];

/**
 * POST /api/admin/posts/[id]/moderate
 * body: { action: 'hide' | 'unhide' | 'delete', reason?: string }
 *
 * - hide: visibility를 'draft'로 변경 (작성자 외 모두에게 숨김, 복구 가능)
 * - unhide: visibility를 'public'으로 변경 (under_review 플래그도 해제)
 * - delete: 게시글 row 삭제 (댓글/투표/북마크/폴 등 CASCADE로 같이 정리)
 *
 * 모든 액션은 verifyAdmin 가드 통과 + ai_interactions_log에 감사 로그 기록.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, userId: adminId } = await verifyAdmin(request);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;

    if (!action || !ALLOWED_ACTIONS.includes(action as ModerateAction)) {
      return NextResponse.json(
        { error: "잘못된 액션입니다. (hide/unhide/delete)" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // 게시글 존재 확인
    const { data: post } = await supabase
      .from("community_posts")
      .select("id, title, author_id, visibility")
      .eq("id", id)
      .maybeSingle();

    if (!post) {
      return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
    }

    if (action === "hide") {
      const { error } = await supabase
        .from("community_posts")
        .update({ visibility: "draft" })
        .eq("id", id);
      if (error) {
        console.error("[admin moderate hide] error:", error);
        return NextResponse.json({ error: "숨김 처리 실패" }, { status: 500 });
      }
    } else if (action === "unhide") {
      const { error } = await supabase
        .from("community_posts")
        .update({ visibility: "public", under_review: false })
        .eq("id", id);
      if (error) {
        console.error("[admin moderate unhide] error:", error);
        return NextResponse.json({ error: "복원 처리 실패" }, { status: 500 });
      }
    } else if (action === "delete") {
      const { error } = await supabase
        .from("community_posts")
        .delete()
        .eq("id", id);
      if (error) {
        console.error("[admin moderate delete] error:", error);
        return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
      }
    }

    // 관련 신고를 자동으로 'resolved'로 마킹 (조치 완료 의미)
    if (action === "hide" || action === "delete") {
      void supabase
        .from("community_reports")
        .update({ status: "resolved" })
        .eq("post_id", id)
        .in("status", ["pending", "reviewed"])
        .then(() => {}, () => {});
    }

    // 감사 로그 (best effort, 실패 무시)
    void supabase
      .from("ai_interactions_log")
      .insert({
        user_id: adminId,
        couple_id: null,
        interaction_type: "admin_moderation",
        specialist_type: null,
        user_input: null,
        ai_output: null,
        success: true,
        metadata: {
          action,
          target_type: "post",
          target_id: id,
          target_author_id: post.author_id,
          target_title: post.title,
          reason,
        },
      })
      .then(() => {}, () => {});

    return NextResponse.json({ ok: true, action });
  } catch (err) {
    console.error("[admin moderate] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
