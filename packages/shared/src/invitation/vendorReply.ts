import { todayYmdInKst } from "../utils/kstDay";
import { VENDOR_REPLY_COPY } from "./copyStates";

/**
 * 받은 답 붙여 넣기(D-83 1단계, 2026-11-18).
 *
 * 커플이 업체에게 받은 문자·카톡을 붙여 넣으면 **이 기기 안에서만** 읽어 날짜·시간·금액·보증 인원과
 * 업체가 쓴 말을 칩으로 보인다. 글은 서버로도 아모라에게도 가지 않는다. 일정에 넣는 것은 사람이 누를 때만이다.
 *
 * 순서는 늘 같다.
 *   1. 글을 고른다: 줄바꿈 맞추기, 보이지 않는 글자 빼기, 전각 글자와 붙임표 꼴 바꾸기, 4,000자에서 자르기.
 *   2. 가린다: 메일, 링크, 인증번호, 주민번호, 카드번호, 전화번호, 계좌번호. 가린 자리에는 숫자 없는 표시만 남는다.
 *      잘린 글이면 끝에 걸친 번호 조각을 먼저 버린다(어느 꼴에도 맞지 않아 앞자리가 보인다).
 *   3. 가린 글에서만 칩을 뽑는다. 칩은 업체가 쓴 값을 옮길 뿐 좋고 나쁨을 말하지 않는다.
 *      카카오톡 대화를 통째로 복사해 붙은 보낸 시각("[소담하우스] [오후 2:31]")은 칩으로 뽑지 않는다.
 *
 * 모르는 것은 짐작하지 않는다. "내일", "다음 주"처럼 보낸 날을 알아야 하는 말과 날짜만 있는 "22일"은 뽑지 않는다.
 * 오전·오후가 없는 "2시"는 영업시간으로 짐작하되 `meridiemGuessed` 로 알려 사람이 고르게 한다.
 * 해가 없는 날짜는 오늘부터 가장 가까운 날로 읽고, 적힌 요일이 그날과 다르면 해를 넘기지 않고 `weekdayMismatch` 로 알린다.
 *
 * 이 파일은 800줄 기준을 넘는다. 고르기·가리기·칩 뽑기가 한 흐름이고, 가리기가 알아낸 것(은행 낱말과 함께 가린 계좌인지)을
 * 칩 읽기가 밖에 내보내지 않고 그대로 쓰므로 한곳에 둔다. 앱의 시험도 이 파일 하나를 그대로 읽는다.
 */

export const VENDOR_REPLY_MAX_CHARS = 4000;
const MAX_CHIPS = 12;
/** 날짜·시간 칩의 상한. 날짜가 많은 답에서도 금액·보증 인원·업체가 쓴 말이 칩 상한에 밀려 사라지지 않게 한다. */
const MAX_SCHEDULABLE_CHIPS = 8;
const MAX_PHRASES = 3;
const MAX_QUOTE_CHARS = 50;

export type VendorReplyMaskKind = keyof typeof VENDOR_REPLY_COPY.maskLabels;

export type VendorReplyChip =
  | { kind: "datetime"; ymd: string; time: string; meridiemGuessed: boolean; weekdayMismatch: boolean; label: string; quote: string }
  | { kind: "date"; ymd: string; weekdayMismatch: boolean; label: string; quote: string }
  | { kind: "time"; time: string; meridiemGuessed: boolean; label: string; quote: string }
  /** `upToWon` 은 "300~400만원"처럼 범위로 적은 금액의 위쪽 끝이다(그때 `won` 은 아래쪽 끝). 범위가 아니면 null. */
  | { kind: "price"; won: number; upToWon: number | null; subject: string | null; label: string; quote: string }
  | { kind: "count"; count: number; label: string; quote: string }
  | { kind: "phrase"; label: string; quote: string };

export type MaskedReceivedText = {
  /** 가린 글. 화면은 원문이 아니라 이 글을 보여 준다. */
  masked: string;
  maskedCount: number;
  maskedKinds: readonly VendorReplyMaskKind[];
  truncated: boolean;
};

export type VendorReplyReading = MaskedReceivedText & {
  chips: readonly VendorReplyChip[];
  /** 계좌·입금·결제 링크 이야기가 있다. 진위는 판정하지 않고 정해진 안내 한 줄만 붙인다. */
  caution: boolean;
};

// ── 1. 글 고르기 ──────────────────────────────────────────────────────────

const INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const SPACE_LIKE_RE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\t]/g;
const FULLWIDTH_ASCII_RE = /[\uFF01-\uFF5E]/g;
/** 붙임표처럼 쓰는 글자(U+2010~2015, U+2212, U+FE58, U+FE63). 번호를 이것으로 끊어 써도 가리기가 "-" 와 같이 읽는다. */
const DASH_LIKE_RE = /[\u2010-\u2015\u2212\uFE58\uFE63]/g;

export function normalizeReceivedText(raw: string): { text: string; truncated: boolean } {
  const source = String(raw ?? "");
  const text = (typeof source.normalize === "function" ? source.normalize("NFC") : source)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(INVISIBLE_RE, "")
    .replace(SPACE_LIKE_RE, " ")
    .replace(FULLWIDTH_ASCII_RE, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(DASH_LIKE_RE, "-");
  const chars = Array.from(text);
  if (chars.length <= VENDOR_REPLY_MAX_CHARS) return { text, truncated: false };
  return { text: chars.slice(0, VENDOR_REPLY_MAX_CHARS).join(""), truncated: true };
}

// ── 2. 가리기 ─────────────────────────────────────────────────────────────

const digitsIn = (value: string) => value.replace(/\D/g, "").length;

/** "2026-11-30"으로 시작하는 숫자 묶음. 은행 이름과 같은 낱말(우리, 하나, 카카오) 뒤에도 날짜가 온다. */
const LEADING_ISO_DATE_RE = /^(?:19|20)\d{2}-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])(?!\d)/;

/** 가리기 꼴 하나가 맞은 자리. `before`·`after` 는 맞은 글 앞뒤의 몇 글자다(그 꼴을 가리기 전 글에서 잘랐다). */
type MaskMatch = { match: string; groups: readonly (string | undefined)[]; before: string; after: string };
type MaskStep = {
  kind: VendorReplyMaskKind;
  re: RegExp;
  /** 은행·송금 낱말과 함께 가린 계좌다. 계좌 가운데 이것만 결제 안내 줄을 켠다(낱말 없이 숫자 묶음만 보고 가린 것은 켜지 않는다). */
  money?: boolean;
  replace: (found: MaskMatch) => string | null;
};

const MASK_CONTEXT_CHARS = 16;
/**
 * 바로 뒤에 띄어 쓰지 않은 돈 단위가 오면 금액이다("1500-2000만원", "55000-68000원"). 띄어 쓴 "원"은 단위가 아니라 다음 낱말의
 * 첫 글자일 수 있다("110-123-456789 원장님 명의", "… 원하시면"). 그런 번호는 가린다.
 */
const PRICE_UNIT_AFTER_RE = /^(?:원|억|[만천백] ?원)/;
/**
 * "만"·"천"·"백"만 오면 "이 번호만"의 만일 수도 있다. 그래서 앞이 뒤보다 작은 두 수("1500-2000만")이고 여덟 자리를 넘지 않을 때만
 * 금액으로 본다. 15xx 번호("1588-1234만")는 앞이 더 크고, 계좌·주민번호는 여덟 자리보다 길다.
 */
const BARE_UNIT_AFTER_RE = /^[만천백]/;
const MAX_BARE_UNIT_DIGITS = 8;
/**
 * 업체가 매긴 번호(사업자등록번호, 예약번호, 주문번호, 접수번호)는 계좌가 아니다. 계좌라고 적지 않고 결제 안내도 켜지 않는다.
 * 번호라는 말을 빼거나("예약 2026112901") 조사·괄호를 붙여도("예약번호가 …", "예약번호(…)", "[예약번호] …") 같다.
 * 가리지 않고 그대로 둔다. 개인을 가리키는 번호가 아니고, 맞는 가림 표시가 없다(새 표시는 문구 승인이 필요하다).
 */
