export type ContractShieldCategory =
  | "venue"
  | "sdm_package"
  | "studio"
  | "dress"
  | "makeup"
  | "snap"
  | "other";

export type ContractEvidenceType =
  | "quote"
  | "contract"
  | "deposit"
  | "message_capture"
  | "receipt"
  | "schedule"
  | "vendor_policy";

export type ContractRiskLevel = "low" | "medium" | "high";
export type ContractClauseSeverity = "critical" | "high" | "medium";

export interface ContractShieldInput {
  category: ContractShieldCategory;
  vendorName?: string;
  contractAmountManwon?: number;
  depositAmountManwon?: number;
  hasWrittenContract?: boolean;
  usesStandardContract?: boolean;
  includedItems?: string[];
  checkedClauseIds?: string[];
  missingClauseIds?: string[];
  evidenceTypes?: ContractEvidenceType[];
  oralPromises?: string[];
  cancellationPolicyText?: string;
  changePolicyText?: string;
  paymentScheduleText?: string;
  extraFeePolicyText?: string;
  memo?: string;
}

export interface ContractClauseCheck {
  id: string;
  label: string;
  severity: ContractClauseSeverity;
  reason: string;
  question: string;
}

export interface ContractShieldResult {
  mode: "analysis";
  category: ContractShieldCategory;
  categoryLabel: string;
  vendorName: string | null;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  riskLevel: ContractRiskLevel;
  riskLabel: string;
  summaryTitle: string;
  summaryText: string;
  blockers: ContractClauseCheck[];
  warnings: ContractClauseCheck[];
  confirmed: Array<{ id: string; label: string }>;
  vendorQuestions: string[];
  evidenceToSave: string[];
  clausesToRequest: string[];
  messageToVendor: string;
  sourceNote: string;
  disclaimer: string;
}

const CATEGORY_LABELS: Record<ContractShieldCategory, string> = {
  venue: "예식장",
  sdm_package: "스드메 패키지",
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  snap: "본식 스냅/영상",
  other: "기타 계약",
};

type ClauseScope = ContractShieldCategory | "all";

interface ClauseRule {
  id: string;
  label: string;
  severity: ContractClauseSeverity;
  scopes: ClauseScope[];
  reason: string;
  question: string;
  evidence: ContractEvidenceType[];
  hints: RegExp[];
}

