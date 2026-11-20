import { ymdInKst } from "@/lib/utils/kstDate";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { crossCheckListing, hallListingCreateSchema, toListingColumns } from "@/lib/invitation/adminHallInput";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

/**
 * 운영자 웨딩홀 자료(W2). 관리자만 읽고 쓴다(`verifyAdmin`, 접근 기록이 남는다). 공개 가격 공시 표는 쓰지 않는다.
 *   GET  모든 홀(공개 중이 아닌 것 포함)
 *   POST 새 홀. 출처 주소와 확인일이 반드시 있어야 하고 공개 여부의 기본은 꺼짐이다.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

export async function GET(request: Request) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) return apiError(401, "ADMIN_REQUIRED", "관리자만 볼 수 있어요.");
  try {
    const { data, error } = await getServiceClient()
      .from("hall_listings")
      .select("id, name, region, area_label, kind_label, meal_price_won, rental_fee_won, rental_included, minimum_guarantee, station_walk_minutes, transit_note, photo_url, source_url, checked_on, active, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(300);
    if (error) {
      log.error("[invitation admin halls GET] read failed", error);
      return apiError(503, "HALLS_UNAVAILABLE", "홀 자료를 불러오지 못했어요.");
    }
    return privateJson({ halls: data ?? [] });
  } catch (error) {
    log.error("[invitation admin halls GET]", error);
    return apiError(500, "SERVER_ERROR", "홀 자료를 불러오지 못했어요.");
  }
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return apiError(403, "UNTRUSTED_ORIGIN", "잘못된 요청 출처예요.");
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) return apiError(401, "ADMIN_REQUIRED", "관리자만 할 수 있어요.");
  try {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = hallListingCreateSchema.safeParse(body.value);
    if (!parsed.success) return apiError(400, "HALL_INVALID", "입력을 다시 확인해 주세요.");
    const crossError = crossCheckListing(parsed.data, ymdInKst());
    if (crossError) return apiError(400, "HALL_INVALID", crossError);

    const { data, error } = await getServiceClient()
      .from("hall_listings")
      .insert({ ...toListingColumns(parsed.data), created_by: userId, updated_by: userId })
      .select("id")
      .single();
    if (error) {
      log.error("[invitation admin halls POST] insert failed", error);
      return apiError(409, "HALL_REJECTED", "저장하지 못했어요. 입력을 다시 확인해 주세요.");
    }
    return privateJson({ id: data?.id ?? null }, 201);
  } catch (error) {
    log.error("[invitation admin halls POST]", error);
    return apiError(500, "SERVER_ERROR", "저장하지 못했어요.");
  }
}
