/**
 * 웨딩코드 4.0 문항 은행 결합과 검사(BankModule, README 5절, 설계 4절과 부록 C.1).
 *
 * 은행 원본은 생성된 constants/weddingCodeV40Bank.ts 의 V40_BANK_DATA 하나다(주제별 파일은 쓰지 않는다). createBank 는 그 원본을
 * 배치 골격(V40_LAYOUT)과 대조해 검사하고 조회 구조(Bank)를 만든다. 이 파일은 문구 내용에 기대지 않는다. id, 배치, 키, 극 배열만
 * 믿고, 문구는 길이와 금지 표현만 본다. 검사는 아무 입력에도 던지지 않고 문제 목록을 낸다(createBank 만 문제가 있으면 던진다).
 *
 * 규칙 코드(BankIssue.rule): bank-shape, version, item-count, id-duplicate, layout-mismatch, shape, self-caption, key-arrangement,
 * balance-key-sum, balance-mirror, balance-self, indirect-count, empty-text, text-too-long, pole-length, dash, digit, percent, label,
 * latin-token, letter-name, axis-name, banned-word, value-judgement, noun-answer, system-tone, forbidden-topic, bestworst-ending, same-text.
 */
import {
  V40_AXES,
  V40_AXIS_KEYS,
  V40_COUNTS,
  V40_LETTERS,
  V40_WRAP_UP,
  WEDDING_CODE_V40_VERSION,
} from "@/constants/weddingCodeV40";
import { V40_BANK_DATA } from "@/constants/weddingCodeV40Bank";
import type {
  Axis,
  Bank,
  BankData,
  FacetKey,
  Item,
  ItemId,
  Pole,
  ScoredItem,
  SectionIndex,
  SelfItem,
  Side,
} from "./types";
import type { BankIssue, BankModule } from "./contract";
import { V40_LAYOUT } from "./layout";

// ===========================================================================
// 검사에 쓰는 목록 (scripts/lib/wedding-code-v40-bank-lint.mjs 와 같은 값이어야 한다. 시험이 대조한다)
// ===========================================================================

/** 화면 문구에 주장으로 쓰지 않는 말(README 2절, 설계 부록 E). 공백을 없앤 글에서 부분 문자열로 찾는다. */
export const BANK_BANNED_WORDS: readonly string[] = [
  "검증",
  "정확",
  "과학",
  "진단",
  "점수",
  "등급",
  "궁합",
  "MBTI",
  "엠비티아이",
  "동물",
  "캐릭터",
  "스타일",
  "퍼센트",
  "백분율",
];

/** 가치 판단어(설계 부록 C.1 4조). 공백을 없앤 글에서 부분 문자열로 찾는다. */
export const BANK_VALUE_JUDGEMENT_WORDS: readonly string[] = [
  "현명",
  "합리",
  "감성적",
  "충동적",
  "꼼꼼",
  "무난",
  "이성적",
  "감정적",
  "즉흥적",
  "계획적",
  "알뜰",
  "낭비",
  "사치",
  "이기적",
  "똑똑",
  "어리석",
];

/** 묻지 않는 주제(README 5절, 시작 화면 약속). */
export const BANK_FORBIDDEN_TOPICS: readonly string[] = ["신혼집", "예단", "예물", "양가비용", "비용분담"];

/** 글자 수 상한(코드 포인트 기준)과 두 극 문구 길이 차이 상한(README 5절, 작성 규칙 C.1). */
export const BANK_LIMITS = {
  caption: 12,
  stem: 90,
  text: 60,
  recap: 50,
  end: 20,
  /** 두 극의 문구 평균 길이 차이 상한(긴 쪽 기준, 퍼센트). */
  poleLengthPercent: 15,
} as const;

/** 주제당 자기 묘사 문항 상한과 간접 문항 하한(설계 4절). */
const MAX_SELF_DESCRIBING = 6;
const MIN_INDIRECT = 10;

