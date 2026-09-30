// 웨딩코드 4.0 문항 은행 검사기와 생성기 시험.
//
// 문구를 모르는 시험이다. 변형 대상은 지금 은행에서 형식과 자리(카드, 보기, 항목, 앞말 ...)로 골라 그 자리의 글에 위반을 심는다.
// 고정 앵커(특정 문항의 특정 낱말)도, 저장된 생성 파일의 바이트도 기대하지 않는다. 실제 은행이 자리표시 문구이든 최종 문구이든 같다.
//
// 지키는 것
//   1. 실제 은행 파일(docs/wedding-code/2026-09-29_v40_items.json)의 placeholder 표시에 맞는 결과가 나온다.
//      표시가 없으면 엄격 검사가 오류도 경고도 없이 통과하고, 표시가 남았으면 --allow-placeholder 로만 통과한다.
//   2. 규칙마다 그 규칙 하나만 깨는 변형(뮤테이션)을 메모리 복사본에 심으면 검사가 정확히 그 오류를 낸다.
//      글의 자리(자리마다 하나씩), 문자 종류(줄표류, 따옴표류, 라벨류), 글자 수 경계(한도와 한도 + 1)를 나눠 본다.
//   3. 모든 규칙(오류와 경고)이 적어도 하나의 시험으로 시험된다(시험 없는 규칙이 생기면 이 시험이 빨개진다).
//   4. placeholder 정책: 문구 규칙은 내려가도 구조와 균형은 내려가지 않는다.
//   5. 생성기는 검사를 통과한 원본만 쓰고, 생성 결과는 원본에서 새로 만든 것과 같다(저장된 파일은 드리프트만 본다).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateBankModule } from "../build-wedding-code-v40-bank.mjs";
import * as lintModule from "../lib/wedding-code-v40-bank-lint.mjs";
import * as ref from "../lib/wedding-code-v40-ref.mjs";

const { RULES, lintBank, formatReport } = lintModule;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINT_CLI = join(ROOT, "scripts", "wedding-code-v40-bank-lint.mjs");
const BUILD_CLI = join(ROOT, "scripts", "build-wedding-code-v40-bank.mjs");
const BANK_PATH = ref.DEFAULT_BANK_PATH;
const GENERATED_PATH = join(ROOT, "apps", "web", "src", "constants", "weddingCodeV40Bank.ts");
const CONSTANTS_TS = readFileSync(join(ROOT, "apps", "web", "src", "constants", "weddingCodeV40.ts"), "utf8");

// 특수 문자는 소스에 그대로 적지 않고 코드 값으로 만든다(줄표류, 전각 문자, 동그라미 숫자, 굽은 따옴표가 소스에 숨지 않게).
const cp = (...codes) => String.fromCodePoint(...codes);
const EM_DASH = cp(0x2014);
const EN_DASH = cp(0x2013);
const ANY_DASH = new RegExp(`[${EN_DASH}-${cp(0x2015)}${cp(0x2212)}]`);

// 글자 수 한도. 검사기의 LIMITS 를 읽지 않고 설계 문서(계약 5절, 작성 규칙 C.1)와 검사기 머리말의 값을 이 시험이 따로 들고 있다.
// 검사기의 한도가 바뀌면 경계 시험이 빨개진다.
const SPEC = { caption: 12, stem: 90, text: 60, recap: 50, end: 20, question: 40, speaker: 8, poleLengthPercent: 15, topicSimilarity: 0.5 };

const len = (s) => [...s].length;
const realData = () => JSON.parse(readFileSync(BANK_PATH, "utf8"));
const layoutCopy = () => structuredClone(ref.loadLayout());
const hasPlaceholder = (data) => data.placeholder === true || data.items.some((it) => it.placeholder === true);

/** placeholder 표시를 모두 지운 복사본(최종 은행과 같은 모양). 실제 은행이 자리표시이든 아니든 문구 규칙 변형은 여기에 심는다. */
function finalBank() {
  const data = realData();
  delete data.placeholder;
  delete data.note;
  for (const item of data.items) delete item.placeholder;
  return data;
}

/** 자리표시 은행의 모양: 최상위와 모든 문항에 placeholder: true. */
function placeholderBank() {
  const data = finalBank();
  data.placeholder = true;
  for (const item of data.items) item.placeholder = true;
  return data;
}

const rulesOf = (result) => new Set(result.errors.map((e) => e.rule));
const show = (result) => [...result.errors, ...result.warnings].map((e) => `${e.rule}@${e.itemId ?? "-"}: ${e.message}`).join("\n");

// ---------------------------------------------------------------------------
// 0. 자리 고르기: 형식과 자리로 지금 은행에서 대상을 고른다
// ---------------------------------------------------------------------------

/** 문항이 조건을 모두 만족하는가. 값이 함수이면 (값, 문항) 판정, 키가 $ 이면 문항 전체 판정. */
const matches = (obj, where) => Object.entries(where).every(([k, v]) => (k === "$" ? v(obj) : typeof v === "function" ? v(obj[k], obj) : obj[k] === v));
const itemsWhere = (bank, where) => bank.items.filter((it) => matches(it, where));
function firstItem(bank, where, n = 0) {
  const list = itemsWhere(bank, where);
  assert.ok(list.length > n, `은행에서 ${JSON.stringify(where)} 의 ${n + 1}번째 문항을 찾지 못했다`);
  return list[n];
}
function rowWhere(layout, where, n = 0) {
  const list = layout.filter((r) => matches(r, where));
  assert.ok(list.length > n, `배치 골격에서 ${JSON.stringify(where)} 의 ${n + 1}번째 행을 찾지 못했다`);
  return list[n];
}

/** 문항의 문구 자리 목록. 검사기 내부 함수를 쓰지 않고 이 시험이 직접 만든다. role 은 검사기의 자리 이름과 같다. */
function slotsOf(item) {
  const out = [];
  const field = (role, obj, key, path, pole) => {
    if (typeof obj?.[key] === "string") {
      out.push({ role, path, pole, get: () => obj[key], set: (v) => { obj[key] = v; } });
    }
  };
  const list = (arr, role, name) => (arr ?? []).forEach((e, i) => field(role, e, "text", `${name}[${i}]`, e?.pole));
  field("caption", item, "caption", "caption");
  field("stem", item, "stem", "stem");
  switch (item.fmt) {
    case "pair":
      list(item.cards, item.kind === "moment" ? "card-moment" : "card", "cards");
      break;
    case "self":
      list(item.cards, "card", "cards");
      break;
    case "bestworst":
      list(item.cards, "bw-card", "cards");
      break;
    case "recall":
    case "instant":
      list(item.options, "option", "options");
      break;
    case "split":
      list(item.entries, "entry", "entries");
      break;
    case "react":
      field("speaker", item.quote, "speaker", "quote.speaker");
      field("quote", item.quote, "text", "quote.text");
      field("question", item, "question", "question");
      field("end", item.ends, "left", "ends.left");
      field("end", item.ends, "right", "ends.right");
      field("recap", item, "recap", "recap");
      break;
    default:
      break;
  }
  return out;
}

const CHOICE_ROLES = new Set(["card", "card-moment", "bw-card", "option", "entry"]);
/** 글 앞쪽 열두 글자에 따옴표 괄호가 없는가(기호 라벨처럼 반드시 글머리에 붙여야 하는 위반을 심을 수 있다). */
const headSafe = (slot) => !/[「」]/.test([...slot.get()].slice(0, 12).join(""));
/** 끝맺음 글자가 닫는 괄호가 아닌가(끝맺음을 바꾸는 변형이 괄호를 깨지 않는다). */
const endSafe = (slot) => !/」[.?!…\s]*$/u.test(slot.get());

/** 자리 이름 -> 그 자리가 있는 첫 문항의 조건. */
const ROLE_ITEMS = {
  caption: { fmt: "pair", kind: "method" },
  stem: { fmt: "pair", kind: "method" },
  card: { fmt: "pair", kind: "method" },
  "card-moment": { fmt: "pair", kind: "moment" },
  "bw-card": { fmt: "bestworst" },
  option: { fmt: "recall" },
  entry: { fmt: "split" },
  speaker: { fmt: "react", kind: "action" },
  quote: { fmt: "react", kind: "action" },
  question: { fmt: "react", kind: "action" },
  end: { fmt: "react", kind: "action" },
  recap: { fmt: "react", kind: "action" },
};
const ROLES = Object.keys(ROLE_ITEMS);
const ROLE_LABEL = {
  caption: "캡션", stem: "앞말", card: "카드", "card-moment": "순간 카드", "bw-card": "가장·아닌 것 카드", option: "보기", entry: "칸 나누기 항목",
  speaker: "화자", quote: "인용문", question: "물음", end: "양끝 이름", recap: "앞 구절",
};
const SLOT_COUNT = { caption: 1, stem: 1, card: 2, "card-moment": 2, "bw-card": 4, option: 4, entry: 3, speaker: 1, quote: 1, question: 1, end: 2, recap: 1 };

/**
 * role 자리를 가진 첫 문항의 n 번째 자리(조건에 맞는 자리끼리 센다).
 * opts: { where, n, ok }  where 는 문항 조건(기본은 ROLE_ITEMS[role]), ok 는 자리 조건.
 */
function targetOf(bank, role, opts = {}) {
  const where = opts.where ?? ROLE_ITEMS[role];
  const n = opts.n ?? 0;
  for (const item of itemsWhere(bank, where)) {
    const list = slotsOf(item).filter((s) => s.role === role && (opts.ok ? opts.ok(s) : true));
    if (list.length > n) return { item, slot: list[n] };
  }
  return assert.fail(`은행에서 ${role} 자리(${JSON.stringify(where)})를 찾지 못했다`);
}

function mutateSlot(bank, role, fn, opts = {}) {
  const { item, slot } = targetOf(bank, role, opts);
  slot.set(fn(slot.get(), item));
  return item;
}

// ---------------------------------------------------------------------------
// 0. 글 다루기
// ---------------------------------------------------------------------------

/**
 * 앞머리 글자를 token 으로 덮어써 위반을 심는다. 글자 수와 끝맺음은 그대로다.
 *   - 따옴표 괄호를 덮지 않도록 괄호가 없는 첫 자리부터 덮는다(글머리가 안전하면 글머리).
 *   - 공백으로 끝나는 토큰 바로 뒤에 공백이 오면 그 공백을 채움 글자로 바꿔 겹공백을 피한다(글자 수 유지).
 *   - 글이 토큰보다 짧으면(화자 같은 두 글자 명사) 글 전체를 토큰으로 바꾼다.
 *   - mid 이면 글머리가 아니라 첫 낱말 바로 뒤(공백 다음)에 심는다(글 가운데의 위반).
 */
function plant(text, token, mid = false) {
  const t = [...token];
  const c = [...text];
  if (c.length <= t.length) return token.trim();
  let at = mid ? c.indexOf(" ") + 1 : 0;
  assert.ok(at + t.length < c.length, `글 가운데에 심을 자리가 없다: ${text}`);
  while (at + t.length < c.length && c.slice(at, at + t.length).some((ch) => ch === "「" || ch === "」")) at += 1;
  const rest = c.slice(at + t.length);
  if (token.endsWith(" ") && rest[0] === " ") rest[0] = "가";
  return [...c.slice(0, at), ...t, ...rest].join("");
}

/** 끝맺음 글자(끝의 마침표, 물음표, 말줄임표, 공백은 그대로)를 ch 로 바꾼다. */
function withEnding(text, ch) {
  const m = /^([\s\S]*?)([.?!…\s]*)$/u.exec(text);
  const body = [...m[1]];
  assert.ok(body.length > 0 && body.at(-1) !== ch, `끝맺음을 바꿀 수 없다: ${text}`);
  body[body.length - 1] = ch;
  return body.join("") + m[2];
}

/** 첫 문장의 끝맺음 글자를 ch 로 바꾼다(문장이 둘 이상인 문구). */
function withFirstSentenceEnding(text, ch) {
  const m = /^([\s\S]*?)([^\s.?!])([.?!])(\s)/u.exec(text);
  assert.ok(m && m[2] !== ch, `문장이 둘 이상이 아니다: ${text}`);
  return text.slice(0, m[1].length) + ch + text.slice(m[1].length + 1);
}

/** 길이가 n 이고 요로 끝나는 합성 문구. 규칙의 경계값 시험에 쓴다. */
const syn = (fill, n) => fill.repeat(n - 1) + "요";
const FILL = ["가", "나", "다", "라"];

/**
 * 앞 낱말을 덜어 내 길이를 절반 아래로 줄인다(뒤 낱말을 남겨 끝맺음을 지킨다).
 * 따옴표 괄호의 짝이 깨지면 괄호를 걷어 낸다. taken 에 이미 있는 글이 되면 낱말을 하나씩 더 남긴다(같은 문구 규칙을 피한다).
 */
function shrinkTail(text, taken = new Set()) {
  const words = text.split(" ");
  assert.ok(words.length >= 3, `줄일 수 없는 문구: ${text}`);
  const limit = Math.floor(len(text) / 2);
  const make = (count) => {
    const tail = words.slice(-count).join(" ");
    const opens = [...tail].filter((ch) => ch === "「").length;
    const closes = [...tail].filter((ch) => ch === "」").length;
    return opens === closes ? tail : tail.replace(/[「」]/g, "");
  };
  let count = 0;
  for (let i = words.length - 1; i >= 0 && len(words.slice(i).join(" ")) <= limit; i -= 1) count = words.length - i;
  assert.ok(count > 0, `줄인 꼬리가 비었다: ${text}`);
  let tail = make(count);
  while (taken.has(tail) && count < words.length - 1) {
    count += 1;
    tail = make(count);
  }
  taken.add(tail);
  return tail;
}

function poleGap(item) {
  const slots = slotsOf(item).filter((s) => CHOICE_ROLES.has(s.role));
  const mean = (pole) => {
    const lens = slots.filter((s) => s.pole === pole).map((s) => len(s.get()));
    return lens.reduce((a, b) => a + b, 0) / lens.length;
  };
  const f = mean("front");
  const b = mean("back");
  return Math.abs(f - b) / Math.max(f, b);
}

/** 한 극의 모든 문구를 절반 아래로 줄여 두 극 길이 차이를 벌린다. 변형이 충분히 센지도 여기서 확인한다. */
function shrinkPole(item, pole) {
  const all = slotsOf(item).filter((s) => CHOICE_ROLES.has(s.role));
  const targets = all.filter((s) => s.pole === pole);
  assert.ok(targets.length > 0, `${pole} 극 문구가 없다: ${item.id}`);
  const taken = new Set(all.filter((s) => s.pole !== pole).map((s) => s.get()));
  for (const s of targets) s.set(shrinkTail(s.get(), taken));
  const gap = poleGap(item);
  assert.ok(gap > 0.2, `줄인 뒤에도 두 극 길이 차이가 ${gap.toFixed(2)} 뿐이다: ${item.id}`);
}

