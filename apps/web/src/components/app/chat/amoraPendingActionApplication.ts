import {
  getPendingActionDisabledReason,
  type PendingActionDisabledReason,
} from "./PendingAmoraActionCard";
import type { ChatMessage, PendingAmoraAction } from "@/types/database.types";

/**
 * 제안 카드가 실제로 반영됐는가.
 *
 * 2026-09-03: 두 채팅 표면이 이 판정을 각자 하다가 반대 방향으로 틀렸다.
 * 전체화면 채팅(`ChatContent`)은 **확인 메시지가 존재한다**는 것만으로 "이 제안은
 * 적용됐어요" 라고 잠갔다. 그런데 그 표식(`confirmed_amora_action_id`)은 도구가
 * 돌기 전, 사용자 확인 행을 INSERT 할 때 무조건 찍힌다 — 서버가 409 로 거절하거나
 * 도구가 `success:false` 를 돌려줘도 카드는 성공이라고 말했다. 사이드 패널
 * (`ChatSidePanel`)은 반대로 이 인자를 아예 안 넘겨, 정말 반영된 뒤에도
 * "새 대화가 이어져 이 제안은 적용할 수 없어요" 를 띄웠다.
 *
 * 그래서 판정을 한곳으로 모으고, 근거를 **확인 메시지의 존재**에서 **반영 성공
 * 증거**로 바꾼다: 그 확인 행을 가리키는(`in_reply_to_user_message_id`) 아모라
 * 응답에서 같은 도구가 `success: true` 로 끝났을 때만 적용으로 본다.
 *
 * 만료·최신성·서버 권한 판정은 건드리지 않는다. 이 파일이 정하는 것은 화면에
 * 무엇이라고 쓰느냐뿐이고, 실제 실행 권한은 여전히 서버가 발급한 action_id 와
 * `authorize_amora_shared_action_execution` 이 쥔다.
 */
export type AmoraPendingActionApplicationState =
  /** 확인 버튼을 누른 적이 없다. */
  | "none"
  /** 확인 행은 있는데 그 행을 가리키는 아모라 응답이 아직 없다. */
  | "awaiting_result"
  /** 응답은 왔는데 그 도구가 성공을 보고하지 않았다. */
  | "failed"
  /** 같은 도구가 success:true 로 끝났다. */
  | "applied";

interface ConfirmationOutcome {
  /** 확인 행을 가리키는 응답에서 성공한 도구 이름들. */
  succeededTools: Set<string>;
  /** 확인 행을 가리키는 응답이 하나라도 있는가. */
  answered: boolean;
}

/**
 * `actionId` → 그 액션을 확인한 행들의 결과. 두 표면이 같은 `messages` 배열을
 * 넣으면 같은 결과가 나와야 한다.
 */
export function buildAmoraActionConfirmationOutcomes(
  messages: readonly ChatMessage[],
): Map<string, ConfirmationOutcome> {
  const responsesByUserMessageId = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    if (message.sender_role !== "ai") continue;
    const sourceId = message.metadata?.in_reply_to_user_message_id;
    if (typeof sourceId !== "string" || !sourceId) continue;
    const bucket = responsesByUserMessageId.get(sourceId);
    if (bucket) bucket.push(message);
    else responsesByUserMessageId.set(sourceId, [message]);
  }

  const outcomes = new Map<string, ConfirmationOutcome>();
  for (const message of messages) {
    const actionId = message.metadata?.confirmed_amora_action_id;
    if (typeof actionId !== "string" || !actionId) continue;
    const outcome = outcomes.get(actionId)
      ?? { succeededTools: new Set<string>(), answered: false };
    for (const response of responsesByUserMessageId.get(message.id) ?? []) {
      outcome.answered = true;
      for (const result of response.metadata?.toolResults ?? []) {
        if (result.success) outcome.succeededTools.add(result.toolName);
      }
    }
    outcomes.set(actionId, outcome);
  }
  return outcomes;
}

export function getAmoraPendingActionApplicationState(
  action: PendingAmoraAction,
  outcomes: Map<string, ConfirmationOutcome>,
): AmoraPendingActionApplicationState {
  const outcome = outcomes.get(action.actionId);
  if (!outcome) return "none";
  if (outcome.succeededTools.has(action.tool)) return "applied";
  return outcome.answered ? "failed" : "awaiting_result";
}

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
