import { parseAmoraFirstUseGrounding } from "./amoraFirstUseGrounding.mjs";

const CONTRACT_HARD_CLAIM_PATTERN =
  /(?:계약|서명)[^.!?\n]{0,24}(?:(?:확정|체결|완료)(?!\s*(?:여부|인지|됐는지|되었는지))|됐(?!는지)|되었(?!는지))/u;
const CONTRACT_DIRECT_COMPLETION_PATTERN =
  /(?:계약|서명)(?:을|이|은|는)?\s*했(?!는지)/u;
const CONTRACT_COMMITMENT_PATTERN =
  /(?:계약(?:하|하기|해|해야|하면)|체결(?:하|하기|해|하면)|서명(?:하|하고|하기|해|하면))/u;
const PAYMENT_HARD_CLAIM_PATTERN =
  /(?:결제|입금|송금|예약금|계약금|잔금|지불|납부)[^.!?\n]{0,30}(?:(?:완료|확정)(?!\s*(?:여부|인지|됐는지|되었는지))|됐(?!는지)|되었(?!는지)|완납)/u;
const PAYMENT_DIRECT_COMPLETION_PATTERN =
  /(?:(?:결제|입금|송금|지불|납부)(?:을|이|은|는)?\s*(?:했|냈|보냈)|(?:예약금|계약금|잔금)(?:을|이|은|는)?\s*(?:냈|보냈|입금했|송금했|결제했))(?!는지)/u;
const PAYMENT_COMMITMENT_PATTERN =
  /(?:(?:결제|입금|송금|지불|납부)(?:하|하기|해|하면)|(?:예약금|계약금|잔금)[^.!?\n]{0,24}(?:내|결제|입금|송금|보내))/u;
const PARTNER_AGREEMENT_HARD_CLAIM_PATTERN =
  /(?:우린|우리가|우리는|우리\s*둘(?:은|이)?|둘이|두\s*사람(?:이|은)?|서로)[^.!?\n]{0,40}(?:합의(?:했|한|됐|된)|동의(?:했|한|됐|된)|결정(?:했|한|됐|된)|정했)/u;
const MONEY_CLAIM_SOURCE =
  "(?:(?:₩\\s*)?(?:\\d+(?:[.,]\\d+)?\\s*(?:억|천만|백만|십만|천|백|십|만)?\\s*)+(?:억|천만|백만|십만|만)?\\s*원|₩\\s*(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)(?![\\d,]))";
const DATE_CLAIM_SOURCE =
  "(?:20\\d{2}[-./]\\d{1,2}[-./]\\d{1,2}|(?:20\\d{2}년\\s*)?\\d{1,2}월\\s*\\d{1,2}일)";
const RELATIVE_DEADLINE_PATTERN =
  /(?:오늘|내일|모레|이번\s*주말|다음\s*주말|(?:(?:이번|다음)\s*주\s*)?(?:월|화|수|목|금|토|일)요일)[^.!?\n]{0,12}(?:까지|마감|기한)/u;
const VERIFICATION_INTENT_PATTERN =
  /(?:(?:여부|상태|내역|계약서|영수증|증빙)[^.!?\n]{0,24}(?:확인|비교|문의)|(?:확인|비교|문의)[^.!?\n]{0,24}(?:여부|상태|내역|계약서|영수증|증빙))/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalText(value) {
  return value.normalize("NFKC").replace(/\p{Cf}/gu, "");
}

