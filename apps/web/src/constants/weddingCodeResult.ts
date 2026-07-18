// CANDIDATE4_RETIRED: containment-only legacy; never import from Candidate 5 research code.
// 웨딩코드 미러 프로필 v0 결과 화면 콘텐츠 — 지시서 §2~§5.
// 원칙: 채점·유형·판정 문장 금지. 가격은 검수된 공시가나 사용자 견적에서만 표시하고,
// 사용자의 어떤 선택에도 동일 문장·동일 톤(조건 분기 금지 — 지시서 §1-3).
// 고정 시장 수치 대신 사용자가 직접 확인할 비교 기준을 제시한다.

// ── 헤더 카피 (§2-A) ─────────────────────────────────────────

/** 실제 답한 문항 수 반영 — 선택 문항(q13~q16) 건너뜀 시 16이 아닐 수 있다 (정확성 원칙) */
export function wcResultTitle(answeredCount: number): string {
  return `3분 동안 당신이 한 ${answeredCount}개의 선택`;
}
export const WC_RESULT_SUBTITLE = "점수도 유형도 없어요. 당신이 고른 문장과, 가격을 확인할 기준이 있어요.";
export const WC_RESULT_PROTO_NOTICE = "정답도 점수도 없는 프로토타입이에요.";

// ── 가격·계약 확인 기준 ─────────────────────────────────────

export interface WcFact {
  id: "F1" | "F2" | "F3" | "F4";
  text: string;
  source: string;
}

export const WC_FACTS: Record<string, WcFact> = {
  F1: {
    id: "F1",
    text: "기본가와 최종 결제액은 다를 수 있어요. 포함 항목과 별도 옵션을 같은 기준으로 확인하세요.",
    source: "검수된 업체 공시가·사용자 견적 기준",
  },
  F2: {
    id: "F2",
    text: "패키지 총액만으로는 구성별 가격을 알 수 없어요. 스튜디오·드레스·메이크업의 포함 범위를 따로 확인하세요.",
    source: "검수된 업체 공시가·사용자 견적 기준",
  },
  F3: {
    id: "F3",
    text: "같은 이름의 패키지도 지역·시기·구성에 따라 조건이 달라요. 기준일과 구성 범위를 맞춰 비교하세요.",
    source: "웨딩한방 검수 공시가 비교 원칙",
  },
  F4: {
    id: "F4",
    text: "결제 수단·현금영수증·부가세 포함 여부를 계약 전에 서면으로 확인하세요.",
    source: "계약서·업체 서면 안내 확인",
  },
};

// ── 인용 카드 배정 (§2-B, 고정) ──────────────────────────────

export interface WcCardDef {
  cardId: 1 | 2 | 3;
  questionKey: string;
  factId: keyof typeof WC_FACTS | null;
  /** 상황↔팩트를 잇는 한 줄 (팩트 블록 라벨 자리) — 어떤 선택에도 동일 문구(조건 분기
   *  금지 가드레일 준수). 숫자가 "답변 평가"가 아니라 "상황의 근거"로 읽히게 한다. */
  bridge?: string;
  /** questionKey가 건너뜀일 때 대체 (팩트 없이 인용만 — 억지 매칭 금지) */
  fallback?: { questionKey: string; factId: null };
}

export const WC_CARD_DEFS: WcCardDef[] = [
  { cardId: 1, questionKey: "q01", factId: "F1", bridge: "포함과 별도를 나누면 예상 밖 지출을 줄일 수 있어요" },
  { cardId: 2, questionKey: "q05", factId: "F2", bridge: "총액보다 구성별 공개 범위를 먼저 확인해요" },
  { cardId: 3, questionKey: "q13", factId: "F3", bridge: "지역·시기·구성 기준을 맞춰 비교해요", fallback: { questionKey: "q11", factId: null } },
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
    D: "나는 계약서에 적힌 걸\n확인한 뒤에 계약한다",
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
  q13: "마음에 드는 곳이 우리 예산보다 많이 비쌀 때",
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
