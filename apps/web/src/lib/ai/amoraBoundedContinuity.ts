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
 * 이 목록은 문을 **닫는 데만** 쓴다. 여는 판정에 낱말을 쓰면 결혼이 아닌 화제의
 * 집합이 무한해서 못 막지만, "이 발화가 날씨·역사·회사를 말하는가" 는 발화가
 * 스스로 말해 주기 때문이다.
 *
 * **손해가 대칭이 아니라고 적었다가 고쳤다.** 적대적 검토가 재현한 실제 대가:
 *
 *   - 놓치면 -> `노트북 추천해줘` 같은 결혼 밖 발화에 직전 결혼 대화 한 쌍
 *              (사용자 최대 800자 + 아모라 최대 1,200자)이 provider 입력 앞에
 *              붙는다. 결혼 밖 20문장 중 12문장이 그랬다. 같은 방 자기 대화이고
 *              도구는 0개지만 **무해하지는 않다** — 모델이 결혼 문맥으로 답을
 *              끌고 갈 수 있다. 그래서 이 레인의 지시문에 결혼 밖 대행 금지 줄을
 *              함께 넣었다(`buildAmoraQuestionScopeInstruction`).
 *   - 과하면 -> 결혼 후속 발화가 문맥을 잃는다. 이쪽도 공짜가 아니라서, 되짚는
 *              단서가 있으면 이 검사보다 앞서게 두었다.
 *
 * 낱말 목록으로 "결혼인가"를 **여는** 판정은 이 저장소에서 세 번 실패했다.
 * 결혼이 아닌 화제의 집합에 끝이 없기 때문이다. 반대로 "이 발화가 날씨·역사·
 * 회사를 말하고 있는가"는 그 발화가 스스로 말해 주므로 닫는 쪽으로는 쓸 수 있다.
 */
/**
 * 이 발화가 **결혼 밖 화제를 명시**하는가.
 *
 * 2026-09-02 되묻기 창 복구와 함께 내보낸다. 창이 넓어지면 2홉·3홉이 실제로
 * 돌기 시작하므로, 홉을 올릴 때 이 신호가 있으면 거기서 멈추게 하려는 것이다.
 * **패턴은 한 글자도 바꾸지 않았다** — 새 어휘를 만들면 그 어휘가 또 썩는다.
 * 1홉은 오늘과 완전히 같게 두고, 2홉 이상에만 닫는 방향으로 얹는다.
 */
export function hasAmoraOtherDomainTopicSignal(text: string): boolean {
  return OTHER_DOMAIN_TOPIC_PATTERN.test(text.normalize("NFKC").trim());
}

const OTHER_DOMAIN_TOPIC_PATTERN =
  /날씨|기온|미세먼지|역사|문법|번역|메뉴|뭐\s*먹|맛집|레시피|요리법|주식|코인|증권|정치|선거|뉴스|스포츠|축구|야구|코딩|프로그래밍|알고리즘|회사|업무|직장|출근|퇴근|시스템\s*프롬프트|지시사항|프롬프트를?\s*출력|무슨\s*모델|날짜가\s*며칠|오늘\s*며칠/iu;

/**
 * 직전 대화를 **가리키며 무언가를 부탁하는** 말.
 *
 * 기존 단서들은 문장이 지시대명사 하나로 **끝날** 것을 요구한다("그거", "그거 자세히
 * 설명해줘"). 그래서 팀 테스트의 이 문장이 아무 문맥도 못 받았다:
 *
 *     (직전) 우리는 예단이랑 폐백은 생략하고 싶어
 *     그걸 부모님께 어떻게 말해야 덜 부딪힐까? 실제로 보낼 말까지 써줘.
 *     -> "어떤 내용을 부모님께 말씀드리려는지 아직 몰라서…"
 *
 * W4 턴은 provider 에게 현재 메시지 하나만 간다(`route.ts` 의 `providerMessages`).
 * 모델이 잊은 것이 아니라 받은 것이 없었다.
 *
 * 이 단서는 **권한을 늘리지 않는다.** 여기서 나오는 것은 context-only 계약이라
 * 도구도 저장 정보도 붙지 않고, 서버가 검증한 직전 한 쌍이 전부다. 같은 방의
 * 자기 대화이므로 커플 경계도 넘지 않는다. 이미 도구가 0개인 턴에 직전 한 쌍을
 * 얹는 것뿐이다.
 */
