import type { AiToolDefinition } from "./toolDefinition";
import { getAmoraActionApprovalPolicy } from "./amoraActionApprovalPolicy";
import { splitAmoraClaimSegments } from "./amoraClaimSegments";
import { hasNewAmoraChangeIntent } from "./amoraPendingActionContinuity";
import { SERVER_OWNED_EMPTY_ANSWER_NOTICE } from "./amoraPersistenceClaims";
import {
  filterAmoraToolsByQuestionScope,
  type AmoraQuestionScopeClassification,
} from "./amoraQuestionScope";
import {
  selectAmoraPendingProposalTools,
  type SelectAmoraToolsInput,
} from "./amoraToolPolicy";
import { isAmoraTypedCardAcceptance } from "./amoraTypedCardAcceptance";

/**
 * **나만 (상담)에서 함께 쓰는 준비 기록을 바꿔 달라고 한 턴.**
 *
 * 2026-09-15 운영 재현(개인 레인):
 *
 *   사용자: "총예산 5천만 원으로 바꿔줘"
 *   아모라: "총예산을 5,000만 원으로 변경할까요? …"          ← 카드 없음
 *   사용자: "응 그렇게 바꿔줘"
 *   아모라: "이 대화에서는 예산을 직접 저장하는 기능이 없어… 예산 화면에서 직접 수정해 주세요."
 *   사용자: "그럼 남은 예산은?"
 *   아모라: "…5,000만 원에서 바로 빼드릴게요."              ← 저장값은 3,250만 원
 *
 * 개인 레인은 공유 변경 카드를 낼 수 없다(라우트가 제안 도구를 공유 레인에만 연다).
 * 그런데 모델은 공유 레인과 같은 말투로 "변경할까요?" 를 물었고, 사용자는 누를 수 없는
 * 확인을 받았다. 함께 대화에서 같은 요청을 하면 된다는 말은 끝내 나오지 않았다.
 *
 * 그래서 이 판정은 새 어휘를 만들지 않고 **공유 레인이 이미 쓰는 신호**를 그대로 읽는다.
 *  - 도구 선택(`selectAmoraTools`)이 이 발화에서 공유 준비 기록의 쓰기 도구를 골랐고,
 *  - 같은 발화로 공유 레인이 확인 카드 도구(`selectAmoraPendingProposalTools` → 승인 정책 →
 *    범위 필터)를 열었으며,
 *  - 발화가 실제 부탁 모양(`hasNewAmoraChangeIntent`, 또는 연속성으로 붙은 앞 문장이 스스로
 *    부탁일 때의 말로 한 동의)일 때만 참이다.
 *
 * 두 신호의 교집합이라 "함께 대화에서 같은 요청을 하면 확인 카드로 반영할 수 있어요" 가
 * 참인 턴에만 그 안내가 붙는다. 이 판정은 쓰기 권한을 만들지 않는다 — 개인 레인의 도구
 * 목록과 제안 계약은 그대로 비어 있다.
 */

/**
 * 함께 쓰는 준비 기록(예산·일정·체크리스트·결혼식 날짜·예식장)의 쓰기 도구.
 *
 * 공유 할 일(`add_amora_action` 등)은 넣지 않는다. 개인 레인에는 ‘개인 할 일로 저장’
 * 경로가 따로 있고, "기억해 줘" 같은 말은 개인 취향 대화일 수 있다.
 */
export const AMORA_PRIVATE_LANE_SHARED_PLAN_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "update_budget",
  "update_category_budget",
  "apply_budget_plan",
  "add_custom_category",
  "update_wedding_date",
  "update_task_status",
  "add_schedule_event",
  "update_schedule_event",
  "cancel_schedule_event",
  "restore_schedule_event",
  "toggle_checklist_item",
  "update_venue",
]);

/**
 * 서버가 쓰는 고정 안내. 탭 이름은 웹(`ChatContent`)·앱(`app/(tabs)/chat.tsx`) 화면의
 * 실제 문구 ‘나만 (상담)’·‘함께 대화’ 이고, 두 화면 모두 대화 위쪽에 있다.
 * 함께 대화로 옮기면 상대방도 그 요청을 본다는 점을 같이 말한다.
 */
