import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeHtml } from "@/utils/sanitize";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import type { CommentWithAuthor, CreateCommentInput } from "@/types/community.types";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 댓글 목록 조회 (트리 구조)
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);
    const postId = searchParams.get("postId");

    if (!postId) {
      return NextResponse.json(
        { error: "postId가 필요합니다." },
        { status: 400 }
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 댓글 + 작성자 정보 조회
    const { data: comments, error } = await supabase
      .from("community_comments")
      .select(
        "*, author:community_profiles!community_comments_author_id_fkey(*)"
      )
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("List comments error:", error);
      return NextResponse.json(
        { error: "댓글을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // 인증 사용자의 투표 상태 조회
    let userVotesMap: Record<string, number> = {};
    if (user && comments && comments.length > 0) {
      const commentIds = comments.map((c) => c.id);
      const { data: votes } = await supabase
        .from("community_votes")
        .select("target_id, vote_type")
        .eq("user_id", user.id)
        .eq("target_type", "comment")
        .in("target_id", commentIds);

      if (votes) {
        userVotesMap = Object.fromEntries(
          votes.map((v) => [v.target_id, v.vote_type])
        );
      }
    }

    // 트리 구조로 변환
    const commentsWithVotes = (comments ?? []).map((c) => ({
      ...c,
      user_vote: userVotesMap[c.id] ?? null,
    }));

    const topLevel: CommentWithAuthor[] = [];
    const repliesMap: Record<string, CommentWithAuthor[]> = {};

    for (const comment of commentsWithVotes) {
      if (comment.parent_id) {
        if (!repliesMap[comment.parent_id]) {
          repliesMap[comment.parent_id] = [];
        }
        repliesMap[comment.parent_id].push(comment as CommentWithAuthor);
      } else {
        topLevel.push(comment as CommentWithAuthor);
      }
    }

    // 대댓글을 부모에 연결
    const tree = topLevel.map((comment) => ({
      ...comment,
      replies: repliesMap[comment.id] ?? [],
    }));

    return NextResponse.json({ comments: tree });
  } catch (err) {
    console.error("List comments error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 댓글 작성
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Rate limit: 30 comments per 10 minutes per user
    const rlResult = checkRateLimit(
      rateLimitKey("community:comment:create", req, user.id),
      { maxRequests: 30, windowMs: 10 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { post_id, parent_id, content: rawContent } =
      (await req.json()) as CreateCommentInput;

    // 댓글 내용 검증 및 정화
    const content = sanitizeHtml(rawContent ?? "").slice(0, 5000);

    if (!post_id || !content || content.trim().length === 0) {
      return NextResponse.json(
        { error: "필수 항목을 입력해주세요." },
        { status: 400 }
      );
    }

    // 대댓글 깊이 제한 (1단계만 허용)
    if (parent_id) {
      const { data: parentComment } = await supabase
        .from("community_comments")
        .select("parent_id")
        .eq("id", parent_id)
        .single();

      if (!parentComment) {
        return NextResponse.json(
          { error: "부모 댓글을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      if (parentComment.parent_id) {
        return NextResponse.json(
          { error: "대댓글에는 답글을 달 수 없습니다." },
          { status: 400 }
        );
      }
    }

    const serviceClient = getServiceClient();

    // 커뮤니티 프로필 자동 생성
    const { data: existingProfile } = await serviceClient
      .from("community_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .single();

    if (!existingProfile) {
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .single();

      await serviceClient.from("community_profiles").insert({
        user_id: user.id,
        nickname: userProfile?.name ?? "익명",
        badge: "member",
        post_count: 0,
        comment_count: 0,
        total_upvotes_received: 0,
      });
    }

    // 댓글 생성
    const { data: comment, error } = await serviceClient
      .from("community_comments")
      .insert({
        post_id,
        parent_id: parent_id ?? null,
        author_id: user.id,
        content,
        upvote_count: 0,
        is_deleted: false,
      })
      .select(
        "*, author:community_profiles!community_comments_author_id_fkey(*)"
      )
      .single();

    if (error) {
      console.error("Create comment error:", error);
      return NextResponse.json(
        { error: "댓글 작성에 실패했습니다." },
        { status: 500 }
      );
    }

    // community_posts.comment_count 증가
    await serviceClient
      .from("community_posts")
      .select("comment_count")
      .eq("id", post_id)
      .single()
      .then(({ data }) => {
        return serviceClient
          .from("community_posts")
          .update({ comment_count: (data?.comment_count ?? 0) + 1 })
          .eq("id", post_id);
      });

    // community_profiles.comment_count 증가
    await serviceClient.rpc("community_increment_profile_count", {
      p_user_id: user.id,
      p_field: "comment_count",
    }).then(({ error: rpcError }) => {
      if (rpcError) {
        return serviceClient
          .from("community_profiles")
          .select("comment_count")
          .eq("user_id", user.id)
          .single()
          .then(({ data }) => {
            return serviceClient
              .from("community_profiles")
              .update({
                comment_count: (data?.comment_count ?? 0) + 1,
              })
              .eq("user_id", user.id);
          });
      }
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    console.error("Create comment error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
