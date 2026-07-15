import { NextRequest, NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  CommunityAuthorProfileUnavailableError,
  getCommunityAuthorMap,
  requireCommunityAuthor,
} from "@/lib/community/authorProfiles";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { COMMUNITY_COMMENT_PUBLIC_SELECT } from "@/lib/community/commentSelect";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { getMutedActorIds, mutedActorFilterValue } from "@/lib/community/mutes";
import { sanitizeText } from "@/utils/sanitize";
import type { CommentWithAuthor } from "@/types/community.types";

// Existing comments remain readable under the parent post's visibility rules.
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const postId = new URL(req.url).searchParams.get("postId");

    if (!postId) {
      return NextResponse.json({ error: "postId가 필요합니다." }, { status: 400 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) {
      return NextResponse.json(
        { error: "로그인 상태를 확인하지 못했습니다." },
        { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }

    const viewerActorId = await getCommunityActorIdForUser(user?.id);
    const mutedActorIds = await getMutedActorIds(user?.id);
    const mutedActors = mutedActorFilterValue(mutedActorIds);

    const { data: targetPost, error: postFetchError } = await supabase
      .from("community_posts")
      .select("id, author_id:author_public_id, visibility, under_review")
      .eq("id", postId)
      .maybeSingle();

    if (postFetchError) {
      console.error("Comment parent post access check failed");
      return NextResponse.json({ error: "게시글 접근 확인에 실패했습니다." }, { status: 500 });
    }

    if (
      !targetPost ||
      mutedActorIds.includes(targetPost.author_id) ||
      !canReadCommunityPost(targetPost, {
        actorId: viewerActorId,
        isAuthenticated: Boolean(user),
      })
    ) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없거나 접근 권한이 없습니다." },
        { status: 404 },
      );
    }

    let commentsQuery = supabase
      .from("community_comments")
      .select(COMMUNITY_COMMENT_PUBLIC_SELECT)
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    if (mutedActors) {
      commentsQuery = commentsQuery.not("author_public_id", "in", mutedActors);
    }

    const { data: comments, error } = await commentsQuery;

    if (error) {
      console.error("List comments failed");
      return NextResponse.json({ error: "댓글을 불러올 수 없습니다." }, { status: 500 });
    }

    const authorIds = [...new Set((comments ?? []).map((comment) => comment.author_id))];
    const authorMap = await getCommunityAuthorMap(supabase, authorIds);

    const topLevel: CommentWithAuthor[] = [];
    const repliesMap: Record<string, CommentWithAuthor[]> = {};
    for (const row of comments ?? []) {
      const comment = {
        ...row,
        content: sanitizeText(row.content),
        author: requireCommunityAuthor(authorMap, row.author_id),
        viewer_is_author: Boolean(viewerActorId && row.author_id === viewerActorId),
      } as CommentWithAuthor;
      if (comment.parent_id) {
        (repliesMap[comment.parent_id] ??= []).push(comment);
      } else {
        topLevel.push(comment);
      }
    }

    return NextResponse.json({
      comments: topLevel.map((comment) => ({
        ...comment,
        replies: repliesMap[comment.id] ?? [],
      })),
    });
  } catch (error) {
    console.error("List comments request failed");
    if (error instanceof CommunityAuthorProfileUnavailableError) {
      return NextResponse.json(
        { error: "댓글 작성자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

// New comments and replies are retired until report/block/moderation is complete.
export async function POST() {
  return NextResponse.json(
    {
      code: "community_comment_writes_retired",
      error:
        "새 댓글과 답글 작성은 현재 제공하지 않습니다. 기존 댓글은 읽을 수 있고 작성자는 수정·삭제할 수 있습니다.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