export const AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE =
  "‘나만 (상담)’에서는 함께 쓰는 예산·일정·체크리스트를 바꾸지 않아요. 이번 요청도 반영하지 않았어요.\n\n위의 ‘함께 대화’ 탭에서 같은 요청을 보내면 확인 카드에서 적용해 반영할 수 있어요. 함께 대화에 보낸 요청은 상대방에게도 보여요.";

export type AmoraPrivateLaneSharedChangeKind = "change_only" | "mixed";

export interface AmoraPrivateLaneSharedChangeTurn {
  /** change_only = 서버 안내로 답한다. mixed = 모델 답을 두되 적용 확인 질문을 걷고 안내를 붙인다. */
  kind: AmoraPrivateLaneSharedChangeKind;
  /** 공유 레인이라면 확인 카드로 낼 수 있었던 쓰기 도구(관측용 이름만). */
  toolNames: string[];
}

export interface AssessAmoraPrivateLaneSharedChangeInput {
  visibility: string;
  requestKind: string;
  isDemo: boolean;
  durable: boolean;
  questionScope: AmoraQuestionScopeClassification;
  /** 현재 사용자 발화(연속성으로 붙인 앞 문장은 제외). */
  userText: string;
  /**
   * 되묻기·도구 의도 연속성으로 도구 의도 문장 앞에 붙은 직전 사용자 발화
   * (`carriedToolIntent.priorUserText`). 맨 동의("응"·"그래")는 이 문장이 스스로 변경
   * 부탁일 때만 부탁으로 본다 — 개인 레인에는 동의할 카드가 없다.
   */
  carriedPriorUserText?: string;
  /** 개인 할 일 조회·초안 도구가 열린 턴. 그 요청은 개인 경로가 처리한다. */
  hasPersonalActionTools: boolean;
  /**
   * 첨부 분석·장소 검색처럼 모델이 따로 해 줄 일이 있는 턴. 변경 부탁만 있어 보여도
   * 모델 답을 버리지 않고 mixed 로 다룬다(견적서 분석이 안내 한 줄로 바뀌면 안 된다).
   */
  hasOtherWork?: boolean;
  /** 라우트가 도구 의도 문장으로 이미 계산한 `selectAmoraTools` 결과. */
  selectedTools: readonly AiToolDefinition[];
  /** 공유 레인이 확인 카드 도구를 고를 때 넘기는 입력 그대로(`availableTools` = 변경 도구). */
  proposalSelection: SelectAmoraToolsInput;
}

export function assessAmoraPrivateLaneSharedChangeTurn(
  input: AssessAmoraPrivateLaneSharedChangeInput,
): AmoraPrivateLaneSharedChangeTurn | null {
  if (input.visibility !== "bride_private" && input.visibility !== "groom_private") return null;
  if (input.isDemo || input.requestKind !== "chat" || !input.durable) return null;
  if (input.hasPersonalActionTools) return null;
  if (typeof input.userText !== "string") return null;
  // 개인 레인에는 카드가 없으므로 맨 동의 자체는 부탁의 근거가 아니다(리뷰 [0]).
  //   "드레스 예산을 450만 원으로 늘리면 남은 예산이 어떻게 돼?" → (아모라 되물음) → "응"
  // 은 가정 계산을 이어 달라는 말이다. 동의는 연속성으로 붙은 앞 문장이 스스로 변경 부탁일
  // 때만 그 부탁을 잇는다.
  const priorUserText = typeof input.carriedPriorUserText === "string"
    ? input.carriedPriorUserText
    : null;
  const currentIsRequest = hasNewAmoraChangeIntent(input.userText);
  const agreesToPriorRequest = !currentIsRequest
    && priorUserText !== null
    && isAmoraTypedCardAcceptance(input.userText)
    && hasNewAmoraChangeIntent(priorUserText);
  if (!currentIsRequest && !agreesToPriorRequest) return null;
  const selectedNames = new Set(input.selectedTools.map((tool) => tool.name));
  // 라우트의 공유 레인 `pendingProposalTools` 와 같은 순서·같은 필터다.
  const sharedLaneProposalTools = filterAmoraToolsByQuestionScope(
    selectAmoraPendingProposalTools(input.proposalSelection)
      .filter((tool) => getAmoraActionApprovalPolicy(tool.name) !== "blocked"),
    input.questionScope,
  );
  const toolNames = sharedLaneProposalTools
    .map((tool) => tool.name)
    .filter((name) => selectedNames.has(name)
      && AMORA_PRIVATE_LANE_SHARED_PLAN_WRITE_TOOL_NAMES.has(name));
  if (toolNames.length === 0) return null;
  // 가정·초안·검토를 말한 부탁은 계산·설명을 원하는 턴일 수 있다. 모델 답을 버리지 않는다.
  const mentionsHypothetical = HYPOTHETICAL_OR_DRAFT_RE.test(input.userText.normalize("NFKC"))
    || (agreesToPriorRequest && HYPOTHETICAL_OR_DRAFT_RE.test(priorUserText!.normalize("NFKC")));
  return {
    kind: input.hasOtherWork || mentionsHypothetical
      ? "mixed"
      : classifyPrivateLaneChangeTurnShape(input.userText),
    toolNames,
  };
}

