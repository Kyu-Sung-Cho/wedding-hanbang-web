import {
  INVITATION_CONDITIONS_PROGRESS_KEY,
  JOURNEY_PLAN_PROGRESS_KEY,
  buildJourneyModel,
  parseInvitationConditions,
  parseJourneyPlan,
  type InvitationJourneyResponse,
} from "@hanbang/shared/invitation";
import { createAdminClient } from "@/lib/supabase/admin";
import { readShortlist } from "@/lib/invitation/hallRepository";
import { buildJourneyFacts } from "@/lib/invitation/homeModel";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { journeyPlanSummary, journeyPlansEqual, parseJourneyPlanInput } from "@/lib/invitation/journeyPlanInput";
import { applyProgressChange } from "@/lib/invitation/planChange";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { isRecord } from "@/utils/requestValidation";
import { log } from "@/utils/log";

/** 준비 순서에서 뺀 단계와 넣은 갈래를 커플 계획으로 저장한다(`progress.__journeyPlan`). */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;

export async function PATCH(request: Request) {
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "journey-plan", perMinute: 30 } });
    if (!opened.ok) return opened.response;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = parseJourneyPlanInput(body.value);
    if (!parsed.ok) return apiError(400, "JOURNEY_PLAN_INVALID", parsed.error);

    const { supabase, context } = opened;
    const outcome = await applyProgressChange({
      supabase,
      admin: createAdminClient(),
      coupleId: context.coupleId,
      actorUserId: context.userId,
      surface: "/dashboard",
      build: (progress) => {
        const current = parseJourneyPlan(progress[JOURNEY_PLAN_PROGRESS_KEY]);
        if (isRecord(progress[JOURNEY_PLAN_PROGRESS_KEY]) && journeyPlansEqual(current, parsed.plan)) return { kind: "unchanged" };
        return {
          kind: "patch",
          patch: { [JOURNEY_PLAN_PROGRESS_KEY]: { off: [...parsed.plan.off], addOns: [...parsed.plan.addOns] } },
          summary: journeyPlanSummary(parsed.plan),
        };
      },
    });
    if (outcome.kind === "failed") return apiError(outcome.status, outcome.code, outcome.error);

    const shortlist = await readShortlist(supabase, context.coupleId);
    if (!shortlist.ok) return apiError(503, "JOURNEY_UNAVAILABLE", "준비 순서를 다시 불러오지 못했어요.");
    const plan = parseJourneyPlan(outcome.progress[JOURNEY_PLAN_PROGRESS_KEY]);
    const facts = buildJourneyFacts({
      context,
      conditions: parseInvitationConditions(outcome.progress[INVITATION_CONDITIONS_PROGRESS_KEY]),
      shortlistCount: shortlist.value.length,
    });
    const response: InvitationJourneyResponse = { journey: buildJourneyModel(facts, plan), plan };
    return privateJson(response);
  } catch (error) {
    log.error("[invitation journey-plan PATCH]", error);
    return apiError(500, "SERVER_ERROR", "준비 순서를 저장하지 못했어요.");
  }
}