// 특수 문자는 소스에 그대로 적지 않고 코드 값으로 만든다(줄표류, 전각 숫자, 동그라미 숫자가 소스에 숨지 않게).
const chars = (...codes: number[]): string => codes.map((code) => String.fromCodePoint(code)).join("");
const span = (from: number, to: number): string => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
/** 붙임표와 줄표류(하이픈, 붙임표, 그림 줄표, 짧은 줄표, 긴 줄표, 가로선, 마이너스, 작은 줄표, 전각 붙임표). */
const DASH_RE = new RegExp(`[-${span(0x2010, 0x2015)}${chars(0x2212, 0xfe58, 0xfe63, 0xff0d)}]`);
const DIGIT_RE = new RegExp(`[0-9${span(0xff10, 0xff19)}]`);
const PERCENT_RE = new RegExp(`[%${chars(0xff05)}]|퍼센트|백분율`);
/** 동그라미 숫자와 동그라미 한글. */
const CIRCLED_RE = new RegExp(`[${span(0x2460, 0x2473)}${span(0x3260, 0x326d)}]`);

// ===========================================================================
// 작은 도우미
// ===========================================================================

type Raw = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isSide = (value: unknown): value is Side => value === "front" || value === "back";
const squash = (text: string): string => text.replace(/\s+/g, "");
const length = (text: string): number => Array.from(text).length;

/**
 * 검사 메시지에 넣을 값 표기. JSON 으로 적되 순환 참조, BigInt, 프로토타입 없는 객체처럼 JSON.stringify 나 String 이 던지는 값은
 * 고정 문구로 바꾼다(validateBank 는 어떤 입력에도 던지지 않는다). undefined 는 「undefined」로 적는다.
 */
function show(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    return "(표시할 수 없는 값)";
  }
  try {
    return String(value);
  } catch {
    return "(표시할 수 없는 값)";
  }
}

/**
 * 극 배열에서 파생한 키(README 5절): pair, self 는 위 카드가 앞극이면 +1, react 는 highPole 이 앞극이면 +1,
 * recall 과 instant 는 (뒤 약, 앞 강, 앞 약, 뒤 강)이면 +1 이고 (앞 약, 뒤 강, 뒤 약, 앞 강)이면 -1,
 * bestworst 는 (앞, 뒤, 뒤, 앞)이면 +1 이고 반대이면 -1, split 은 (앞, 뒤, 중립)이면 +1 이고 (뒤, 앞, 중립)이면 -1.
 * 배열이 어느 쪽도 아니면 null.
 */
export function deriveKey(item: Item): 1 | -1 | null {
  const same = (list: readonly unknown[], want: readonly unknown[]) => list.length === want.length && list.every((entry, i) => entry === want[i]);
  switch (item.fmt) {
    case "pair":
    case "self": {
      const [top, bottom] = item.cards.map((card) => card.pole);
      if (top === "front" && bottom === "back") return 1;
      if (top === "back" && bottom === "front") return -1;
      return null;
    }
    case "react":
      return item.highPole === "front" ? 1 : item.highPole === "back" ? -1 : null;
    case "recall":
    case "instant": {
      const signature = item.options.map((option) => `${option.pole}:${option.strength}`);
      if (same(signature, ["back:weak", "front:strong", "front:weak", "back:strong"])) return 1;
      if (same(signature, ["front:weak", "back:strong", "back:weak", "front:strong"])) return -1;
      return null;
    }
    case "bestworst": {
      const poles = item.cards.map((card) => card.pole);
      if (same(poles, ["front", "back", "back", "front"])) return 1;
      if (same(poles, ["back", "front", "front", "back"])) return -1;
      return null;
    }
    case "split": {
      const poles = item.entries.map((entry) => entry.pole);
      if (same(poles, ["front", "back", "neutral"])) return 1;
      if (same(poles, ["back", "front", "neutral"])) return -1;
      return null;
    }
  }
}