const CLAUSES: ClauseRule[] = [
  {
    id: "written_contract",
    label: "계약서 또는 확정 견적서",
    severity: "critical",
    scopes: ["all"],
    reason: "말로 들은 조건만 있으면 포함 범위와 환불 기준을 나중에 증명하기 어렵습니다.",
    question: "계약서나 확정 견적서에 최종 금액과 포함 항목이 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/계약서|확정\s*견적|견적서|서면|문서/],
  },
  {
    id: "total_amount",
    label: "총액과 별도 비용",
    severity: "critical",
    scopes: ["all"],
    reason: "총액과 별도 비용을 분리하지 않으면 계약 후 추가금이 붙어도 비교가 어렵습니다.",
    question: "총액, 필수 추가금, 선택 옵션이 한 줄씩 분리되어 있나요?",
    evidence: ["quote", "contract"],
    hints: [/총액|총\s*금액|최종\s*금액|별도|추가금|옵션/],
  },
  {
    id: "payment_schedule",
    label: "계약금·잔금·결제일",
    severity: "critical",
    scopes: ["all"],
    reason: "계약금과 잔금 기준일이 없으면 취소나 변경 시 금액 다툼이 생기기 쉽습니다.",
    question: "계약금, 중도금, 잔금 금액과 결제일이 적혀 있나요?",
    evidence: ["contract", "deposit", "receipt"],
    hints: [/계약금|예약금|잔금|중도금|입금|결제일|납부/],
  },
  {
    id: "cancellation_refund",
    label: "취소·환불·위약금 기준",
    severity: "critical",
    scopes: ["all"],
    reason: "가장 많이 분쟁이 생기는 부분이라 날짜별 환불 기준이 문서로 있어야 합니다.",
    question: "취소일 기준으로 환불 금액과 위약금 계산 방식이 적혀 있나요?",
    evidence: ["contract", "vendor_policy"],
    hints: [/취소|환불|위약금|해약|해지|청약철회/],
  },
  {
    id: "change_policy",
    label: "날짜·시간·인원 변경 기준",
    severity: "high",
    scopes: ["all"],
    reason: "결혼 준비에서는 날짜, 시간, 인원 변경이 자주 생깁니다. 기준일이 없으면 비용이 갑자기 바뀔 수 있습니다.",
    question: "날짜, 시간, 인원, 담당자 변경 시 비용이 언제부터 달라지는지 적혀 있나요?",
    evidence: ["contract", "vendor_policy", "schedule"],
    hints: [/변경|연기|날짜|시간|인원|담당자|스태프/],
  },
  {
    id: "oral_promises_written",
    label: "구두 약속의 문서화",
    severity: "critical",
    scopes: ["all"],
    reason: "서비스 추가, 할인, 무료 제공은 문서나 메시지에 남아야 실제로 지킬 수 있습니다.",
    question: "상담 때 들은 무료 제공·할인·서비스 조건이 문자나 계약서에 그대로 남아 있나요?",
    evidence: ["message_capture", "contract"],
    hints: [/무료|서비스|할인|구두|말로|카톡|문자|약속/],
  },
  {
    id: "vendor_identity",
    label: "업체명·담당자·연락처",
    severity: "high",
    scopes: ["all"],
    reason: "문제가 생겼을 때 누구에게 어떤 조건으로 계약했는지 바로 확인할 수 있어야 합니다.",
    question: "계약 주체, 담당자 이름, 연락처, 사업자 정보가 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/업체명|사업자|담당자|연락처|대표|주소/],
  },
  {
    id: "venue_guest_guarantee",
    label: "보증 인원과 식대 단가",
    severity: "critical",
    scopes: ["venue"],
    reason: "보증 인원은 예식장 총액을 크게 바꾸는 핵심 조건입니다.",
    question: "보증 인원, 1인 식대, 최종 인원 통보 마감일이 계약서에 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/보증\s*인원|최소\s*보증|식대|하객|인원\s*통보/],
  },
  {
    id: "venue_included_facilities",
    label: "홀·대기실·폐백실·주차 포함 범위",
    severity: "high",
    scopes: ["venue"],
    reason: "기본 제공이라고 들은 시설도 시간 제한이나 추가금 조건이 붙는 경우가 있습니다.",
    question: "홀 사용 시간, 신부대기실, 폐백실, 주차, 혼주 식사 조건이 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/홀|대기실|폐백|주차|혼주|대관|사용\s*시간/],
  },
  {
    id: "venue_external_vendor",
    label: "외부 업체 반입 기준",
    severity: "medium",
    scopes: ["venue"],
    reason: "스냅, 영상, 플라워, 사회자 등 외부 업체 반입에 비용이나 제한이 있을 수 있습니다.",
    question: "외부 스냅·영상·플라워·사회자 반입 가능 여부와 비용이 적혀 있나요?",
    evidence: ["contract", "vendor_policy"],
    hints: [/외부|반입|스냅|영상|플라워|사회자|반입비/],
  },
  {
    id: "original_data",
    label: "원본 데이터 제공 기준",
    severity: "critical",
    scopes: ["sdm_package", "studio", "snap"],
    reason: "원본 제공 여부는 추가금과 만족도에 직접 영향을 줍니다.",
    question: "원본 데이터 제공 여부, 파일 수, 전달 시점, 추가 비용이 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/원본|데이터|USB|파일|RAW|제공/],
  },
  {
    id: "retouch_delivery",
    label: "수정본·납품 일정",
    severity: "high",
    scopes: ["sdm_package", "studio", "snap"],
    reason: "수정 횟수와 납품일이 없으면 앨범, 청첩장, 모바일 청첩장 일정이 밀릴 수 있습니다.",
    question: "수정본 장수, 수정 횟수, 납품 예정일이 적혀 있나요?",
    evidence: ["contract", "quote", "schedule"],
    hints: [/수정본|보정|납품|앨범|셀렉|장수|횟수/],
  },
  {
    id: "helper_fee",
    label: "헬퍼비·출장비·얼리스타트",
    severity: "critical",
    scopes: ["sdm_package", "dress", "makeup"],
    reason: "당일 현금성 추가금으로 자주 체감되는 항목입니다.",
    question: "헬퍼비, 출장비, 얼리스타트, 야간·새벽 추가금이 포함인지 별도인지 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/헬퍼|출장|얼리|새벽|야간|추가\s*시간/],
  },
  {
    id: "dress_change_damage",
    label: "드레스 변경·수선·손상 기준",
    severity: "high",
    scopes: ["sdm_package", "dress"],
    reason: "드레스는 변경, 피팅, 손상, 수선 기준이 없으면 마지막에 비용이 붙기 쉽습니다.",
    question: "피팅비, 변경 가능 횟수, 수선비, 손상 배상 기준이 적혀 있나요?",
    evidence: ["contract", "quote", "vendor_policy"],
    hints: [/피팅|변경|수선|손상|배상|드레스|턱시도/],
  },
  {
    id: "makeup_staff_time",
    label: "메이크업 담당자·시작 시간",
    severity: "high",
    scopes: ["sdm_package", "makeup"],
    reason: "담당자와 시작 시간이 바뀌면 결과와 당일 타임라인이 같이 흔들립니다.",
    question: "담당자, 시작 시간, 장소, 지각·변경 시 기준이 적혀 있나요?",
    evidence: ["contract", "schedule"],
    hints: [/메이크업|헤어|담당자|시작\s*시간|샵|출장/],
  },
  {
    id: "copyright_usage",
    label: "사진·영상 사용권",
    severity: "medium",
    scopes: ["studio", "snap", "sdm_package"],
    reason: "포트폴리오 사용 동의 여부와 원본 사용권을 미리 정해야 불편한 상황을 피할 수 있습니다.",
    question: "사진·영상의 포트폴리오 사용 동의 여부와 사용권 범위가 적혀 있나요?",
    evidence: ["contract", "vendor_policy"],
    hints: [/초상권|저작권|사용권|포트폴리오|홍보|SNS/],
  },
];

