/**
 * 웨딩코드 4.0 문항 은행 검사기(lint). 원본은 docs/wedding-code/2026-09-29_v40_items.json 이고 생성기
 * (scripts/build-wedding-code-v40-bank.mjs)와 명령줄(scripts/wedding-code-v40-bank-lint.mjs)이 이 모듈을 부른다.
 *
 * 검사는 세 종류다.
 *   structure  구조와 배치 골격 일치(id, 주제, 측면, 구간, 화면, 형식, 종류, 키), 형식별 모양, 극 배열에서 파생한 키.
 *   balance    방향 균형(주제와 형식마다 키 합 0, 구간 c 와 c+2 의 거울, 자기 묘사와 간접 개수)과 정적 균형 시험
 *              (고정 응답과 위치 함수 응답의 형식별 합이 폼 비트 0, 1 에서 모두 정확히 0, 기준 계산기로 계산).
 *   content    글자 수, 금지어, 줄표, 숫자, 기호 라벨, 「~인 답」, 해요체 휴리스틱, 중복 주제, 두 극의 길이 균형 등 문구 규칙.
 *
 * placeholder(자리표시) 정책
 *   - 은행 또는 문항에 placeholder: true 가 남아 있으면 기본은 오류(placeholder-present). 실제 문구가 들어오면 표시를 지운다.
 *   - allowPlaceholder 가 켜지면 placeholder-present 는 경고가 되고, placeholder 문항의 content 위반도 경고로 내려간다.
 *     structure 와 balance 위반은 어떤 경우에도 오류다.
 *
 * 내보내는 것
 *   lintBank(data, options)       은행 원본을 검사한다. options: { allowPlaceholder, layout, balanceTrials }. 반환 { errors, warnings, stats }.
 *   lintBankFile(path, options)   파일을 읽어 lintBank 를 부른다.
 *   formatReport(result, options) 사람이 읽는 보고서(options.verbose 이면 규칙마다 전부).
 *   RULES                         규칙 id -> { category, severity, description }. 시험이 모든 오류 규칙의 변형 시험 유무를 이것으로 센다.
 *   LIMITS                        글자 수 상한과 15퍼센트, 소재 유사도 상한.
 *   LETTER_NAMES, ENGLISH_NAMES, AXIS_TITLES, WRAP_UP_TITLE   문항에 쓰지 않는 이름과 자기 선택 캡션(상수 파일과 같은지 시험이 대조).
 *   BANNED_WORDS, VALUE_JUDGEMENT_WORDS, FORBIDDEN_TOPICS      금지어 목록.
 */
import { readFileSync } from "node:fs";
import * as ref from "./wedding-code-v40-ref.mjs";

// ---------------------------------------------------------------------------
// 설정값 (constants/weddingCodeV40.ts 와 같은 값. 어긋나면 시험이 잡는다)
// ---------------------------------------------------------------------------

export const LETTER_NAMES = ["조건 먼저", "장면 먼저", "같이 하기", "나눠 하기", "둘이 정하기", "가족과 정하기", "마음 먼저", "할 일 먼저"];
export const AXIS_TITLES = ["돈을 정할 때", "준비를 굴릴 때", "함께 정하는 사람", "지쳤을 때"];
export const ENGLISH_NAMES = ["Verify", "Scene", "With", "Divide", "Us", "Family", "Heart", "Action"];
export const WRAP_UP_TITLE = "직접 고른 쪽";

/** 화면 문구에 주장으로 쓰지 않는 말(설계 부록 E, 9절 12항, 작성 규칙 C.1). 공백을 없앤 글에서 부분 문자열로 찾는다. */
export const BANNED_WORDS = ["검증", "정확", "과학", "진단", "점수", "등급", "궁합", "MBTI", "엠비티아이", "동물", "캐릭터", "스타일", "퍼센트", "백분율"];
/** 가치 판단어(작성 규칙 C.1 4조와 같은 결의 말). 어간으로 찾는다. */
export const VALUE_JUDGEMENT_WORDS = ["현명", "합리", "감성적", "충동적", "꼼꼼", "무난", "이성적", "감정적", "즉흥적", "계획적", "알뜰", "낭비", "사치", "이기적", "똑똑", "어리석"];
/** 묻지 않는 주제(시작 화면 약속). */
export const FORBIDDEN_TOPICS = ["신혼집", "예단", "예물", "양가비용", "비용분담"];

export const LIMITS = {
  caption: 12,
  stem: 90,
  text: 60,
  recap: 50,
  end: 20,
  question: 40,
  speaker: 8,
  /** 두 극의 문구 길이 차이 상한(긴 쪽 기준, 퍼센트). */
  poleLengthPercent: 15,
  /** 같은 주제 안 두 문항의 글자 이음(이중음절 집합) 유사도 상한. */
  duplicateTopicSimilarity: 0.5,
};

const POLES = ["front", "back"];

// ---------------------------------------------------------------------------
// 규칙 목록
// ---------------------------------------------------------------------------

