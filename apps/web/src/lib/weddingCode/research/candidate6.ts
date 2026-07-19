/**
 * WeddingCode Candidate 6.3 research-only item pool.
 *
 * This is an M0 content and interaction prototype. It deliberately exposes no
 * score, type, percentile, confidence, compatibility, persistence, network, or
 * product-application contract. Research themes are hypotheses, not validated
 * latent dimensions. Every response stays a named category until human content,
 * response-process, structural, fairness, and consequence evidence exists.
 */

export const CANDIDATE6_RESEARCH_EXACT_VERSION = "wedding-code-candidate6-research.3" as const;
export const CANDIDATE6_RESEARCH_CONSENT_VERSION = "unapproved-local-prototype" as const;

export const CANDIDATE6_RESEARCH_THEMES = ["DS", "JI", "OA", "CP", "ES", "AS", "SI"] as const;
export type Candidate6ResearchTheme = (typeof CANDIDATE6_RESEARCH_THEMES)[number];
export type Candidate6Form = "A" | "B";
export type Candidate6SupportPairOrder = "ES_FIRST" | "AS_FIRST";
export type Candidate6ScenarioEvidenceGrade = "S0" | "S1";
export type Candidate6MeasurementEvidenceGrade = "M0";
export type Candidate6Applicability =
  | "universal"
  | "recording"
  | "vendor-assisted"
  | "partner-collaboration"
  | "stakeholder-context";
export type Candidate6CoreConditionalApplicability = Exclude<
  Candidate6Applicability,
  "universal" | "stakeholder-context"
>;
export type Candidate6EligibilityStatus = "eligible" | "not_applicable" | "unsure";
export type Candidate6InterviewEligibility = Readonly<
  Record<Candidate6CoreConditionalApplicability, Candidate6EligibilityStatus>
>;

export type Candidate6EvidenceSource =
  | "SRC-AERA-TEST-STANDARDS-2014"
  | "SRC-CDC-COGNITIVE-INTERVIEWING-2024"
  | "SRC-KCA-WEDDING-PRICE-2025-06"
  | "SRC-DYADIC-COPING-REVIEW-2019"
  | "SRC-PRODUCT-SCENARIO-LOG";

export const CANDIDATE6_EVIDENCE_SOURCE_REGISTRY = {
  "SRC-AERA-TEST-STANDARDS-2014": {
    uri: "https://www.testingstandards.net/uploads/7/6/6/4/76643089/standards_2014edition.pdf",
    locator: "Validity chapter and Standards 1.0-1.3",
    supportedClaim: "Intended score interpretations require multiple relevant sources of validity evidence.",
    notSupportedClaim: "No WeddingCode item, theme, score, or classification is validated by this standard.",
    population: "General educational and psychological testing practice; not a WeddingCode respondent sample.",
    context: "Validity argument and intended interpretation/use standards.",
  },
  "SRC-CDC-COGNITIVE-INTERVIEWING-2024": {
    uri: "https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html",
    locator: "Overview, Characteristics, and Follow-up questions",
    supportedClaim: "Cognitive interviewing can reveal how people understand and answer candidate questions.",
    notSupportedClaim: "Cognitive interviews alone do not establish a WeddingCode scale or result.",
    population: "Purposively selected respondents with relevant qualities or experiences; typically small qualitative samples.",
    context: "Question evaluation through comprehension, recall, judgment, and response-process probes.",
  },
  "SRC-KCA-WEDDING-PRICE-2025-06": {
    uri: "https://www.kca.go.kr/home/sub.do?menukey=4002&mode=view&no=1003902297&page=4",
    locator: "2025-07-29 press release and attached June 2025 wedding-service price survey",
    supportedClaim: "Korean wedding-service offerings include variable price and option structures.",
    notSupportedClaim: "The survey does not support any personality construct or the exact candidate wording.",
    population:
      "515 wedding-service providers across 14 regions in Korea in the June 2025 KCA price survey; this is not a consumer-respondent sample.",
    context: "Wedding-service option and price comparison; not couple psychology or item validation.",
  },
  "SRC-DYADIC-COPING-REVIEW-2019": {
    uri: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6443825/",
    locator: "Conceptual integration of joint, emotional, and instrumental support processes",
    supportedClaim: "Joint coping and emotional or practical support are conceptually distinguishable hypotheses.",
    notSupportedClaim: "The review does not validate these wedding scenarios, Korean wording, or a person profile.",
    population: "Couple studies synthesized by the review, largely outside Korean wedding preparation.",
    context: "Dyadic stress/coping and emotional versus problem-focused supportive processes.",
  },
  "SRC-PRODUCT-SCENARIO-LOG": {
    uri: "docs/wedding-code/05_question_domain_map.md",
    locator: "Concrete wedding-scenario domain map; design input only",
    supportedClaim: "The product has documented candidate planning and coordination scenarios worth eliciting.",
    notSupportedClaim: "Internal design documentation is not independent empirical evidence.",
    population: "No participant sample; internal product hypotheses only.",
    context: "Wedding-planning scenario inventory used as design input for concept elicitation.",
  },
} as const satisfies Record<
  Candidate6EvidenceSource,
  Readonly<{
    uri: string;
    locator: string;
    supportedClaim: string;
    notSupportedClaim: string;
    population: string;
    context: string;
  }>
>;

export const CANDIDATE6_BIPOLAR_DIRECTIONS = [-2, -1, 0, 1, 2] as const;
export type Candidate6BipolarDirection = (typeof CANDIDATE6_BIPOLAR_DIRECTIONS)[number];

export const CANDIDATE6_IMPACT_LEVELS = [
  "strongly_hinders",
  "slightly_hinders",
  "neutral_impact",
  "slightly_helps",
  "strongly_helps",
] as const;
export type Candidate6ImpactLevel = (typeof CANDIDATE6_IMPACT_LEVELS)[number];

export const CANDIDATE6_ESCAPE_RESPONSES = [
  { value: "depends", label: "상황마다 많이 달라져요" },
  { value: "not_applicable", label: "이 상황은 지금 내 준비에 해당하지 않아요" },
  { value: "no_experience", label: "비슷한 경험이 없어 가늠하기 어려워요" },
  { value: "skip", label: "이 질문은 넘길게요" },
] as const;
export type Candidate6EscapeResponse = (typeof CANDIDATE6_ESCAPE_RESPONSES)[number]["value"];

type Candidate6Evidence = Readonly<{
  scenarioGrade: Candidate6ScenarioEvidenceGrade;
  measurementGrade: Candidate6MeasurementEvidenceGrade;
  sources: readonly Candidate6EvidenceSource[];
  alternativeExplanations: readonly string[];
  disposition: "COGNITIVE_INTERVIEW_REQUIRED";
}>;

type Candidate6BaseItem = Readonly<{
  id: string;
  theme: Candidate6ResearchTheme;
  module: "core" | "contextual-stakeholder";
  analysisRole: "hypothesis-item" | "contextual-tool";
  scoreEligible: false;
  applicability: Candidate6Applicability;
  chapter: "선택의 첫 단추" | "우리의 팀플" | "필요한 도움" | "주변 의견 다루기";
  premise: string;
  scenario: string;
  prompt: string;
  scenarioPairId?: "support-a" | "support-b" | "support-c";
  evidence: Candidate6Evidence;
}>;

export type Candidate6BipolarItem = Candidate6BaseItem &
  Readonly<{
    responseMode: "bipolar-order";
    leftAnchor: string;
    rightAnchor: string;
  }>;

export type Candidate6ImpactItem = Candidate6BaseItem &
  Readonly<{
    responseMode: "balanced-impact";
    behavior: string;
  }>;