// ===========================================================================
// 검사
// ===========================================================================

type Push = (rule: string, itemId: ItemId | null, message: string) => void;

/** 카드, 보기, 항목 목록의 모양을 확인한다. 통과하면 true. */
function checkChoiceList(
  list: unknown,
  name: string,
  count: number,
  mode: "cards" | "options" | "entries",
  fail: (message: string) => void,
): boolean {
  if (!Array.isArray(list) || list.length !== count) {
    fail(`${name} 은 ${count}개 배열이어야 한다`);
    return false;
  }
  let ok = true;
  // forEach 는 성긴 배열의 빈 칸을 건너뛰므로 색인으로 훑는다(빈 칸도 객체가 아닌 항목으로 걸러진다).
  for (let index = 0; index < list.length; index += 1) {
    const entry: unknown = list[index];
    if (!isRecord(entry)) {
      fail(`${name}[${index}] 가 객체가 아니다`);
      ok = false;
      continue;
    }
    if (!isString(entry.text)) {
      fail(`${name}[${index}].text 는 문자열이어야 한다`);
      ok = false;
    }
    const neutralSlot = mode === "entries" && index === 2;
    if (neutralSlot ? entry.pole !== "neutral" : !isSide(entry.pole)) {
      fail(`${name}[${index}].pole 이 ${neutralSlot ? "neutral" : "front 나 back"} 이어야 한다`);
      ok = false;
    }
    if (mode === "options" && entry.strength !== "strong" && entry.strength !== "weak") {
      fail(`${name}[${index}].strength 는 strong 또는 weak 이어야 한다`);
      ok = false;
    }
  }
  return ok;
}

/** 문항 하나의 구조: 배치 골격 대조, 형식별 모양, 키 파생. 모양이 맞으면 true(문구 검사를 이어 한다). */
function checkStructure(raw: unknown, index: number, push: Push): boolean {
  const slot = V40_LAYOUT[index];
  if (!isRecord(raw)) {
    push("shape", slot ? slot.id : null, `items[${index}] 가 객체가 아니다`);
    return false;
  }
  const id = isString(raw.id) ? raw.id : `#${index}`;
  const fail = (message: string) => push("shape", id, message);
  const mismatch = (field: string, actual: unknown, want: unknown) => {
    if (actual !== want) push("layout-mismatch", id, `${field} 이 ${show(actual)} 이다(배치 골격은 ${show(want)})`);
  };
  if (slot) {
    mismatch("id", raw.id, slot.id);
    mismatch("axis", raw.axis, slot.axis);
    if (slot.facet !== null) mismatch("facet", raw.facet, slot.facet);
    mismatch("section", raw.section, slot.section);
    mismatch("screen", raw.screen, slot.screen);
    mismatch("fmt", raw.fmt, slot.fmt);
    if (slot.kind !== null) mismatch("kind", raw.kind, slot.kind);
    else if (raw.kind !== undefined) mismatch("kind", raw.kind, undefined);
    mismatch("key", raw.key, slot.key);
  }
  if (!isString(raw.caption) || !isString(raw.stem)) {
    fail("caption 과 stem 은 문자열이어야 한다");
    return false;
  }
  let ok = true;
  switch (raw.fmt) {
    case "pair":
    case "self": {
      ok = checkChoiceList(raw.cards, "cards", 2, "cards", fail);
      if (ok) {
        const cards = raw.cards as readonly Raw[];
        if (cards[0].pole === cards[1].pole) {
          fail("두 카드가 front 와 back 하나씩이어야 한다");
          ok = false;
        }
      }
      if (raw.fmt === "self" && raw.caption !== V40_WRAP_UP.title) {
        push("self-caption", id, `자기 선택 캡션은 「${V40_WRAP_UP.title}」 이어야 한다`);
      }
      break;
    }
    case "react": {
      if (!isString(raw.question) || !isString(raw.recap)) {
        fail("question 과 recap 은 문자열이어야 한다");
        ok = false;
      }
      if (!isSide(raw.highPole)) {
        fail("highPole 은 front 또는 back 이어야 한다");
        ok = false;
      }
      if (!isRecord(raw.ends) || !isString(raw.ends.left) || !isString(raw.ends.right)) {
        fail("ends 는 { left, right } 문자열이어야 한다");
        ok = false;
      }
      if (raw.quote !== undefined && (!isRecord(raw.quote) || !isString(raw.quote.speaker) || !isString(raw.quote.text))) {
        fail("quote 는 { speaker, text } 문자열 둘이어야 한다");
        ok = false;
      }
      break;
    }
    case "recall":
    case "instant":
      ok = checkChoiceList(raw.options, "options", 4, "options", fail);
      break;
    case "bestworst":
      ok = checkChoiceList(raw.cards, "cards", 4, "cards", fail);
      break;
    case "split":
      ok = checkChoiceList(raw.entries, "entries", 3, "entries", fail);
      break;
    default:
      fail(`fmt 가 알 수 없는 값이다: ${show(raw.fmt)}`);
      return false;
  }
  if (raw.key !== 1 && raw.key !== -1) {
    fail("key 는 1 또는 -1 이어야 한다");
    ok = false;
  }
  if (!ok) return false;
  const derived = deriveKey(raw as unknown as Item);
  if (derived === null) push("key-arrangement", id, `극 배열이 key ${show(raw.key)} 의 배열도, 반대 배열도 아니다`);
  else if (derived !== raw.key) push("key-arrangement", id, `극 배열은 key ${derived} 의 배열인데 key 필드는 ${show(raw.key)} 이다`);
  return derived !== null;
}

