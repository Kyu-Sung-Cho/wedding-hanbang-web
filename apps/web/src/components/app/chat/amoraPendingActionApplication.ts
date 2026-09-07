import {
  getPendingActionDisabledReason,
  type PendingActionDisabledReason,
} from "./PendingAmoraActionCard";
import type { PendingAmoraAction } from "@/types/database.types";

import type { AmoraPendingActionApplicationState } from "@hanbang/shared";
export {
  buildAmoraActionConfirmationOutcomes,
  getAmoraPendingActionApplicationState,
  type AmoraPendingActionApplicationState,
} from "@hanbang/shared";

/**
 * 카드에 붙일 안내를 정한다. `applied` 만 이 함수가 새로 결정하고, 나머지는
 * 기존 판정(`getPendingActionDisabledReason`)을 그대로 통과시킨다.
 *
 * 아직 결과가 오지 않았고 답변이 진행 중이면 성공으로 단정하지 않고 `busy` 로 둔다 —
 * "현재 답변이 끝나면 다시 확인할 수 있어요" 는 그 순간에 참인 유일한 문장이다.
 */
export function resolveAmoraPendingActionDisabledReason(input: {
  action: PendingAmoraAction;
  nowMs: number;
  isLatest: boolean;
  busy: boolean;
  applicationState: AmoraPendingActionApplicationState;
}): PendingActionDisabledReason {
  if (input.applicationState === "applied") return "applied";
  if (input.applicationState === "awaiting_result" && input.busy) return "busy";
  return getPendingActionDisabledReason(
    input.action,
    input.nowMs,
    input.isLatest,
    input.busy,
    false,
  );
}
