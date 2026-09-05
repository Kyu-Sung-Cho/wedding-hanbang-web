import type { ToolExecutionResult } from "@/types/database.types";

import { guardDemoPersistenceDisclosure } from "./amoraDemoPersistence";
import { isMutatingTool } from "./mutationTools";
import { screenAmoraTrustClaims } from "./amoraTrustClaims";

const AFFIRMATIVE_PERSISTENCE_CLAIM_RE =
  /(?:(?:저장|기록|등록|반영|변경|수정|설정|추가|삭제|취소|확정|업데이트|적용|처리|입력)(?:해\s*(?:두었|뒀|놓았|놨|드렸)|하였|했|됐|되었|\s*완료(?:했|됐))|(?:넣어|적어|써|바꿔|올려)\s*(?:두었|뒀|놓았|놨|드렸)|(?:넣었|적었|썼|바꿨|올렸)|완료(?:하였|했|됐|되었))(?:어요|습니다|어|다)?/u;

/**
 * 위 완료형 매치 **바로 뒤**에 오는, 주장을 취소하는 어미.
 *
 * 2026-09-03 실측 오탐. "예식 월만 6월에서 5월로 바꿀게, 영향만 짧게" 처럼 **영향만
 * 물어본 턴**에서 아모라가 이렇게 답한다:
 *
 *     "5월로 변경했을 때 달라지는 항목은 없어요."
 *     "예식 월을 5월로 바꿨을 때 영향은 크지 않아요."
 *
 * 둘 다 가정이지 저장 주장이 아닌데, `변경했`·`바꿨` 만 보고 저장 주장으로 잡혔다.
 * 그 결과는 문장 하나가 지워지는 정도가 아니다 — 답변이 통째로 사라지고 그 자리에
 * "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요" 가 나갔다.
 * 사용자는 **요청하지도 않은 변경**의 실패를 통보받는다.
 *
 * 예외는 **매치 지점에 붙여서만** 판정한다. 문장 어딘가에 "없어요" 가 있으면
 * 봐준다는 식으로 만들면 "예산은 5,000만원으로 반영했고 더 남은 건 없어요" 같은
 * 진짜 주장이 그대로 빠져나간다. 그리고 한 문장에 매치가 여럿이면 **하나라도
 * 단정형이면 주장으로 친다**(아래 `hasAssertivePersistenceClaim`).
 */
const NON_ASSERTIVE_CLAIM_CONTINUATION_RE =
  /^(?:을\s*때|다면|더라면|으?면|을\s*경우|다고\s*가정|다\s*치면|는지|은지)/u;

const AFFIRMATIVE_PERSISTENCE_CLAIM_SCAN_RE = new RegExp(
  AFFIRMATIVE_PERSISTENCE_CLAIM_RE.source,
  "gu",
);

/**
 * 이 문장에 **단정형** 저장 주장이 하나라도 있는가.
 *
 * 완료형 어휘가 보였다는 것만으로는 부족하다. 가정절("변경했을 때")과 단정
 * ("변경했어요")은 같은 어휘로 시작하고 뒤에서 갈린다.
 */
function hasAssertivePersistenceClaim(segment: string): boolean {
  for (const match of segment.matchAll(AFFIRMATIVE_PERSISTENCE_CLAIM_SCAN_RE)) {
    const rest = segment.slice((match.index ?? 0) + match[0].length);
    if (!NON_ASSERTIVE_CLAIM_CONTINUATION_RE.test(rest)) return true;
  }
  return false;
}

const AFFIRMATIVE_PERSISTENCE_STATE_RE =
  /(?:저장|기록|등록|반영|변경|수정|설정|추가|삭제|취소|확정|업데이트|적용)(?:\s*완료(?:예요|입니다)|(?:되어|돼)\s*있(?:어요|습니다|다))/u;

const ENGLISH_AFFIRMATIVE_PERSISTENCE_WORD_RE =
  /\b(?:saved|recorded|registered|updated|changed|modified|added|deleted|removed|cancelled|canceled|confirmed|applied)(?:\s+successfully)?\b/giu;