/** 키를 뒤집고 극 배열도 그에 맞게 뒤집는다(배치 골격은 호출자가 따로 고친다). */
function flipKeyConsistently(item) {
  switch (item.fmt) {
    case "pair":
    case "self":
      item.cards = [item.cards[1], item.cards[0]];
      break;
    case "react":
      item.highPole = item.highPole === "front" ? "back" : "front";
      item.ends = { left: item.ends.right, right: item.ends.left };
      break;
    default:
      throw new Error(`flipKeyConsistently: ${item.fmt} 는 시험에 쓰지 않는다`);
  }
  item.key = -item.key;
}

/** 형식별 극 배열을 결정하는 키를 뒤집는다: 카드/보기/항목의 극 배열만 바꾸고 key 필드는 그대로 둔다. */
function flipArrangementOnly(item) {
  const list = item.cards ?? item.options ?? item.entries;
  assert.ok(list, `극 배열을 뒤집을 목록이 없다: ${item.id}`);
  const flip = (p) => (p === "front" ? "back" : p === "back" ? "front" : p);
  for (const e of list) e.pole = flip(e.pole);
}

// ---------------------------------------------------------------------------
// 1. 실제 파일
// ---------------------------------------------------------------------------

test("실제 은행 파일: 엄격 검사와 --allow-placeholder 검사가 placeholder 표시와 맞아떨어진다", () => {
  const data = realData();
  const flagged = data.items.filter((it) => it.placeholder === true).length;
  const strict = lintBank(data, { allowPlaceholder: false });
  const lenient = lintBank(data, { allowPlaceholder: true });
  for (const result of [strict, lenient]) {
    assert.equal(result.stats.items, ref.loadLayout().length);
    assert.equal(result.stats.items, 68);
    assert.equal(result.stats.placeholderItems, flagged);
    assert.equal(result.stats.balanceRan, true);
    // 정적 균형 시험 건수: 주제 4 x (고정 응답 (여섯 + 다섯 + 네 + 네 + 열둘 + 스물여덟 = 59) x 폼 비트 2
    // + 번갈아, 돌려 누르기 2 x 서식 묶음 5 x 폼 비트 2 + 위치 함수 8 x 시행 40 x 서식 묶음 5) = 6952. 검사 범위가 줄면 이 셈이 어긋난다.
    assert.equal(result.stats.balanceChecks, 4 * (59 * 2 + 2 * 5 * 2 + 8 * 40 * 5), `정적 균형 시험 ${result.stats.balanceChecks}건`);
    assert.ok(result.stats.maxTopicSimilarity > 0 && result.stats.maxTopicSimilarity < SPEC.topicSimilarity, `소재 유사도 ${result.stats.maxTopicSimilarity}`);
  }
  if (hasPlaceholder(data)) {
    // 자리표시 은행: 플래그 없이는 표시 하나만 오류, 플래그가 있으면 통과하고 문구도 깨끗하다.
    assert.deepEqual(strict.errors.map((e) => e.rule), ["placeholder-present"], show(strict));
    assert.deepEqual(strict.warnings, []);
    assert.deepEqual(lenient.errors, [], show(lenient));
    assert.deepEqual(lenient.warnings.filter((w) => w.rule !== "placeholder-present"), [], "자리표시 문구도 문구 규칙을 지킨다");
    assert.equal(lenient.warnings.filter((w) => w.rule === "placeholder-present").length, 1);
    assert.ok(flagged > 0 || data.placeholder === true);
  } else {
    // 최종 은행: 플래그가 있든 없든 오류도 경고도 없다.
    assert.equal(flagged, 0);
    assert.deepEqual(strict.errors, [], show(strict));
    assert.deepEqual(strict.warnings, []);
    assert.deepEqual(lenient.errors, [], show(lenient));
    assert.deepEqual(lenient.warnings, []);
  }
});

