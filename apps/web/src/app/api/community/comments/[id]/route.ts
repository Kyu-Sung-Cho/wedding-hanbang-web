import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeHtml } from "@/utils/sanitize";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
  try {
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

    // 작성자 확인
    const { data: existingComment } = await supabase
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

    if (existingComment.author_id !== user.id && !(await isAdmin(user.id))) {
      return NextResponse.json(
        { error: "수정 권한이 없습니다." },
        { status: 403 }
      );
    }

    const { content: rawContent } = (await req.json()) as { content: string };

    // 댓글 내용 검증 및 정화
    const content = sanitizeHtml(rawContent ?? "").slice(0, 5000);

    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: "댓글 내용을 입력해주세요." },
        { status: 400 }
      );
    }

    const { data: updatedComment, error } = await supabase
      .from("community_comments")
      .update({
        content,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("Update comment error:", error);
      return NextResponse.json(
        { error: "댓글 수정에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ comment: updatedComment });
  } catch (err) {
    console.error("Update comment error:", err);
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

    // 작성자 확인
    const { data: existingComment } = await supabase
      .from("community_comments")
      .select("author_id, post_id, is_deleted")
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
        { error: "이미 삭제된 댓글입니다." },
        { status: 400 }
      );
    }

    if (existingComment.author_id !== user.id && !(await isAdmin(user.id))) {
      return NextResponse.json(
        { error: "삭제 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 소프트 삭제: is_deleted = true, 내용 제거
    const { error } = await serviceClient
      .from("community_comments")
      .update({
        is_deleted: true,
        content: "삭제된 댓글입니다.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("Delete comment error:", error);
      return NextResponse.json(
        { error: "댓글 삭제에 실패했습니다." },
        { status: 500 }
      );
    }

    // comment_count 감소
    await serviceClient
      .from("community_posts")
      .select("comment_count")
      .eq("id", existingComment.post_id)
      .single()
      .then(({ data }) => {
        return serviceClient
          .from("community_posts")
          .update({
            comment_count: Math.max(0, (data?.comment_count ?? 1) - 1),
          })
          .eq("id", existingComment.post_id);
      });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete comment error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