const LEADING_ANAPHORIC_REQUEST_PATTERN =
  /^(?:그(?:걸|거|것|게)|그\s*(?:얘기|이야기|내용|부분|말))(?:을|를|은|는|도|에|에다|에게)?\s+\S/u;

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
    /** 라우트가 저장하는 도구 결과(장소 검색은 이름 없이 검색어·건수만 남는다). */
    toolResults?: unknown;
    /** 카드 확인 버튼이 보낸 사용자 행에만 붙는 서버 확인 표식(DB 트리거가 검증한다). */
    confirmed_amora_action_id?: unknown;
    /** 아모라가 낸 확인 카드. 확인 표식은 이 카드의 `actionId` 를 가리켜야 한다. */
    pending_amora_action?: unknown;
  } | null;
  visibility: "shared" | "bride_private" | "groom_private";
  segment_id?: string | null;
};

/**
 * 직전 답변이 **카드로만** 보여준 것을 한 줄로 되살린다.
 *
 * 2026-09-04 실측(팀원 2차 T9 재현): "부산 해운대 상견례 한정식 3곳 찾아줘" → 카드 5장.
 * 다음 턴 "방금 찾은 곳들 광고야 일반 검색이야?" 는 결혼 낱말이 없어 연결 문맥으로
 * 갔는데, 연결 문맥은 직전 답변의 **산문만** 싣고 장소는 카드(도구 결과)에만 있어서
 * 모델이 "방금 답변에는 실제 검색 결과가 제시되지 않았어요… 찾은 것처럼 말한 점이
 * 잘못됐어요" 라고 **자기가 한 검색을 부인**했다. 사용자 눈앞에 카드 5장이 있는데.
 *
 * 그래서 저장된 도구 결과 가운데 검색·시세처럼 카드로만 보인 것을 한 줄 요약으로
 * 산문 뒤에 붙인다. 장소 이름은 저장되지 않으니(placeholder) 검색어·건수·출처만
 * 말한다 — 지어낼 것이 없다. 도구 권한(capabilities)은 여전히 none 이다.
 */
const CARD_ONLY_TOOL_SUMMARY_MAX_CHARS = 240;

export function summarizeCardOnlyToolResults(toolResults: unknown): string | null {
  if (!Array.isArray(toolResults)) return null;
  const lines: string[] = [];
  for (const entry of toolResults) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { toolName?: unknown; success?: unknown; toolOutput?: unknown };
    if (row.success !== true || typeof row.toolName !== "string") continue;
    const out = (row.toolOutput && typeof row.toolOutput === "object")
      ? row.toolOutput as Record<string, unknown>
      : {};
    if (row.toolName === "search_nearby_places") {
      const query = typeof out.query === "string" ? out.query.trim() : "";
      const count = typeof out.resultCount === "number" ? out.resultCount : null;
      if (!query || count === null) continue;
      lines.push(
        `직전 답변에서 '${query}' 로 네이버 지역검색 ${count}곳을 카드로 보여줬어요`
        + "(일반 검색 결과, 광고·제휴 아님; 수용 인원·가격은 카드에 없어 업체 확인 필요;"
        + " 카드는 저장되지 않아 이름은 다시 검색해야 해요).",
      );
    } else if (row.toolName === "get_market_price") {
      lines.push("직전 답변에서 공시 시세(한국소비자원 참가격)를 카드로 보여줬어요.");
    }
  }
  if (lines.length === 0) return null;
  return Array.from(`[카드 요약] ${lines.join(" ")}`)
    .slice(0, CARD_ONLY_TOOL_SUMMARY_MAX_CHARS)
    .join("");
}

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

function hasShortAmoraContinuityCue(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  return (
    ACTION_SHAPED_CONTEXT_REFERENCE_PATTERN.test(normalized)
    || CONTEXTUAL_EXPLANATION_PATTERN.test(normalized)
    || CONTEXTUAL_SELECTION_PATTERN.test(normalized)
    || BARE_CONTEXT_REFERENCE_PATTERN.test(normalized)
    || (
      LEADING_ANAPHORIC_REQUEST_PATTERN.test(normalized)
      && !EXPLICIT_TOPIC_BREAK_PATTERN.test(normalized)
    )
  );
}

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
    && (
      // (가) 되짚는 단서가 있으면 그대로 통과한다. 이 갈래를 지웠다가 되살렸다 —
      //      지우니 `그거 회사에 언제 말해야 할까?` 처럼 **지시대명사가 있는데
      //      다른 분야 낱말이 섞인** 결혼 후속 발화 5건이 새로 끊겼다.
      //      사용자가 직전 것을 명시적으로 가리키면 아래 화제 검사보다 우선한다.
      hasShortAmoraContinuityCue(text)
      || hasExplicitW3Reference
      // (나) 단서가 없어도, **다른 분야를 말하지 않으면** 대화 안에 있다고 본다.
      || (
        !EXPLICIT_TOPIC_BREAK_PATTERN.test(text.normalize("NFKC").trim())
        && !OTHER_DOMAIN_TOPIC_PATTERN.test(text.normalize("NFKC").trim())
      )
    )
  ) || (
    currentScope.scope === "W3_social_care"
    && hasExplicitW3Reference
  );
}

