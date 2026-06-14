import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { sanitizeHtml, sanitizeText } from "@/utils/sanitize";
import type { PostVisibility, UpdatePostInput, PollWithOptions } from "@/types/community.types";

const VALID_POST_VISIBILITIES: PostVisibility[] = ["public", "members", "draft"];

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

// 게시글 상세 조회
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 게시글 + 작성자 정보 조회
    const { data: post, error } = await supabase
      .from("community_posts")
      .select(
        COMMUNITY_POST_PUBLIC_SELECT
      )
      .eq("id", id)
      .single();

    if (error || !post) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // visibility 체크
    if (post.visibility === "draft" && post.author_id !== user?.id) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    if (post.visibility === "members" && !user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    // 벤더 태그 상세 정보
    let vendorDetails: Array<{
      id: string;
      business_name: string;
      category: string;
      thumbnail_url: string | null;
      rating: number | null;
    }> = [];
    if (post.vendor_tags && post.vendor_tags.length > 0) {
      const { data: vendors } = await supabase
        .from("vendors")
        .select("id, name, category, thumbnail_url, rating")
        .in("id", post.vendor_tags);

      vendorDetails = (vendors ?? []).map((v) => ({
        id: v.id,
        business_name: v.name,
        category: v.category,
        thumbnail_url: v.thumbnail_url ?? null,
        rating: v.rating ?? null,
      }));
    }

    // 인증 사용자: 투표 + 북마크 상태
    let userVote: number | null = null;
    let userBookmarked = false;

    if (user) {
      const [voteResult, bookmarkResult] = await Promise.all([
        supabase
          .from("community_votes")
          .select("vote_type")
          .eq("user_id", user.id)
          .eq("post_id", id)
          .maybeSingle(),
        supabase
          .from("community_bookmarks")
          .select("id")
          .eq("user_id", user.id)
          .eq("post_id", id)
          .maybeSingle(),
      ]);

      userVote = voteResult.data?.vote_type ?? null;
      userBookmarked = !!bookmarkResult.data;
    }

    // author 프로필 조회
    const { data: authorProfile } = await supabase
      .from("community_profiles")
      .select("user_id, nickname, avatar_url, rank, wedding_year, wedding_month")
      .eq("user_id", post.author_id)
      .single();

    // 폴 + 옵션 + 사용자 투표 상태
    let pollData: PollWithOptions | null = null;
    const { data: pollRow } = await supabase
      .from("community_polls")
      .select("*")
      .eq("post_id", id)
      .maybeSingle();

    if (pollRow) {
      const { data: optionRows } = await supabase
        .from("community_poll_options")
        .select("*")
        .eq("poll_id", pollRow.id)
        .order("position", { ascending: true });

      let votedOptionIds: string[] = [];
      if (user) {
        const { data: voteRows } = await supabase
          .from("community_poll_votes")
          .select("option_id")
          .eq("poll_id", pollRow.id)
          .eq("user_id", user.id);
        votedOptionIds = (voteRows ?? []).map((v: { option_id: string }) => v.option_id);
      }

      pollData = {
        id: pollRow.id,
        post_id: pollRow.post_id,
        question: pollRow.question,
        allow_multiple: pollRow.allow_multiple,
        is_anonymous: pollRow.is_anonymous,
        hide_results_until_voted: pollRow.hide_results_until_voted,
        closes_at: pollRow.closes_at,
        total_voters: pollRow.total_voters,
        total_votes: pollRow.total_votes,
        created_at: pollRow.created_at,
        options: optionRows ?? [],
        user_voted_option_ids: votedOptionIds,
      };
    }

    return NextResponse.json({
      ...post,
      author: authorProfile ?? { nickname: "익명", avatar_url: null, rank: "sprout", wedding_year: null, wedding_month: null },
      vendor_details: vendorDetails,
      user_vote: userVote,
      user_bookmarked: userBookmarked,
      poll: pollData,
    });
  } catch (err) {
    console.error("Get post detail error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 게시글 수정 (작성자만)
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

    const userIsAdmin = await isAdmin(user.id);
    const readClient = userIsAdmin ? getServiceClient() : supabase;

    // 작성자 확인. 관리자는 전체 커뮤니티 관리 권한으로 service role 조회를 사용한다.
    const { data: existingPost } = await readClient
      .from("community_posts")
      .select("author_id")
      .eq("id", id)
      .maybeSingle();

    if (!existingPost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existingPost.author_id !== user.id && !userIsAdmin) {
      return NextResponse.json(
        { error: "수정 권한이 없습니다." },
        { status: 403 }
      );
    }

    const body: UpdatePostInput = await req.json();
    const updateData: Record<string, unknown> = {};

    if (body.title !== undefined) {
      const title = sanitizeText(body.title).trim().slice(0, 200);
      if (title.length === 0) {
        return NextResponse.json(
          { error: "제목을 입력해주세요." },
          { status: 400 }
        );
      }
      updateData.title = title;
    }
    if (body.content !== undefined) {
      const content = sanitizeHtml(body.content).slice(0, 50000);
      // 카드 게시물(슬라이드)이면 캡션 비어도 허용. 그 외엔 본문 필수.
      const willHaveSlides =
        body.slides === undefined
          ? false // 슬라이드 변경 없으면 일반 글 규칙 적용
          : Array.isArray(body.slides) && body.slides.length > 0;
      if (!willHaveSlides && content.trim().length === 0) {
        return NextResponse.json(
          { error: "내용을 입력해주세요." },
          { status: 400 }
        );
      }
      updateData.content = content;
    }
    if (body.images !== undefined) {
      updateData.images = (body.images ?? [])
        .slice(0, 10)
        .filter((url: string) => typeof url === "string" && url.startsWith("https://"));
    }
    // 카드 게시물 슬라이드 — null 명시 시 일반 글로 되돌림, 배열이면 카드 게시물로 갱신.
    if (body.slides !== undefined) {
      if (body.slides === null || (Array.isArray(body.slides) && body.slides.length === 0)) {
        updateData.slides = null;
      } else if (Array.isArray(body.slides)) {
        updateData.slides = body.slides
          .slice(0, 10)
          .filter((s: { url?: string }) => s && typeof s.url === "string" && s.url.startsWith("https://"))
          .map((s: { type?: string; url?: string; width?: number; height?: number; thumbnail_url?: string }) => ({
            type: s.type === "video" ? "video" : "image",
            url: s.url as string,
            ...(typeof s.width === "number" && s.width > 0 ? { width: Math.min(8192, Math.round(s.width)) } : {}),
            ...(typeof s.height === "number" && s.height > 0 ? { height: Math.min(8192, Math.round(s.height)) } : {}),
            ...(typeof s.thumbnail_url === "string" && s.thumbnail_url.startsWith("https://") ? { thumbnail_url: s.thumbnail_url } : {}),
          }));
      }
    }
    if (body.visibility !== undefined) {
      if (!VALID_POST_VISIBILITIES.includes(body.visibility)) {
        return NextResponse.json(
          { error: "잘못된 공개 범위입니다." },
          { status: 400 }
        );
      }
      updateData.visibility = body.visibility;
    }
    if (body.vendor_tags !== undefined) updateData.vendor_tags = (body.vendor_tags ?? []).slice(0, 5);
    if (body.tags !== undefined) {
      updateData.tags = (body.tags ?? [])
        .slice(0, 10)
        .map((t: string) => sanitizeText(t).slice(0, 30))
        .filter((t: string) => t.length > 0);
    }
    if (body.cost_data !== undefined) updateData.cost_data = body.cost_data;
    updateData.updated_at = new Date().toISOString();

    const writeClient = userIsAdmin ? getServiceClient() : supabase;
    const { data: updatedPost, error } = await writeClient
      .from("community_posts")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("Update post error:", error);
      return NextResponse.json(
        { error: "게시글 수정에 실패했습니다." },
        { status: 500 }
      );
    }

    // 제목/본문/카테고리 변경 시 랜딩에서도 즉시 반영 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/community");
    } catch (e) {
      console.error("[posts.PATCH] revalidatePath failed (non-fatal):", e);
    }

    return NextResponse.json({ post: updatedPost });
  } catch (err) {
    console.error("Update post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 게시글 삭제 (작성자만)
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

    const userIsAdmin = await isAdmin(user.id);
    const readClient = userIsAdmin ? serviceClient : supabase;

    // 작성자 확인. 관리자는 숨김/신고 글까지 처리할 수 있어야 한다.
    const { data: existingPost } = await readClient
      .from("community_posts")
      .select("author_id")
      .eq("id", id)
      .maybeSingle();

    if (!existingPost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existingPost.author_id !== user.id && !userIsAdmin) {
      return NextResponse.json(
        { error: "삭제 권한이 없습니다." },
        { status: 403 }
      );
    }

    const { error } = await serviceClient
      .from("community_posts")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Delete post error:", error);
      return NextResponse.json(
        { error: "게시글 삭제에 실패했습니다." },
        { status: 500 }
      );
    }

    // 작성자의 post_count를 감소시킨다. 관리자가 삭제해도 관리자 카운터가 바뀌면 안 된다.
    const { error: countError } = await serviceClient.rpc("community_decrement_profile_count", {
      p_user_id: existingPost.author_id,
      p_field: "post_count",
    });
    if (countError) {
      console.error("[posts.DELETE] post_count decrement failed (non-fatal):", countError);
    }

    // 랜딩 / 커뮤니티 ISR 캐시 무효화 — 실패해도 응답은 성공
    try {
      revalidatePath("/");
      revalidatePath("/community");
    } catch (e) {
      console.error("[posts.DELETE] revalidatePath failed (non-fatal):", e);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
