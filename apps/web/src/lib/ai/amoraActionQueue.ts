import {
  AMORA_MAX_QUEUED_ACTIONS,
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