function boundFromStart(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join("");
}

/** 카드 확인 버튼이 보내는 고정 문장(웹 ChatContent/ChatSidePanel·모바일 chat.tsx 동일). */
const CARD_CONFIRMATION_MESSAGE_RE =
  /^\s*좋아요[.!]?\s*제안한\s*변경을\s*적용해\s*주세요[.!]?\s*$/u;

/**
 * 카드 확인 버튼이 보낸 고정 문장인가. 사용자가 손으로 쓴 승낙("응 적용해줘")은 아니다.
 *
 * 되묻기 연속성(`amoraClarificationContinuity`)과 연결 문맥이 같은 판정을 쓴다 — 한쪽만
 * 고치면 두 계약이 확인 쌍을 서로 다르게 본다.
 */
export function isAmoraCardConfirmationMessage(text: unknown): boolean {
  return typeof text === "string"
    && CARD_CONFIRMATION_MESSAGE_RE.test(text.normalize("NFKC"));
}

/**
 * 연결 문맥이 읽는 최대 행 수. 평소 창은 3행(현재·아모라·직전 사용자)이고, 그 사이에
 * 카드 확인 쌍이 끼었을 때만 5행이 된다.
 */
export const AMORA_BOUNDED_CONTINUITY_WINDOW_MAX_ROWS = 5;

function pendingCardActionId(card: AmoraBoundedContinuityRow | undefined): string | null {
  const pending = card?.metadata?.pending_amora_action;
  if (!pending || typeof pending !== "object") return null;
  const actionId = (pending as { actionId?: unknown }).actionId;
  return typeof actionId === "string" && actionId.length > 0 ? actionId : null;
}

/**
 * [확인 문장 ↔ 실행 영수증] 쌍인가. **거르지 않은** 행에서 본다.
 *
 * 영수증 본문 모양은 서버가 만드는 것이라 검사하지 않는다. 대신 누가·어느 범위에서·
 * 무엇에 답했는지를 본다 — 같은 사람, 같은 공개 범위와 세그먼트, 상대 대상 아님,
 * 서버가 쓴 아모라 행이 그 확인 문장에 묶임.
 *
 * **문장 모양만으로는 버튼 확인이 아니다(2026-09-15 리뷰).** 말풍선에 보이는 고정 문장을
 * 손으로 그대로 치면 정규식은 통과한다. 그런데 모델에게는 이 쌍을 '[카드 확인 문장,
 * 실행 결과]'로 설명하므로, 손으로 친 문장이 버튼 확인 기록처럼 모델에게 전해진다.
 * 그래서 라우트와 DB 트리거가 **실제 버튼 확인 행에만** 남기는 `confirmed_amora_action_id` 를 요구하고,
 * 그 표식이 바로 앞 카드 행의 `pending_amora_action.actionId` 와 같은지까지 본다 — 서버
 * `resolveAmoraPendingAction` 이 승인 때 대조하는 기준과 같다. 확인 액션은 공유 레인에서만
 * 발급되므로(트리거가 `visibility = 'shared'` 를 요구) 다른 레인에서는 쌍이 될 수 없다.
 */
function isBoundedConfirmationPair(
  receipt: AmoraBoundedContinuityRow | undefined,
  confirmation: AmoraBoundedContinuityRow | undefined,
  card: AmoraBoundedContinuityRow | undefined,
  requesterUserId: string,
  visibility: AmoraBoundedContinuityRow["visibility"],
): boolean {
  if (!receipt || !confirmation || !card) return false;
  const confirmedActionId = confirmation.metadata?.confirmed_amora_action_id;
  return visibility === "shared"
    && typeof confirmedActionId === "string"
    && confirmedActionId.length > 0
    && card.role === "assistant"
    && card.sender_type === "ai"
    && card.sender_id === null
    && card.visibility === visibility
    && pendingCardActionId(card) === confirmedActionId
    && confirmation.role === "user"
    && confirmation.sender_type !== "ai"
    && confirmation.sender_id === requesterUserId
    && confirmation.visibility === visibility
    && confirmation.metadata?.target !== "partner"
    && isAmoraCardConfirmationMessage(confirmation.content)
    && receipt.role === "assistant"
    && receipt.sender_type === "ai"
    && receipt.sender_id === null
    && receipt.visibility === visibility
    && receipt.segment_id === confirmation.segment_id
    && receipt.metadata?.target !== "partner"
    && receipt.metadata?.in_reply_to_user_message_id === confirmation.id;
}