/**
 * 실제로 바꿔 달라는 말이 아니라 **가정·초안·검토**로 보자는 표지. 이런 턴을 change_only 로
 * 보내면 "이번 요청도 반영하지 않았어요" 한 줄이 계산·설명 답을 통째로 덮는다.
 */
const HYPOTHETICAL_OR_DRAFT_RE = /가정|만약|만일|시뮬레이션|초안|예시로|예를\s*들어|(?:라고|다고|했다고)\s*치(?:고|면)|검토(?:만|해|하|용)|미리\s*보기|계산만|계산해\s*(?:줘|보)|어떻게\s*되는지/u;

const TRAILING_NOISE_RE = /[\s.!~。…ㅋㅎᄏᄒ^]+$/u;
/**
 * 변경 부탁과 별개로 **답을 구하는** 표현. "바꿔줄래?" 의 물음표는 부탁의 말투라 여기서
 * 보지 않는다 — 변경 문장 안에서는 이 표현만, 다른 문장에서는 물음표도 함께 본다.
 */
const ANSWER_REQUEST_RE = /(?:알려|설명해|보여|정리해|계산해|추천해|비교해)\s*(?:줘|주세요|줄래|주실래|주고)|얼마|어때|어떨까|어떻게|왜|뭐(?:야|예요|에요|가|를|지)|언제|몇\s*(?:명|개|월|일|시|만)|괜찮을까|좋을까|될까|인가요|일까/u;
const QUESTION_MARK_RE = /[?？]/u;
/** 한글 8자 이상인 다른 문장은 사정·맥락 설명이다. 모델이 그 말에도 답하게 둔다. */
const CONTEXT_SENTENCE_MIN_HANGUL = 8;

/**
 * 변경 부탁만 있는 턴인가, 다른 질문·사정이 함께 있는 턴인가.
 *
 * 애매하면 mixed 다. mixed 로 잘못 가면 모델 답 + 안내가 나가고(적용 확인 질문은 걷힌다),
 * change_only 로 잘못 가면 사용자의 질문이 답을 못 받는다 — 앞쪽이 덜 나쁘다.
 */
export function classifyPrivateLaneChangeTurnShape(
  userText: string,
): AmoraPrivateLaneSharedChangeKind {
  if (HYPOTHETICAL_OR_DRAFT_RE.test(userText.normalize("NFKC"))) return "mixed";
  for (const { claim } of splitAmoraClaimSegments(userText.normalize("NFKC"))) {
    const sentence = claim.replace(TRAILING_NOISE_RE, "").trim();
    if (!sentence) continue;
    const isChangeSentence = hasNewAmoraChangeIntent(sentence) || isAmoraTypedCardAcceptance(sentence);
    if (isChangeSentence) {
      if (ANSWER_REQUEST_RE.test(sentence)) return "mixed";
      continue;
    }
    if (QUESTION_MARK_RE.test(sentence) || ANSWER_REQUEST_RE.test(sentence)) return "mixed";
    if ((sentence.match(/[가-힣]/gu) ?? []).length >= CONTEXT_SENTENCE_MIN_HANGUL) return "mixed";
  }
  return "change_only";
}

