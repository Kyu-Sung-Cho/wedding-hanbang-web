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
  venue: "결혼식장",
  sdm_package: "사진 촬영·드레스·헤어·메이크업 묶음",
  studio: "웨딩 사진 촬영",
  dress: "드레스",
  makeup: "헤어·메이크업",
  snap: "결혼식 날 사진·영상",
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
    reason: "총액과 따로 내는 비용이 문서에서 나뉘어 있어야 실제 결제 조건을 확인할 수 있습니다.",
    question: "총액, 견적에 포함되지 않아 따로 내는 비용, 선택 항목이 한 줄씩 나뉘어 있나요?",
    evidence: ["quote", "contract"],
    hints: [/총액|총\s*금액|최종\s*금액|별도|추가금|옵션/],
  },
  {
    id: "payment_schedule",
    label: "처음 내는 금액·남은 금액·결제일",
    severity: "critical",
    scopes: ["all"],
    reason: "계약금과 남은 금액의 결제일이 문서에 있어야 언제 얼마를 내는지 확인할 수 있습니다.",
    question: "처음 계약할 때 내는 금액, 중간에 내는 금액, 마지막에 내는 금액과 각각의 결제일이 적혀 있나요?",
    evidence: ["contract", "deposit", "receipt"],
    hints: [/계약금|예약금|잔금|중도금|입금|결제일|납부/],
  },
  {
    id: "cancellation_refund",
    label: "취소할 때 내는 금액·돌려받는 금액",
    severity: "critical",
    scopes: ["all"],
    reason: "취소 시점에 따라 돌려받는 금액이 달라질 수 있으므로 날짜별 계산 기준을 확인해야 합니다.",
    question: "취소일 기준으로 환불 금액과 위약금 계산 방식이 적혀 있나요?",
    evidence: ["contract", "vendor_policy"],
    hints: [/취소|환불|위약금|해약|해지|청약철회/],
  },
  {
    id: "change_policy",
    label: "날짜·시간·인원 변경 기준",
    severity: "high",
    scopes: ["all"],
    reason: "날짜, 시간, 인원, 담당자를 바꿀 때 비용과 가능한 시점이 어떻게 달라지는지 확인해야 합니다.",
    question: "날짜, 시간, 인원, 담당자 변경 시 비용이 언제부터 달라지는지 적혀 있나요?",
    evidence: ["contract", "vendor_policy", "schedule"],
    hints: [/변경|연기|날짜|시간|인원|담당자|스태프/],
  },
  {
    id: "oral_promises_written",
    label: "말로 들은 약속이 문서에 있는지",
    severity: "critical",
    scopes: ["all"],
    reason: "추가 제공, 할인, 무료 조건은 문서나 메시지에 남아 있어야 나중에도 같은 내용을 확인할 수 있습니다.",
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
    question: "계약서에 업체명, 담당자 이름, 연락처, 사업자 이름과 주소가 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/업체명|사업자|담당자|연락처|대표|주소/],
  },
  {
    id: "venue_guest_guarantee",
    label: "최소 식사 인원과 1인당 식사비",
    severity: "critical",
    scopes: ["venue"],
    reason: "결혼식장이 최소 몇 명의 식사비를 받는지에 따라 최종 금액이 달라질 수 있습니다.",
    question: "최소로 결제해야 하는 식사 인원, 1인당 식사비, 최종 인원을 알릴 날짜가 계약서에 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/보증\s*인원|최소\s*보증|식대|하객|인원\s*통보/],
  },
  {
    id: "venue_included_facilities",
    label: "결혼식 공간·대기실·주차 이용 조건",
    severity: "high",
    scopes: ["venue"],
    reason: "각 공간과 주차장을 이용할 수 있는 시간, 인원, 별도 금액을 문서에서 확인해야 합니다.",
    question: "결혼식 공간과 대기실의 사용 시간, 주차 가능 대수와 비용, 부모님 식사 조건이 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/홀|대기실|폐백|주차|혼주|대관|사용\s*시간/],
  },
  {
    id: "venue_external_vendor",
    label: "외부 업체 이용 조건",
    severity: "medium",
    scopes: ["venue"],
    reason: "다른 사진·영상·꽃·진행 업체를 이용할 수 있는지와 별도 비용을 확인해야 합니다.",
    question: "외부 사진·영상·꽃·진행 업체를 이용할 수 있는지와 별도 비용이 적혀 있나요?",
    evidence: ["contract", "vendor_policy"],
    hints: [/외부|반입|스냅|영상|플라워|사회자|반입비/],
  },
  {
    id: "original_data",
    label: "받는 사진 파일 수와 전달 시점",
    severity: "critical",
    scopes: ["sdm_package", "studio", "snap"],
    reason: "촬영 뒤 받는 사진 파일 수, 전달 날짜, 별도 금액을 문서에서 확인해야 합니다.",
    question: "촬영 뒤 사진 파일을 몇 장 받는지, 언제 받는지, 별도 금액이 있는지 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/원본|데이터|USB|파일|RAW|제공/],
  },
  {
    id: "retouch_delivery",
    label: "보정해 주는 사진 수와 전달 날짜",
    severity: "high",
    scopes: ["sdm_package", "studio", "snap"],
    reason: "보정해 주는 사진 수, 다시 고쳐주는 횟수, 전달 날짜를 문서에서 확인해야 합니다.",
    question: "보정해 주는 사진 수, 다시 고쳐주는 횟수, 사진과 앨범을 받는 날짜가 적혀 있나요?",
    evidence: ["contract", "quote", "schedule"],
    hints: [/수정본|보정|납품|앨범|셀렉|장수|횟수/],
  },
  {
    id: "helper_fee",
    label: "드레스를 돕는 직원·출장·이른 시간 비용",
    severity: "critical",
    scopes: ["sdm_package", "dress", "makeup"],
    reason: "드레스를 입고 이동하는 일을 돕는 직원, 출장, 이른 아침이나 늦은 시간의 비용을 확인해야 합니다.",
    question: "드레스를 돕는 직원 비용, 출장비, 이른 아침·늦은 시간의 추가 비용이 포함인지 별도인지 적혀 있나요?",
    evidence: ["contract", "quote"],
    hints: [/헬퍼|출장|얼리|새벽|야간|추가\s*시간/],
  },
  {
    id: "dress_change_damage",
    label: "드레스 선택 변경·수선·손상 기준",
    severity: "high",
    scopes: ["sdm_package", "dress"],
    reason: "드레스 선택을 바꾸거나 몸에 맞게 고치거나 손상했을 때의 조건을 확인해야 합니다.",
    question: "드레스를 입어보는 비용, 선택을 바꿀 수 있는 횟수, 수선비, 손상 때 내는 금액이 적혀 있나요?",
    evidence: ["contract", "quote", "vendor_policy"],
    hints: [/피팅|변경|수선|손상|배상|드레스|턱시도/],
  },
  {
    id: "makeup_staff_time",
    label: "메이크업 담당자·시작 시간",
    severity: "high",
    scopes: ["sdm_package", "makeup"],
    reason: "담당자, 시작 시간, 장소가 바뀔 때의 절차와 비용을 확인해야 합니다.",
    question: "담당자, 시작 시간, 장소, 지각·변경 시 기준이 적혀 있나요?",
    evidence: ["contract", "schedule"],
    hints: [/메이크업|헤어|담당자|시작\s*시간|샵|출장/],
  },
  {
    id: "copyright_usage",
    label: "사진·영상 사용권",
    severity: "medium",
    scopes: ["studio", "snap", "sdm_package"],
    reason: "업체가 사진과 영상을 홍보에 사용할 수 있는지, 사용자가 파일을 어디에 쓸 수 있는지 확인해야 합니다.",
    question: "업체의 홍보용 사진·영상 사용 여부와 사용자가 파일을 이용할 수 있는 범위가 적혀 있나요?",
    evidence: ["contract", "vendor_policy"],
    hints: [/초상권|저작권|사용권|포트폴리오|홍보|SNS/],
  },
];

