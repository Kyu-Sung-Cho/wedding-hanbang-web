// =============================================
// Stage Router — 결혼 준비 단계 및 AI specialist 분류
// =============================================
// - determineStage(weddingDate): D-day 기준 stage_tag 계산
// - routeSpecialist(userMessage, stage): 키워드 + stage 기반 specialist 선정
// - getSpecialistPromptAddon(specialist): 시스템 프롬프트 보강 문구
// 순수 함수 — 클라이언트/서버 공용
// =============================================

import type { StageTag, SpecialistType } from "@/types/moat.types";
import { ddayInKst } from "@/lib/utils/kstDate";

// -------------------------------------------
// Stage 계산
// -------------------------------------------

export function determineStage(
  weddingDate: string | null | undefined,
  today: Date = new Date()
): StageTag {
  if (!weddingDate) return "planning_0";

  const daysUntil = ddayInKst(weddingDate, today);
  if (daysUntil === null) return "planning_0";

  if (daysUntil > 180) return "planning_0";
  if (daysUntil > 30) return "preparation_1";
  if (daysUntil > 0) return "execution_2";
  if (daysUntil === 0) return "ceremony_3";  // 본식 당일만
  return "settlement_4";                      // 본식 다음날부터
}

// -------------------------------------------
// Specialist 라우팅
// -------------------------------------------

// 계약 완료 보고나 일정 대화에 들어간 단순 "계약"은 계약 검토 요청이 아니다.
// 문서·조항·분쟁 표현 또는 계약을 실제로 확인해 달라는 의도가 함께 있을 때만
// 고비용 contract_reviewer로 보낸다.
const EXPLICIT_CONTRACT_REVIEW_PATTERN =
  /계약서|약관|조항|특약|위약금?|환불|분쟁|손해배상|법적\s*효력|해약/;
const CONTRACT_REVIEW_ACTION_PATTERN =
  /검토|확인|체크|살펴|봐\s*줘|문제|위험|주의|불리|누락|효력|해지|취소|돌려|받을\s*수|계약해도|계약할까|계약해야/;
const CANCELLATION_CONTEXT_PATTERN = /계약|예약금|계약금|업체|위약/;

function hasExplicitContractReviewIntent(message: string): boolean {
  if (EXPLICIT_CONTRACT_REVIEW_PATTERN.test(message)) return true;
  if (/계약/.test(message) && CONTRACT_REVIEW_ACTION_PATTERN.test(message)) return true;
  return /취소|해지/.test(message) && CANCELLATION_CONTEXT_PATTERN.test(message);
}

// 키워드 테이블 — 각 패턴은 OR로 연결
const SPECIALIST_KEYWORDS: Record<
  Exclude<SpecialistType, "general" | "contract_reviewer">,
  RegExp
> = {
  sangkyeonrye_advisor: /상견례|양가|시댁|처가|어른|예법|상차림|부모님|예단|예물/,
  budget_optimizer: /예산|돈|가격|비용|얼마|만원|결제|견적|시세|할인|패키지|스드메|세일/,
  ceremony_coordinator: /본식|예식|당일|리허설|포토그래퍼|주례|축가|식순|하객|답례품|부케|폐백|사회자/,
  settlement_companion: /혼인신고|앨범|영상|후기|답례장|답례|명절|시가댁|신혼|집들이|정착|감사|감사인사|감사\s*문자|문자|전화|식\s*끝|식후/,
};

// stage 기본값 (키워드 미매칭 시 fallback)
const STAGE_DEFAULT_SPECIALIST: Record<StageTag, SpecialistType> = {
  planning_0: "sangkyeonrye_advisor",
  preparation_1: "budget_optimizer",
  execution_2: "ceremony_coordinator",
  ceremony_3: "ceremony_coordinator",
  settlement_4: "settlement_companion",
};

// stage-based 타이브레이크: 양쪽 해당될 수 있는 키워드
// "시댁/처가" 메시지가 정착 단계라면 sangkyeonrye 대신 settlement_companion
const OVERLAP_KEYWORDS = /시댁|처가|시가댁/;

export function routeSpecialist(
  userMessage: string,
  stage: StageTag
): SpecialistType {
  const msg = (userMessage ?? "").trim();
  if (!msg) return STAGE_DEFAULT_SPECIALIST[stage] ?? "general";

  // 1. 명확한 계약 검토 의도는 다른 금액·일정 키워드보다 우선한다.
  if (hasExplicitContractReviewIntent(msg)) return "contract_reviewer";

  // 2. 나머지 키워드는 budget → ceremony → settlement → family 순으로 매칭한다.
  const priorityOrder: Array<
    Exclude<SpecialistType, "general" | "contract_reviewer">
  > = [
    "budget_optimizer",
    "ceremony_coordinator",
    "settlement_companion",
    "sangkyeonrye_advisor",
  ];

  const matched: SpecialistType[] = [];
  for (const specialist of priorityOrder) {
    if (SPECIALIST_KEYWORDS[specialist].test(msg)) {
      matched.push(specialist);
    }
  }

  if (matched.length === 0) {
    return STAGE_DEFAULT_SPECIALIST[stage] ?? "general";
  }

  // 3. 겹치는 키워드 (시댁/처가) — stage 기반 타이브레이크
  //    settlement 단계면 settlement_companion 우선
  if (OVERLAP_KEYWORDS.test(msg) && stage === "settlement_4") {
    return "settlement_companion";
  }

  // 4. 첫 매치 승리 (priorityOrder 순서)
  return matched[0];
}