const RISK_LABELS: Record<ContractRiskLevel, string> = {
  low: "진행 가능",
  medium: "확인 필요",
  high: "계약 보류 권장",
};

const NEGATIVE_CLAUSE_PATTERNS: Record<string, RegExp[]> = {
  written_contract: [
    /(계약서|견적서|문서).{0,16}(없|안\s*받|못\s*받|미기재|아직)/,
    /(없|안\s*받|못\s*받|미기재).{0,16}(계약서|견적서|문서)/,
  ],
  total_amount: [
    /(총액|최종\s*금액|추가금|별도).{0,16}(없|모름|미기재|안\s*적|불명확)/,
  ],
  payment_schedule: [
    /(계약금|예약금|잔금|결제일|입금).{0,16}(없|모름|미기재|안\s*적|불명확)/,
  ],
  cancellation_refund: [
    /(취소|환불|위약금|해약|해지).{0,16}(없|모름|미기재|안\s*적|불명확)/,
    /(없|모름|미기재|안\s*적|불명확).{0,16}(취소|환불|위약금|해약|해지)/,
  ],
  change_policy: [
    /(변경|연기|날짜|시간|인원).{0,16}(없|모름|미기재|안\s*적|불명확)/,
  ],
  oral_promises_written: [
    /(무료|서비스|할인|구두|약속).{0,16}(없|문서화\s*안|카톡\s*없|문자\s*없|안\s*남)/,
  ],
  venue_guest_guarantee: [
    /(보증\s*인원|최소\s*보증|식대|최종\s*인원).{0,16}(없|모름|미기재|안\s*적|불명확)/,
  ],
  original_data: [
    /(원본|데이터|USB|파일).{0,16}(없|모름|미포함|별도|미기재|안\s*적)/,
  ],
  helper_fee: [
    /(헬퍼|출장|얼리|새벽|야간).{0,16}(없|모름|별도|미기재|안\s*적|불명확)/,
  ],
};

function appliesToCategory(rule: ClauseRule, category: ContractShieldCategory): boolean {
  return rule.scopes.includes("all") || rule.scopes.includes(category);
}

function hasOralPromiseContext(input: ContractShieldInput): boolean {
  if ((input.oralPromises ?? []).length > 0) return true;
  const text = [
    input.memo,
    ...(input.includedItems ?? []),
  ].filter(Boolean).join(" ");
  return /(구두|말로|무료|서비스|할인|약속|카톡|문자)/.test(text);
}

function isRuleRelevant(rule: ClauseRule, input: ContractShieldInput): boolean {
  if (rule.id === "oral_promises_written") return hasOralPromiseContext(input);
  return true;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{Letter}\p{Number}_가-힣]/gu, "");
}