/** 문구 필드 하나. role 이 규칙의 적용 범위를 정한다. */
interface TextField {
  readonly path: string;
  readonly text: string;
  readonly role: TextRole;
}

type TextRole = "caption" | "stem" | "card" | "bw-card" | "option" | "entry" | "quote" | "question" | "speaker" | "end" | "recap";

/** 해요체 말투를 확인하는 문구 종류. */
const SPOKEN_ROLES: readonly TextRole[] = ["stem", "card", "bw-card", "option", "entry", "end"];

function textFieldsOf(item: Item): TextField[] {
  const out: TextField[] = [
    { path: "caption", text: item.caption, role: "caption" },
    { path: "stem", text: item.stem, role: "stem" },
  ];
  switch (item.fmt) {
    case "pair":
    case "self":
      item.cards.forEach((card, i) => out.push({ path: `cards[${i}]`, text: card.text, role: "card" }));
      break;
    case "bestworst":
      item.cards.forEach((card, i) => out.push({ path: `cards[${i}]`, text: card.text, role: "bw-card" }));
      break;
    case "recall":
    case "instant":
      item.options.forEach((option, i) => out.push({ path: `options[${i}]`, text: option.text, role: "option" }));
      break;
    case "split":
      item.entries.forEach((entry, i) => out.push({ path: `entries[${i}]`, text: entry.text, role: "entry" }));
      break;
    case "react":
      if (item.quote) {
        out.push({ path: "quote.speaker", text: item.quote.speaker, role: "speaker" });
        out.push({ path: "quote.text", text: item.quote.text, role: "quote" });
      }
      out.push({ path: "question", text: item.question, role: "question" });
      out.push({ path: "ends.left", text: item.ends.left, role: "end" });
      out.push({ path: "ends.right", text: item.ends.right, role: "end" });
      out.push({ path: "recap", text: item.recap, role: "recap" });
      break;
  }
  return out;
}

