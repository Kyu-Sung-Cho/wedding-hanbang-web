import {
  hasAmoraExplanatoryContinuityCue,
  hasAmoraOtherDomainTopicSignal,
} from "@/lib/ai/amoraBoundedContinuity";
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
/**
 * 이 답이 **그대로 하라는 승낙**인가.
 *
 * 카드가 떠 있던 턴 뒤의 승낙은 버튼(action_id)으로만 받는다 — 자유 문장이
 * 확인을 대신하면 서버가 검증한 입력이 아닌 것이 저장될 수 있다.
 *
 * 그런데 사람은 카드를 보고 **숫자를 고치기도 한다.** "아니 4천으로 해줘" 는
 * 승낙이 아니라 새 지시다. 그것까지 막으면 도구가 0개가 되어, 아모라가
 * 결혼 준비와 무슨 관련인지 되묻는 엉뚱한 답이 돌아온다(2026-08-24 감사).
 *
 * 그래서 **맨 승낙만** 막고 정정은 통과시킨다. 통과해도 얻는 것은 범위와
 * 도구뿐이고, 실제 적용은 여전히 `confirmedActionId` + 리스를 거쳐야 한다.
 */
const BARE_AFFIRMATION_RE =
  /^(?:응+|네+|넹|예|그래|그럼|좋아|좋아요|ㅇㅇ|오케이|ok|okay|그렇게)\s*(?:요|용)?\s*(?:해\s*줘|해\s*주세요|해줘요|적용해\s*줘|적용해\s*주세요|맞아|맞아요|부탁|부탁해|부탁해요|고마워)?\s*[.!~]*$/i;

function isBareAffirmation(text: string): boolean {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return false;
  if (BARE_AFFIRMATION_RE.test(normalized)) return true;
  // "응 넣어줘", "네 그렇게 적용해줘" 처럼 승낙어로 시작해 실행만 요청하는 경우.
  //
  // `\b` 를 쓰지 않는다 — 자바스크립트의 단어 경계는 ASCII 기준이라 한글 뒤에서는
  // 매치되지 않는다. 이 저장소가 전에 같은 자리에서 당한 적이 있다.
  return /^(?:응+|네+|넹|예|그래|그럼|좋아요?|ㅇㅇ|오케이|ok|okay)(?=$|[\s.!~,])/i
    .test(normalized)
    && !/\d/.test(normalized)
    && !/(아니|말고|대신|빼고|바꿔|다시|수정|고쳐)/.test(normalized);
}

/**
 * 되묻기의 답으로 **생긴 것**인가. 범위 판정은 보지 않는다.
 *
 * 길이·물음표·설명형 단서 — 세 가지는 답이 어느 범위로 떨어지든 똑같이
 * 물어야 한다. 범위 조건만 호출자마다 다르다.
 */
/** "500으로", "27일로", "600만원으로 해" — 숫자 뒤에 으로/로 가 붙은 수정 모양. */
const AMOUNT_EDIT_SHAPE_RE = /\d[\d,.]*\s*(?:만\s*원|만원|만|원|명|일|시)?\s*(?:으로|로)(?=\s|$|[가-힣])/u;

function hasClarificationAnswerShape(text: string): boolean {
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
  // 2026-09-05: "너무 많나? 500으로" 처럼 혼잣말 물음 뒤에 **금액·날짜 수정**이 붙은 문장은
  // 되묻기의 답이다. 물음표만 보고 내치지 않는다 — 수정 모양(숫자+으로/로)이 있으면 통과.
  if (QUESTION_MARK_PATTERN.test(normalized) && !AMOUNT_EDIT_SHAPE_RE.test(normalized)) {
    return false;
  }
  // 설명·지목·선택형 되짚기는 이미 bounded continuity의 context-only 계약이
  // 맡는다. 한 문장을 두 계약이 다투게 두지 않는다.
  return !hasAmoraExplanatoryContinuityCue(normalized);
}

export function isAmoraClarificationAnswerShaped(text: string): boolean {
  if (!hasClarificationAnswerShape(text)) return false;
  const classification = classifyAmoraQuestionScope({ userText: text });
  return classification.scope === "W4_out_of_scope"
    && classification.confidence === "low"
    && classification.needsClarification;
}