/**
 * 연결 문맥이 볼 창을 **거르지 않은 행에서** 고른다. 라우트는 이 결과에만 신뢰 필터
 * (`selectAmoraTrustedHistoryRows`)를 태운 뒤 `buildAmoraBoundedContinuity` 에 넘긴다.
 *
 * 2026-09-15 운영 재현: 카드를 확인한 직후의 후속 말은 직전 사용자 발화가 확인 버튼의
 * 고정 문장("좋아요. 제안한 변경을 적용해 주세요.")이라 재판정이 W4 였고, 연결 문맥이
 * 끊겨 아모라가 영수증 한 줄만 보고 답했다. 확인 쌍은 대화의 실이 아니라 버튼 한 번이다 —
 * 되묻기 연속성(`amoraClarificationContinuity`)이 이미 같은 이유로 건너뛴다.
 *
 * **왜 창 선택을 신뢰 필터보다 먼저 하는가.** 필터는 W2·W5 쌍을 지워 행 수를 줄인다.
 * 5행을 읽어 필터부터 태우면 [현재, (지워진 폭력 고백 쌍), 오래된 결혼 쌍] 이 정확히 3행
 * 창처럼 보여 끊겨야 할 대화가 이어진다. 그래서 확인 쌍이 **원본 행** 1·2번에 있을 때만
 * 5행을 고르고, 아니면 오늘과 같은 3행만 남긴다. 3행 창에서 한 행이라도 지워지면 행 수가
 * 모자라 `buildAmoraBoundedContinuity` 가 null 이다(오늘과 같다).
 */
export function selectAmoraBoundedContinuityWindow<T extends AmoraBoundedContinuityRow>({
  newestFirstRows,
  requesterUserId,
  visibility,
}: {
  newestFirstRows: readonly T[];
  requesterUserId: string;
  visibility: AmoraBoundedContinuityRow["visibility"];
}): T[] {
  if (
    newestFirstRows.length >= AMORA_BOUNDED_CONTINUITY_WINDOW_MAX_ROWS
    && isBoundedConfirmationPair(
      newestFirstRows[1],
      newestFirstRows[2],
      newestFirstRows[3],
      requesterUserId,
      visibility,
    )
  ) {
    return newestFirstRows.slice(0, AMORA_BOUNDED_CONTINUITY_WINDOW_MAX_ROWS);
  }
  return newestFirstRows.slice(0, 3);
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
  //
  // 5행은 [현재, 영수증, 확인 문장, 아모라, 직전 사용자] 일 때만 받는다
  // (`selectAmoraBoundedContinuityWindow`). 가운데 쌍이 확인 쌍이 아니면 5행은 거부한다 —
  // 이 함수가 창을 스스로 줄여 쓰면 필터로 지워진 행이 만든 틈을 못 알아챈다.
  if (
    (input.newestFirstRows.length !== 3
      && input.newestFirstRows.length !== AMORA_BOUNDED_CONTINUITY_WINDOW_MAX_ROWS)
    || !canAttemptAmoraBoundedContinuity(input.currentUserText)
  ) {
    return null;
  }

  const skipsConfirmationPair =
    input.newestFirstRows.length === AMORA_BOUNDED_CONTINUITY_WINDOW_MAX_ROWS;
  const [current, ...older] = input.newestFirstRows;
  const [receipt, confirmation] = skipsConfirmationPair ? older : [];
  const [assistant, priorUser] = skipsConfirmationPair ? older.slice(2) : older;
  if (!current || !assistant || !priorUser) return null;
  if (
    skipsConfirmationPair
    && !isBoundedConfirmationPair(
      receipt,
      confirmation,
      assistant,
      input.requesterUserId,
      input.visibility,
    )
  ) {
    return null;
  }

  const rows = [current, assistant, priorUser, receipt, confirmation]
    .filter((row): row is AmoraBoundedContinuityRow => row !== undefined);
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return null;
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

  const assistantMessage = (row: AmoraBoundedContinuityRow): AmoraBoundedContinuityMessage => ({
    role: "assistant",
    content: [
      boundFromStart(row.content, AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS),
      summarizeCardOnlyToolResults(row.metadata?.toolResults),
    ].filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("\n\n"),
  });

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
      assistantMessage(assistant),
      // 확인 쌍은 건너뛰어 닻을 찾을 뿐 **지우지 않는다.** 영수증이 빠지면 모델은 카드만
      // 보고 "아직 적용 전" 이라고 믿어 다시 누르라고 하거나 같은 제안을 또 낸다.
      // 확인 문장은 버튼이 보낸 고정 문장이라 사용자 원문이 아니다.
      ...(skipsConfirmationPair && confirmation && receipt
        ? [
            { role: "user" as const, content: confirmation.content },
            assistantMessage(receipt),
          ]
        : []),
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
