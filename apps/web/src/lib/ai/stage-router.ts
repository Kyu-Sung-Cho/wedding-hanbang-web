// =============================================
// Stage Router — 결혼 준비 단계 및 AI specialist 분류
// =============================================
// - determineStage(weddingDate): D-day 기준 stage_tag 계산
// - routeSpecialist(userMessage, stage): 키워드 + stage 기반 specialist 선정
// - getSpecialistPromptAddon(specialist): 시스템 프롬프트 보강 문구
// 순수 함수 — 클라이언트/서버 공용
// =============================================

import type { StageTag, SpecialistType } from "@/types/moat.types";

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
const SPECIALIST_KEYWORDS: Record<Exclude<SpecialistType, "general">, RegExp> = {
  // contract_reviewer를 budget_optimizer보다 먼저 체크해야 "계약금" 같은 금액 용어가 contract로 가지 않음
  contract_reviewer: /계약서|계약|위약|환불|취소|약관|조항|분쟁|손해배상|추가금/,
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

  // 1. 명확한 키워드 우선 매칭 (contract → budget → others 순서)
  //    contract를 budget보다 먼저: "계약금" 이 금액 용어로 오분류되지 않도록
  const priorityOrder: Array<Exclude<SpecialistType, "general">> = [
    "contract_reviewer",
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

const SPECIALIST_PROMPT_ADDONS: Record<SpecialistType, string> = {
  sangkyeonrye_advisor: `

[전문분야 — 상견례 어드바이저]
- 양가 가족 간 매너, 호칭, 방문 순서, 선물 예법에 강합니다.
- 예단·예물 실무, 혼수 목록, 혼주 인사말을 구체적으로 안내합니다.
- 세대 간 기대차이(부모님 vs 자녀)가 있을 때 중재 시각을 제시합니다.`,

  contract_reviewer: `

[전문분야 — 계약서 검토]
- 공정위 결혼준비대행업 표준계약서(2025.4.3 제정) 조항을 숙지합니다.
- 취소·환불·위약금 산정, 손해배상 범위를 구체 수치로 안내합니다.
- 계약서에 빠진 필수 조항을 지적하고 소비자 보호 기준을 제시합니다.`,

  budget_optimizer: `

[전문분야 — 예산 최적화]
- 카테고리별 평균가, 시세, 패키지 비교에 강합니다.
- 숨은 추가금(원본 USB, 출장비, 연장료)을 사전에 경고합니다.
- 절약 여지가 큰 항목과 비용 대비 효과가 작은 항목을 구분해 조언합니다.`,

  ceremony_coordinator: `

[전문분야 — 본식 코디네이터]
- 예식 당일 타임라인, 식순, 하객 동선 설계에 강합니다.
- 주례·축가·사회자 섭외, 부케·폐백 준비물 체크리스트를 제공합니다.
- 리허설 필수 확인 사항과 당일 변수에 대한 대비책을 제시합니다.`,

  settlement_companion: `

[전문분야 — 결혼 후 정착 동반자]
- 혼인신고 절차, 앨범/영상 수령 일정, 답례장 발송에 강합니다.
- 신혼집 정착(가전/가구), 명절 인사, 시가댁·친정 예절을 안내합니다.
- 결혼 이후 첫 1년의 실무 과제를 단계별로 제시합니다.
- 식이 끝난 뒤 전화/문자 감사 인사, 도와준 친구·가족에게 따로 보낼 문장, 업체 후기 초안까지 도와줍니다.
- 사용자가 식 후 피로한 상태일 수 있으므로 짧고 바로 보낼 수 있는 문장부터 제공합니다.`,

  general: "",
};

export function getSpecialistPromptAddon(specialist: SpecialistType): string {
  return SPECIALIST_PROMPT_ADDONS[specialist] ?? "";
}