// 사실 기반 라벨 — "진행 가능/보류 권장" 같은 보증·권고가 아니라 문서 확인 상태만 말한다.
// (보증성 표현은 사용자가 그걸 믿고 진행했다 분쟁 시 신뢰 리스크, 업체 상대 권고는 업무방해 시비 소지)
const RISK_LABELS: Record<ContractRiskLevel, string> = {
  low: "입력한 주요 문서 항목 확인됨",
  medium: "추가 문서 확인 필요",
  high: "계약 전 문서 확인 필요",
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
    "업체에서 받은 최종 견적서",
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

  const riskLevel: ContractRiskLevel =
    input.hasWrittenContract === false || blockers.length > 0
      ? "high"
      : warnings.length > 0
        ? "medium"
        : "low";

  const categoryLabel = CATEGORY_LABELS[category];
  const vendorName = input.vendorName?.trim() || null;

  // 제목에 업체명을 넣지 않는다 — "{업체명} 계약은 진행하지 마세요" 류 문장은
  // 캡처·공유 시 특정 업체에 대한 부정 단정으로 읽혀 업무방해 시비 소지.
  // 문서 확인 상태라는 사실만 말한다.
  const summaryTitle =
    riskLevel === "high"
      ? `${categoryLabel} 계약에서 먼저 문서로 확인할 항목이 있어요`
      : riskLevel === "medium"
        ? `${categoryLabel} 계약 전 몇 가지를 문서로 확인해야 해요`
        : `입력하신 기준으로 ${categoryLabel} 계약의 주요 조건이 문서로 확인됐어요`;

  const summaryText =
    blockers.length > 0
      ? `먼저 확인할 항목 ${blockers.length}개가 아직 입력 내용에서 확인되지 않았습니다. ${blockers.slice(0, 2).map((item) => item.label).join(", ")}부터 업체 문서나 문자에서 확인해 주세요.`
      : warnings.length > 0
        ? `먼저 확인할 항목은 입력 내용에서 확인됐고, ${warnings.length}개 항목은 업체 답변을 문서나 문자로 받아두면 비교하기 쉽습니다.`
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
    sourceNote:
      "사용자가 입력한 문장에서 관련 항목이 언급됐는지를 기준으로 정리했습니다. 실제 계약서의 내용이 충분하거나 적정한지는 판정하지 않습니다.",
    disclaimer:
      "계약 효력, 위약금의 적법성, 분쟁 결과를 판단하는 법률 자문이 아닙니다. 중요한 계약은 계약서 원문과 공식 상담을 함께 확인하세요.",
  };
}