export type Candidate6ResearchItem = Candidate6BipolarItem | Candidate6ImpactItem;

const REQUIRED_INTERVIEW = "COGNITIVE_INTERVIEW_REQUIRED" as const;

function evidence(
  scenarioGrade: Candidate6ScenarioEvidenceGrade,
  sources: readonly Candidate6EvidenceSource[],
  alternativeExplanations: readonly string[]
): Candidate6Evidence {
  return {
    scenarioGrade,
    measurementGrade: "M0",
    sources,
    alternativeExplanations,
    disposition: REQUIRED_INTERVIEW,
  };
}

const hypothesisBase = {
  module: "core",
  analysisRole: "hypothesis-item",
  scoreEligible: false,
} as const;

const contextBase = {
  module: "contextual-stakeholder",
  analysisRole: "contextual-tool",
  scoreEligible: false,
} as const;

const SUPPORT_PAIR_A = {
  premise: "누구의 잘못도 아닌 외부 일정 변경이고, 긴급한 안전 문제나 오늘 마감은 없어요.",
  scenario: "외부 일정 변경으로 계획을 다시 정리하는 장면",
  scenarioPairId: "support-a",
} as const;

const SUPPORT_PAIR_B = {
  premise: "후보가 많아 복잡하지만, 지금 바로 결정하거나 계약할 필요는 없어요.",
  scenario: "후보가 많아 비교가 끝나지 않는 장면",
  scenarioPairId: "support-b",
} as const;

const SUPPORT_PAIR_C = {
  premise: "원했던 선택지가 어려워졌지만, 대안을 살펴볼 시간은 충분해요.",
  scenario: "기대했던 선택지를 바꿔야 하는 장면",
  scenarioPairId: "support-c",
} as const;

export const CANDIDATE6_RESEARCH_ITEMS = [
  {
    ...hypothesisBase,
    id: "C6-DS1",
    theme: "DS",
    applicability: "universal",
    chapter: "선택의 첫 단추",
    premise: "두 후보 모두 총액·취소 조건·접근성·참여 가능성 기준을 충족했고, 두 종류의 이야기를 모두 나눌 수 있어요.",
    scenario: "축하할 장소나 진행 방식 두 개를 마지막으로 비교하는 장면",
    prompt: "처음 꺼낼 이야기는 어느 쪽에 더 가까울까요?",
    responseMode: "bipolar-order",
    leftAnchor: "실제 진행 조건이 어떻게 다른지 먼저 이야기하기",
    rightAnchor: "원하는 축하 장면이 어떻게 다른지 먼저 이야기하기",
    evidence: evidence("S1", ["SRC-KCA-WEDDING-PRICE-2025-06", "SRC-PRODUCT-SCENARIO-LOG"], [
      "예산 압박",
      "이동 제약",
      "예식 형태",
    ]),
  },
  {
    ...hypothesisBase,
    id: "C6-DS2",
    theme: "DS",
    applicability: "recording",
    chapter: "선택의 첫 단추",
    premise: "기록을 남기고 싶고, 두 방법 모두 비용·사생활·보관 기준을 충족했어요.",
    scenario: "사진·영상·글 중 두 기록 방법을 마지막으로 비교하는 장면",
    prompt: "처음 꺼낼 이야기는 어느 쪽에 더 가까울까요?",
    responseMode: "bipolar-order",
    leftAnchor: "사용·보관 조건이 어떻게 다른지 먼저 이야기하기",
    rightAnchor: "남기고 싶은 기억의 모습이 어떻게 다른지 먼저 이야기하기",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], [
      "기록 자체에 대한 관심",
      "개인정보 우려",
      "매체 경험",
    ]),
  },
  {
    ...hypothesisBase,
    id: "C6-DS3",
    theme: "DS",
    applicability: "vendor-assisted",
    chapter: "선택의 첫 단추",
    premise: "두 도움 업체 모두 일정·총액·취소 조건 기준을 충족했어요.",
    scenario: "준비를 도와줄 두 업체를 마지막으로 비교하는 장면",
    prompt: "처음 꺼낼 이야기는 어느 쪽에 더 가까울까요?",
    responseMode: "bipolar-order",
    leftAnchor: "소통·진행 과정이 어떻게 다른지 먼저 이야기하기",
    rightAnchor: "원하는 결과의 모습이 어떻게 다른지 먼저 이야기하기",
    evidence: evidence("S1", ["SRC-KCA-WEDDING-PRICE-2025-06", "SRC-PRODUCT-SCENARIO-LOG"], [
      "업체 신뢰",
      "과거 피해 경험",
      "업체 이용 계획",
    ]),
  },
  {
    ...hypothesisBase,
    id: "C6-DS4",
    theme: "DS",
    applicability: "universal",
    chapter: "선택의 첫 단추",
    premise: "두 진행안 모두 시간·총액·접근성 기준을 충족했고, 어느 쪽도 안전 문제는 없어요.",
    scenario: "결혼을 알리거나 축하하는 진행안 두 개를 마지막으로 비교하는 장면",
    prompt: "처음 꺼낼 이야기는 어느 쪽에 더 가까울까요?",
    responseMode: "bipolar-order",
    leftAnchor: "준비·진행 조건이 어떻게 다른지 먼저 이야기하기",
    rightAnchor: "원하는 하루의 모습이 어떻게 다른지 먼저 이야기하기",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], [
      "행사 규모",
      "사회적 기대",
      "현재 준비 단계",
    ]),
  },
  {
    ...hypothesisBase,
    id: "C6-JI1",
    theme: "JI",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "두 사람 모두 잠깐 참여할 수 있고, 어느 방식도 일을 떠넘기지 않아요.",
    scenario: "후보를 처음 찾는 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "첫 후보 목록을 둘이 함께 만든다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "검색 숙련도",
      "함께 가능한 시간",
      "사회적 바람직성",
    ]),
  },
  {
    ...hypothesisBase,
    id: "C6-JI2",
    theme: "JI",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "두 사람 모두 최종 결정에 같은 권리가 있어요.",
    scenario: "후보를 마지막으로 비교하는 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "최종 비교를 둘이 함께 한다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "결정 중요도",
      "관심 차이",
      "책임 부담",
    ]),
  },
  {
    ...hypothesisBase,
    id: "C6-JI3",
    theme: "JI",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "급한 마감은 없고, 작은 일 하나를 고를 수 있어요.",
    scenario: "작은 준비 일이 쌓인 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "작은 준비 일 하나를 둘이 함께 끝낸다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "집중 방식",
      "현재 피로",
      "일의 종류",
    ]),
  },
  {
    ...hypothesisBase,
    id: "C6-OA1",
    theme: "OA",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "담당 범위와 완료 기준은 둘이 합의했어요.",
    scenario: "한 사람이 후보 찾기를 맡은 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "담당한 사람이 후보를 찾는 방법을 스스로 정한다.",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], ["신뢰", "검색 숙련도", "실수 비용"]),
  },
  {
    ...hypothesisBase,
    id: "C6-OA2",
    theme: "OA",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "담당 범위와 완료 기준은 둘이 합의했어요.",
    scenario: "한 사람이 자료 정리를 맡은 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "담당한 사람이 자료를 정리하는 방식을 스스로 정한다.",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], ["정보 문해력", "정리 도구", "공유 기대"]),
  },
  {
    ...hypothesisBase,
    id: "C6-OA3",
    theme: "OA",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "담당 범위와 완료 기준은 둘이 합의했어요.",
    scenario: "한 사람이 작은 준비 일을 맡은 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "담당한 사람이 일을 처리하는 순서를 스스로 정한다.",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], ["업무 난이도", "마감 위험", "개인 작업 습관"]),
  },
  {
    ...hypothesisBase,
    id: "C6-CP1",
    theme: "CP",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "담당과 완료 기준을 합의했고, 며칠에 걸쳐 진행하는 일이에요.",
    scenario: "맡은 일을 진행 중인 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "약속한 중간 시점에 진행 상태를 함께 확인한다.",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], ["불안 수준", "업무 가시성", "마감 위험"]),
  },
  {
    ...hypothesisBase,
    id: "C6-CP2",
    theme: "CP",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "담당자가 준비를 마쳤고, 아직 최종 확정 전이에요.",
    scenario: "결정 직전 확인하는 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "최종 확정 직전에 준비된 내용을 함께 확인한다.",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], ["결정 중요도", "수정 가능성", "책임 기대"]),
  },
  {
    ...hypothesisBase,
    id: "C6-CP3",
    theme: "CP",
    applicability: "partner-collaboration",
    chapter: "우리의 팀플",
    premise: "담당과 완료 기준을 합의했고, 문제가 생기면 바로 알릴 수 있어요.",
    scenario: "맡은 일을 진행 중인 장면",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "막힌 일이 생겼을 때 진행 상태를 함께 확인한다.",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], ["문제 심각도", "지원 가능성", "업무 전문성"]),
  },
  {
    ...hypothesisBase,
    ...SUPPORT_PAIR_A,
    id: "C6-ES1",
    theme: "ES",
    applicability: "partner-collaboration",
    chapter: "필요한 도움",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "상대가 지금 가장 부담스러운 점을 묻는다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "감정 강도",
      "대화 습관",
      "사회적 바람직성",
    ]),
  },
  {
    ...hypothesisBase,
    ...SUPPORT_PAIR_A,
    id: "C6-AS1",
    theme: "AS",
    applicability: "partner-collaboration",
    chapter: "필요한 도움",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "상대가 다음에 할 일 하나를 제안한다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "실행 기능",
      "업무 난이도",
      "시간 압박",
    ]),
  },
  {
    ...hypothesisBase,
    ...SUPPORT_PAIR_B,
    id: "C6-ES2",
    theme: "ES",
    applicability: "partner-collaboration",
    chapter: "필요한 도움",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "상대가 복잡하게 느끼는 마음을 인정해 준다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "의사결정 피로",
      "관계 규범",
      "현재 기분",
    ]),
  },
  {
    ...hypothesisBase,
    ...SUPPORT_PAIR_B,
    id: "C6-AS2",
    theme: "AS",
    applicability: "partner-collaboration",
    chapter: "필요한 도움",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "상대가 비교할 기준 하나를 제안한다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "정보 부족",
      "결정 책임",
      "기준 합의 정도",
    ]),
  },
  {
    ...hypothesisBase,
    ...SUPPORT_PAIR_C,
    id: "C6-ES3",
    theme: "ES",
    applicability: "partner-collaboration",
    chapter: "필요한 도움",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "상대가 아쉬운 마음을 들어준다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "손실 크기",
      "대안 매력도",
      "대화 선호",
    ]),
  },
  {
    ...hypothesisBase,
    ...SUPPORT_PAIR_C,
    id: "C6-AS3",
    theme: "AS",
    applicability: "partner-collaboration",
    chapter: "필요한 도움",
    prompt: "이 한 행동은 지금 나에게 어떤 영향을 줄까요?",
    responseMode: "balanced-impact",
    behavior: "상대가 대안을 찾는 첫 단계 하나를 제안한다.",
    evidence: evidence("S0", ["SRC-DYADIC-COPING-REVIEW-2019", "SRC-PRODUCT-SCENARIO-LOG"], [
      "현재 피로",
      "대안 가용성",
      "과제 명확성",
    ]),
  },
  {
    ...contextBase,
    id: "C6-SI1",
    theme: "SI",
    applicability: "stakeholder-context",
    chapter: "주변 의견 다루기",
    premise: "두 진행안 모두 안전·접근성·총액 기준을 충족했고, 같은 한 사람 또는 집단의 의견을 듣기로 합의했어요.",
    scenario: "축하 방식의 첫 초안을 만드는 장면",
    prompt: "첫 이야기는 어느 쪽에서 시작하면 편할까요?",
    responseMode: "bipolar-order",
    leftAnchor: "둘이 원하는 모습을 먼저 이야기하기",
    rightAnchor: "의견을 듣기로 한 사람들의 바람을 먼저 듣기",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], ["관계 권력", "경제적 지원", "문화 규범"]),
  },
  {
    ...contextBase,
    id: "C6-SI2",
    theme: "SI",
    applicability: "stakeholder-context",
    chapter: "주변 의견 다루기",
    premise: "두 진행안 모두 안전·접근성·총액 기준을 충족했고, 같은 한 사람 또는 집단의 의견을 듣기로 합의했어요.",
    scenario: "함께할 경험을 두 가지 중 고르는 장면",
    prompt: "첫 이야기는 어느 쪽에서 시작하면 편할까요?",
    responseMode: "bipolar-order",
    leftAnchor: "둘이 편하게 느낄 경험을 먼저 이야기하기",
    rightAnchor: "의견을 듣기로 한 사람들이 편하게 느낄 경험을 먼저 듣기",
    evidence: evidence("S0", ["SRC-PRODUCT-SCENARIO-LOG"], ["관계 거리", "참여 가능성", "문화 규범"]),
  },
] as const satisfies readonly Candidate6ResearchItem[];

