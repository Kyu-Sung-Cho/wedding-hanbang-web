export type PublicPersonalInfoKind =
  | "email"
  | "phone"
  | "resident_registration"
  | "passport"
  | "bank_account"
  | "payment_card"
  | "credential"
  | "name_birth_date"
  | "precise_address"
  | "health"
  | "reproductive"
  | "sexual_life"
  | "family_relationship"
  | "vendor_contract_identifier";

export const PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE =
  "공개 영역에 올리기 어려운 개인정보나 민감한 사정이 보여요. 이름과 생년월일의 조합, 연락처, 정확한 주소, 건강·가족 정보, 계약 식별자 등을 지운 뒤 다시 시도해 주세요.";

const HTML_NUMERIC_ENTITY_PATTERN =
  /&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/giu;
const UNICODE_FORMAT_PATTERN = /\p{Cf}/gu;
const COMPACT_SEPARATOR_PATTERN = /[\s._·•/\\|()[\]{}'":;,~\-]+/gu;

const BIRTH_DATE_SOURCE =
  "(?:(?:19|20)\\d{2}\\s*(?:년\\s*|[-./])\\s*(?:0?[1-9]|1[0-2])\\s*(?:월\\s*|[-./])\\s*(?:0?[1-9]|[12]\\d|3[01])\\s*일?|(?:19|20)\\d{6}|\\d{2}\\s*[-./]\\s*(?:0?[1-9]|1[0-2])\\s*[-./]\\s*(?:0?[1-9]|[12]\\d|3[01])|\\d{6})";
const BIRTH_LABEL_SOURCE =
  "(?:생년\\s*월일|출생\\s*일|생일|date\\s*of\\s*birth|d\\s*o\\s*b)";
const PERSON_NAME_SOURCE =
  "(?:[가-힣]{2,6}|[a-z]{2,}(?:\\s+[a-z]{2,}){1,3})";
const NAME_LABEL_SOURCE =
  `(?:(?:제|본인|신부|신랑|예비\\s*신부|예비\\s*신랑)\\s*)?(?:이름|성명|본명)\\s*(?:은|는|이|가|[:=])?\\s*${PERSON_NAME_SOURCE}`;

const ROAD_ADDRESS_PATTERN =
  /[가-힣a-z0-9]{2,}(?:대로|로|길)\s*\d{1,5}(?:\s*-\s*\d{1,5})?/iu;
const PARCEL_ADDRESS_PATTERN =
  /[가-힣]{1,20}(?:읍|면|동|리)\s*(?:산\s*)?\d{1,5}(?:\s*-\s*\d{1,5})?/u;
const BUILDING_UNIT_PATTERN =
  /\d{1,4}\s*동\s*\d{1,4}\s*호/u;
const POSTAL_ADDRESS_PATTERN =
  /(?:우편\s*번호|postal\s*code)\s*[:=]?\s*\d{5}\b/iu;

const HEALTH_TERM_SOURCE =
  "(?:당뇨|고혈압|저혈압|암|hiv|aids|우울증|공황\\s*장애|조현병|양극성\\s*장애|adhd|자폐|알레르기|질환|질병|장애|병력|진단명|복용약|처방약|인슐린)";
const HEALTH_STATUS_SOURCE =
  "(?:진단|치료|투병|복용|처방|수술|입원|통원|상담|검사|양성|음성|앓|때문|있(?:어|어요|습니다|음)|받(?:아|았|는|고)|중)";
const REPRODUCTIVE_TERM_SOURCE =
  "(?:임신|난임|불임|시험관|인공\\s*수정|유산|낙태|배란|생리|피임|출산|태아|산부인과)";
const REPRODUCTIVE_STATUS_SOURCE =
  "(?:\\d{1,2}\\s*주차|진단|치료|시술|진료|상담|계획|준비|예정|검사|양성|음성|문제|상태|때문|중|했|받|조정)";
const FAMILY_MEMBER_SOURCE =
  "(?:부모님|부모|아버지|어머니|엄마|아빠|시어머니|시아버지|장인|장모|친정|시댁|형제|자매|가족|남편|아내|배우자|파트너)";
const FAMILY_SENSITIVE_STATUS_SOURCE =
  "(?:이혼|재혼|별거|절연|연락\\s*(?:을\\s*)?끊|사망|돌아가|입양|파양|가정\\s*폭력|학대|폭력|강요|결혼\\s*반대|혼외자|한부모|채무|빚|전과)";

function decodeNumericCharacterReferences(value: string): string {
  return value.replace(
    HTML_NUMERIC_ENTITY_PATTERN,
    (match, hexadecimal: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hexadecimal ?? decimal ?? "", hexadecimal ? 16 : 10);
      if (
        !Number.isInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function visibleText(values: Array<string | null | undefined>): {
  text: string;
  compact: string;
} {
  const text = decodeNumericCharacterReferences(values.filter(Boolean).join(" "))
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&commat;|&commat/giu, "@")
    .replace(/&period;|&period/giu, ".")
    .replace(/&hyphen;|&hyphen|&minus;|&minus/giu, "-")
    .replace(/&sol;|&sol/giu, "/")
    .replace(/&nbsp;|&#160;|&#xa0;/giu, " ")
    .normalize("NFKC")
    .replace(UNICODE_FORMAT_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();

  return {
    text,
    compact: text.replace(COMPACT_SEPARATOR_PATTERN, ""),
  };
}

function matchesNameAndBirthDate(text: string): boolean {
  const labelledNameThenBirth = new RegExp(
    `${NAME_LABEL_SOURCE}.{0,120}${BIRTH_LABEL_SOURCE}.{0,24}${BIRTH_DATE_SOURCE}`,
    "iu",
  );
  const labelledBirthThenName = new RegExp(
    `${BIRTH_LABEL_SOURCE}.{0,24}${BIRTH_DATE_SOURCE}.{0,120}${NAME_LABEL_SOURCE}`,
    "iu",
  );
  const nameBesideBirthDate = new RegExp(
    `${PERSON_NAME_SOURCE}\\s*[([]?\\s*${BIRTH_DATE_SOURCE}\\s*(?:일\\s*)?생\\s*[)\\]]?`,
    "iu",
  );

  return labelledNameThenBirth.test(text)
    || labelledBirthThenName.test(text)
    || nameBesideBirthDate.test(text);
}

function matchesPreciseAddress(text: string): boolean {
  return ROAD_ADDRESS_PATTERN.test(text)
    || PARCEL_ADDRESS_PATTERN.test(text)
    || BUILDING_UNIT_PATTERN.test(text)
    || POSTAL_ADDRESS_PATTERN.test(text);
}

function matchesHealthDisclosure(text: string, compact: string): boolean {
  const healthStatus = new RegExp(
    `${HEALTH_TERM_SOURCE}.{0,32}${HEALTH_STATUS_SOURCE}`,
    "iu",
  );
  const labelledHealth = new RegExp(
    "(?:건강\\s*정보|의료\\s*정보|병력|진단명|복용약|처방약)\\s*[:=]",
    "iu",
  );
  const careSchedule = /(?:병원|정신과|산부인과)\s*(?:진료|치료|상담|예약|통원)/iu;
  const compactHealthStatus = new RegExp(
    `${HEALTH_TERM_SOURCE}${HEALTH_STATUS_SOURCE}`,
    "iu",
  );
  return healthStatus.test(text)
    || labelledHealth.test(text)
    || careSchedule.test(text)
    || compactHealthStatus.test(compact);
}

function matchesReproductiveDisclosure(text: string, compact: string): boolean {
  const reproductiveStatus = new RegExp(
    `(?:현재\\s*)?${REPRODUCTIVE_TERM_SOURCE}\\s*(?:은|는|이|가|을|를|으로|로)?\\s*.{0,20}${REPRODUCTIVE_STATUS_SOURCE}`,
    "iu",
  );
  const compactReproductiveStatus = new RegExp(
    `${REPRODUCTIVE_TERM_SOURCE}${REPRODUCTIVE_STATUS_SOURCE}`,
    "iu",
  );
  return reproductiveStatus.test(text)
    || compactReproductiveStatus.test(compact);
}

function matchesFamilyRelationshipDisclosure(text: string, compact: string): boolean {
  const memberThenStatus = new RegExp(
    `${FAMILY_MEMBER_SOURCE}.{0,48}${FAMILY_SENSITIVE_STATUS_SOURCE}`,
    "iu",
  );
  const statusThenMember = new RegExp(
    `${FAMILY_SENSITIVE_STATUS_SOURCE}.{0,48}${FAMILY_MEMBER_SOURCE}`,
    "iu",
  );
  const namedFamilyMember = new RegExp(
    `${FAMILY_MEMBER_SOURCE}.{0,16}(?:이름|성명|성함)\\s*(?:은|는|이|가|[:=])?\\s*${PERSON_NAME_SOURCE}`,
    "iu",
  );
  return memberThenStatus.test(text)
    || statusThenMember.test(text)
    || namedFamilyMember.test(text)
    || /가족\s*관계\s*증명서/iu.test(text)
    || memberThenStatus.test(compact)
    || statusThenMember.test(compact)
    || namedFamilyMember.test(compact)
    || /가족관계증명서/iu.test(compact);
}

function matchesVendorContractIdentifier(text: string, compact: string): boolean {
  const labelledIdentifier =
    /(?:계약(?:서)?|예약|접수|주문|견적(?:서)?|상담|고객|거래|청구|인보이스|booking|reservation|contract|order|invoice|reference)\s*(?:번호|no\.?|id|식별자|코드|code)\s*[:=#-]?\s*[a-z0-9][a-z0-9._/-]{2,}/iu;
  const namedContractParty =
    /(?:계약자|예약자|주문자|고객)\s*(?:명|이름|성명)\s*[:=]?\s*(?:[가-힣]{2,6}|[a-z]{2,}(?:\s+[a-z]{2,}){1,3})/iu;
  const documentHash =
    /(?:계약서|예약\s*확인서|견적서|invoice)\s*#\s*[a-z0-9][a-z0-9._/-]{2,}/iu;
  const privateContractLink =
    /(?:계약|예약)(?:\s*확인)?\s*링크.{0,24}https?:\/\/\S+(?:token|code|booking|reservation|contract|id)=/iu;
  return labelledIdentifier.test(text)
    || namedContractParty.test(text)
    || documentHash.test(text)
    || privateContractLink.test(text)
    || labelledIdentifier.test(compact)
    || namedContractParty.test(compact)
    || documentHash.test(compact);
}

/**
 * Finds high-risk identifiers and sensitive personal circumstances before a
 * community value can become public. The detector deliberately favors
 * preventing accidental disclosure over preserving every borderline post.
 * It cannot inspect text rendered inside uploaded images or video.
 */
export function findObviousPublicPersonalInfo(
  ...values: Array<string | null | undefined>
): PublicPersonalInfoKind[] {
  const { text, compact } = visibleText(values);
  const matches: Array<[PublicPersonalInfoKind, boolean]> = [
    [
      "email",
      /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu.test(text)
        || /\b[a-z0-9._%+-]+\s*(?:\[\s*at\s*\]|\(\s*at\s*\))\s*[a-z0-9.-]+\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\))\s*[a-z]{2,}\b/iu.test(text),
    ],
    [
      "phone",
      /(?:^|[^\d])(?:01[016789]|02|0[3-6][1-5])[-./\s]?\d{3,4}[-./\s]?\d{4}(?:[^\d]|$)/u.test(text)
        || /(?:^|[^\d])(?:\+?82[-./\s]?)?10[-./\s]?\d{3,4}[-./\s]?\d{4}(?:[^\d]|$)/u.test(text),
    ],
    [
      "resident_registration",
      /(?:^|[^\d])\d{6}[-./\s]?[1-8]\d{6}(?:[^\d]|$)/u.test(text),
    ],
    [
      "passport",
      /(?:여권\s*(?:번호)?|passport\s*(?:no\.?|number)?)\s*[:=]?\s*[a-z]{1,2}[-\s]?\d{7,8}\b/iu.test(text),
    ],
    [
      "bank_account",
      /(?:계좌|입금\s*계좌|은행\s*계좌|예금주)[^0-9]{0,16}\d{2,6}(?:[-\s]?\d{2,6}){2,4}/u.test(text),
    ],
    [
      "payment_card",
      /(?:카드\s*(?:번호)?|card\s*(?:no\.?|number)?)\s*[:=]?\s*(?:\d[-\s]?){12,19}\b/iu.test(text),
    ],
    [
      "credential",
      /(?:비밀번호|비번|패스워드|password|pwd|인증\s*번호|otp)\s*[:=은는]?\s*\S{3,}/iu.test(text),
    ],
    [
      "name_birth_date",
      matchesNameAndBirthDate(text) || matchesNameAndBirthDate(compact),
    ],
    [
      "precise_address",
      matchesPreciseAddress(text) || matchesPreciseAddress(compact),
    ],
    ["health", matchesHealthDisclosure(text, compact)],
    ["reproductive", matchesReproductiveDisclosure(text, compact)],
    [
      "sexual_life",
      /(?:성\s*생활|성\s*관계|성적\s*(?:취향|지향|문제)|성\s*기능|섹스)/iu.test(text)
        || /(?:성생활|성관계|성적취향|성적지향|성적문제|성기능|섹스)/iu.test(compact),
    ],
    [
      "family_relationship",
      matchesFamilyRelationshipDisclosure(text, compact),
    ],
    [
      "vendor_contract_identifier",
      matchesVendorContractIdentifier(text, compact),
    ],
  ];

  return matches
    .filter(([, matched]) => matched)
    .map(([kind]) => kind);
}
