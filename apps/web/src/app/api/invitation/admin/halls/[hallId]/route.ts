import { ymdInKst } from "@/lib/utils/kstDate";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { crossCheckListing, hallListingPatchSchema, toListingColumns } from "@/lib/invitation/adminHallInput";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

/** 운영자 웨딩홀 자료 고치기. 보낸 칸만 바꾼다. 지우지 않고 공개 여부(active)를 끈다. */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

type Params = { params: Promise<{ hallId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!isTrustedMutationRequest(request)) return apiError(403, "UNTRUSTED_ORIGIN", "잘못된 요청 출처예요.");
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) return apiError(401, "ADMIN_REQUIRED", "관리자만 할 수 있어요.");
  try {
    const { hallId } = await params;
    if (!isUuid(hallId)) return apiError(400, "HALL_ID_INVALID", "홀을 다시 골라 주세요.");
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = hallListingPatchSchema.safeParse(body.value);
    if (!parsed.success || Object.keys(parsed.data).length === 0) return apiError(400, "HALL_INVALID", "바꿀 칸을 다시 확인해 주세요.");

    const client = getServiceClient();
    const { data: current, error: readError } = await client
      .from("hall_listings")
      .select("rental_included, rental_fee_won, checked_on")
      .eq("id", hallId)
      .maybeSingle();
    if (readError) return apiError(503, "HALLS_UNAVAILABLE", "홀 자료를 불러오지 못했어요.");
    if (!isRecord(current)) return apiError(404, "HALL_NOT_FOUND", "홀을 찾지 못했어요.");
    const crossError = crossCheckListing({
      rentalIncluded: parsed.data.rentalIncluded ?? current.rental_included === true,
      rentalFeeWon: parsed.data.rentalFeeWon !== undefined
        ? parsed.data.rentalFeeWon
        : typeof current.rental_fee_won === "number" ? current.rental_fee_won : null,
      checkedOn: parsed.data.checkedOn ?? String(current.checked_on),
    }, ymdInKst());
    if (crossError) return apiError(400, "HALL_INVALID", crossError);

    const { error } = await client
      .from("hall_listings")
      .update({ ...toListingColumns(parsed.data), updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", hallId);
    if (error) {
      log.error("[invitation admin halls PATCH] update failed", error);
      return apiError(409, "HALL_REJECTED", "저장하지 못했어요. 입력을 다시 확인해 주세요.");
    }
    return privateJson({ id: hallId });
  } catch (error) {
    log.error("[invitation admin halls PATCH]", error);
    return apiError(500, "SERVER_ERROR", "저장하지 못했어요.");
  }
}
