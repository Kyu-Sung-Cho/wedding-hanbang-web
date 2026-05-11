import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type CommunityPostWithAuthorId = {
  author_id: string;
} & Record<string, unknown>;

type AuthorProfile = {
  nickname: string;
  rank: string;
  wedding_year: number | null;
  wedding_month: number | null;
};

async function attachAuthorProfiles(
  service: ReturnType<typeof getServiceClient>,
  posts: CommunityPostWithAuthorId[]
) {
  const authorIds = [...new Set(posts.map((post) => post.author_id))].filter(
    Boolean
  );
  let authorMap: Record<string, AuthorProfile> = {};

  if (authorIds.length > 0) {
    const { data: profiles } = await service
      .from("community_profiles")
      .select("user_id, nickname, rank, wedding_year, wedding_month")
      .in("user_id", authorIds);

    if (profiles) {
      authorMap = Object.fromEntries(
        profiles.map((profile) => [
          profile.user_id,
          {
            nickname: profile.nickname,
            rank: profile.rank,
            wedding_year: profile.wedding_year,
            wedding_month: profile.wedding_month,
          },
        ])
      );
    }
  }

  return posts.map((post) => ({
    ...post,
    author: authorMap[post.author_id] ?? {
      nickname: "?듬챸",
      rank: "sprout",
      wedding_year: null,
      wedding_month: null,
    },
  }));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    const service = getServiceClient();

    const { data: tag } = await service
      .from("community_vendor_tags")
      .select("*")
      .eq("vendor_name", name)
      .maybeSingle();

    const { data: posts } = await service
      .from("community_posts")
      .select("*")
      .or(`title.ilike.%${name}%,content.ilike.%${name}%`)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(50);

    const postsWithAuthors = await attachAuthorProfiles(
      service,
      (posts ?? []) as CommunityPostWithAuthorId[]
    );

    return NextResponse.json({ tag: tag ?? null, posts: postsWithAuthors });
  } catch (err) {
    console.error("Vendor tag detail error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