/** 규칙 id -> { category, severity, description }. severity 가 warning 인 규칙은 실패로 세지 않는다. */
export const RULES = {
  // structure
  "bank-shape": { category: "structure", severity: "error", description: "은행 원본의 최상위 모양(version, items, placeholder)" },
  "version": { category: "structure", severity: "error", description: "version 이 v4.0-tendency" },
  "item-count": { category: "structure", severity: "error", description: "문항이 68개(채점 64 + 자기 선택 4)" },
  "id-duplicate": { category: "structure", severity: "error", description: "id 중복 없음" },
  "unknown-field": { category: "structure", severity: "error", description: "형식에 없는 필드가 없음" },
  "missing-field": { category: "structure", severity: "error", description: "형식에 필요한 필드가 모두 있음" },
  "field-type": { category: "structure", severity: "error", description: "필드 값의 종류(문자열, 정수, 극, 세기)" },
  "shape": { category: "structure", severity: "error", description: "카드, 보기, 항목의 개수와 극 구성" },
  "layout-id": { category: "structure", severity: "error", description: "문항 순서가 배치 골격(id)과 같음" },
  "layout-axis": { category: "structure", severity: "error", description: "주제가 배치 골격과 같음" },
  "layout-facet": { category: "structure", severity: "error", description: "측면이 배치 골격과 같음" },
  "layout-section": { category: "structure", severity: "error", description: "구간이 배치 골격과 같음" },
  "layout-screen": { category: "structure", severity: "error", description: "화면 번호가 배치 골격과 같음" },
  "layout-fmt": { category: "structure", severity: "error", description: "형식이 배치 골격과 같음" },
  "layout-kind": { category: "structure", severity: "error", description: "하위 종류(방식, 순간, 친구 이야기, 상대 행동, 사연)가 배치 골격과 같음" },
  "layout-key": { category: "structure", severity: "error", description: "키가 배치 골격과 같음" },
  "key-arrangement": { category: "structure", severity: "error", description: "카드, 보기, 항목의 극 배열이 key 에서 파생한 배열과 같음" },
  "self-caption": { category: "structure", severity: "error", description: "자기 선택 캡션이 「직접 고른 쪽」" },
  "placeholder-type": { category: "structure", severity: "error", description: "placeholder 는 참 거짓 값" },
  "placeholder-flag": { category: "structure", severity: "error", description: "최상위 placeholder 가 문항의 placeholder 유무와 같음" },
  "placeholder-present": { category: "structure", severity: "error", description: "placeholder 표시가 남아 있음(--allow-placeholder 이면 경고)" },
  "layout-count": { category: "structure", severity: "error", description: "배치 골격 68행" },
  "layout-duplicate-id": { category: "structure", severity: "error", description: "배치 골격 id 중복 없음" },
  "layout-axis-count": { category: "structure", severity: "error", description: "배치 골격 주제당 16문항" },
  "layout-format-count": { category: "structure", severity: "error", description: "배치 골격 주제당 형식 개수 4/4/2/2/2/2" },
  "layout-facet-count": { category: "structure", severity: "error", description: "배치 골격 측면당 4문항" },
  "layout-latin": { category: "structure", severity: "error", description: "배치 골격 라틴 성질(측면이 네 슬롯을 한 번씩, 구간마다 측면 네 개)" },
  "layout-key-balance": { category: "structure", severity: "error", description: "배치 골격 키 합" },
  "layout-section-count": { category: "structure", severity: "error", description: "배치 골격 구간당 16문항" },
  "layout-section-format": { category: "structure", severity: "error", description: "배치 골격 구간마다 형식 구성" },
  "layout-screens": { category: "structure", severity: "error", description: "배치 골격 화면 규칙" },
  "layout-order": { category: "structure", severity: "error", description: "배치 골격 행 순서" },
  "layout-adjacent-axis": { category: "structure", severity: "error", description: "배치 골격에서 같은 주제가 연달아 나오지 않음" },
  "layout-heavy-topic": { category: "structure", severity: "error", description: "배치 골격에서 마음이 무거운 측면의 자리" },
  "layout-mirror": { category: "structure", severity: "error", description: "배치 골격 구간 0과 2, 1과 3의 거울" },
  "layout-indirect": { category: "structure", severity: "error", description: "배치 골격 자기 묘사 6개 이하와 간접 10개 이상" },
  // balance
  "balance-key-sum": { category: "balance", severity: "error", description: "주제마다 형식별 키 합이 0(pair, react, recall, instant, bestworst, split, 고르기)" },
  "balance-react-kind": { category: "balance", severity: "error", description: "react 상대 행동끼리, 사연끼리 키 합이 0" },
  "balance-mirror": { category: "balance", severity: "error", description: "구간 c 와 c+2 의 같은 위치 문항은 키가 반대" },
  "balance-self": { category: "balance", severity: "error", description: "자기 선택 키가 2:2" },
  "balance-indirect": { category: "balance", severity: "error", description: "주제당 자기 묘사 6개 이하, 간접 10개 이상" },
  "balance-fixed": { category: "balance", severity: "error", description: "고정 응답(늘 같은 칸, 번갈아, 돌려 누르기)의 형식별 합이 폼 비트 0, 1 에서 모두 0" },
  "balance-class": { category: "balance", severity: "error", description: "위치 함수 응답(구간 안 위치, 전체 순서 mod, 서식 안 색인 mod)의 형식별 합이 모두 0" },
  "balance-skipped": { category: "balance", severity: "warning", description: "구조 오류가 있어 정적 균형 시험을 건너뜀" },
  // content
  "empty-text": { category: "content", severity: "error", description: "비어 있는 문구가 없음" },
  "length-caption": { category: "content", severity: "error", description: "캡션 12자 이하" },
  "length-stem": { category: "content", severity: "error", description: "앞말 90자 이하(react 는 앞말과 인용문 합)" },
  "length-text": { category: "content", severity: "error", description: "카드, 보기, 항목 60자 이하" },
  "length-recap": { category: "content", severity: "error", description: "react 앞 구절 50자 이하" },
  "length-ends": { category: "content", severity: "error", description: "react 양끝 이름 20자 이하" },
  "length-question": { category: "content", severity: "warning", description: "react 물음 40자 이하" },
  "speaker-length": { category: "content", severity: "warning", description: "react 화자는 짧은 명사" },
  "pole-length": { category: "content", severity: "error", description: "두 극의 문구 길이가 서로 15퍼센트 안" },
  "dash": { category: "content", severity: "error", description: "줄표와 붙임표가 없음" },
  "digit": { category: "content", severity: "error", description: "아라비아 숫자가 없음" },
  "percent": { category: "content", severity: "error", description: "퍼센트 기호와 말이 없음" },
  "label": { category: "content", severity: "error", description: "A. B. 1. 2. 가. 나. 같은 기호 라벨이 없음" },
  "latin-token": { category: "content", severity: "error", description: "홀로 선 영문 대문자(글자 이름과 라벨)가 없음" },
  "letter-name": { category: "content", severity: "error", description: "글자 이름(조건 먼저 ...)과 영어 이름이 없음" },
  "axis-name": { category: "content", severity: "error", description: "주제 이름(돈을 정할 때 ...)이 없음" },
  "banned-word": { category: "content", severity: "error", description: "금지어(검증, 정확, 과학, 진단, 점수, 등급, 궁합, MBTI, 동물, 스타일 ...)가 없음" },
  "value-judgement": { category: "content", severity: "error", description: "가치 판단어(현명, 합리, 꼼꼼, 무난 ...)가 없음" },
  "noun-answer": { category: "content", severity: "error", description: "「~인 답」 꼴이 없음" },
  "forbidden-topic": { category: "content", severity: "error", description: "신혼집, 예단, 예물, 양가 비용 분담을 묻지 않음" },
  "money-amount": { category: "content", severity: "error", description: "금액 표현(만 원 등)이 없음" },
  "politeness": { category: "content", severity: "error", description: "해요체 휴리스틱(문장이 요로 끝남, 인용 안은 예외)" },
  "quote-balance": { category: "content", severity: "error", description: "인용 괄호 「 」의 짝이 맞음" },
  "quote-style": { category: "content", severity: "error", description: "따옴표는 「 」만 씀" },
  "nested-quote": { category: "content", severity: "error", description: "가장·아닌 것 카드와 칸 나누기 항목 안에 「 」가 없음(결과가 다시 감싼다)" },
  "quote-brackets": { category: "content", severity: "error", description: "react 인용문에 바깥 「 」가 없음(화면이 붙인다)" },
  "bestworst-ending": { category: "content", severity: "error", description: "가장·아닌 것 카드는 요로 끝나고 마침표가 없음" },
  "whitespace": { category: "content", severity: "error", description: "앞뒤 공백, 겹공백, 줄바꿈이 없음" },
  "same-text": { category: "content", severity: "error", description: "한 문항 안에서 두 보기가 같지 않음" },
  "duplicate-caption": { category: "content", severity: "error", description: "캡션이 겹치지 않음" },
  "duplicate-stem": { category: "content", severity: "error", description: "같은 주제 안에서 앞말이 겹치지 않음" },
  "duplicate-topic": { category: "content", severity: "error", description: "같은 주제 안 두 문항이 거의 같은 소재가 아님" },
  "question-form": { category: "content", severity: "warning", description: "react 물음이 물음표나 요로 끝남" },
};