test("파일을 읽어 검사하는 함수(lintBankFile)와 메모리 검사가 같은 결과를 낸다(옵션도 넘긴다)", () => {
  assert.deepEqual(lintModule.lintBankFile(BANK_PATH, { allowPlaceholder: true }), lintBank(realData(), { allowPlaceholder: true }));
  assert.deepEqual(lintModule.lintBankFile(BANK_PATH), lintBank(realData()));
  const dir = mkdtempSync(join(tmpdir(), "wc40-lintfile-"));
  try {
    const path = join(dir, "placeholder.json");
    writeFileSync(path, JSON.stringify(placeholderBank()), "utf8");
    const soft = lintModule.lintBankFile(path, { allowPlaceholder: true });
    assert.deepEqual(soft.errors, []);
    assert.deepEqual(soft, lintBank(placeholderBank(), { allowPlaceholder: true }));
    assert.deepEqual(lintModule.lintBankFile(path).errors.map((e) => e.rule), ["placeholder-present"]);
    assert.throws(() => lintModule.lintBankFile(join(dir, "missing.json")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("보고서: 같은 규칙의 오류는 기본으로 여덟 건까지만 적고 verbose 이면 전부 적는다", () => {
  const bank = finalBank();
  const dashed = itemsWhere(bank, { fmt: "pair" }).slice(0, 10);
  for (const item of dashed) item.caption = plant(item.caption, EM_DASH);
  const result = lintBank(bank);
  assert.equal(result.errors.filter((e) => e.rule === "dash").length, 10);
  const short = formatReport(result);
  const full = formatReport(result, { verbose: true });
  assert.match(short, /\.\.\. 2건 더/);
  assert.doesNotMatch(full, /건 더/);
  assert.equal(full.split("\n").filter((l) => l.includes("줄표나 붙임표가 있다")).length, 10);
  assert.equal(short.split("\n").filter((l) => l.includes("줄표나 붙임표가 있다")).length, 8);
  assert.match(full, /실패\(오류 10건\)/);
  assert.match(full, /\[dash\] \(content\)/);
});

test("placeholder 표시를 지운 실제 은행은 오류도 경고도 없다(최종 은행의 모양)", () => {
  const result = lintBank(finalBank());
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings, []);
  assert.ok(result.stats.maxTopicSimilarity > 0 && result.stats.maxTopicSimilarity < SPEC.topicSimilarity, `소재 유사도 ${result.stats.maxTopicSimilarity}`);
});

test("실제 은행에 placeholder 표시를 모두 단 복사본은 엄격 검사에서 표시 하나만 오류이고 --allow-placeholder 로 통과한다", () => {
  const strict = lintBank(placeholderBank(), { allowPlaceholder: false });
  assert.deepEqual(strict.errors.map((e) => e.rule), ["placeholder-present"], show(strict));
  assert.deepEqual(strict.warnings, []);
  const lenient = lintBank(placeholderBank(), { allowPlaceholder: true });
  assert.deepEqual(lenient.errors, [], show(lenient));
  assert.deepEqual(lenient.warnings.map((w) => w.rule), ["placeholder-present"]);
  assert.equal(lenient.stats.placeholderItems, 68);
});

test("실제 은행 파일 독립 확인: 줄표, 숫자, 퍼센트, 금지어, 글자 이름이 없다(검사기 코드와 무관한 정규식)", () => {
  const text = readFileSync(BANK_PATH, "utf8");
  const data = JSON.parse(text);
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const item of data.items) {
    const { id, axis, facet, fmt, kind, highPole, ...rest } = item;
    void id; void axis; void facet; void fmt; void kind; void highPole;
    for (const [key, value] of Object.entries(rest)) if (!["section", "screen", "key", "placeholder"].includes(key)) walk(value);
  }
  assert.ok(strings.length > 500, `문구 ${strings.length}개`);
  for (const s of strings) {
    assert.doesNotMatch(s, ANY_DASH, `줄표: ${s}`);
    assert.doesNotMatch(s, /[0-9%]/, `숫자나 퍼센트: ${s}`);
    assert.doesNotMatch(s, /검증|정확|과학|진단|점수|등급|궁합|MBTI|스타일|동물|캐릭터/, `금지어: ${s}`);
    assert.doesNotMatch(s.replace(/\s+/g, ""), /조건먼저|장면먼저|같이하기|나눠하기|둘이정하기|가족과정하기|마음먼저|할일먼저|돈을정할때|준비를굴릴때|함께정하는사람|지쳤을때/, `글자, 주제 이름: ${s}`);
    assert.doesNotMatch(s, /인 ?답(?![가-힣])/, `~인 답: ${s}`);
  }
  assert.equal(data.items.length, ref.loadLayout().length);
});

// ---------------------------------------------------------------------------
// 2. 변형(뮤테이션): 하나씩 깨고 그 오류를 기대한다
// ---------------------------------------------------------------------------
//
// rules   반드시 나와야 하는 오류 규칙
// allowed 나와도 되는 규칙(생략하면 rules 와 정확히 같아야 한다 = 딱 그 규칙 하나만 깨진다)
// mutate  (bank, layout) 를 고친다. layout 은 배치 골격 복사본이며 균형 변형에서 은행과 함께 고친다.
//         값을 돌려주면 그 값을 검사한다(은행이 객체가 아닌 경우 등).

const MUTATIONS = [];
const add = (c) => MUTATIONS.push(c);
/** 자리 role 의 글에 token 을 심는 변형(extra.mid 이면 글 가운데에). */
const plantCase = (name, role, token, rules, extra = {}) => ({
  name,
  rules,
  ...(extra.allowed ? { allowed: extra.allowed } : {}),
  mutate: (b) => { mutateSlot(b, role, (t) => plant(t, token, extra.mid === true), extra.opts ?? {}); },
});

// ---- 문구(content): 문자 종류 ----
const DASH_CHARS = [
  ["긴 줄표", EM_DASH], ["짧은 줄표", EN_DASH], ["붙임표", "-"], ["가로선", cp(0x2015)], ["마이너스 기호", cp(0x2212)],
  ["하이픈", cp(0x2010)], ["줄바꿈 없는 하이픈", cp(0x2011)], ["그림 줄표", cp(0x2012)], ["작은 줄표", cp(0xfe58)], ["작은 붙임표", cp(0xfe63)], ["전각 붙임표", cp(0xff0d)],
];
for (const [label, ch] of DASH_CHARS) add(plantCase(`줄표류(${label})를 카드에 심는다`, "card", ch, ["dash"]));

add(plantCase("칸 나누기 앞말에 아라비아 숫자를 쓴다", "stem", "6", ["digit"], { opts: { where: { fmt: "split" } } }));
add(plantCase("전각 숫자를 쓴다", "card", cp(0xff16), ["digit"]));
add(plantCase("숫자 0 을 쓴다", "card", "0", ["digit"]));
add(plantCase("숫자 9 를 쓴다", "card", "9", ["digit"]));
add(plantCase("퍼센트 기호를 쓴다", "card", "%", ["percent"]));
add(plantCase("전각 퍼센트 기호를 쓴다", "card", cp(0xff05), ["percent"]));
add(plantCase("퍼센트라는 말을 쓴다", "card", "퍼센트 ", ["percent", "banned-word"]));
add(plantCase("백분율이라는 말을 쓴다", "card", "백분율 ", ["percent", "banned-word"]));

// 기호 라벨: [토큰, 함께 나오는 규칙]
const LABELS = [
  ["가) ", []], ["나. ", []], ["다: ", []], ["라) ", []], ["(가) ", []], ["a) ", []],
  ["B. ", ["latin-token"]], ["D) ", ["latin-token"]], ["A) ", ["latin-token"]], ["A안 ", ["latin-token"]],
  ["1. ", ["digit"]], ["2) ", ["digit"]], ["5) ", ["digit"]], ["(1) ", ["digit"]], ["1) ", ["digit"]],
  [`${cp(0x2460)} `, []], [`${cp(0x2473)} `, []], [`${cp(0x3260)} `, []], [`${cp(0x326d)} `, []],
];
// 마침표로 끝나는 라벨(「나.」)은 그 자체가 요로 끝나지 않는 한 문장이라 해요체 규칙도 함께 걸린다.
for (const [token, also] of LABELS) {
  add(plantCase(`카드 앞에 「${token.trim()}」 라벨을 붙인다`, "card", token, ["label", ...also, ...(token.trim().endsWith(".") ? ["politeness"] : [])], { opts: { where: {}, ok: headSafe } }));
}

// 글머리가 아니라 글 가운데 낱말 사이에 나오는 라벨 [토큰, 함께 나오는 규칙]
const MID_LABELS = [["가) ", []], ["다: ", []], ["(가) ", []], ["a) ", []], ["A안 ", ["latin-token"]], ["나. ", ["politeness"]], ["2) ", ["digit"]]];
for (const [token, also] of MID_LABELS) {
  add(plantCase(`카드 가운데에 「${token.trim()}」 라벨이 끼어든다`, "card", token, ["label", ...also], { mid: true, opts: { where: {} } }));
}
// 라벨 뒤에 공백 없이 글이 바로 붙은 글머리
for (const [token, also] of [["가)", []], ["1.", ["digit"]], ["A)", ["latin-token"]]]) {
  add(plantCase(`카드 앞에 공백 없는 「${token}」 라벨을 붙인다`, "card", token, ["label", ...also], { opts: { where: {}, ok: headSafe } }));
}

add(plantCase("홀로 선 영문 대문자(V)를 쓴다", "card", "V", ["latin-token"]));
add(plantCase("홀로 선 영문 대문자(Z)를 쓴다", "card", "Z", ["latin-token"]));

// 글자 이름과 주제 이름
const LETTER_NAMES = ["조건 먼저", "장면 먼저", "같이 하기", "나눠 하기", "둘이 정하기", "가족과 정하기", "마음 먼저", "할 일 먼저"];
const ENGLISH_NAMES = ["Verify", "Scene", "With", "Divide", "Us", "Family", "Heart", "Action"];
const AXIS_NAMES = ["돈을 정할 때", "준비를 굴릴 때", "함께 정하는 사람", "지쳤을 때"];
for (const name of LETTER_NAMES) add(plantCase(`글자 이름(${name})을 문항에 쓴다`, "stem", `${name} `, ["letter-name"]));
add(plantCase("글자 이름이 띄어쓰기만 다르게(조건먼저) 들어가도 잡는다", "stem", "조건먼저 ", ["letter-name"]));
add(plantCase("글자 이름이 띄어쓰기만 다르게(같이하기) 들어가도 잡는다", "option", "같이하기 ", ["letter-name"]));
for (const name of ENGLISH_NAMES) add(plantCase(`영어 글자 이름(${name})을 문항에 쓴다`, "card", `${name} `, ["letter-name"]));
for (const name of AXIS_NAMES) add(plantCase(`주제 이름(${name})을 문항에 쓴다`, "stem", `${name} `, ["axis-name"]));
add(plantCase("주제 이름이 띄어쓰기만 다르게(돈을정할때) 들어가도 잡는다", "card", "돈을정할때 ", ["axis-name"]));

// 금지어, 가치 판단어, 묻지 않는 주제
const BANNED = ["검증", "정확", "과학", "진단", "점수", "등급", "궁합", "MBTI", "엠비티아이", "동물", "캐릭터", "스타일"];
for (const word of BANNED) add(plantCase(`금지어(${word})를 쓴다`, "card", `${word} `, ["banned-word"]));
add(plantCase("금지어를 소문자(mbti)로 써도 잡는다", "card", "mbti ", ["banned-word"]));
add(plantCase("금지어가 띄어쓰기로 갈라져도(검 증) 잡는다", "card", "검 증 ", ["banned-word"]));
const JUDGEMENT = ["현명", "합리", "감성적", "충동적", "꼼꼼", "무난", "이성적", "감정적", "즉흥적", "계획적", "알뜰", "낭비", "사치", "이기적", "똑똑", "어리석"];
for (const word of JUDGEMENT) add(plantCase(`가치 판단어(${word})를 쓴다`, "card", `${word} `, ["value-judgement"]));
add(plantCase("「~인 답」 꼴을 쓴다", "card", "인 답 ", ["noun-answer"]));
add(plantCase("「~인답」 꼴을 붙여 써도 잡는다", "card", "인답 ", ["noun-answer"]));
const TOPICS = ["신혼집", "예단", "예물", "양가 비용", "양가비용", "비용 분담", "비용분담"];
for (const word of TOPICS) add(plantCase(`묻지 않는 주제(${word})를 쓴다`, "card", `${word} `, ["forbidden-topic"]));
const AMOUNTS = ["십만 원 ", "삼천원 ", "이백오십만 원 ", "천 원 ", "억원 "];
for (const word of AMOUNTS) add(plantCase(`금액(${word.trim()})을 쓴다`, "card", word, ["money-amount"]));

// ---- 문구: 따옴표 ----
const STRAY_QUOTES = [["곧은 큰따옴표", '"'], ["굽은 여는 큰따옴표", cp(0x201c)], ["굽은 닫는 큰따옴표", cp(0x201d)], ["굽은 여는 작은따옴표", cp(0x2018)], ["굽은 닫는 작은따옴표", cp(0x2019)], ["억음 부호", "`"], ["작은따옴표", "'"]];
for (const [label, ch] of STRAY_QUOTES) add(plantCase(`따옴표(${label})를 「 」 대신 쓴다`, "card", ch, ["quote-style"]));
add(plantCase("「 만 열고 닫지 않는다", "card", "「", ["quote-balance"]));
add(plantCase("「 를 겹쳐 열고 한 번만 닫는다", "card", "「「그」 ", ["quote-balance"]));
add(plantCase("」 만 닫고 열지 않는다", "card", "」", ["quote-balance"]));
add(plantCase("「 」를 겹쳐 쓴다", "card", "「「그」」 ", ["quote-balance"]));
add(plantCase("가장·아닌 것 카드 안에 「 」를 쓴다", "bw-card", "「그」 ", ["nested-quote"]));
add(plantCase("칸 나누기 항목 안에 「 」를 쓴다", "entry", "「그」 ", ["nested-quote"]));
add({
  name: "react 인용문에 바깥 「 」를 적는다",
  rules: ["quote-brackets"],
  mutate: (b) => { mutateSlot(b, "quote", (t) => { const c = [...t]; return `「${c.slice(1, -1).join("")}」`; }); },
});
add({
  name: "react 인용문 앞에 「 만 적는다",
  rules: ["quote-brackets", "quote-balance"],
  mutate: (b) => { mutateSlot(b, "quote", (t) => plant(t, "「")); },
});
add({
  name: "react 인용문 앞에 」 만 적는다",
  rules: ["quote-brackets", "quote-balance"],
  mutate: (b) => { mutateSlot(b, "quote", (t) => plant(t, "」")); },
});

// ---- 문구: 해요체 ----
/** 자리 role 의 끝맺음을 ch 로 바꾸는 변형(닫는 괄호로 끝나는 글은 건너뛴다). */
const endingCase = (name, role, ch, rules, opts = {}) => add({ name, rules, mutate: (b) => { mutateSlot(b, role, (t) => withEnding(t, ch), { ...opts, ok: endSafe }); } });
endingCase("카드 문장을 해요체가 아니게 끝낸다", "card", "다", ["politeness"]);
add({
  name: "카드의 첫 문장만 해요체가 아니게 끝낸다",
  rules: ["politeness"],
  mutate: (b) => { mutateSlot(b, "card", (t) => withFirstSentenceEnding(t, "다"), { ok: (s) => /[^\s.?!「」][.?!]\s/.test(s.get()) }); },
});
endingCase("인용 밖 문장이 명사로 끝난다(앞말)", "stem", "저", ["politeness"]);
endingCase("순간 카드가 「순간」으로 끝나지 않고 해요체도 아니다", "card-moment", "다", ["politeness"]);
endingCase("지난 일 보기가 해요체가 아니게 끝난다", "option", "다", ["politeness"]);
endingCase("칸 나누기 항목이 「기」로도 요로도 끝나지 않는다", "entry", "다", ["politeness"]);
endingCase("react 양끝 이름이 해요체가 아니게 끝난다", "end", "다", ["politeness"]);
endingCase("react 양끝 이름의 오른쪽이 해요체가 아니게 끝난다", "end", "다", ["politeness"], { n: 1 });
add({
  name: "그때 나는 앞말이 말줄임표 없이 명사로 끝난다",
  rules: ["politeness"],
  mutate: (b) => { mutateSlot(b, "stem", (t) => { assert.match(t, /…$/, "그때 나는 앞말은 말줄임표로 끝난다"); return t.replace(/…$/, ""); }, { where: { fmt: "instant" } }); },
});
endingCase("가장·아닌 것 카드가 요로 끝나지 않는다", "bw-card", "다", ["bestworst-ending", "politeness"]);
add({ name: "가장·아닌 것 카드 안에 마침표를 넣는다", rules: ["bestworst-ending"], mutate: (b) => { mutateSlot(b, "bw-card", (t) => t.replace(" ", ".")); } });
add({ name: "가장·아닌 것 카드 끝에 마침표를 붙인다", rules: ["bestworst-ending"], mutate: (b) => { mutateSlot(b, "bw-card", (t) => `${t}.`, { ok: (s) => len(s.get()) < SPEC.text - 1 }); } });

// ---- 문구: 공백과 빈 문구 ----
add({ name: "앞말에 겹공백을 넣는다", rules: ["whitespace"], mutate: (b) => { mutateSlot(b, "stem", (t) => { const c = [...t]; c[c.indexOf(" ") + 1] = " "; return c.join(""); }); } });
add({ name: "앞말이 공백으로 시작한다", rules: ["whitespace"], mutate: (b) => { mutateSlot(b, "stem", (t) => ` ${[...t].slice(1).join("")}`); } });
add({ name: "앞말 가운데에 줄바꿈이 있다", rules: ["whitespace"], mutate: (b) => { mutateSlot(b, "stem", (t) => t.replace(" ", "\n")); } });
add({ name: "앞말 가운데에 탭이 있다", rules: ["whitespace"], mutate: (b) => { mutateSlot(b, "stem", (t) => t.replace(" ", "\t")); } });
add({ name: "캡션이 공백으로 끝난다", rules: ["whitespace"], mutate: (b) => { mutateSlot(b, "caption", () => `${syn("가", 5)} `); } });
add({ name: "캡션이 공백 한 칸뿐이다", rules: ["empty-text"], mutate: (b) => { mutateSlot(b, "caption", () => " "); } });
for (const role of ROLES) {
  add({
    name: `${ROLE_LABEL[role]} 자리가 비어 있다`,
    rules: ["empty-text"],
    allowed: ["empty-text", "pole-length"],
    mutate: (b) => { mutateSlot(b, role, () => ""); },
  });
}

// ---- 문구: 같은 문구, 겹침 ----
add({
  name: "두 카드가 같은 문구다",
  rules: ["same-text"],
  mutate: (b) => { const { item } = targetOf(b, "card"); item.cards[1].text = item.cards[0].text; },
});
add({
  name: "두 카드가 띄어쓰기만 다르게 같은 문구다",
  rules: ["same-text"],
  mutate: (b) => { const { item } = targetOf(b, "card"); item.cards[1].text = item.cards[0].text.replace(" ", cp(0xa0)); },
});
/** 앞극 둘과 뒤극 둘이 있는 형식에서 두 극의 평균 길이를 지킨 채 서로 다른 극의 두 문구를 같게 만든다. */
const sameTextFourWay = (name, role) => add({
  name,
  rules: ["same-text"],
  mutate: (b) => {
    const { item } = targetOf(b, role);
    const s = slotsOf(item).filter((x) => x.role === role);
    const front = s.filter((x) => x.pole === "front");
    const back = s.filter((x) => x.pole === "back");
    assert.equal(front.length, 2);
    assert.equal(back.length, 2);
    const [f1, f2] = front;
    const [b1, b2] = back;
    const t1 = f1.get();
    const t2 = b1.get();
    f2.set(t2);
    b2.set(t1);
  },
});
sameTextFourWay("두 보기가 같은 문구다", "option");
sameTextFourWay("가장·아닌 것 두 카드가 같은 문구다", "bw-card");
add({
  name: "칸 나누기 앞극 항목과 뒤극 항목이 같은 문구다",
  rules: ["same-text"],
  mutate: (b) => { const { item } = targetOf(b, "entry"); item.entries.find((e) => e.pole === "back").text = item.entries.find((e) => e.pole === "front").text; },
});
add({
  name: "react 양끝 이름이 같다",
  rules: ["same-text"],
  mutate: (b) => { const { item } = targetOf(b, "end"); item.ends.right = item.ends.left; },
});
add({
  name: "캡션이 다른 문항과 겹친다",
  rules: ["duplicate-caption"],
  mutate: (b) => { const scored = b.items.filter((it) => it.fmt !== "self"); scored[1].caption = scored[0].caption; },
});
add({
  name: "캡션이 다른 문항과 띄어쓰기만 다르게 겹친다",
  rules: ["duplicate-caption"],
  mutate: (b) => { const scored = b.items.filter((it) => it.fmt !== "self"); scored[1].caption = scored[0].caption.replace(/\s+/g, ""); },
});
add({
  name: "같은 주제의 다른 문항과 앞말이 같다",
  rules: ["duplicate-stem"],
  mutate: (b) => { const [a, c] = itemsWhere(b, { axis: "money", fmt: "pair" }); c.stem = a.stem; },
});
add({
  name: "같은 주제의 다른 문항과 소재가 거의 같다",
  rules: ["duplicate-topic"],
  mutate: (b) => {
    const [a, t] = itemsWhere(b, { axis: "process", fmt: "pair", kind: "method" });
    for (const pole of ["front", "back"]) t.cards.find((c) => c.pole === pole).text = a.cards.find((c) => c.pole === pole).text;
    // 앞말은 살짝 다르게(같은 앞말 규칙과 겹치지 않게), 소재는 그대로
    const c = [...a.stem];
    c[0] = c[0] === "그" ? "이" : "그";
    t.stem = c.join("");
  },
});

// ---- 구조(structure) ----
add({ name: "version 이 다르다", rules: ["version"], mutate: (b) => { b.version = "v4.1-tendency"; } });
add({ name: "최상위에 없는 필드가 있다", rules: ["bank-shape"], mutate: (b) => { b.extra = 1; } });
add({ name: "items 가 배열이 아니다", rules: ["bank-shape"], mutate: (b) => ({ ...b, items: {} }) });
add({ name: "은행이 객체가 아니다(null)", rules: ["bank-shape"], mutate: () => null });
add({ name: "은행이 객체가 아니다(배열)", rules: ["bank-shape"], mutate: () => [] });
add({ name: "문항이 한 개 더 있다", rules: ["item-count"], allowed: ["item-count", "balance-self"], mutate: (b) => { const extra = structuredClone(firstItem(b, { fmt: "self" })); extra.id = "self.extra"; b.items.push(extra); } });
add({ name: "문항이 한 개 모자란다", rules: ["item-count"], allowed: ["item-count", "balance-self"], mutate: (b) => { b.items.pop(); } });
// 겹친 id 는 짝을 id 로 찾는 거울 검사도 헷갈리게 한다(balance-mirror 는 그 부수 효과)
add({ name: "id 가 겹친다", rules: ["id-duplicate", "layout-id"], allowed: ["id-duplicate", "layout-id", "balance-mirror"], mutate: (b) => { b.items[5].id = b.items[4].id; } });
add({ name: "형식에 없는 필드(pos)가 있다", rules: ["unknown-field"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).pos = 1; } });
add({ name: "카드 안에 없는 필드가 있다", rules: ["unknown-field"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).cards[0].extra = 1; } });
add({ name: "pair 카드에 세기(strength)가 있다", rules: ["unknown-field"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).cards[0].strength = "weak"; } });
add({ name: "react 양끝 이름에 없는 필드가 있다", rules: ["unknown-field"], mutate: (b) => { firstItem(b, { fmt: "react" }).ends.middle = "가운데"; } });
add({ name: "react 인용문에 없는 필드가 있다", rules: ["unknown-field"], mutate: (b) => { firstItem(b, { fmt: "react" }).quote.extra = "가"; } });
add({ name: "필수 필드(recap)가 없다", rules: ["missing-field"], allowed: ["missing-field", "field-type"], mutate: (b) => { delete firstItem(b, { fmt: "react" }).recap; } });
add({ name: "필수 필드(caption)가 없다", rules: ["missing-field"], allowed: ["missing-field", "field-type"], mutate: (b) => { delete firstItem(b, { fmt: "pair", kind: "method" }).caption; } });
add({ name: "필수 필드(cards)가 없다", rules: ["missing-field", "shape"], allowed: ["missing-field", "shape", "balance-key-sum", "balance-mirror", "balance-indirect"], mutate: (b) => { delete firstItem(b, { fmt: "pair", kind: "method" }).cards; } });
add({ name: "key 가 문자열이다", rules: ["field-type"], allowed: ["field-type", "layout-key"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).key = "1"; } });
add({ name: "주제 이름이 알 수 없는 값이다", rules: ["field-type"], allowed: ["field-type", "layout-axis", "balance-key-sum", "balance-mirror", "balance-indirect"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).axis = "zzz"; } });
add({ name: "측면이 그 주제의 측면이 아니다", rules: ["field-type"], allowed: ["field-type", "layout-facet"], mutate: (b) => { const it = firstItem(b, { axis: "money", fmt: "pair", kind: "method" }); it.facet = "search"; } });
add({ name: "구간이 정수가 아니다", rules: ["field-type"], allowed: ["field-type", "layout-section"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).section = 0.5; } });
add({ name: "화면 번호가 정수가 아니다", rules: ["field-type"], allowed: ["field-type", "layout-screen"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).screen = "0"; } });
add({ name: "pair 하위 종류가 알 수 없는 값이다", rules: ["field-type"], allowed: ["field-type", "layout-kind", "balance-indirect"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).kind = "zzz"; } });
add({ name: "react highPole 이 알 수 없는 값이다", rules: ["field-type"], allowed: ["field-type", "layout-key", "balance-key-sum", "balance-react-kind", "balance-mirror"], mutate: (b) => { firstItem(b, { fmt: "react" }).highPole = "zzz"; } });
add({ name: "카드가 한 장이다", rules: ["shape"], allowed: ["shape", "balance-key-sum", "balance-mirror"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).cards.pop(); } });
add({ name: "카드 두 장이 같은 극이다", rules: ["shape"], allowed: ["shape", "balance-key-sum", "balance-mirror"], mutate: (b) => { const it = firstItem(b, { fmt: "pair", kind: "method" }); it.cards[1].pole = it.cards[0].pole; } });
// 중립 항목이 뒤극으로 넘어가면 뒤극 평균 길이가 달라져 두 극 길이 균형이 함께 걸릴 수 있다
add({ name: "칸 나누기 세 번째 항목이 중립이 아니다", rules: ["shape"], allowed: ["shape", "balance-key-sum", "balance-mirror", "pole-length"], mutate: (b) => { firstItem(b, { fmt: "split" }).entries[2].pole = "back"; } });
add({ name: "보기가 세 개다", rules: ["shape"], allowed: ["shape", "balance-key-sum", "balance-mirror", "balance-indirect"], mutate: (b) => { firstItem(b, { fmt: "recall" }).options.pop(); } });
add({ name: "가장·아닌 것 카드 극이 두 장씩이 아니다", rules: ["shape"], allowed: ["shape", "balance-key-sum", "balance-mirror", "balance-indirect"], mutate: (b) => { const it = firstItem(b, { fmt: "bestworst" }); it.cards.forEach((c) => { c.pole = "front"; }); } });
add({ name: "react 양끝 이름이 문자열 둘이 아니다", rules: ["shape"], mutate: (b) => { firstItem(b, { fmt: "react" }).ends = "양끝"; } });
add({ name: "배치 골격과 key 만 다르다", rules: ["layout-key", "key-arrangement"], mutate: (b) => { const it = firstItem(b, { fmt: "pair", kind: "method" }); it.key = -it.key; } });
add({ name: "카드 극 배열만 뒤집는다(key 는 그대로)", rules: ["key-arrangement"], allowed: ["key-arrangement", "balance-key-sum", "balance-mirror", "balance-fixed", "balance-class"], mutate: (b) => { flipArrangementOnly(firstItem(b, { fmt: "pair", kind: "method" })); } });
add({ name: "지난 일 보기의 극 배열만 뒤집는다", rules: ["key-arrangement"], allowed: ["key-arrangement", "balance-key-sum", "balance-mirror", "balance-fixed", "balance-class"], mutate: (b) => { flipArrangementOnly(firstItem(b, { fmt: "recall" })); } });
add({ name: "가장·아닌 것 카드의 극 배열만 뒤집는다", rules: ["key-arrangement"], allowed: ["key-arrangement", "balance-key-sum", "balance-mirror", "balance-fixed", "balance-class"], mutate: (b) => { flipArrangementOnly(firstItem(b, { fmt: "bestworst" })); } });
add({ name: "칸 나누기 극 배열만 뒤집는다", rules: ["key-arrangement"], allowed: ["key-arrangement", "balance-key-sum", "balance-mirror", "balance-fixed", "balance-class"], mutate: (b) => { flipArrangementOnly(firstItem(b, { fmt: "split" })); } });
add({ name: "react highPole 만 뒤집는다(key 는 그대로)", rules: ["key-arrangement"], allowed: ["key-arrangement", "balance-key-sum", "balance-react-kind", "balance-mirror", "balance-fixed", "balance-class"], mutate: (b) => { const it = firstItem(b, { fmt: "react" }); it.highPole = it.highPole === "front" ? "back" : "front"; } });
// 극 배열이 어느 키의 배열도 아니면 그 문항은 균형 셈에서 0 으로 친다(키가 +1 인 문항이 빠지니 짝의 -1 만 남아 합이 어긋난다)
add({
  name: "보기의 세기 하나를 바꾼다",
  rules: ["key-arrangement", "balance-key-sum"],
  allowed: ["key-arrangement", "balance-key-sum", "balance-fixed", "balance-class"],
  mutate: (b) => { const it = firstItem(b, { axis: "money", fmt: "recall", key: 1 }); it.options[2].strength = it.options[2].strength === "strong" ? "weak" : "strong"; },
});
add({
  name: "보기의 세기가 알 수 없는 값이다",
  rules: ["shape"],
  allowed: ["shape", "balance-key-sum", "balance-mirror", "balance-indirect"],
  mutate: (b) => { firstItem(b, { fmt: "recall" }).options[1].strength = "mid"; },
});
add({ name: "화면 번호를 바꾼다", rules: ["layout-screen"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).screen = 1; } });
add({ name: "구간을 바꾼다", rules: ["layout-section"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).section = 1; } });
add({ name: "측면을 바꾼다", rules: ["layout-facet"], mutate: (b) => { const it = firstItem(b, { axis: "money", fmt: "pair", kind: "method" }); it.facet = it.facet === "check" ? "limit" : "check"; } });
add({ name: "pair 하위 종류를 바꾼다", rules: ["layout-kind"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).kind = "moment"; } });
add({ name: "형식을 바꾼다", rules: ["layout-fmt"], allowed: ["layout-fmt", "layout-kind", "missing-field", "unknown-field", "field-type", "shape", "balance-key-sum"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).fmt = "react"; } });
add({ name: "주제를 바꾼다", rules: ["layout-axis"], allowed: ["layout-axis", "field-type", "balance-key-sum", "balance-indirect"], mutate: (b) => { const it = firstItem(b, { axis: "money", fmt: "pair", kind: "method" }); it.axis = "process"; } });
// 배치 골격의 순서가 어긋난 채 키 합은 그대로이므로 위치 함수 응답 시험(balance-class)만 그 어긋남을 본다
add({ name: "문항 순서를 바꾼다", rules: ["layout-id", "balance-class"], allowed: ["layout-id", "layout-axis", "layout-facet", "layout-fmt", "layout-kind", "layout-key", "balance-class"], mutate: (b) => { [b.items[2], b.items[3]] = [b.items[3], b.items[2]]; } });
add({ name: "자기 선택 캡션이 다르다", rules: ["self-caption"], mutate: (b) => { firstItem(b, { fmt: "self" }).caption = "스스로 고른 쪽"; } });
add({ name: "placeholder 가 참 거짓이 아니다", rules: ["placeholder-type"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).placeholder = "yes"; } });
add({ name: "최상위 placeholder 와 문항 표시가 어긋난다(문항만 표시)", rules: ["placeholder-flag", "placeholder-present"], mutate: (b) => { firstItem(b, { fmt: "pair", kind: "method" }).placeholder = true; } });
add({ name: "최상위 placeholder 와 문항 표시가 어긋난다(최상위만 표시)", rules: ["placeholder-flag", "placeholder-present"], mutate: (b) => { b.placeholder = true; } });
add({ name: "최상위 placeholder 가 참 거짓이 아니다", rules: ["placeholder-type"], mutate: (b) => { b.placeholder = "yes"; } });