const ENGLISH_DIRECT_NEGATION_BEFORE_CLAIM_RE =
  /(?:\b(?:not|never)\s+(?:\w+\s+){0,3}|\b(?:isn't|wasn't|hasn't|haven't|cannot|can't)\s+(?:been\s+)?(?:\w+\s+){0,2})$/iu;

/**
 * 미래형 저장 약속 — "등록할게요" / "저장해 드릴게요" / "반영하겠습니다".
 *
 * 2026-09-03: 위 완료형 갈래는 이것을 하나도 못 잡는다. 워크트리에서 실제로
 * `composeAmoraPersistenceTerminal` 을 태워 보니 "예식장을 그랜드호텔로
 * 등록할게요."·"예산 5000만원으로 저장할게요."·"일정에 반영해 드릴게요."·"게스트
 * 명단에 추가하겠습니다." 가 전부 removedClaimCount=0 으로 원문 그대로 나갔다.
 * 사용자는 반영된 줄 알고 다음 턴으로 넘어가고, 아무것도 저장되지 않는다.
 *
 * 오탐을 줄이려고 두 가지로 좁혔다.
 *  - **저장 동사만**: 등록·저장·추가·반영·적용·입력. 그래서 "예식장에 문의할게요"·
 *    "확인해 드릴게요"·"알아볼게요" 처럼 저장이 아닌 약속은 그대로 남는다.
 *  - **주체가 아모라인 어미만**: 할게요/하겠습니다/해 드릴게요/해 둘게요/해 놓을게요.
 *    "언제 할지 알려주시면 등록할 수 있어요"·"직접 등록할 때는" 처럼 사용자 행동을
 *    말하는 형태는 걸리지 않는다.
 *
 * 이 갈래는 **이번 턴에 mutation 영수증도 확인 카드도 없을 때만** 켠다. 카드가 난
 * 턴의 본문은 이미 서버 확인문으로 통째로 대체돼 있어서(amoraPendingAction 의
 * `cleanText: marker.confirmation`) 검사하면 서버 문구를 훼손할 뿐이다.
 */
const FUTURE_PERSISTENCE_PROMISE_RE =
  /(?:등록|저장|추가|반영|적용|입력)(?:할게요?|할께요?|하겠습니다|하겠어요|해\s*드릴게요?|해\s*드리겠습니다|해\s*둘게요?|해\s*놓을게요?|해\s*놓겠습니다)/u;

const AFFIRMATIVE_MEMORY_CLAIM_RE =
  /(?:기억(?:해\s*(?:둘게|드릴게|놓을게|두겠|드리겠|놓겠)|하고\s*있을게|하고있을게|할게|하겠)(?:요|습니다)?|잊지\s*않(?:을게|겠)(?:요|습니다)?)/u;

const ENGLISH_AFFIRMATIVE_MEMORY_CLAIM_RE =
  /\b(?:i|we)(?:['’]ll| will)\s+remember\b/iu;

const NON_SUCCESS_CONTEXT_RE =
  /(?:라고|이라는|라는)\s*(?:말|표현|문구)|(?:예시|가정|만약|말하면\s*안|하지\s*마)/u;

// 2026-09-03: `isAmoraFailedProposalNotice`(amoraPendingAction.ts)가 이 문장을
// 이력 필터에 쓴다. 서버가 이 안내를 붙인 턴은 카드를 못 낸 턴이기 때문이다.
export const SERVER_OWNED_UNVERIFIED_NOTICE =
  "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요. 변경할 내용을 확인한 뒤 다시 요청해주세요.";

const SERVER_OWNED_PENDING_NOTICE =
  "아직 실제 준비에는 반영되지 않았어요. 아래 확인 내용을 검토해주세요.";

const SERVER_OWNED_DEMO_NOTICE =
  "체험 상담에서는 실제 일정·예산·예약 정보가 저장되거나 반영되지 않아요.";

const SERVER_OWNED_MISSING_RECEIPT_MESSAGE_NOTICE =
  "변경 실행 결과를 안전하게 표시할 수 없어 반영 여부를 확인하지 못했어요. 현재 화면에서 값을 확인해주세요.";

export type AmoraPersistenceClaimGuardResult = {
  text: string;
  corrected: boolean;
  removedClaimCount: number;
};

export type AmoraPersistenceTerminalResult =
  AmoraPersistenceClaimGuardResult & {
    source: "provider" | "server_mutation_receipts" | "server_correction";
  };

/**
 * Compose the only terminal text that may be shown and persisted for a turn.
 * Mutation receipts are server-owned, so provider prose is discarded whenever
 * at least one mutating tool was executed, including failed executions.
 */
/**
 * 사용자가 이번 턴에 변경을 **요청**했는가 — 제안 도구가 열렸다는 것과 다르다.
 *
 * 2026-09-04 팀원 2차 대본 재실행: "시기는 2028년 5월이나 6월쯤. 날짜는 아직." 은
 * 사실을 말한 것인데(변경 요청 아님) 도구 선택기가 결혼일 도구를 열어 `userRequestedChange`
 * 가 참이 됐고, 모델이 카드를 안 내자 "실제 실행 결과가 확인되지 않아 이 변경은 아직
 * 반영되지 않았어요" 가 붙었다. 요청하지 않은 변경의 실패를 사과받는 셈 — 2026-08-22
 * 와 같은 병(위 주석)이 "도구가 열렸다" 를 요청으로 읽어서 다시 났다.
 *
 * 그래서 안내는 **요청 동사가 있는 문장**에만 붙인다. 목록에 없는 요청 모양이면 안내가
 * 빠질 뿐(예전 동작), 없는 요청에 사과하지는 않는다.
 */
const EXPLICIT_CHANGE_REQUEST_PATTERN =
  /추가|등록|넣어|넣자|넣을|잡아|잡자|바꿔|바꾸|변경|수정|고쳐|취소|삭제|지워|옮겨|미뤄|당겨|적용|저장|반영|설정|정해\s*줘|정해\s*주|맞춰\s*줘|만들어\s*줘|올려|내려|줄여|늘려|완료\s*(?:처리|했|해)|체크\s*(?:해|처리)|기록\s*(?:해|남겨)/u;

export function isExplicitAmoraChangeRequest(userText: string): boolean {
  if (typeof userText !== "string") return false;
  return EXPLICIT_CHANGE_REQUEST_PATTERN.test(userText.normalize("NFKC"));
}

export const SERVER_OWNED_EMPTY_ANSWER_NOTICE =
  "지금은 답을 만들지 못했어요. 한 번 더 물어봐 주세요.";

export function composeAmoraPersistenceTerminal(
  input: Parameters<typeof composeTerminalCandidate>[0],
): AmoraPersistenceTerminalResult {
  const composed = composeTerminalCandidate(input);
  if (composed.text.trim()) return composed;
  // 2026-09-05: 변경을 요청하지도, 표식을 내지도 않은 턴(읽기·상담)에서 본문이 비면
  // "이 변경은 아직 반영되지 않았어요" 는 거짓 안내다. 그런 턴은 중립 문장으로 남긴다.
  if (
    input.userRequestedChange !== true
    && input.droppedPendingActionTag !== true
    && !input.hasPendingAction
  ) {
    return {
      ...composed,
      text: SERVER_OWNED_EMPTY_ANSWER_NOTICE,
      corrected: true,
      source: "server_correction",
    };
  }
  // 2026-09-03: **빈 본문은 턴 전체를 죽인다.**
  //
  // 운영 원장 2026-08-24 14:48:41 'post_provider_payload_invalid' → 14:48:45
  // 'CHAT_TURN_FAILED'(3.7초, budget_optimizer). 종단 검증
  // (`amoraProviderCallLedger`)이 `!input.content.trim()` 으로 거절하고, 사용자는
  // 원인과 무관한 "이 요청은 같은 식별자로 다시 이어갈 수 없어요" 를 받는다 —
  // 재시도 버튼도 없다.
  //
  // 빈 문자열은 아래에서 만들어진다. 신뢰 스크린이 모든 문장을 지우면 text=""
  // 인데 removedClaimCount 는 0 이라 안내가 안 붙고, 문장 전부가 저장 주장인
  // 답변에서 안내가 억제돼도 "" 가 된다. 걸러낸 내용은 그대로 버리므로(필터는
  // 조금도 약해지지 않는다) 서버 소유 문장 하나만 반드시 남긴다.
  return {
    ...composed,
    text: SERVER_OWNED_UNVERIFIED_NOTICE,
    corrected: true,
    source: "server_correction",
  };
}

function composeTerminalCandidate({
  text,
  toolResults,
  hasPendingAction,
  persistenceMode,
  demoUserText = "",
  userRequestedChange = true,
  droppedPendingActionTag = false,
}: {
  text: string;
  toolResults: readonly ToolExecutionResult[];
  hasPendingAction: boolean;
  persistenceMode: "durable" | "demo";
  demoUserText?: string;
  /**
   * 이번 턴에 사용자가 변경을 요청할 수 있었는가(제안 도구가 열렸는가).
   *
   * 거짓 저장 주장을 지운 뒤 붙이는 안내는 "변경할 내용을 확인한 뒤 다시
   * 요청해주세요" 라고 말한다. 사용자가 아무것도 요청하지 않은 턴에서는 그 말이
   * 틀렸다 — 2026-08-22 라이브에서 "친구는 스드메에 600만원 썼대" 에 그 안내가
   * 붙었다. 요청하지도 않은 변경의 실패를 사과받는 셈이다.
   *
   * 기본값은 기존 동작(붙인다)이다.
   */
  userRequestedChange?: boolean;
  /**
   * 모델이 변경 표식을 냈는데 서버 검증에서 버려졌는가.
   *
   * 표식이 스키마를 통과 못 하면(지어낸 도구 이름·없는 필드) 카드가 안 나온다.
   * 그때 모델 본문이 거짓 성공 주장을 담고 있으면 아래 정리가 잡아내지만,
   * **중립적으로 쓰여 있으면 지울 것이 없어 아무 말도 안 나간다.**
   * 사용자는 평범한 답을 읽고 아무것도 저장되지 않는다.
   *
   * 표식을 냈다는 것은 모델이 변경을 의도했다는 뜻이다. 그러니 반영되지
   * 않았다는 사실은 알려야 한다. 2026-08-25 적대적 검토.
   */
  droppedPendingActionTag?: boolean;
}): AmoraPersistenceTerminalResult {
  const mutationReceipts = toolResults.filter((result) =>
    isMutatingTool(result.toolName));

  if (mutationReceipts.length > 0) {
    return {
      text: mutationReceipts
        .map((result) => (result.displayMessage ?? "").trim()
          || SERVER_OWNED_MISSING_RECEIPT_MESSAGE_NOTICE)
        .join("\n\n"),
      corrected: true,
      removedClaimCount: 0,
      source: "server_mutation_receipts",
    };
  }

  // 위의 실행 결과 메시지는 서버가 소유한 문구라 검사하지 않는다 — 검사하면 오히려
  // 훼손된다. 여기부터가 제공자 산문이므로, 사용자가 검증할 수 없는 약속과 사람에
  // 대한 판정을 먼저 걷어낸다. 저장 주장 검사와 같은 문장 단위를 쓴다.
  const trustScreened = screenAmoraTrustClaims(text);
  const trustCorrected = trustScreened.removedCount > 0;
  // 미래형 저장 약속은 **이번 턴에 아무것도 저장되지 않았을 때만** 지운다
  // (2026-09-03). 영수증이 있는 턴은 위에서 이미 반환됐고, 카드가 난 턴의 본문은
  // 서버가 만든 확인문이라 검사하면 서버 문구를 훼손한다.
  // 2026-09-05 페르소나 실측(p2 T7, 새 커플 재현 7/8): "드레스 예산이 지금 얼마로 되어
  // 있는지 알려 주세요" 에 get_budget_summary 가 성공했는데, 모델 답 "…450만 원으로
  // 설정되어 있어요" 가 상태 서술 정규식에 걸려 지워지고 본문이 비어 "변경이 반영되지
  // 않았어요" 만 나갔다 — DB 에는 450만 원이 있었으니 안내 자체가 거짓이었다.
  // 같은 턴에 **성공한 읽기 도구 영수증**이 있고 사용자가 변경을 요청한 것도 아니면
  // 상태 서술은 그 영수증이 검증한 것이다. 실행 주장("변경했어요")은 여전히 지운다.
  const verifiedByRead = !hasPendingAction
    && !userRequestedChange
    && toolResults.some((result) =>
      result.success === true && !isMutatingTool(result.toolName));
  const sanitized = removeUnverifiedPersistenceClaims(trustScreened.text, {
    includeFuturePromise: !hasPendingAction,
    keepStateDescriptions: verifiedByRead,
  });

  if (persistenceMode === "demo") {
    const demoGuard = guardDemoPersistenceDisclosure(
      sanitized.text,
      demoUserText,
    );
    const needsGenericNotice = sanitized.removedClaimCount > 0
      && demoGuard.appendedNotice === null;
    const demoText = needsGenericNotice
      ? [demoGuard.text, SERVER_OWNED_DEMO_NOTICE].filter(Boolean).join("\n\n")
      : demoGuard.text;
    const corrected = sanitized.removedClaimCount > 0
      || trustCorrected
      || demoGuard.appendedNotice !== null;

    return {
      text: demoText,
      corrected,
      removedClaimCount: sanitized.removedClaimCount,
      source: corrected ? "server_correction" : "provider",
    };
  }

  // 2026-09-05 페르소나 실측(p7 T12, p4 S4, p5 T3·T4): 모델이 "…으로 이해하면 될까요?" 처럼
  // **되묻고** 끝난 턴에 "변경할 내용을 확인한 뒤 다시 요청해주세요" 가 붙어, 질문과 안내가
  // 서로 다른 다음 행동을 요구했다. 되묻기 자체가 다음 단계다 — 카드가 살아 있는 턴만 빼고
  // 안내를 붙이지 않는다.
  const endsWithQuestion = /[?？]\s*$/u.test(sanitized.text.trim());
  if (sanitized.removedClaimCount === 0) {
    // 지울 거짓 주장이 없어도, 표식이 버려졌으면 그 사실은 알려야 한다.
    if (droppedPendingActionTag && !endsWithQuestion) {
      return {
        text: [sanitized.text, SERVER_OWNED_UNVERIFIED_NOTICE]
          .filter(Boolean)
          .join("\n\n"),
        corrected: true,
        removedClaimCount: 0,
        source: "server_correction",
      };
    }
    return {
      text: sanitized.text,
      corrected: trustCorrected,
      removedClaimCount: 0,
      source: trustCorrected ? "server_correction" : "provider",
    };
  }

  // 요청하지 않은 변경의 실패를 알릴 이유가 없다. 거짓 주장은 이미 지웠으므로
  // 사용자가 잘못 믿을 것도 남아 있지 않다.
  // 2026-09-03: 미래형 약속을 지운 턴은 예외다. "등록할게요" 는 정의상 사용자가
  // 변경을 부탁했다는 뜻이고, 그 문장만 지우고 아무 말도 안 하면 사용자는 아모라가
  // 딴소리를 했다고 읽는다 — 무엇이 반영되지 않았는지 알 방법이 없다.
  const notice = (
    !hasPendingAction
    && !userRequestedChange
    && sanitized.removedFuturePromiseCount === 0
  ) || (!hasPendingAction && endsWithQuestion)
    ? null
    : hasPendingAction
      ? SERVER_OWNED_PENDING_NOTICE
      : SERVER_OWNED_UNVERIFIED_NOTICE;

  return {
    text: [sanitized.text, notice].filter(Boolean).join("\n\n"),
    corrected: true,
    removedClaimCount: sanitized.removedClaimCount,
    source: "server_correction",
  };
}

function containsUnverifiedSuccessClaim(
  segment: string,
  keepStateDescriptions = false,
): boolean {
  const containsKoreanAffirmativeClaim = hasAssertivePersistenceClaim(segment)
    || (!keepStateDescriptions && AFFIRMATIVE_PERSISTENCE_STATE_RE.test(segment))
    || AFFIRMATIVE_MEMORY_CLAIM_RE.test(segment)
    || ENGLISH_AFFIRMATIVE_MEMORY_CLAIM_RE.test(segment);
  if (containsKoreanAffirmativeClaim && !NON_SUCCESS_CONTEXT_RE.test(segment)) {
    return true;
  }

  // Inspect every English completion verb independently. A negative clause
  // such as "wasn't saved" must not shield a later "but was updated" claim.
  for (const match of segment.matchAll(ENGLISH_AFFIRMATIVE_PERSISTENCE_WORD_RE)) {
    const prefix = segment.slice(0, match.index).slice(-48);
    if (!ENGLISH_DIRECT_NEGATION_BEFORE_CLAIM_RE.test(prefix)) {
      return true;
    }
  }

  return false;
}

function removeUnverifiedPersistenceClaims(
  text: string,
  options: { includeFuturePromise?: boolean; keepStateDescriptions?: boolean } = {},
): {
  text: string;
  removedClaimCount: number;
  removedFuturePromiseCount: number;
} {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return { text: "", removedClaimCount: 0, removedFuturePromiseCount: 0 };
  }

  const segments = normalizedText
    .split(/(?<=[.!?。！？])\s*|\n+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const kept: string[] = [];
  let removedClaimCount = 0;
  let removedFuturePromiseCount = 0;

  for (const segment of segments) {
    if (containsUnverifiedSuccessClaim(segment, options.keepStateDescriptions === true)) {
      removedClaimCount += 1;
    } else if (
      options.includeFuturePromise === true
      && containsFuturePersistencePromise(segment)
    ) {
      removedClaimCount += 1;
      removedFuturePromiseCount += 1;
    } else {
      kept.push(segment);
    }
  }

  return {
    text: removedClaimCount === 0
      ? normalizedText
      : repairSplitEmphasis(dropDanglingConnective(kept.join("\n\n"))),
    removedClaimCount,
    removedFuturePromiseCount,
  };
}

/**
 * 아직 일어나지 않은 저장을 약속하는 문장인가.
 *
 * 완료형 검사와 같은 `NON_SUCCESS_CONTEXT_RE` 를 태워 예시·인용은 남긴다
 * ("'등록할게요' 라는 말은 하지 않아요" 같은 자기 규칙 설명).
 */
function containsFuturePersistencePromise(segment: string): boolean {
  return FUTURE_PERSISTENCE_PROMISE_RE.test(segment)
    && !NON_SUCCESS_CONTEXT_RE.test(segment);
}

/**
 * 문장을 지우면 강조 구간이 쪼개진다.
 *
 * 2026-08-22 라이브에서 사용자가 본 것:
 *
 *     우리 예산은 아직 **400만 원으로 확정되지 않았어요.
 *
 *     ** 400만 원과 600만 원 중 어느 쪽을…
 *
 * 여는 `**` 와 닫는 `**` 사이의 문장이 지워지면서 둘이 서로 다른 문단으로
 * 갈라졌다. 마크다운은 문단을 넘는 강조를 허용하지 않아 **별표가 글자 그대로
 * 화면에 보인다.**
 *
 * 짝이 맞지 않는 문단에서는 강조를 통째로 지운다 — 꾸밈을 잃는 편이 별표가
 * 노출되는 것보다 낫다.
 */
function repairSplitEmphasis(text: string): string {
  return text
    .split("\n\n")
    .map((paragraph) => {
      const markers = paragraph.match(/\*\*/g);
      return markers && markers.length % 2 === 1
        ? paragraph.replace(/\*\*/g, "")
        : paragraph;
    })
    .join("\n\n");
}

/**
 * 앞 문장을 지우면 잇는 말만 남는다.
 *
 * 2026-08-22 라이브에서 사용자가 실제로 본 것: **"다만 업체마다 포함 구성과…"**
 * — 앞 문장이 거짓 저장 주장이라 지워졌는데 "다만" 이 그대로 남아, 무엇에 대한
 * 단서인지 알 수 없는 문장이 됐다.
 */
const DANGLING_CONNECTIVE_RE =
  /^(?:다만|하지만|그렇지만|그러나|그런데|그리고|또한|또|그래서|따라서|그러니까|대신)\s*,?\s*/u;

function dropDanglingConnective(text: string): string {
  return text.replace(DANGLING_CONNECTIVE_RE, "");
}

/**
 * Provider prose is never proof that a write happened. Remove affirmative
 * persistence sentences unless this turn has a successful server-owned
 * mutation receipt. Pending proposals remain unapplied until the user
 * confirms the exact server-issued action.
 */
export function guardUnverifiedAmoraPersistenceClaims({
  text,
  hasVerifiedMutationReceipt,
  hasPendingAction,
}: {
  text: string;
  hasVerifiedMutationReceipt: boolean;
  hasPendingAction: boolean;
}): AmoraPersistenceClaimGuardResult {
  const normalizedText = text.trim();
  if (!normalizedText || hasVerifiedMutationReceipt) {
    return {
      text: normalizedText,
      corrected: false,
      removedClaimCount: 0,
    };
  }

  const sanitized = removeUnverifiedPersistenceClaims(normalizedText);

  if (sanitized.removedClaimCount === 0) {
    return {
      text: normalizedText,
      corrected: false,
      removedClaimCount: 0,
    };
  }

  const notice = hasPendingAction
    ? SERVER_OWNED_PENDING_NOTICE
    : SERVER_OWNED_UNVERIFIED_NOTICE;
  return {
    text: [sanitized.text, notice].filter(Boolean).join("\n\n"),
    corrected: true,
    removedClaimCount: sanitized.removedClaimCount,
  };
}