// ---------------------------------------------------------------------------
// 작은 도우미
// ---------------------------------------------------------------------------

const isStr = (x) => typeof x === "string";
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const len = (s) => [...s].length;
const squash = (s) => s.replace(/\s+/g, "");
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
/** 배열이 아니면 빈 배열(깨진 원본에서도 검사기가 던지지 않고 구조 오류로 알리게 한다). */
const listOf = (x) => (Array.isArray(x) ? x : []);

// 특수 문자는 소스에 그대로 적지 않고 코드 값으로 만든다(줄표류, 전각 숫자, 동그라미 숫자, 굽은 따옴표가 소스에 숨지 않게).
const chars = (...codes) => codes.map((c) => String.fromCodePoint(c)).join("");
const span = (a, b) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`;
/** 붙임표와 줄표류(하이픈, 붙임표, 그림 줄표, 짧은 줄표, 긴 줄표, 가로선, 마이너스, 작은 줄표, 전각 붙임표). */
const DASH_RE = new RegExp(`[-${span(0x2010, 0x2015)}${chars(0x2212, 0xfe58, 0xfe63, 0xff0d)}]`);
const DIGIT_RE = new RegExp(`[0-9${span(0xff10, 0xff19)}]`);
const PERCENT_RE = new RegExp(`[%${chars(0xff05)}]|퍼센트|백분율`);
/** 동그라미 숫자와 동그라미 한글. */
const CIRCLED_RE = new RegExp(`[${span(0x2460, 0x2473)}${span(0x3260, 0x326d)}]`);
/** 「 」 밖의 따옴표: 곧은 큰따옴표, 굽은 따옴표 넷, 억음 부호, 작은따옴표. */
const STRAY_QUOTE_RE = new RegExp(`["${chars(0x201c, 0x201d, 0x2018, 0x2019)}\`']`);

const COMMON_FIELDS = ["id", "axis", "section", "screen", "key", "caption", "stem", "fmt", "placeholder"];
const FIELDS_BY_FMT = {
  pair: [...COMMON_FIELDS, "facet", "kind", "cards"],
  react: [...COMMON_FIELDS, "facet", "kind", "quote", "question", "ends", "highPole", "recap"],
  recall: [...COMMON_FIELDS, "facet", "options"],
  instant: [...COMMON_FIELDS, "facet", "options"],
  bestworst: [...COMMON_FIELDS, "facet", "cards"],
  split: [...COMMON_FIELDS, "facet", "entries"],
  self: [...COMMON_FIELDS, "cards"],
};
const REQUIRED_BY_FMT = {
  pair: ["id", "axis", "facet", "section", "screen", "key", "caption", "stem", "fmt", "kind", "cards"],
  react: ["id", "axis", "facet", "section", "screen", "key", "caption", "stem", "fmt", "kind", "question", "ends", "highPole", "recap"],
  recall: ["id", "axis", "facet", "section", "screen", "key", "caption", "stem", "fmt", "options"],
  instant: ["id", "axis", "facet", "section", "screen", "key", "caption", "stem", "fmt", "options"],
  bestworst: ["id", "axis", "facet", "section", "screen", "key", "caption", "stem", "fmt", "cards"],
  split: ["id", "axis", "facet", "section", "screen", "key", "caption", "stem", "fmt", "entries"],
  self: ["id", "axis", "section", "screen", "key", "caption", "stem", "fmt", "cards"],
};

// ---------------------------------------------------------------------------
// 구조 검사
// ---------------------------------------------------------------------------

function structureIssues(item, index, layoutRow, push) {
  const id = isStr(item?.id) ? item.id : `#${index}`;
  const bad = (rule, message) => push(rule, id, message);
  if (!isObj(item)) {
    bad("field-type", "문항이 객체가 아니다");
    return { ok: false, shapeOk: false };
  }
  const fmt = item.fmt;
  if (!isStr(fmt) || !(fmt in FIELDS_BY_FMT)) {
    bad("field-type", `fmt 가 알 수 없는 값이다: ${JSON.stringify(fmt)}`);
    return { ok: false, shapeOk: false };
  }
  // ok: 아무 구조 문제도 없음, shapeOk: 모양(필드, 종류, 개수, 극)은 맞음(배치 골격 불일치와 키 배열 문제는 제외)
  let ok = true;
  let shapeOk = true;
  const fail = (rule, message) => {
    ok = false;
    if (!rule.startsWith("layout-") && rule !== "key-arrangement" && rule !== "self-caption" && rule !== "placeholder-type") shapeOk = false;
    bad(rule, message);
  };
  for (const k of Object.keys(item)) if (!FIELDS_BY_FMT[fmt].includes(k)) fail("unknown-field", `${fmt} 문항에 없는 필드: ${k}`);
  for (const k of REQUIRED_BY_FMT[fmt]) if (!has(item, k)) fail("missing-field", `필수 필드가 없다: ${k}`);
  if (has(item, "placeholder") && typeof item.placeholder !== "boolean") fail("placeholder-type", "placeholder 는 true 나 false 여야 한다");
  if (!isStr(item.id) || item.id === "") fail("field-type", "id 는 비어 있지 않은 문자열");
  if (!ref.AXES.includes(item.axis)) fail("field-type", `axis 는 ${ref.AXES.join(", ")} 중 하나: ${JSON.stringify(item.axis)}`);
  if (fmt !== "self" && ref.AXES.includes(item.axis) && !ref.FACETS_OF[item.axis].includes(item.facet)) fail("field-type", `facet ${JSON.stringify(item.facet)} 는 ${item.axis} 의 측면이 아니다`);
  if (!Number.isInteger(item.section)) fail("field-type", "section 은 정수");
  if (!Number.isInteger(item.screen)) fail("field-type", "screen 은 정수");
  if (item.key !== 1 && item.key !== -1) fail("field-type", `key 는 1 또는 -1: ${JSON.stringify(item.key)}`);
  if (!isStr(item.caption)) fail("field-type", "caption 은 문자열");
  if (!isStr(item.stem)) fail("field-type", "stem 은 문자열");
  const checkTexts = (list, name, count, allowNeutralThird = false) => {
    if (!Array.isArray(list) || list.length !== count) {
      fail("shape", `${name} 은 ${count}개 배열이어야 한다`);
      return;
    }
    list.forEach((entry, i) => {
      if (!isObj(entry)) return fail("shape", `${name}[${i}] 가 객체가 아니다`);
      if (!isStr(entry.text)) fail("field-type", `${name}[${i}].text 는 문자열`);
      const allowed = fmt === "recall" || fmt === "instant" ? ["text", "pole", "strength"] : ["pole", "text"];
      for (const k of Object.keys(entry)) if (!allowed.includes(k)) fail("unknown-field", `${name}[${i}] 에 없는 필드: ${k}`);
      const neutralOk = allowNeutralThird && i === 2;
      if (neutralOk ? entry.pole !== "neutral" : !POLES.includes(entry.pole)) fail("shape", `${name}[${i}].pole 이 ${neutralOk ? "neutral" : "front 나 back"} 이어야 한다: ${JSON.stringify(entry.pole)}`);
      if (fmt === "recall" || fmt === "instant") if (entry.strength !== "strong" && entry.strength !== "weak") fail("shape", `${name}[${i}].strength 는 strong 또는 weak`);
    });
  };
  switch (fmt) {
    case "pair": {
      if (!["method", "moment", "friends"].includes(item.kind)) fail("field-type", `pair kind 는 method, moment, friends: ${JSON.stringify(item.kind)}`);
      checkTexts(item.cards, "cards", 2);
      if (Array.isArray(item.cards) && item.cards.length === 2 && new Set(item.cards.map((c) => c?.pole)).size !== 2) fail("shape", "두 카드가 front 와 back 하나씩이어야 한다");
      break;
    }
    case "self": {
      checkTexts(item.cards, "cards", 2);
      if (Array.isArray(item.cards) && item.cards.length === 2 && new Set(item.cards.map((c) => c?.pole)).size !== 2) fail("shape", "두 카드가 front 와 back 하나씩이어야 한다");
      if (item.caption !== WRAP_UP_TITLE) fail("self-caption", `자기 선택 캡션은 「${WRAP_UP_TITLE}」: ${JSON.stringify(item.caption)}`);
      break;
    }
    case "react": {
      if (!["action", "story"].includes(item.kind)) fail("field-type", `react kind 는 action 또는 story: ${JSON.stringify(item.kind)}`);
      if (!isStr(item.question)) fail("field-type", "question 은 문자열");
      if (!isStr(item.recap)) fail("field-type", "recap 은 문자열");
      if (!POLES.includes(item.highPole)) fail("field-type", `highPole 은 front 또는 back: ${JSON.stringify(item.highPole)}`);
      if (!isObj(item.ends) || !isStr(item.ends.left) || !isStr(item.ends.right)) fail("shape", "ends 는 { left, right } 문자열");
      else for (const k of Object.keys(item.ends)) if (!["left", "right"].includes(k)) fail("unknown-field", `ends 에 없는 필드: ${k}`);
      if (has(item, "quote")) {
        if (!isObj(item.quote) || !isStr(item.quote.speaker) || !isStr(item.quote.text)) fail("shape", "quote 는 { speaker, text } 문자열 둘");
        else for (const k of Object.keys(item.quote)) if (!["speaker", "text"].includes(k)) fail("unknown-field", `quote 에 없는 필드: ${k}`);
      }
      break;
    }
    case "recall":
    case "instant":
      checkTexts(item.options, "options", 4);
      break;
    case "bestworst":
      checkTexts(item.cards, "cards", 4);
      if (Array.isArray(item.cards) && item.cards.length === 4 && item.cards.filter((c) => c?.pole === "front").length !== 2) fail("shape", "네 카드는 극마다 두 장이어야 한다");
      break;
    case "split":
      checkTexts(item.entries, "entries", 3, true);
      break;
    default:
      break;
  }
  // 배치 골격 대조
  if (layoutRow) {
    const compare = (rule, field, want) => {
      if (item[field] !== want) fail(rule, `${field} 이 ${JSON.stringify(item[field])} 이다(배치 골격은 ${JSON.stringify(want)})`);
    };
    compare("layout-id", "id", layoutRow.id);
    compare("layout-axis", "axis", layoutRow.axis);
    if (layoutRow.facet !== null) compare("layout-facet", "facet", layoutRow.facet);
    compare("layout-section", "section", layoutRow.section);
    compare("layout-screen", "screen", layoutRow.screen);
    compare("layout-fmt", "fmt", layoutRow.fmt);
    if (layoutRow.kind !== null || has(item, "kind")) compare("layout-kind", "kind", layoutRow.kind ?? undefined);
    compare("layout-key", "key", layoutRow.key);
  }
  // 키와 극 배열(모양이 맞을 때만)
  if (shapeOk) {
    const dk = ref.derivedKey(item);
    if (dk === null) fail("key-arrangement", `극 배열이 key ${item.key} 의 배열도, 반대 배열도 아니다`);
    else if (dk !== item.key) fail("key-arrangement", `극 배열은 key ${dk} 의 배열인데 key 필드는 ${item.key} 이다`);
  }
  return { ok, shapeOk };
}

// ---------------------------------------------------------------------------
// 방향 균형(키와 배열에서 파생)
// ---------------------------------------------------------------------------

function balanceIssues(items, layout, push) {
  const key = (it) => {
    const dk = ref.derivedKey(it);
    return dk === null ? 0 : dk;
  };
  const scored = items.filter((it) => it?.fmt && it.fmt !== "self");
  for (const axis of ref.AXES) {
    const rows = scored.filter((it) => it.axis === axis);
    for (const fmt of ["pair", "react", "recall", "instant", "bestworst", "split"]) {
      const sum = rows.filter((it) => it.fmt === fmt).reduce((s, it) => s + key(it), 0);
      if (sum !== 0) push("balance-key-sum", null, `${axis} ${fmt} 키 합이 ${sum} 이다(0이어야 한다)`);
    }
    const chooseSum = rows.filter((it) => it.fmt === "recall" || it.fmt === "instant").reduce((s, it) => s + key(it), 0);
    if (chooseSum !== 0) push("balance-key-sum", null, `${axis} 고르기(recall+instant) 키 합이 ${chooseSum} 이다`);
    for (const kind of ["action", "story"]) {
      const sum = rows.filter((it) => it.fmt === "react" && it.kind === kind).reduce((s, it) => s + key(it), 0);
      if (sum !== 0) push("balance-react-kind", null, `${axis} react ${kind} 키 합이 ${sum} 이다`);
    }
    const selfDescribing = rows.filter((it) => (it.fmt === "pair" && it.kind === "method") || it.fmt === "instant" || it.fmt === "bestworst").length;
    if (selfDescribing > 6 || rows.length - selfDescribing < 10) push("balance-indirect", null, `${axis} 자기 묘사 ${selfDescribing}개, 간접 ${rows.length - selfDescribing}개`);
  }
  const selfSum = items.filter((it) => it?.fmt === "self").reduce((s, it) => s + key(it), 0);
  if (selfSum !== 0) push("balance-self", null, `자기 선택 키 합이 ${selfSum} 이다(2:2 여야 한다)`);
  // 거울: 배치 골격의 짝을 따른다
  const byId = new Map(items.filter((it) => isStr(it?.id)).map((it) => [it.id, it]));
  const scoredRows = layout.filter((r) => r.fmt !== "self");
  for (const r of scoredRows.filter((x) => x.section < 2)) {
    const partnerRow = scoredRows.find((x) => x.section === r.section + 2 && x.axis === r.axis && x.screen === r.screen + 20 && x.pos === r.pos);
    if (!partnerRow) continue;
    const a = byId.get(r.id);
    const b = byId.get(partnerRow.id);
    if (!a || !b) continue;
    const ka = ref.derivedKey(a);
    const kb = ref.derivedKey(b);
    if (ka === null || kb === null) continue;
    if (ka !== -kb) push("balance-mirror", a.id, `${a.id} 와 ${b.id} 는 거울 짝인데 키가 반대가 아니다(${ka}, ${kb})`);
  }
}

// ---------------------------------------------------------------------------
// 문구 검사
// ---------------------------------------------------------------------------

/** 문항의 모든 문구 필드. role 은 규칙 적용 범위를 정한다. */
function textFieldsOf(item) {
  const out = [];
  const add = (path, text, role) => {
    if (isStr(text)) out.push({ path, text, role });
  };
  add("caption", item.caption, "caption");
  add("stem", item.stem, "stem");
  switch (item.fmt) {
    case "pair":
      listOf(item.cards).forEach((c, i) => add(`cards[${i}]`, c?.text, item.kind === "moment" ? "card-moment" : "card"));
      break;
    case "self":
      listOf(item.cards).forEach((c, i) => add(`cards[${i}]`, c?.text, "card"));
      break;
    case "bestworst":
      listOf(item.cards).forEach((c, i) => add(`cards[${i}]`, c?.text, "bw-card"));
      break;
    case "recall":
    case "instant":
      listOf(item.options).forEach((o, i) => add(`options[${i}]`, o?.text, "option"));
      break;
    case "split":
      listOf(item.entries).forEach((e, i) => add(`entries[${i}]`, e?.text, "entry"));
      break;
    case "react":
      add("quote.speaker", item.quote?.speaker, "speaker");
      add("quote.text", item.quote?.text, "quote");
      add("question", item.question, "question");
      add("ends.left", item.ends?.left, "end");
      add("ends.right", item.ends?.right, "end");
      add("recap", item.recap, "recap");
      break;
    default:
      break;
  }
  return out;
}

const QUOTE_TOKEN = "\u0001";

/** 「 」 안을 토큰으로 바꾼다. 괄호 짝이 맞지 않으면 null. */
function maskQuotes(text) {
  let depth = 0;
  let inside = false;
  let out = "";
  for (const ch of text) {
    if (ch === "「") {
      if (depth > 0) return null;
      depth = 1;
      inside = true;
      out += QUOTE_TOKEN;
      continue;
    }
    if (ch === "」") {
      if (depth === 0) return null;
      depth = 0;
      inside = false;
      continue;
    }
    if (!inside) out += ch;
  }
  return depth === 0 ? out : null;
}

function politenessProblem(field, item) {
  const { text, role } = field;
  const masked = maskQuotes(text);
  if (masked === null) return null; // 괄호 짝 문제는 quote-balance 가 잡는다
  const sentences = masked.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < sentences.length; i += 1) {
    const raw = sentences[i];
    const isLast = i === sentences.length - 1;
    // 「지금 상황 뒤 나는 보통…」 꼴의 열린 앞말
    if (role === "stem" && item.fmt === "instant" && isLast && /[…]$|\.\.\.$/.test(raw)) continue;
    const body = raw.replace(/[.?!…\s]+$/g, "");
    if (body === "") continue;
    const last = [...body].at(-1);
    if (last === "요" || last === "죠" || last === QUOTE_TOKEN) continue;
    if (role === "entry" && last === "기") continue;
    if (role === "card-moment" && isLast && body.endsWith("순간")) continue;
    return `문장이 요로 끝나지 않는다: 「${raw.replace(QUOTE_TOKEN, "「…」")}」`;
  }
  return null;
}