// ---- 균형(balance): 은행과 배치 골격을 함께 고쳐 구조 일치는 유지한 채 균형만 깬다 ----
add({
  name: "한 문항의 키와 극 배열을 뒤집는다(배치 골격도 같이)",
  rules: ["balance-key-sum", "balance-mirror", "balance-fixed", "balance-class"],
  allowed: ["balance-key-sum", "balance-mirror", "balance-fixed", "balance-class", "layout-key-balance", "layout-mirror"],
  mutate: (b, l) => {
    const it = firstItem(b, { axis: "money", fmt: "pair", kind: "method" });
    flipKeyConsistently(it);
    l.find((r) => r.id === it.id).key = it.key;
  },
});
add({
  name: "거울 두 쌍의 키만 함께 뒤집어 형식별 합은 0 으로 두고 거울을 깬다",
  rules: ["balance-mirror", "balance-class"],
  allowed: ["balance-mirror", "balance-class", "layout-mirror"],
  mutate: (b, l) => {
    const a = firstItem(b, { axis: "money", fmt: "pair", section: 0 });
    const c = firstItem(b, { axis: "money", fmt: "pair", section: 1, key: -a.key });
    for (const it of [a, c]) {
      flipKeyConsistently(it);
      l.find((r) => r.id === it.id).key = it.key;
    }
  },
});
// 구간 1 과 3 의 거울: 구간 3 문항의 키만 뒤집으면 오류는 구간 1 의 짝 문항에 붙는다(구간 0 과 2 의 거울과는 따로 본다)
let mirrorPartnerId = null;
add({
  name: "구간 3 문항의 키만 뒤집어 구간 1 과의 거울을 깬다",
  rules: ["balance-mirror"],
  allowed: ["balance-mirror", "balance-key-sum", "balance-fixed", "balance-class", "layout-key-balance", "layout-mirror"],
  mutate: (b, l) => {
    const late = firstItem(b, { axis: "money", fmt: "pair", section: 3 });
    mirrorPartnerId = firstItem(b, { axis: "money", fmt: "pair", section: 1 }).id;
    flipKeyConsistently(late);
    l.find((r) => r.id === late.id).key = late.key;
  },
  expect: (result) => assert.ok(result.errors.some((e) => e.rule === "balance-mirror" && e.itemId === mirrorPartnerId), `구간 1 의 짝 ${mirrorPartnerId} 에 거울 오류가 붙어야 한다.\n${show(result)}`),
});
add({
  name: "구간 2 문항의 키만 뒤집어 구간 0 과의 거울을 깬다",
  rules: ["balance-mirror"],
  allowed: ["balance-mirror", "balance-key-sum", "balance-fixed", "balance-class", "layout-key-balance", "layout-mirror"],
  mutate: (b, l) => {
    const late = firstItem(b, { axis: "money", fmt: "pair", section: 2 });
    mirrorPartnerId = firstItem(b, { axis: "money", fmt: "pair", section: 0 }).id;
    flipKeyConsistently(late);
    l.find((r) => r.id === late.id).key = late.key;
  },
  expect: (result) => assert.ok(result.errors.some((e) => e.rule === "balance-mirror" && e.itemId === mirrorPartnerId), `구간 0 의 짝 ${mirrorPartnerId} 에 거울 오류가 붙어야 한다.\n${show(result)}`),
});
add({
  name: "react 상대 행동과 사연의 종류를 맞바꿔 종류별 키 합을 깬다",
  rules: ["balance-react-kind"],
  allowed: ["balance-react-kind", "layout-kind", "layout-key-balance"],
  mutate: (b, l) => {
    const action = firstItem(b, { axis: "money", fmt: "react", kind: "action" });
    const story = firstItem(b, { axis: "money", fmt: "react", kind: "story", key: -action.key });
    for (const [it, kind] of [[action, "story"], [story, "action"]]) {
      it.kind = kind;
      l.find((r) => r.id === it.id).kind = kind;
    }
  },
});
add({
  name: "자기 선택 키 하나를 뒤집어 2:2 를 깬다",
  rules: ["balance-self"],
  allowed: ["balance-self", "layout-key-balance"],
  mutate: (b, l) => {
    const it = firstItem(b, { fmt: "self" });
    flipKeyConsistently(it);
    l.find((r) => r.id === it.id).key = it.key;
  },
});
// 자기 묘사 상한과 간접 하한은 문항이 정확히 열여섯 개일 때만 겹친다. 열일곱 개, 열다섯 개인 주제에서 따로 본다(allowed "*": 그 밖의 구조 오류는 따지지 않는다).
add({
  name: "주제에 문항이 열일곱 개, 자기 묘사 문항이 일곱 개다(그때 나는이 하나 더)",
  rules: ["balance-indirect"],
  allowed: "*",
  mutate: (b) => {
    const extra = structuredClone(firstItem(b, { axis: "money", fmt: "instant" }));
    extra.id = "money.extra.1";
    extra.caption = syn("가", 5);
    extra.stem = syn("나", 30);
    extra.options.forEach((o, i) => { o.text = syn(FILL[i], 30); });
    b.items.push(extra);
  },
});
add({
  name: "주제에 문항이 열다섯 개, 간접 문항이 아홉 개다(react 하나가 빠졌다)",
  rules: ["balance-indirect"],
  allowed: "*",
  mutate: (b) => { const it = firstItem(b, { axis: "money", fmt: "react" }); b.items.splice(b.items.indexOf(it), 1); },
});
add({
  name: "자기 묘사 문항이 주제에 7개가 되게 종류를 바꾼다",
  rules: ["balance-indirect"],
  allowed: ["balance-indirect", "layout-kind", "layout-indirect"],
  mutate: (b, l) => {
    const it = firstItem(b, { fmt: "pair", kind: "friends" });
    it.kind = "method";
    l.find((r) => r.id === it.id).kind = "method";
  },
});

function runMutation(c) {
  const bank = finalBank();
  const layout = layoutCopy();
  const before = JSON.stringify([bank, layout]);
  const replaced = c.mutate(bank, layout);
  const data = replaced === undefined ? bank : replaced;
  // 변형이 아무것도 바꾸지 못하면(찾는 자리가 없어서 등) 초록불이 "잡았다"로 읽히지 않도록 여기서 멈춘다.
  if (c.name !== undefined) assert.notEqual(JSON.stringify([data, layout]), before, `변형이 아무것도 바꾸지 않았다: ${c.name}`);
  return lintBank(data, { layout });
}

test("변형 시험표가 100개 이상이고 규칙 이름이 실제 규칙이다", () => {
  assert.ok(MUTATIONS.length >= 100, `변형 ${MUTATIONS.length}개`);
  const names = MUTATIONS.map((c) => c.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], "변형 이름이 겹친다");
  for (const c of MUTATIONS) {
    for (const rule of [...c.rules, ...(c.allowed === "*" ? [] : c.allowed ?? [])]) assert.ok(rule in RULES, `${c.name}: 알 수 없는 규칙 ${rule}`);
    if (c.allowed && c.allowed !== "*") for (const rule of c.rules) assert.ok(c.allowed.includes(rule), `${c.name}: allowed 에 ${rule} 이 없다`);
  }
});

test("심기 전의 최종 은행 복사본은 깨끗하다(변형이 낸 오류만 남게 하는 기준선)", () => {
  const result = runMutation({ mutate: () => {} });
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings, []);
});

for (const c of MUTATIONS) {
  test(`변형: ${c.name}`, () => {
    const result = runMutation(c);
    const got = rulesOf(result);
    for (const rule of c.rules) assert.ok(got.has(rule), `${rule} 을 기대했다.\n실제 오류:\n${show(result) || "(없음)"}`);
    if (c.allowed !== "*") {
      const allowed = new Set(c.allowed ?? c.rules);
      const stray = [...got].filter((r) => !allowed.has(r));
      assert.deepEqual(stray, [], `기대하지 않은 오류가 함께 나왔다.\n${show(result)}`);
    }
    assert.ok(result.errors.length > 0);
    // 어떤 변형도 통과한 것으로 세지 않는다
    assert.match(formatReport(result), /실패/);
    if (c.expect) c.expect(result);
  });
}

