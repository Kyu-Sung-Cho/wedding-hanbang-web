import { hasCoerciveControlSignal } from "@hanbang/shared";

import {
  AMORA_CHECKLIST_STATE_VERB,
  mentionsKnownChecklistItem,
} from "@/lib/ai/amoraToolPolicy";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";

/**
 * "이 커플의 체크리스트 항목을 끝냈다" 는 말을 결혼 밖으로 두지 않는다.
 *
 * 실측(2026-08-23): "디자인 초안 선택 다 했어" 가 `W4_out_of_scope` 로 떨어져
 * 커플 자료 읽기가 통째로 건너뛰어졌고, 그래서 카드가 나올 수 없었다.
 *
 * ## 왜 한 곳에 모았는가
 *
 * 처음에는 이 조건이 라우트 안에 인라인으로 있었고, 경계 테스트가 그 조건을
 * **복사해서** 다시 구현했다. 그러다 안전 판정 한 줄이 바뀌자 라우트와 사본이
 * 갈라졌고, 테스트는 라우트가 아니라 자기 사본을 재고 있었다. 오늘 하루에만
 * 같은 부류(TS와 SQL, 계약문과 코드)로 세 번 당했다. 그래서 판정은 여기 하나만
 * 두고 라우트와 테스트가 같은 것을 부른다.
 *
 * ## 경계
 *
 * - **W4 에서만** 올린다. W2·W5 안전 축은 이 함수에 닿지도 않는다.
 * - 올리기만 하고 내리지 않는다.
 * - 완료·해제 표현이 없으면 조회조차 하지 않는다.
 * - 존재하지 않는 항목에는 열리지 않는다 — 이름이 이 커플 자료에 있어야 한다.
 * - 기억은 켜지 않는다(호출부가 `allowsLongTermMemory: false` 로 만든다).
 */
export function shouldRescueChecklistScope(input: {
  userText: string;
  checklistLabels: readonly string[] | undefined;
  isWeddingCoreCandidate: boolean;
}): boolean {
  const { userText, checklistLabels, isWeddingCoreCandidate } = input;
  if (!isWeddingCoreCandidate) return false;
  if (!AMORA_CHECKLIST_STATE_VERB.test(userText)) return false;

  // 안전 서술이 섞이면 구제하지 않는다. "초대장 주문·제작 다 했는데 신랑이
  // 화내서 무서웠어요" 처럼 항목 이름과 안전 서술이 한 문장에 올 수 있다.
  if (hasAmoraSafetySignal(userText, "chat")) return false;

  // 강압 통제 탐지기는 **이 관문에서만** 쓴다.
  //
  // 같은 날 이 탐지기를 `hasAmoraSafetySignal` 에 붙였다가 되돌렸다. 거기서는
  // 평범한 결혼 문장("청첩장 문자 문구를 다 확인했어요")을 걸어 사용자 말이
  // 공유 대화에서 사라지게 만들었기 때문이다.
  //
  // 이 자리는 다르다. 걸려서 잃는 것은 **체크리스트 카드 한 장**이고 말이
  // 사라지거나 전송이 막히지 않는다. 그리고 여기서는 fail-closed 가 옳다 —
  // 통제 서술이 섞인 문장을 W0 으로 올리면 커플의 저장 문맥이 함께 나간다.
  if (hasCoerciveControlSignal(userText)) return false;

  return mentionsKnownChecklistItem(userText, checklistLabels);
}