/**
 * 되묻기의 답인데 **그 답 자체가 이미 결혼 이야기**인 경우.
 *
 * 범위 구제(위 함수)는 답이 범위 밖으로 보일 때를 위한 것이다. 그런데 답이
 * W0으로 잘 판정되는데도 깨지는 자리가 따로 있다 — 도구 선택이다.
 *
 * 2026-08-25 운영 실측:
 *
 *   사용자: 할 일 하나 추가해줘          (W0/high, 행동 도구 열림)
 *   아모라: 어떤 할 일을 추가할지 내용이 필요해요.
 *   사용자: 청첩장 시안 고르기            (W0/high, 그러나 행동 도구 0개)
 *   아모라: 이 대화에서는 할 일을 실제로 저장하는 도구가 없어 …
 *
 *   사용자: 체크리스트 하나 완료 처리해줘  (W0/high)
 *   아모라: 어떤 항목을 완료 처리할지 알려주세요.
 *   사용자: 청첩장 문구 정하기            (W0/high, 그러나 도구 0개)
 *   아모라: 이 대화에서는 체크리스트 상태를 변경하는 도구가 없어 …
 *
 * 도구 선택기는 **어휘로 의도를 고른다.** 되묻기의 답에는 그 어휘가 없다 —
 * 항목 이름만 있다. 그래서 아모라가 자기가 물어 놓고, 답을 받고, 기능이
 * 없다고 말한다. 첫 사용자에게는 제품에 기능이 없는 것으로 보인다.
 *
 * 여기서 넘겨주는 것은 **도구 선택용 의도뿐**이다. 범위·장기 기억·저장 문맥
 * 권한은 이 함수가 건드리지 않는다. 닻이 단독 W0이라는 조건은 호출부의
 * 홉 가드가 그대로 지고 있으므로, 이 답이 새로 얻는 도구는 닻이 자기 턴에서
 * 이미 받았던 것뿐이다.
 */
export function isAmoraToolIntentAnswerShaped(text: string): boolean {
  if (!hasClarificationAnswerShape(text)) return false;
  const classification = classifyAmoraQuestionScope({ userText: text });
  // W1~W3 은 도구·기억 계약이 따로 있다. 그 경계를 되묻기로 넘기지 않는다.
  return classification.scope === "W0_wedding_core";
}

export type ResolveAmoraWeddingClarificationContinuityInput<
  T extends AmoraClarificationContinuityRow,
