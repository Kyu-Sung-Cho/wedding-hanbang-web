import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import {
  fallbackCommunityAuthor,
  getCommunityAuthorMap,
} from "@/lib/community/authorProfiles";
import {
  cleanPostgrestSearchTerm,
  escapePostgrestLikePattern,
} from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type CommunityPostWithAuthorId = {
  author_id: string;
} & Record<string, unknown>;

async function attachAuthorProfiles(
  service: ReturnType<typeof getServiceClient>,
  posts: CommunityPostWithAuthorId[]
) {
  const authorIds = [...new Set(posts.map((post) => post.author_id))].filter(
    Boolean
  );
  const authorMap = await getCommunityAuthorMap(service, authorIds);

  return posts.map((post) => ({
    ...post,
    author: authorMap[post.author_id] ?? fallbackCommunityAuthor(post.author_id),
  }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:vendor-tags:detail", req),
      { maxRequests: 60, windowMs: 60 * 1000 }
    );
    if (limited) return limited;

    const { name: rawName } = await params;
    const name = cleanPostgrestSearchTerm(decodeURIComponent(rawName), 100);
    if (!name) {
      return NextResponse.json(
        { error: "잘못된 업체명입니다." },
        { status: 400 }
      );
    }

    const escapedName = escapePostgrestLikePattern(name);
    const service = getServiceClient();

    const { data: tag, error: tagError } = await service
      .from("community_vendor_tags")
      .select("id, vendor_name, category, region, mention_count")
      .eq("vendor_name", name)
      .maybeSingle();

    if (tagError) {
      console.error("Vendor tag lookup error:", tagError);
      return NextResponse.json(
        { error: "업체 태그를 불러올 수 없습니다." },
        { status: 500 }
      );
    }
    // 이 경로를 임의 공개 게시물 검색 API로 사용할 수 없도록, 집계 테이블에
    // 정확히 등록된 태그가 있을 때만 게시물 검색을 진행한다.
    if (!tag) {
      return NextResponse.json(
        { error: "업체 태그를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const { data: posts, error: postsError } = await service
      .from("community_posts")
      .select(COMMUNITY_POST_PUBLIC_SELECT)
      .or(`title.ilike.%${escapedName}%,content.ilike.%${escapedName}%`)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(50);

    if (postsError) {
      console.error("Vendor tag posts lookup error:", postsError);
      return NextResponse.json(
        { error: "관련 게시물을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // 공개 탐색 정보는 승인된 업체의 정확한 상호명만 연결한다.
    // 이 연결은 입점·제휴·자격 검증·예약 가능 여부를 뜻하지 않는다.
    const { data: exactVendor, error: vendorError } = await service
      .from("vendors")
      .select("id, name, category, region, address, thumbnail_url, description")
      .eq("name", name)
      .eq("status", "approved")
      .maybeSingle();

    if (vendorError) {
      console.error("Approved vendor lookup error:", vendorError);
      return NextResponse.json(
        { error: "업체 정보를 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    const postsWithAuthors = await attachAuthorProfiles(
      service,
      (posts ?? []) as CommunityPostWithAuthorId[]
    );

    const publicTag = {
      id: tag.id,
      vendor_name: tag.vendor_name,
      category: tag.category,
      region: tag.region,
      mention_count: tag.mention_count,
      // 산정 근거가 없는 레거시 평균은 공개하지 않는다.
      avg_rating: null,
      avg_base_price: null,
      avg_extra_price: null,
      extra_rate: null,
    };

    return NextResponse.json(
      {
        tag: publicTag,
        posts: postsWithAuthors,
        vendor: exactVendor ?? null,
      },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120" } }
    );
  } catch (err) {
    console.error("Vendor tag detail error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
