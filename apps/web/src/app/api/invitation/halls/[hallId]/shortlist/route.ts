import type { HallShortlistResponse } from "@hanbang/shared/invitation";
import { MAX_SHORTLIST, readShortlist } from "@/lib/invitation/hallRepository";
import { apiError, privateJson } from "@/lib/invitation/http";
import { openCoupleRequest } from "@/lib/invitation/routeContext";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { log } from "@/utils/log";

/**
 * 상담 후보 담기와 빼기. 사용자 권한으로 쓰고 RLS 가 회원·공개 중인 홀·본인 이름을 다시 본다.
 * 담는 것은 커플 안의 선호이고 업체로는 아무것도 나가지 않는다.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ hallId: string }> };

async function respond(supabase: Parameters<typeof readShortlist>[0], coupleId: string, hallId: string) {
  const shortlist = await readShortlist(supabase, coupleId);
  if (!shortlist.ok) return apiError(503, "SHORTLIST_UNAVAILABLE", "담은 홀을 다시 불러오지 못했어요.");
  const body: HallShortlistResponse = { hallId, picked: shortlist.value.includes(hallId), pickedCount: shortlist.value.length };
  return privateJson(body);
}

export async function POST(request: Request, { params }: Params) {
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "shortlist", perMinute: 60 }, journey: false });
    if (!opened.ok) return opened.response;
    const { hallId: rawId } = await params;
    if (!isUuid(rawId)) return apiError(400, "HALL_ID_INVALID", "홀을 다시 골라 주세요.");
    const hallId = rawId.toLowerCase();
    const { supabase, context } = opened;

    const current = await readShortlist(supabase, context.coupleId);
    if (!current.ok) return apiError(503, "SHORTLIST_UNAVAILABLE", "담은 홀을 불러오지 못했어요.");
    if (!current.value.includes(hallId) && current.value.length >= MAX_SHORTLIST) {
      return apiError(409, "SHORTLIST_FULL", `상담 후보는 ${MAX_SHORTLIST}곳까지 담을 수 있어요.`);
    }

    const { error } = await supabase
      .from("hall_shortlists")
      .insert({ couple_id: context.coupleId, hall_id: hallId, added_by: context.userId });
    const code = isRecord(error) ? error.code : undefined;
    // DB 도 커플마다 담을 수 있는 수를 지킨다(동시에 담는 경우). 같은 답을 준다.
    if (code === "23514" && isRecord(error) && String(error.message ?? "").includes("HALL_SHORTLIST_FULL")) {
      return apiError(409, "SHORTLIST_FULL", `상담 후보는 ${MAX_SHORTLIST}곳까지 담을 수 있어요.`);
    }
    if (error && code !== "23505") {
      // RLS(42501)와 없는 홀(23503)은 같은 답이다. 공개 중이 아닌 홀은 담을 수 없다.
      if (code === "42501" || code === "23503") return apiError(404, "HALL_NOT_AVAILABLE", "지금은 담을 수 없는 홀이에요.");
      log.error("[invitation shortlist POST] insert failed", error);
      return apiError(503, "SHORTLIST_UNAVAILABLE", "담지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    return respond(supabase, context.coupleId, hallId);
  } catch (error) {
    log.error("[invitation shortlist POST]", error);
    return apiError(500, "SERVER_ERROR", "담지 못했어요.");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const opened = await openCoupleRequest(request, { mutation: { key: "shortlist", perMinute: 60 }, journey: false });
    if (!opened.ok) return opened.response;
    const { hallId: rawId } = await params;
    if (!isUuid(rawId)) return apiError(400, "HALL_ID_INVALID", "홀을 다시 골라 주세요.");
    const hallId = rawId.toLowerCase();
    const { supabase, context } = opened;

    const { error } = await supabase
      .from("hall_shortlists")
      .delete()
      .eq("couple_id", context.coupleId)
      .eq("hall_id", hallId);
    if (error) {
      log.error("[invitation shortlist DELETE] delete failed", error);
      return apiError(503, "SHORTLIST_UNAVAILABLE", "빼지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    return respond(supabase, context.coupleId, hallId);
  } catch (error) {
    log.error("[invitation shortlist DELETE]", error);
    return apiError(500, "SERVER_ERROR", "빼지 못했어요.");
  }
}