// -------------------------------------------
// Specialist 프롬프트 보강
// -------------------------------------------

const OPTIONAL_CUSTOMS_BOUNDARY = `

[선택 관습·역할 경계]
- 상견례, 예단, 예물, 혼수, 주례, 축가, 부케, 폐백, 답례, 명절 인사와 가족 참여는 모두 커플마다 다른 선택 사항입니다.
- 사용자가 먼저 언급하지 않은 의식이나 가족 역할은 해야 할 일로 만들지 말고, 관련 질문이라면 적용 여부를 먼저 한 번 확인합니다.
- 고정 금액·횟수·기한·순서·성별 역할을 보편 규칙처럼 제시하지 않습니다.
- 혼인신고 등 법적 절차는 사용자의 상황을 단정하지 않고 최신 공식 출처에서 확인할 항목과 질문만 정리합니다.`;

const SPECIALIST_PROMPT_ADDONS: Record<SpecialistType, string> = {
  sangkyeonrye_advisor: `

[전문분야 — 상견례 어드바이저]
- 사용자가 상견례를 하기로 한 경우 참석자·장소·대화 범위와 가족에게 확인할 질문을 정리합니다.
- 호칭, 선물, 예단·예물, 혼수, 혼주 역할은 가족마다 다르므로 관습을 규칙으로 단정하지 않습니다.
- 세대 간 기대차이(부모님 vs 자녀)가 있을 때 중재 시각을 제시합니다.`,

  contract_reviewer: `

[전문분야 — 계약 전 확인 지원]
- 사용자가 제공한 계약서·견적서·대화 캡처와 시스템에 주입된 공식 근거에서 확인되는 내용만 정리합니다.
- 기억에 의존해 표준계약서 조항을 단정하거나 인용하지 않습니다. 계약의 법적 효력·적법성, 위약금·손해배상액을 확정하거나 계산하지 않습니다.
- 문서화된 조건, 빠지거나 모호한 조건, 업체에 보낼 확인 질문, 보존할 증빙을 구분해 안내합니다.
- 분쟁·고액 손실·법률 판단이 필요한 경우 1372 소비자상담센터 또는 법률 전문가에게 확인하도록 안내하고, 상담 시 물어볼 질문을 정리합니다.`,

  budget_optimizer: `

[전문분야 — 예산 기록 지원]
- 사용자가 직접 입력한 금액의 합계, 차이, 비중만 계산하고 가격의 적정성이나 절약 가능성을 판정하지 않습니다.
- 시세나 통계는 시스템에 출처, 조사 시점, 범위가 함께 제공된 자료만 설명하며 개인 견적의 기준으로 단정하지 않습니다.
- 별도 비용은 발생률이나 금액을 추정하지 않고 계약서·견적서에서 확인할 질문으로 정리합니다.
- 입력하지 않은 예산이나 지출을 평균값으로 채우지 않고 미정으로 둡니다.`,

  ceremony_coordinator: `

[전문분야 — 본식 코디네이터]
- 예식 당일 타임라인, 식순, 하객 동선 설계에 강합니다.
- 사용자가 선택한 주례·축가·사회·부케·폐백만 준비 항목으로 정리합니다.
- 리허설이 있는 경우 확인할 사항과 당일 변수 대비 질문을 제시합니다.`,

  settlement_companion: `

[전문분야 — 결혼 후 정착 동반자]
- 혼인신고는 최신 공식 안내를 확인할 질문으로, 앨범·영상 수령은 사용자가 맺은 계약 원문 기준으로 정리합니다.
- 신혼집, 답례, 가족 인사 등 사용자가 선택한 항목만 기록하고 보편적인 첫 1년 과제를 만들지 않습니다.
- 식이 끝난 뒤 전화/문자 감사 인사, 도와준 친구·가족에게 따로 보낼 문장, 업체 후기 초안까지 도와줍니다.
- 사용자가 식 후 피로한 상태일 수 있으므로 짧고 바로 보낼 수 있는 문장부터 제공합니다.`,

  general: "",
};

export function getSpecialistPromptAddon(specialist: SpecialistType): string {
  return `${OPTIONAL_CUSTOMS_BOUNDARY}${SPECIALIST_PROMPT_ADDONS[specialist] ?? ""}`;
}
