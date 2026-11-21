import { stripInvisibleChars } from "@/lib/ai/webLookup/webLookupText";
/**
 * 네이버로 나가는 검색어를 서버가 정한다(08장 H3, D-85).
 *
 * 모델이 쓴 검색어를 그대로 보내지 않는다. 네 겹으로 거른다. NAVER API HUB 이용약관(시행 2026.10.07)
 * 일반조건 7.4 ⑦ 도 이용고객의 개인정보가 네이버로 가지 않게 하라고 정한다.
 *   1. 개인정보로 보이는 것(전화번호·이메일·주민등록번호·카드번호·긴 숫자·동호수·주소 번지·주소창 주소)을
 *      지운다. 그 전에 다른 문자 체계의 숫자를 0-9 로, 숫자 사이의 낯선 구분자(`/`, `·`, 유니코드 줄표)를
 *      `-` 로 맞춘다(2026-11-20 보안 검토: `010/1234/5678`, `٠١٠…` 이 빠져나갔다).
 *   2. 커플 이름(부르는 쪽이 넘긴 `blockedTerms`)이 든 낱말을 지운다. 사용자가 이름을 쳤어도 보내지 않는다.
 *   3. 후기·순위·추천 낱말을 지운다. 업체 평판과 후기는 다루지 않는다(D-14 조건, I14).
 *   4. 남은 낱말은 **사용자가 직접 친 말**에 있거나 **닫힌 낱말 목록**(지역·웨딩 업체 종류·정보 낱말)에
 *      있을 때만 보낸다. 모델이 커플 정보를 읽은 턴이라도, 사용자가 말하지 않은 이름·날짜·예산은
 *      이 검사에서 빠진다. 사용자 문장이 없는 일(맡은 일 등)은 닫힌 목록만 통과한다.
 */

export type WebLookupQueryRemoval =
  | "phone"
  | "email"
  | "resident_number"
  | "card_number"
  | "long_number"
  | "home_unit"
  | "address_number"
  | "url"
  | "person_name"
  | "review_or_ranking"
  | "not_from_user";

export type PreparedWebLookupQuery =
  | { ok: true; query: string; removed: WebLookupQueryRemoval[] }
  | { ok: false; reason: "empty" | "nothing_left"; removed: WebLookupQueryRemoval[] };

const MAX_QUERY_CHARS = 40;
const MAX_QUERY_TOKENS = 6;

const PII_PATTERNS: ReadonlyArray<{
  kind: WebLookupQueryRemoval;
  pattern: RegExp;
  /** 걸린 조각을 정말 지울지. 없으면 늘 지운다. */
  accept?: (match: string) => boolean;
}> = [
  { kind: "url", pattern: /\b(?:https?:\/\/|www\.)\S+/giu },
  { kind: "email", pattern: /[^\s@]+@[^\s@]+\.[^\s@]+/gu },
  // 숫자 덩어리는 앞뒤가 숫자가 아닐 때만 맞춘다. 안 그러면 계좌번호 `110-123-456789` 의 가운데를
  // 전화번호로 지우고 꼬리 "89" 를 남긴다(2026-11-20 시험이 잡았다).
  { kind: "resident_number", pattern: /(?<!\d)\d{6}\s*[-–]?\s*[1-8]\d{6}(?!\d)/gu },
  { kind: "card_number", pattern: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{3,4}(?!\d)/gu },
  { kind: "phone", pattern: /(?<!\d)(?:\+?82[\s-]?)?0?1[016789][\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)|(?<!\d)0\d{1,2}[\s.-]\d{3,4}[\s.-]\d{4}(?!\d)/gu },
  // 계좌번호(10~14자리) 같은 긴 숫자. 위 셋에 안 걸린 숫자 덩어리를 본다. 날짜·금액을 지우지 않게
  // 숫자가 9개 이상일 때만 지운다.
  {
    kind: "long_number",
    pattern: /\d(?:[\d\s,.-]*\d)?/gu,
    accept: (match) => match.replace(/\D/gu, "").length >= 9,
  },
  // 동·호수: `101동 1203호`, `제101동 제1203호`, `B동 302호`, `101-1203호`, 그리고 호만 적은 `1203호`.
  // 호만 적은 것은 세·네 자리일 때만 보고, `3호선`·`1호점`·`호텔` 은 건드리지 않는다.
  { kind: "home_unit", pattern: /(?:제\s*)?(?:\d{1,4}|[A-Za-z])\s*동\s*(?:제\s*)?\d{1,4}\s*호/gu },
  { kind: "home_unit", pattern: /(?<!\d)\d{1,4}\s*-\s*\d{1,4}\s*호(?![선점텔])/gu },
  { kind: "home_unit", pattern: /(?<!\d)\d{3,4}\s*호(?![선점텔])/gu },
  // 주소 번지: `역삼동 123-45`, `테헤란로 123`. 지역 낱말은 남기고 숫자만 지운다.
  { kind: "address_number", pattern: /(?<=[동리로길]\s?)\d{1,5}(?:\s*-\s*\d{1,5})?(?![\d번층분년월일시])/gu },
];