/** 이중음절 집합 유사도(자카드). */
function bigramSet(text) {
  const s = squash(text).replace(/[^\p{L}]/gu, "");
  const set = new Set();
  for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function signatureOf(item) {
  return textFieldsOf(item)
    .filter((f) => f.role !== "caption" && f.role !== "speaker")
    .map((f) => f.text)
    .join(" ");
}

function poleLengthIssue(item) {
  let front = [];
  let back = [];
  const collect = (list) => {
    for (const e of listOf(list)) {
      if (!isStr(e?.text)) continue;
      if (e.pole === "front") front.push(len(e.text));
      else if (e.pole === "back") back.push(len(e.text));
    }
  };
  switch (item.fmt) {
    case "pair":
    case "self":
    case "bestworst":
      collect(item.cards);
      break;
    case "recall":
    case "instant":
      collect(item.options);
      break;
    case "split":
      collect(item.entries);
      break;
    default:
      return null;
  }
  if (front.length === 0 || back.length === 0) return null;
  const sf = front.reduce((a, b) => a + b, 0);
  const sb = back.reduce((a, b) => a + b, 0);
  // 평균끼리 비교: sf/nf 대 sb/nb 를 정수 곱으로
  const a = sf * back.length;
  const b = sb * front.length;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if ((hi - lo) * 100 > LIMITS.poleLengthPercent * hi) {
    const mf = (sf / front.length).toFixed(1);
    const mb = (sb / back.length).toFixed(1);
    return `앞극 문구 평균 ${mf}자, 뒤극 평균 ${mb}자(차이가 ${LIMITS.poleLengthPercent}퍼센트를 넘는다)`;
  }
  return null;
}

function contentIssues(item, push) {
  const id = item.id;
  const bad = (rule, message) => push(rule, id, message);
  const fields = textFieldsOf(item);
  for (const f of fields) {
    const { text, role, path } = f;
    const where = `${path}: `;
    const flat = squash(text);
    if (flat === "") {
      bad("empty-text", `${where}비어 있다`);
      continue;
    }
    if (/^\s|\s$|\s{2,}|[\t\r\n]/.test(text)) bad("whitespace", `${where}앞뒤 공백, 겹공백, 줄바꿈이 있다`);
    if (DASH_RE.test(text)) bad("dash", `${where}줄표나 붙임표가 있다`);
    if (DIGIT_RE.test(text)) bad("digit", `${where}아라비아 숫자가 있다`);
    if (PERCENT_RE.test(text)) bad("percent", `${where}퍼센트 표현이 있다`);
    if (/(^|\s)(?:[A-Da-d]|[1-9]|[가나다라])\s*[.):]\s/.test(text) || /^(?:[A-Da-d1-4]|[가나다라])\s*[:.)]/.test(text) || CIRCLED_RE.test(text) || /\((?:[A-Da-d1-4]|[가나다라])\)/.test(text) || /(^|\s)[A-D]안(?![가-힣])/.test(text)) bad("label", `${where}기호 라벨처럼 보이는 표현이 있다`);
    if (/(?<![A-Za-z])[A-Z](?![A-Za-z])/.test(text)) bad("latin-token", `${where}홀로 선 영문 대문자가 있다`);
    const nameHit = LETTER_NAMES.find((n) => flat.includes(squash(n))) ?? ENGLISH_NAMES.find((n) => new RegExp(`(?<![A-Za-z])${n}(?![A-Za-z])`).test(text));
    if (nameHit) bad("letter-name", `${where}글자 이름이 나온다: ${nameHit}`);
    const axisHit = AXIS_TITLES.find((n) => flat.includes(squash(n)));
    if (axisHit) bad("axis-name", `${where}주제 이름이 나온다: ${axisHit}`);
    const bannedHit = BANNED_WORDS.find((w) => flat.toUpperCase().includes(w.toUpperCase()));
    if (bannedHit) bad("banned-word", `${where}금지어가 나온다: ${bannedHit}`);
    const judgeHit = VALUE_JUDGEMENT_WORDS.find((w) => flat.includes(w));
    if (judgeHit) bad("value-judgement", `${where}가치 판단어가 나온다: ${judgeHit}`);
    if (/인\s?답(?![가-힣])/.test(text)) bad("noun-answer", `${where}「~인 답」 꼴이 있다`);
    const topicHit = FORBIDDEN_TOPICS.find((w) => flat.includes(w));
    if (topicHit) bad("forbidden-topic", `${where}묻지 않는 주제가 나온다: ${topicHit}`);
    // 수 단위(십, 백, 천, 만, 억, 조)가 하나라도 든 한글 수 표현 + 원. 「사원」 같은 낱말은 걸리지 않는다.
    if (/[일이삼사오육칠팔구십백천만억조]*[십백천만억조][일이삼사오육칠팔구십백천만억조]*\s*원(?![가-힣])/.test(text)) bad("money-amount", `${where}금액 표현이 있다`);
    if (STRAY_QUOTE_RE.test(text)) bad("quote-style", `${where}「 」 밖의 따옴표가 있다`);
    if (maskQuotes(text) === null) bad("quote-balance", `${where}「 」의 짝이 맞지 않는다`);
    if ((role === "bw-card" || role === "entry") && /[「」]/.test(text)) bad("nested-quote", `${where}결과에서 다시 「 」로 감싸므로 안에 「 」를 쓰지 않는다`);
    if (role === "quote" && /[「」]/.test(text)) bad("quote-brackets", `${where}바깥 「 」를 적지 않는다(화면이 붙인다)`);
    if (role === "bw-card" && (!/요$/.test(text) || /[.]/.test(text))) bad("bestworst-ending", `${where}요로 끝나고 마침표가 없어야 한다`);
    if (["stem", "card", "card-moment", "option", "entry", "end", "bw-card"].includes(role)) {
      const problem = politenessProblem(f, item);
      if (problem) bad("politeness", `${where}${problem}`);
    }
    // 글자 수
    const n = len(text);
    if (role === "caption" && n > LIMITS.caption) bad("length-caption", `${where}${n}자(${LIMITS.caption}자 이하)`);
    if (role === "stem" && item.fmt !== "react" && n > LIMITS.stem) bad("length-stem", `${where}${n}자(${LIMITS.stem}자 이하)`);
    if (["card", "card-moment", "option", "entry", "bw-card"].includes(role) && n > LIMITS.text) bad("length-text", `${where}${n}자(${LIMITS.text}자 이하)`);
    if (role === "recap" && n > LIMITS.recap) bad("length-recap", `${where}${n}자(${LIMITS.recap}자 이하)`);
    if (role === "end" && n > LIMITS.end) bad("length-ends", `${where}${n}자(${LIMITS.end}자 이하)`);
    if (role === "question" && n > LIMITS.question) bad("length-question", `${where}${n}자(${LIMITS.question}자 이하)`);
    if (role === "speaker" && n > LIMITS.speaker) bad("speaker-length", `${where}${n}자(짧은 명사)`);
    if (role === "question" && !/[?]$|요$/.test(text)) bad("question-form", `${where}물음표나 요로 끝나야 한다`);
  }
  if (item.fmt === "react" && isStr(item.stem)) {
    const total = len(item.stem) + (isStr(item.quote?.text) ? len(item.quote.text) : 0);
    if (total > LIMITS.stem) bad("length-stem", `앞말과 인용문 합이 ${total}자(${LIMITS.stem}자 이하)`);
  }
  const poleIssue = poleLengthIssue(item);
  if (poleIssue) bad("pole-length", poleIssue);
  // 한 문항 안의 같은 문구
  const choices = fields.filter((f) => ["card", "card-moment", "option", "entry", "bw-card"].includes(f.role)).map((f) => squash(f.text));
  if (new Set(choices).size !== choices.length) bad("same-text", "한 문항 안에 같은 문구의 보기가 있다");
  if (item.fmt === "react" && isObj(item.ends) && isStr(item.ends.left) && squash(item.ends.left) === squash(item.ends.right ?? "")) bad("same-text", "react 양끝 이름이 같다");
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