/** 두 극의 문구 평균 길이 차이가 15퍼센트를 넘으면 설명 문장, 아니면 null. 평균끼리 정수 곱으로 비교한다. */
function poleLengthProblem(item: Item): string | null {
  const front: number[] = [];
  const back: number[] = [];
  const collect = (list: readonly { readonly pole: Pole; readonly text: string }[]) => {
    for (const entry of list) {
      if (entry.pole === "front") front.push(length(entry.text));
      else if (entry.pole === "back") back.push(length(entry.text));
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
  const frontSum = front.reduce((a, b) => a + b, 0);
  const backSum = back.reduce((a, b) => a + b, 0);
  const a = frontSum * back.length;
  const b = backSum * front.length;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if ((hi - lo) * 100 > BANK_LIMITS.poleLengthPercent * hi) {
    return `앞극 문구 평균 ${(frontSum / front.length).toFixed(1)}자, 뒤극 평균 ${(backSum / back.length).toFixed(1)}자(차이가 ${BANK_LIMITS.poleLengthPercent}퍼센트를 넘는다)`;
  }
  return null;
}

/** 문구 규칙(README 5절, 부록 C.1). 모양이 맞는 문항에만 부른다. */
function checkContent(item: Item, push: Push): void {
  const bad = (rule: string, message: string) => push(rule, item.id, message);
  const fields = textFieldsOf(item);
  const letterNames = V40_LETTERS.map((letter) => letter.name);
  const englishNames = V40_LETTERS.map((letter) => letter.english);
  const axisTitles = V40_AXES.map((axis) => axis.title);
  for (const { path, text, role } of fields) {
    const where = `${path}: `;
    const flat = squash(text);
    if (flat === "") {
      bad("empty-text", `${where}비어 있다`);
      continue;
    }
    if (DASH_RE.test(text)) bad("dash", `${where}줄표나 붙임표가 있다`);
    if (DIGIT_RE.test(text)) bad("digit", `${where}아라비아 숫자가 있다`);
    if (PERCENT_RE.test(text)) bad("percent", `${where}퍼센트 표현이 있다`);
    if (
      /(^|\s)(?:[A-Da-d]|[1-9]|[가나다라])\s*[.):]\s/.test(text) ||
      /^(?:[A-Da-d1-4]|[가나다라])\s*[:.)]/.test(text) ||
      CIRCLED_RE.test(text) ||
      /\((?:[A-Da-d1-4]|[가나다라])\)/.test(text) ||
      /(^|\s)[A-D]안(?![가-힣])/.test(text)
    ) {
      bad("label", `${where}기호 라벨처럼 보이는 표현이 있다`);
    }
    // 뒤보기(lookbehind) 없이 쓴다: 오래된 브라우저에서 정규식 문법 오류로 번들 전체가 죽지 않게.
    if (/(^|[^A-Za-z])[A-Z](?![A-Za-z])/.test(text)) bad("latin-token", `${where}홀로 선 영문 대문자가 있다`);
    const nameHit =
      letterNames.find((name) => flat.includes(squash(name))) ??
      englishNames.find((name) => new RegExp(`(^|[^A-Za-z])${name}(?![A-Za-z])`).test(text));
    if (nameHit) bad("letter-name", `${where}글자 이름이 나온다: ${nameHit}`);
    const axisHit = axisTitles.find((title) => flat.includes(squash(title)));
    if (axisHit) bad("axis-name", `${where}주제 이름이 나온다: ${axisHit}`);
    const bannedHit = BANK_BANNED_WORDS.find((word) => flat.toUpperCase().includes(word.toUpperCase()));
    if (bannedHit) bad("banned-word", `${where}금지어가 나온다: ${bannedHit}`);
    const judgeHit = BANK_VALUE_JUDGEMENT_WORDS.find((word) => flat.includes(word));
    if (judgeHit) bad("value-judgement", `${where}가치 판단어가 나온다: ${judgeHit}`);
    if (/인\s?답(?![가-힣])/.test(text)) bad("noun-answer", `${where}「~인 답」 꼴이 있다`);
    // 해요체가 아닌 합쇼체(시스템 말투). 앞말, 보기, 양끝 이름만 본다(인용문과 화자는 사람의 말이다).
    if (SPOKEN_ROLES.includes(role) && /(?:습니다|입니다|합니다|됩니다|십시오)(?![가-힣])/.test(text)) {
      bad("system-tone", `${where}합쇼체 말투가 있다`);
    }
    const topicHit = BANK_FORBIDDEN_TOPICS.find((word) => flat.includes(word));
    if (topicHit) bad("forbidden-topic", `${where}묻지 않는 주제가 나온다: ${topicHit}`);
    if (role === "bw-card" && (!/요$/.test(text) || text.includes("."))) bad("bestworst-ending", `${where}요로 끝나고 마침표가 없어야 한다`);
    const size = length(text);
    if (role === "caption" && size > BANK_LIMITS.caption) bad("text-too-long", `${where}${size}자(${BANK_LIMITS.caption}자 이하)`);
    if (role === "stem" && item.fmt !== "react" && size > BANK_LIMITS.stem) bad("text-too-long", `${where}${size}자(${BANK_LIMITS.stem}자 이하)`);
    if ((role === "card" || role === "option" || role === "entry" || role === "bw-card") && size > BANK_LIMITS.text) {
      bad("text-too-long", `${where}${size}자(${BANK_LIMITS.text}자 이하)`);
    }
    if (role === "recap" && size > BANK_LIMITS.recap) bad("text-too-long", `${where}${size}자(${BANK_LIMITS.recap}자 이하)`);
    if (role === "end" && size > BANK_LIMITS.end) bad("text-too-long", `${where}${size}자(${BANK_LIMITS.end}자 이하)`);
  }
  if (item.fmt === "react") {
    const total = length(item.stem) + (item.quote ? length(item.quote.text) : 0);
    if (total > BANK_LIMITS.stem) bad("text-too-long", `앞말과 인용문 합이 ${total}자(${BANK_LIMITS.stem}자 이하)`);
    if (squash(item.ends.left) === squash(item.ends.right)) bad("same-text", "react 양끝 이름이 같다");
  }
  const poleProblem = poleLengthProblem(item);
  if (poleProblem) bad("pole-length", poleProblem);
  const choices = fields.filter((field) => field.role === "card" || field.role === "option" || field.role === "entry" || field.role === "bw-card");
  const distinct = new Set(choices.map((field) => squash(field.text)));
  if (distinct.size !== choices.length) bad("same-text", "한 문항 안에 같은 문구의 보기가 있다");
}

