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
        .ilike("name", `%${name}%`)
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
      service,
      (posts ?? []) as CommunityPostWithAuthorId[]
    );

    return NextResponse.json({
      tag: tag ?? null,
      posts: postsWithAuthors,
      vendor: vendorMatch ?? null,
      products,
      staff,
      vendorSlots,
      staffSlots,
    });
  } catch (err) {
    console.error("Vendor tag detail error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
