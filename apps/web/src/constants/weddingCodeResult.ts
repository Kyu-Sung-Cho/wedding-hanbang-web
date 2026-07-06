// 웨딩코드 미러 프로필 v0 결과 화면 콘텐츠 — 지시서 §2~§5.
// 원칙: 채점·유형·판정 문장 금지. 팩트는 아래 목록 외 사용 금지, 출처+연도 병기,
// 사용자의 어떤 선택에도 동일 문장·동일 톤(조건 분기 금지 — 지시서 §1-3).
// 팩트 검증 기록: docs/wedding-code/02a 소스 노트 (2026-07-06 독립 재검증 완료).

// ── 헤더 카피 (§2-A) ─────────────────────────────────────────

export const WC_RESULT_TITLE = "3분 동안 당신이 한 16개의 선택";
export const WC_RESULT_SUBTITLE = "점수도 유형도 없어요. 당신이 고른 문장과, 시장의 실제 숫자만 있어요.";
export const WC_RESULT_PROTO_NOTICE = "정답도 점수도 없는 프로토타입이에요.";

// ── 시장 팩트 (§4 — 이 목록 외 사용 금지, 전부 검증 완료) ────

export interface WcFact {
  id: "F1" | "F2" | "F3" | "F4";
  text: string;
  source: string;
}

export const WC_FACTS: Record<string, WcFact> = {
  F1: {
    id: "F1",
    text: "2024년 정부 첫 실태조사 기준, 스드메 기본금 평균 346만원 — 실제 지불 평균은 520만원 (추가금 평균 174만원)",
    source: "기획재정부 결혼서비스 실태조사, 2024",
  },
  F2: {
    id: "F2",
    text: "2024년 정부 첫 실태조사에서, 패키지 이용자 중 개별 가격을 고지받은 경우는 34.3%",
    source: "기획재정부 결혼서비스 실태조사, 2024",
  },
  F3: {
    // 2026-04 참가격 검증분 — 6월 데이터 수동 확인 시 교체 (02a 소스 노트).
    // ⚠️ 이 데이터의 "서울"은 강남/강남외 미구분 단일 권역 중위가(참가격 2026-04 구획 기준).
    //    강남 분리 수치는 이후 참가격 개편분(지역통계 페이지)에서 확인되면 별도 반영.
    id: "F3",
    text: "같은 스드메 패키지, 서울 중위가 약 350만원 — 경기·인천은 약 230만원 (2026년 4월 기준)",
    source: "한국소비자원 참가격, 2026년 4월",
  },
  F4: {
    id: "F4",
    text: "결혼서비스 이용자 1,000명 중 78.1%가 현금 결제 유도를 경험",
    source: "한국소비자원 2024 소비자 시장평가지표 (2025년 6월 발표)",
  },
};

// ── 인용 카드 배정 (§2-B, 고정) ──────────────────────────────

export interface WcCardDef {
  cardId: 1 | 2 | 3;
  questionKey: string;
  factId: keyof typeof WC_FACTS | null;
  /** questionKey가 건너뜀일 때 대체 (팩트 없이 인용만 — 억지 매칭 금지) */
  fallback?: { questionKey: string; factId: null };
}

export const WC_CARD_DEFS: WcCardDef[] = [
  { cardId: 1, questionKey: "q01", factId: "F1" },
  { cardId: 2, questionKey: "q05", factId: "F2" },
  { cardId: 3, questionKey: "q13", factId: "F3", fallback: { questionKey: "q11", factId: null } },
];

// ── 1인칭 인용 문장 (카드 후보 4문항 × 4옵션 = 16종, 뜻 변경 없이 다듬기만) ──
// 개행(\n)은 의미 단위 수동 지정 — 캔버스 렌더가 이 줄바꿈을 그대로 존중한다
// (shareCard.layoutQuote: 수동 줄이 쪼개지지 않는 가장 큰 크기를 우선 선택).