/** 다른 문자 체계의 숫자(아라비아-인도 숫자 등)를 0-9 로 바꾼다. 전각 숫자는 NFKC 가 이미 바꾼다. */
function asciiDigits(value: string): string {
  return value.replace(/\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0) ?? 0x30;
    if (code <= 0x39) return digit;
    let zero = code;
    while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    return String((code - zero) % 10);
  });
}

/** 숫자 사이의 낯선 구분자(`/`, `·`, `‐`, `_` 등)를 `-` 로 맞춘다. 쉼표·마침표·줄표·빈칸은 아래 패턴이 본다. */
function unifyDigitSeparators(value: string): string {
  return value.replace(/(?<=\d)[^\p{L}\p{N}\s,.-]+(?=\d)/gu, "-");
}

/** 개인정보로 보이는 조각을 지운다. 검색어와, 출처 검사에 쓰는 사용자 문장에 똑같이 건다. */
function scrubPersonalData(text: string, removed?: Set<WebLookupQueryRemoval>): string {
  let scrubbed = unifyDigitSeparators(asciiDigits(text));
  for (const { kind, pattern, accept } of PII_PATTERNS) {
    const next = scrubbed.replace(pattern, (match) => (accept && !accept(match) ? match : " "));
    if (next !== scrubbed) removed?.add(kind);
    scrubbed = next;
  }
  return scrubbed;
}

const REVIEW_OR_RANKING_RE =
  /^(?:후기|후기들|리뷰|평점|별점|평판|순위|랭킹|추천|추천순|베스트|best|top\d*|\d+위|1위|인기|인기순|만족도|솔직|솔직후기|내돈내산|체험단|협찬|광고)$/iu;

/** 사용자 문장에 없어도 보낼 수 있는 지역 이름. 커플 정보에서 온 지역이 여기 걸린다. */
const REGION_TERMS: readonly string[] = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남",
  "충청", "전북", "전남", "전라", "경북", "경남", "경상", "제주",
  "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구",
  "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구",
  "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구",
  "강남", "강동", "강북", "강서", "관악", "광진", "구로", "금천", "노원", "도봉", "동대문", "동작",
  "마포", "서대문", "서초", "성동", "성북", "송파", "양천", "영등포", "용산", "은평", "종로", "중랑",
  "청담", "압구정", "신사", "논현", "역삼", "삼성", "선릉", "잠실", "여의도", "홍대", "합정", "성수",
  "건대", "신촌", "광화문", "명동", "을지로", "이태원", "한남", "목동", "수서", "문정",
  "수원", "성남", "분당", "판교", "용인", "고양", "일산", "부천", "안양", "안산", "화성", "동탄",
  "평택", "의정부", "남양주", "파주", "김포", "광명", "하남", "시흥", "구리", "군포", "의왕", "오산",
  "이천", "양주", "춘천", "원주", "강릉", "청주", "천안", "아산", "전주", "익산", "목포", "여수",
  "순천", "포항", "경주", "구미", "창원", "김해", "진주", "양산", "서귀포", "해운대", "송도",
];

/** 웨딩 업체 종류와 공식 정보를 찾을 때 쓰는 낱말. 업체 평판 낱말은 없다(위에서 지운다). */
const WEDDING_LOOKUP_TERMS: readonly string[] = [
  "웨딩", "웨딩홀", "예식장", "결혼식장", "예식", "결혼식", "하우스웨딩", "스몰웨딩", "야외웨딩",
  "호텔웨딩", "채플", "컨벤션", "웨딩컨벤션", "호텔", "연회장", "스드메", "스튜디오", "웨딩스튜디오",
  "웨딩촬영", "본식", "본식스냅", "스냅", "드레스", "웨딩드레스", "메이크업", "헤어", "헤어메이크업",
  "한복", "예복", "턱시도", "예물", "반지", "웨딩밴드", "청첩장", "답례품", "부케", "플라워",
  "혼주", "혼주한복", "폐백", "이바지", "상견례", "한정식", "신혼여행", "허니문", "혼수", "가전",
  "식대", "대관료", "가격", "가격표", "비용", "요금", "견적", "패키지", "보증인원", "공식",
  "홈페이지", "사이트", "위치", "주차", "상담", "투어", "영업시간", "연락처", "오시는길", "식사",
];