> = {
  /**
   * **거르지 않은** 대화 행들, 오래된 것부터. 마지막 세 개가 정확히
   * [직전 사용자, 아모라, 현재 사용자]여야 한다.
   *
   * 여기에 신뢰 필터를 통과시킨 목록을 넘기면 안 된다. 그건 이 결함의
   * 원인이었다 — 아래 주석 참고.
   */
  rawOldestFirstRows: readonly T[];
  /** 요청자 본인의 user id. 상대의 발화를 빌려 쓰지 못하게 한다. */
  requesterUserId: string;
  currentUserMessageId: string;
  currentUserText: string;
  /**
   * 무엇을 이어받으려는가.
   *
   * `scope_rescue`(기본) — 답이 범위 밖으로 보일 때 범위를 되살린다.
   * `tool_intent` — 답이 이미 W0인데 도구 의도만 없을 때, 도구 선택에
   * 쓸 의도를 이어받는다. 범위·기억·저장 문맥 권한은 주지 않는다.
   */
  answerShape?: "scope_rescue" | "tool_intent";
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
/** 카드 확인 버튼이 보내는 고정 문장(웹 ChatContent/ChatSidePanel·모바일 chat.tsx 동일). */
const CARD_CONFIRMATION_MESSAGE_RE =
  /^\s*좋아요[.!]?\s*제안한\s*변경을\s*적용해\s*주세요[.!]?\s*$/u;

/**
 * [확인 메시지 ↔ 실행 영수증] 쌍인가. 사용자 문장이 카드 확인 고정 문장이고, 같은
 * 사람이 같은 공개 범위에서 보냈고, 아모라 쪽이 그 메시지에 답한 행이면 확인 쌍이다.
 * 영수증 본문 모양(도구 성공 문구)은 서버가 만드는 것이라 여기서 따로 검사하지 않는다.
 */
function isConfirmationPair<T extends AmoraClarificationContinuityRow>(
  amora: T,
  confirmer: T,
  requesterUserId: string,
  visibility: T["visibility"],
): boolean {
  if (
    confirmer.role !== "user"
    || confirmer.sender_type === "ai"
    || confirmer.sender_id !== requesterUserId
    || typeof confirmer.content !== "string"
    || !CARD_CONFIRMATION_MESSAGE_RE.test(confirmer.content.normalize("NFKC"))
    || confirmer.visibility !== visibility
  ) {
    return false;
  }
  const metadata = isRecord(amora.metadata) ? amora.metadata : null;
  return amora.role === "assistant"
    && amora.sender_type === "ai"
    && amora.sender_id === null
    && amora.visibility === visibility
    && metadata !== null
    && metadata.in_reply_to_user_message_id === confirmer.id;
}

export function resolveAmoraWeddingClarificationContinuity<
  T extends AmoraClarificationContinuityRow,
>({
  rawOldestFirstRows,
  requesterUserId,
  currentUserMessageId,
  currentUserText,
  answerShape = "scope_rescue",
}: ResolveAmoraWeddingClarificationContinuityInput<
  T
>): AmoraWeddingClarificationContinuity | null {
  // 기본은 범위 구제다. 도구 의도만 이어받을 때는 답이 이미 W0인 경우를 본다.
  const answerIsEligible = answerShape === "tool_intent"
    ? isAmoraToolIntentAnswerShaped(currentUserText)
    : isAmoraClarificationAnswerShaped(currentUserText);
  if (!answerIsEligible) return null;
  if (rawOldestFirstRows.length < 3) return null;

  // **거르지 않은 마지막 세 행.** 처음에는 여기에
  // `selectAmoraTrustedHistoryRows`의 결과를 넘겼는데, 그게 이 파일 최악의
  // 결함이었다. 그 함수는 "모델에 보여줘도 되는가"를 묻는 **읽기 필터**라
  // W2·W5 턴을 목록에서 **지운다**. 지워진 자리는 벽이 아니라 구멍이 된다 —
  // 오래된 웨딩 쌍이 답변과 붙어 보이게 만든다.
  //
  // 실측(2026-08-20): [웨딩 요청 / 아모라 되묻기 / "남편이 어제 저를 때렸어요"
  // / 아모라의 안전 질문 / "응"] 에서 필터는 가운데 두 행을 지워 [웨딩 요청,
  // 되묻기, "응"]을 돌려줬고, **안전 질문에 답한 "응"이 W0 + 기억 ON + 도구
  // 24/24**를 받았다. 폭력 서술과 안전 응답은 모델 입력에 들어가지도 않았다.
  //
  // 그래서 이제 거르지 않은 행을 받고, 사이에 무엇이 있든 **모양이 어긋나면
  // 거부**한다. 신뢰 판정은 아래에서 이 세 행에 직접 다시 한다.
  // 같은 이유로 형제 계약(`buildAmoraBoundedContinuity`)도 주석에 이렇게
  // 적어 두었다: "그 행들의 존재는 연속성을 끊어야지, 필터링 뒤에 인접해
  // 보이게 만들면 안 된다."
  const current = rawOldestFirstRows[rawOldestFirstRows.length - 1];
  // 되묻기 쌍을 몇 번까지 거슬러 올라갈 것인가.
  //
  // 1이면 되묻기가 두 번인 순간 끊긴다 — 2026-08-22 라이브에서 파운더가 겪은 것이
  // 그것이다("총 예산 5000만원" → 포함 범위 되물음 → "신혼집은 빼고…" → 다시 되물음
  // → "네 그렇게 적용해줘" 에서 도구 0개). 되묻기의 답에는 주제어가 없어서
  // ("신혼집은 빼고 나머지 다 포함해서") 그 답 자체는 단독 W0이 아니고, 그래서 닻이
  // 두 홉 뒤로 밀린다.
  //
  // 무한정 올라가지는 않는다. 멀어질수록 "아직 그 주제에 답하는 중"이라는 주장이
  // 약해진다. 3홉이면 되묻기 세 번까지 — 그보다 길게 되묻는 것은 이 파일이 이어줄
  // 문제가 아니라 아모라가 덜 묻게 만들 문제다.
  const MAX_CLARIFICATION_HOPS = 3;
  let assistant = rawOldestFirstRows[rawOldestFirstRows.length - 2];
  let priorUser = rawOldestFirstRows[rawOldestFirstRows.length - 3];
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
    || current.sender_id !== requesterUserId
    || typeof current.content !== "string"
    || current.content !== currentUserText
    || (isRecord(current.metadata) && current.metadata.target === "partner")
  ) {
    return null;
  }

  // 아모라 행이 서버가 쓴 것이고, 직전 사용자 행에 명시적으로 묶여 있고,
  // 그때 서버가 **W0으로 판정했다고 기록**했는가. 이 metadata가 "직전 턴의
  // 성격"의 유일한 신뢰 가능한 출처다 — 본문에서 다시 추측하지 않는다.
  //
  // 이 검사는 **홉마다 다시 돈다.** 거슬러 올라가면서 가드를 한 번이라도 건너뛰면
  // 그 지점이 그대로 구멍이 된다.
  const isValidClarificationPair = (
    amora: T,
    answered: T,
    answerer: T,
  ): boolean => {
    const metadata = isRecord(amora.metadata) ? amora.metadata : null;
    if (
      metadata === null
      || amora.role !== "assistant"
      || amora.sender_type !== "ai"
      || amora.sender_id !== null
      || typeof amora.content !== "string"
      || metadata.target === "partner"
      || metadata.in_reply_to_user_message_id !== answered.id
      || metadata.question_scope !== "W0_wedding_core"
      // 카드가 떠 있던 턴의 **승낙**은 버튼(action_id)뿐이어야 한다. 다만 숫자를
      // 고치는 정정("아니 4천으로 해줘")은 승낙이 아니라 새 지시이고, 그것까지
      // 막으면 도구가 0개가 된다. 연속성이 주는 것은 범위와 도구뿐이고 적용은
      // 여전히 `confirmedActionId` + 리스를 거친다.
      || (metadata.pending_amora_action !== undefined
        && isBareAffirmation(currentUserText))
      // 아모라가 쓴 그 문장 자체가 안전 맥락은 아닌가.
      || hasAmoraSafetySignal(amora.content)
    ) {
      return false;
    }
    // 되묻기에 답한 사람이 지금 요청한 사람과 같고, 상대에게 보낸 말이 아닌가.
    // 공유 대화에서는 상대의 발화도 보인다.
    if (
      answered.role !== "user"
      || answered.sender_type === "ai"
      || answered.sender_id !== requesterUserId
      || (isRecord(answered.metadata) && answered.metadata.target === "partner")
      || typeof answered.content !== "string"
    ) {
      return false;
    }
    // 세 행이 같은 공개 범위에 있는가. 비공개 대화의 되묻기가 공유 턴의 권한을
    // 빌려오면 안 된다.
    return answerer.visibility === amora.visibility
      && amora.visibility === answered.visibility;
  };

  // 닻(단독 W0인 사용자 발화)을 찾을 때까지 되묻기 쌍을 거슬러 올라간다.
  // 매 홉에서 위 가드를 전부 다시 확인하고, 하나라도 어긋나면 거기서 멈춘다.
  let answerer: T = current;
  let hop = 1;
  // 2026-09-05 페르소나 실측(p7 T8·T9, p4 "그거 목요일로", p6): 카드를 **확인한 직후**의
  // 짧은 수정("500으로 해줘", "아 몰라 그냥 600으로 해")이 전부 범위 밖으로 떨어져 카드 없이
  // 끝났다. 직전 쌍이 [확인 메시지 "좋아요. 제안한 변경을 적용해 주세요." ↔ 실행 영수증]
  // 이라 되묻기 쌍이 아니었기 때문이다. 확인 쌍은 대화의 실이 아니라 버튼 한 번이다 —
  // 건너뛰고 그 앞의 진짜 쌍(요청 ↔ 카드)을 닻으로 본다. 홉 한도는 그대로 센다.
  let skippedConfirmationPairs = 0;
  for (;;) {
    if (!assistant || !priorUser) return null;
    if (typeof assistant.id !== "string" || typeof priorUser.id !== "string") return null;
    if (
      skippedConfirmationPairs < 2
      && isConfirmationPair(assistant, priorUser, requesterUserId, answerer.visibility)
    ) {
      const index = rawOldestFirstRows.indexOf(priorUser);
      if (index < 2) return null;
      assistant = rawOldestFirstRows[index - 1];
      priorUser = rawOldestFirstRows[index - 2];
      skippedConfirmationPairs += 1;
      continue;
    }
    if (!isValidClarificationPair(assistant, priorUser, answerer)) return null;
    // 닻 판정: 요청 문장 자체가 W0 이거나, 그 턴에서 아모라가 **카드를 냈다**(라우트가
    // 문맥까지 보고 W0 행동 턴으로 처리한 흔적). 2026-09-05: "사진은 700 잡아줘" 는 낱말만
    // 보면 범위 밖이지만 그 턴에 카드가 났고 확인까지 됐다 — 그 뒤의 "500으로 해줘" 가
    // 닻을 못 찾아 실을 놓쳤다.
    const anchorMetadata = isRecord(assistant.metadata) ? assistant.metadata : null;
    const anchorIssuedCard = anchorMetadata !== null
      && anchorMetadata.pending_amora_action !== undefined;
    if (
      anchorIssuedCard
      || classifyAmoraQuestionScope({ userText: priorUser.content as string }).scope
        === "W0_wedding_core"
    ) {
      break;
    }
    if (hop >= MAX_CLARIFICATION_HOPS) return null;
    // **2홉부터는 화제가 바뀌면 멈춘다.**
    //
    // 2026-09-02 에 읽기 창을 3행에서 넓은 창으로 되돌리면서 함께 얹는다. 그
    // 복구로 2·3홉이 운영에서 처음 돌기 시작하는데, 멀리 거슬러 올라갈수록
    // "아직 그 주제에 답하는 중" 이라는 주장이 약해지기 때문이다.
    //
    // **1홉은 오늘과 완전히 같다.** 여기는 이미 한 홉을 지나 두 홉째로 올라가려는
    // 자리이므로, 오늘 이어지던 것이 이 줄 때문에 끊기는 일은 없다. 새 어휘를
    // 만들지 않고 이미 배포된 `OTHER_DOMAIN_TOPIC_PATTERN` 을 그대로 쓴다 —
    // 새 목록을 만들면 그 목록이 또 썩는다.
    if (hasAmoraOtherDomainTopicSignal(currentUserText)) return null;
    // 한 쌍 더 위로. 이 답변(`priorUser`)도 되묻기의 답이었는지 확인한다.
    const index = rawOldestFirstRows.indexOf(priorUser);
    if (index < 2) return null;
    answerer = priorUser;
    assistant = rawOldestFirstRows[index - 1];
    priorUser = rawOldestFirstRows[index - 2];
    hop += 1;
  }
  const assistantMetadata = isRecord(assistant.metadata) ? assistant.metadata : null;
  if (assistantMetadata === null) return null;

  // 위 루프가 홉마다 확인한 것들 — 서버가 쓴 아모라 행, 직전 사용자 행에 묶임,
  // `question_scope` W0, 확인 카드 없음, 안전 신호 없음, 요청자 본인, 상대 대상 아님,
  // 공개 범위 일치 — 은 여기서 다시 보지 않는다. 한 곳에서만 판정해야 홉이 늘어도
  // 가드가 갈라지지 않는다.
  //
  // 닻은 **단독으로 W0인 사용자 발화**다. `selectAmoraTrustedHistoryRows`는 W0과 W1을
  // 함께 통과시키지만 여기서는 W0만 받는다 — W1은 장기 기억을 끄고 조회 도구만 주는
  // 범위이고, 그걸 짧은 확인 하나로 W0까지 올리면 그 계약이 깨진다.
  //
  // 여기에 `hasAmoraSafetySignal(priorUser.content)`를 따로 두지 않는다. 그 함수는 같은
  // `classifyAmoraQuestionScope`를 다시 부르므로 W0으로 판정된 문장에 대해서는 정의상
  // 항상 false다. 안전 경계는 W0 판정 한 줄이 지고 있고, 그 줄을 지우면 위기 코퍼스
  // 테스트가 즉시 빨개진다.

  // 루프의 가드가 이미 확인했지만, 타입 경계에서 한 번 더 좁힌다.
  if (
    typeof priorUser.content !== "string"
    || typeof priorUser.id !== "string"
    || typeof assistant.id !== "string"
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