export const WC_QUOTE_TEXTS: Record<string, Record<string, string>> = {
  q01: {
    A: "나는 뭐가 포함이고\n뭐가 추가금인지부터 따져본다",
    B: "나는 가격보다,\n나올 사진·스타일이\n우리 느낌인지부터 본다",
    C: "나는 둘이서\n'꼭 필요한 것'부터 추린다",
    D: "나는 실제 해본 사람들\n후기를 찾아본다",
  },
  q05: {
    A: "나는 문자로라도\n남겨달라고 한다",
    B: "나는 그 혜택이\n진짜 필요한 건지 따져본다",
    C: "나는 그 약속 없이도\n괜찮은 곳인지 다시 본다",
    D: "나는 확인될 때까지\n결정을 잠깐 미룬다",
  },
  q13: {
    A: "나는 총액과 추가금,\n환불 조건부터 확인한다",
    B: "나는 그만큼 오래 남을 곳인지\n생각해본다",
    C: "나는 가족과 하객 동선까지\n같이 따져본다",
    D: "나는 둘의 예산 기준을\n다시 맞춰본다",
  },
  q11: {
    A: "나는 하루 자고 나서도\n같은 마음인지 본다",
    B: "나는 좋았던 점과 걸리는 점을\n같이 적어본다",
    C: "나는 총액과 취소 조건을\n확인하고 정한다",
    D: "나는 다른 후보와\n한 번 더 비교해본다",
  },
};

// ── 시나리오 요약 한 줄 (16문항 전부 — 카드 상단·아코디언 공용) ──

export const WC_SCENARIO_SUMMARIES: Record<string, string> = {
  q01: "견적서, 어디서 돈이 더 나올지 모를 때",
  q02: "기억에 남을 것 같은데 추가 비용이 있을 때",
  q03: "나만 마음에 든 곳이 생겼을 때",
  q04: "한 명이 알아보고 둘이 최종 확인할 때",
  q05: "구두 약속이 계약서에 없을 때",
  q06: "투어에서 '우리 느낌'을 만났을 때",
  q07: "우리는 분위기, 부모님은 조건일 때",
  q08: "부모님께 우리 기준을 말씀드릴 때",
  q09: "걱정을 말했는데 해결책이 먼저 돌아올 때",
  q10: "본식 직전 할 일이 쏟아질 때",
  q11: "당장 계약하고 싶은 마음이 들 때",
  q12: "견적서가 낯선 항목투성이일 때",
  q13: "마음에 드는 곳이 예산보다 300만 원 비쌀 때",
  q14: "서로 잘 보는 눈이 다를 때",
  q15: "느낌은 좋은데 후기가 적을 때",
  q16: "전통 절차를 줄이고 싶을 때",
};

// ── 오늘의 대화 카드 (§5 — deterministic, 존재하는 첫 규칙 1개만) ──

export interface WcTalkRule {
  questionKey: string;
  options: string[];
  text: string;
}

export const WC_TALK_RULES: WcTalkRule[] = [
  {
    questionKey: "q09", options: ["A", "B"],
    text: "오늘 해볼 것: '해결책 말고 그냥 들어줘'가 필요한 날, 서로에게 알려줄 신호 하나 정해보세요.",
  },
  {
    questionKey: "q11", options: ["A", "B"],
    text: "오늘 해볼 것: 계약 충동이 올 때 쓸 '우리 24시간 룰'을 미리 합의해 두세요.",
  },
  {
    questionKey: "q07", options: ["A", "B"],
    text: "오늘 해볼 것: 양가 기준을 맞추기 전에, 두 분의 기준표부터. 각자 '포기 못 할 1가지'만 적어 보세요.",
  },
  {
    questionKey: "q03", options: ["A", "D"],
    text: "오늘 저녁 질문: '요즘 알아본 것 중에 제일 마음 간 게 뭐였어?' — 이유부터 서로 들어보세요.",
  },
];

export const WC_TALK_DEFAULT =
  "오늘 해볼 것: 이번 주 결혼 준비에서 각자 제일 신경 쓰이는 것 1가지씩 말해보세요.";

/** §5 매핑 — 우선순위 q09 → q11 → q07 → q03 → default. 합산·조합 없음. */
export function pickTalkCard(answers: Record<string, string>): string {
  for (const rule of WC_TALK_RULES) {
    const answer = answers[rule.questionKey];
    if (answer && rule.options.includes(answer)) return rule.text;
  }
  return WC_TALK_DEFAULT;
}

// ── 공유 카드 브랜드 ──

export const WC_CARD_BRAND = "웨딩코드 · hanbang.ai";