const CLOSED_VOCABULARY = new Set<string>([...REGION_TERMS, ...WEDDING_LOOKUP_TERMS]);

function normalizeText(value: string): string {
  return stripInvisibleChars(value)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function compact(value: string): string {
  return normalizeText(value).toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
}

function stripTokenPunctuation(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * 지울 이름 조각. 이름 전체와, 세 글자 이상이면 앞 한 글자(성)를 뺀 이름도 지운다("김지은" → "지은이"도
 * 걸린다). 두 글자 미만은 거의 모든 문장에 들어 있어 쓰지 않는다.
 */
function blockedNameFragments(blockedTerms: readonly string[]): string[] {
  const fragments = new Set<string>();
  for (const term of blockedTerms) {
    const name = compact(term);
    const chars = Array.from(name);
    if (chars.length >= 2) fragments.add(name);
    if (chars.length >= 3) fragments.add(chars.slice(1).join(""));
  }
  return [...fragments];
}

export function prepareWebLookupQuery(
  rawQuery: string,
  options: { userTexts: readonly string[]; blockedTerms?: readonly string[] },
): PreparedWebLookupQuery {
  const removed = new Set<WebLookupQueryRemoval>();
  let text = normalizeText(rawQuery ?? "");
  if (!text) return { ok: false, reason: "empty", removed: [] };

  text = scrubPersonalData(text, removed);

  // 사용자 문장도 똑같이 지운 뒤 대조한다. 사용자가 친 계좌번호의 조각("89")이 "사용자가 한 말" 로
  // 통과하지 않게 한다.
  const userCompact = options.userTexts.map((userText) => compact(scrubPersonalData(normalizeText(userText)))).filter(Boolean);
  const nameFragments = blockedNameFragments(options.blockedTerms ?? []);
  const kept: string[] = [];
  for (const rawToken of text.split(" ")) {
    const token = stripTokenPunctuation(rawToken);
    if (!token) continue;
    if (nameFragments.some((fragment) => compact(token).includes(fragment))) {
      removed.add("person_name");
      continue;
    }
    if (REVIEW_OR_RANKING_RE.test(token)) {
      removed.add("review_or_ranking");
      continue;
    }
    const tokenCompact = compact(token);
    const inVocabulary = CLOSED_VOCABULARY.has(token) || CLOSED_VOCABULARY.has(tokenCompact);
    // 한 글자 낱말은 거의 모든 문장에 들어 있어 "사용자가 말했다" 의 근거가 못 된다.
    const fromUser = Array.from(tokenCompact).length >= 2
      && userCompact.some((userText) => userText.includes(tokenCompact));
    if (!inVocabulary && !fromUser) {
      removed.add("not_from_user");
      continue;
    }
    if (!kept.includes(token)) kept.push(token);
    if (kept.length >= MAX_QUERY_TOKENS) break;
  }

  let query = kept.join(" ");
  if (Array.from(query).length > MAX_QUERY_CHARS) {
    query = Array.from(query).slice(0, MAX_QUERY_CHARS).join("").replace(/\s+\S*$/u, "").trim();
  }
  if (Array.from(query.replace(/\s+/gu, "")).length < 2) {
    return { ok: false, reason: "nothing_left", removed: [...removed] };
  }
  return { ok: true, query, removed: [...removed] };
}

/** 사람이 읽는 뺀 것 이름. 모델에게 "무엇을 빼고 찾았는지" 를 알려 줄 때 쓴다. */
export const WEB_LOOKUP_REMOVAL_LABELS: Readonly<Record<WebLookupQueryRemoval, string>> = {
  phone: "전화번호",
  email: "이메일",
  resident_number: "주민등록번호",
  card_number: "카드번호",
  long_number: "긴 숫자",
  home_unit: "동·호수",
  address_number: "주소 번지",
  url: "주소창 주소",
  person_name: "이름",
  review_or_ranking: "후기·순위 낱말",
  not_from_user: "대화에 없던 낱말",
};