/** 방향 균형과 간접 구성(README 5절, 설계 5절 방향 균형). 문항 모양이 맞은 것만 센다. */
function checkBalance(items: readonly (Item | null)[], push: Push): void {
  const keyOf = (item: Item): number => deriveKey(item) ?? 0;
  for (const axis of V40_AXIS_KEYS) {
    const rows = items.filter((item): item is ScoredItem => item !== null && item.fmt !== "self" && item.axis === axis);
    for (const fmt of ["pair", "react", "recall", "instant", "bestworst", "split"] as const) {
      const sum = rows.filter((item) => item.fmt === fmt).reduce((total, item) => total + keyOf(item), 0);
      if (sum !== 0) push("balance-key-sum", null, `${axis} ${fmt} 키 합이 ${sum} 이다(0이어야 한다)`);
    }
    const chooseSum = rows.filter((item) => item.fmt === "recall" || item.fmt === "instant").reduce((total, item) => total + keyOf(item), 0);
    if (chooseSum !== 0) push("balance-key-sum", null, `${axis} 고르기(recall + instant) 키 합이 ${chooseSum} 이다`);
    if (rows.length === V40_COUNTS.perAxis) {
      const selfDescribing = rows.filter(
        (item) => (item.fmt === "pair" && item.kind === "method") || item.fmt === "instant" || item.fmt === "bestworst",
      ).length;
      if (selfDescribing > MAX_SELF_DESCRIBING || rows.length - selfDescribing < MIN_INDIRECT) {
        push("indirect-count", null, `${axis} 자기 묘사 ${selfDescribing}개, 간접 ${rows.length - selfDescribing}개`);
      }
    }
  }
  const selfSum = items.filter((item): item is SelfItem => item !== null && item.fmt === "self").reduce((total, item) => total + keyOf(item), 0);
  if (selfSum !== 0) push("balance-self", null, `자기 선택 키 합이 ${selfSum} 이다(2:2 여야 한다)`);
  // 거울: 구간 0과 2, 구간 1과 3은 (주제, 화면 위치)가 같고 대응 문항의 키가 반대다. 짝은 배치 골격이 정한다.
  const byId = new Map<ItemId, Item>();
  for (const item of items) if (item !== null) byId.set(item.id, item);
  const scoredSlots = V40_LAYOUT.filter((slot) => slot.fmt !== "self");
  for (const slot of scoredSlots.filter((candidate) => candidate.section < 2)) {
    const partner = scoredSlots.find(
      (candidate) => candidate.section === slot.section + 2 && candidate.axis === slot.axis && candidate.screen === slot.screen + 20 && candidate.pos === slot.pos,
    );
    if (!partner) continue;
    const first = byId.get(slot.id);
    const second = byId.get(partner.id);
    if (!first || !second) continue;
    const firstKey = deriveKey(first);
    const secondKey = deriveKey(second);
    if (firstKey === null || secondKey === null) continue;
    if (firstKey !== -secondKey) push("balance-mirror", first.id, `${first.id} 와 ${second.id} 는 거울 짝인데 키가 반대가 아니다`);
  }
}

