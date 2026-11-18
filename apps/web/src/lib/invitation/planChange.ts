import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPlanChangeRpcDiagnostic } from "@/lib/couples/planChangeRpcDiagnostic";
import { isRecord } from "@/utils/requestValidation";
import { log } from "@/utils/log";

/**
 * 조건·준비 순서·상담 일정을 `wedding_journeys.progress` 에 남기는 길. 새 쓰기 경계를 만들지 않고
 * `/api/journey` 가 쓰는 `submit_couple_plan_change` 를 그대로 부른다. 그 함수가 판 번호 대조,
 * 상대에게 가는 "함께 쓰는 계획이 변경됐어요" 알림, 확정 기록(decision_nodes)을 맡는다.
 *
 * 다른 사람이 그 사이 고쳐 판 번호가 어긋나면 최신 값을 다시 읽어 두 번까지 다시 만든다.
 * 다시 만드는 함수는 사람이 고른 칸만 바꾸므로 상대가 바꾼 다른 칸을 덮지 않는다.
 */

export type PlanSurface = "/schedule" | "/dashboard";

export type ProgressPatchFailure = { kind: "failed"; status: number; code: string; error: string };

export type ProgressPatchOutcome =
  | { kind: "applied"; progress: Record<string, unknown> }
  | { kind: "unchanged"; progress: Record<string, unknown> }
  | ProgressPatchFailure;

export type ProgressPatchPlan =
  | { kind: "patch"; patch: Record<string, unknown>; summary: string }
  | { kind: "unchanged" }
  | ProgressPatchFailure;

const MAX_ATTEMPTS = 3;

const unavailable = (): ProgressPatchFailure => ({
  kind: "failed",
  status: 503,
  code: "PLAN_CHANGE_UNAVAILABLE",
  error: "저장 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
});

function errorText(error: unknown): string {
  if (!isRecord(error)) return String(error ?? "");
  return `${String(error.code ?? "")} ${String(error.message ?? "")} ${String(error.details ?? "")}`;
}

type RpcVerdict = { kind: "applied"; progress: Record<string, unknown> } | { kind: "stale" } | ProgressPatchFailure;

function readVerdict(data: unknown, error: unknown): RpcVerdict {
  if (error) {
    const message = errorText(error);
    if (/COUPLE_PLAN_CHANGE_(?:STALE|EXPIRED|ALREADY_APPLIED|CONFLICT|ROSTER_CHANGED)/i.test(message)) return { kind: "stale" };
    if (/COUPLE_PLAN_CHANGE_SCOPE_DENIED/i.test(message)) {
      return { kind: "failed", status: 403, code: "NOT_COUPLE_MEMBER", error: "이 커플의 준비 정보를 바꿀 수 없어요." };
    }
    if (/COUPLE_PLAN_CHANGE_ACTIVE_REQUEST/i.test(message)) {
      return { kind: "failed", status: 409, code: "PLAN_CHANGE_ACTIVE_REQUEST", error: "먼저 기다리고 있는 확인 요청을 처리해 주세요." };
    }
    if (/COUPLE_PLAN_CHANGE_INVALID|AMORA_MANUAL_SCHEDULE_/i.test(message)) {
      log.error("[invitation] plan change refused", buildPlanChangeRpcDiagnostic(error));
      return { kind: "failed", status: 400, code: "PLAN_CHANGE_INVALID", error: "저장할 내용이 올바르지 않아요." };
    }
    log.error("[invitation] plan change failed", buildPlanChangeRpcDiagnostic(error));
    return unavailable();
  }
  if (!isRecord(data) || typeof data.status !== "string") return unavailable();
  if (data.status === "applied" && isRecord(data.journey) && isRecord(data.journey.progress)) {
    return { kind: "applied", progress: data.journey.progress };
  }
  if (data.status === "stale") return { kind: "stale" };
  if (data.status === "pending_partner") {
    return { kind: "failed", status: 409, code: "PLAN_CHANGE_PENDING", error: "상대의 확인을 기다리는 변경이 있어요." };
  }
  if (data.status === "rejected") {
    return { kind: "failed", status: 409, code: "PLAN_CHANGE_REJECTED", error: "이 변경은 반영되지 않았어요." };
  }
  return unavailable();
}

export async function applyProgressChange(input: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  coupleId: string;
  actorUserId: string;
  surface: PlanSurface;
  build: (progress: Record<string, unknown>) => ProgressPatchPlan;
}): Promise<ProgressPatchOutcome> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data: journey, error: journeyError } = await input.supabase
      .from("wedding_journeys")
      .select("progress, state_revision")
      .eq("couple_id", input.coupleId)
      .maybeSingle();
    if (journeyError) return unavailable();
    if (!isRecord(journey) || typeof journey.state_revision !== "number" || !Number.isSafeInteger(journey.state_revision)) {
      return { kind: "failed", status: 409, code: "JOURNEY_MISSING", error: "준비 정보를 먼저 만들어 주세요." };
    }
    const progress = isRecord(journey.progress) ? journey.progress : {};
    const plan = input.build(progress);
    if (plan.kind === "failed") return plan;
    if (plan.kind === "unchanged") return { kind: "unchanged", progress };

    const { data, error } = await input.admin.rpc("submit_couple_plan_change", {
      p_couple_id: input.coupleId,
      p_actor_user_id: input.actorUserId,
      p_expected_revision: journey.state_revision,
      p_changes: { progress_patch: plan.patch },
      p_surface: input.surface,
      p_summary: plan.summary,
    });
    const verdict = readVerdict(data, error);
    if (verdict.kind !== "stale") return verdict;
  }
  return {
    kind: "failed",
    status: 409,
    code: "PLAN_CHANGE_CONFLICT",
    error: "그 사이 준비 정보가 바뀌었어요. 다시 불러온 뒤 시도해 주세요.",
  };
}
