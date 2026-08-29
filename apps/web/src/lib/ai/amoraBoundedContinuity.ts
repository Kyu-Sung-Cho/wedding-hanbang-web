import {
  classifyAmoraQuestionScope,
} from "@/lib/ai/amoraQuestionScope";

export const AMORA_W3_PRIOR_USER_MAX_CHARS = 800;
export const AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS = 1_200;
export const AMORA_BOUNDED_CONTINUITY_CURRENT_MAX_CHARS = 240;

const W3_CARE_STATE_PATTERN =
  /(?:(?:너무|정말|좀|아직|계속)\s*)*(?:마음(?:이|에)\s*(?:걸려|무거워|복잡해(?:졌어)?|아파|불편해)|힘들어|지쳤어|속상해|답답해|외로워|서운해|당황했어|복잡해(?:졌어)?|생각나|고마워|(?:다시\s*)?말하기\s*싫어)/u;
const EXPLICIT_W3_REFERENCE_PATTERNS = [
  new RegExp(
    String.raw`^(?:(?:그것|그거|그게|그걸)(?:도|은|는|이|가|을|를)?|(?:그 일|그 문제|그 얘기|그 말)(?:도|은|는|이|가|을|를)?|그 때문에)\s*(?:(?:때문에|생각하면|떠올리면|관련해서)\s*)?${W3_CARE_STATE_PATTERN.source}(?:요)?[.!?\s]*$`,
    "u",
  ),
  new RegExp(
    String.raw`^(?:(?:아까|방금)(?:\s+(?:말한\s+)?(?:거|것|게|말|얘기)(?:도|은|는|이|가|을|를)?)?|앞에서\s*말한\s*(?:거|것|게|말|얘기)(?:도|은|는|이|가|을|를)?)\s*${W3_CARE_STATE_PATTERN.source}(?:요)?[.!?\s]*$`,
    "u",
  ),
  new RegExp(
    String.raw`^그래서\s*${W3_CARE_STATE_PATTERN.source}(?:요)?[.!?\s]*$`,
    "u",
  ),
] as const;
const EXPLICIT_TOPIC_BREAK_PATTERN =
  /(?:말고|상관\s*없이|별개로|아니고)/u;
const ACTION_SHAPED_CONTEXT_REFERENCE_PATTERN =
  /^(?:(?:응|네|예|좋아|맞아)(?:\s+맞아)?(?:[,\s]*(?:(?:그대로|그걸로|그렇게)\s*)?(?:적용|반영|진행)?\s*(?:해\s*줘|해주세요|해줘))?|(?:그대로|그걸로|그렇게)\s*(?:적용|반영|진행)?\s*(?:해\s*줘|해주세요|해줘))[.!?\s]*$/u;
const CONTEXTUAL_EXPLANATION_PATTERN =
  /^(?:왜(?:\s*그런(?:데|지))?(?:\s*(?:다시\s*)?(?:설명|정리)해\s*(?:줘|주세요))?|왜\s*(?:그렇게\s*생각해(?:요)?|그게\s*더\s*좋아(?:요)?|(?:그렇게|그걸)\s*추천(?:해|했어)(?:요)?)|무슨\s*뜻(?:이야|이에요|이죠)|(?:좀\s*)?(?:더\s*)?자세히\s*(?:설명|정리)해\s*(?:줘|주세요)|(?:(?:아까|방금)\s+(?:말한\s+)?(?:거|것|말|얘기)|앞에서\s*말한(?:\s+(?:거|것|말|얘기))?|그(?:거|것|게|걸|\s*말|\s*얘기))(?:가|이|은|는|도|을|를)?\s*(?:다시\s*)?(?:설명|정리)해\s*(?:줘|주세요))[.!?\s]*$/u;
const CONTEXTUAL_SELECTION_PATTERN =
  /^(?:(?:첫|두|세)\s*번째|[1-3]\s*번|그(?:거|것|게|걸))(?:가|이|은|는|도|으로|로)?\s*(?:더\s*)?(?:(?:좋아|괜찮아|마음에\s*들어|나아|어때)(?:요)?|(?:할게|할래|고를게|선택할게)(?:요)?)[.!?\s]*$/u;
/**
 * 이 발화가 **다른 분야를 명시하고 있는가.**
 *
 * 이 목록은 문을 **닫는 데만** 쓴다. 그래서 틀려도 손해가 한쪽으로만 간다:
 *
 *   - 놓치면  -> 결혼 턴이 자기 대화 한 쌍을 본다(무해).
 *   - 과하면  -> 지금과 같다(문맥 없음). 회귀가 아니다.
 *
 * 낱말 목록으로 "결혼인가"를 **여는** 판정은 이 저장소에서 세 번 실패했다.
 * 결혼이 아닌 화제의 집합에 끝이 없기 때문이다. 반대로 "이 발화가 날씨·역사·
 * 회사를 말하고 있는가"는 그 발화가 스스로 말해 주므로 닫는 쪽으로는 쓸 수 있다.
 */