export type Candidate6ItemId = (typeof CANDIDATE6_RESEARCH_ITEMS)[number]["id"];
export type Candidate6ResearchItemLiteral = (typeof CANDIDATE6_RESEARCH_ITEMS)[number];

export type Candidate6ItemEvidenceLink = Readonly<{
  source: Candidate6EvidenceSource;
  locator: string;
  supportedContextClaim: string;
  measurementLimitation: string;
}>;

function itemEvidenceLink(
  source: Candidate6EvidenceSource,
  locator: string,
  supportedContextClaim: string
): Candidate6ItemEvidenceLink {
  return {
    source,
    locator,
    supportedContextClaim,
    measurementLimitation:
      "This link supports scenario or concept elicitation only; it does not validate the item wording, theme, score, or person-level interpretation.",
  };
}

function internalDomainLink(locator: string, claim: string) {
  return itemEvidenceLink("SRC-PRODUCT-SCENARIO-LOG", locator, claim);
}

function dyadicConceptLink(claim: string) {
  return itemEvidenceLink(
    "SRC-DYADIC-COPING-REVIEW-2019",
    "Review discussion of common dyadic coping and emotion- versus problem-focused supportive dyadic coping",
    claim
  );
}

function weddingMarketLink(claim: string) {
  return itemEvidenceLink(
    "SRC-KCA-WEDDING-PRICE-2025-06",
    "2025-07-29 press release and attached June 2025 wedding-service price survey",
    claim
  );
}