// ---- 자리마다 한 번씩: 모든 문구 자리가 검사에 들어가는가(첫 자리와 마지막 자리) ----
const sweepCases = [];
for (const role of ROLES) {
  for (const n of new Set([0, SLOT_COUNT[role] - 1])) {
    const where = n === 0 ? "첫" : "마지막";
    for (const [what, token, rule] of [["줄표", EM_DASH, "dash"], ["숫자", "6", "digit"], ["금지어", "검증 ", "banned-word"]]) {
      sweepCases.push({
        name: `자리 시험: ${ROLE_LABEL[role]} ${where} 자리의 ${what}`,
        rules: [rule],
        mutate: (b) => { mutateSlot(b, role, (t) => plant(t, token), { n }); },
      });
    }
  }
}
for (const c of sweepCases) {
  test(c.name, () => {
    const result = runMutation(c);
    assert.deepEqual([...rulesOf(result)].sort(), [...c.rules].sort(), show(result));
  });
}

test("문구 변형은 문구 오류만 낸다(구조와 균형은 깨끗하다)", () => {
  for (const c of [...MUTATIONS.filter((m) => m.rules.every((r) => RULES[r].category === "content")), ...sweepCases]) {
    const result = runMutation(c);
    assert.ok(result.errors.every((e) => e.category === "content"), `${c.name}: ${show(result)}`);
    assert.equal(result.stats.balanceRan, true);
  }
});

// ---- 통과해야 하는 글(오탐 방지): 이름과 가까워 보여도 규칙이 아닌 글 ----
const plantNeg = (token) => (t) => plant(t, token);
const NEGATIVES = [
  { name: "글자 이름과 뒤가 이어지는 낱말(Scenery)은 통과한다", role: "card", edit: plantNeg("Scenery ") },
  { name: "글자 이름과 뒤가 이어지는 낱말(Withdraw)은 통과한다", role: "card", edit: plantNeg("Withdraw ") },
  { name: "글자 이름과 앞이 이어지는 낱말(ReVerify)은 통과한다", role: "card", edit: plantNeg("ReVerify ") },
  { name: "「인답게」는 「~인 답」이 아니다", role: "card", edit: plantNeg("인답게 ") },
  { name: "「사원」은 금액이 아니다", role: "card", edit: plantNeg("사원 ") },
  { name: "「천천히」는 금액이 아니다", role: "card", edit: plantNeg("천천히 ") },
  { name: "「만 원하는」의 「원」은 금액이 아니다", role: "card", edit: plantNeg("만 원하는 ") },
  { name: "「양가」만으로는 묻지 않는 주제가 아니다", role: "card", edit: plantNeg("양가 ") },
  { name: "「계획」은 가치 판단어가 아니다", role: "card", edit: plantNeg("계획을 ") },
  { name: "카드는 짝이 맞는 「 」를 쓸 수 있다", role: "card", edit: plantNeg("「그」 ") },
  { name: "「죠」로 끝나는 문장은 해요체다", role: "card", ok: endSafe, edit: (t) => withEnding(t, "죠") },
  { name: "말줄임표로 끝나는 해요체 문장은 통과한다", role: "card", ok: (s) => /요\.$/.test(s.get()), edit: (t) => t.replace(/\.$/, "…") },
  { name: "물음표로 끝나는 해요체 문장은 통과한다", role: "card", ok: (s) => /요\.$/.test(s.get()), edit: (t) => t.replace(/\.$/, "?") },
  { name: "느낌표로 끝나는 해요체 문장은 통과한다", role: "card", ok: (s) => /요\.$/.test(s.get()), edit: (t) => t.replace(/\.$/, "!") },
  { name: "인용으로 끝나는 앞말은 통과한다", role: "stem", edit: () => "둘이 마주 앉아 「그」" },
  { name: "대문자가 아닌 홀로 선 영문(a)은 통과한다", role: "card", edit: plantNeg("a ") },
];
for (const c of NEGATIVES) {
  test(`통과해야 하는 글: ${c.name}`, () => {
    const bank = finalBank();
    const { slot } = targetOf(bank, c.role, { ok: c.ok ?? (() => true) });
    const before = slot.get();
    slot.set(c.edit(before));
    assert.notEqual(slot.get(), before, "변형이 아무것도 바꾸지 않았다");
    const result = lintBank(bank);
    assert.deepEqual(result.errors, [], show(result));
    assert.deepEqual(result.warnings, []);
  });
}

test("다른 주제의 문항끼리는 소재가 같아도 통과한다(소재 겹침은 같은 주제 안에서만 본다)", () => {
  const bank = finalBank();
  const a = firstItem(bank, { axis: "money", fmt: "pair", kind: "method" });
  const c = firstItem(bank, { axis: "support", fmt: "pair", kind: "method" });
  for (const pole of ["front", "back"]) c.cards.find((x) => x.pole === pole).text = a.cards.find((x) => x.pole === pole).text;
  const chars = [...a.stem];
  chars[0] = chars[0] === "그" ? "이" : "그";
  c.stem = chars.join("");
  const result = lintBank(bank);
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings, []);
});

test("다른 주제의 문항끼리는 앞말이 같아도 통과한다(앞말 겹침은 같은 주제 안에서만 본다)", () => {
  const bank = finalBank();
  const a = firstItem(bank, { axis: "money", fmt: "pair", kind: "method" });
  const c = firstItem(bank, { axis: "support", fmt: "pair", kind: "method" });
  assert.notEqual(a.stem, c.stem);
  c.stem = a.stem;
  const result = lintBank(bank);
  assert.deepEqual(result.errors, [], show(result));
});

test("자기 선택 문항의 캡션은 서로 같아도 통과한다(캡션 겹침에서 빠진다)", () => {
  const bank = finalBank();
  const selfs = itemsWhere(bank, { fmt: "self" });
  assert.equal(new Set(selfs.map((s) => s.caption)).size, 1);
  const result = lintBank(bank);
  assert.deepEqual(result.errors, [], show(result));
});

// ---------------------------------------------------------------------------
// 2b. 글자 수 경계: 한도는 통과하고 한도 + 1 은 그 규칙 하나만 잡는다
// ---------------------------------------------------------------------------

/** 한 문항의 모든 선택 문구를 길이 n 의 합성 문구(서로 다른 채움 글자)로 바꾼다. 두 극 길이는 같아 길이 균형은 유지된다. */
const setAllChoices = (role, where) => (b, n) => {
  const item = firstItem(b, where);
  slotsOf(item).filter((s) => s.role === role).forEach((s, i) => s.set(syn(FILL[i], n)));
};
const BOUNDARIES = [
  { name: "캡션", rule: "length-caption", limit: SPEC.caption, set: (b, n) => { firstItem(b, ROLE_ITEMS.caption).caption = syn("가", n); } },
  { name: "앞말", rule: "length-stem", limit: SPEC.stem, set: (b, n) => { firstItem(b, ROLE_ITEMS.stem).stem = syn("가", n); } },
  {
    name: "react 앞말과 인용문의 합",
    rule: "length-stem",
    limit: SPEC.stem,
    set: (b, n) => { const it = firstItem(b, { fmt: "react", kind: "action" }); it.stem = syn("가", 30); it.quote.text = "나".repeat(n - 30); },
  },
  { name: "두 가지 중 고르기 카드", rule: "length-text", limit: SPEC.text, set: setAllChoices("card", { fmt: "pair", kind: "method" }) },
  { name: "순간 카드", rule: "length-text", limit: SPEC.text, set: setAllChoices("card-moment", { fmt: "pair", kind: "moment" }) },
  { name: "자기 선택 카드", rule: "length-text", limit: SPEC.text, set: setAllChoices("card", { fmt: "self" }) },
  { name: "가장·아닌 것 카드", rule: "length-text", limit: SPEC.text, set: setAllChoices("bw-card", { fmt: "bestworst" }) },
  { name: "지난 일 보기", rule: "length-text", limit: SPEC.text, set: setAllChoices("option", { fmt: "recall" }) },
  { name: "그때 나는 보기", rule: "length-text", limit: SPEC.text, set: setAllChoices("option", { fmt: "instant" }) },
  { name: "칸 나누기 항목", rule: "length-text", limit: SPEC.text, set: setAllChoices("entry", { fmt: "split" }) },
  { name: "react 앞 구절", rule: "length-recap", limit: SPEC.recap, set: (b, n) => { firstItem(b, { fmt: "react" }).recap = syn("가", n); } },
  { name: "react 양끝 이름", rule: "length-ends", limit: SPEC.end, set: (b, n) => { const it = firstItem(b, { fmt: "react" }); it.ends.left = syn("가", n); it.ends.right = syn("나", n); } },
];
for (const c of BOUNDARIES) {
  test(`글자 수 경계: ${c.name} ${c.limit}자는 통과한다`, () => {
    const bank = finalBank();
    c.set(bank, c.limit);
    const result = lintBank(bank);
    assert.deepEqual(result.errors, [], show(result));
    assert.deepEqual(result.warnings, []);
  });
  test(`글자 수 경계: ${c.name} ${c.limit + 1}자는 ${c.rule} 하나만 잡힌다`, () => {
    const bank = finalBank();
    c.set(bank, c.limit + 1);
    const result = lintBank(bank);
    assert.deepEqual([...rulesOf(result)], [c.rule], show(result));
  });
}

test("react 앞말이 혼자 한도를 넘어도 앞말 오류는 합계 검사 한 건뿐이다", () => {
  const bank = finalBank();
  const item = firstItem(bank, { fmt: "react", kind: "action" });
  item.stem = syn("가", SPEC.stem + 1);
  item.quote.text = "나";
  const result = lintBank(bank);
  assert.deepEqual([...rulesOf(result)], ["length-stem"], show(result));
  assert.equal(result.errors.filter((e) => e.rule === "length-stem").length, 1, show(result));
});

test("글자 수는 UTF-16 코드 단위가 아니라 글자 단위로 센다", () => {
  const bank = finalBank();
  const item = firstItem(bank, ROLE_ITEMS.caption);
  item.caption = syn("가", SPEC.caption - 1) + cp(0x1f600); // 열두 글자(UTF-16 으로는 열세 칸)
  const ok = lintBank(bank);
  assert.deepEqual(ok.errors, [], show(ok));
  item.caption = syn("가", SPEC.caption) + cp(0x1f600); // 열세 글자
  assert.deepEqual([...rulesOf(lintBank(bank))], ["length-caption"]);
});

test("글자 수 경계: 두 극의 평균 길이 차이 15퍼센트는 통과하고 그보다 크면 잡힌다", () => {
  const build = (backLen) => {
    const bank = finalBank();
    const item = firstItem(bank, { fmt: "pair", kind: "method" });
    item.cards.find((c) => c.pole === "front").text = syn("가", 60);
    item.cards.find((c) => c.pole === "back").text = syn("나", backLen);
    return lintBank(bank);
  };
  const edge = build(51); // 60 대 51, 차이 정확히 15퍼센트
  assert.deepEqual(edge.errors, [], show(edge));
  const over = build(50); // 60 대 50, 15퍼센트 초과
  assert.deepEqual([...rulesOf(over)], ["pole-length"], show(over));
  // 평균으로 잰다: 보기 넷(앞극 둘, 뒤극 둘)의 평균 길이가 15.13퍼센트 벌어지면 잡히고 정확히 15퍼센트이면 통과한다
  const options = (front, back) => {
    const bank = finalBank();
    const item = firstItem(bank, { fmt: "recall" });
    const slots = slotsOf(item);
    slots.filter((s) => s.pole === "front").forEach((s, i) => s.set(syn(FILL[i], front[i])));
    slots.filter((s) => s.pole === "back").forEach((s, i) => s.set(syn(FILL[i + 2], back[i])));
    return lintBank(bank);
  };
  const flat = options([60, 60], [51, 51]); // 평균 60 대 51, 정확히 15퍼센트
  assert.deepEqual(flat.errors, [], show(flat));
  const slightly = options([60, 59], [51, 50]); // 평균 59.5 대 50.5, 15.13퍼센트
  assert.deepEqual([...rulesOf(slightly)], ["pole-length"], show(slightly));
  // 앞극이 짧은 쪽이어도 같다(어느 극이 긴지는 상관없다)
  const swapped = finalBank();
  const item = firstItem(swapped, { fmt: "pair", kind: "method" });
  item.cards.find((c) => c.pole === "front").text = syn("가", 50);
  item.cards.find((c) => c.pole === "back").text = syn("나", 60);
  assert.deepEqual([...rulesOf(lintBank(swapped))], ["pole-length"]);
});

// ---- 두 극 길이 균형: 자리마다 한 극을 절반으로 줄여 벌린다 ----
const SHRINK_TARGETS = [
  ["두 가지 중 고르기 방식 카드", { fmt: "pair", kind: "method" }],
  ["두 가지 중 고르기 순간 카드", { fmt: "pair", kind: "moment" }],
  ["두 가지 중 고르기 친구 이야기 카드", { fmt: "pair", kind: "friends" }],
  ["자기 선택 카드", { fmt: "self" }],
  ["지난 일 보기", { fmt: "recall" }],
  ["그때 나는 보기", { fmt: "instant" }],
  ["가장·아닌 것 카드", { fmt: "bestworst" }],
  ["칸 나누기 항목", { fmt: "split" }],
];
for (const [label, where] of SHRINK_TARGETS) {
  for (const pole of ["front", "back"]) {
    test(`두 극 길이 균형: ${label}의 ${pole === "front" ? "앞" : "뒤"}극을 절반으로 줄이면 pole-length 하나만 잡힌다`, () => {
      const bank = finalBank();
      const item = firstItem(bank, where);
      shrinkPole(item, pole);
      const result = lintBank(bank);
      assert.deepEqual([...rulesOf(result)], ["pole-length"], show(result));
    });
  }
}

test("react 는 두 극 길이 균형을 보지 않는다(양끝 이름 길이가 달라도 통과)", () => {
  const bank = finalBank();
  const item = firstItem(bank, { fmt: "react" });
  item.ends.left = syn("가", 4);
  item.ends.right = syn("나", 20);
  const result = lintBank(bank);
  assert.deepEqual(result.errors, [], show(result));
});

// ---------------------------------------------------------------------------
// 2c. 경고 수준 규칙: 실패로 세지 않고 경고로 남는다
// ---------------------------------------------------------------------------

const WARNING_CASES = [
  ["question-form", (b) => { mutateSlot(b, "question", (t) => { const body = t.replace(/[?\s]+$/u, ""); return body.endsWith("요") ? `${body.slice(0, -1)}다` : body; }); }],
  ["length-question", (b) => { mutateSlot(b, "question", () => syn("가", SPEC.question + 1)); }],
  ["speaker-length", (b) => { mutateSlot(b, "speaker", () => "가".repeat(SPEC.speaker + 1)); }],
  // 옛 꼴: 대가 절(~도) 뒤의 마지막 절이 「~할 것 같아요」 같은 대가나 느낌이다
  ["react-end-acceptance", (b) => { mutateSlot(b, "end", () => "가가가도 나나나나 것 같아요"); }],
  // R1: 앞극 대가 절이 뒤극 머리 절의 낱말(장면)을 되풀이한다. 규칙 시험 전체는 wedding-code-v40-bank-lint-cost.test.mjs 에 있다.
  ["cost-repeats-head", (b) => {
    const item = firstItem(b, { id: "money.limit.1" });
    item.cards.find((c) => c.pole === "front").text = "쓸 수 있는 돈부터 적고 그 밑에 하고 싶은 걸 적어요. 장면이 금세 딱딱해져요.";
    item.cards.find((c) => c.pole === "back").text = "마음에 남은 장면부터 나란히 놓고 얘기해요. 이야기가 길어져 저녁이 훌쩍 가요.";
  }],
  // R1: 칸 나누기 값 0 항목이 미루기 낱말을 쓴다
  ["split-third-decoy", (b) => { firstItem(b, { id: "money.moment.1" }).entries[2].text = "잠시 미뤄 두고 다른 일부터 하기"; }],
];

