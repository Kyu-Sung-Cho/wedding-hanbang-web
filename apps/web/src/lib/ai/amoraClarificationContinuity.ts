import { hasAmoraExplanatoryContinuityCue } from "@/lib/ai/amoraBoundedContinuity";
import {
  classifyAmoraQuestionScope,
  hasAmoraSafetySignal,
} from "@/lib/ai/amoraQuestionScope";

/**
 * 아모라가 되물으면 그 대화는 빠져나올 수 없었다.
 *
 * `classifyAmoraQuestionScope`는 발화 하나만 보고 판정한다. 그래서 아모라가
 * "2026년으로 넣을까요, 2027년으로 넣을까요?"라고 물은 **직후**에 사용자가
 * "응 넣어줘"라고 답하면, 그 문장만으로는 웨딩 신호가 없어 W4로 떨어지고
 * `filterAmoraToolsByQuestionScope`가 도구를 전부 걷어간다. 도구가 없으니
 * 일정도 예산도 못 넣고, 제안 카드조차 낼 수 없어 또 되묻는다. 사용자가
 * 빠져나올 방법이 없었다(2026-08-20 스테이징 실측).
 *
 * 여기서 여는 것은 **실행 권한이 아니다.** W0에서도 변경 함수는 도구 목록에
 * 들어가지 않는다(route.ts의 `isMutatingTool` 필터). 이 연속성이 되돌려주는
 * 것은 조회 도구와 **확인 카드를 낼 수 있는 자격**뿐이고, 실제 변경은 지금까지와
 * 똑같이 `pending_amora_action` → 사용자 확인 → 서버 실행 경로로만 일어난다.
 * 그러므로 "짧은 확인 한 마디로 뭔가가 저장된다"는 일은 이 변경으로 생기지 않는다.
 *
 * 반대 방향도 같은 결함이었다. 분류기가 문맥을 못 보면 웨딩 맥락만 잃는 게
 * 아니라 **안전 맥락도 잃는다.** 그래서 이 연속성은 한쪽으로만 열린다 —
 * 직전 사용자 발화가 W0이고 안전 신호가 없을 때만이며, 현재 발화가 스스로
 * 안전·고위험·범위 밖 신호를 하나라도 들고 있으면 아래 `isAmoraClarificationAnswerShaped`
 * 가 먼저 거부한다. 현재 발화의 경계는 여전히 최종 판정이다.
 */

/** 되묻기에 대한 답은 짧다. 기존 연속성 경로와 같은 상한을 쓴다. */
export const AMORA_CLARIFICATION_ANSWER_MAX_CHARS = 240;

export type AmoraClarificationContinuityRow = {
  id: unknown;
  sender_id: unknown;
  sender_type: unknown;
  role: unknown;
  content: unknown;
  metadata: unknown;
  visibility: unknown;
};

export type AmoraWeddingClarificationContinuity = {
  mode: "wedding_clarification_answer";
  /**
   * 직전 W0 발화 원문. **도구 재선택 입력으로만** 쓴다. 이 문장은 자기 턴에서
   * 이미 W0로 판정돼 같은 도구를 받았으므로, 여기서 새로 열리는 권한은 없다.
   */
  priorUserText: string;
  priorUserMessageId: string;
  assistantMessageId: string;
};

/**
 * 아모라 쪽 문장은 어휘로 검사하지 않는다.
 *
 * 처음에는 "아모라가 물음표나 `~까요`·`알려주세요`로 끝났는가"를 요구했다. 뺐다.
 * 그건 안전 장치가 아니라 정밀도 필터였는데, **틀리는 방향이 나빴다.** 목록에
 * 없는 어미로 되물으면 연속성이 안 붙어 고리가 그대로 남는다 — 고치려던 결함
 * 그 자체로 조용히 되돌아간다. 반대로 이 검사를 없애서 생기는 일은 아모라가
 * 서술만 한 뒤의 "응"도 조회 도구를 받는 것뿐이고, 그건 피해가 아니다.
 *
 * 이 저장소가 반복해서 배운 것이 그것이다: **어휘를 늘려도 목록에 없는 말은
 * 계속 나온다.** 실측 두 건("…넣을까요?" / "…알려주세요.")을 맞히도록 정규식을
 * 짜도 세 번째 어미는 알 수 없다.
 *
 * 안전 경계는 어휘가 아니라 아래 세 가지 구조 검사가 진다 — 현재 발화의 자체
 * 판정(W4-low), 직전 사용자 발화의 재판정(W0), 서버가 그 턴에 기록해 둔
 * assistant `question_scope`(W0). 셋 다 정규식이 아니라 서버가 남긴 사실이다.
 */