const ISSUED_NUMBER_BEFORE_RE = /(?:사업자(?:\s*등록)?|예약|주문|접수)(?:\s*번호)?\s*\]?\s*(?:은|는|이|가|:)?\s*[([#]?\s*$/;
/**
 * 인증번호 뒤에 이런 글이 붙어 오면 인증번호가 아니라 날짜·금액·사람 수다("코드 2026.11.30", "확인코드 2026년", "5000원").
 * 띄어 쓴 "원"은 보지 않는다. 다음 낱말의 첫 글자일 수 있다("인증번호 482910 원하시면 다시 보내 드려요").
 */
const NOT_A_CODE_AFTER_RE = /^(?:년|원|만\s*원|명|[./:-][0-9])/;

const hide = (): string => "";

function isAscendingPair(match: string): boolean {
  const parts = match.split(/[^0-9]+/).filter(Boolean);
  return parts.length === 2 && Number(parts[0]) < Number(parts[1]);
}

/** 금액은 0이나 +로 시작하지 않는다. 그래서 "010-1234-5678원"처럼 앞자리가 0인 번호는 뒤에 원이 붙어도 가린다. */
const looksLikePriceNumber = ({ match, after }: MaskMatch): boolean =>
  /^[1-9]/.test(match)
  && (PRICE_UNIT_AFTER_RE.test(after) || (BARE_UNIT_AFTER_RE.test(after) && digitsIn(match) <= MAX_BARE_UNIT_DIGITS && isAscendingPair(match)));
const unlessPrice = (found: MaskMatch): string | null => (looksLikePriceNumber(found) ? null : "");
const keepLead = ({ groups }: MaskMatch): string => groups[0] ?? "";

/** null 을 돌려주면 가리지 않는다. 문자열을 돌려주면 그 자리에 둔다(표시가 들어간 글). */
const MASK_STEPS: readonly MaskStep[] = [
  // 앞의 뒤돌아보기는 결과를 바꾸지 않고(가장 왼쪽에서 시작하는 것은 같다) 글자 묶음 가운데에서 다시 시작하지 않게만 한다.
  { kind: "email", re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: hide },
  // 링크 뒤에 붙여 쓴 한글("…/x에서", "…/x입금해")은 링크가 아니다. 한글에서 끊어 그 말을 남긴다.
  { kind: "link", re: /(?:https?:\/\/|www\.)[^\s<>"'()[\]{}ㄱ-ㅣ가-힣]+/gi, replace: hide },
  {
    kind: "link",
    re: /(?<![A-Za-z0-9@._\-/])(?:[A-Za-z0-9-]+\.)+(?:co\.kr|or\.kr|go\.kr|ne\.kr|com|net|org|kr|me|to|ly|io|gl|la|do|so|im|site|shop|store|studio|online|wedding|link|app|page|info|biz|xyz|ai)(?::[0-9]{2,5})?(?:\/[^\s<>"'()[\]{}ㄱ-ㅣ가-힣]*)?(?![A-Za-z0-9])/gi,
    replace: hide,
  },
  // 목록에 없는 끝이라도 뒤에 경로(/…)가 붙은 주소는 링크로 본다. 결제 링크가 흔히 이렇게 온다(pay.toss.im/…).
  {
    kind: "link",
    re: /(?<![A-Za-z0-9@._\-/])(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}(?::[0-9]{2,5})?\/[^\s<>"'()[\]{}ㄱ-ㅣ가-힣]*/gi,
    replace: hide,
  },
  // 낱말 다음 줄에 번호만 따로 오기도 한다("인증번호는 아래와 같습니다\n482910").
  {
    kind: "code",
    re: /((?:인증\s*(?:번호|코드)|확인\s*(?:번호|코드)|승인\s*번호|일회용\s*(?:번호|코드)|보안\s*코드|본인\s*확인|핀\s*번호|(?<![A-Za-z])(?:OTP|otp|PIN|Pin|pin|CODE|[Cc]ode)(?![A-Za-z])|비밀\s*번호|비번|코드)[^0-9\n]{0,12}(?:\n[^0-9\n]{0,12})?)([0-9][0-9 -]{2,10}[0-9])/g,
    replace: ({ groups, after }) => {
      const digits = groups[1] ?? "";
      const count = digitsIn(digits);
      if (count < 4 || count > 8 || LEADING_ISO_DATE_RE.test(digits) || NOT_A_CODE_AFTER_RE.test(after)) return null;
      return groups[0] ?? "";
    },
  },
  // 번호를 먼저 쓰기도 한다("482910은 인증번호입니다").
  {
    kind: "code",
    re: /(?<![0-9])[0-9]{4,8}(?![0-9])(?=\s*[\])]?\s*(?:은|는|이|가)?\s*(?:인증|확인|승인|보안|일회용|본인\s*확인)\s*(?:번호|코드))/g,
    replace: hide,
  },
  { kind: "resident", re: /(?<![0-9])[0-9]{6}\s*-\s*[1-8][0-9]{6}(?![0-9])/g, replace: unlessPrice },
  // "주민번호 900101 1234567"처럼 붙임표 대신 띄어 쓰거나 붙여 쓴 것은 주민 낱말이 앞에 있을 때만 본다.
  { kind: "resident", re: /(주민[^0-9\n]{0,10})([0-9]{6} {0,2}-? {0,2}[1-8][0-9]{6})(?![0-9])/g, replace: keepLead },
  { kind: "card", re: /(?<![0-9])[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{3,4}(?![0-9])/g, replace: hide },
  { kind: "card", re: /(?<![0-9,.])[0-9]{15,16}(?![0-9])/g, replace: hide },
  // 글자 모둠의 붙임표는 맨 끝에 둔다. 가운데에 두면 "공백부터 마침표까지" 같은 범위가 된다.
  // 사람이 친 번호는 붙임표 앞뒤를 띄우기도 한다("010 - 1234 - 5678"). 그래서 끊는 자리마다 빈칸을 두 개까지 받는다.
  {
    kind: "phone",
    re: /(?:\(\+82\)|\+82) {0,2}-? {0,2}(?:\(0\) {0,2})?(?:0?1[016789]|0?[2-6][0-9]?) {0,2}[.-]? {0,2}[0-9]{3,4} {0,2}[.-]? {0,2}[0-9]{4}(?![0-9])/g,
    replace: unlessPrice,
  },
  // "(010)1234-5678", "010)1234-5678"처럼 앞자리를 괄호로 끊은 것은 여는 괄호까지 가린다. 번호 전체를 감싼 괄호는 남긴다.
  {
    kind: "phone",
    re: /(?<![0-9])(?:\(01[016789]\) {0,2}[.-]? {0,2}|01[016789] {0,2}[.)-]? {0,2})[0-9]{3,4} {0,2}[.-]? {0,2}[0-9]{4}(?![0-9])/g,
    replace: unlessPrice,
  },
  { kind: "phone", re: /(?<![0-9])0[57]0[0-9]? {0,2}[.-]? {0,2}[0-9]{3,4} {0,2}[.-]? {0,2}[0-9]{4}(?![0-9])/g, replace: unlessPrice },
  // 080(수신자 부담)·060 번호. 계좌 꼴보다 먼저 보아야 계좌번호라고 적지 않는다.
  { kind: "phone", re: /(?<![0-9])0[68]0 {0,2}[.-]? {0,2}[0-9]{3,4} {0,2}[.-]? {0,2}[0-9]{4}(?![0-9])/g, replace: unlessPrice },
  // "(02)123-4567"처럼 지역번호만 감싼 괄호는 여는 괄호까지 가린다. "(02-123-4567)"처럼 번호 전체를 감싼 괄호는 남긴다.
  {
    kind: "phone",
    re: /(?<![0-9])(?:\(0(?:2|[3-6][1-5])\)[ .-]{0,3}|0(?:2|[3-6][1-5])[ .)-]{0,3})[0-9]{3,4}[ .-]{0,3}[0-9]{4}(?![0-9])/g,
    replace: unlessPrice,
  },
  { kind: "phone", re: /(?<![0-9])1[5-9][0-9]{2}(?: {1,2}| {0,2}[.-] {0,2})[0-9]{4}(?![0-9])/g, replace: unlessPrice },
  // 끊지 않은 "15881234"는 대표·전화·문의 낱말 뒤에서만 전화번호로 본다(그냥 여덟 자리 숫자일 수 있다).
  // "문의하신 대관료는 15000000원입니다"처럼 원이 붙은 것은 금액이다.
  {
    kind: "phone",
    re: /((?:대표|전화|문의)[^0-9\n]{0,8})(1[5-9][0-9]{6})(?![0-9])/g,
    replace: (found) => (looksLikePriceNumber({ ...found, match: found.groups[1] ?? "" }) ? null : keepLead(found)),
  },
  // 낱말 다음 줄에 번호만 따로 오기도 한다("계좌는 아래와 같습니다\n110 123 456789").
  {
    kind: "account",
    money: true,
    re: /((?:계좌|입금|송금|이체|은행|뱅크|신협|새마을|우체국|농협|국민|신한|우리|하나|기업|카카오|토스)\s*(?:번호)?[^0-9\n]{0,10}(?:\n[^0-9\n]{0,10})?)([0-9][0-9 -]{7,20}[0-9])/g,
    replace: ({ groups, after }) => {
      const digits = groups[1] ?? "";
      // "우리 홀은 2026-11-30 14:00"의 날짜와 시각은 계좌가 아니다. "입금 300000000원"은 금액이다.
      // 은행 이름과 같은 낱말 뒤라도 업체가 매긴 번호("우리 예약번호는 2026112901")는 계좌가 아니다.
      if (LEADING_ISO_DATE_RE.test(digits) || ISSUED_NUMBER_BEFORE_RE.test(groups[0] ?? "")) return null;
      if (looksLikePriceNumber({ match: digits, groups, before: "", after })) return null;
      const count = digitsIn(digits);
      return count >= 9 && count <= 16 ? groups[0] ?? "" : null;
    },
  },
  // 은행 이름이나 예금주가 뒤에 오는 숫자 묶음("110 123 456789 신한", "1002 123 456789 우리은행", "123 456 789012 (국민)").
  // 은행 이름이나 예금주는 다음 줄에 오기도 한다("110 123 456789\n예금주 소담웨딩").
  {
    kind: "account",
    money: true,
    re: /(?<![0-9])[0-9]{2,6}(?:[ -][0-9]{2,8}){1,4}(?![0-9])(?= {0,2}[(/,]? {0,2}(?:\n {0,2}[(/,]? {0,2})?(?:은행|뱅크|농협|국민|신한|우리|하나|기업|카카오|토스|신협|새마을|우체국|예금주))/g,
    replace: ({ match }) => {
      const count = digitsIn(match);
      return count >= 10 && count <= 16 ? "" : null;
    },
  },
  // 아래 둘은 낱말 없이 숫자 묶음만 보고 가린다. 그래서 결제 안내를 켜지 않고(money 없음), 업체가 매긴 번호는 남긴다.
  {
    kind: "account",
    re: /(?<![0-9])[0-9]{2,6}(?:-[0-9]{2,8}){1,4}(?![0-9])/g,
    replace: (found) => {
      const count = digitsIn(found.match);
      if (count < 10 || count > 16 || looksLikePriceNumber(found) || ISSUED_NUMBER_BEFORE_RE.test(found.before)) return null;
      return "";
    },
  },
  {
    kind: "account",
    re: /(?<![0-9,.])[0-9]{10,14}(?![0-9])/g,
    replace: (found) => (looksLikePriceNumber(found) || ISSUED_NUMBER_BEFORE_RE.test(found.before) ? null : ""),
  },
];

/** 4,000자에서 자른 자리에 걸친 번호는 어떤 가리기 꼴에도 맞지 않아 앞자리가 그대로 보인다. 잘린 글이면 끝의 번호 조각을 버린다. */
const CUT_NUMBER_CHAR_RE = /[0-9 ().+-]/;

function dropCutNumber(text: string): string {
  let start = text.length;
  while (start > 0 && CUT_NUMBER_CHAR_RE.test(text[start - 1])) start -= 1;
  const firstDigit = text.slice(start).search(/[0-9]/);
  return firstDigit === -1 ? text : text.slice(0, start + firstDigit);
}

/** 가린 글과, 은행·송금 낱말과 함께 계좌를 가렸는지(결제 안내 줄을 켤지). 뒤의 것은 화면에 내보내지 않는다. */
function maskWithFacts(raw: string): { result: MaskedReceivedText; moneyAccount: boolean } {
  const { text, truncated } = normalizeReceivedText(raw);
  let masked = truncated ? dropCutNumber(text) : text;
  let maskedCount = 0;
  let moneyAccount = false;
  const kinds = new Set<VendorReplyMaskKind>();
  for (const step of MASK_STEPS) {
    const label = VENDOR_REPLY_COPY.maskLabels[step.kind];
    masked = masked.replace(step.re, (...args: unknown[]) => {
      const match = String(args[0]);
      // 맞은 글 다음에 묶음들이 오고(맞지 않은 묶음은 undefined), 그다음이 자리(숫자)와 이 꼴을 보기 전의 글이다.
      const at = args.findIndex((value, index) => index > 0 && typeof value === "number");
      const offset = Number(args[at]);
      const whole = String(args[at + 1]);
      const end = offset + match.length;
      const kept = step.replace({
        match,
        groups: args.slice(1, at).map((value) => (typeof value === "string" ? value : undefined)),
        before: whole.slice(Math.max(0, offset - MASK_CONTEXT_CHARS), offset),
        after: whole.slice(end, end + MASK_CONTEXT_CHARS),
      });
      if (kept === null) return match;
      maskedCount += 1;
      kinds.add(step.kind);
      if (step.money) moneyAccount = true;
      return `${kept}${label}`;
    });
  }
  return { result: { masked, maskedCount, maskedKinds: [...kinds], truncated }, moneyAccount };
}

export function maskReceivedText(raw: string): MaskedReceivedText {
  return maskWithFacts(raw).result;
}

// ── 3. 칩 뽑기 ────────────────────────────────────────────────────────────

const WEEKDAYS = VENDOR_REPLY_COPY.weekdays;
const WEEKDAY_CLASS = "[일월화수목금토]";
// 요일은 "(토)", "토요일", 홀로 쓴 "토"만 받는다. 뒤에 한글이 붙은 첫 글자("일정"의 일, "금액"의 금)는 요일이 아니다.
const WEEKDAY_SUFFIX = `(?:\\s*\\(?\\s*(?=${WEEKDAY_CLASS}(?:요일|\\s*\\)|(?![가-힣])))(${WEEKDAY_CLASS})(?:요일)?\\s*\\)?)?`;
/**
 * 숫자로만 쓴 날짜("12/5", "12.5") 뒤의 요일: "(토)", "토요일", 띄우고 홀로 쓴 "토". 홀로 쓴 "일"은 받지 않는다("1.5 일"은 하루 반,
 * "1/2 일"은 반나절이다). 묶음 셋(괄호, 요일, 홀로) 가운데 하나에 요일 글자가 든다.
 */
const NUMERIC_WEEKDAY = `(?: {0,2}\\( {0,2}(${WEEKDAY_CLASS})(?:요일)? {0,2}\\)|\\s*(${WEEKDAY_CLASS})요일|\\s+([월화수목금토])(?![가-힣0-9]))`;

type Span = { start: number; end: number };
type DateHit = Span & { ymd: string; weekdayMismatch: boolean; quote: string };
type TimeHit = Span & { hour: number; minute: number; meridiemGuessed: boolean; quote: string };

/**
 * 글자 자리마다 이미 읽은 값이 있는지 적는다. 새 값을 찾을 때마다 앞서 찾은 값 모두와 견주면 값이 많은 글(4,000자)에서 느려진다.
 * `owner` 는 그 자리를 차지한 값의 번호이고 비었으면 -1 이다.
 */
type Claims = { free: (start: number, end: number) => boolean; claim: (start: number, end: number, owner: number) => void; ownerAt: (index: number) => number };

function createClaims(length: number): Claims {
  const owners = new Int32Array(length + 1).fill(-1);
  return {
    free: (start, end) => {
      for (let index = start; index < end; index += 1) if (owners[index] !== -1) return false;
      return true;
    },
    claim: (start, end, owner) => {
      for (let index = start; index < end; index += 1) owners[index] = owner;
    },
    ownerAt: (index) => (index >= 0 && index < length ? owners[index] : -1),
  };
}

function ymdOf(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function weekdayOf(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * 해가 없는 "11월 30일". 오늘부터 가장 가까운 날(올해나 내년)로 본다. 요일이 적혀 있고 그날의 요일과 다르면 날짜는 그대로 두고
 * 어긋났다고 알린다. 요일을 맞추려고 해를 넘기지 않는다(2026-11-18 리드 결정: 해를 넘기면 어긋남 안내가 사라진다).
 * 예외는 하나다. 지난 30일 안(한국 날짜)의 같은 날이 적힌 요일과 맞으면 이미 지난 그날이다("지난 16일(월)에 연락드렸어요").
 * 1월에 읽은 "12월 28일 (월)"처럼 지난해의 날도 본다.
 */
function inferYmd(month: number, day: number, weekdayChar: string | undefined, todayYmd: string): { ymd: string; weekdayMismatch: boolean } | null {
  const thisYear = Number(todayYmd.slice(0, 4));
  const dateIn = (year: number) => ymdOf(year, month, day);
  const upcoming = [dateIn(thisYear), dateIn(thisYear + 1)].find((ymd): ymd is string => ymd !== null && ymd >= todayYmd);
  if (!weekdayChar) return upcoming ? { ymd: upcoming, weekdayMismatch: false } : null;
  const wanted = WEEKDAYS.indexOf(weekdayChar as (typeof WEEKDAYS)[number]);
  if (upcoming && weekdayOf(upcoming) === wanted) return { ymd: upcoming, weekdayMismatch: false };
  const earliest = shiftYmd(todayYmd, -RECENT_PAST_DAYS);
  const recent = [dateIn(thisYear - 1), dateIn(thisYear)]
    .find((ymd): ymd is string => ymd !== null && ymd < todayYmd && ymd >= earliest && weekdayOf(ymd) === wanted);
  if (recent) return { ymd: recent, weekdayMismatch: false };
  return upcoming ? { ymd: upcoming, weekdayMismatch: true } : null;
}

const RECENT_PAST_DAYS = 30;

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return ymdOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) ?? ymd;
}

function explicitYmd(year: number, month: number, day: number, weekdayChar: string | undefined): { ymd: string; weekdayMismatch: boolean } | null {
  const ymd = ymdOf(year, month, day);
  if (!ymd) return null;
  if (!weekdayChar) return { ymd, weekdayMismatch: false };
  const wanted = WEEKDAYS.indexOf(weekdayChar as (typeof WEEKDAYS)[number]);
  return { ymd, weekdayMismatch: weekdayOf(ymd) !== wanted };
}

const TIME_NEAR_RE = /^\s{0,3}(?:오전|오후|아침|낮|점심|저녁|밤|새벽|[0-9]{1,2}\s*시|[0-9]{1,2}\s*:\s*[0-9]{2})/;
const AFTER_NUMBER_UNIT_RE = /^\s*(?:만|천|억|원|%|배|kg|평|명|시간|개|번|층|차|회|호)/;

/** "27년 11월 27일"의 "11월 27일"처럼 바로 앞에 해가 적힌 날짜("2027년도 …"도 같다). 그 해를 읽지 못했으면(없는 날짜) 오늘로 해를 짐작하지 않는다. */
const YEAR_RIGHT_BEFORE_RE = /[0-9]\s*년(?:\s*도)?\s*$/;
// 두 자리 해("27년")는 2000년대다. "2027년도 11월 30일"의 "년도"도 해다.
const KOREAN_DATE_RE = new RegExp(`(?<![0-9])(\\d{4}|\\d{2})\\s*년(?:\\s*도)?\\s*(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${WEEKDAY_SUFFIX}`, "g");
// "2026.11.30", "2026. 11. 30.(월)". 점 꼴 날짜는 끝에도 점을 찍는다. 그 점까지 날짜로 읽어야 바로 뒤의 시간과 묶인다.
const NUMERIC_DATE_RE = new RegExp(
  `(?<![0-9.])(\\d{4}) {0,2}[.\\-/] {0,2}(\\d{1,2}) {0,2}[.\\-/] {0,2}(\\d{1,2})(?![0-9])(?:\\.(?![0-9]))?${WEEKDAY_SUFFIX}`,
  "g",
);
// "27.11.30(화)", "27. 11. 30 오후 2시". 두 자리 해의 숫자 꼴은 번호와 헷갈려 같은 기호로 끊고 요일이나 바로 뒤의 시간이 있을 때만 본다.
const SHORT_YEAR_DATE_RE = new RegExp(
  `(?<![0-9.,/])(\\d{2}) {0,2}([.\\-/]) {0,2}(\\d{1,2}) {0,2}\\2 {0,2}(\\d{1,2})(?![0-9])(?:\\.(?![0-9]))?${NUMERIC_WEEKDAY}?`,
  "g",
);
const MONTH_DAY_RE = new RegExp(`(?<![0-9])(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${WEEKDAY_SUFFIX}`, "g");
// "11/30", "11.30(토)", "11. 30.(월)", "12/5 토요일", "12.5 토". 점(.)은 소수(6.8만원)와, 한 자리 빗금(1/2)은 분수와 헷갈린다.
// 그래서 요일이나 바로 뒤의 시간이 있거나, 빗금 꼴에서 달과 날이 모두 두 자리일 때만 날짜로 본다.
// 바로 뒤의 쉼표·마침표는 숫자가 이어질 때(1/2,000)만 막는다. "11/30, 12/12"의 쉼표는 나열이다.
const NUMERIC_MONTH_DAY_RE = new RegExp(
  `(?<![0-9.,/])(\\d{1,2})\\s*([./])\\s*(\\d{1,2})(?![0-9/]|[.,][0-9])(?:\\.(?![0-9]))?${NUMERIC_WEEKDAY}?`,
  "g",
);

function findDates(text: string, todayYmd: string): DateHit[] {
  const hits: DateHit[] = [];
  const claims = createClaims(text.length);
  const push = (start: number, end: number, value: { ymd: string; weekdayMismatch: boolean } | null) => {
    if (!value || !claims.free(start, end)) return;
    claims.claim(start, end, hits.length);
    hits.push({ start, end, ymd: value.ymd, weekdayMismatch: value.weekdayMismatch, quote: text.slice(start, end).trim() });
  };
  const anchored = (end: number, weekday: string | undefined) => Boolean(weekday) || TIME_NEAR_RE.test(text.slice(end, end + 12));
  const unitAfter = (end: number) => AFTER_NUMBER_UNIT_RE.test(text.slice(end, end + 12));

  for (const match of text.matchAll(KOREAN_DATE_RE)) {
    const year = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
    push(match.index, match.index + match[0].length, explicitYmd(year, Number(match[2]), Number(match[3]), match[4]));
  }
  for (const match of text.matchAll(NUMERIC_DATE_RE)) {
    push(match.index, match.index + match[0].length, explicitYmd(Number(match[1]), Number(match[2]), Number(match[3]), match[4]));
  }
  for (const match of text.matchAll(SHORT_YEAR_DATE_RE)) {
    const end = match.index + match[0].length;
    const weekday = match[5] ?? match[6] ?? match[7];
    if (unitAfter(end) || !anchored(end, weekday)) continue;
    push(match.index, end, explicitYmd(2000 + Number(match[1]), Number(match[3]), Number(match[4]), weekday));
  }
  for (const match of text.matchAll(MONTH_DAY_RE)) {
    if (YEAR_RIGHT_BEFORE_RE.test(text.slice(Math.max(0, match.index - 8), match.index))) continue;
    push(match.index, match.index + match[0].length, inferYmd(Number(match[1]), Number(match[2]), match[3], todayYmd));
  }
  for (const match of text.matchAll(NUMERIC_MONTH_DAY_RE)) {
    const end = match.index + match[0].length;
    if (unitAfter(end)) continue;
    const weekday = match[4] ?? match[5] ?? match[6];
    const twoDigitSlash = match[2] === "/" && match[1].length === 2 && match[3].length === 2;
    if (!anchored(end, weekday) && !twoDigitSlash) continue;
    push(match.index, end, inferYmd(Number(match[1]), Number(match[3]), weekday, todayYmd));
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** "밤" 뒤에서 이 시각까지는 자정을 넘긴 새벽이다("밤 1시"는 01:00). */
const NIGHT_LAST_SMALL_HOUR = 4;

function toHour24(meridiem: string, hour: number): number | null {
  if (hour < 0 || hour > 24) return null;
  switch (meridiem) {
    case "밤":
      // "밤 12시"는 자정(00:00)이고 "밤 1시"~"밤 4시"는 새벽이다. 낮 열두 시나 오후 한 시가 아니다.
      return hour === 12 || hour === 0 ? 0 : hour <= NIGHT_LAST_SMALL_HOUR ? hour : hour < 12 ? hour + 12 : hour >= 24 ? null : hour;
    case "오후":
    case "저녁":
      return hour < 12 ? hour + 12 : hour === 12 ? 12 : hour >= 24 ? null : hour;
    case "낮":
    case "점심":
      return hour === 12 ? 12 : hour <= 6 ? hour + 12 : hour;
    default:
      // 오전·아침·새벽
      return hour === 12 ? 0 : hour > 12 ? null : hour;
  }
}

/**
 * "오후 2시~5시"의 끝 시각은 앞 시각의 오전·오후를 따른다. 오전에서 시작해 숫자가 작아지면 정오를 넘긴 것이다
 * ("오전 10시~2시"는 오후 2시까지). 오후·밤에서 시작해 12시에 끝나면 자정이다("밤 10시~12시"). 낮 12시에서 시작했으면 12시다.
 */
function rangeEndHour(startHour: number, hour: number): number {
  if (startHour >= 12) return hour === 12 ? (startHour > 12 ? 0 : 12) : hour + 12;
  if (hour === 12) return 12;
  return hour < startHour ? hour + 12 : hour;
}

/** 두 시각을 잇는 말. 물결은 자판의 ~ 말고 한글 특수문자로 넣은 U+223C·U+301C 로도, 줄표는 U+2013 으로도 온다. */
const RANGE_GAP_RE = /^\s*(?:[~\u223C\u301C\u2013-]|부터|에서)\s*$/;

/** 오전·오후가 없는 1~11시는 상담 영업시간으로 짐작한다: 1~7시는 오후, 8~11시는 오전. */
function guessHour(hour: number): { hour: number; guessed: boolean } | null {
  if (hour === 0 || hour === 12 || (hour >= 13 && hour <= 23)) return { hour, guessed: false };
  if (hour >= 1 && hour <= 7) return { hour: hour + 12, guessed: true };
  if (hour >= 8 && hour <= 11) return { hour, guessed: true };
  return null;
}

type HourReading = { hour: number; guessed: boolean };

const MERIDIEM_WORDS = "오전|오후|아침|낮|점심|저녁|밤|새벽";
/** "오후 2~5시", "오전 10~11시", "오전 10~오후 5시"처럼 앞 시각에 "시"를 쓰지 않은 범위. 앞 시각을 놓치지 않게 다른 시간보다 먼저 읽는다. */
const HOUR_RANGE_RE = new RegExp(
  `(?:(${MERIDIEM_WORDS})\\s*)?(?<![0-9:.])(\\d{1,2})\\s*[~\\u223C\\u301C-]\\s*(?:(${MERIDIEM_WORDS})\\s*)?(\\d{1,2})\\s*시(?!간|즌|절|청|장|대|작|술|식|공|계)(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?`,
  "g",
);
const RANGE_HEAD_RE = new RegExp(`^(?:(?:${MERIDIEM_WORDS})\\s*)?\\d{1,2}`);
const RANGE_MARK_RE = /^\s*[~∼〜-]\s*/;

/**
 * 앞 시각에 "시"가 없는 범위의 두 시각. 앞 시각은 제 오전·오후를, 없으면 끝의 것을 따른다(끝보다 늦어지면 오전이다: "10~오후 2시").
 * 끝 시각은 제 오전·오후를, 없으면 앞 시각에서 이어 센다("오후 2~5시"의 5시도 오후). 둘 다 없으면 앞 시각을 짐작하고 끝도 짐작으로 둔다.
 */
function readHourRange(startMeridiem: string | undefined, startRaw: number, endMeridiem: string | undefined, endRaw: number): { start: HourReading; end: HourReading } | null {
  const endOwn = endMeridiem ? toHour24(endMeridiem, endRaw) : null;
  let start: HourReading | null;
  if (startMeridiem) {
    const hour = toHour24(startMeridiem, startRaw);
    start = hour === null ? null : { hour, guessed: false };
  } else if (endOwn !== null && endMeridiem) {
    const same = toHour24(endMeridiem, startRaw);
    const hour = same !== null && same <= endOwn ? same : toHour24("오전", startRaw);
    start = hour === null ? null : { hour, guessed: false };
  } else {
    start = guessHour(startRaw);
  }
  if (!start) return null;
  if (endMeridiem) return endOwn === null ? null : { start, end: { hour: endOwn, guessed: false } };
  if (endRaw >= 13 && endRaw <= 23) return { start, end: { hour: endRaw, guessed: false } };
  if (endRaw < 1 || endRaw > 12) return null;
  return { start, end: { hour: rangeEndHour(start.hour, endRaw), guessed: start.guessed } };
}

function findTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const claims = createClaims(text.length);
  const push = (start: number, end: number, hour: number | null, minute: number, guessed: boolean) => {
    if (hour === null || minute < 0 || minute > 59 || !claims.free(start, end)) return;
    claims.claim(start, end, hits.length);
    hits.push({ start, end, hour, minute, meridiemGuessed: guessed, quote: text.slice(start, end).trim() });
  };
  const minuteOf = (minuteText: string | undefined, half: string | undefined) => (half ? 30 : minuteText ? Number(minuteText) : 0);
  // 사이가 여섯 글자 안이어야 이어진 범위로 보므로 바로 앞 일곱 글자에서만 앞 시간을 찾는다(앞서 찾은 시간을 모두 훑지 않는다).
  const previousHit = (start: number): TimeHit | undefined => {
    for (let index = start - 1; index >= Math.max(0, start - 7); index -= 1) {
      const owner = claims.ownerAt(index);
      if (owner !== -1) return hits[owner];
    }
    return undefined;
  };

  for (const match of text.matchAll(HOUR_RANGE_RE)) {
    const end = match.index + match[0].length;
    const range = readHourRange(match[1], Number(match[2]), match[3], Number(match[4]));
    if (!range || !claims.free(match.index, end)) continue;
    const headEnd = match.index + (RANGE_HEAD_RE.exec(match[0])?.[0].length ?? 0);
    const mark = RANGE_MARK_RE.exec(text.slice(headEnd, end))?.[0] ?? "";
    push(match.index, headEnd, range.start.hour, 0, range.start.guessed);
    push(headEnd + mark.length, end, range.end.hour, minuteOf(match[5], match[6]), range.end.guessed);
  }
  for (const match of text.matchAll(/(오전|오후|아침|낮|점심|저녁|밤|새벽)\s*(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분|\s*(반))?/g)) {
    push(match.index, match.index + match[0].length, toHour24(match[1], Number(match[2])), minuteOf(match[3], match[4]), false);
  }
  // 오전·오후가 없으면 숫자에서 시작한다. 앞에 빈칸을 받으면 빈칸이 긴 글에서 자리마다 끝까지 훑어 느려진다.
  for (const match of text.matchAll(/(?:(오전|오후|아침|낮|점심|저녁|밤|새벽)\s*)?(?<![0-9:.])([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?![0-9:])/g)) {
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    if (match[1]) {
      push(match.index, match.index + match[0].length, toHour24(match[1], hour), minute, false);
    } else {
      const guess = guessHour(hour);
      push(match.index, match.index + match[0].length, guess?.hour ?? null, minute, guess?.guessed ?? false);
    }
  }
  // "2시가 비어 있어요"의 "가"는 조사다. 시간·시즌·시청처럼 "시"로 시작하는 낱말만 뺀다.
  for (const match of text.matchAll(/(?<![0-9:.])(\d{1,2})\s*시(?!간|즌|절|청|장|대|작|술|식|공|계)(?:\s*(\d{1,2})\s*분|\s*(반))?/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!claims.free(start, end)) continue;
    const hour = Number(match[1]);
    // "오후 2시~5시"처럼 바로 앞 시간과 이어지면 그 오전·오후를 따른다.
    const previous = previousHit(start);
    const gap = previous ? text.slice(previous.end, start) : "";
    if (previous && !previous.meridiemGuessed && gap.length <= 6 && RANGE_GAP_RE.test(gap) && hour >= 1 && hour <= 12) {
      push(start, end, rangeEndHour(previous.hour, hour), minuteOf(match[2], match[3]), false);
      continue;
    }
    const guess = guessHour(hour);
    push(start, end, guess?.hour ?? null, minuteOf(match[2], match[3]), guess?.guessed ?? false);
  }
  return hits.sort((a, b) => a.start - b.start);
}

const pad2 = (value: number) => String(value).padStart(2, "0");

function timeText(hit: TimeHit): string {
  return `${pad2(hit.hour)}:${pad2(hit.minute)}`;
}

/** 업체가 오전·오후를 적지 않아 짐작한 시간은 칩에도 오전·오후를 적지 않는다("2시"). 누를 때 사람이 고른다. */
function timeLabel(hit: TimeHit): string {
  const meridiem = hit.meridiemGuessed ? null : hit.hour < 12 ? VENDOR_REPLY_COPY.am : VENDOR_REPLY_COPY.pm;
  const hour12 = hit.hour % 12 === 0 ? 12 : hit.hour % 12;
  return VENDOR_REPLY_COPY.timeChip(meridiem, hour12, hit.minute);
}

/** 올해가 아닌 날짜(해가 없는 날짜를 내년으로 읽었거나 업체가 다른 해를 적었을 때)는 해를 함께 적는다. */
function dateLabel(ymd: string, todayYmd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const thisYear = Number(todayYmd.slice(0, 4));
  return VENDOR_REPLY_COPY.dateChip(month, day, WEEKDAYS[weekdayOf(ymd)], year === thisYear ? undefined : year);
}

// 금액. "300만원", "300만 원", "6.5만원", "6만 5천원", "1억 2천만원", "3,000,000원", "55,000원".
const AMOUNT_RE = /(?<![0-9.,])\d[\d,]*(?:\.\d+)?(?:\s*(?:억|천|백|만)(?:\s*\d[\d,]*(?:\.\d+)?)?)*\s*(?:억|천|백|만)?\s*원?/g;
const PRICE_SUBJECTS = [
  "대관료", "식대", "인당", "1인", "장식비", "꽃장식", "장식", "생화", "계약금", "예약금", "중도금", "잔금", "보증금",
  "합계", "총액", "총", "패키지", "옵션", "추가금", "추가", "원본", "수정본", "촬영", "앨범", "액자", "메이크업", "헤어",
  "드레스", "턱시도", "예복", "스냅", "영상", "폐백", "주류", "음료", "부가세",
] as const;
const PRICE_CONTEXT_RE = new RegExp(`(?:${PRICE_SUBJECTS.join("|")}|금액|비용|가격|견적|요금)`);

function parseSmallGroup(value: string): number | null {
  if (value === "") return 0;
  const match = /^(?:(\d+(?:\.\d+)?)천)?(?:(\d+(?:\.\d+)?)백)?(\d+(?:\.\d+)?)?$/.exec(value);
  if (!match) return null;
  const thousands = match[1] ? Number(match[1]) * 1000 : 0;
  const hundreds = match[2] ? Number(match[2]) * 100 : 0;
  const ones = match[3] ? Number(match[3]) : 0;
  const total = thousands + hundreds + ones;
  return Number.isFinite(total) ? total : null;
}

const THOUSANDS_ONLY_RE = /^(?:\d+(?:\.\d+)?천)?(?:\d+(?:\.\d+)?백)?$/;

/** 단위 글자가 섞인 금액을 원으로. 못 읽으면 null. */
export function parseKoreanAmount(span: string): number | null {
  const compact = span.replace(/[\s,]/g, "").replace(/원$/, "");
  if (!/^[\d.억천백만]+$/.test(compact) || !/\d/.test(compact)) return null;
  const [eokPart, rest] = compact.includes("억") ? compact.split("억") : ["", compact];
  // "1억2천", "1억 5천"은 말로 "1억 2천만", "1억 5천만"이다. 억 뒤에 만 없이 천·백 단위만 오면(끝에 맨 숫자 없이) 만 단위로 읽는다.
  const manImplied = eokPart !== "" && rest !== "" && THOUSANDS_ONLY_RE.test(rest);
  const [manPart, onesPart] = manImplied ? [rest, ""] : rest.includes("만") ? rest.split("만") : ["", rest];
  if (compact.split("억").length > 2 || rest.split("만").length > 2) return null;
  const eok = eokPart === "" ? 0 : parseSmallGroup(eokPart);
  const man = manPart === "" ? 0 : parseSmallGroup(manPart);
  const ones = parseSmallGroup(onesPart);
  if (eok === null || man === null || ones === null) return null;
  const won = Math.round(eok * 100_000_000 + man * 10_000 + ones);
  return Number.isFinite(won) ? won : null;
}

const withCommas = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function formatWon(won: number): string {
  if (won >= 10_000 && won % 10_000 === 0) return `${withCommas(won / 10_000)}만 원`;
  return `${withCommas(won)}원`;
}

function priceSubjectBefore(text: string, start: number): string | null {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const window = text.slice(Math.max(lineStart, start - 14), start);
  let best: { index: number; subject: string } | null = null;
  for (const subject of PRICE_SUBJECTS) {
    const index = window.lastIndexOf(subject);
    if (index === -1) continue;
    // 같은 자리에서 끝나면 긴 낱말(꽃장식)을 짧은 낱말(장식)보다 앞세운다.
    const end = index + subject.length;
    if (!best || end > best.index + best.subject.length || (end === best.index + best.subject.length && subject.length > best.subject.length)) {
      best = { index, subject };
    }
  }
  if (!best) return null;
  return best.subject === "1인" || best.subject === "인당" ? "1인" : best.subject;
}

type Amount = Span & { raw: string };
type PriceHit = Span & { won: number; upToWon: number | null; subject: string | null; quote: string };

/** 두 금액을 잇는 말("300~400만원", "1500-2000만원", "300에서 400만원"). */
const PRICE_RANGE_GAP_RE = /^ {0,2}(?:[~∼〜-]|에서) {0,2}$/;
const MIN_PRICE_WON = 1_000;
const MAX_PRICE_WON = 10_000_000_000;

/** 금액 끝의 단위 글자. "400만원"은 "만원", "1억 5천만원"은 "천만원", "300"은 빈 글이다. */
const unitsAfterLastDigit = (raw: string) => raw.replace(/^[\s\S]*[0-9]/, "").replace(/\s+/g, "");
const isPriceWon = (won: number | null): won is number => won !== null && won >= MIN_PRICE_WON && won <= MAX_PRICE_WON;

/** 원이 있거나, 억·만이 있고 바로 앞에 금액을 말하는 낱말이 있으면 금액이다("조회수가 6.8만"은 아니다). */
function looksLikePrice(text: string, start: number, raw: string): boolean {
  if (raw.endsWith("원")) return true;
  if (!/[억만]/.test(raw)) return false;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  return PRICE_CONTEXT_RE.test(text.slice(Math.max(lineStart, start - 14), start));
}

function singlePrice(text: string, amount: Amount): PriceHit | null {
  if (!looksLikePrice(text, amount.start, amount.raw)) return null;
  const won = parseKoreanAmount(amount.raw);
  if (!isPriceWon(won)) return null;
  return { start: amount.start, end: amount.end, won, upToWon: null, subject: priceSubjectBefore(text, amount.start), quote: amount.raw };
}

/**
 * 범위로 적은 금액은 두 끝을 한 칩으로 보인다. 위쪽 끝만 칩이 되면 그것이 업체가 말한 값처럼 읽힌다.
 * 아래쪽 끝은 위쪽 끝의 단위를 빌린다("300~400만원"의 300은 300만, "2천~3천만원"의 2천은 2천만).
 */
function rangePrice(text: string, lower: Amount, upper: Amount): PriceHit | null {
  const lowerUnits = unitsAfterLastDigit(lower.raw);
  const upperUnits = unitsAfterLastDigit(upper.raw);
  const lowerRaw = `${lower.raw}${upperUnits.startsWith(lowerUnits) ? upperUnits.slice(lowerUnits.length) : ""}`;
  const low = parseKoreanAmount(lowerRaw);
  const high = parseKoreanAmount(upper.raw);
  if (!isPriceWon(low) || !isPriceWon(high) || low >= high || !looksLikePrice(text, lower.start, lowerRaw)) return null;
  const quote = text.slice(lower.start, upper.end);
  return { start: lower.start, end: upper.end, won: low, upToWon: high, subject: priceSubjectBefore(text, lower.start), quote };
}

function findPrices(text: string, taken: Claims): PriceHit[] {
  const amounts: Amount[] = [];
  for (const match of text.matchAll(AMOUNT_RE)) {
    const raw = match[0].replace(/\s+$/, "");
    const start = match.index;
    if (raw !== "" && taken.free(start, start + raw.length)) amounts.push({ start, end: start + raw.length, raw });
  }
  const hits: PriceHit[] = [];
  for (let index = 0; index < amounts.length; index += 1) {
    const amount = amounts[index];
    const next = amounts[index + 1];
    if (next && PRICE_RANGE_GAP_RE.test(text.slice(amount.end, next.start))) {
      const range = rangePrice(text, amount, next);
      // 아래쪽 끝에 단위가 없으면("300~400만원") 범위로만 읽는다. 둘 다 단위가 있고 범위가 아니면("300만원 - 50만원") 따로 읽는다.
      if (range || unitsAfterLastDigit(amount.raw) === "") {
        if (range) hits.push(range);
        index += 1;
        continue;
      }
    }
    const single = singlePrice(text, amount);
    if (single) hits.push(single);
  }
  return hits;
}

function findCounts(text: string): (Span & { count: number; quote: string })[] {
  const hits: (Span & { count: number; quote: string })[] = [];
  const claims = createClaims(text.length);
  const patterns = [
    /(보증\s*인원|최소\s*인원|최소\s*보증|보증)\s*(?:은|이|:)?\s*(\d{1,4})\s*명/g,
    /(?<![0-9])(\d{2,4})\s*명\s*(?:이상\s*)?보증/g,
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const count = Number(index === 0 ? match[2] : match[1]);
      const start = match.index;
      const end = start + match[0].length;
      if (count < 1 || count > 3000 || !claims.free(start, end)) continue;
      claims.claim(start, end, hits.length);
      hits.push({ start, end, count, quote: match[0].trim() });
    }
  }
  return hits;
}

const PHRASE_KEYWORD_RE = /(가능|불가|마감|대기|가예약|확정|어렵|안\s*됩니다|안\s*돼요|안\s*되|남아\s*있|남았)/;

/** 문장은 마침표·느낌표·물음표 뒤에서 끊되 숫자 뒤의 점("2026. 11. 30.")에서는 끊지 않는다. 날짜 가운데에서 따온 말이 시작하지 않게 한다. */
const SENTENCE_BREAK_RE = /(?<=[^0-9]\.)\s+|(?<=[!?。])\s+|\n+/;

function findPhrases(text: string): string[] {
  const sentences = text.split(SENTENCE_BREAK_RE).map((sentence) => sentence.trim()).filter(Boolean);
  const quotes: string[] = [];
  for (const sentence of sentences) {
    const match = PHRASE_KEYWORD_RE.exec(sentence);
    if (!match) continue;
    const chars = Array.from(sentence);
    let quote = sentence;
    if (chars.length > MAX_QUOTE_CHARS) {
      const keywordAt = Array.from(sentence.slice(0, match.index)).length;
      const from = Math.max(0, Math.min(keywordAt - 20, chars.length - MAX_QUOTE_CHARS));
      quote = `${from > 0 ? "…" : ""}${chars.slice(from, from + MAX_QUOTE_CHARS).join("")}${from + MAX_QUOTE_CHARS < chars.length ? "…" : ""}`;
    }
    if (!quotes.includes(quote)) quotes.push(quote);
    if (quotes.length >= MAX_PHRASES) break;
  }
  return quotes;
}

const CAUTION_RE = /(계좌|입금|송금|이체|무통장|가상\s*계좌|은행|뱅크|예금주|농협|신협|새마을|우체국|결제\s*(?:링크|주소|부탁|요청|해\s*주)|선결제|카드\s*결제\s*링크)/;
/** 가린 링크 앞뒤 이만큼 안에 결제 낱말이 있으면 결제 링크 이야기로 본다. */
const LINK_PAYMENT_WINDOW = 40;
const PAYMENT_WORD_RE = /결제|입금|송금|카드/;

/**
 * 가린 자리의 표시를 같은 길이의 빈칸으로 바꾼 글. "[계좌번호]" 표시에 든 "계좌"가 결제 안내를 켜면, 낱말 없이 숫자 묶음만 보고
 * 가린 계좌도 안내를 켜게 된다. 업체가 쓴 말에서만 돈 이야기를 찾는다.
 */
function withoutMaskLabels(text: string): string {
  return Object.values(VENDOR_REPLY_COPY.maskLabels).reduce((current, label) => current.split(label).join(" ".repeat(label.length)), text);
}

function linkNearPaymentWord(text: string, words: string): boolean {
  const label = VENDOR_REPLY_COPY.maskLabels.link;
  for (let at = text.indexOf(label); at !== -1; at = text.indexOf(label, at + label.length)) {
    if (PAYMENT_WORD_RE.test(words.slice(Math.max(0, at - LINK_PAYMENT_WINDOW), at + label.length + LINK_PAYMENT_WINDOW))) return true;
  }
  return false;
}

/**
 * 카카오톡 대화를 통째로 복사하면 말마다 보낸 시각이 붙는다. 그 시각은 업체가 알려 준 날짜·시간이 아니므로 칩으로 뽑지 않는다.
 * 같은 길이의 빈칸으로 바꾼 글에서 찾아야 찾은 자리가 가린 글의 자리와 그대로 맞는다. 꼴은 넷이다(줄 맨 앞):
 * "[소담하우스] [오후 2:31] …", "2026년 11월 18일 오후 2:31, 소담하우스 : …", "2026. 11. 18. 오후 2:31, 소담하우스 : …",
 * "--------------- 2026년 11월 18일 수요일 ---------------".
 */
const KAKAO_HEADER_RES: readonly RegExp[] = [
  /^\[[^\]\n]{1,40}\] ?\[(?:오전|오후) \d{1,2}:\d{2}\]/gm,
  /^\d{4}년 \d{1,2}월 \d{1,2}일 (?:오전|오후) \d{1,2}:\d{2}, [^\n]{1,40}? : /gm,
  /^\d{4}\. \d{1,2}\. \d{1,2}\. (?:오전|오후) \d{1,2}:\d{2}, [^\n]{1,40}? : /gm,
  /^-{3,} \d{4}년 \d{1,2}월 \d{1,2}일 [일월화수목금토]요일 -{3,} *$/gm,
];

function blankKakaoHeaders(text: string): string {
  return KAKAO_HEADER_RES.reduce((current, re) => current.replace(re, (header) => " ".repeat(header.length)), text);
}

/**
 * 날짜와 시간 사이에 이런 말이 있으면 그 시간은 그 날짜의 것이 아니다("11월 30일까지 답 주시면 오후 2시", "11월 30일은 마감이고 오후 2시는").
 * 문장 끝은 마침표만이 아니다. 업체 문자는 마침표 없이 "…찼습니다 오후 2시는"처럼 이어 쓰므로 "니다" 뒤의 빈칸도 끝으로 본다.
 * "요"는 보지 않는다. "12월 5일은요 오후 2시"처럼 말 중간에도 붙어 문장 끝인지 낱말로 가릴 수 없다.
 */
const PAIR_BREAK_RE = /까지|마감|이고|,|[.!?。](?:\s|$)|니다(?:\s|$)/;
const PAIR_WINDOW_CHARS = 15;

/** 시작 자리가 `from` 이상인 첫 시간의 번호. 시간은 시작 자리 순서로 놓여 있다. */
function firstTimeFrom(times: readonly TimeHit[], from: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle].start < from) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * 같은 줄에서 날짜 바로 뒤(15자 안)의 시간과 묶는다. 사이에 다른 날짜가 있으면 그 시간은 뒤 날짜의 것이다
 * ("11월 30일 (월) 12월 1일 (화) 오후 2시"의 오후 2시는 12월 1일이다). 사이에 끊는 말(위)이 있어도 묶지 않는다.
 */
function pairedTime(text: string, date: DateHit, nextDateStart: number, times: readonly TimeHit[], used: ReadonlySet<TimeHit>): TimeHit | undefined {
  for (let index = firstTimeFrom(times, date.end); index < times.length; index += 1) {
    const hit = times[index];
    if (hit.start >= nextDateStart || hit.start - date.end > PAIR_WINDOW_CHARS) return undefined;
    const gap = text.slice(date.end, hit.start);
    if (gap.includes("\n") || PAIR_BREAK_RE.test(gap)) return undefined;
    if (!used.has(hit)) return hit;
  }
  return undefined;
}

const isSchedulable = (chip: VendorReplyChip): boolean => chip.kind === "datetime" || chip.kind === "date" || chip.kind === "time";

/** 같은 칩(같은 꼴, 같은 글자)은 처음 것만 둔다. 같은 날짜를 두 번 적었고 한 번만 요일이 어긋났어도 어긋났다고 알린다. */
function keepFirstOfEach(chips: readonly VendorReplyChip[]): VendorReplyChip[] {
  const kept: VendorReplyChip[] = [];
  const keptAt = new Map<string, number>();
  for (const chip of chips) {
    const key = `${chip.kind}:${chip.label}`;
    const index = keptAt.get(key);
    if (index === undefined) {
      keptAt.set(key, kept.length);
      kept.push(chip);
      continue;
    }
    const first = kept[index];
    if ((first.kind === "date" || first.kind === "datetime") && "weekdayMismatch" in chip && chip.weekdayMismatch && !first.weekdayMismatch) {
      kept[index] = { ...first, weekdayMismatch: true };
    }
  }
  return kept;
}

/**
 * 붙여 넣은 업체 답을 읽는다. `todayYmd` 는 한국 날짜("YYYY-MM-DD")이고, 해가 없는 날짜의 해를 고를 때만 쓴다.
 * 시험은 이 값을 넣어 같은 결과를 본다.
 */
export function readVendorReply(raw: string, options: { todayYmd?: string } = {}): VendorReplyReading {
  const todayYmd = options.todayYmd && /^\d{4}-\d{2}-\d{2}$/.test(options.todayYmd) ? options.todayYmd : todayYmdInKst();
  const { result: masked, moneyAccount } = maskWithFacts(raw);
  const text = masked.masked;
  // 카카오톡 보낸 시각을 같은 길이의 빈칸으로 바꾼 글. 값은 이 글에서 찾는다(빈칸 밖은 가린 글과 한 글자도 다르지 않다).
  const scan = blankKakaoHeaders(text);

  const dates = findDates(scan, todayYmd);
  const times = findTimes(scan);
  const usedTimes = new Set<TimeHit>();
  const positioned: { at: number; chip: VendorReplyChip }[] = [];

  for (const [index, date] of dates.entries()) {
    const nextDateStart = dates[index + 1]?.start ?? scan.length;
    const time = pairedTime(scan, date, nextDateStart, times, usedTimes);
    if (time) {
      usedTimes.add(time);
      positioned.push({
        at: date.start,
        chip: {
          kind: "datetime",
          ymd: date.ymd,
          time: timeText(time),
          meridiemGuessed: time.meridiemGuessed,
          weekdayMismatch: date.weekdayMismatch,
          label: `${dateLabel(date.ymd, todayYmd)} ${timeLabel(time)}`,
          quote: text.slice(date.start, time.end).trim(),
        },
      });
    } else {
      positioned.push({
        at: date.start,
        chip: { kind: "date", ymd: date.ymd, weekdayMismatch: date.weekdayMismatch, label: dateLabel(date.ymd, todayYmd), quote: date.quote },
      });
    }
  }
  for (const time of times) {
    if (usedTimes.has(time)) continue;
    positioned.push({
      at: time.start,
      chip: { kind: "time", time: timeText(time), meridiemGuessed: time.meridiemGuessed, label: timeLabel(time), quote: time.quote },
    });
  }

  const taken = createClaims(scan.length);
  for (const hit of [...dates, ...times]) taken.claim(hit.start, hit.end, 0);
  for (const count of findCounts(scan)) {
    taken.claim(count.start, count.end, 0);
    positioned.push({ at: count.start, chip: { kind: "count", count: count.count, label: VENDOR_REPLY_COPY.countChip(count.count), quote: count.quote } });
  }
  for (const price of findPrices(scan, taken)) {
    const amount = price.upToWon === null ? formatWon(price.won) : VENDOR_REPLY_COPY.priceRangeChip(formatWon(price.won), formatWon(price.upToWon));
    positioned.push({
      at: price.start,
      chip: { kind: "price", won: price.won, upToWon: price.upToWon, subject: price.subject, label: VENDOR_REPLY_COPY.priceChip(price.subject, amount), quote: price.quote },
    });
  }

  const kindOrder: Record<VendorReplyChip["kind"], number> = { datetime: 0, date: 1, time: 2, count: 3, price: 4, phrase: 5 };
  positioned.sort((a, b) => kindOrder[a.chip.kind] - kindOrder[b.chip.kind] || a.at - b.at);
  const kept = keepFirstOfEach(positioned.map(({ chip }) => chip));
  // 날짜·시간은 여덟 개까지만 두고 그 뒤에 금액·보증 인원·업체가 쓴 말을 붙인다. 날짜가 많아도 금액이 칩 상한에 밀려 사라지지 않는다.
  const chips: VendorReplyChip[] = [...kept.filter(isSchedulable).slice(0, MAX_SCHEDULABLE_CHIPS), ...kept.filter((chip) => !isSchedulable(chip))];
  for (const quote of findPhrases(scan)) chips.push({ kind: "phrase", label: quote, quote });

  // 결제 안내는 돈 이야기 낱말, 결제 낱말 가까이의 링크, 은행·송금 낱말과 함께 가린 계좌에서만 켠다. 낱말 없이 숫자 묶음만 보고 가린 계좌는 켜지 않는다.
  const words = withoutMaskLabels(text);
  const caution = CAUTION_RE.test(words) || (masked.maskedKinds.includes("link") && linkNearPaymentWord(text, words)) || moneyAccount;
  return { ...masked, chips: chips.slice(0, MAX_CHIPS), caution };
}