test("경고 수준 규칙: 물음 형태, 물음 길이, 화자 길이, 양끝 이름 마지막 절, 대가 절 되풀이, 셋째 항목 미끼는 실패로 세지 않고 경고로 남는다", () => {
  for (const [rule, mutate] of WARNING_CASES) {
    const bank = finalBank();
    const before = JSON.stringify(bank);
    mutate(bank);
    assert.notEqual(JSON.stringify(bank), before, `변형이 아무것도 바꾸지 않았다: ${rule}`);
    const result = lintBank(bank);
    assert.deepEqual(result.errors, [], `${rule}: ${show(result)}`);
    assert.deepEqual(result.warnings.map((w) => w.rule), [rule], `${rule}: ${show(result)}`);
    assert.match(formatReport(result), /통과/);
    // 플래그와 무관하다
    assert.deepEqual(lintBank(bank, { allowPlaceholder: true }).warnings.map((w) => w.rule), [rule]);
  }
});

test("경고 수준 규칙 경계: 물음 40자와 화자 8자는 경고가 없다", () => {
  const bank = finalBank();
  mutateSlot(bank, "question", () => syn("가", SPEC.question));
  mutateSlot(bank, "speaker", () => "가".repeat(SPEC.speaker));
  const result = lintBank(bank);
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings, []);
});

// ---- 2c-2. react 양끝 이름의 마지막 절 (R0, 2026-09-30) ----
//
// 다섯 칸의 양끝은 「대가 절 + 그 끝의 방식」 꼴이어야 한다(예: 허전해도 나눠서 보고 싶어요). 옛 꼴은 마지막 절이 대가나 느낌이라
// (함께 가면 든든해도 지칠 것 같아요) 응답자가 그 절을 자기 마음으로 읽었고, 시뮬레이션 응답자 열여덟 명 중 열 명이 한 칸 이상 반대 칸을 눌렀다.
// 아래 옛 문구는 그때 은행에 있던 react 열여섯 문항의 양끝 이름 서른두 개 전부이고, 규칙은 이 문구들에서 정했다.
// 규칙이 보는 꼴은 「대가 절이 있고 마지막 절이 ~고 싶어요가 아닌 끝」이다. 대가 절이 없는 끝(비교하는 「더 남을 것 같아요」 꼴 등)은 보지 않는다.

/** 옛 꼴의 양끝 이름 중 대가 절(~도, ~지만, ~는데)이 있는 것 스물여섯 개. 모두 잡혀야 한다. */
const OLD_ENDS_WITH_CONCESSION = [
  "나눠 가면 더 봐도 허전할 것 같아요", "함께 가면 든든해도 지칠 것 같아요",
  "설렘은 이어져도 불안할 것 같아요", "든든해도 분위기가 딱딱할 것 같아요",
  "도우면 후련해도 말을 끊을 것 같아요", "듣는 게 편해도 답답할 것 같아요",
  "둘이 정하고 싶어도 죄송할 것 같아요", "편해도 우리 계획이 밀릴 것 같아요",
  "든든해도 내 일이 밀릴 것 같아요", "몰입은 돼도 막히면 혼자일 것 같아요",
  "홀가분해도 침묵이 남을 것 같아요",
  "원인 알면 후련해도 어색할 것 같아요", "마음 풀면 편해도 또 다툴 것 같아요",
  "알면 든든해도 조바심 날 것 같아요", "맡기면 홀가분해도 깜깜할 것 같아요",
  "알아보면 든든해도 김이 샐 것 같아요", "바로 하면 설레도 찜찜할 것 같아요",
  "마음부터 알아주면 풀려도 일은 남아요", "숨은 트여도 속마음은 쌓여요",
  "가족 먼저면 편해도 친구는 아쉬워요", "북적여 신나도 가족은 서운할 듯해요",
  "홀가분해도 낯선 말이 걸릴 것 같아요", "같이 골라 뿌듯해도 길어질 것 같아요",
  "편해도 답이 오래 걸릴 것 같아요",
  "얘기하면 풀려도 일은 남아요", "일부터 하면 편해도 얘기는 미뤄져요",
];
/** 옛 꼴의 양끝 이름 중 대가 절이 없는 것 여섯 개(비교하는 「더 남을 것 같아요」 꼴 넷, 대가 절 없이 느낌만 적은 둘). 이 규칙이 보지 않는다. */
const OLD_ENDS_WITHOUT_CONCESSION = [
  "식당부터 정하면 홀가분할 것 같아요", "어른들 침묵이 마음에 걸릴 것 같아요",
  "그날의 기쁨이 더 남을 것 같아요", "빠듯했던 몇 달이 더 남을 것 같아요",
  "편했던 생활이 더 남을 것 같아요", "앨범의 아쉬움이 더 남을 것 같아요",
];

/** 첫 react 상대 행동 문항의 한쪽 끝 이름을 text 로 바꾸고 검사한다. */
function checkEnd(text, side = "left") {
  const bank = finalBank();
  const item = firstItem(bank, { fmt: "react", kind: "action" });
  item.ends[side] = text;
  const result = lintBank(bank);
  return { item, result, hits: result.warnings.filter((w) => w.rule === "react-end-acceptance") };
}

test("react 양끝 이름 마지막 절: 옛 꼴 중 대가 절이 있는 스물여섯 개는 왼쪽 자리에서도 오른쪽 자리에서도 경고 하나씩을 낸다", () => {
  assert.equal(OLD_ENDS_WITH_CONCESSION.length, 26);
  assert.equal(OLD_ENDS_WITH_CONCESSION.length + OLD_ENDS_WITHOUT_CONCESSION.length, 32);
  for (const side of ["left", "right"]) {
    for (const text of OLD_ENDS_WITH_CONCESSION) {
      assert.ok(len(text) <= SPEC.end, `옛 문구가 ${SPEC.end}자를 넘는다: ${text}`);
      const { item, result, hits } = checkEnd(text, side);
      assert.equal(hits.length, 1, `${side}: ${text}\n${show(result) || "(경고 없음)"}`);
      assert.equal(hits[0].itemId, item.id);
      assert.ok(hits[0].message.startsWith(`ends.${side}: `), hits[0].message);
      // 경고는 실패로 세지 않고 다른 규칙과 겹치지 않는다
      assert.deepEqual(result.errors, [], `${side}: ${text}\n${show(result)}`);
      assert.deepEqual(result.warnings.filter((w) => w.rule !== "react-end-acceptance"), []);
      assert.match(formatReport(result), /통과/);
    }
  }
});

test("react 양끝 이름 마지막 절: 경고 문구는 잘못된 마지막 절을 그대로 보여 준다", () => {
  const { hits } = checkEnd("든든해도 내 일이 밀릴 것 같아요");
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /「내 일이 밀릴 것 같아요」/);
  assert.match(hits[0].message, /고 싶어요/);
  // 접속이 둘이면 마지막 접속 뒤의 글을 보여 준다(조사 「도」가 앞에 있어도 속지 않는다)
  const twice = checkEnd("가가가도 나나도 다다 걸릴 것 같아요").hits;
  assert.equal(twice.length, 1);
  assert.match(twice[0].message, /「다다 걸릴 것 같아요」/);
  assert.doesNotMatch(twice[0].message, /나나도/);
});

test("react 양끝 이름 마지막 절: 대가 절이 없는 끝(비교하는 더 남을 것 같아요 꼴 등)은 보지 않는다", () => {
  for (const side of ["left", "right"]) {
    for (const text of OLD_ENDS_WITHOUT_CONCESSION) {
      const { result, hits } = checkEnd(text, side);
      assert.deepEqual(hits, [], `${side}: ${text}\n${show(result)}`);
      assert.deepEqual(result.errors, [], `${side}: ${text}\n${show(result)}`);
      assert.deepEqual(result.warnings, [], `${side}: ${text}\n${show(result)}`);
    }
  }
});

test("react 양끝 이름 마지막 절: 대가 절을 잇는 말(~도, ~지만, ~는데, ~은데, ~인데) 뒤가 대가나 느낌이면 잡는다", () => {
  const bad = [
    "가가가도 나나 편해요", "가가가지만 나나나 남아요", "가가가는데 나나나 쌓여요", "가가가은데 나나 아쉬워요", "가가가인데 나나 편해요",
    "가가가도 나나도 다다 걸릴 것 같아요", // 접속이 둘
  ];
  for (const side of ["left", "right"]) {
    for (const text of bad) {
      const { result, hits } = checkEnd(text, side);
      assert.equal(hits.length, 1, `${side}: ${text}\n${show(result) || "(경고 없음)"}`);
      assert.deepEqual(result.errors, [], `${side}: ${text}\n${show(result)}`);
    }
  }
});

test("react 양끝 이름 마지막 절: 마지막 절이 ~고 싶어요이면 어느 접속 뒤에서도 통과한다", () => {
  const good = [
    "가가가도 나나 다다하고 싶어요", "가가가지만 나나나하고 싶어요", "가가가는데 나나나 다다하고 싶어요",
    "가가가은데 나나하고 싶어요", "가가가인데 나나하고 싶어요",
    "가가도 나나도 다다하고 싶어요", // 조사 「도」가 앞에 있어도 마지막 접속 뒤가 방식이다
    "가가 나나 다다하고 싶어요", // 대가 절이 없어도 통과한다
    "가가하고 싶어도 나나 다다하고 싶어요", // 앞 절의 ~고 싶어요는 마지막 절이 아니다
  ];
  for (const side of ["left", "right"]) {
    for (const text of good) {
      const { result, hits } = checkEnd(text, side);
      assert.deepEqual(hits, [], `${side}: ${text}\n${show(result)}`);
      assert.deepEqual(result.errors, [], `${side}: ${text}\n${show(result)}`);
      assert.deepEqual(result.warnings, [], `${side}: ${text}\n${show(result)}`);
    }
  }
});

test("react 양끝 이름 마지막 절: 앞 절에만 ~고 싶어요가 있고 마지막 절이 대가이면 잡는다", () => {
  const { hits } = checkEnd("가가하고 싶어도 나나 것 같아요");
  assert.equal(hits.length, 1);
});

test("react 양끝 이름 마지막 절: 요로 끝나지 않는 끝은 해요체 오류만 내고 이 경고는 겹치지 않는다", () => {
  for (const side of ["left", "right"]) {
    const { result, hits } = checkEnd("가가가도 나나 것 같아다", side);
    assert.deepEqual(hits, [], show(result));
    assert.deepEqual([...rulesOf(result)], ["politeness"], show(result));
  }
});

test("react 양끝 이름 마지막 절: 검사기가 내보낸 맺음이 이 시험의 값과 같다", () => {
  assert.equal(lintModule.REACT_END_ACCEPTANCE_TAIL, "고 싶어요");
  assert.equal(RULES["react-end-acceptance"].severity, "warning");
  assert.equal(RULES["react-end-acceptance"].category, "content");
});

test("react 양끝 이름 마지막 절: 실제 은행의 react 양끝 이름은 대가 절이 있으면 모두 ~고 싶어요로 끝난다(검사기와 무관한 확인)", () => {
  const ends = realData().items.filter((it) => it.fmt === "react").flatMap((it) => [it.ends.left, it.ends.right]);
  assert.equal(ends.length, 32);
  const withConcession = ends.filter((t) => /도 /.test(t));
  assert.ok(withConcession.length >= 28, `대가 절이 있는 끝 ${withConcession.length}개`);
  for (const t of withConcession) assert.match(t, /고 싶어요$/, t);
});

test("경고 수준 규칙: 구조 오류가 있으면 정적 균형 시험을 건너뛰고 balance-skipped 경고를 남긴다", () => {
  const bank = finalBank();
  firstItem(bank, { fmt: "pair", kind: "method" }).cards.pop();
  const result = lintBank(bank);
  assert.equal(result.stats.balanceRan, false);
  assert.ok(rulesOf(result).has("shape"), show(result));
  assert.ok(result.warnings.some((w) => w.rule === "balance-skipped"), show(result));
  assert.ok(!rulesOf(result).has("balance-skipped"), "건너뜀은 실패로 세지 않는다");
  assert.match(formatReport(result), /정적 균형 시험 0건\(건너뜀\)/);
  assert.doesNotMatch(formatReport(lintBank(finalBank())), /건너뜀/);
  // 구조가 멀쩡하면 건너뛰지 않는다
  assert.equal(lintBank(finalBank()).stats.balanceRan, true);
});

// ---------------------------------------------------------------------------
// 2d. 깨진 입력: 던지지 않고 오류로 알린다
// ---------------------------------------------------------------------------

test("깨진 입력은 예외 없이, 원인에 맞는 규칙으로 알린다", () => {
  const withItem = (fn) => { const b = finalBank(); fn(b); return b; };
  const pair = (b) => firstItem(b, { fmt: "pair", kind: "method" });
  const V = ref.VERSION;
  const broken = [
    ["null", null, "bank-shape"],
    ["undefined", undefined, "bank-shape"],
    ["숫자", 0, "bank-shape"],
    ["문자열", "은행", "bank-shape"],
    ["배열", [], "bank-shape"],
    ["빈 객체", {}, "bank-shape"],
    ["items 없음", { version: V }, "bank-shape"],
    ["items 가 null", { version: V, items: null }, "bank-shape"],
    ["items 가 빔", { version: V, items: [] }, "item-count"],
    ["문항이 null", withItem((b) => { b.items[3] = null; }), "field-type"],
    ["문항이 숫자", withItem((b) => { b.items[3] = 7; }), "field-type"],
    ["문항이 문자열", withItem((b) => { b.items[3] = "문항"; }), "field-type"],
    ["문항이 배열", withItem((b) => { b.items[3] = []; }), "field-type"],
    ["문항이 빈 객체", withItem((b) => { b.items[3] = {}; }), "field-type"],
    ["모든 문항이 빈 객체", withItem((b) => { b.items = b.items.map(() => ({})); }), "field-type"],
    ["fmt 가 알 수 없는 값", withItem((b) => { pair(b).fmt = "zzz"; }), "field-type"],
    ["fmt 가 숫자", withItem((b) => { pair(b).fmt = 3; }), "field-type"],
    ["cards 가 null", withItem((b) => { pair(b).cards = null; }), "shape"],
    ["cards 가 문자열", withItem((b) => { pair(b).cards = "카드"; }), "shape"],
    ["cards 항목이 null 과 숫자", withItem((b) => { pair(b).cards = [null, 5]; }), "shape"],
    ["cards 항목이 빈 객체", withItem((b) => { pair(b).cards = [{}, {}]; }), "field-type"],
    ["react quote 가 null", withItem((b) => { firstItem(b, { fmt: "react" }).quote = null; }), "shape"],
    ["react ends 가 null", withItem((b) => { firstItem(b, { fmt: "react" }).ends = null; }), "shape"],
    ["보기가 숫자", withItem((b) => { firstItem(b, { fmt: "recall" }).options = [1, 2, 3, 4]; }), "shape"],
    ["칸 나누기 항목에 글이 없다", withItem((b) => { firstItem(b, { fmt: "split" }).entries = [{ pole: "front" }, { pole: "back" }, { pole: "neutral" }]; }), "field-type"],
    ["가장·아닌 것 카드 글이 숫자", withItem((b) => { firstItem(b, { fmt: "bestworst" }).cards[0].text = 5; }), "field-type"],
  ];
  for (const [label, data, rule] of broken) {
    let result;
    assert.doesNotThrow(() => { result = lintBank(data); }, `깨진 입력(${label}): 예외가 났다`);
    assert.ok(rulesOf(result).has(rule), `깨진 입력(${label}): ${rule} 을 기대했다.\n${show(result) || "(없음)"}`);
    assert.doesNotThrow(() => formatReport(result), `깨진 입력(${label}): 보고서를 못 만들었다`);
    assert.match(formatReport(result), /실패/);
  }
});