const OTHER_DOMAIN_TOPIC_PATTERN =
  /날씨|기온|미세먼지|역사|문법|번역|메뉴|뭐\s*먹|맛집|레시피|요리법|주식|코인|증권|정치|선거|뉴스|스포츠|축구|야구|코딩|프로그래밍|알고리즘|회사|업무|직장|출근|퇴근|시스템\s*프롬프트|지시사항|프롬프트를?\s*출력|무슨\s*모델|날짜가\s*며칠|오늘\s*며칠/iu;

const BARE_CONTEXT_REFERENCE_PATTERN =
  /^(?:(?:아까|방금)(?:\s+말한)?\s*(?:거|것|말|얘기)|그(?:거|것|게|걸))[.!?\s]*$/u;

export type AmoraBoundedContinuityRow = {
  id: string;
  sender_id: string | null;
  sender_type: "bride" | "groom" | "ai";
  role: "user" | "assistant";
  content: string;
  metadata: {
    target?: string;
    in_reply_to_user_message_id?: unknown;
  } | null;
  visibility: "shared" | "bride_private" | "groom_private";
  segment_id?: string | null;
};

export type AmoraBoundedContinuityMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AmoraBoundedContinuityResult = {
  mode: "linked_context_only";
  capabilities: "none";
  messages: AmoraBoundedContinuityMessage[];
};

export type BuildAmoraBoundedContinuityInput = {
  /** Exact database order: newest row first, as returned by the route query. */
  newestFirstRows: readonly AmoraBoundedContinuityRow[];
  currentMessageId: string;
  currentUserText: string;
  requesterUserId: string;
  visibility: AmoraBoundedContinuityRow["visibility"];
  segmentId: string;
};

export function hasExplicitAmoraW3ContinuityReference(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  return !EXPLICIT_TOPIC_BREAK_PATTERN.test(normalized)
    && EXPLICIT_W3_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}


/**
 * 직전 대화를 **설명·지목·선택**으로 되짚는 말인가. 이 형태들은 이미 여기
 * context-only 계약이 맡고 있다 — 답만 필요하지 도구가 필요하지 않다.
 *
 * `amoraClarificationContinuity`가 이 집합을 빼고 판정하기 위해 내보낸다.
 * 같은 문장을 두 계약이 서로 다르게 다루면 어느 쪽이 이기는지 아무도 모르게 된다.
 * 확인·지시형(`ACTION_SHAPED_...`)은 일부러 넣지 않았다 — "응", "네",
 * "그렇게 해줘"는 되묻기에 대한 답이고, 그 답이 도구를 잃는 것이 고치려는 결함이다.
 */
export function hasAmoraExplanatoryContinuityCue(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  return CONTEXTUAL_EXPLANATION_PATTERN.test(normalized)
    || CONTEXTUAL_SELECTION_PATTERN.test(normalized)
    || BARE_CONTEXT_REFERENCE_PATTERN.test(normalized)
    || hasExplicitAmoraW3ContinuityReference(normalized);
}

/**
 * Cheap, current-turn-only gate for deciding whether the route may perform
 * the exact three-row continuity lookup. This grants no context or capability.
 */
