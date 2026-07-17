import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * wedding_journeys.progress 를 "변경된 최상위 키만" 원자적으로 병합한다.
 * apply_journey_progress_patch RPC(20260611160000) 가 DB row lock 으로 현재 값을 읽어
 * 병합하므로, 커플 2인이 서로 다른 키를 동시에 고쳐도 lost update 가 나지 않는다.
 *
 * RPC 오류나 비정상 응답에서는 실패로 닫는다. 호출 시점의 오래된 전체 JSON으로
 * 폴백하면 파트너나 다른 요청이 방금 저장한 값을 지울 수 있기 때문이다.
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
    throw new Error("apply_journey_progress_patch returned invalid data");
  }

  ctx.weddingContext.progress = data as ToolExecutionContext["weddingContext"]["progress"];
}

/**
 * Atomically merges fields into one progress item using the database's latest
 * value. This is required for category fields such as status/budget/checklist:
 * replacing the whole item from an in-memory snapshot can erase a partner's
 * concurrent change.
 */
export async function patchJourneyProgressItem(
  ctx: ToolExecutionContext,
  itemKey: string,
  itemPatch: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_journey_progress_item_patch", {
    p_couple_id: ctx.coupleId,
    p_item_key: itemKey,
    p_item_patch: itemPatch,
  });

  if (
    error
    || !data
    || typeof data !== "object"
    || Array.isArray(data)
  ) {
    throw error ?? new Error("apply_journey_progress_item_patch returned invalid data");
  }

  ctx.weddingContext.progress = {
    ...(ctx.weddingContext.progress as Record<string, unknown>),
    [itemKey]: data,
  } as ToolExecutionContext["weddingContext"]["progress"];
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