function toGrade(score: number): ContractShieldResult["grade"] {
  if (score >= 90) return "A";
  if (score >= 78) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function resolveMentionedClauseIds(input: ContractShieldInput, rules: ClauseRule[]): Set<string> {
  const explicit = new Set((input.checkedClauseIds ?? []).map(normalizeToken));
  const textParts = [
    input.memo,
    input.cancellationPolicyText,
    input.changePolicyText,
    input.paymentScheduleText,
    input.extraFeePolicyText,
    ...(input.includedItems ?? []),
    ...(input.oralPromises ?? []),
  ].filter(Boolean) as string[];
  const combined = textParts.join(" ");
  const mentioned = new Set<string>();

  const negativeIds = resolveNegativeClauseIds(input);

  for (const rule of rules) {
    if (negativeIds.has(rule.id)) continue;
    const normalizedId = normalizeToken(rule.id);
    const normalizedLabel = normalizeToken(rule.label);
    if ([...explicit].some((item) => item === normalizedId || item === normalizedLabel)) {
      mentioned.add(rule.id);
      continue;
    }
    if (combined && rule.hints.some((hint) => hint.test(combined))) {
      mentioned.add(rule.id);
    }
  }

  if (input.contractAmountManwon && input.contractAmountManwon > 0) mentioned.add("total_amount");
  if (input.depositAmountManwon && input.depositAmountManwon > 0) mentioned.add("payment_schedule");
  if (input.hasWrittenContract === true) mentioned.add("written_contract");
  if ((input.evidenceTypes ?? []).some((type) => type === "contract" || type === "quote")) mentioned.add("written_contract");
  if ((input.evidenceTypes ?? []).includes("deposit")) mentioned.add("payment_schedule");
  if ((input.evidenceTypes ?? []).includes("message_capture") && (input.oralPromises ?? []).length > 0) {
    mentioned.add("oral_promises_written");
  }
  if (input.cancellationPolicyText) mentioned.add("cancellation_refund");
  if (input.changePolicyText) mentioned.add("change_policy");
  if (input.paymentScheduleText) mentioned.add("payment_schedule");
  if (input.extraFeePolicyText) mentioned.add("total_amount");

  for (const id of negativeIds) mentioned.delete(id);
  return mentioned;
}

function resolveNegativeClauseIds(input: ContractShieldInput): Set<string> {
  const text = [
    input.memo,
    input.cancellationPolicyText,
    input.changePolicyText,
    input.paymentScheduleText,
    input.extraFeePolicyText,
    ...(input.includedItems ?? []),
    ...(input.oralPromises ?? []),
  ].filter(Boolean).join(" ");
  const negative = new Set<string>();
  if (!text) return negative;

  for (const [id, patterns] of Object.entries(NEGATIVE_CLAUSE_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(text))) {
      negative.add(id);
    }
  }
  return negative;
}

function resolveForcedMissingIds(input: ContractShieldInput): Set<string> {
  const explicit = new Set((input.missingClauseIds ?? []).map(normalizeToken));
  for (const id of resolveNegativeClauseIds(input)) explicit.add(normalizeToken(id));
  return explicit;
}

function buildMessageToVendor(questions: string[], vendorName: string | null): string {
  const intro = vendorName
    ? `${vendorName} 계약 전 확인차 문의드립니다.`
    : "계약 전 확인차 문의드립니다.";
  const body = questions.slice(0, 5).map((question, index) => `${index + 1}. ${question}`).join("\n");
  return `${intro}\n아래 항목을 계약서나 문자로 확인 부탁드립니다.\n${body}\n확인되는 대로 계약 여부를 결정하겠습니다.`;
}

function buildEvidenceList(input: ContractShieldInput, missing: ContractClauseCheck[]): string[] {
  const base = [
    "최종 견적서 원본",
    "계약서 또는 약관 PDF/사진",
    "계약금 입금 내역과 영수증",
    "상담 중 받은 카톡·문자 캡처",
  ];
  const extra = missing.some((item) => item.id === "venue_guest_guarantee")
    ? ["보증 인원·식대·최종 인원 통보 마감일 캡처"]
    : [];
  const oral = (input.oralPromises ?? []).length > 0
    ? ["무료 제공·할인·서비스 약속이 적힌 메시지"]
    : [];
  return unique([...base, ...extra, ...oral]).slice(0, 7);
}

