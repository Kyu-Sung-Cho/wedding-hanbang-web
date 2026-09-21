// 기존 메모리 DLP를 모델 호출 모듈 없이 승인·저장 경계에서 재사용한다.
const HTML_NUMERIC_ENTITY_PATTERN =
  /&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/giu;
const UNICODE_FORMAT_PATTERN = /\p{Cf}/gu;
const SENSITIVE_COMPACT_SEPARATOR_PATTERN =
  /[\s._·•/\\|()[\]{}'":;,~\-]+/gu;
const SENSITIVE_TOKEN_PATTERNS = [
  "\\b\\d{6}[- .]?[1-8]\\d{6}\\b", // Korean resident/foreigner registration number
  "\\b01[016789][- ./]?\\d{3,4}[- ./]?\\d{4}\\b", // Korean mobile number
  "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b", // email
  "\\b(?:\\d[- .]?){9,18}\\d\\b", // unlabeled account/card/phone-like long number
  "(?:계좌(?:번호)?|account)\\s*[:=은는]?\\s*[\\d -]{8,}",
  "(?:카드(?:번호)?|card)\\s*[:=은는]?\\s*[\\d -]{12,}",
  "(?:비밀번호|비번|패스워드|password|pwd)\\s*[:=은는]?\\s*\\S+",
  "(?:집|자택|거주지)?주소\\s*[:=은는]?\\s*[^,\\n]{3,100}",
  "(?:[가-힣A-Za-z0-9]+(?:로|길)\\s*\\d{1,5}(?:[- ]\\d{1,5})?)", // street-level address
  "(?:(?:[가-힣]{1,20}(?:시|군|구))\\s+)?[가-힣]{1,20}(?:읍|면|동|리)\\s+\\d{1,5}(?:-\\d{1,5})?", // parcel-level address
  "(?:현재(?:\\s+임신)?|임신|아기|태아)\\s*(?:상태(?:는|가)?\\s*)?(?:[1-9]|[1-3]\\d|4[0-5])\\s*주차", // pregnancy week without a semantic key
  "(?:난임|불임|시험관|인공\\s*수정|유산|낙태|배란|생리|피임|산부인과|출산|태아)\\s*[^,.\\n]{0,80}",
  "(?:병원|정신과|산부인과)\\s*(?:진료|치료|상담|예약|통원)\\s*[^,.\\n]{0,80}",
  "(?:질병|질환|진단|임신|알레르기|성\\s*생활|성\\s*관계|성기능|당뇨|인슐린|암|투병|수술|복용|처방|우울증|공황\\s*장애|조현병|정신과|혈압|HIV|\\bmedical\\b|\\bhealth\\b|diagnos(?:is|ed)?|pregnan(?:t|cy)?|fertility|infertility|reproductive|sexual\\s*health|\\bdisease\\b)\\s*[^,.\\n]{0,80}",
] as const;

const SENSITIVE_SEMANTIC_PATTERNS = [
  "(?:^|\\n)\\s*(?:health|medical|diagnosis|pregnancy|mental_health|reproductive(?:_health)?|fertility|infertility|sexual_health|sex_life|medication|allergy|disability|treatment|hospital)(?::|\\s*(?:\\n|$))",
  "(?:^|\\n)\\s*(?:identity:(?:birth(?:_date)?|passport|rrn|ssn|national_id)|travel:passport)(?:\\s|$)",
  "(?:^|\\n)\\s*family:(?:baby|pregnan(?:cy|t)|gestation|fertility|infertility|reproductive|childbirth|miscarriage)[a-z0-9_]*(?:\\s|$)",
  "(?:\\uC0DD\\uB144\\uC6D4\\uC77C|\\uCD9C\\uC0DD\\uC77C|date\\s*of\\s*birth|dob)\\s*[:=\\uC740\\uB294]?\\s*(?:19|20)\\d{2}\\s*(?:[-./]|\\uB144\\s*)\\s*(?:0?[1-9]|1[0-2])\\s*(?:[-./]|\\uC6D4\\s*)\\s*(?:0?[1-9]|[12]\\d|3[01])(?:\\s*\\uC77C)?",
  "(?:\\uC5EC\\uAD8C(?:\\uBC88\\uD638)?|passport(?:\\s*(?:no\\.?|number))?)\\s*[:=\\uC740\\uB294]?\\s*[A-Z]{1,2}[- ]?\\d{7,8}\\b",
  "(?:family:(?:baby|pregnan(?:cy|t)|gestation)[a-z0-9_]*|baby_timing|pregnan(?:t|cy)?|gestation|\\uC784\\uC2E0|\\uD0DC\\uC544|\\uCD9C\\uC0B0)[\\s\\S]{0,120}(?:[1-9]|[1-3]\\d|4[0-5])\\s*(?:\\uC8FC\\uCC28|weeks?)",
] as const;

const SENSITIVE_PATTERNS = [
  ...SENSITIVE_TOKEN_PATTERNS,
  ...SENSITIVE_SEMANTIC_PATTERNS,
] as const;

const SENSITIVE_COMPACT_PATTERNS = [
  "(?:임신|난임|불임|시험관|인공수정|유산|낙태|배란|생리|피임|산부인과|출산|태아)",
  "(?:성생활|성관계|성기능|성적취향|성적지향|성적문제|섹스)",
  "(?:당뇨|고혈압|저혈압|hiv|aids|우울증|공황장애|조현병|양극성장애|adhd|자폐|알레르기|질환|질병|병력|진단명|복용약|처방약|인슐린)",
  "(?:병원|정신과|산부인과)(?:진료|치료|상담|예약|통원)",
  "(?:reproductive|fertility|infertility|sexualhealth|sexlife|mentalhealth|health(?:care|data|condition|status|diagnosis))",
  "(?:family)(?:baby|pregnancy|pregnant|gestation|fertility|infertility|reproductive|childbirth|miscarriage)",
] as const;

function sensitivePattern(source: string, global = false): RegExp {
  return new RegExp(source, global ? "giu" : "iu");
}

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

export function canonicalizeAmoraMemoryText(value: string): string {
  return decodeNumericCharacterReferences(value)
    .normalize("NFKC")
    .replace(UNICODE_FORMAT_PATTERN, "")
    .trim();
}

export function containsPotentialSensitiveData(value: string): boolean {
  const canonical = canonicalizeAmoraMemoryText(value);
  const compact = canonical.replace(SENSITIVE_COMPACT_SEPARATOR_PATTERN, "");
  return SENSITIVE_PATTERNS.some((source) => sensitivePattern(source).test(canonical))
    || SENSITIVE_COMPACT_PATTERNS.some(
      (source) => sensitivePattern(source).test(compact),
    );
}

export function redactPotentialSensitiveData(value: string): string {
  const redacted = SENSITIVE_PATTERNS.reduce(
    (result, source) => result.replace(sensitivePattern(source, true), "[민감정보 제외]"),
    canonicalizeAmoraMemoryText(value),
  );
  const compactRedacted = redacted.replace(SENSITIVE_COMPACT_SEPARATOR_PATTERN, "");
  if (
    SENSITIVE_COMPACT_PATTERNS.some(
      (source) => sensitivePattern(source).test(compactRedacted),
    )
  ) {
    return "[민감정보 제외]";
  }
  return redacted;
}
