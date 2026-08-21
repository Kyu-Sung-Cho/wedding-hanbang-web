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

function hasShortAmoraContinuityCue(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  return (
    ACTION_SHAPED_CONTEXT_REFERENCE_PATTERN.test(normalized)
    || CONTEXTUAL_EXPLANATION_PATTERN.test(normalized)
    || CONTEXTUAL_SELECTION_PATTERN.test(normalized)
    || BARE_CONTEXT_REFERENCE_PATTERN.test(normalized)
  );
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
    currentScope.scope === "W4_out_of_scope"
    && currentScope.confidence === "low"
    && currentScope.needsClarification
    && (hasShortAmoraContinuityCue(text) || hasExplicitW3Reference)
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