export function analyzeContractReadiness(input: ContractShieldInput): ContractShieldResult {
  const category = input.category ?? "other";
  const rules = CLAUSES.filter((rule) => appliesToCategory(rule, category) && isRuleRelevant(rule, input));
  const mentioned = resolveMentionedClauseIds(input, rules);
  const forcedMissing = resolveForcedMissingIds(input);

  const confirmed = rules
    .filter((rule) => mentioned.has(rule.id) && !forcedMissing.has(normalizeToken(rule.id)))
    .map((rule) => ({ id: rule.id, label: rule.label }));

  const missing = rules
    .filter((rule) => !mentioned.has(rule.id) || forcedMissing.has(normalizeToken(rule.id)))
    .map<ContractClauseCheck>((rule) => ({
      id: rule.id,
      label: rule.label,
      severity: rule.severity,
      reason: rule.reason,
      question: rule.question,
    }));

  const blockers = missing.filter((item) => item.severity === "critical");
  const warnings = missing.filter((item) => item.severity !== "critical");

  let score = 100;
  score -= blockers.length * 14;
  score -= warnings.filter((item) => item.severity === "high").length * 8;
  score -= warnings.filter((item) => item.severity === "medium").length * 4;

  if (input.hasWrittenContract === false) score -= 20;
  if (input.usesStandardContract === false) score -= 6;

  const oralPromiseCount = input.oralPromises?.length ?? 0;
  if (oralPromiseCount > 0 && !mentioned.has("oral_promises_written")) {
    score -= Math.min(18, oralPromiseCount * 6);
  }

  const amount = input.contractAmountManwon ?? 0;
  const deposit = input.depositAmountManwon ?? 0;
  if (amount >= 500 && !mentioned.has("cancellation_refund")) score -= 8;
  if (amount > 0 && deposit / amount >= 0.25 && !mentioned.has("cancellation_refund")) score -= 6;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const riskLevel: ContractRiskLevel =
    input.hasWrittenContract === false ||
    score < 55 ||
    blockers.length >= 3 ||
    (amount >= 500 && blockers.some((item) => item.id === "cancellation_refund"))
      ? "high"
      : score < 75 || blockers.length > 0
        ? "medium"
        : "low";

  const categoryLabel = CATEGORY_LABELS[category];
  const vendorName = input.vendorName?.trim() || null;
  const titleTarget = vendorName ? `${vendorName} ${categoryLabel}` : categoryLabel;

  const summaryTitle =
    riskLevel === "high"
      ? `${titleTarget} 계약은 지금 바로 진행하지 않는 편이 안전해요`
      : riskLevel === "medium"
        ? `${titleTarget} 계약 전 몇 가지를 문서로 확인해야 해요`
        : `${titleTarget} 계약 조건은 큰 틀에서 정리되어 있어요`;

  const summaryText =
    blockers.length > 0
      ? `필수 확인 항목 ${blockers.length}개가 아직 비어 있습니다. 특히 ${blockers.slice(0, 2).map((item) => item.label).join(", ")}는 계약 전에 문서로 남겨야 합니다.`
      : warnings.length > 0
        ? `필수 항목은 대체로 확인됐지만, ${warnings.length}개 항목은 업체 답변을 받아두면 나중에 비교하기 쉽습니다.`
        : "총액, 결제, 취소, 변경 기준이 확인된 상태입니다. 계약서와 입금 내역만 같은 이름으로 저장해두면 좋습니다.";

  const vendorQuestions = missing
    .sort((a, b) => (a.severity === "critical" ? -1 : b.severity === "critical" ? 1 : 0))
    .map((item) => item.question)
    .slice(0, 7);

  const clausesToRequest = missing
    .filter((item) => item.severity !== "medium")
    .map((item) => item.label)
    .slice(0, 6);

  return {
    mode: "analysis",
    category,
    categoryLabel,
    vendorName,
    score,
    grade: toGrade(score),
    riskLevel,
    riskLabel: RISK_LABELS[riskLevel],
    summaryTitle,
    summaryText,
    blockers,
    warnings,
    confirmed,
    vendorQuestions,
    evidenceToSave: buildEvidenceList(input, missing),
    clausesToRequest,
    messageToVendor: buildMessageToVendor(vendorQuestions, vendorName),
    sourceNote: "사용자가 제공한 조건과 웨딩한방 계약 전 확인 기준을 함께 적용했습니다.",
    disclaimer: "계약 효력이나 분쟁 판단을 확정하는 법률 자문은 아니며, 계약 전 확인을 돕는 체크입니다.",
  };
}