const QUESTION_MARK_PATTERN = /[?？]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 현재 발화만 보는 값싼 게이트. 어떤 문맥도 권한도 주지 않는다 — 라우트가
 * 직전 한 턴을 읽어볼 가치가 있는지만 정한다.
 *
 * **핵심 안전 성질:** W4 + confidence low + needsClarification 을 요구한다.
 * 즉 서버가 이 문장에서 아무 신호도 찾지 못했을 때만 참이다. 안전(W5),
 * 고위험(W2), 사회적 돌봄(W3), 그리고 투자·코딩·회사 일정처럼 **확신을 갖고**
 * 범위 밖으로 판정된 W4(confidence high)는 전부 여기서 걸러진다. 위기 발화
 * 직후의 "응"이라도 그 "응"이 새 위험 신호를 담고 있으면 여기 오지 않는다.
 */
export function isAmoraClarificationAnswerShaped(text: string): boolean {
  if (typeof text !== "string") return false;
  const normalized = text.normalize("NFKC").trim();
  if (normalized.length === 0) return false;
  if (
    Array.from(normalized).length > AMORA_CLARIFICATION_ANSWER_MAX_CHARS
  ) {
    return false;
  }
  // 질문으로는 질문에 답하지 않는다. "이거 어떻게 하면 돼?"는 되묻기에 대한
  // 답이 아니라 새 질문이고, 그런 발화에까지 저장된 커플 문맥을 미리 읽어두면
  // "현재 입력만으로 답하는 범위는 저장 문맥을 읽지 않는다"는 기존 경계가
  // 무너진다. 물음표는 어휘 목록이 아니라 문장 부호라 어형 변화를 타지 않는다.
  if (QUESTION_MARK_PATTERN.test(normalized)) return false;
  // 설명·지목·선택형 되짚기는 이미 bounded continuity의 context-only 계약이
  // 맡는다. 한 문장을 두 계약이 다투게 두지 않는다.
  if (hasAmoraExplanatoryContinuityCue(normalized)) return false;
  const classification = classifyAmoraQuestionScope({ userText: text });
  return classification.scope === "W4_out_of_scope"
    && classification.confidence === "low"
    && classification.needsClarification;
}

export type ResolveAmoraWeddingClarificationContinuityInput<
  T extends AmoraClarificationContinuityRow,
> = {
  /**
   * `selectAmoraTrustedHistoryRows`가 이미 걸러낸 행들, 오래된 것부터.
   * 마지막 세 개가 [직전 사용자, 아모라, 현재 사용자]여야 한다.
   */
  trustedOldestFirstRows: readonly T[];
  currentUserMessageId: string;
  currentUserText: string;
};

/**
 * 되묻기 직후의 짧은 답을 직전 W0 턴에 이어 붙인다. 하나라도 어긋나면 null을
 * 돌려 지금까지의 (더 닫힌) 경로를 그대로 남긴다.
 *
 * 신뢰 경계 안에서 다시 판정한다. 호출자가 이 함수를 부르기로 정했다는 사실만으로
 * 현재 W2·W5 발화나 안전 맥락의 직전 턴이 W0으로 세탁되면 안 된다.
 *
 * **한 홉만 이어진다.** 직전 사용자 발화가 그 자체로 W0이어야 하므로, 되묻기가
 * 두 번 연속되면 두 번째 답은 이어지지 않는다. 의도한 경계다 — 한 번의 W0
 * 발화가 이후 임의 길이의 무신호 대화에 권한을 빌려주지 않는다.
 */
export function resolveAmoraWeddingClarificationContinuity<
  T extends AmoraClarificationContinuityRow,
