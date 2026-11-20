import {
  INVITATION_CONDITIONS_PROGRESS_KEY,
  conditionYearMonth,
  parseInvitationConditions,
  type CompareSortId,
  type InvitationConditionKey,
  type InvitationHallsResponse,
} from "@hanbang/shared/invitation";
import { buildCompareModel, isHallSortId } from "@/lib/invitation/hallCompare";
import { readHallsByIds, readRegionHalls, readShortlist } from "@/lib/invitation/hallRepository";
import { apiError, privateJson } from "@/lib/invitation/http";
import { readInquiryTimeline } from "@/lib/invitation/inquiryRepository";
import { hallInquiryStates } from "@/lib/invitation/inquiryView";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { log } from "@/utils/log";

/**
 * 웨딩홀 비교(W2, CompareModel). 운영자가 출처와 확인일을 적어 넣은 홀 가운데 커플이 말한 지역의 홀과
 * 이미 담은 홀을 같은 하객 수로 셈한다. 하객 수나 지역이 없으면 비교하지 않고 무엇이 필요한지 알려 준다.
 * `?sort=total|transit|minimum|mood` 는 사용자가 고른 기준만 받는다.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const opened = await openCoupleRequest(request);
    if (!opened.ok) return opened.response;
    const rawSort = new URL(request.url).searchParams.get("sort");
    if (rawSort !== null && !isHallSortId(rawSort)) return apiError(400, "SORT_INVALID", "정렬 기준을 다시 골라 주세요.");
    const sort: CompareSortId = rawSort ?? "total";
    const { supabase, context } = opened;
    const conditions = parseInvitationConditions(context.journey?.progress[INVITATION_CONDITIONS_PROGRESS_KEY]);
    const shortlist = await readShortlist(supabase, context.coupleId);
    if (!shortlist.ok) return apiError(503, "HALLS_UNAVAILABLE", "웨딩홀을 불러오지 못했어요.");

    const missing: InvitationConditionKey[] = [];
    if (conditions.guestCount === null) missing.push("guests");
    if (!conditions.region) missing.push("region");
    if (conditions.guestCount === null || !conditions.region) {
      const response: InvitationHallsResponse = { compare: null, missing, sort, pickedCount: shortlist.value.length, sources: [] };
      return privateJson(response);
    }

    const [regionHalls, timeline] = await Promise.all([
      readRegionHalls(supabase, conditions.region),
      readInquiryTimeline(supabase, context.coupleId),
    ]);
    if (!regionHalls.ok || !timeline.ok) return apiError(503, "HALLS_UNAVAILABLE", "웨딩홀을 불러오지 못했어요.");
    const known = new Set(regionHalls.value.map((hall) => hall.id));
    const extras = await readHallsByIds(supabase, shortlist.value.filter((id) => !known.has(id)));
    if (!extras.ok) return apiError(503, "HALLS_UNAVAILABLE", "웨딩홀을 불러오지 못했어요.");

    // 운영자가 공개를 끈 홀은 담아 두었어도 비교에 넣지 않는다(확인일이 지난 자료일 수 있다).
    const { compare, sources } = buildCompareModel({
      halls: [...regionHalls.value, ...extras.value.filter((hall) => hall.active)],
      guests: conditions.guestCount,
      month: conditionYearMonth(conditions, context.journey?.weddingDate ?? null)?.month ?? null,
      pickedIds: new Set(shortlist.value),
      sort,
      states: hallInquiryStates(timeline.value),
    });
    const response: InvitationHallsResponse = { compare, missing, sort, pickedCount: shortlist.value.length, sources };
    return privateJson(response);
  } catch (error) {
    log.error("[invitation halls GET]", error);
    return apiError(500, "SERVER_ERROR", "웨딩홀을 불러오지 못했어요.");
  }
}
