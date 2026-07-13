import { createHash } from "node:crypto";
import type {
  CourtCategory,
  CourtMode,
  CourtTone,
  CourtVerdict,
  CourtVerdictStatus,
  PublicCourtSnapshot,
} from "@/lib/coupleCourt/types";
import { COURT_CATEGORY_CATALOG } from "@/lib/coupleCourt/catalog";

export const COURT_PUBLIC_SNAPSHOT_VERSION = "1.0" as const;

export interface CourtSafeShareCard {
  safeTitle: string;
  oneLine: string;
  resultLabel: string;
  hashtags: string[];
}

const PUBLIC_RESULT_LABELS: Readonly<Record<CourtVerdictStatus, string>> = {
  applicant_partially_upheld: "신청인 의견 일부 반영",
  respondent_partially_upheld: "상대방 의견 일부 반영",
  shared_responsibility: "함께 바꿀 지점 발견",
  settlement_recommended: "대화와 합의 권고",
  insufficient_information: "조금 더 확인이 필요",
  safety_redirect: "안전 지원 안내",
};

/**
 * Produces share copy from enums only. Provider-authored text is intentionally
 * excluded: even a schema-valid model response can repeat a name or venue that
 * heuristic PII detection does not recognize.
 */
export function buildCourtSafeShareCard(input: {
  category: CourtCategory;
  mode: CourtMode;
  provisional: boolean;
  verdictStatus: CourtVerdictStatus;
}): CourtSafeShareCard {
  const category = COURT_CATEGORY_CATALOG.find(
    (definition) => definition.id === input.category,
  );
  const categoryLabel = category?.label ?? "결혼 준비 의견 차이";
  const categoryTag = categoryLabel.replace(/[^0-9A-Za-z가-힣]/gu, "").slice(0, 20);
  return {
    safeTitle: `${categoryLabel}에 관한 한방 판결`,
    oneLine: input.provisional || input.mode === "solo"
      ? "한 사람의 진술을 바탕으로 다음 대화를 위한 임시 쟁점을 정리했어요."
      : "두 사람의 독립 진술을 바탕으로 다음 합의를 위한 쟁점을 정리했어요.",
    resultLabel: PUBLIC_RESULT_LABELS[input.verdictStatus],
    hashtags: ["웨딩한방", "커플재판소", categoryTag].filter(Boolean),
  };
}

export type CourtPiiKind =
  | "resident_id"
  | "email"
  | "phone"
  | "url"
  | "account_or_card"
  | "address"
  | "contract_identifier"
  | "social_handle"
  | "exact_date_time"
  | "currency_amount"
  | "named_person"
  | "vendor_or_venue"
  | "known_entity";

interface PiiRule {
  kind: CourtPiiKind;
  replacement: string;
  pattern: RegExp;
}

interface CourtPrivacyOptions {
  knownEntities?: readonly string[];
  /** Share/public cards omit exact prices as re-identification clues. */
  blockCurrencyAmounts?: boolean;
}