export const CANDIDATE6_ITEM_EVIDENCE_LINKS = {
  "C6-DS1": [
    weddingMarketLink("Price and option variation make a criteria-comparison wedding-service scene plausible."),
    internalDomainLink(
      "§2 costRisk scenarios 4-9 and experienceMeaning scenarios 5-6",
      "The internal map proposes both condition/risk and desired-experience considerations for final comparisons."
    ),
  ],
  "C6-DS2": [
    internalDomainLink(
      "§2 experienceMeaning scenarios 2-3 and 9",
      "The internal map proposes photo/video and memory-retention decisions as candidate wedding contexts."
    ),
  ],
  "C6-DS3": [
    weddingMarketLink("Wedding-service option and price variation make a vendor-comparison scene plausible."),
    internalDomainLink(
      "§2 costRisk scenarios 6-9 and evidenceDecision vendor-comparison scenarios",
      "The internal map proposes vendor process, contract, and desired-result comparisons as design hypotheses."
    ),
  ],
  "C6-DS4": [
    internalDomainLink(
      "§2 experienceMeaning scenarios 6 and 11; aestheticMood scenarios 2 and 10",
      "The internal map only makes imagined-wedding fit, ceremony-content, venue-atmosphere, and couple-fit design contexts plausible; it does not establish the announcement/celebration wording or a DS construct."
    ),
  ],
  "C6-JI1": [
    dyadicConceptLink("Common dyadic coping makes joint participation a concept worth eliciting."),
    internalDomainLink(
      "§2 coPreparation scenarios 2, 4, and 6",
      "The internal map proposes shared vendor exploration and decisions as candidate contexts."
    ),
  ],
  "C6-JI2": [
    dyadicConceptLink("Common dyadic coping makes joint participation a concept worth eliciting."),
    internalDomainLink(
      "§2 coPreparation scenarios 3, 6, and 8",
      "The internal map proposes joint review of important final options as a candidate context."
    ),
  ],
  "C6-JI3": [
    dyadicConceptLink("Common dyadic coping makes completing a manageable task together worth eliciting."),
    internalDomainLink(
      "§2 coPreparation scenarios 5-6 and roleOwnership scenarios 5, 8",
      "The internal map proposes balancing shared preparation with explicit task ownership."
    ),
  ],
  "C6-OA1": [
    internalDomainLink(
      "§2 roleOwnership scenarios 1, 4, and 10",
      "The internal map proposes delegated candidate search under shared final approval."
    ),
  ],
  "C6-OA2": [
    internalDomainLink(
      "§2 roleOwnership scenarios 2, 5, and 8",
      "The internal map proposes clear ownership while leaving work method to the owner."
    ),
  ],
  "C6-OA3": [
    internalDomainLink(
      "§2 roleOwnership scenarios 5, 7, and 8",
      "The internal map proposes owner-led task sequencing as a coordination hypothesis."
    ),
  ],
  "C6-CP1": [
    internalDomainLink(
      "§2 coPreparation scenario 5 and roleOwnership scenarios 5, 8",
      "The internal map proposes agreed check-ins alongside task ownership."
    ),
  ],
  "C6-CP2": [
    internalDomainLink(
      "§2 roleOwnership scenarios 4 and 10",
      "The internal map proposes shared final review after delegated preparation."
    ),
  ],
  "C6-CP3": [
    internalDomainLink(
      "§2 roleOwnership scenarios 5 and 8",
      "The internal map makes blocked-work coordination plausible, but does not establish it as the same construct as scheduled checkpoints."
    ),
  ],
  "C6-ES1": [
    dyadicConceptLink("Emotion-focused supportive coping makes asking about burden a concept-elicitation candidate."),
    internalDomainLink(
      "§2 emotionalSupport scenarios and notes",
      "The internal map proposes emotional support needs while warning against stigmatizing labels."
    ),
  ],
  "C6-AS1": [
    dyadicConceptLink("Problem-focused supportive coping makes proposing a next action a concept-elicitation candidate."),
    internalDomainLink(
      "§2 executionSupport scenarios and notes",
      "The internal map proposes practical next-step support as a candidate context."
    ),
  ],
  "C6-ES2": [
    dyadicConceptLink("Emotion-focused supportive coping makes acknowledging complexity a concept-elicitation candidate."),
    internalDomainLink(
      "§2 emotionalSupport scenarios and notes",
      "The internal map proposes acknowledgment before action as a candidate support context."
    ),
  ],
  "C6-AS2": [
    dyadicConceptLink("Problem-focused supportive coping makes proposing a comparison criterion worth eliciting."),
    internalDomainLink(
      "§2 executionSupport and guidanceNeed scenarios",
      "The internal map proposes information compression and actionable criteria as candidate support contexts."
    ),
  ],
  "C6-ES3": [
    dyadicConceptLink("Emotion-focused supportive coping makes listening to disappointment worth eliciting."),
    internalDomainLink(
      "§2 emotionalSupport scenarios and notes",
      "The internal map proposes acknowledgment of disappointment as a candidate support context."
    ),
  ],
  "C6-AS3": [
    dyadicConceptLink("Problem-focused supportive coping makes proposing one search step worth eliciting."),
    internalDomainLink(
      "§2 executionSupport scenarios and notes",
      "The internal map proposes practical first-step support as a candidate context."
    ),
  ],
  "C6-SI1": [
    internalDomainLink(
      "§2 familyIntegration scenarios and coupleAutonomy scenarios 1-4",
      "The internal map proposes family input and couple autonomy as distinct contextual considerations."
    ),
  ],
  "C6-SI2": [
    internalDomainLink(
      "§2 familyIntegration scenarios and coupleAutonomy scenarios 5-8",
      "The internal map proposes discussing both couple comfort and invited stakeholder comfort."
    ),
  ],
} as const satisfies Record<Candidate6ItemId, readonly Candidate6ItemEvidenceLink[]>;

export const CANDIDATE6_ITEM_REVIEW_FLAGS = {
  "C6-CP3": "REWRITE_DROP_OR_CONTEXTUAL_BEFORE_QUANTITATIVE_PILOT",
  "C6-DS3": "DS_FACET_ALIGNMENT_REVIEW",
  "C6-DS4": "ANNOUNCEMENT_CELEBRATION_COMPREHENSION_REVIEW",
  "C6-ES1": "STRESS_COMMUNICATION_ALTERNATIVE_INTERPRETATION_REVIEW",
} as const satisfies Partial<Record<Candidate6ItemId, string>>;

export type Candidate6ResearchResponse =
  | Readonly<{ kind: "bipolar"; direction: Candidate6BipolarDirection }>
  | Readonly<{ kind: "impact"; level: Candidate6ImpactLevel }>
  | Readonly<{ kind: "escape"; value: Candidate6EscapeResponse }>;

export type Candidate6StakeholderApplicability = "applicable" | "not_applicable" | "unsure";

export type Candidate6LocalPrototypeState = Readonly<{
  exactVersion: typeof CANDIDATE6_RESEARCH_EXACT_VERSION;
  form: Candidate6Form;
  supportPairOrder: Candidate6SupportPairOrder;
  stakeholderApplicability: Candidate6StakeholderApplicability;
  responses: Partial<Record<Candidate6ItemId, Candidate6ResearchResponse>>;
}>;

export const CANDIDATE6_STAKEHOLDER_APPLICABILITY_CONTRACT = {
  applicable: "Administer the contextual SI block after every core item.",
  not_applicable: "Do not administer SI; retain as an explicit structural non-applicability response.",
  unsure: "Do not administer SI; retain separately as unresolved applicability, never merge or impute.",
} as const satisfies Record<Candidate6StakeholderApplicability, string>;

const CORE_ORDER = [
  "C6-DS1",
  "C6-JI1",
  "C6-ES1",
  "C6-OA1",
  "C6-AS1",
  "C6-CP1",
  "C6-DS2",
  "C6-JI2",
  "C6-ES2",
  "C6-OA2",
  "C6-AS2",
  "C6-CP2",
  "C6-DS3",
  "C6-JI3",
  "C6-ES3",
  "C6-OA3",
  "C6-AS3",
  "C6-CP3",
  "C6-DS4",
] as const satisfies readonly Candidate6ItemId[];

