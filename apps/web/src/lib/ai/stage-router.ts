// =============================================
// Stage Router — 결혼 준비 단계 및 AI specialist 분류
// =============================================
// - determineStage(weddingDate): D-day 기준 stage_tag 계산
// - routeSpecialist(userMessage, stage): 키워드 + stage 기반 specialist 선정
// - getSpecialistPromptAddon(specialist): 시스템 프롬프트 보강 문구
// 순수 함수 — 클라이언트/서버 공용
// =============================================

import type { StageTag, SpecialistType, RoutableSpecialistType } from "@/types/moat.types";

// -------------------------------------------
// Stage 계산
// -------------------------------------------

const DAY_MS = 1000 * 60 * 60 * 24;

export function determineStage(
  weddingDate: string | null | undefined,
  today: Date = new Date()
): StageTag {
  if (!weddingDate) return "planning_0";

  const wedding = new Date(weddingDate);
  if (Number.isNaN(wedding.getTime())) return "planning_0";

  const daysUntil = Math.floor((wedding.getTime() - today.getTime()) / DAY_MS);

  if (daysUntil > 180) return "planning_0";
  if (daysUntil > 30) return "preparation_1";
  if (daysUntil > 0) return "execution_2";
  if (daysUntil === 0) return "ceremony_3";  // 본식 당일만
  return "settlement_4";                      // 본식 다음날부터
}

// -------------------------------------------
// Specialist 라우팅
// -------------------------------------------

// 키워드 테이블 — 각 패턴은 OR로 연결
const SPECIALIST_KEYWORDS: Record<RoutableSpecialistType, RegExp> = {
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

  // 1. 명확한 키워드 우선 매칭 (budget → others 순서)
  const priorityOrder: RoutableSpecialistType[] = [
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

  // 2. 겹치는 키워드 (시댁/처가) — stage 기반 타이브레이크
  //    settlement 단계면 settlement_companion 우선
  if (OVERLAP_KEYWORDS.test(msg) && stage === "settlement_4") {
    return "settlement_companion";
  }

  // 3. 첫 매치 승리 (priorityOrder 순서)
  return matched[0];
}

// -------------------------------------------
// Specialist 프롬프트 보강
// -------------------------------------------

// 은퇴한 전문분야(contract_reviewer)는 애드온을 갖지 않는다. 과거 행을 읽을 때만
// 값이 나타날 수 있고, 조회는 ?? ""로 빈 문자열이 된다.
const SPECIALIST_PROMPT_ADDONS: Partial<Record<SpecialistType, string>> = {
  sangkyeonrye_advisor: `

[전문분야 — 부모님 첫 만남과 가족 조율]
- 가족·지역·문화마다 방식이 다르므로 호칭, 방문 순서, 선물, 비용 부담을 보편 규칙처럼 말하지 마세요.
- 두 사람과 각 부모님이 실제로 원하는 것, 원하지 않는 것, 이미 합의한 것을 구분해 한 번에 하나씩 확인하세요.
- 가족 선물의 종류나 금액을 만들지 말고, 서로의 기대와 감당 가능한 범위를 직접 말할 수 있게 도우세요.`,

  budget_optimizer: `

[전문분야 — 확인된 금액으로 예산 정리]
- 사용자가 입력한 총액·견적·계약 금액·지출 상한과 출처가 표시된 현재 공시가만 사용하세요.
- 사용자가 입력하지 않은 카테고리 금액, 평균가, 비율, 할인 가능성, 추가 비용을 만들지 마세요.
- 포함 항목과 따로 내는 금액은 업체의 서면 견적에서 확인하고, 어느 항목을 줄일지는 사용자의 우선순위와 명시한 금액을 받은 뒤 정리하세요.`,

  ceremony_coordinator: `

[전문분야 — 결혼식 날 진행]
- 결혼식장·업체·가족이 실제로 확정한 시간과 역할만 사용해 당일 순서와 이동을 정리하세요.
- 결혼식을 진행할 사람, 축하 공연, 꽃, 전통 절차를 누구에게나 필요한 항목처럼 추가하지 마세요.
- 미리 맞춰볼 필요가 있는지는 계약서와 담당자의 안내를 확인하고, 확인되지 않은 시간을 일정에 넣지 마세요.`,

  settlement_companion: `

[전문분야 — 결혼식 뒤 정리]
- 사용자가 실제로 남았다고 말한 사진·영상 받기, 지출 기록, 감사 인사, 신혼집 정리를 한 번에 하나씩 도우세요.
- 혼인신고·세금·대출 같은 행정 절차는 최신 공식 원문과 적용 조건을 확인하지 못하면 날짜·서류·법적 결론을 단정하지 마세요.
- 가족 호칭·명절·방문 순서를 의무나 성별 역할처럼 안내하지 마세요.
- 사용자가 지쳤다면 바로 보낼 수 있는 짧은 감사 문장이나 지금 처리할 한 가지부터 제시하세요.`,

  general: "",
};

export function getSpecialistPromptAddon(specialist: SpecialistType): string {
  return SPECIALIST_PROMPT_ADDONS[specialist] ?? "";
}