function isValidProviderField(value, maxLength) {
  return typeof value === "string"
    && value.trim().length > 0
    && Array.from(value).length <= maxLength
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function hasContractOrPaymentHardClaim(fields) {
  return fields.some((field) => {
    const text = canonicalText(field);
    if (
      CONTRACT_HARD_CLAIM_PATTERN.test(text)
      || CONTRACT_DIRECT_COMPLETION_PATTERN.test(text)
      || PAYMENT_HARD_CLAIM_PATTERN.test(text)
      || PAYMENT_DIRECT_COMPLETION_PATTERN.test(text)
    ) return true;
    if (VERIFICATION_INTENT_PATTERN.test(text)) return false;
    return CONTRACT_COMMITMENT_PATTERN.test(text)
      || PAYMENT_COMMITMENT_PATTERN.test(text);
  });
}

function groundedVenue(grounding) {
  const item = grounding.confirmed.find((candidate) => candidate.key === "venue");
  if (!item || !item.label.startsWith("결혼식장: ")) return null;
  const value = item.label.slice("결혼식장: ".length).trim();
  return value || null;
}

function moneyClaims(value) {
  return canonicalText(value).match(new RegExp(MONEY_CLAIM_SOURCE, "gu")) ?? [];
}

function hasUnsupportedMoneyClaim(fields, grounding) {
  const claims = moneyClaims(fields.join("\n"));
  if (claims.length === 0) return false;
  const supported = new Set(
    grounding.confirmed
      .filter((item) => item.key === "total_budget")
      .flatMap((item) => moneyClaims(item.label)),
  );
  return claims.some((claim) => !supported.has(claim));
}

function dateClaims(value) {
  return canonicalText(value).match(new RegExp(DATE_CLAIM_SOURCE, "gu")) ?? [];
}

function hasUnsupportedDateClaim(fields, grounding) {
  const joined = fields.join("\n");
  if (RELATIVE_DEADLINE_PATTERN.test(canonicalText(joined))) return true;
  const claims = dateClaims(joined);
  if (claims.length === 0) return false;
  const supported = new Set(
    grounding.confirmed
      .filter((item) => item.key === "wedding_date" || item.key === "next_schedule")
      .flatMap((item) => dateClaims(item.label)),
  );
  return claims.some((claim) => !supported.has(claim));
}

export function guardAmoraFirstUseActionClaim({
  action,
  reason,
  completionCriterion,
  grounding,
}) {
  if (
    !isValidProviderField(action, 120)
    || !isValidProviderField(reason, 220)
    || !isValidProviderField(completionCriterion, 220)
    || !isRecord(grounding)
  ) return null;
  const canonicalGrounding = parseAmoraFirstUseGrounding(
    grounding,
    grounding.sourceRevision,
  );
  if (!canonicalGrounding) return null;

  if (hasContractOrPaymentHardClaim([action, reason, completionCriterion])) {
    const venue = groundedVenue(canonicalGrounding);
    return Object.freeze({
      action: `${venue ? `${venue} ` : ""}계약·결제 상태 확인하기`,
      reason: "저장된 준비 기록만으로 계약·결제 상태를 확정할 수 없어 먼저 확인이 필요해요.",
      completionCriterion: "계약서와 결제 내역에서 금액·상태·마감일을 확인해 둘이 볼 기록에 적으면 끝나요.",
    });
  }
  if (hasUnsupportedMoneyClaim(
    [action, reason, completionCriterion],
    canonicalGrounding,
  )) {
    return Object.freeze({
      action: "둘이 사용할 금액 기준 확인하기",
      reason: "저장된 준비 기록에서 이 금액을 확인하지 못해 먼저 기준을 맞출 필요가 있어요.",
      completionCriterion: "두 사람이 사용할 범위를 확인해 전체 예산 기록에 남기면 끝나요.",
    });
  }
  if (hasUnsupportedDateClaim(
    [action, reason, completionCriterion],
    canonicalGrounding,
  )) {
    return Object.freeze({
      action: "실제 마감일 확인하기",
      reason: "저장된 일정에서 이 마감일을 확인하지 못해 먼저 날짜를 확인해야 해요.",
      completionCriterion: "확인한 날짜를 일정에 남기고, 그 날짜까지 할 한 가지를 정하면 끝나요.",
    });
  }
  if (PARTNER_AGREEMENT_HARD_CLAIM_PATTERN.test(canonicalText([
    action,
    reason,
    completionCriterion,
  ].join("\n")))) {
    return Object.freeze({
      action: "두 사람이 같은 선택에 동의하는지 확인하기",
      reason: "공동 준비 기록에서 두 사람의 합의를 확인하지 못해 각각 확인이 필요해요.",
      completionCriterion: "두 사람이 각자 같은 선택을 확인하면 끝나요.",
    });
  }
  return Object.freeze({ action, reason, completionCriterion });
}