/** 적용을 제안하는 동사 꼴 — "변경할까요"·"반영해 드릴까요"·"바꿔 볼까요"·"옮길까요". */
const OFFER_VERB_RE = /(?:변경|반영|적용|저장|수정|추가|등록|설정|업데이트|기록|취소|삭제|진행|체크|완료\s*처리)\s*(?:해\s*(?:드릴|둘|볼|도\s*될)|하실|할|하시겠|하겠)|(?:바꿔|넣어|잡아|옮겨|올려|내려|줄여|늘려|맞춰|고쳐|지워)\s*(?:드릴|둘|볼|도\s*될)|(?:바꿀|넣을|잡을|옮길|올릴|내릴|줄일|늘릴|맞출|고칠|지울)/u;
const OFFER_QUESTION_END_RE = /(?:까요|까|래요|실래요|시겠어요|시겠습니까|겠어요|겠습니까|되나요)\s*[?？]\s*$/u;
/** 공유 준비 기록을 가리키는 말 또는 제안을 받는 지시어. 없으면 일반 상담 질문으로 둔다. */
const SHARED_PLAN_TARGET_RE = /예산|일정|체크리스트|날짜|예식장|웨딩홀|식장|\d\s*(?:천|만|억)?\s*원|이대로|그대로|그렇게|반영|적용/u;
const CHANGE_STEM_RE = /저장|변경|수정|반영|적용|바꾸|바꿔|바꿀|추가|등록|입력/u;
/** 있는 기능을 없다고 하는 문장. 개인 레인에서 못 하는 것과 제품에 없는 것은 다르다. */
const FEATURE_DENIAL_RE = /(?:기능|도구)(?:이|가|은|는)?\s*(?:없|지원하지\s*않|제공하지\s*않)/u;
/** 서버 안내가 이미 말하는 이동 안내. 두 번 나오지 않게 모델 쪽을 걷는다. */
const SHARED_LANE_REDIRECT_RE = /‘함께\s*대화’|'함께\s*대화'|"함께\s*대화"|함께\s*대화\s*(?:탭|에서|로)|공유\s*대화/u;

export interface AmoraPrivateLaneOfferScreenResult {
  text: string;
  removedCount: number;
}

/**
 * mixed 턴의 모델 답에서 **누를 카드가 있는 것처럼 묻는 문장**을 걷는다.
 *
 * 질문에 대한 답은 남긴다. 걷는 것은 (1) 공유 기록을 가리키며 적용 여부를 묻는 물음,
 * (2) 변경 기능이 없다고 하는 문장, (3) 서버 안내와 겹치는 함께 대화 이동 안내뿐이다.
 */
export function stripAmoraPrivateLaneSharedChangeOffers(
  text: string,
): AmoraPrivateLaneOfferScreenResult {
  const kept: string[] = [];
  let removedCount = 0;
  for (const { claim, source } of splitAmoraClaimSegments(text)) {
    const sentence = claim.replace(/[*_]/gu, "");
    const offersApply = OFFER_QUESTION_END_RE.test(sentence)
      && OFFER_VERB_RE.test(sentence)
      && SHARED_PLAN_TARGET_RE.test(sentence);
    const deniesFeature = FEATURE_DENIAL_RE.test(sentence) && CHANGE_STEM_RE.test(sentence);
    const repeatsRedirect = SHARED_LANE_REDIRECT_RE.test(sentence) && CHANGE_STEM_RE.test(sentence);
    if (offersApply || deniesFeature || repeatsRedirect) {
      removedCount += 1;
      continue;
    }
    kept.push(source);
  }
  return {
    text: removedCount === 0 ? text : kept.join("").replace(/\n{3,}/gu, "\n\n").trim(),
    removedCount,
  };
}

/**
 * mixed 턴의 최종 본문. 모델 답이 비었거나 서버의 빈 답 안내로 바뀌었으면 안내만 낸다.
 * 이미 안내가 들어 있으면 다시 붙이지 않는다.
 */
export function appendAmoraPrivateLaneSharedChangeGuidance(answerText: string): string {
  const answer = answerText.trim();
  if (!answer || answer === SERVER_OWNED_EMPTY_ANSWER_NOTICE) {
    return AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE;
  }
  if (answer.includes(AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE)) return answer;
  return `${answer}\n\n${AMORA_PRIVATE_LANE_SHARED_CHANGE_GUIDANCE}`;
}
