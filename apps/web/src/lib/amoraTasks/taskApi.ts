import { NextResponse } from "next/server";
import { AMORA_TASK_ID_PATTERN } from "@hanbang/shared/amora-tasks";
import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { amoraTaskFailure } from "./report";
import type { AmoraTaskMemberRow } from "./taskStore";

/** 맡은 일 API 의 공통 부분. 응답은 앱과 웹이 같은 계약(`@hanbang/shared/amora-tasks`)으로 읽는다. */

export const AMORA_TASK_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

export function taskJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: AMORA_TASK_PRIVATE_HEADERS });
}

/** 스위치가 꺼졌거나 표가 아직 없을 때. 화면은 이 응답을 받으면 아무것도 그리지 않는다. */
export function taskOffResponse(reason: "disabled" | "unavailable"): NextResponse {
  return taskJson(reason === "disabled"
    ? { enabled: false, available: false, tasks: [] }
    : { enabled: true, available: false, tasks: [] });
}

type RequestClient = Awaited<ReturnType<typeof createClientFromRequest>>;

export type TaskViewer = { supabase: RequestClient; userId: string; coupleId: string | null };

export async function resolveTaskViewer(
  request: Request,
  rateScope: string,
  maxPerMinute: number,
): Promise<{ ok: true; viewer: TaskViewer } | { ok: false; response: NextResponse }> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !AMORA_TASK_ID_PATTERN.test(user.id)) {
    return { ok: false, response: taskJson({ error: "인증이 필요합니다.", code: "AMORA_TASKS_AUTH_REQUIRED" }, 401) };
  }
  const limited = checkRateLimit(rateLimitKey(rateScope, request, user.id), { maxRequests: maxPerMinute, windowMs: 60_000 });
  if (limited) {
    for (const [key, value] of Object.entries(AMORA_TASK_PRIVATE_HEADERS)) limited.headers.set(key, value);
    return { ok: false, response: limited };
  }
  const { data: profile, error } = await supabase.from("profiles").select("couple_id").eq("id", user.id).maybeSingle();
  if (error) {
    log.error("[amora-tasks] profile read failed", amoraTaskFailure("AMORA_TASKS_PROFILE_UNAVAILABLE", error));
    return { ok: false, response: taskJson({ error: "커플 정보를 확인하지 못했어요.", code: "AMORA_TASKS_PROFILE_UNAVAILABLE" }, 503) };
  }
  const coupleId = typeof profile?.couple_id === "string" && AMORA_TASK_ID_PATTERN.test(profile.couple_id)
    ? profile.couple_id
    : null;
  return { ok: true, viewer: { supabase, userId: user.id, coupleId } };
}

function iso(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function toTaskSummary(row: AmoraTaskMemberRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    reviewReason: row.review_reason,
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toTaskDetail(row: AmoraTaskMemberRow) {
  return {
    ...toTaskSummary(row),
    offerExpiresAt: iso(row.offer_expires_at),
    steps: Array.isArray(row.steps) ? row.steps : [],
    result: row.result && typeof row.result === "object" ? row.result : null,
  };
}