const SUPPORT_PAIR_COUNTERPART: Partial<Record<Candidate6ItemId, Candidate6ItemId>> = {
  "C6-ES1": "C6-AS1",
  "C6-AS1": "C6-ES1",
  "C6-ES2": "C6-AS2",
  "C6-AS2": "C6-ES2",
  "C6-ES3": "C6-AS3",
  "C6-AS3": "C6-ES3",
};

function itemById(itemId: Candidate6ItemId): Candidate6ResearchItemLiteral {
  const item = CANDIDATE6_RESEARCH_ITEMS.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Unknown Candidate 6 item: ${itemId}`);
  return item;
}

function orderSupportPairs(
  itemIds: readonly Candidate6ItemId[],
  supportPairOrder: Candidate6SupportPairOrder
): readonly Candidate6ItemId[] {
  if (supportPairOrder === "ES_FIRST") return itemIds;
  return itemIds.map((itemId) => SUPPORT_PAIR_COUNTERPART[itemId] ?? itemId);
}

/**
 * Form changes endpoint orientation only. Support-pair order is a separate
 * counterbalance factor, and the contextual SI block always follows the core.
 */
export function buildCandidate6Journey(
  _form: Candidate6Form,
  stakeholderApplicability: Candidate6StakeholderApplicability,
  supportPairOrder: Candidate6SupportPairOrder = "ES_FIRST"
) {
  const core = orderSupportPairs(CORE_ORDER, supportPairOrder).map(itemById);
  if (stakeholderApplicability !== "applicable") return core;

  return [...core, itemById("C6-SI1"), itemById("C6-SI2")];
}

export const CANDIDATE6_INTERVIEW_PANELS = {
  P1: ["C6-DS1", "C6-JI1", "C6-OA1", "C6-CP1", "C6-ES1", "C6-AS1", "C6-DS4", "C6-OA3"],
  P2: ["C6-DS2", "C6-JI2", "C6-OA2", "C6-CP2", "C6-ES2", "C6-AS2", "C6-DS3", "C6-JI3"],
  P3: ["C6-DS3", "C6-JI3", "C6-OA3", "C6-CP3", "C6-ES3", "C6-AS3", "C6-DS4", "C6-JI1"],
} as const satisfies Record<string, readonly Candidate6ItemId[]>;

export type Candidate6InterviewPanel = keyof typeof CANDIDATE6_INTERVIEW_PANELS;
export type Candidate6InterviewSubstitution = Readonly<{
  originalItemId: Candidate6ItemId;
  replacementItemId: Candidate6ItemId;
  originalEligibility: Exclude<Candidate6EligibilityStatus, "eligible">;
  rule: "SAME_THEME_ELIGIBLE_NOT_ALREADY_ASSIGNED";
}>;
export type Candidate6InterviewUnresolvedItem = Readonly<{
  itemId: Candidate6ItemId;
  eligibility: Exclude<Candidate6EligibilityStatus, "eligible">;
  reason: "NO_ELIGIBLE_SAME_THEME_SUBSTITUTE";
}>;

type Candidate6InterviewLineage = Readonly<{
  requestedItemId: Candidate6ItemId;
  itemId: Candidate6ItemId;
  replacementItemId: Candidate6ItemId | null;
  originalEligibility: Candidate6EligibilityStatus;
}>;

export const CANDIDATE6_INTERVIEW_ELIGIBILITY_SCREENER = {
  recording: {
    prompt: "결혼식 사진·영상 등 기록 옵션을 실제로 비교하거나 결정했거나, 곧 결정할 예정인가요?",
    eligibleWhen: "구체적인 기록 옵션 선택 장면을 실제 경험 또는 확정된 준비 계획에서 떠올릴 수 있음.",
    notApplicableWhen: "사진·영상 등 기록물을 만들거나 관련 옵션을 결정할 계획이 없음.",
    unsureWhen: "기록 계획이 정해지지 않아 선택 장면의 적용 여부를 아직 판단할 수 없음.",
  },
  "vendor-assisted": {
    prompt: "웨딩 업체나 플래너를 비교·계약·이용했거나, 곧 결정할 예정인가요?",
    eligibleWhen: "구체적인 업체 또는 플래너 비교·계약·이용 장면을 떠올릴 수 있음.",
    notApplicableWhen: "업체나 플래너를 이용하거나 비교할 계획이 없음.",
    unsureWhen: "업체 이용 계획이 정해지지 않아 적용 여부를 아직 판단할 수 없음.",
  },
  "partner-collaboration": {
    prompt: "파트너와 결혼 준비의 결정·역할·도움 방식을 실제로 조율했거나, 곧 조율할 예정인가요?",
    eligibleWhen: "파트너와의 구체적인 준비 결정·역할·지원 대화 장면을 떠올릴 수 있음.",
    notApplicableWhen: "파트너와 결혼 준비 결정이나 역할·지원 조율을 하지 않는 구조임.",
    unsureWhen: "함께 준비할 방식이 정해지지 않아 적용 여부를 아직 판단할 수 없음.",
  },
} as const satisfies Record<
  Candidate6CoreConditionalApplicability,
  Readonly<{
    prompt: string;
    eligibleWhen: string;
    notApplicableWhen: string;
    unsureWhen: string;
  }>
>;

const INTERVIEW_PANEL_CONTEXT_ITEMS = {
  P1: ["C6-SI1"],
  P2: ["C6-SI2"],
  P3: ["C6-SI1", "C6-SI2"],
} as const satisfies Record<Candidate6InterviewPanel, readonly Candidate6ItemId[]>;

function coreEligibility(
  item: Candidate6ResearchItemLiteral,
  eligibility: Candidate6InterviewEligibility
): Candidate6EligibilityStatus {
  if (item.applicability === "universal") return "eligible";
  if (item.applicability === "stakeholder-context") {
    throw new Error("Stakeholder items are gated separately after every core item.");
  }
  return eligibility[item.applicability];
}

const CANDIDATE6_ASSIGNMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE6_FORM_VALUES = new Set<Candidate6Form>(["A", "B"]);
const CANDIDATE6_SUPPORT_ORDER_VALUES = new Set<Candidate6SupportPairOrder>([
  "ES_FIRST",
  "AS_FIRST",
]);
const CANDIDATE6_STAKEHOLDER_VALUES = new Set<Candidate6StakeholderApplicability>([
  "applicable",
  "not_applicable",
  "unsure",
]);
const CANDIDATE6_ELIGIBILITY_VALUES = new Set<Candidate6EligibilityStatus>([
  "eligible",
  "not_applicable",
  "unsure",
]);
const CANDIDATE6_RESPONSE_DISPOSITIONS = new Set<Candidate6InterviewResponseDisposition>([
  "not_administered",
  "answered",
  ...CANDIDATE6_ESCAPE_RESPONSES.map((response) => response.value),
]);

function assertCandidate6AssignmentId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !CANDIDATE6_ASSIGNMENT_ID_PATTERN.test(value)) {
    throw new Error("Candidate 6 assignmentId must be an opaque RFC 4122 UUID.");
  }
}

function assertCandidate6EligibilitySnapshot(
  value: unknown
): asserts value is Candidate6InterviewEligibility {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Candidate 6 eligibility must be a complete screener snapshot.");
  }
  const snapshot = value as Record<string, unknown>;
  for (const key of ["recording", "vendor-assisted", "partner-collaboration"] as const) {
    if (!CANDIDATE6_ELIGIBILITY_VALUES.has(snapshot[key] as Candidate6EligibilityStatus)) {
      throw new Error(`Candidate 6 eligibility.${key} is invalid.`);
    }
  }
}

export type Candidate6InterviewAssignmentRequest = Readonly<{
  assignmentId: string;
  form: Candidate6Form;
  rotationIndex: number;
  panel: Candidate6InterviewPanel;
  eligibility: Candidate6InterviewEligibility;
  stakeholderApplicability: Candidate6StakeholderApplicability;
  supportPairOrder: Candidate6SupportPairOrder;
}>;

function assertCandidate6AssignmentRequest(
  request: Candidate6InterviewAssignmentRequest
): void {
  assertCandidate6AssignmentId(request.assignmentId);
  if (!CANDIDATE6_FORM_VALUES.has(request.form)) {
    throw new Error("Candidate 6 form must be A or B.");
  }
  if (!Number.isSafeInteger(request.rotationIndex) || request.rotationIndex < 0) {
    throw new Error("Candidate 6 rotationIndex must be a non-negative safe integer.");
  }
  if (!Object.prototype.hasOwnProperty.call(CANDIDATE6_INTERVIEW_PANELS, request.panel)) {
    throw new Error("Candidate 6 panel is invalid.");
  }
  assertCandidate6EligibilitySnapshot(request.eligibility);
  if (!CANDIDATE6_STAKEHOLDER_VALUES.has(request.stakeholderApplicability)) {
    throw new Error("Candidate 6 stakeholderApplicability is invalid.");
  }
  if (!CANDIDATE6_SUPPORT_ORDER_VALUES.has(request.supportPairOrder)) {
    throw new Error("Candidate 6 supportPairOrder is invalid.");
  }
}

/**
 * Plans a facilitated 8-10 item cognitive interview. An incompatible plan has
 * no administrable items so a facilitator cannot silently run an ineligible
 * fixed panel. The full journey remains a UI stress preview only.
 */
export function planCandidate6InterviewAssignment(
  request: Candidate6InterviewAssignmentRequest
) {
  assertCandidate6AssignmentRequest(request);

  const requestedCoreItemIds = orderSupportPairs(
    CANDIDATE6_INTERVIEW_PANELS[request.panel],
    request.supportPairOrder
  );
  const reservedItemIds = new Set<Candidate6ItemId>(requestedCoreItemIds);
  const coreItems: Candidate6ResearchItemLiteral[] = [];
  const coreLineage: Candidate6InterviewLineage[] = [];
  const substitutions: Candidate6InterviewSubstitution[] = [];
  const unresolved: Candidate6InterviewUnresolvedItem[] = [];

  for (const requestedItemId of requestedCoreItemIds) {
    const requestedItem = itemById(requestedItemId);
    const eligibility = coreEligibility(requestedItem, request.eligibility);
    if (eligibility === "eligible") {
      coreItems.push(requestedItem);
      coreLineage.push({
        requestedItemId: requestedItem.id,
        itemId: requestedItem.id,
        replacementItemId: null,
        originalEligibility: eligibility,
      });
      continue;
    }

    const replacementCandidates = CANDIDATE6_RESEARCH_ITEMS.filter(
      (candidate) =>
        candidate.module === "core" &&
        candidate.theme === requestedItem.theme &&
        !reservedItemIds.has(candidate.id) &&
        coreEligibility(candidate, request.eligibility) === "eligible"
    ).sort((left, right) => left.id.localeCompare(right.id, "en"));
    const replacement =
      replacementCandidates.length === 0
        ? undefined
        : replacementCandidates[request.rotationIndex % replacementCandidates.length];
    if (!replacement) {
      unresolved.push({
        itemId: requestedItem.id,
        eligibility,
        reason: "NO_ELIGIBLE_SAME_THEME_SUBSTITUTE",
      });
      continue;
    }

    reservedItemIds.add(replacement.id);
    coreItems.push(replacement);
    coreLineage.push({
      requestedItemId: requestedItem.id,
      itemId: replacement.id,
      replacementItemId: replacement.id,
      originalEligibility: eligibility,
    });
    substitutions.push({
      originalItemId: requestedItem.id,
      replacementItemId: replacement.id,
      originalEligibility: eligibility,
      rule: "SAME_THEME_ELIGIBLE_NOT_ALREADY_ASSIGNED",
    });
  }

  if (unresolved.length > 0) {
    return {
      status: "incompatible" as const,
      assignmentId: request.assignmentId,
      exactVersion: CANDIDATE6_RESEARCH_EXACT_VERSION,
      form: request.form,
      supportPairOrder: request.supportPairOrder,
      rotationIndex: request.rotationIndex,
      panel: request.panel,
      eligibilitySnapshot: { ...request.eligibility },
      stakeholderApplicability: request.stakeholderApplicability,
      requestedCoreItemIds,
      coreItems: [] as Candidate6ResearchItemLiteral[],
      contextItems: [] as Candidate6ResearchItemLiteral[],
      items: [] as Candidate6ResearchItemLiteral[],
      substitutions,
      unresolved,
      trackingTemplate: [] as Candidate6InterviewTrackingRow[],
    };
  }

  const contextItems =
    request.stakeholderApplicability === "applicable"
      ? INTERVIEW_PANEL_CONTEXT_ITEMS[request.panel].map(itemById)
      : [];
  const items = [...coreItems, ...contextItems];
  const lineage = [
    ...coreLineage,
    ...contextItems.map((item) => ({
      requestedItemId: item.id,
      itemId: item.id,
      replacementItemId: null,
      originalEligibility: "eligible" as const,
    })),
  ];
  return {
    status: "ready" as const,
    assignmentId: request.assignmentId,
    exactVersion: CANDIDATE6_RESEARCH_EXACT_VERSION,
    form: request.form,
    supportPairOrder: request.supportPairOrder,
    rotationIndex: request.rotationIndex,
    panel: request.panel,
    eligibilitySnapshot: { ...request.eligibility },
    stakeholderApplicability: request.stakeholderApplicability,
    requestedCoreItemIds,
    coreItems,
    contextItems,
    items,
    substitutions,
    unresolved: [],
    trackingTemplate: lineage.map((entry) => ({
      assignmentId: request.assignmentId,
      exactVersion: CANDIDATE6_RESEARCH_EXACT_VERSION,
      form: request.form,
      supportPairOrder: request.supportPairOrder,
      rotationIndex: request.rotationIndex,
      panel: request.panel,
      eligibilitySnapshot: { ...request.eligibility },
      stakeholderApplicability: request.stakeholderApplicability,
      requestedItemId: entry.requestedItemId,
      itemId: entry.itemId,
      replacementItemId: entry.replacementItemId,
      originalEligibility: entry.originalEligibility,
      assigned: true,
      administered: false,
      eligibilityAtAssignment: "eligible" as const,
      responseDisposition: "not_administered" as const,
    })),
  };
}

export type Candidate6ReadyInterviewAssignment = Extract<
  ReturnType<typeof planCandidate6InterviewAssignment>,
  { status: "ready" }
>;

export type Candidate6InterviewResponseDisposition =
  | "not_administered"
  | "answered"
  | Candidate6EscapeResponse;

export type Candidate6InterviewTrackingRow = Readonly<{
  assignmentId: string;
  exactVersion: typeof CANDIDATE6_RESEARCH_EXACT_VERSION;
  form: Candidate6Form;
  supportPairOrder: Candidate6SupportPairOrder;
  rotationIndex: number;
  panel: Candidate6InterviewPanel;
  eligibilitySnapshot: Candidate6InterviewEligibility;
  stakeholderApplicability: Candidate6StakeholderApplicability;
  requestedItemId: Candidate6ItemId;
  itemId: Candidate6ItemId;
  replacementItemId: Candidate6ItemId | null;
  originalEligibility: Candidate6EligibilityStatus;
  assigned: boolean;
  administered: boolean;
  eligibilityAtAssignment: Candidate6EligibilityStatus;
  responseDisposition: Candidate6InterviewResponseDisposition;
}>;

export type Candidate6InterviewItemCounts = Readonly<{
  requested: number;
  requestedEligible: number;
  requestedNotApplicable: number;
  requestedUnsure: number;
  assigned: number;
  administered: number;
  eligible: number;
  notApplicable: number;
}>;

function trackingEligibility(
  item: Candidate6ResearchItemLiteral,
  snapshot: Candidate6InterviewEligibility,
  stakeholderApplicability: Candidate6StakeholderApplicability
): Candidate6EligibilityStatus {
  if (item.applicability === "universal") return "eligible";
  if (item.applicability === "stakeholder-context") {
    return stakeholderApplicability === "applicable"
      ? "eligible"
      : stakeholderApplicability;
  }
  return snapshot[item.applicability];
}

function validateCandidate6TrackingRow(
  row: Candidate6InterviewTrackingRow,
  rowIndex: number
): void {
  assertCandidate6AssignmentId(row.assignmentId);
  if (row.exactVersion !== CANDIDATE6_RESEARCH_EXACT_VERSION) {
    throw new Error(`Candidate 6 row ${rowIndex} has an unsupported exactVersion.`);
  }
  if (!CANDIDATE6_FORM_VALUES.has(row.form)) {
    throw new Error(`Candidate 6 row ${rowIndex} has an invalid form.`);
  }
  if (!CANDIDATE6_SUPPORT_ORDER_VALUES.has(row.supportPairOrder)) {
    throw new Error(`Candidate 6 row ${rowIndex} has an invalid supportPairOrder.`);
  }
  if (!Number.isSafeInteger(row.rotationIndex) || row.rotationIndex < 0) {
    throw new Error(`Candidate 6 row ${rowIndex} has an invalid rotationIndex.`);
  }
  if (!Object.prototype.hasOwnProperty.call(CANDIDATE6_INTERVIEW_PANELS, row.panel)) {
    throw new Error(`Candidate 6 row ${rowIndex} has an invalid panel.`);
  }
  assertCandidate6EligibilitySnapshot(row.eligibilitySnapshot);
  if (!CANDIDATE6_STAKEHOLDER_VALUES.has(row.stakeholderApplicability)) {
    throw new Error(`Candidate 6 row ${rowIndex} has invalid stakeholder applicability.`);
  }
  if (!CANDIDATE6_ELIGIBILITY_VALUES.has(row.originalEligibility)) {
    throw new Error(`Candidate 6 row ${rowIndex} has invalid original eligibility.`);
  }
  if (!CANDIDATE6_ELIGIBILITY_VALUES.has(row.eligibilityAtAssignment)) {
    throw new Error(`Candidate 6 row ${rowIndex} has invalid assignment eligibility.`);
  }
  if (!CANDIDATE6_RESPONSE_DISPOSITIONS.has(row.responseDisposition)) {
    throw new Error(`Candidate 6 row ${rowIndex} has an invalid response disposition.`);
  }
  if (typeof row.assigned !== "boolean" || typeof row.administered !== "boolean") {
    throw new Error(`Candidate 6 row ${rowIndex} has invalid assignment flags.`);
  }

  const requestedItem = itemById(row.requestedItemId);
  const assignedItem = itemById(row.itemId);
  const allowedRequestedItems = new Set<Candidate6ItemId>([
    ...orderSupportPairs(CANDIDATE6_INTERVIEW_PANELS[row.panel], row.supportPairOrder),
    ...(row.stakeholderApplicability === "applicable"
      ? INTERVIEW_PANEL_CONTEXT_ITEMS[row.panel]
      : []),
  ]);
  if (!allowedRequestedItems.has(row.requestedItemId)) {
    throw new Error(`${row.requestedItemId} is not part of the recorded Candidate 6 panel.`);
  }

  const expectedOriginalEligibility = trackingEligibility(
    requestedItem,
    row.eligibilitySnapshot,
    row.stakeholderApplicability,
  );
  const expectedAssignedEligibility = trackingEligibility(
    assignedItem,
    row.eligibilitySnapshot,
    row.stakeholderApplicability,
  );
  if (row.originalEligibility !== expectedOriginalEligibility) {
    throw new Error(`${row.requestedItemId} original eligibility does not match the screener.`);
  }
  if (row.eligibilityAtAssignment !== expectedAssignedEligibility) {
    throw new Error(`${row.itemId} assignment eligibility does not match the screener.`);
  }

  if (row.replacementItemId === null) {
    if (row.itemId !== row.requestedItemId) {
      throw new Error(`${row.itemId} is missing its replacement lineage.`);
    }
  } else if (
    row.replacementItemId !== row.itemId
    || row.itemId === row.requestedItemId
    || row.originalEligibility === "eligible"
    || requestedItem.theme !== assignedItem.theme
  ) {
    throw new Error(`${row.itemId} has invalid same-theme replacement lineage.`);
  }
  if (row.assigned && row.eligibilityAtAssignment !== "eligible") {
    throw new Error(`${row.itemId} cannot be assigned while ineligible or unresolved.`);
  }
  if (row.assigned) {
    const expectedPlan = planCandidate6InterviewAssignment({
      assignmentId: row.assignmentId,
      form: row.form,
      rotationIndex: row.rotationIndex,
      panel: row.panel,
      eligibility: row.eligibilitySnapshot,
      stakeholderApplicability: row.stakeholderApplicability,
      supportPairOrder: row.supportPairOrder,
    });
    const expectedRow = expectedPlan.status === "ready"
      ? expectedPlan.trackingTemplate.find(
          (candidate) => candidate.requestedItemId === row.requestedItemId,
        )
      : undefined;
    if (
      !expectedRow
      || expectedRow.itemId !== row.itemId
      || expectedRow.replacementItemId !== row.replacementItemId
      || expectedRow.originalEligibility !== row.originalEligibility
    ) {
      throw new Error(`${row.itemId} does not match the deterministic Candidate 6 assignment plan.`);
    }
  }
}

export function summarizeCandidate6InterviewTracking(
  rows: readonly Candidate6InterviewTrackingRow[],
  expectedAssignments: readonly Candidate6ReadyInterviewAssignment[]
): Record<Candidate6ItemId, Candidate6InterviewItemCounts> {
  const counts = Object.fromEntries(
    CANDIDATE6_RESEARCH_ITEMS.map((item) => [
      item.id,
      {
        requested: 0,
        requestedEligible: 0,
        requestedNotApplicable: 0,
        requestedUnsure: 0,
        assigned: 0,
        administered: 0,
        eligible: 0,
        notApplicable: 0,
      },
    ])
  ) as Record<Candidate6ItemId, Candidate6InterviewItemCounts>;

  const rowKeys = new Set<string>();
  const requestedRowKeys = new Set<string>();
  const assignmentMetadata = new Map<string, string>();
  const expectedRowsByAssignment = new Map<
    string,
    Map<Candidate6ItemId, Candidate6InterviewTrackingRow>
  >();
  const seenRequestedItemsByAssignment = new Map<string, Set<Candidate6ItemId>>();

  for (const assignment of expectedAssignments) {
    if (assignment.status !== "ready") {
      throw new Error("Candidate 6 summary manifest contains a non-ready assignment.");
    }
    if (expectedRowsByAssignment.has(assignment.assignmentId)) {
      throw new Error(
        `Duplicate Candidate 6 summary assignment: ${assignment.assignmentId}.`
      );
    }
    const canonicalAssignment = planCandidate6InterviewAssignment({
      assignmentId: assignment.assignmentId,
      form: assignment.form,
      rotationIndex: assignment.rotationIndex,
      panel: assignment.panel,
      eligibility: assignment.eligibilitySnapshot,
      stakeholderApplicability: assignment.stakeholderApplicability,
      supportPairOrder: assignment.supportPairOrder,
    });
    if (canonicalAssignment.status !== "ready") {
      throw new Error(
        `Candidate 6 summary assignment ${assignment.assignmentId} is no longer compatible.`
      );
    }
    const expectedRows = new Map(
      canonicalAssignment.trackingTemplate.map((row) => [row.requestedItemId, row])
    );
    if (
      expectedRows.size !== assignment.trackingTemplate.length
      || assignment.trackingTemplate.some((row) => {
        const expected = expectedRows.get(row.requestedItemId);
        return !expected
          || expected.itemId !== row.itemId
          || expected.replacementItemId !== row.replacementItemId
          || expected.originalEligibility !== row.originalEligibility;
      })
    ) {
      throw new Error(
        `Candidate 6 summary assignment ${assignment.assignmentId} has a non-canonical manifest.`
      );
    }
    expectedRowsByAssignment.set(assignment.assignmentId, expectedRows);
    seenRequestedItemsByAssignment.set(assignment.assignmentId, new Set());
  }

  if (rows.length > 0 && expectedRowsByAssignment.size === 0) {
    throw new Error("Candidate 6 summary requires an expected assignment manifest.");
  }

  for (const [rowIndex, row] of rows.entries()) {
    validateCandidate6TrackingRow(row, rowIndex);
    const expectedRows = expectedRowsByAssignment.get(row.assignmentId);
    const expectedRow = expectedRows?.get(row.requestedItemId);
    if (!expectedRows || !expectedRow) {
      throw new Error(
        `Unexpected Candidate 6 assignment or requested item: ${row.assignmentId}:${row.requestedItemId}.`
      );
    }
    if (
      expectedRow.itemId !== row.itemId
      || expectedRow.replacementItemId !== row.replacementItemId
      || expectedRow.originalEligibility !== row.originalEligibility
    ) {
      throw new Error(`${row.itemId} does not match the expected Candidate 6 summary manifest.`);
    }
    const rowKey = `${row.exactVersion}:${row.assignmentId}:${row.itemId}`;
    if (rowKeys.has(rowKey)) {
      throw new Error(`Duplicate Candidate 6 tracking row: ${rowKey}.`);
    }
    rowKeys.add(rowKey);
    const requestedRowKey = `${row.exactVersion}:${row.assignmentId}:${row.requestedItemId}`;
    if (requestedRowKeys.has(requestedRowKey)) {
      throw new Error(`Duplicate Candidate 6 requested-item row: ${requestedRowKey}.`);
    }
    requestedRowKeys.add(requestedRowKey);
    seenRequestedItemsByAssignment.get(row.assignmentId)?.add(row.requestedItemId);

    const metadata = JSON.stringify([
      row.exactVersion,
      row.form,
      row.supportPairOrder,
      row.rotationIndex,
      row.panel,
      row.stakeholderApplicability,
      row.eligibilitySnapshot.recording,
      row.eligibilitySnapshot["vendor-assisted"],
      row.eligibilitySnapshot["partner-collaboration"],
    ]);
    const existingMetadata = assignmentMetadata.get(row.assignmentId);
    if (existingMetadata !== undefined && existingMetadata !== metadata) {
      throw new Error(`Candidate 6 assignment ${row.assignmentId} mixes incompatible metadata.`);
    }
    assignmentMetadata.set(row.assignmentId, metadata);

    if (row.administered && !row.assigned) {
      throw new Error(`${row.itemId} cannot be administered before assignment.`);
    }
    if (row.administered && row.responseDisposition === "not_administered") {
      throw new Error(`${row.itemId} needs a response disposition after administration.`);
    }
    if (!row.administered && row.responseDisposition !== "not_administered") {
      throw new Error(`${row.itemId} cannot have a response before administration.`);
    }

    const requested = counts[row.requestedItemId];
    counts[row.requestedItemId] = {
      ...requested,
      requested: requested.requested + 1,
      requestedEligible:
        requested.requestedEligible + Number(row.originalEligibility === "eligible"),
      requestedNotApplicable:
        requested.requestedNotApplicable
        + Number(row.originalEligibility === "not_applicable"),
      requestedUnsure:
        requested.requestedUnsure + Number(row.originalEligibility === "unsure"),
    };

    if (!row.assigned) continue;
    const current = counts[row.itemId];
    counts[row.itemId] = {
      ...current,
      assigned: current.assigned + 1,
      administered: current.administered + Number(row.administered),
      eligible: current.eligible + Number(row.eligibilityAtAssignment === "eligible"),
      notApplicable:
        current.notApplicable + Number(row.responseDisposition === "not_applicable"),
    };
  }

  for (const [assignmentId, expectedRows] of expectedRowsByAssignment) {
    const seenRequestedItems = seenRequestedItemsByAssignment.get(assignmentId);
    if (
      !seenRequestedItems
      || seenRequestedItems.size !== expectedRows.size
      || [...expectedRows.keys()].some((itemId) => !seenRequestedItems.has(itemId))
    ) {
      throw new Error(
        `Candidate 6 assignment ${assignmentId} has an incomplete tracking ledger.`
      );
    }
  }

  return counts;
}

/**
 * Counterbalances only which semantic endpoint is drawn first. This is a
 * prototype position-bias fence, not an approved randomization or score rule.
 */
export function isCandidate6BipolarVisuallyReversed(
  form: Candidate6Form,
  itemId: Candidate6ItemId
): boolean {
  const bipolarItems = CANDIDATE6_RESEARCH_ITEMS.filter(
    (item) => item.responseMode === "bipolar-order"
  );
  const ordinal = bipolarItems.findIndex((item) => item.id === itemId);
  if (ordinal < 0) throw new Error(`Candidate 6 item is not bipolar: ${itemId}`);
  return (ordinal % 2 === 1) !== (form === "B");
}

export function normalizeCandidate6BipolarVisualChoice(
  form: Candidate6Form,
  itemId: Candidate6ItemId,
  visualDirection: Candidate6BipolarDirection
): Candidate6ResearchResponse {
  return {
    kind: "bipolar",
    direction: isCandidate6BipolarVisuallyReversed(form, itemId)
      ? ((visualDirection * -1) as Candidate6BipolarDirection)
      : visualDirection,
  };
}

export const CANDIDATE6_NEUTRAL_CONVERSATION_CARDS = [
  {
    id: "compare-start",
    title: "선택의 첫 단추",
    prompt: "이번 선택은 조건부터 맞춰볼까, 원하는 장면부터 이야기해볼까?",
    action: "후보 하나를 정해 두 순서를 각각 써보고 더 편한 시작점을 고르기",
  },
  {
    id: "team-up",
    title: "우리의 팀플",
    prompt: "이번 주 일 하나는 같이 볼 부분과 맡길 부분을 어떻게 나눌까?",
    action: "담당, 함께 확인할 때, 끝났다고 볼 기준을 한 줄씩 적기",
  },
  {
    id: "support-start",
    title: "필요한 도움",
    prompt: "지금은 마음을 먼저 알아주는 것과 다음 행동을 정하는 것 중 뭐가 더 필요해?",
    action: "지금 더 필요한 도움을 한 가지 고르고, 상대가 추측하지 않게 직접 말하기",
  },
] as const;

export type Candidate6NeutralConversationCardId =
  (typeof CANDIDATE6_NEUTRAL_CONVERSATION_CARDS)[number]["id"];