/**
 * @param data 은행 원본 { version, placeholder?, note?, items }
 * @param options { allowPlaceholder?: boolean, layout?: 배치 골격 행 배열, balanceTrials?: number }
 * @returns { errors, warnings, stats } 각 항목은 { rule, category, itemId, message }
 */
export function lintBank(data, options = {}) {
  const layout = options.layout ?? ref.loadLayout();
  const allowPlaceholder = options.allowPlaceholder === true;
  const raw = [];
  const push = (rule, itemId, message) => {
    if (!has(RULES, rule)) throw new Error(`알 수 없는 규칙 id: ${rule}`);
    raw.push({ rule, category: RULES[rule].category, itemId, message });
  };
  const stats = { items: 0, placeholderItems: 0, balanceChecks: 0, balanceRan: false, maxTopicSimilarity: 0 };
  const finish = () => {
    const placeholderIds = new Set((Array.isArray(data?.items) ? data.items : []).filter((it) => it?.placeholder === true).map((it) => it.id));
    const errors = [];
    const warnings = [];
    for (const issue of raw) {
      let severity = RULES[issue.rule].severity;
      if (issue.rule === "placeholder-present" && allowPlaceholder) severity = "warning";
      if (issue.category === "content" && allowPlaceholder && issue.itemId !== null && placeholderIds.has(issue.itemId)) severity = "warning";
      (severity === "error" ? errors : warnings).push(issue);
    }
    return { errors, warnings, stats };
  };
  // 최상위
  if (!isObj(data)) {
    push("bank-shape", null, "은행 원본이 객체가 아니다");
    return finish();
  }
  for (const k of Object.keys(data)) if (!["version", "placeholder", "note", "items"].includes(k)) push("bank-shape", null, `최상위에 없는 필드: ${k}`);
  if (data.version !== ref.VERSION) push("version", null, `version 이 ${JSON.stringify(data.version)} 이다(${ref.VERSION})`);
  if (has(data, "placeholder") && typeof data.placeholder !== "boolean") push("placeholder-type", null, "최상위 placeholder 는 true 나 false 여야 한다");
  if (!Array.isArray(data.items)) {
    push("bank-shape", null, "items 가 배열이 아니다");
    return finish();
  }
  const items = data.items;
  stats.items = items.length;
  // 배치 골격 자체
  for (const p of ref.verifyLayout(layout)) push(p.rule, null, `[배치 골격] ${p.message}`);
  if (items.length !== layout.length) push("item-count", null, `문항이 ${items.length}개다(${layout.length}개여야 한다)`);
  const ids = items.map((it) => it?.id).filter(isStr);
  for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) push("id-duplicate", id, `id 가 겹친다: ${id}`);
  // 문항별 구조
  let allShapesOk = items.length === layout.length;
  items.forEach((item, i) => {
    const { shapeOk } = structureIssues(item, i, layout[i], push);
    if (!shapeOk) allShapesOk = false;
  });
  // placeholder 표시
  const flagged = items.filter((it) => it?.placeholder === true);
  stats.placeholderItems = flagged.length;
  if ((data.placeholder === true) !== (flagged.length > 0)) push("placeholder-flag", null, `최상위 placeholder 는 ${data.placeholder === true} 인데 placeholder 문항이 ${flagged.length}개다`);
  if (data.placeholder === true || flagged.length > 0) push("placeholder-present", null, `placeholder 표시가 남아 있다(문항 ${flagged.length}개)`);
  // 균형
  const balanceItems = items.filter(isObj);
  balanceIssues(balanceItems, layout, push);
  if (allShapesOk) {
    try {
      const result = ref.checkStaticBalance({ items, layout }, { trials: options.balanceTrials ?? 40 });
      stats.balanceRan = true;
      stats.balanceChecks = result.checks;
      // 같은 (시험 방식, 주제, 형식) 위반은 한 줄로 모은다(폼 비트와 시행마다 따로 적으면 수백 줄이 된다).
      const grouped = new Map();
      for (const v of result.violations) {
        const key = `${v.kind}|${v.strategy}|${v.axis}|${v.group}`;
        const entry = grouped.get(key) ?? { first: v, count: 0 };
        entry.count += 1;
        grouped.set(key, entry);
      }
      for (const { first: v, count } of grouped.values()) {
        const rule = v.kind === "fixed" ? "balance-fixed" : "balance-class";
        push(rule, null, `${v.strategy} / ${v.axis} ${v.group} 합이 0 이 아니다(예: 폼 비트 ${v.formBit} 에서 ${v.sum}, ${count}건)`);
      }
    } catch (error) {
      push("balance-skipped", null, `정적 균형 시험이 실패했다: ${error.message}`);
    }
  } else {
    push("balance-skipped", null, "구조 오류가 있어 정적 균형 시험을 건너뛰었다");
  }
  // 문구
  for (const item of items) if (isObj(item) && isStr(item.id)) contentIssues(item, push);
  // 중복
  const scored = items.filter((it) => isObj(it) && it.fmt !== "self" && isStr(it.caption));
  const captionOwner = new Map();
  for (const it of scored) {
    const key = squash(it.caption);
    if (captionOwner.has(key)) push("duplicate-caption", it.id, `캡션 「${it.caption}」이 ${captionOwner.get(key)} 와 같다`);
    else captionOwner.set(key, it.id);
  }
  // 앞말은 같은 주제 안에서만 겹치지 않으면 된다(친구 이야기 같은 하위 종류의 공통 안내 문장은 주제마다 같아도 된다).
  const stemOwner = new Map();
  for (const it of scored) {
    if (!isStr(it.stem)) continue;
    const key = `${it.axis}|${squash(it.stem)}`;
    if (stemOwner.has(key)) push("duplicate-stem", it.id, `같은 주제의 ${stemOwner.get(key)} 와 앞말이 같다`);
    else stemOwner.set(key, it.id);
  }
  for (const axis of ref.AXES) {
    const rows = scored.filter((it) => it.axis === axis);
    const sets = rows.map((it) => bigramSet(signatureOf(it)));
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const sim = jaccard(sets[i], sets[j]);
        if (sim > stats.maxTopicSimilarity) stats.maxTopicSimilarity = sim;
        if (sim > LIMITS.duplicateTopicSimilarity) push("duplicate-topic", rows[j].id, `${rows[i].id} 와 소재가 거의 같다(유사도 ${sim.toFixed(2)})`);
      }
    }
  }
  return finish();
}

