import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { UpdatePostInput } from "@/types/community.types";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 게시글 상세 조회
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 게시글 + 작성자 정보 조회
    const { data: post, error } = await supabase
      .from("community_posts")
      .select(
        "*, author:community_profiles!community_posts_author_id_fkey(*)"
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
          .eq("target_type", "post")
          .eq("target_id", id)
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

    return NextResponse.json({
      ...post,
      vendor_details: vendorDetails,
      user_vote: userVote,
      user_bookmarked: userBookmarked,
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

    // 작성자 확인
    const { data: existingPost } = await supabase
      .from("community_posts")
      .select("author_id")
      .eq("id", id)
      .single();

    if (!existingPost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existingPost.author_id !== user.id) {
      return NextResponse.json(
        { error: "수정 권한이 없습니다." },
        { status: 403 }
      );
    }

    const body: UpdatePostInput = await req.json();
    const updateData: Record<string, unknown> = {};

    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.images !== undefined) updateData.images = body.images;
    if (body.visibility !== undefined) updateData.visibility = body.visibility;
    if (body.vendor_tags !== undefined) updateData.vendor_tags = body.vendor_tags;
    if (body.tags !== undefined) updateData.tags = body.tags;
    if (body.cost_data !== undefined) updateData.cost_data = body.cost_data;
    updateData.updated_at = new Date().toISOString();

    const { data: updatedPost, error } = await supabase
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
    const supabase = await createClient();
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
    const { data: existingPost } = await supabase
      .from("community_posts")
      .select("author_id")
      .eq("id", id)
      .single();

    if (!existingPost) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existingPost.author_id !== user.id) {
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

    // post_count 감소
    await serviceClient
      .from("community_profiles")
      .update({
        post_count: Math.max(0, 0), // RPC로 처리하는 게 이상적
      })
      .eq("user_id", user.id);

    // 실제로는 RPC 사용 권장
    await serviceClient.rpc("community_decrement_profile_count", {
      p_user_id: user.id,
      p_field: "post_count",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