// ---------------------------------------------------------------------------
// 3. 배치 골격 변형(배치 골격 자체의 성질)
// ---------------------------------------------------------------------------

const moneyPairRow = (l, kind = "method", n = 0) => rowWhere(l, { axis: "money", fmt: "pair", kind }, n);
const LAYOUT_MUTATIONS = [
  ["layout-count", (l) => { l.pop(); }],
  ["layout-duplicate-id", (l) => { l[1].id = l[0].id; }],
  ["layout-axis-count", (l) => { moneyPairRow(l).axis = "process"; }],
  ["layout-format-count", (l) => { moneyPairRow(l, "friends").fmt = "react"; }],
  ["layout-facet-count", (l) => { rowWhere(l, { axis: "money", facet: "check" }).facet = "limit"; }],
  ["layout-latin", (l) => { rowWhere(l, { axis: "money", facet: "check" }).facet = "worth"; }],
  ["layout-key-balance", (l) => { const r = moneyPairRow(l); r.key = -r.key; }],
  ["layout-section-count", (l) => { rowWhere(l, { axis: "money", fmt: "pair", section: 0 }).section = 1; }],
  ["layout-section-format", (l) => { rowWhere(l, { axis: "money", fmt: "react" }).fmt = "pair"; }],
  ["layout-screens", (l) => { moneyPairRow(l).pos = 3; }],
  ["layout-order", (l) => { moneyPairRow(l).screen = 5; }],
  ["layout-adjacent-axis", (l) => { const a = l.indexOf(moneyPairRow(l)); const b = l.indexOf(rowWhere(l, { axis: "process", fmt: "pair", kind: "method" })); [l[a], l[b]] = [l[b], l[a]]; }],
  ["layout-heavy-topic", (l) => { l[0].facet = "final"; }],
  ["layout-mirror", (l) => {
    const a = moneyPairRow(l);
    const partner = l.find((x) => x.section === a.section + 2 && x.axis === a.axis && x.screen === a.screen + 20 && x.pos === a.pos);
    assert.ok(partner, "거울 짝이 없다");
    partner.key = a.key;
  }],
  ["layout-indirect", (l) => { rowWhere(l, { fmt: "pair", kind: "friends" }).kind = "method"; }],
  ["layout-kind", (l) => { rowWhere(l, { fmt: "pair", kind: "moment" }).kind = "method"; }],
];

test("배치 골격을 하나씩 깨면 검사가 그 성질을 오류로 낸다", () => {
  assert.deepEqual(ref.verifyLayout(ref.loadLayout()), []);
  for (const [rule, mutate] of LAYOUT_MUTATIONS) {
    const layout = layoutCopy();
    const before = JSON.stringify(layout);
    mutate(layout);
    assert.notEqual(JSON.stringify(layout), before, `변형이 아무것도 바꾸지 않았다: ${rule}`);
    const result = lintBank(finalBank(), { layout });
    assert.ok(rulesOf(result).has(rule), `${rule} 을 기대했다.\n${show(result)}`);
    // 은행이 골격과 어긋나서가 아니라 골격 자체의 성질 검증이 그 오류를 낸다
    assert.ok(ref.verifyLayout(layout).some((p) => p.rule === rule), `${rule}: 골격 검증(verifyLayout)이 이 성질을 잡지 못한다`);
    assert.ok(result.errors.some((e) => e.rule === rule && e.message.startsWith("[배치 골격]")), `${rule}: 검사기가 골격 오류를 [배치 골격] 으로 알리지 않는다`);
  }
});

// ---------------------------------------------------------------------------
// 4. 규칙 시험 범위
// ---------------------------------------------------------------------------

test("모든 규칙(오류와 경고)은 변형, 경계, 정책 시험 중 하나로 시험된다", () => {
  const covered = new Set();
  for (const c of MUTATIONS) c.rules.forEach((r) => covered.add(r));
  for (const c of sweepCases) c.rules.forEach((r) => covered.add(r));
  for (const c of BOUNDARIES) covered.add(c.rule);
  for (const [rule] of LAYOUT_MUTATIONS) covered.add(rule);
  for (const [rule] of WARNING_CASES) covered.add(rule);
  covered.add("pole-length"); // 위 경계 시험과 줄이기 시험
  covered.add("placeholder-present"); // 아래 정책 시험
  covered.add("balance-skipped"); // 위 경고 시험
  const uncovered = Object.keys(RULES).filter((rule) => !covered.has(rule));
  assert.deepEqual(uncovered, [], `시험 없는 규칙: ${uncovered.join(", ")}`);
  const WARNING_RULES = ["question-form", "length-question", "speaker-length", "balance-skipped", "react-end-acceptance", "cost-repeats-head", "split-third-decoy"];
  for (const rule of WARNING_RULES) assert.equal(RULES[rule].severity, "warning");
  for (const rule of Object.keys(RULES)) if (!WARNING_RULES.includes(rule)) assert.equal(RULES[rule].severity, "error", rule);
  // 범주가 셋뿐이다
  assert.deepEqual([...new Set(Object.values(RULES).map((r) => r.category))].sort(), ["balance", "content", "structure"]);
});

test("검사기가 내보낸 목록과 한도가 이 시험이 따로 든 목록을 모두 품는다(빠진 낱말, 풀린 한도가 없다)", () => {
  for (const word of BANNED) assert.ok(lintModule.BANNED_WORDS.includes(word), word);
  for (const word of JUDGEMENT) assert.ok(lintModule.VALUE_JUDGEMENT_WORDS.includes(word), word);
  for (const word of TOPICS.filter((w) => !w.includes(" "))) assert.ok(lintModule.FORBIDDEN_TOPICS.includes(word), word);
  assert.deepEqual(lintModule.LETTER_NAMES, LETTER_NAMES);
  assert.deepEqual(lintModule.ENGLISH_NAMES, ENGLISH_NAMES);
  assert.deepEqual(lintModule.AXIS_TITLES, AXIS_NAMES);
  assert.equal(lintModule.LIMITS.caption, SPEC.caption);
  assert.equal(lintModule.LIMITS.stem, SPEC.stem);
  assert.equal(lintModule.LIMITS.text, SPEC.text);
  assert.equal(lintModule.LIMITS.recap, SPEC.recap);
  assert.equal(lintModule.LIMITS.end, SPEC.end);
  assert.equal(lintModule.LIMITS.question, SPEC.question);
  assert.equal(lintModule.LIMITS.speaker, SPEC.speaker);
  assert.equal(lintModule.LIMITS.poleLengthPercent, SPEC.poleLengthPercent);
  assert.equal(lintModule.LIMITS.duplicateTopicSimilarity, SPEC.topicSimilarity);
});

// ---------------------------------------------------------------------------
// 5. placeholder 정책
// ---------------------------------------------------------------------------

test("placeholder: 문구 규칙은 경고로 내려가고 구조와 균형 규칙은 그대로 오류다", () => {
  // 문구 위반(줄표)이 placeholder 문항에 있으면 플래그가 있을 때 경고
  const content = placeholderBank();
  const target = mutateSlot(content, "card", (t) => plant(t, EM_DASH));
  const soft = lintBank(content, { allowPlaceholder: true });
  assert.deepEqual(soft.errors, [], show(soft));
  assert.ok(soft.warnings.some((w) => w.rule === "dash" && w.itemId === target.id));
  assert.ok(soft.warnings.some((w) => w.rule === "placeholder-present"));
  const hard = lintBank(content, { allowPlaceholder: false });
  assert.deepEqual([...rulesOf(hard)].sort(), ["dash", "placeholder-present"]);
  // 구조 위반(극 배열)은 플래그가 있어도 오류
  const structure = placeholderBank();
  const s = firstItem(structure, { fmt: "pair", kind: "method" });
  s.cards = [s.cards[1], s.cards[0]];
  const kept = lintBank(structure, { allowPlaceholder: true });
  assert.ok(rulesOf(kept).has("key-arrangement"));
  assert.ok(rulesOf(kept).has("balance-fixed"));
  // 균형 위반(배치 골격과 함께 고친 키 뒤집기)도 오류
  const balance = placeholderBank();
  const flipped = firstItem(balance, { axis: "money", fmt: "pair", kind: "method" });
  flipKeyConsistently(flipped);
  const layout = layoutCopy();
  layout.find((r) => r.id === flipped.id).key = flipped.key;
  const bal = lintBank(balance, { allowPlaceholder: true, layout });
  assert.ok(rulesOf(bal).has("balance-key-sum"));
  assert.ok(rulesOf(bal).has("balance-fixed"));
});

test("placeholder: 표시가 없는 문항의 문구 위반은 플래그가 있어도 오류다", () => {
  const data = placeholderBank();
  const { item } = targetOf(data, "card");
  delete item.placeholder; // 이 문항은 최종 문구, 나머지는 자리표시
  mutateSlot(data, "card", (t) => plant(t, EM_DASH));
  const result = lintBank(data, { allowPlaceholder: true });
  assert.ok(result.errors.some((e) => e.rule === "dash" && e.itemId === item.id), show(result));
  // 같은 위반이 표시가 남은 다른 문항에 있으면 경고
  const other = placeholderBank();
  mutateSlot(other, "card", (t) => plant(t, EM_DASH));
  assert.deepEqual(lintBank(other, { allowPlaceholder: true }).errors, []);
  // placeholder: false 라고 적은 문항은 표시가 없는 것과 같다(문구 위반이 경고로 내려가지 않는다)
  const explicit = placeholderBank();
  const { item: explicitItem } = targetOf(explicit, "card");
  explicitItem.placeholder = false;
  mutateSlot(explicit, "card", (t) => plant(t, EM_DASH));
  const explicitResult = lintBank(explicit, { allowPlaceholder: true });
  assert.ok(explicitResult.errors.some((e) => e.rule === "dash" && e.itemId === explicitItem.id), show(explicitResult));
  assert.equal(explicitResult.stats.placeholderItems, 67);
});

test("placeholder: 구조와 균형 위반은 표시가 남은 문항에서도 문구 경고로 내려가지 않는다", () => {
  const data = placeholderBank();
  const { item } = targetOf(data, "card");
  item.cards.forEach((c) => { c.pole = "front"; });
  const result = lintBank(data, { allowPlaceholder: true });
  assert.ok(result.errors.some((e) => e.rule === "shape" && e.itemId === item.id), show(result));
});

test("placeholder: 최종 은행에 표시가 하나라도 남으면 오류(플래그 없이)", () => {
  const data = finalBank();
  data.placeholder = true;
  firstItem(data, { fmt: "pair", kind: "method" }).placeholder = true;
  const result = lintBank(data);
  assert.deepEqual(result.errors.map((e) => e.rule), ["placeholder-present"]);
  // 플래그가 있으면 경고
  const soft = lintBank(data, { allowPlaceholder: true });
  assert.deepEqual(soft.errors, []);
  assert.deepEqual(soft.warnings.map((w) => w.rule), ["placeholder-present"]);
});

// ---------------------------------------------------------------------------
// 6. 상수가 constants/weddingCodeV40.ts 와 같다
// ---------------------------------------------------------------------------

test("검사기의 글자 이름, 주제 이름, 영어 이름, 자기 선택 문구가 상수 파일과 같다", () => {
  const names = [...CONSTANTS_TS.matchAll(/letter:\s*"[A-Z]",\s*axis:\s*"\w+",\s*side:\s*"\w+",\s*name:\s*"([^"]+)",\s*english:\s*"([^"]+)"/g)];
  assert.equal(names.length, 8);
  assert.deepEqual(names.map((m) => m[1]), lintModule.LETTER_NAMES);
  assert.deepEqual(names.map((m) => m[2]), lintModule.ENGLISH_NAMES);
  const titles = [...CONSTANTS_TS.matchAll(/key:\s*"\w+",\s*order:\s*\d,\s*title:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titles, lintModule.AXIS_TITLES);
  // 마지막 정리(자기 선택) 블록 안의 제목과 공통 물음
  const wrapUp = CONSTANTS_TS.match(/V40_WRAP_UP\s*=\s*\{([\s\S]*?)\r?\n\}/)[1];
  assert.equal(wrapUp.match(/title:\s*"([^"]+)"/)[1], lintModule.WRAP_UP_TITLE);
  // 자기 선택 앞말은 공통 물음으로 끝난다(주제에 따라 앞에 짧은 절이 붙을 수 있다)
  const prompt = wrapUp.match(/prompt:\s*"([^"]+)"/)[1];
  const selfItems = ref.makeBank(realData()).self;
  assert.equal(selfItems.length, 4);
  for (const item of selfItems) assert.ok(item.stem.endsWith(prompt), `${item.id}: 앞말이 공통 물음으로 끝나지 않는다: ${item.stem}`);
});

// ---------------------------------------------------------------------------
// 7. 명령줄
// ---------------------------------------------------------------------------

const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd: ROOT });

test("검사 명령: 실제 은행 파일은 placeholder 표시에 맞는 종료 코드를 낸다", () => {
  const data = realData();
  const withFlag = run(LINT_CLI, ["--allow-placeholder"]);
  assert.equal(withFlag.status, 0, withFlag.stdout + withFlag.stderr);
  assert.match(withFlag.stdout, /통과/);
  const without = run(LINT_CLI, []);
  if (hasPlaceholder(data)) {
    assert.equal(without.status, 1, without.stdout + without.stderr);
    assert.match(without.stdout, /placeholder-present/);
  } else {
    assert.equal(without.status, 0, without.stdout + without.stderr);
    assert.match(without.stdout, /통과/);
    assert.doesNotMatch(without.stdout, /placeholder-present/);
  }
  const json = run(LINT_CLI, ["--allow-placeholder", "--json"]);
  const parsed = JSON.parse(json.stdout);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.stats.items, 68);
});

