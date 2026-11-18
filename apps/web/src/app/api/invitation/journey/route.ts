import {
  INVITATION_CONDITIONS_PROGRESS_KEY,
  JOURNEY_PLAN_PROGRESS_KEY,
  buildJourneyModel,
  parseInvitationConditions,
  parseJourneyPlan,
  type InvitationJourneyResponse,
} from "@hanbang/shared/invitation";
import { readShortlist } from "@/lib/invitation/hallRepository";
import { buildJourneyFacts } from "@/lib/invitation/homeModel";
import { apiError, privateJson } from "@/lib/invitation/http";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { log } from "@/utils/log";

/** 준비 순서(JourneyModel). 단계의 끝남은 저장된 사실(조건 셋, 상대 합류, 정한 식장)로만 정한다. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const opened = await openCoupleRequest(request);
    if (!opened.ok) return opened.response;
    const { supabase, context } = opened;
    const shortlist = await readShortlist(supabase, context.coupleId);
    if (!shortlist.ok) return apiError(503, "JOURNEY_UNAVAILABLE", "준비 순서를 불러오지 못했어요.");
    const progress = context.journey?.progress ?? {};
    const plan = parseJourneyPlan(progress[JOURNEY_PLAN_PROGRESS_KEY]);
    const facts = buildJourneyFacts({
      context,
      conditions: parseInvitationConditions(progress[INVITATION_CONDITIONS_PROGRESS_KEY]),
      shortlistCount: shortlist.value.length,
    });
    const response: InvitationJourneyResponse = { journey: buildJourneyModel(facts, plan), plan };
    return privateJson(response);
  } catch (error) {
    log.error("[invitation journey GET]", error);
    return apiError(500, "SERVER_ERROR", "준비 순서를 불러오지 못했어요.");
  }
}
