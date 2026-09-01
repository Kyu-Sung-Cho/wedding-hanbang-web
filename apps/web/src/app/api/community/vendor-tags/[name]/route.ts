import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/utils/log";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import { cleanPostgrestSearchTerm, escapePostgrestLikePattern } from "@/utils/requestValidation";

const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const VIEWER_VARY = "Authorization, Cookie";

function getServiceClient() {
  return createAdminClient();
}

type CommunityPostWithAuthorId = {
  author_id: string;
} & Record<string, unknown>;

async function attachAuthorProfiles(
  client: Parameters<typeof getCommunityAuthorMap>[0],
  posts: CommunityPostWithAuthorId[]
) {
  const authorIds = [...new Set(posts.map((post) => post.author_id))].filter(
    Boolean
  );
  const authorMap = await getCommunityAuthorMap(client, authorIds);

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
    const { name: rawName } = await params;
    const name = cleanPostgrestSearchTerm(decodeURIComponent(rawName), 100);
    if (!name) {
      return NextResponse.json(
        { error: "잘못된 업체명입니다." },
        {
          status: 400,
          headers: { "Cache-Control": PRIVATE_NO_STORE, Vary: VIEWER_VARY },
        },
      );
    }
    const escapedName = escapePostgrestLikePattern(name);
    const service = getServiceClient();
    const viewerClient = await createClientFromRequest(req);
    const {
      data: { user },
      error: viewerError,
    } = await viewerClient.auth.getUser();
    const responseCacheControl = user || viewerError
      ? PRIVATE_NO_STORE
      : "public, s-maxage=60, stale-while-revalidate=120";

    const { data: tag } = await service
      .from("community_vendor_tags")
      .select("*")
      .eq("vendor_name", name)
      .maybeSingle();

    const { data: candidatePosts, error: candidatePostError } = viewerError
      ? { data: [], error: null }
      : await viewerClient
          .from("community_posts")
          .select("id, author_id")
          .or(`title.ilike.%${escapedName}%,content.ilike.%${escapedName}%`)
          .eq("visibility", "public")
          .eq("under_review", false)
          .order("created_at", { ascending: false })
          .limit(50);

    if (candidatePostError) {
      throw candidatePostError;
    }

    const candidates = ((candidatePosts ?? []) as Array<{
      id?: unknown;
      author_id?: unknown;
    }>).filter(
      (post): post is { id: string; author_id: string } =>
        typeof post.id === "string" && typeof post.author_id === "string",
    );
    const blockedAuthorIds = new Set<string>();

    if (user && !viewerError) {
      const authorIds = [...new Set(candidates.map((post) => post.author_id))];
      await Promise.all(
        authorIds.map(async (authorId) => {
          if (authorId === user.id) return;
          const { data: viewerCanSee, error: blockError } = await service.rpc(
            "community_viewer_can_see" as never,
            {
              p_viewer_user_id: user.id,
              p_other_user_id: authorId,
            } as never,
          );
          if (blockError || viewerCanSee !== true) {
            blockedAuthorIds.add(authorId);
          }
        }),
      );
    }

    const visiblePostIds = viewerError
      ? []
      : candidates
          .filter((post) => !blockedAuthorIds.has(post.author_id))
          .map((post) => post.id);
    const { data: viewerPosts, error: viewerPostsError } = visiblePostIds.length > 0
      ? await viewerClient
          .from("community_posts")
          .select(COMMUNITY_POST_PUBLIC_SELECT)
          .in("id", visiblePostIds)
          .eq("visibility", "public")
          .eq("under_review", false)
          .order("created_at", { ascending: false })
          .limit(50)
      : { data: [], error: null };

    if (viewerPostsError) {
      throw viewerPostsError;
    }

    const posts = ((viewerPosts ?? []) as CommunityPostWithAuthorId[]).filter(
      (post) =>
        post.visibility === "public"
        && post.under_review !== true
        && !blockedAuthorIds.has(post.author_id),
    );

    // 실제 vendor DB 매칭 — 이름이 비슷한 승인된 vendor가 있으면 예약 연동 가능.
    // 정확 매칭 우선, 없으면 부분 매칭. 데모 환경의 mock vendor도 함께 검색.
    const { data: exactVendor } = await service
      .from("vendors")
      .select(
        "id, name, category, region, address, thumbnail_url, rating, review_count, price_min, price_max, price_range, description"
      )
      .eq("name", name)
      .eq("status", "approved")
      .maybeSingle();

    let vendorMatch = exactVendor;
    if (!vendorMatch) {
      const { data: fuzzyVendor } = await service
        .from("vendors")
        .select(
          "id, name, category, region, address, thumbnail_url, rating, review_count, price_min, price_max, price_range, description"
        )
        .ilike("name", `%${escapedName}%`)
        .eq("status", "approved")
        .limit(1)
        .maybeSingle();
      vendorMatch = fuzzyVendor;
    }

    let products: Array<{
      id: string;
      name: string;
      price: number;
      discount_price: number | null;
      duration: number | null;
      is_popular: boolean;
    }> = [];

    interface StaffLite {
      id: string;
      name: string;
      role: string | null;
      description: string | null;
    }
    let staff: StaffLite[] = [];

    interface SlotLite {
      day: number;
      hour: number;
      max_bookings: number;
    }
    let vendorSlots: SlotLite[] = [];
    const staffSlots: Record<string, SlotLite[]> = {};

    if (vendorMatch) {
      const { data: productData } = await service
        .from("vendor_products")
        .select("id, name, price, discount_price, duration, is_popular, sort_order")
        .eq("vendor_id", vendorMatch.id)
        .eq("is_active", true)
        .order("is_popular", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(3);
      products = (productData ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        discount_price: p.discount_price,
        duration: p.duration,
        is_popular: !!p.is_popular,
      }));

      const { data: staffData } = await service
        .from("vendor_staff")
        .select("id, name, role, description, sort_order")
        .eq("vendor_id", vendorMatch.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      staff = (staffData ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        description: s.description,
      }));

      const { data: vendorSlotData } = await service
        .from("vendor_timeslots")
        .select("day, hour, max_bookings")
        .eq("vendor_id", vendorMatch.id)
        .eq("available", true);
      vendorSlots = (vendorSlotData ?? []).map((s) => ({
        day: s.day,
        hour: s.hour,
        max_bookings: s.max_bookings ?? 1,
      }));

      if (staff.length > 0) {
        const staffIds = staff.map((s) => s.id);
        const { data: staffSlotData } = await service
          .from("staff_timeslots")
          .select("staff_id, day, hour, max_bookings")
          .in("staff_id", staffIds)
          .eq("available", true);
        for (const row of staffSlotData ?? []) {
          if (!staffSlots[row.staff_id]) staffSlots[row.staff_id] = [];
          staffSlots[row.staff_id].push({
            day: row.day,
            hour: row.hour,
            max_bookings: row.max_bookings ?? 1,
          });
        }
      }
    }

    const postsWithAuthors = await attachAuthorProfiles(
      viewerClient,
      posts,
    );

    return NextResponse.json(
      {
        tag: tag ?? null,
        posts: postsWithAuthors,
        vendor: vendorMatch ?? null,
        products,
        staff,
        vendorSlots,
        staffSlots,
      },
      {
        headers: {
          "Cache-Control": responseCacheControl,
          Vary: VIEWER_VARY,
        },
      },
    );
  } catch (err) {
    log.error("api/community/vendor-tags/[name]", err);
    console.error("Vendor tag detail error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      {
        status: 500,
        headers: { "Cache-Control": PRIVATE_NO_STORE, Vary: VIEWER_VARY },
      },
    );
  }
}
