const EXPLICIT_CHANGE_RE =
  /(?:정했|확정했|잡았|바꿨|변경했|수정했|올렸|내렸|예약했|취소했|계약했|결정했|정해졌|확정됐|잡혔|바뀌었)/;
const DATE_VALUE_RE =
  /(?:(?:올해|내년|내후년|\d{4}년)\s*)?\d{1,2}월\s*\d{1,2}일|(?:오늘|내일|모레|이번\s*주|다음\s*주)\s*(?:월|화|수|목|금|토|일)요일/;
const WEDDING_DATE_RE = /(?:결혼식|예식|웨딩|본식|결혼\s*날짜)/;
const SCHEDULE_RE = /(?:상견례|드레스\s*투어|촬영|청첩장\s*모임|일정)/;
const BUDGET_RE = /(?:총\s*)?예산/;
const MONEY_RE = /\d[\d,]*(?:만|천만|억)?\s*원/;
const BOOKING_RE = /(?:예약|계약)/;
const NON_PERSISTENCE_RE =
  /(?:저장|반영|등록)(?:이|은|는|도)?\s*(?:되지|안\s*됐|안\s*되|못\s*했|할\s*수\s*없)|(?:미저장|미반영)/;

export type DemoPersistenceGuardResult = {
  text: string;
  appendedNotice: string | null;
};

/**
 * A model instruction is not a persistence boundary. For signed demo chat,
 * conservatively append a server-owned disclosure when the latest user turn
 * contains an explicit wedding mutation that cannot be persisted.
 */
export function guardDemoPersistenceDisclosure(
  text: string,
  userText: string,
): DemoPersistenceGuardResult {
  const normalizedUserText = userText.replace(/\s+/g, " ").trim();
  const normalizedText = text.trim();
  if (!EXPLICIT_CHANGE_RE.test(normalizedUserText) || NON_PERSISTENCE_RE.test(normalizedText)) {
    return { text: normalizedText, appendedNotice: null };
  }

  let notice: string | null = null;
  if (WEDDING_DATE_RE.test(normalizedUserText) && DATE_VALUE_RE.test(normalizedUserText)) {
    notice = "참고로 체험 상담이라 말씀하신 결혼 날짜는 실제 일정에는 아직 저장되지 않았어요.";
  } else if (BUDGET_RE.test(normalizedUserText) && MONEY_RE.test(normalizedUserText)) {
    notice = "참고로 체험 상담이라 말씀하신 예산은 실제 예산 관리에는 아직 저장되지 않았어요.";
  } else if (BOOKING_RE.test(normalizedUserText)) {
    notice = "참고로 체험 상담이라 말씀하신 예약·계약 변경은 실제 내역에는 저장되지 않았어요.";
  } else if (SCHEDULE_RE.test(normalizedUserText) && DATE_VALUE_RE.test(normalizedUserText)) {
    notice = "참고로 체험 상담이라 말씀하신 일정은 실제 일정 관리에는 아직 저장되지 않았어요.";
  }

  if (!notice) return { text: normalizedText, appendedNotice: null };
  return {
    text: normalizedText ? `${normalizedText}\n\n${notice}` : notice,
    appendedNotice: notice,
  };
}