export function canAttemptAmoraBoundedContinuity(text: string): boolean {
  if (
    Array.from(text.normalize("NFKC").trim()).length
      > AMORA_BOUNDED_CONTINUITY_CURRENT_MAX_CHARS
  ) {
    return false;
  }
  const currentScope = classifyAmoraQuestionScope({ userText: text });
  const hasExplicitW3Reference = hasExplicitAmoraW3ContinuityReference(text);
  return (
    // **되짚는 단서를 요구하지 않는다.**
    //
    // 예전에는 지시대명사·설명 요청 같은 단서를 요구했다. 운영 실측이 그것으로는
    // 부족하다고 말한다 — 아모라 턴 467건 중 71건이 `W4` 로 떨어져 provider 에게
    // 현재 메시지 하나만 갔고(`route.ts` 의 `providerMessages`), **그중 38건은
    // 직전이 W0 결혼 대화였다.** 그 38건을 직접 읽어 보면:
    //
    //     승낙("네, 적용해줘" · "좋아 그걸로 하자")            8
    //     예산·대관료·진행 상황 질문                          9
    //     부모님·양가·상견례 상의                            10
    //     그 밖의 결혼 준비 대화                              8
    //     진짜 결혼 밖(날씨 · 오늘 며칠 · 프롬프트 인젝션)      3
    //
    // 35/38 이 결혼 대화였다. 되짚는 표현은 그중 소수에만 있다.
    //
    // **안전 경계는 그대로다.** 이 함수는 아무것도 주지 않는다 — 라우트가 세 행을
    // 읽어볼지만 정하고, 실제 판정은 `buildAmoraBoundedContinuity` 가 한다.
    // 거기서 **직전 사용자 발화를 다시 판정해 W0/W1 일 때만** 잇고, 같은 방·같은
    // 세그먼트·요청자 본인·아모라가 그 발화에 답한 것까지 확인한다. 안전(W5)·
    // 고위험(W2)·위로(W3) 턴 뒤에는 애초에 연결되지 않는다.
    //
    // 얻는 것도 딱 그만큼이다 — `capabilities: "none"` 이라 **도구는 그대로 0개**,
    // 저장된 커플 정보도 안 붙는다. 이미 도구가 0개인 턴에 자기 대화 한 쌍을
    // 얹는 것뿐이다.
    currentScope.scope === "W4_out_of_scope"
    && currentScope.confidence === "low"
    && currentScope.needsClarification
    // 사용자가 "그거 말고" 처럼 **직전 것이 아니라고 명시**하면 잇지 않는다.
    && !EXPLICIT_TOPIC_BREAK_PATTERN.test(text.normalize("NFKC").trim())
    // 발화가 다른 분야를 스스로 말하고 있으면 잇지 않는다.
    && !OTHER_DOMAIN_TOPIC_PATTERN.test(text.normalize("NFKC").trim())
  ) || (
    currentScope.scope === "W3_social_care"
    && hasExplicitW3Reference
  );
}

function boundFromStart(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join("");
}

/**
 * Carries one exact server-linked exchange into a short follow-up. The result
 * contains conversational context only; callers must grant tool/action
 * authority through a separate current-turn or confirmed-action contract.
 */
export function buildAmoraBoundedContinuity(
  input: BuildAmoraBoundedContinuityInput,
): AmoraBoundedContinuityResult | null {
  // Reclassify inside the trust boundary. Callers cannot launder a current W2,
  // W4-high, or W5 message by deciding to invoke this generic-looking helper.
  if (
    input.newestFirstRows.length !== 3
    || !canAttemptAmoraBoundedContinuity(input.currentUserText)
  ) {
    return null;
  }

  const [current, assistant, priorUser] = input.newestFirstRows;
  if (!current || !assistant || !priorUser) return null;
  if (new Set([current.id, assistant.id, priorUser.id]).size !== 3) return null;

  const rows = [current, assistant, priorUser];
  if (
    rows.some((row) =>
      row.visibility !== input.visibility
      || row.segment_id !== input.segmentId
      || row.metadata?.target === "partner"
    )
    || current.id !== input.currentMessageId
    || current.content !== input.currentUserText
    || current.role !== "user"
    || current.sender_type === "ai"
    || current.sender_id !== input.requesterUserId
    || assistant.role !== "assistant"
    || assistant.sender_type !== "ai"
    || assistant.sender_id !== null
    || priorUser.role !== "user"
    || priorUser.sender_type === "ai"
    || priorUser.sender_id !== input.requesterUserId
    || assistant.metadata?.in_reply_to_user_message_id !== priorUser.id
  ) {
    return null;
  }

  const priorScope = classifyAmoraQuestionScope({
    userText: priorUser.content,
  }).scope;
  if (
    priorScope !== "W0_wedding_core"
    && priorScope !== "W1_wedding_adjacent"
  ) {
    return null;
  }

  return {
    mode: "linked_context_only",
    capabilities: "none",
    messages: [
      {
        role: "user",
        content: boundFromStart(
          priorUser.content,
          AMORA_W3_PRIOR_USER_MAX_CHARS,
        ),
      },
      {
        role: "assistant",
        content: boundFromStart(
          assistant.content,
          AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS,
        ),
      },
      { role: "user", content: current.content },
    ],
  };
}

/**
 * Carries exactly one server-linked exchange into an otherwise current-only
 * W3 turn. Any ambiguity returns null, preserving the safer one-message path.
 */
export function buildAmoraBoundedW3Continuity(
  input: BuildAmoraBoundedContinuityInput,
): AmoraBoundedContinuityMessage[] | null {
  if (
    classifyAmoraQuestionScope({ userText: input.currentUserText }).scope
      !== "W3_social_care"
    || !hasExplicitAmoraW3ContinuityReference(input.currentUserText)
  ) {
    return null;
  }
  return buildAmoraBoundedContinuity(input)?.messages ?? null;
}