>({
  trustedOldestFirstRows,
  currentUserMessageId,
  currentUserText,
}: ResolveAmoraWeddingClarificationContinuityInput<
  T
>): AmoraWeddingClarificationContinuity | null {
  if (!isAmoraClarificationAnswerShaped(currentUserText)) return null;
  if (trustedOldestFirstRows.length < 3) return null;

  const current = trustedOldestFirstRows[trustedOldestFirstRows.length - 1];
  const assistant = trustedOldestFirstRows[trustedOldestFirstRows.length - 2];
  const priorUser = trustedOldestFirstRows[trustedOldestFirstRows.length - 3];
  if (!current || !assistant || !priorUser) return null;
  if (
    typeof current.id !== "string"
    || typeof assistant.id !== "string"
    || typeof priorUser.id !== "string"
  ) {
    return null;
  }
  if (new Set([current.id, assistant.id, priorUser.id]).size !== 3) return null;

  // 현재 행이 이번 요청에 묶인 바로 그 행인가.
  if (
    current.id !== currentUserMessageId
    || current.role !== "user"
    || current.sender_type === "ai"
    || typeof current.content !== "string"
    || current.content !== currentUserText
  ) {
    return null;
  }

  // 아모라 행이 서버가 쓴 것이고, 직전 사용자 행에 명시적으로 묶여 있고,
  // 그때 서버가 **W0으로 판정했다고 기록**했는가. 이 metadata가 "직전 턴의
  // 성격"의 유일한 신뢰 가능한 출처다 — 본문에서 다시 추측하지 않는다.
  const assistantMetadata = isRecord(assistant.metadata)
    ? assistant.metadata
    : null;
  if (
    assistantMetadata === null
    || assistant.role !== "assistant"
    || assistant.sender_type !== "ai"
    || assistant.sender_id !== null
    || typeof assistant.content !== "string"
    || assistantMetadata.target === "partner"
    || assistantMetadata.in_reply_to_user_message_id !== priorUser.id
    || assistantMetadata.question_scope !== "W0_wedding_core"
  ) {
    return null;
  }

  // 직전 사용자 발화가 지금 다시 봐도 W0인가.
  // `selectAmoraTrustedHistoryRows`는 W0과 W1을 함께 통과시킨다. 여기서는 W0만
  // 받는다 — W1은 한쪽의 관계 진술이라 장기 기억을 끄고 조회 도구만 주는
  // 범위이고, 그걸 짧은 확인 하나로 W0까지 올리면 그 계약이 깨진다.
  //
  // 여기에 `hasAmoraSafetySignal(priorUser.content)`를 따로 두지 않는다. 그
  // 함수는 같은 `classifyAmoraQuestionScope`를 다시 부르므로, W0으로 판정된
  // 문장에 대해서는 **정의상 항상 false**다. 실제로 그 줄을 지우고 테스트를
  // 돌려봤더니 21개가 전부 통과했다 — 깨뜨려도 아무도 모르는 방어선은 방어선이
  // 아니라 다음 사람을 속이는 주석이다. 안전 경계는 바로 위 W0 판정 한 줄이
  // 지고 있고, 그 줄을 지우면 위기 코퍼스 테스트가 즉시 빨개진다.
  if (
    priorUser.role !== "user"
    || priorUser.sender_type === "ai"
    || typeof priorUser.content !== "string"
    || classifyAmoraQuestionScope({ userText: priorUser.content }).scope
      !== "W0_wedding_core"
  ) {
    return null;
  }

  // 아모라가 쓴 그 문장 자체가 안전 맥락은 아닌가.
  if (hasAmoraSafetySignal(assistant.content)) {
    return null;
  }

  // **이미 확인 카드를 냈다면 이어주지 않는다.**
  //
  // 되묻기에는 두 종류가 있고 둘을 섞으면 안 된다.
  //   (a) 값이 모자라 산문으로 되묻는다 — 카드가 없다. 사용자가 답해도 도구가
  //       없어 아무 일도 못 하는 것이 이 파일이 고치는 결함이다.
  //   (b) 값이 다 확정돼 확인 카드를 냈다 — 이때 "응, 해줘"라고 **타이핑**하는
  //       것은 확인이 아니다. 확인은 서버가 발급한 action_id를 다음 요청에
  //       실어 보내는 것뿐이고, 그래야 무엇이 저장될지 사용자가 보고 누른 것과
  //       서버가 실행하는 것이 같다는 보장이 선다.
  //
  // 처음에는 "아모라가 물음표나 `~까요`로 끝났는가"라는 어휘 검사가 우연히
  // (b)를 막고 있었다. 그걸 정밀도 필터로 오해하고 지웠더니 기존 계약 테스트가
  // 바로 빨개졌다 — 카드가 떠 있는데 산문 "응, 해줘"에 도구가 열렸다.
  // 판정 근거를 어휘에서 **서버가 남긴 사실**로 옮긴다. 어형은 놓칠 수 있어도
  // 카드의 존재는 못 놓친다.
  if (assistantMetadata.pending_amora_action !== undefined) {
    return null;
  }

  // 세 행이 같은 공개 범위에 있는가. 비공개 대화의 되묻기가 공유 턴의 권한을
  // 빌려오면 안 된다.
  if (
    current.visibility !== assistant.visibility
    || assistant.visibility !== priorUser.visibility
  ) {
    return null;
  }

  return {
    mode: "wedding_clarification_answer",
    priorUserText: priorUser.content,
    priorUserMessageId: priorUser.id,
    assistantMessageId: assistant.id,
  };
}