test("검사 명령: 자리표시 은행은 플래그 없이 1, 플래그가 있으면 0 이고 최종 은행은 둘 다 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "wc40-lint-ph-"));
  try {
    const placeholder = join(dir, "placeholder.json");
    writeFileSync(placeholder, JSON.stringify(placeholderBank()), "utf8");
    const final = join(dir, "final.json");
    writeFileSync(final, JSON.stringify(finalBank()), "utf8");
    const no = run(LINT_CLI, ["--file", placeholder]);
    assert.equal(no.status, 1, no.stdout + no.stderr);
    assert.match(no.stdout, /placeholder-present/);
    const yes = run(LINT_CLI, ["--allow-placeholder", "--file", placeholder]);
    assert.equal(yes.status, 0, yes.stdout + yes.stderr);
    assert.match(yes.stdout, /통과/);
    assert.match(yes.stdout, /경고/);
    for (const args of [["--file", final], ["--allow-placeholder", "--file", final]]) {
      const r = run(LINT_CLI, args);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /통과/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("검사 명령: 파일을 지정하고, 구조 위반은 플래그가 있어도 1 로 끝나며, 잘못된 사용은 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "wc40-lint-"));
  try {
    const bank = placeholderBank();
    const s = firstItem(bank, { fmt: "pair", kind: "method" });
    s.cards = [s.cards[1], s.cards[0]];
    const broken = join(dir, "broken.json");
    writeFileSync(broken, JSON.stringify(bank), "utf8");
    const r = run(LINT_CLI, ["--allow-placeholder", "--file", broken]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /key-arrangement/);
    // 문구 위반이 든 최종 은행은 플래그가 있어도 1
    const wording = finalBank();
    mutateSlot(wording, "card", (t) => plant(t, EM_DASH));
    const wordingPath = join(dir, "wording.json");
    writeFileSync(wordingPath, JSON.stringify(wording), "utf8");
    const w = run(LINT_CLI, ["--allow-placeholder", "--file", wordingPath]);
    assert.equal(w.status, 1);
    assert.match(w.stdout, /dash/);
    const clean = join(dir, "clean.json");
    writeFileSync(clean, JSON.stringify(finalBank()), "utf8");
    assert.equal(run(LINT_CLI, ["--file", clean]).status, 0);
    assert.equal(run(LINT_CLI, ["--file", join(dir, "missing.json")]).status, 2);
    writeFileSync(join(dir, "bad.json"), "{ not json", "utf8");
    assert.equal(run(LINT_CLI, ["--file", join(dir, "bad.json")]).status, 2);
    assert.equal(run(LINT_CLI, ["--nope"]).status, 2);
    assert.equal(run(LINT_CLI, ["--file"]).status, 2);
    // 자세히 보기는 오류를 전부 적는다
    const verbose = run(LINT_CLI, ["--verbose", "--file", broken]);
    assert.equal(verbose.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. 생성기
// ---------------------------------------------------------------------------

/** 생성 파일 본문을 실행해 내보낸 값을 꺼낸다(import 는 지우고 버전 상수만 넣는다). */
function evalBankModule(text) {
  const body = text
    .replace(/^import .*$/gm, "")
    .replace(/export const (\w+)(?:: [\w<>[\]]+)? =/g, "exports.$1 =");
  const exports = {};
  new Function("exports", "WEDDING_CODE_V40_VERSION", body)(exports, ref.VERSION);
  return exports;
}

const withoutPlaceholder = (data) => data.items.map(({ placeholder, ...rest }) => { void placeholder; return rest; });

for (const [label, make] of [["실제 은행", realData], ["최종 은행 복사본", finalBank], ["자리표시 은행 복사본", placeholderBank]]) {
  test(`생성 결과(${label})는 원본에서 새로 만든 값이고 성질이 맞는다`, () => {
    const data = make();
    const expected = generateBankModule(data);
    assert.equal(generateBankModule(make()), expected, "결정적이다");
    assert.match(expected, /do not edit/);
    assert.match(expected, new RegExp(`V40_BANK_IS_PLACEHOLDER: boolean = ${data.placeholder === true}\\b`));
    assert.doesNotMatch(expected, /placeholder:/);
    assert.match(expected, /version: WEDDING_CODE_V40_VERSION/);
    assert.doesNotMatch(expected, /\\u[0-9a-f]{4}/, "한국어를 이스케이프하지 않는다");
    assert.doesNotMatch(expected, /\r/);
    const sha = expected.match(/V40_BANK_SOURCE_SHA256 = "([0-9a-f]{64})"/);
    assert.ok(sha);
    const independent = createHash("sha256")
      .update(JSON.stringify({ version: data.version, placeholder: data.placeholder === true, items: withoutPlaceholder(data) }))
      .digest("hex");
    assert.equal(sha[1], independent, "해시는 버전, 자리표시 여부, placeholder 를 뺀 문항으로 만든다");
    // 실행해서 원본과 같은 값이 나오는지 본다(문구, 극 배열, 순서)
    const out = evalBankModule(expected);
    assert.equal(out.V40_BANK_IS_PLACEHOLDER, data.placeholder === true);
    assert.equal(out.V40_BANK_SOURCE_SHA256, independent);
    assert.deepEqual(out.V40_BANK_DATA, { version: ref.VERSION, items: withoutPlaceholder(data) });
    assert.ok(out.V40_BANK_DATA.items.every((it) => !("placeholder" in it)));
  });
}

test("생성기는 따옴표, 역슬래시, 줄바꿈, 줄 구분자가 든 글도 그대로 옮긴다(검사를 거치지 않는 순수 함수)", () => {
  const tricky = `그는 "안녕"이라고 했다\\n\n\t' \` \${x} ${cp(0x2028)}${cp(0x1f600)}`;
  const data = finalBank();
  data.items[0].caption = tricky;
  data.items[1].stem = `${tricky}${tricky}`;
  const out = evalBankModule(generateBankModule(data));
  assert.equal(out.V40_BANK_DATA.items[0].caption, tricky);
  assert.equal(out.V40_BANK_DATA.items[1].stem, `${tricky}${tricky}`);
  assert.deepEqual(out.V40_BANK_DATA, { version: ref.VERSION, items: withoutPlaceholder(data) });
});

test("생성 결과의 해시는 문구 하나, 극 하나, 자리표시 여부가 바뀌면 달라진다", () => {
  const shaOf = (data) => generateBankModule(data).match(/V40_BANK_SOURCE_SHA256 = "([0-9a-f]{64})"/)[1];
  const base = shaOf(finalBank());
  const worded = finalBank();
  mutateSlot(worded, "card", (t) => plant(t, "가"));
  assert.notEqual(shaOf(worded), base);
  const flipped = finalBank();
  flipArrangementOnly(firstItem(flipped, { fmt: "recall" }));
  assert.notEqual(shaOf(flipped), base);
  const flagged = finalBank();
  flagged.placeholder = true;
  assert.notEqual(shaOf(flagged), base);
  // placeholder 문항 표시만 다르면 해시는 같다(문항 표시는 해시에서 빠진다)
  const itemFlag = finalBank();
  firstItem(itemFlag, { fmt: "pair", kind: "method" }).placeholder = true;
  assert.equal(shaOf(itemFlag), base);
});

test("생성 파일(weddingCodeV40Bank.ts)이 원본에서 새로 만든 것과 글자 하나 다르지 않다(드리프트 시험)", () => {
  const fresh = generateBankModule(realData());
  const stored = readFileSync(GENERATED_PATH, "utf8");
  assert.equal(stored, fresh, "생성 파일이 원본과 다르다. node scripts/build-wedding-code-v40-bank.mjs 로 다시 만든다");
  assert.equal(run(BUILD_CLI, ["--check"]).status, 0);
});

/**
 * 도구 복사 트리: 생성기가 파일을 쓰는 시험은 저장소가 아니라 이 복사본에서 돌린다.
 * 생성기의 기본 출력 경로는 저장소의 실제 생성 파일이라, --out 을 무시하는 고장이 나면 시험이 그 파일을 덮어쓴다
 * (prove-guard 로 그 변형을 심었을 때 실제로 그랬다). 복사본의 기본 출력 경로는 이 임시 트리 안이라 실제 파일이 안전하고,
 * 시험이 끝난 뒤 그곳에 아무것도 없는지 보면 --out 무시도 잡는다.
 */
function makeToolTree() {
  const root = mkdtempSync(join(tmpdir(), "wc40-tree-"));
  for (const rel of [
    "scripts/build-wedding-code-v40-bank.mjs",
    "scripts/wedding-code-v40-bank-lint.mjs",
    "scripts/lib/wedding-code-v40-bank-lint.mjs",
    "scripts/lib/wedding-code-v40-ref.mjs",
    "scripts/lib/wedding-code-v40-layout.json",
  ]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(root, rel));
  }
  mkdirSync(join(root, "docs", "wedding-code"), { recursive: true });
  copyFileSync(BANK_PATH, join(root, "docs", "wedding-code", "2026-09-29_v40_items.json"));
  mkdirSync(join(root, "apps", "web", "src", "constants"), { recursive: true });
  return {
    root,
    build: join(root, "scripts", "build-wedding-code-v40-bank.mjs"),
    defaultOut: join(root, "apps", "web", "src", "constants", "weddingCodeV40Bank.ts"),
  };
}

test("생성기 명령: 검사를 못 통과한 원본은 쓰지 않고, --final 은 자리표시 은행을 막고, --check 는 어긋남을 잡는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "wc40-build-"));
  const tree = makeToolTree();
  const BUILD = tree.build;
  try {
    const out = join(dir, "bank.ts");
    const save = (name, data) => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify(data), "utf8");
      return path;
    };
    // 구조 위반 원본
    const broken = placeholderBank();
    const s = firstItem(broken, { fmt: "pair", kind: "method" });
    s.cards = [s.cards[1], s.cards[0]];
    const r1 = run(BUILD, ["--source", save("broken.json", broken), "--out", out]);
    assert.equal(r1.status, 1);
    assert.equal(existsSync(out), false, "오류가 있으면 아무것도 쓰지 않는다");
    // 문구 위반 원본(최종 은행)
    const wording = finalBank();
    mutateSlot(wording, "card", (t) => plant(t, EM_DASH));
    const r1b = run(BUILD, ["--source", save("wording.json", wording), "--out", out]);
    assert.equal(r1b.status, 1);
    assert.equal(existsSync(out), false);
    // 자리표시 은행: --final 은 막고, 그냥은 만든다
    const placeholderPath = save("placeholder.json", placeholderBank());
    const r2 = run(BUILD, ["--final", "--source", placeholderPath, "--out", out]);
    assert.equal(r2.status, 1);
    assert.equal(existsSync(out), false);
    const r2b = run(BUILD, ["--source", placeholderPath, "--out", out]);
    assert.equal(r2b.status, 0, r2b.stdout + r2b.stderr);
    assert.match(readFileSync(out, "utf8"), /V40_BANK_IS_PLACEHOLDER: boolean = true/);
    rmSync(out);
    // 최종 은행은 만든다
    const finalPath = save("final.json", finalBank());
    const r3 = run(BUILD, ["--final", "--source", finalPath, "--out", out]);
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    const text = readFileSync(out, "utf8");
    assert.match(text, /V40_BANK_IS_PLACEHOLDER: boolean = false/);
    const withoutSourceLine = (t) => t.replace(/^ \* 원본: .*$/m, "");
    assert.equal(withoutSourceLine(text), withoutSourceLine(generateBankModule(finalBank())), "명령이 쓴 파일은 메모리에서 새로 만든 것과 같다(원본 경로 줄만 빼고)");
    assert.equal(run(BUILD, ["--check", "--final", "--source", finalPath, "--out", out]).status, 0);
    // 내용이 바뀌면 --check 가 잡는다(은행의 첫 캡션을 다른 글로 바꾼다)
    const caption = finalBank().items[0].caption;
    assert.ok(text.includes(JSON.stringify(caption)), "생성 파일에 첫 캡션이 그대로 들어 있어야 한다");
    writeFileSync(out, text.replace(JSON.stringify(caption), JSON.stringify(`${caption}요`)), "utf8");
    assert.equal(run(BUILD, ["--check", "--final", "--source", finalPath, "--out", out]).status, 1);
    // 파일이 없어도 --check 는 1
    assert.equal(run(BUILD, ["--check", "--source", finalPath, "--out", join(dir, "none.ts")]).status, 1);
    // 실제 원본에 --final 을 주면 placeholder 표시에 맞게 끝난다
    const real = run(BUILD, ["--final", "--source", BANK_PATH, "--out", join(dir, "real.ts")]);
    assert.equal(real.status, hasPlaceholder(realData()) ? 1 : 0, real.stdout + real.stderr);
    assert.equal(existsSync(join(dir, "real.ts")), !hasPlaceholder(realData()));
    // 잘못된 사용은 2
    assert.equal(run(BUILD, ["--nope"]).status, 2);
    assert.equal(run(BUILD, ["--source", join(dir, "missing.json"), "--out", out]).status, 2);
    // 모든 호출이 --out 을 줬으니 복사 트리의 기본 출력 경로에는 아무것도 쓰이지 않는다(--out 을 무시하는 고장을 잡는다)
    assert.equal(existsSync(tree.defaultOut), false, "--out 을 준 호출이 기본 출력 경로에 썼다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(tree.root, { recursive: true, force: true });
  }
});

test("생성기 명령: 기본 출력 경로와 기본 원본은 복사 트리 안을 가리키고, 원본이 자리표시이면 기본 그대로 만든다", () => {
  const tree = makeToolTree();
  try {
    // 기본 원본(복사 트리의 은행)을 자리표시 은행으로 바꿔 두고 인자 없이 돌리면 기본 출력 경로에 쓴다
    const bankCopy = join(tree.root, "docs", "wedding-code", "2026-09-29_v40_items.json");
    writeFileSync(bankCopy, JSON.stringify(placeholderBank()), "utf8");
    const made = run(tree.build, []);
    assert.equal(made.status, 0, made.stdout + made.stderr);
    const text = readFileSync(tree.defaultOut, "utf8");
    assert.match(text, /V40_BANK_IS_PLACEHOLDER: boolean = true/);
    assert.match(text, /원본: docs\/wedding-code\/2026-09-29_v40_items\.json/);
    assert.equal(text, generateBankModule(placeholderBank()));
    assert.equal(run(tree.build, ["--check"]).status, 0);
    // 최종 은행으로 바꾸면 --check 가 어긋남을 잡고, --final 로 다시 만들면 다시 맞는다
    writeFileSync(bankCopy, JSON.stringify(finalBank()), "utf8");
    assert.equal(run(tree.build, ["--check"]).status, 1);
    assert.equal(run(tree.build, ["--final"]).status, 0);
    assert.equal(readFileSync(tree.defaultOut, "utf8"), generateBankModule(finalBank()));
    assert.equal(run(tree.build, ["--check", "--final"]).status, 0);
  } finally {
    rmSync(tree.root, { recursive: true, force: true });
  }
});