/**
 * 원본을 검사한다(README 5절 검사 규칙 1에서 6). 문제가 없으면 빈 배열. 어떤 입력에도 던지지 않는다.
 * 구조(배치 골격 대조, 형식별 모양, 키 파생), 균형(키 합, 거울, 자기 선택 2:2, 간접 구성), 문구(글자 수, 금지 표현, 극 길이)를 본다.
 */
export function validateBank(data: BankData): readonly BankIssue[] {
  const issues: BankIssue[] = [];
  const push: Push = (rule, itemId, message) => issues.push({ rule, itemId, message });
  if (!isRecord(data)) {
    push("bank-shape", null, "은행 원본이 객체가 아니다");
    return issues;
  }
  if (data.version !== WEDDING_CODE_V40_VERSION) push("version", null, `version 이 ${show(data.version)} 이다(${WEDDING_CODE_V40_VERSION})`);
  const raws: unknown = (data as unknown as Raw).items;
  if (!Array.isArray(raws)) {
    push("bank-shape", null, "items 가 배열이 아니다");
    return issues;
  }
  if (raws.length !== V40_LAYOUT.length) push("item-count", null, `문항이 ${raws.length}개다(${V40_LAYOUT.length}개여야 한다)`);
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const raw of raws) {
    if (isRecord(raw) && isString(raw.id)) {
      if (seen.has(raw.id)) duplicated.add(raw.id);
      seen.add(raw.id);
    }
  }
  for (const id of duplicated) push("id-duplicate", id, `id 가 겹친다: ${id}`);
  // map/forEach 는 성긴 배열의 빈 칸을 건너뛰어 검사 없이 통과시키므로 색인으로 만들고 훑는다.
  const shaped: (Item | null)[] = Array.from({ length: raws.length }, () => null);
  for (let index = 0; index < raws.length; index += 1) {
    const raw: unknown = raws[index];
    if (checkStructure(raw, index, push)) shaped[index] = raw as Item;
  }
  checkBalance(shaped, push);
  for (const item of shaped) if (item !== null) checkContent(item, push);
  return issues;
}

