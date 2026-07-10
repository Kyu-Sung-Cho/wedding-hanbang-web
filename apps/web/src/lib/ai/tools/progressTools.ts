import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * wedding_journeys.progress 를 "변경된 최상위 키만" 원자적으로 병합한다.
 * apply_journey_progress_patch RPC(20260611160000) 가 DB row lock 으로 현재 값을 읽어
 * 병합하므로, 커플 2인이 서로 다른 키를 동시에 고쳐도 lost update 가 나지 않는다.
 *
 * RPC 실패 시 stale whole-blob UPDATE로 폴백하지 않는다. RPC commit 뒤 응답만
 * 유실된 경우나 동시 수정 중에 폴백하면 파트너의 변경을 덮을 수 있기 때문이다.
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

  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("apply_journey_progress_patch returned an invalid progress object");
  }
  ctx.weddingContext.progress = data as ToolExecutionContext["weddingContext"]["progress"];
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
