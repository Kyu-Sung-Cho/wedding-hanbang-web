import {
  INVITATION_CONDITIONS_PROGRESS_KEY,
  conditionsSummary,
  missingConditions,
  parseInvitationConditions,
  type InvitationConditions,
  type InvitationConditionsResponse,
} from "@hanbang/shared/invitation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ymdInKst } from "@/lib/utils/kstDate";
import {
  conditionsChangeSummary,
  conditionsEqual,
  mergeConditions,
  parseConditionsPatch,
} from "@/lib/invitation/conditionsInput";
import { apiError, privateJson, readJsonBody } from "@/lib/invitation/http";
import { applyProgressChange } from "@/lib/invitation/planChange";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { isRecord } from "@/utils/requestValidation";
import { log } from "@/utils/log";

/**
 * 결혼 조건(W1): 희망 연·월, 지역, 하객 수, 시간대("토요일 낮"), 준비를 시작한 단계.
 * `wedding_journeys.progress.__invitationConditions` 에 공동 계획 쓰기로 저장한다(상대에게 알림이 간다).
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

function respond(conditions: InvitationConditions, weddingDate: string | null) {
  const body: InvitationConditionsResponse = {
    conditions,
    summary: conditionsSummary(conditions, weddingDate),
    missing: missingConditions(conditions, weddingDate),
    weddingDate,
  };
  return privateJson(body);
}

export async function GET(request: Request) {
  try {
    const opened = await openCoupleRequest(request);
    if (!opened.ok) return opened.response;
    const { journey } = opened.context;
    return respond(parseInvitationConditions(journey?.progress[INVITATION_CONDITIONS_PROGRESS_KEY]), journey?.weddingDate ?? null);
  } catch (error) {
    log.error("[invitation conditions GET]", error);
    return apiError(500, "SERVER_ERROR", "조건을 불러오지 못했어요.");
  }
}

export async function PATCH(request: Request) {
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "conditions", perMinute: 30 } });
    if (!opened.ok) return opened.response;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = parseConditionsPatch(body.value, ymdInKst());
    if (!parsed.ok) return apiError(400, "CONDITIONS_INVALID", parsed.error);

    const { supabase, context } = opened;
    const outcome = await applyProgressChange({
      supabase,
      admin: createAdminClient(),
      coupleId: context.coupleId,
      actorUserId: context.userId,
      surface: "/dashboard",
      build: (progress) => {
        const current = parseInvitationConditions(progress[INVITATION_CONDITIONS_PROGRESS_KEY]);
        const next = mergeConditions(current, parsed.patch);
        if (isRecord(progress[INVITATION_CONDITIONS_PROGRESS_KEY]) && conditionsEqual(current, next)) {
          return { kind: "unchanged" };
        }
        return {
          kind: "patch",
          patch: { [INVITATION_CONDITIONS_PROGRESS_KEY]: next },
          summary: conditionsChangeSummary(next),
        };
      },
    });
    if (outcome.kind === "failed") return apiError(outcome.status, outcome.code, outcome.error);
    return respond(
      parseInvitationConditions(outcome.progress[INVITATION_CONDITIONS_PROGRESS_KEY]),
      context.journey?.weddingDate ?? null,
    );
  } catch (error) {
    log.error("[invitation conditions PATCH]", error);
    return apiError(500, "SERVER_ERROR", "조건을 저장하지 못했어요.");
  }
}
