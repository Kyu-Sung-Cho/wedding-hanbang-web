import {
  INVITATION_CONDITIONS_PROGRESS_KEY,
  parseInvitationConditions,
  type InvitationHomeResponse,
} from "@hanbang/shared/invitation";
import { getAmoraActions, type AmoraActionItem } from "@/lib/amora/actions";
import { readAmoraActionSnapshot } from "@/lib/amora/actionRepository";
import { buildHomeModel } from "@/lib/invitation/homeModel";
import { apiError, privateJson } from "@/lib/invitation/http";
import { buildAmoraUpdateDetail, inquiryDecisions } from "@/lib/invitation/inquiryView";
import { loadLetterView } from "@/lib/invitation/letterService";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { log } from "@/utils/log";

/**
 * 청첩장 홈(HomeModel). 이름, 날짜, 식장, 시간대는 저장된 사실에서, 아모라 소식은 실제 문의 기록에서,
 * 두 분이 정할 것은 문의에서 생긴 결정과 함께 쓰는 할 일(담당자 칸이 없어 "함께")에서 온다.
 * 할 일을 읽지 못하면 빈 목록으로 숨기지 않고 `degraded` 로 알린다.
 * 소식의 "무엇을 했나요?" 줄은 `updateSteps` 에 누가 했는지(아모라, 담당자, 두 분)와 함께 다시 담는다.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const opened = await openCoupleRequest(request);
    if (!opened.ok) return opened.response;
    const { supabase, context } = opened;
    const progress = context.journey?.progress ?? {};

    const letterView = await loadLetterView(supabase, context);
    if (!letterView) return apiError(503, "HOME_UNAVAILABLE", "홈을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");

    let actions: AmoraActionItem[] = [];
    const degraded: InvitationHomeResponse["degraded"][number][] = [];
    try {
      const snapshot = await readAmoraActionSnapshot(supabase, context.coupleId, getAmoraActions(progress), "open");
      actions = snapshot.actions;
    } catch (error) {
      log.error("[invitation home] shared actions unavailable", error);
      degraded.push("decisions");
    }

    const names = new Map(context.members.map((member) => [member.id, member.name]));
    const update = buildAmoraUpdateDetail({ timeline: letterView.timeline, openLetter: letterView.open });
    const home = buildHomeModel({
      context,
      conditions: parseInvitationConditions(progress[INVITATION_CONDITIONS_PROGRESS_KEY]),
      update: update?.update ?? null,
      inquiryDecisions: inquiryDecisions({
        timeline: letterView.timeline,
        openLetter: letterView.open,
        viewerId: context.userId,
        nameOf: (userId) => names.get(userId) ?? null,
      }),
      actions,
    });
    const response: InvitationHomeResponse = { home, degraded, updateSteps: update?.steps ?? [] };
    return privateJson(response);
  } catch (error) {
    log.error("[invitation home GET]", error);
    return apiError(500, "SERVER_ERROR", "홈을 불러오지 못했어요.");
  }
}
