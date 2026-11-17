import { normalizeAmoraSafetyText } from "./amoraCrisisSafety";

export interface AmoraEvidenceSummaryContext {
  requestKind: string;
  durable: boolean;
  isDemo: boolean;
  hasPriorityAction: boolean;
  hasPersonalTools: boolean;
  hasAttachments: boolean;
  offersPlaceSearch: boolean;
  toolNames: readonly string[];
}

const STATE_DIMENSIONS = [
  /확정|결정한|정한\s*(?:것|내용|부분)/,
  /가설|가정|검토\s*중/,
  /미정|미확인/,
  /전달|말(?:하)?지\s*않|말\s*안\s*했/,
  /합의|동의/,
];

// 실제 catalog의 기존 내부 조회·계산만 인정한다. 도구 선택이나 실행 권한은 늘리지 않는다.
// 2026-11-16: 시세 조회(`get_market_price`)는 뺐다 — 참가격 자료를 쓰지 않는다(파운더 결정 D-79).
const EVIDENCE_SUMMARY_READ_TOOLS: ReadonlySet<string> = new Set([
  "get_wedding_info",
  "get_budget_summary",
  "get_schedule_summary",
  "get_amora_actions",
  "get_schedule_events",
  "simulate_guest_guarantee",
  "analyze_quote",
]);

function requestsEvidenceSummary(userText: string): boolean {
  // 인용문은 선택 근거에서만 제외한다. 실제 모델에 전달되는 사용자 원문은 그대로 둔다.
  const requestText = normalizeAmoraSafetyText(userText)
    .replace(/```[\s\S]*?```|`[^`]*`/gu, " ")
    .replace(/“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/gu, " ")
    .replace(/^\s*(?:>|예문\s*:|예시\s*:).*$/gmu, " ");
  const asksToSummarizeStates = requestText.split(/[.!?。\n]+/u).some(sentence => {
    const asksSummary = /(?:(?:요약|정리|구분)해|나눠)\s*(?:줘(?:요)?|주세요|주실래(?:요)?|줄래(?:요)?)(?!\s*(?:라는|라고|란))(?=$|\s)/u.test(sentence);
    // 상태를 "정리하되 섞지 말아줘"라는 후속 요청도 같은 읽기 과업이다.
    const asksSeparation = /(?:섞|혼동하)지\s*(?:말아\s*(?:줘(?:요)?|주세요)|마(?:세요)?)(?!\s*(?:라는|라고|란))(?=$|\s)/u.test(sentence)
      && /요약|정리|구분|표|상태/u.test(sentence);
    return (asksSummary || asksSeparation)
      && !/순서|절차/u.test(sentence)
      && STATE_DIMENSIONS.filter(pattern => pattern.test(sentence)).length >= 2;
  });
  if (!asksToSummarizeStates) {
    return false;
  }
  // 변경을 섞은 상담은 기존 경로로 둔다. 명시적인 저장·공유 금지는 변경 요청이 아니다.
  const withoutWriteProhibitions = requestText.replace(
    /(?:저장|공유|반영|등록|수정|삭제|승인|추가)(?:\s*(?:하거나|및|또는|·|,)\s*(?:저장|공유|반영|등록|수정|삭제|승인|추가))*(?:은|는)?\s*하지\s*(?:마(?:세요)?|말아\s*줘|말아\s*주세요)/gu,
    " ",
  );
  return !/저장|공유|반영|등록|수정|삭제|승인|추가/u.test(withoutWriteProhibitions);
}

/** 서버가 확정한 첫 호출의 읽기 경계 안에서만 요약 역할을 선택한다. */
export function shouldEscalateAmoraEvidenceSummary(
  userText: string,
  context: AmoraEvidenceSummaryContext | undefined,
): boolean {
  return context !== undefined
    && context.requestKind === "chat"
    && context.durable
    && !context.isDemo
    && !context.hasPriorityAction
    && !context.hasPersonalTools
    && !context.hasAttachments
    && !context.offersPlaceSearch
    && context.toolNames.every(name => EVIDENCE_SUMMARY_READ_TOOLS.has(name))
    && requestsEvidenceSummary(userText);
}
