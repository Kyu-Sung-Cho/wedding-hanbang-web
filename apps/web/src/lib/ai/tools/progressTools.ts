import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * wedding_journeys.progress 를 "변경된 최상위 키만" 원자적으로 병합한다.
 * apply_journey_progress_patch RPC(20260611160000) 가 DB row lock 으로 현재 값을 읽어
 * 병합하므로, 커플 2인이 서로 다른 키를 동시에 고쳐도 lost update 가 나지 않는다.
 *
 * RPC 가 아직 배포(마이그레이션 적용)되지 않았으면 기존 whole-blob 방식으로 폴백한다
 * → 마이그레이션 적용 전에도 무중단. 적용되는 순간 자동으로 원자 경로로 전환된다.
 */
export async function patchJourneyProgress(
  ctx: ToolExecutionContext,
  patch: Record<string, unknown>,
  removeKeys: string[] = []
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_journey_progress_patch", {
    p_couple_id: ctx.coupleId,
    p_patch: patch,
    p_remove_keys: removeKeys,
  });

  if (!error && data) {
    ctx.weddingContext.progress = data as ToolExecutionContext["weddingContext"]["progress"];
    return;
  }

  const merged: Record<string, unknown> = {
    ...(ctx.weddingContext.progress as Record<string, unknown>),
  };
  for (const key of removeKeys) delete merged[key];
  Object.assign(merged, patch);
  const { error: fallbackError } = await admin
    .from("wedding_journeys")
    .update({ progress: merged })
    .eq("couple_id", ctx.coupleId);
  if (fallbackError) throw fallbackError;
  ctx.weddingContext.progress = merged as unknown as ToolExecutionContext["weddingContext"]["progress"];
}

/**
 * 전체 progress 객체를 받아 이전 스냅샷과 diff 해 변경된 최상위 키만 원자적으로 반영.
 */
export async function saveProgress(
  ctx: ToolExecutionContext,
  progress: Record<string, unknown>
): Promise<void> {
  const prev = (ctx.weddingContext.progress ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const removeKeys: string[] = [];

  for (const key of Object.keys(progress)) {
    if (JSON.stringify(progress[key]) !== JSON.stringify(prev[key])) {
      patch[key] = progress[key];
    }
  }
  for (const key of Object.keys(prev)) {
    if (!(key in progress)) removeKeys.push(key);
  }

  await patchJourneyProgress(ctx, patch, removeKeys);
}