export function lintBankFile(path, options = {}) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  return lintBank(data, options);
}

/** 사람이 읽는 보고서. */
export function formatReport(result, options = {}) {
  const lines = [];
  const group = (title, list) => {
    if (list.length === 0) return;
    lines.push(`${title} ${list.length}건`);
    const byRule = new Map();
    for (const issue of list) {
      if (!byRule.has(issue.rule)) byRule.set(issue.rule, []);
      byRule.get(issue.rule).push(issue);
    }
    for (const [rule, issues] of byRule) {
      lines.push(`  [${rule}] (${RULES[rule].category}) ${RULES[rule].description}`);
      const limit = options.verbose ? issues.length : 8;
      for (const issue of issues.slice(0, limit)) lines.push(`    ${issue.itemId ?? "-"}: ${issue.message}`);
      if (issues.length > limit) lines.push(`    ... ${issues.length - limit}건 더`);
    }
  };
  group("오류", result.errors);
  group("경고", result.warnings);
  const s = result.stats;
  lines.push(`문항 ${s.items}개, placeholder 문항 ${s.placeholderItems}개, 정적 균형 시험 ${s.balanceChecks}건${s.balanceRan ? "" : "(건너뜀)"}, 같은 주제 안 최대 소재 유사도 ${s.maxTopicSimilarity.toFixed(2)}`);
  lines.push(result.errors.length === 0 ? "통과" : `실패(오류 ${result.errors.length}건)`);
  return lines.join("\n");
}
