import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { fallbackCommunityAuthor, getCommunityAuthorMap } from "@/lib/community/authorProfiles";
import {
  PUBLIC_COMMUNITY_POST_QUERY_FILTERS,
  filterPublicCommunityPosts,
} from "@/lib/community/publicPostRules";
import { COMMUNITY_VENDOR_TAG_PUBLIC_SELECT } from "@/lib/community/vendorTagPublicFields";
import {
  bookingCountAt,
  buildKstDateWindow,
  loadPublicBookingAvailability,
  toPublicBookingSlots,
  type BookingOccupancyCount,
  type PublicBookingSlot,
} from "@/lib/vendors/bookingAvailability";
import { cleanPostgrestSearchTerm, escapePostgrestLikePattern } from "@/utils/requestValidation";
import { checkPublicBookingAvailabilityRateLimit } from "@/lib/vendors/publicAvailabilityRateLimit";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkPublicServiceReadRateLimit } from "@/lib/http/publicServiceReadRateLimit";
import { CURRENT_VENDOR_STAFF_PUBLICATION_CONSENT_VERSION } from "@/lib/vendors/staffPublicationConsent";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function publicJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function getServiceClient() {
  return createAdminClient();
}

type CommunityPostWithAuthorId = {
  author_id: string;
  visibility: string | null;
  under_review?: boolean | null;
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
    const { name: rawName } = await params;
    let decodedName: string;
    try {
      decodedName = decodeURIComponent(rawName);
    } catch {
      return publicJson({ error: "잘못된 업체명입니다." }, 400);
    }
    const name = cleanPostgrestSearchTerm(decodedName, 100);
    if (!name) {
      return publicJson({ error: "잘못된 업체명입니다." }, 400);
    }
    const catalogLimited = await checkPublicServiceReadRateLimit(req, "community-vendor-tags");
    if (catalogLimited) {
      catalogLimited.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
      return catalogLimited;
    }
    const limited = await checkPublicBookingAvailabilityRateLimit(req);
    if (limited) {
      limited.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
      return limited;
    }
    const service = getServiceClient();

    const [tagResult, vendorResult] = await Promise.all([
      service
        .from("community_vendor_tags")
        .select(COMMUNITY_VENDOR_TAG_PUBLIC_SELECT)
        .eq("vendor_name", name)
        .maybeSingle(),
      service
        .from("vendors")
        .select(
          "id, name, category, region, address, thumbnail_url, rating, review_count, price_min, price_max, price_range, description"
        )
        .eq("name", name)
        .eq("status", "approved")
        .maybeSingle(),
    ]);
    if (tagResult.error || vendorResult.error) {
      return publicJson({ error: "업체 정보를 확인할 수 없습니다." }, 503);
    }
    const tag = tagResult.data;
    const vendorMatch = vendorResult.data;
    if (!tag && !vendorMatch) {
      return publicJson({ error: "업체를 찾을 수 없습니다." }, 404);
    }

    const escapedName = escapePostgrestLikePattern(name);
    const { data: posts, error: postsError } = await service
      .from("community_posts")
      .select(COMMUNITY_POST_PUBLIC_SELECT)
      .or(`title.ilike.%${escapedName}%,content.ilike.%${escapedName}%`)
      .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
      .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)
      .order("created_at", { ascending: false })
      .limit(50);
    if (postsError) {
      return publicJson({ error: "관련 게시글을 확인할 수 없습니다." }, 503);
    }

    // Exact tag/vendor membership above is the cost boundary for all remaining reads.
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

    interface InternalSlot {
      day: number;
      hour: number;
      max_bookings: number;
    }
    let vendorSlots: PublicBookingSlot[] = [];
    const staffSlots: Record<string, PublicBookingSlot[]> = {};

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
        .not("public_profile_consent_at", "is", null)
        .eq(
          "public_profile_consent_version",
          CURRENT_VENDOR_STAFF_PUBLICATION_CONSENT_VERSION,
        )
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
      const vendorSlotRows = (vendorSlotData ?? []) as InternalSlot[];

      let staffSlotRows: Array<InternalSlot & { staff_id: string }> = [];
      if (staff.length > 0) {
        const staffIds = staff.map((s) => s.id);
        const { data: staffSlotData } = await service
          .from("staff_timeslots")
          .select("staff_id, day, hour, max_bookings")
          .in("staff_id", staffIds)
          .eq("available", true);
        staffSlotRows = (staffSlotData ?? []) as Array<InternalSlot & { staff_id: string }>;
      }

      const nextWeekDates = buildKstDateWindow(new Date(), 7);
      let occupancy: BookingOccupancyCount[];
      try {
        occupancy = await loadPublicBookingAvailability(service, vendorMatch.id, {
          from: nextWeekDates[0].date,
          to: nextWeekDates[nextWeekDates.length - 1].date,
        });
      } catch {
        return publicJson(
          { error: "예약 가능한 시간을 확인할 수 없습니다." },
          503,
        );
      }
      const dateForDay = new Map(nextWeekDates.map(({ date, day }) => [day, date]));

      vendorSlots = toPublicBookingSlots(vendorSlotRows.map((slot) => ({
        ...slot,
        available: true,
        current_bookings: dateForDay.has(slot.day)
          ? bookingCountAt(occupancy, {
              date: dateForDay.get(slot.day)!,
              hour: slot.hour,
            })
          : slot.max_bookings,
      })));

      for (const staffMember of staff) {
        staffSlots[staffMember.id] = toPublicBookingSlots(
          staffSlotRows
            .filter((slot) => slot.staff_id === staffMember.id)
            .map((slot) => ({
              ...slot,
              available: true,
              current_bookings: dateForDay.has(slot.day)
                ? bookingCountAt(occupancy, {
                    date: dateForDay.get(slot.day)!,
                    hour: slot.hour,
                    staffId: staffMember.id,
                  })
                : slot.max_bookings,
            })),
        );
      }
    }

    const publicPosts = filterPublicCommunityPosts(
      (posts ?? []) as CommunityPostWithAuthorId[],
    );
    const postsWithAuthors = await attachAuthorProfiles(
      service,
      publicPosts,
    );

    return publicJson({
      tag: tag ?? null,
      posts: postsWithAuthors,
      vendor: vendorMatch ?? null,
      products,
      staff,
      vendorSlots,
      staffSlots,
    });
  } catch (err) {
    console.error("Vendor tag detail error", safeErrorDiagnostic(err));
    return publicJson({ error: "서버 오류가 발생했습니다." }, 500);
  }
}