/** validateBank 가 문제를 내면 모든 메시지를 담아 Error 를 던진다. 통과하면 조회 구조를 만든다(README 5절, 질문 순서 = 링크 코드 순서). */
export function createBank(data: BankData): Bank {
  const issues = validateBank(data);
  if (issues.length > 0) {
    const lines = issues.map((issue) => `[${issue.rule}] ${issue.itemId ?? "-"}: ${issue.message}`);
    throw new Error(`문항 은행 검사에서 ${issues.length}건이 나왔다\n${lines.join("\n")}`);
  }
  const items: readonly Item[] = data.items;
  const scored = items.filter((item): item is ScoredItem => item.fmt !== "self");
  const self = items.filter((item): item is SelfItem => item.fmt === "self");
  const byId = new Map<ItemId, Item>(items.map((item) => [item.id, item]));
  const codeIndexById = new Map<ItemId, number>(items.map((item, index) => [item.id, index]));
  const scoredByAxis = {} as Record<Axis, readonly ScoredItem[]>;
  for (const axis of V40_AXIS_KEYS) scoredByAxis[axis] = scored.filter((item) => item.axis === axis);
  const screens: ItemId[][] = [];
  for (const item of items) {
    if (!screens[item.screen]) screens[item.screen] = [];
    screens[item.screen].push(item.id);
  }
  return { version: data.version, items, scored, self, byId, codeIndexById, scoredByAxis, screens };
}

// ===========================================================================
// 조회 도우미 (Bank 필드로 없는 조회: 측면, 구간, 화면, 주제의 자기 선택)
// ===========================================================================

/** id 로 문항을 찾는다(types.ts 2절 Bank.byId). 없으면 undefined. */
export function itemById(bank: Bank, id: ItemId): Item | undefined {
  return bank.byId.get(id);
}

/** id 로 채점 문항을 찾는다(설계 4절). 없거나 자기 선택이면 undefined. */
export function scoredItemById(bank: Bank, id: ItemId): ScoredItem | undefined {
  const item = bank.byId.get(id);
  return item !== undefined && item.fmt !== "self" ? item : undefined;
}

/** 한 주제의 한 측면의 채점 문항 4개(설계 4절, 질문 순서). */
export function itemsOfFacet(bank: Bank, axis: Axis, facet: FacetKey): readonly ScoredItem[] {
  return bank.scoredByAxis[axis].filter((item) => item.facet === facet);
}

/** 한 구간(0에서 3은 채점 문항 16개, 4는 자기 선택 4개)의 문항(설계 6절 화면 묶음, 질문 순서). */
export function itemsOfSection(bank: Bank, section: SectionIndex): readonly Item[] {
  return bank.items.filter((item) => item.section === section);
}

/** 한 질문 화면(0에서 41)의 문항 1~2개(설계 6절 화면 묶음, 화면 순서). 화면 번호가 범위 밖이면 빈 배열. */
export function itemsOfScreen(bank: Bank, screen: number): readonly Item[] {
  const ids = Number.isInteger(screen) ? bank.screens[screen] : undefined;
  if (!ids) return [];
  return ids.flatMap((id) => {
    const item = bank.byId.get(id);
    return item ? [item] : [];
  });
}

/** 한 주제의 자기 선택 문항(설계 3절 자기 선택). */
export function selfItemOfAxis(bank: Bank, axis: Axis): SelfItem | undefined {
  return bank.self.find((item) => item.axis === axis);
}

// ===========================================================================
// 출하 은행
// ===========================================================================

/** 이 파일의 함수를 계약(BankModule)대로 묶은 객체. */
export const bankModule = { validateBank, createBank } satisfies BankModule;

/** 생성된 원본(V40_BANK_DATA)으로 만든 조회 구조(README 1절). 다른 모듈은 bank 를 인자로 받고, 앱은 이 값을 넘긴다. 원본이 검사를 통과하지 못하면 불러오는 순간 던진다. */
export const WEDDING_CODE_V40_BANK: Bank = createBank(V40_BANK_DATA);