const PII_RULES: readonly PiiRule[] = [
  { kind: "resident_id", replacement: "[주민번호 삭제]", pattern: /\b\d{6}\s*[- ]?\s*[1-4]\d{6}\b/g },
  { kind: "email", replacement: "[이메일 삭제]", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "url", replacement: "[링크 삭제]", pattern: /\b(?:https?:\/\/|www\.)[^\s<>{}\[\]]+/gi },
  { kind: "phone", replacement: "[전화번호 삭제]", pattern: /(?<!\d)(?:(?:\+?82[- .]?)?0?1[016789]|0\d{1,2})[- .]?\d{3,4}[- .]?\d{4}(?!\d)/g },
  { kind: "account_or_card", replacement: "[결제정보 삭제]", pattern: /(?<!\d)(?:\d[- ]?){12,18}\d(?!\d)/g },
  { kind: "account_or_card", replacement: "$1 [계좌번호 삭제]", pattern: /(계좌(?:번호)?|통장(?:번호)?|입금계좌|카드번호)\s*[:：-]?\s*(?:\d[- ]?){7,20}\d(?!\d)/gi },
  { kind: "contract_identifier", replacement: "$1 [식별번호 삭제]", pattern: /(계약번호|예약번호|견적번호|접수번호|주문번호)\s*[:：#-]?\s*[A-Z0-9][A-Z0-9_-]{4,39}\b/gi },
  { kind: "address", replacement: "[주소 삭제]", pattern: /(?:서울(?:특별시)?|부산(?:광역시)?|대구(?:광역시)?|인천(?:광역시)?|광주(?:광역시)?|대전(?:광역시)?|울산(?:광역시)?|세종(?:특별자치시)?|제주(?:특별자치도)?|[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|도))\s+[가-힣0-9]{1,12}(?:구|군|시)\s+[가-힣0-9·-]{1,24}(?:로|길|동)(?:\s*\d+(?:-\d+)?)?/g },
  { kind: "address", replacement: "[주소 삭제]", pattern: /[가-힣]{1,12}(?:구|군|시)\s+[가-힣0-9·-]{1,24}(?:로|길|동)\s*\d+(?:-\d+)?\b/g },
  { kind: "social_handle", replacement: "[SNS 계정 삭제]", pattern: /(^|[\s(])@[A-Z0-9._-]{2,30}\b/gim },
  { kind: "exact_date_time", replacement: "[날짜 삭제]", pattern: /(?<!\d)20\d{2}\s*[년./-]\s*(?:0?[1-9]|1[0-2])\s*[월./-]\s*(?:0?[1-9]|[12]\d|3[01])\s*일?(?!\d)/g },
  { kind: "exact_date_time", replacement: "[날짜 삭제]", pattern: /(?<!\d)(?:0?[1-9]|1[0-2])\s*월\s*(?:0?[1-9]|[12]\d|3[01])\s*일(?:\s*(?:월|화|수|목|금|토|일)요일)?(?!\d)/g },
  { kind: "exact_date_time", replacement: "[시간 삭제]", pattern: /(?<!\d)(?:오전|오후)?\s*(?:[01]?\d|2[0-3])\s*(?::|시)\s*(?:[0-5]?\d)?\s*분?(?!\d)/g },
  { kind: "named_person", replacement: "$1 [이름 삭제]", pattern: /(이름|성명|예약자|계약자)\s*[:：]\s*[가-힣]{2,4}(?![가-힣])/g },
  { kind: "named_person", replacement: "$1 [이름 삭제]", pattern: /(담당자|플래너|실장|대표)\s+[가-힣]{2,4}(?:님|씨)?(?![가-힣])/g },
  { kind: "named_person", replacement: "$1 [이름 삭제]", pattern: /((?:엄마|아빠|어머니|아버지|부모님?|시어머니|시아버지|장모님?|장인어른|형|오빠|누나|언니|동생|형제|자매|친구)\s*(?:이름|성함)(?:은|는)?\s*[:：]?\s*)[가-힣]{2,4}(?:님|씨)?(?=\s|[,.;!?]|$)/g },
  // Public cards must not expose a recognizable vendor or venue. This catches
  // the common Korean brand forms even when a postposition follows the name.
  {
    kind: "vendor_or_venue",
    replacement: "[업체명 삭제]",
    pattern: /(?<![0-9A-Za-z가-힣&·._-])[0-9A-Za-z가-힣&·._-]{2,24}(?:웨딩홀|예식장|웨딩|스튜디오|컨벤션|호텔|드레스샵|메이크업샵)(?=(?:에서|에게|으로|와|과|은|는|이|가|을|를|의|에|도|만)?(?:\s|[,.;!?]|$))/gi,
  },
] as const;

const EXPLICIT_ENTITY_CONTEXT_PATTERN = /(?:업체명|예식장명|웨딩홀명|스튜디오명|드레스샵명|메이크업샵명|호텔명|컨벤션명)\s*(?:[:：]\s*|(?:은|는|이|가)?\s+)([0-9A-Za-z가-힣&·._-]{2,30})/giu;
const LABELED_ENTITY_CONTEXT_PATTERN = /(?:업체|예식장|웨딩홀|스튜디오|드레스샵|메이크업샵|호텔|컨벤션)\s*(?:[:：]\s*|(?:은|는|이|가)\s+)([0-9A-Za-z가-힣&·._-]{2,30})/giu;
const EXPLICIT_RELATION_NAME_PATTERN = /(?:엄마|아빠|어머니|아버지|부모님?|시어머니|시아버지|장모님?|장인어른|형|오빠|누나|언니|동생|형제|자매|친구)\s*(?:이름|성함)(?:은|는)?\s*[:：]?\s*([가-힣]{2,4})(?:님|씨)?(?=\s|[,.;!?]|$)/gu;
const IMPLICIT_RELATION_NAME_PATTERN = /(?:엄마|아빠|어머니|아버지|부모님?|시어머니|시아버지|장모님?|장인어른|형|오빠|누나|언니|동생|형제|자매|친구)\s+([가-힣]{2,4}?)(?:님|씨)?(?:은|는|이|가|을|를|와|과|의|도)?(?=\s|[,.;!?]|$)/gu;
const ENTITY_STOPWORDS = new Set([
  "가격", "결정", "드레스", "메이크업", "문제", "비용", "상담", "선택", "아직",
  "예약", "예산", "업체", "예식장", "웨딩홀", "스튜디오", "추가금", "투어", "플래너",
  "호텔", "후보", "컨벤션", "너무", "마음", "마음에", "정말", "아주", "여기", "저기",
  "비싸요", "좋아요", "싫어요", "괜찮아", "예뻐요", "멀어요", "가까워요",
]);
const RELATION_NON_NAMES = new Set([
  "의견", "뜻", "뜻이", "생각", "생각도", "마음", "마음에", "입장", "말", "말이",
  "때문", "때문에", "요구", "부탁", "일정", "예산", "비용", "하객", "결혼", "준비",
  "연락", "답변", "선택", "결정", "반대", "찬성", "취향", "가족", "쪽은", "측은",
]);
const HIGH_CONFIDENCE_ENTITY_SUFFIX = /(?:채플|컴퍼니|가든|하우스|팰리스|웨딩|스튜디오|컨벤션|호텔|예식장|웨딩홀|드레스샵|메이크업샵)$/u;

function cleanEntityCandidate(value: string): string {
  return value
    .replace(/^[._-]+|[._-]+$/gu, "")
    .replace(/(?:이에요|예요|입니다|이었어요|였어요)$/u, "")
    .replace(/(?:에서|에게|으로|와|과|은|는|이|가|을|를|의|에|도|만)$/u, "")
    .trim();
}

function extractRelationNameEntities(value: string): string[] {
  const found = new Set<string>();
  for (const pattern of [EXPLICIT_RELATION_NAME_PATTERN, IMPLICIT_RELATION_NAME_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const candidate = (match[1] ?? "").trim();
      const explicit = pattern === EXPLICIT_RELATION_NAME_PATTERN;
      if (
        candidate.length >= 2
        && candidate.length <= 4
        && (explicit || !RELATION_NON_NAMES.has(candidate))
      ) {
        found.add(candidate);
      }
    }
  }
  return [...found];
}

/**
 * Extracts venue/vendor candidates from private text for a server-only exact
 * denylist. It is deliberately conservative and never returns the source text.
 */
export function extractCourtKnownEntities(value: string): string[] {
  const text = normalizePrivacyText(value);
  const found = new Set<string>();
  for (const pattern of [EXPLICIT_ENTITY_CONTEXT_PATTERN, LABELED_ENTITY_CONTEXT_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const candidate = cleanEntityCandidate(match[1] ?? "");
      const explicit = pattern === EXPLICIT_ENTITY_CONTEXT_PATTERN;
      const highConfidence = explicit
        || /[0-9A-Za-z&·._-]/u.test(candidate)
        || HIGH_CONFIDENCE_ENTITY_SUFFIX.test(candidate);
      if (
        candidate.length >= 2
        && candidate.length <= 30
        && !ENTITY_STOPWORDS.has(candidate)
        && highConfidence
      ) {
        found.add(candidate);
      }
    }
  }
  for (const candidate of extractRelationNameEntities(text)) found.add(candidate);
  return [...found];
}

// An exact price is useful private evidence and must remain available to the
// judge, but it is omitted from public/share copy where it can re-identify a
// specific dispute. Keep this rule outside the ordinary PII list so comments
// and private provider input are not needlessly stripped.
const CURRENCY_AMOUNT_RULE: PiiRule = {
  kind: "currency_amount",
  replacement: "[금액 삭제]",
  // Accept both grouped (1,200,000원) and ordinary ungrouped Korean input
  // (1200000원, 350만원). The previous grouped-only expression missed the
  // most common mobile-keyboard form and could leak an identifying amount.
  pattern: /(?<![\dA-Za-z가-힣])(?:(?:₩\s*)(?:\d{1,12}|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:\s*(?:억\s*원|만\s*원|천\s*원|원))?|(?:\d{1,12}|\d{1,3}(?:,\d{3})+)(?:\.\d+)?\s*(?:억\s*원|만\s*원|천\s*원|원))/g,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePrivacyText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function normalizedEntities(values: readonly string[]): string[] {
  return [...new Set(values
    .map((value) => normalizePrivacyText(value))
    .filter((value) => value.length >= 2))]
    .sort((a, b) => b.length - a.length);
}

export function detectCourtPii(
  value: string,
  options: CourtPrivacyOptions = {},
): CourtPiiKind[] {
  const text = normalizePrivacyText(value);
  const found = new Set<CourtPiiKind>();
  for (const rule of PII_RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) found.add(rule.kind);
  }
  if (extractRelationNameEntities(text).length > 0) found.add("named_person");
  if (options.blockCurrencyAmounts) {
    CURRENCY_AMOUNT_RULE.pattern.lastIndex = 0;
    if (CURRENCY_AMOUNT_RULE.pattern.test(text)) found.add("currency_amount");
  }
  const exactEntities = normalizedEntities([
    ...(options.knownEntities ?? []),
    ...extractRelationNameEntities(text),
  ]);
  for (const entity of exactEntities) {
    if (new RegExp(escapeRegExp(entity), "iu").test(text)) {
      found.add("known_entity");
      break;
    }
  }
  return [...found];
}

export function redactCourtText(
  value: string,
  options: CourtPrivacyOptions = {},
): { text: string; findings: CourtPiiKind[]; blocked: boolean } {
  const findings = detectCourtPii(value, options);
  let redacted = normalizePrivacyText(value);
  const exactEntities = normalizedEntities([
    ...(options.knownEntities ?? []),
    ...extractRelationNameEntities(redacted),
  ]);
  for (const entity of exactEntities) {
    redacted = redacted.replace(
      new RegExp(escapeRegExp(entity), "giu"),
      "[고유명사 삭제]",
    );
  }
  for (const rule of PII_RULES) {
    rule.pattern.lastIndex = 0;
    redacted = redacted.replace(rule.pattern, rule.replacement);
  }
  if (options.blockCurrencyAmounts) {
    CURRENCY_AMOUNT_RULE.pattern.lastIndex = 0;
    redacted = redacted.replace(
      CURRENCY_AMOUNT_RULE.pattern,
      CURRENCY_AMOUNT_RULE.replacement,
    );
  }
  return { text: redacted, findings, blocked: findings.length > 0 };
}

/**
 * Sanitizes every model-authored free-text field before a verdict is stored or
 * shown to the other participant. Structural enums and numeric fields are
 * copied unchanged; provider-authored public copy is still discarded at the
 * API boundary in favour of deterministic enum-only copy.
 */
export function sanitizePrivateCourtVerdict(
  verdict: CourtVerdict,
  knownEntities: readonly string[] = [],
): CourtVerdict {
  const clean = (value: string): string => redactCourtText(value, { knownEntities }).text;
  const cleanNullable = (value: string | null): string | null => (
    value === null ? null : clean(value)
  );
  return {
    ...verdict,
    safety: {
      ...verdict.safety,
      supportMessage: cleanNullable(verdict.safety.supportMessage),
    },
    caseMeta: {
      ...verdict.caseMeta,
      generatedTitle: clean(verdict.caseMeta.generatedTitle),
    },
    caseSummary: clean(verdict.caseSummary),
    sharedFacts: verdict.sharedFacts.map(clean),
    differentViews: verdict.differentViews.map((view) => ({
      applicant: clean(view.applicant),
      respondent: cleanNullable(view.respondent),
    })),
    applicantNeeds: clean(verdict.applicantNeeds),
    partnerNeeds: cleanNullable(verdict.partnerNeeds),
    coreConflict: clean(verdict.coreConflict),
    responsibility: verdict.responsibility
      ? { ...verdict.responsibility, explanation: clean(verdict.responsibility.explanation) }
      : null,
    verdict: {
      ...verdict.verdict,
      headline: clean(verdict.verdict.headline),
      reasons: verdict.verdict.reasons.map(clean),
      judgeOneLiner: cleanNullable(verdict.verdict.judgeOneLiner),
    },
    conversationScript: {
      opening: clean(verdict.conversationScript.opening),
      applicantLine: clean(verdict.conversationScript.applicantLine),
      respondentLine: cleanNullable(verdict.conversationScript.respondentLine),
    },
    missions: verdict.missions.map((mission) => ({
      ...mission,
      title: clean(mission.title),
      description: clean(mission.description),
      completionCheck: clean(mission.completionCheck),
      funTag: cleanNullable(mission.funTag),
    })),
    checkIn: { ...verdict.checkIn, question: clean(verdict.checkIn.question) },
    limitations: verdict.limitations.map(clean),
    publicCard: verdict.publicCard
      ? {
          safeTitle: clean(verdict.publicCard.safeTitle),
          oneLine: clean(verdict.publicCard.oneLine),
          resultLabel: clean(verdict.publicCard.resultLabel),
          hashtags: verdict.publicCard.hashtags.map(clean),
        }
      : null,
  };
}

function sanitizeHashtag(value: string, knownEntities: readonly string[]): string | null {
  const redacted = redactCourtText(value, { knownEntities, blockCurrencyAmounts: true });
  if (redacted.blocked) return null;
  const clean = redacted.text.replace(/^#+/, "").replace(/[^0-9A-Za-z가-힣_]/g, "").slice(0, 20);
  return clean.length >= 2 ? clean : null;
}

/** Creates a new allowlisted value; it never spreads the private verdict object. */
export function buildPublicCourtSnapshot(
  input: {
    mode: CourtMode;
    tone: CourtTone;
    category: CourtCategory;
    verdict: CourtVerdict;
    knownEntities?: readonly string[];
  },
): PublicCourtSnapshot | null {
  const { verdict } = input;
  if (
    verdict.safety.level !== "normal"
    || verdict.safety.publicEligible !== true
    || verdict.safety.riskTypes.length > 0
  ) {
    return null;
  }
  const deterministicCard = buildCourtSafeShareCard({
    category: input.category,
    mode: input.mode,
    provisional: verdict.caseMeta.provisional,
    verdictStatus: verdict.verdict.status,
  });
  const knownEntities = input.knownEntities ?? [];
  const publicOptions = { knownEntities, blockCurrencyAmounts: true } as const;
  const safeTitle = redactCourtText(deterministicCard.safeTitle, publicOptions);
  const oneLine = redactCourtText(deterministicCard.oneLine, publicOptions);
  const resultLabel = redactCourtText(deterministicCard.resultLabel, publicOptions);
  const hashtagResults = deterministicCard.hashtags.map((tag) => ({
    value: sanitizeHashtag(tag, knownEntities),
    blocked: redactCourtText(tag, publicOptions).blocked,
  }));
  if (
    safeTitle.blocked
    || oneLine.blocked
    || resultLabel.blocked
    || hashtagResults.some((result) => result.blocked)
  ) {
    return null;
  }
  const hashtags = [...new Set(hashtagResults
    .map((result) => result.value)
    .filter((tag): tag is string => tag !== null))]
    .slice(0, 4);

  return {
    snapshotVersion: COURT_PUBLIC_SNAPSHOT_VERSION,
    category: input.category,
    mode: input.mode,
    tone: input.tone,
    provisional: verdict.caseMeta.provisional,
    safeTitle: safeTitle.text.slice(0, 80),
    oneLine: oneLine.text.slice(0, 180),
    resultLabel: resultLabel.text.slice(0, 60),
    hashtags,
  };
}

export function hashPublicCourtSnapshot(snapshot: PublicCourtSnapshot): string {
  const canonical = JSON.stringify({
    snapshotVersion: snapshot.snapshotVersion,
    category: snapshot.category,
    mode: snapshot.mode,
    tone: snapshot.tone,
    provisional: snapshot.provisional,
    safeTitle: snapshot.safeTitle,
    oneLine: snapshot.oneLine,
    resultLabel: snapshot.resultLabel,
    hashtags: snapshot.hashtags,
  });
  return createHash("sha256")
    .update(`couple-court-public-snapshot-v1\u0000${canonical}`, "utf8")
    .digest("hex");
}
