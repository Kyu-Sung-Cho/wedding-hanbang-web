import {
  AMORA_MAX_QUEUED_ACTIONS,
  describeExpiredAmoraPendingAction,
  describeUnconfirmedAmoraPendingAction,
  validateAmoraQueuedAction,
  type AmoraQueuedAction,
  type StoredAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

/** 남은 요청은 실행 권한이 아니다. 각 항목은 최신 여정에서 새 확인 카드를 발급한다. */
export interface AmoraActionQueue {
  version: 1;
  queueId: string;
  currentActionId: string;
  totalCount: number;
  completedCount: number;
  remainingActions: AmoraQueuedAction[];
}

export function createAmoraActionQueue(
  head: StoredAmoraPendingAction,
  remainingActions: AmoraQueuedAction[] | undefined,
): AmoraActionQueue | null {
  if (!remainingActions?.length) return null;
  return {
    version: 1,
    queueId: head.actionId,
    currentActionId: head.actionId,
    totalCount: remainingActions.length + 1,
    completedCount: 0,
    remainingActions,
  };
}

export function resolveAmoraActionQueue(
  value: unknown,
  head: StoredAmoraPendingAction,
  allowedTools: readonly AiToolDefinition[],
  now: number,
): AmoraActionQueue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 6 || row.version !== 1
    || typeof row.queueId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.queueId)
    || row.currentActionId !== head.actionId
    || typeof row.totalCount !== "number" || !Number.isInteger(row.totalCount)
    || row.totalCount < 2 || row.totalCount > AMORA_MAX_QUEUED_ACTIONS
    || typeof row.completedCount !== "number" || !Number.isInteger(row.completedCount)
    || row.completedCount < 0 || row.completedCount >= row.totalCount
    || !Array.isArray(row.remainingActions)
    || row.remainingActions.length !== row.totalCount - row.completedCount - 1) return null;
  const remainingActions: AmoraQueuedAction[] = [];
  const keys = new Set([head.operationKey]);
  for (const item of row.remainingActions) {
    const action = validateAmoraQueuedAction(item, allowedTools, now);
    if (!action || getAmoraActionApprovalPolicy(action.tool, action.input) === "blocked") return null;
    const key = getAmoraToolOperationIdentity(action.tool, action.input).operationKey;
    if (keys.has(key)) return null;
    keys.add(key);
    remainingActions.push(action);
  }
  return {
    version: 1,
    queueId: row.queueId,
    currentActionId: head.actionId,
    totalCount: row.totalCount,
    completedCount: row.completedCount,
    remainingActions,
  };
}

export function advanceAmoraActionQueue(
  queue: AmoraActionQueue,
  next: StoredAmoraPendingAction,
): AmoraActionQueue {
  return {
    ...queue,
    currentActionId: next.actionId,
    completedCount: queue.completedCount + 1,
    remainingActions: queue.remainingActions.slice(1),
  };
}

/**
 * 지금 카드를 **적용하지 않고** 다음 항목으로 넘긴 대기열 (2026-09-18).
 *
 * 건너뛴 항목은 반영도 확인도 하지 않은 것이라 완료 건수가 아니라 전체 건수에서 뺀다.
 * 대기열 안에서 거절된 요청을 세는 방식과 같다 — 그래야 뒤의 "N건 중 M건 반영했어요" 가
 * 참이고 `resolveAmoraActionQueue` 의 건수 불변식(남은 건수 = 전체 − 완료 − 1)도 그대로다.
 * 남는 전체가 2건보다 적으면 대기열이 아니다(null) — 다음 카드는 단일 카드로 나간다.
 *
 * 건너뛰기는 변경이 아니다. 이 함수는 아무것도 실행하지 않고 다음 확인 카드의 자리만 정한다.
 */
export function skipAmoraActionQueueHead(
  queue: AmoraActionQueue,
  next: StoredAmoraPendingAction,
): AmoraActionQueue | null {
  if (queue.totalCount - 1 < 2) return null;
  return {
    ...queue,
    currentActionId: next.actionId,
    totalCount: queue.totalCount - 1,
    remainingActions: queue.remainingActions.slice(1),
  };
}

/** 안내로만 읽은 대기열. `describedAt` 은 항목 설명을 만들 기준 시각이다. */
export interface AbandonedAmoraActionQueue {
  head: StoredAmoraPendingAction;
  queue: AmoraActionQueue;
  describedAt: number;
}

/**
 * **말없이 사라질 대기열을 안내하기 위해서만** 읽는다 (2026-09-18).
 *
 * 카드가 살아 있으면 지금을 기준으로 읽는다(오늘까지의 경로 그대로). 살아 있지 않으면
 * `describeExpiredAmoraPendingAction` 으로 **발급 시각**을 기준으로 한 번 더 읽는다 —
 * 2026-09-18 재검사에서 찾은 구멍이다. 카드를 치우고 자리를 뜬 뒤 확인 창(10분~24시간)이
 * 지나 돌아오면 머리 카드가 만료돼 대기열이 아예 보이지 않았고, 남은 요청은 안내 한 줄 없이
 * 사라졌다. 이 경로는 실수가 아니라 **평범한 경로**다.
 *
 * 남은 항목도 같은 기준 시각으로 검증한다. `resolveAmoraActionQueue` 는 항목 하나가
 * 어긋나면 대기열 전체를 버리므로, 그 사이 날짜가 지난 일정 하나가 목록을 통째로 지우는
 * 것을 막는다. 목록은 **그때 무엇을 부탁했는지** 적는 자리다.
 *
 * 돌려주는 값은 실행 권한도, 모델에게 주는 읽기 신호도 아니다. 서버가 답변 뒤에 붙이는
 * 목록과 metadata 에만 쓴다 — 만료된 카드로는 아무것도 적용할 수 없다.
 */
export function resolveAbandonedAmoraActionQueue({
  pendingAction,
  queueValue,
  allowedTools,
  now,
}: {
  pendingAction: unknown;
  queueValue: unknown;
  allowedTools: readonly AiToolDefinition[];
  now: number;
}): AbandonedAmoraActionQueue | null {
  const live = describeUnconfirmedAmoraPendingAction({ value: pendingAction, allowedTools, now });
  if (live) {
    const queue = resolveAmoraActionQueue(queueValue, live, allowedTools, now);
    return queue ? { head: live, queue, describedAt: now } : null;
  }
  const expired = describeExpiredAmoraPendingAction({ value: pendingAction, allowedTools, now });
  if (!expired) return null;
  const describedAt = expired.issuedAt;
  const queue = resolveAmoraActionQueue(queueValue, expired, allowedTools, describedAt);
  return queue ? { head: expired, queue, describedAt } : null;
}
