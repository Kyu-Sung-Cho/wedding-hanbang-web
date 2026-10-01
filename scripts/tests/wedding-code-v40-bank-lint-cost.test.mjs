// 웨딩코드 4.0 문항 은행 검사기: 대가 절 되풀이(cost-repeats-head)와 칸 나누기 셋째 항목 미끼(split-third-decoy) 시험 (R1, 2026-09-30).
//
// 은행 검사기 시험(wedding-code-v40-bank-lint.test.mjs)은 한 번 돌리는 데 20초가 걸려서, 두 규칙의 시험은 이 파일에 따로 둔다
// (그래야 「가드는 깨뜨려 봐야 센다」 증명이 변형 하나에 몇 초 만에 돈다). 규칙이 경고인지, 모든 규칙에 시험이 있는지는 그 파일이 본다.
//
// 지키는 것
//   1. 대가 절이 반대 극 머리 절의 낱말(두 글자 뿌리)을 되풀이하면 그 카드 하나에 경고 하나. 자기 머리 절에도 있는 낱말, 흔한 낱말,
//      한 글자 낱말, 대가 절이 없는 글은 세지 않는다. 카드 2개, 가장·아닌 것 4개, 보기 4개, 자기 선택을 모두 본다.
//   2. 칸 나누기의 값 0 항목이 쉬기나 미루기 낱말을 쓰면 경고 하나. 앞극과 뒤극 항목은 보지 않는다.
//   3. R1 이 다시 쓴 열세 문항과 단계 1(2026-09-30)에서 원문으로 되돌린 두 문항(q10 q11)은 두 규칙에 걸리지 않고, 다시 쓰지 않은 문항 중 걸리는 것은 검사기의 예외 목록과 정확히 같다.
//   4. R1 문항의 내용 기준(명세 6절)을 실제 은행에서 검사기와 따로 확인한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as lintModule from "../lib/wedding-code-v40-bank-lint.mjs";
import * as ref from "../lib/wedding-code-v40-ref.mjs";

const { RULES, lintBank, formatReport } = lintModule;
const BANK_PATH = ref.DEFAULT_BANK_PATH;

const realData = () => JSON.parse(readFileSync(BANK_PATH, "utf8"));
/** placeholder 표시를 모두 지운 복사본(최종 은행과 같은 모양). */
function finalBank() {
  const data = realData();
  delete data.placeholder;
  delete data.note;
  for (const item of data.items) delete item.placeholder;
  return data;
}
const show = (result) => [...result.errors, ...result.warnings].map((e) => `${e.rule}@${e.itemId ?? "-"}: ${e.message}`).join("\n");
const matches = (obj, where) => Object.entries(where).every(([k, v]) => (typeof v === "function" ? v(obj[k], obj) : obj[k] === v));
const itemsWhere = (bank, where) => bank.items.filter((it) => matches(it, where));
function firstItem(bank, where, n = 0) {
  const list = itemsWhere(bank, where);
  assert.ok(list.length > n, `은행에서 ${JSON.stringify(where)} 의 ${n + 1}번째 문항을 찾지 못했다`);
  return list[n];
}

// ---- 2c-3. 대가 절이 반대 극 머리 절을 되풀이함, 칸 나누기 셋째 항목의 쉬기·미루기 (R1, 2026-09-30) ----
//
// 보기는 「손이 하는 일(머리 절) + 대가 절」 꼴이다. 한 극의 대가 절이 반대 극의 머리 절 낱말을 되풀이하면 그 대가가 반대 극의 이득을 다시 말하는
// 두 번째 극 단서가 되어 어느 답이 더 좋아 보이는지가 티 난다(옛 은행: 「그리던 장면 하나는 접어야 해요」가 반대 카드의 「그리고」를 되풀이했다).
// 칸 나누기의 셋째 항목(값 0)이 쉬기나 미루기이면 아무도 고르지 않는 미끼라 여섯 칸이 두 극에만 몰린다.
// 두 규칙은 경고다. R1 이 다시 쓴 열세 문항과 원문으로 되돌린 두 문항은 두 규칙에 걸리지 않고, 다시 쓰지 않은 문항 중 걸리는 것은 검사기의 「아직 안 고친 문항」 목록에 있다.

/**
 * R1 이 다시 쓰고 단계 1 이후에도 재작성이 남은 열세 문항(명세 4.2 b: q02 q14 q31 q43 q51 q53 q54 q58 q63 q65 q66 q67 q68).
 * 명세의 열다섯 가운데 q10(scope.timing.1)과 q11(process.report.1)은 RESTORED_ITEM_IDS 로 옮겼다.
 */
const R1_ITEM_IDS = [
  "money.limit.1", "money.moment.1", "process.search.2", "process.search.3", "money.limit.4",
  "money.worth.4", "process.owner.4", "money.moment.4", "process.report.4", "self.money", "self.process", "self.scope", "self.support",
];
/**
 * 단계 1(2026-09-30)에서 재작성을 버리고 원문으로 되돌린 문항. 짝비교 평정에서 재작성이 원문보다 나빴다:
 * q10 은 채널(찾아가기, 문자 한 통)과 평가어가 다시 바람직성을 만들어 뒤극이 더 좋아 보였고(격차 -1.75에서 -2.50),
 * q11 은 앞 카드 대가는 가볍고 뒤 카드 대가는 무거워 「가장 나 같아요」 몰림이 33에서 42로 늘었다.
 */
const RESTORED_ITEM_IDS = ["scope.timing.1", "process.report.1"];
const byId = (bank, id) => {
  const item = bank.items.find((x) => x.id === id);
  assert.ok(item, `은행에 ${id} 가 없다`);
  return item;
};
const hitsOf = (result, rule) => result.warnings.filter((w) => w.rule === rule);
/** 문항의 목록(cards, options)에서 극이 pole 인 첫 항목. */
const listOfItem = (item) => item.cards ?? item.options ?? item.entries;
const poleIndex = (item, pole, n = 0) => listOfItem(item).map((e, i) => [e, i]).filter(([e]) => e.pole === pole)[n][1];

/** 두 카드 문항(돈 주제 첫 카드 문항)의 앞극 카드와 뒤극 카드를 바꾼다. */
function setPairTexts(bank, front, back) {
  const item = byId(bank, "money.limit.1");
  item.cards[poleIndex(item, "front")].text = front;
  item.cards[poleIndex(item, "back")].text = back;
  return item;
}
const PAIR_FRONT_HEAD = "쓸 수 있는 돈부터 적고 그 밑에 하고 싶은 걸 적어요.";
const PAIR_BACK_HEAD = "마음에 남은 장면부터 나란히 놓고 얘기해요.";
const PAIR_FRONT_COST = "이야기가 금세 딱딱해져요.";
const PAIR_BACK_COST = "이야기가 길어져 저녁이 훌쩍 가요.";
/** 두 카드의 머리 절과 대가 절을 지정해 검사한다. 지정한 자리만 바꾼 복사본의 검사 결과를 돌려준다. */
function checkPair({ frontHead = PAIR_FRONT_HEAD, frontCost = PAIR_FRONT_COST, backHead = PAIR_BACK_HEAD, backCost = PAIR_BACK_COST, noLegacy = false } = {}) {
  const bank = finalBank();
  const item = setPairTexts(bank, `${frontHead} ${frontCost}`.trim(), `${backHead} ${backCost}`.trim());
  return { item, result: lintBank(bank, { noLegacy }) };
}

test("대가 절 되풀이: 대가 절이 반대 극 머리 절 낱말을 되풀이하지 않는 두 카드는 경고가 없다", () => {
  const { result } = checkPair();
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings, [], show(result));
});

test("대가 절 되풀이: 앞극 대가 절이 뒤극 머리 절의 낱말을 되풀이하면 그 카드 하나에 경고를 낸다", () => {
  const { item, result } = checkPair({ frontCost: "장면이 금세 딱딱해져요." });
  const hits = hitsOf(result, "cost-repeats-head");
  assert.equal(hits.length, 1, show(result));
  assert.equal(hits[0].itemId, item.id);
  assert.ok(hits[0].message.startsWith(`cards[${poleIndex(item, "front")}]: `), hits[0].message);
  assert.match(hits[0].message, /「장면」/);
  // 경고는 실패로 세지 않고, 다른 규칙과 겹치지 않는다
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings.filter((w) => w.rule !== "cost-repeats-head"), []);
  assert.match(formatReport(result), /통과/);
});

test("대가 절 되풀이: 뒤극 대가 절이 앞극 머리 절의 낱말을 되풀이해도 잡는다(양방향)", () => {
  const { item, result } = checkPair({ backCost: "적어 둔 이야기가 길어져 저녁이 훌쩍 가요." });
  const hits = hitsOf(result, "cost-repeats-head");
  assert.equal(hits.length, 1, show(result));
  assert.ok(hits[0].message.startsWith(`cards[${poleIndex(item, "back")}]: `), hits[0].message);
  assert.match(hits[0].message, /「적어」/);
  assert.deepEqual(result.errors, [], show(result));
});

test("대가 절 되풀이: 두 낱말을 되풀이하면 두 낱말을 모두 적는다", () => {
  const { result } = checkPair({ frontCost: "장면과 얘기가 금세 딱딱해져요." });
  const hits = hitsOf(result, "cost-repeats-head");
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /「장면」/);
  assert.match(hits[0].message, /「얘기」/);
});

test("대가 절 되풀이: 그 카드 자기 머리 절에도 있는 낱말은 되풀이가 아니다", () => {
  // 앞극 머리 절에도 「장면」이 있으면 대가 절의 「장면」은 반대 극에서 가져온 말이 아니다
  const { result } = checkPair({ frontHead: "장면을 떠올리며 쓸 수 있는 돈부터 적어요.", frontCost: "장면이 금세 딱딱해져요." });
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings, [], show(result));
});

test("대가 절 되풀이: 두 극의 머리 절끼리, 대가 절끼리 겹치는 낱말은 되풀이가 아니다", () => {
  // 대가 절 둘이 같은 낱말(이야기)을 쓰고 머리 절 둘도 같은 낱말(나란히)을 쓴다
  const { result } = checkPair({
    frontHead: "쓸 수 있는 돈을 나란히 적어요.",
    backHead: "마음에 남은 장면을 나란히 놓아요.",
    frontCost: "이야기가 금세 딱딱해져요.",
    backCost: "이야기가 길어져 저녁이 훌쩍 가요.",
  });
  assert.deepEqual(result.warnings, [], show(result));
});

test("대가 절 되풀이: 어느 극에나 들어가는 흔한 낱말(마음, 우리, 다시 ...)은 세지 않는다", () => {
  const generic = lintModule.COST_ECHO_GENERIC_STEMS;
  for (const stem of ["마음", "우리", "다시", "조금", "그날", "하나", "서로", "상대", "먼저", "자꾸"]) assert.ok(generic.includes(stem), `흔한 낱말 목록에 ${stem} 가 없다`);
  for (const stem of generic) {
    const { result } = checkPair({ backHead: `${stem}에 남은 장면부터 나란히 놓고 얘기해요.`, frontCost: `${stem}이 금세 딱딱해져요.` });
    assert.deepEqual(hitsOf(result, "cost-repeats-head"), [], `${stem}: ${show(result)}`);
    assert.deepEqual(result.errors, [], `${stem}: ${show(result)}`);
  }
});

test("대가 절 되풀이: 흔한 낱말이 아닌 낱말은 모두 잡는다(흔한 낱말 목록이 규칙을 통째로 끄지 않는다)", () => {
  for (const word of ["장면", "사진", "숫자", "표시", "정리", "약속"]) {
    const { result } = checkPair({ backHead: `${word}부터 나란히 놓고 얘기해요.`, frontCost: `${word}이 금세 딱딱해져요.` });
    assert.equal(hitsOf(result, "cost-repeats-head").length, 1, `${word}: ${show(result)}`);
  }
});

test("대가 절 되풀이: 한 글자 낱말(돈)만 같은 것은 되풀이가 아니다", () => {
  // 두 글자 이상의 낱말만 세므로 「돈」만 겹치는 것은 극 단서가 아니다
  const { result } = checkPair({ backHead: "돈 얘기는 마음에 남은 사진 옆에 나란히 놓고 풀어요.", frontCost: "돈 때문에 금세 딱딱해져요." });
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(hitsOf(result, "cost-repeats-head"), [], show(result));
});

test("대가 절 되풀이: 두 글자 서술어(가요)는 어느 문장에나 있는 맺음이라 세지 않는다", () => {
  // 뒤극 머리 절 「걸어 가요」와 앞극 대가 절 「금세 가요」가 「가요」를 함께 쓴다
  const { result } = checkPair({ backHead: "사진 중 마음에 남은 장면부터 나란히 놓고 걸어 가요.", frontCost: "저녁이 금세 가요. 이야기가 딱딱해져요." });
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(hitsOf(result, "cost-repeats-head"), [], show(result));
});

test("대가 절 되풀이: 조사가 달라도 같은 낱말이면 되풀이다(장면부터 대 장면이)", () => {
  const { result } = checkPair({ backHead: "장면부터 나란히 놓고 얘기해요.", frontCost: "장면이 금세 딱딱해져요." });
  assert.equal(hitsOf(result, "cost-repeats-head").length, 1);
  const other = checkPair({ backHead: "장면을 나란히 놓고 얘기해요.", frontCost: "장면은 금세 딱딱해져요." });
  assert.equal(hitsOf(other.result, "cost-repeats-head").length, 1);
});

test("대가 절 되풀이: 대가 절이 없는 카드(문장이 하나뿐)는 보지 않는다", () => {
  const bank = finalBank();
  setPairTexts(bank, "쓸 수 있는 돈부터 적고 그 밑에 장면을 정해요.", "마음에 남은 장면부터 나란히 놓고 얘기해요.");
  const result = lintBank(bank);
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings, [], show(result));
});

test("대가 절 되풀이: 순간 카드(문장 하나)는 보지 않는다", () => {
  const bank = finalBank();
  const moment = firstItem(bank, { fmt: "pair", kind: "moment" });
  const [a, b] = moment.cards;
  assert.equal(a.text.split(/(?<=[.?!])\s+/).length, 1, "순간 카드는 문장이 하나다");
  const result = lintBank(bank, { noLegacy: true });
  assert.deepEqual(hitsOf(result, "cost-repeats-head").filter((h) => h.itemId === moment.id), [], `${a.text} / ${b.text}`);
  assert.deepEqual(result.errors, [], show(result));
});

// 가장·아닌 것 카드는 첫 「, 」 앞이 머리 절이다. 네 카드는 극마다 두 장이고 다른 극의 두 장 모두와 견준다.
const BW_ID = "process.search.3"; // 키 1: 카드 극 배열 앞, 뒤, 뒤, 앞
function checkBestworst(texts, noLegacy = false) {
  const bank = finalBank();
  const item = byId(bank, BW_ID);
  texts.forEach((t, i) => { item.cards[i].text = t; });
  return { item, result: lintBank(bank, { noLegacy }) };
}
const BW_CLEAN = [
  "둘이 함께 여러 곳을 돌아다녀요, 하루가 훌쩍 가요",
  "혼자 다녀와 사진을 정리해요, 정리하느라 저녁이 다 가요",
  "한 사람이 후보를 추려 와요, 추리는 동안 심심해요",
  "사진을 펼쳐 놓고 마주 앉아 골라요, 이야기가 길어져요",
];

test("대가 절 되풀이: 가장·아닌 것 카드는 첫 쉼표 앞을 머리 절로 본다(자기 머리 절의 낱말은 되풀이가 아니다)", () => {
  // 둘째 카드의 대가 절 「정리하느라」는 자기 머리 절의 「정리해요」와 뿌리가 같아 되풀이가 아니다
  const { item, result } = checkBestworst(BW_CLEAN);
  assert.deepEqual(item.cards.map((c) => c.pole), ["front", "back", "back", "front"]);
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(result.warnings, [], show(result));
});

test("대가 절 되풀이: 가장·아닌 것 카드의 대가 절이 다른 극 두 장 중 어느 장의 머리 절을 되풀이해도 잡는다", () => {
  const second = BW_CLEAN.slice();
  second[3] = "사진을 펼쳐 놓고 마주 앉아 골라요, 혼자 이야기가 길어져요"; // 둘째 장(뒤극)의 머리 절 「혼자」
  const a = checkBestworst(second);
  assert.deepEqual(hitsOf(a.result, "cost-repeats-head").map((h) => h.message.split(":")[0]), ["cards[3]"], show(a.result));
  const third = BW_CLEAN.slice();
  third[0] = "둘이 함께 여러 곳을 돌아다녀요, 후보 때문에 하루가 훌쩍 가요"; // 셋째 장(뒤극)의 머리 절 「후보」
  const b = checkBestworst(third);
  assert.deepEqual(hitsOf(b.result, "cost-repeats-head").map((h) => h.message.split(":")[0]), ["cards[0]"], show(b.result));
});

test("대가 절 되풀이: 뒤극 카드의 대가 절이 앞극 카드의 머리 절을 되풀이해도 잡는다", () => {
  const texts = BW_CLEAN.slice();
  texts[1] = "혼자 다녀와 사진을 정리해요, 정리하느라 함께 저녁이 다 가요"; // 앞극 머리 절 「함께」
  const { result } = checkBestworst(texts);
  assert.deepEqual(hitsOf(result, "cost-repeats-head").map((h) => h.message.split(":")[0]), ["cards[1]"], show(result));
});

test("대가 절 되풀이: 가장·아닌 것 카드에 쉼표가 둘이면 첫 쉼표 뒤 전체가 대가 절이다(가운데 조각의 되풀이도 잡는다)", () => {
  const texts = BW_CLEAN.slice();
  // 첫 쉼표와 둘째 쉼표 사이의 「혼자」는 대가 절 안에 있다. 마지막 쉼표를 경계로 보면 머리 절로 넘어가 놓친다.
  texts[3] = "사진을 펼쳐 놓고 마주 앉아 골라요, 혼자 이야기가 길어져도, 밤이 늦어요";
  const { result } = checkBestworst(texts);
  assert.deepEqual(hitsOf(result, "cost-repeats-head").map((h) => h.message.split(":")[0]), ["cards[3]"], show(result));
  assert.match(hitsOf(result, "cost-repeats-head")[0].message, /「혼자」/);
});

test("대가 절 되풀이: 그때 나는·지난 일 보기는 options 자리로 알린다", () => {
  for (const [id, fmt] of [["process.search.2", "instant"], ["process.report.4", "recall"]]) {
    const bank = finalBank();
    const item = byId(bank, id);
    assert.equal(item.fmt, fmt);
    // 극마다 머리 절 둘이 다르고 대가 절은 모두 같다(대가 절끼리 겹치는 것은 되풀이가 아니다)
    const heads = { front: ["가나 다라를 바꿔요.", "마바 사아를 옮겨요."], back: ["고노 도로를 살펴요.", "구누 두루를 맞춰요."] };
    const seen = { front: 0, back: 0 };
    item.options.forEach((o) => { o.text = `${heads[o.pole][seen[o.pole]++]} 무부 수우가 멀어요.`; });
    const clean = lintBank(bank, { noLegacy: true });
    assert.deepEqual(hitsOf(clean, "cost-repeats-head").filter((h) => h.itemId === id), [], `${id}: ${show(clean)}`);
    // 앞극 보기 하나의 대가 절이 뒤극 보기의 머리 절 낱말 「고노」를 되풀이한다
    const front = poleIndex(item, "front");
    item.options[front].text = "가나 다라를 바꿔요. 고노에서 수우가 멀어요.";
    const result = lintBank(bank, { noLegacy: true });
    const hits = hitsOf(result, "cost-repeats-head").filter((h) => h.itemId === id);
    assert.equal(hits.length, 1, `${id}: ${show(result)}`);
    assert.ok(hits[0].message.startsWith(`options[${front}]: `), hits[0].message);
    assert.match(hits[0].message, /「고노」/);
    assert.deepEqual(result.errors, [], `${id}: ${show(result)}`);
  }
});

test("대가 절 되풀이: 지난 일 보기가 한 문장짜리 사실이면 보지 않는다", () => {
  const bank = finalBank();
  const item = byId(bank, "process.report.4");
  assert.equal(item.fmt, "recall");
  item.options[0].text = "큰 단계가 끝날 때마다 메시지로 알렸어요.";
  item.options[1].text = "다 끝난 뒤 완성본을 한 번에 넘겼어요.";
  item.options[2].text = "기한이 가까워졌을 때 한 번 정리해서 알렸어요.";
  item.options[3].text = "거의 매일 짧게라도 그날의 상태를 보냈어요.";
  const result = lintBank(bank, { noLegacy: true });
  assert.deepEqual(result.errors, [], show(result));
  assert.deepEqual(hitsOf(result, "cost-repeats-head").filter((h) => h.itemId === item.id), []);
});

test("대가 절 되풀이: 자기 선택 카드도 본다", () => {
  const bank = finalBank();
  const item = byId(bank, "self.money");
  item.cards[poleIndex(item, "front")].text = "돈이 걸린 일은 계산기부터 두드려요. 계산이 길어지면 기분이 가라앉아요.";
  item.cards[poleIndex(item, "back")].text = "돈이 걸린 일은 남을 순간부터 그려요. 값을 맞추느라 계산기를 붙들어요."; // 앞극 머리 절의 「계산기」
  const result = lintBank(bank, { noLegacy: true });
  const hits = hitsOf(result, "cost-repeats-head").filter((h) => h.itemId === "self.money");
  assert.equal(hits.length, 1, show(result));
  assert.match(hits[0].message, /「계산」/);
});

// R1 이전 문구 중 이 규칙이 잡던 것(옛 은행에서 그대로 옮겼다). 규칙이 실제로 이런 되풀이를 본다는 증거다.
const OLD_ECHO_CASES = [
  {
    id: "money.limit.1", stem: "그리",
    texts: [
      "쓸 수 있는 총액부터 정하고 그 안에서 채워 가요. 마음은 편해도 그리던 장면 하나는 접어야 해요.",
      "결혼하는 날의 모습부터 그리고 돈은 맞춰 가요. 설레는 만큼 나중에 덜어 낼 것도 생겨요.",
    ],
    poles: ["front", "back"],
  },
  {
    id: "money.limit.4", stem: "끌리",
    texts: [
      "쓸 수 있는 총액 옆에 견적 합계를 나란히 적어 봐요, 안심은 돼도 제일 끌리던 곳이 첫 합계에서 빠져요",
      "제일 끌리는 곳부터 골라 두고 다른 항목을 줄여 맞춰요, 고른 확신이 든든해도 줄이는 수고가 커요",
      "사진을 펼쳐 놓고 그날의 모습을 그려 본 뒤 총액을 이야기해요, 쓸 이유는 또렷해도 숫자가 뒤로 밀려요",
      "곳마다 줄일 항목을 표시해서 총액 안에 맞춰요, 안심이 돼도 표만 보다 지치기도 해요",
    ],
    poles: ["front", "back", "back", "front"],
  },
  {
    id: "process.search.2", stem: "알아",
    texts: [
      "한 사람이 두어 곳으로 좁혀 오면 나는 그중에서 골라요. 발품은 덜어도 어떻게 좁혔는지는 잘 몰라요.",
      "검색부터 상담 예약까지 화면을 같이 봐요. 둘이 보니 결정이 뒤집히기도 하지만 놓치는 게 없어요.",
      "각자 찾아본 뒤 만나서 같이 추리고 같이 골라요. 후보는 넉넉해져도 둘 다 알아보느라 품이 들어요.",
      "한 사람이 알아서 골라 오면 그대로 따라요. 고민이 줄어 마음이 가벼워도 다른 후보는 못 본 채 정해져요.",
    ],
    poles: ["back", "front", "front", "back"],
  },
  {
    id: "self.process", stem: "과정",
    texts: [
      "일을 나눠 맡고 각자 해 온 결과를 모아 함께 봐요. 일이 빨리 끝나도 서로의 과정은 다 모를 수 있어요.",
      "찾고, 고르고, 확인하는 준비 과정을 둘이 함께 해요. 더디고 시간을 맞춰야 해도 서로를 더 알게 돼요.",
    ],
    poles: ["back", "front"],
  },
];

test("대가 절 되풀이: R1 이전 문구에서 이 규칙이 잡던 네 문항(카드 2개, 카드 4개, 보기 4개, 자기 선택)을 그대로 잡는다", () => {
  for (const c of OLD_ECHO_CASES) {
    const bank = finalBank();
    const item = byId(bank, c.id);
    assert.deepEqual(listOfItem(item).map((e) => e.pole), c.poles, `${c.id}: 극 배열이 다르다`);
    c.texts.forEach((t, i) => { listOfItem(item)[i].text = t; });
    const result = lintBank(bank, { noLegacy: true });
    const hits = hitsOf(result, "cost-repeats-head").filter((h) => h.itemId === c.id);
    assert.ok(hits.length >= 1, `${c.id}: ${show(result) || "(경고 없음)"}`);
    assert.ok(hits.some((h) => h.message.includes(`「${c.stem}」`)), `${c.id}: ${hits.map((h) => h.message).join("\n")}`);
    assert.deepEqual(result.errors, [], `${c.id}: ${show(result)}`);
  }
});

// ---- 칸 나누기 셋째 항목 ----

const SPLIT_ID = "money.moment.1"; // R1 이 다시 쓴 칸 나누기 문항
function checkThird(text, id = SPLIT_ID) {
  const bank = finalBank();
  const item = byId(bank, id);
  assert.equal(item.fmt, "split");
  const at = item.entries.findIndex((e) => e.pole === "neutral");
  assert.equal(at, 2, "값 0 항목은 셋째다");
  item.entries[at].text = text;
  return { item, result: lintBank(bank) };
}

/** R1 이전 은행의 칸 나누기 셋째 항목 여덟 개(옛 은행에서 그대로 옮겼다). */
const OLD_THIRD_ENTRIES = [
  "같이 좋아하는 영상을 틀어 놓고 일단 멍하니 쉬기", "정하는 건 미루고 다른 급한 일부터 하기", "일정표는 잠시 미뤄 두고 다른 급한 일부터 하기",
  "결혼 준비와 상관없이 밀린 일과 쉬는 시간 챙기기", "혼자 쉴 수 있게 조용히 자리를 비켜 주기", "계약 생각은 접어 두고 쉬면서 머리 식히기",
  "잠시 내려놓고 다른 급한 일부터 하기", "메뉴 이야기는 잠시 접고 다른 준비부터 하기",
];

test("칸 나누기 셋째 항목: 옛 은행의 쉬기·미루기 여덟 개를 모두 하나씩 경고한다", () => {
  assert.equal(OLD_THIRD_ENTRIES.length, 8);
  for (const text of OLD_THIRD_ENTRIES) {
    const { item, result } = checkThird(text);
    const hits = hitsOf(result, "split-third-decoy");
    assert.equal(hits.length, 1, `${text}\n${show(result) || "(경고 없음)"}`);
    assert.equal(hits[0].itemId, item.id);
    assert.ok(hits[0].message.startsWith("entries[2]: "), hits[0].message);
    // 경고는 실패로 세지 않고 다른 규칙과 겹치지 않는다
    assert.deepEqual(result.errors, [], `${text}\n${show(result)}`);
    assert.deepEqual(result.warnings.filter((w) => w.rule !== "split-third-decoy"), [], text);
    assert.match(formatReport(result), /통과/);
  }
});

/** 칸 나누기 셋째 항목이 쓰면 미끼가 되는 낱말. 검사기의 목록을 읽지 않고 이 시험이 따로 든다(검사기 목록에서 낱말이 빠지면 빨개진다). */
const REST_PHRASES = [
  "쉬기", "쉬고", "쉬면서", "쉬어", "쉬는", "쉴 수", "멍하니", "미루", "미뤄", "미룰", "접어 두", "접고", "내려놓", "잠시", "나중에", "손을 떼", "보류",
  "다른 급한 일", "자리를 비켜",
];

test("칸 나누기 셋째 항목: 잡는 낱말을 하나씩 심으면 모두 잡고, 경고 문구가 그 낱말을 보여 준다", () => {
  assert.equal(REST_PHRASES.length, 19);
  for (const phrase of REST_PHRASES) assert.ok(lintModule.SPLIT_THIRD_REST_PHRASES.includes(phrase), `검사기 목록에 「${phrase}」 가 없다`);
  for (const phrase of REST_PHRASES) {
    const { result } = checkThird(`가나 ${phrase} 다라하기`);
    const hits = hitsOf(result, "split-third-decoy");
    assert.equal(hits.length, 1, `${phrase}: ${show(result) || "(경고 없음)"}`);
    assert.ok(hits[0].message.includes(`「${phrase}」`), hits[0].message);
    assert.deepEqual(result.errors, [], `${phrase}: ${show(result)}`);
  }
});

test("칸 나누기 셋째 항목: 미끼가 아닌 실제 대안(넘기기, 부탁하기, 물어보기)은 경고가 없다", () => {
  const real = [
    "잘 아는 사람이나 대행 서비스에 예약을 넘겨 보기",
    "직원에게 혜택을 며칠 더 붙여 달라고 부탁해 보기",
    "이미 해 본 지인에게 전화로 경험을 물어보기",
    "업체 두 곳에 같은 조건으로 견적을 다시 받아 보기",
  ];
  for (const text of real) {
    const { result } = checkThird(text);
    assert.deepEqual(result.errors, [], `${text}\n${show(result)}`);
    assert.deepEqual(result.warnings, [], `${text}\n${show(result)}`);
  }
});

test("칸 나누기 셋째 항목: 앞극과 뒤극 항목의 낱말은 보지 않는다(값 0 항목만 본다)", () => {
  const bank = finalBank();
  const item = byId(bank, SPLIT_ID);
  item.entries[poleIndex(item, "front")].text = "잠시 쉬는 시간을 먼저 챙기고 다른 곳 두어 군데를 더 둘러본 뒤 정하기";
  item.entries[poleIndex(item, "back")].text = "미루지 않고 그 자리에서 계약서에 이름을 적고 바로 예약 날짜를 잡아 두기";
  const result = lintBank(bank);
  assert.deepEqual(hitsOf(result, "split-third-decoy"), [], show(result));
  assert.deepEqual(result.errors, [], show(result));
});

test("칸 나누기 셋째 항목: 칸 나누기가 아닌 문항의 값 0 자리는 보지 않는다", () => {
  // 다른 형식에는 값 0 항목이 없다. 형식이 다른 문항의 보기에 쉬기가 있어도 이 규칙과 무관하다.
  const bank = finalBank();
  const item = firstItem(bank, { fmt: "pair", kind: "method" });
  item.cards[0].text = item.cards[0].text.replace(/^./u, "쉬기 ");
  const result = lintBank(bank);
  assert.deepEqual(hitsOf(result, "split-third-decoy"), [], show(result));
});

// ---- 예외 목록(아직 안 고친 문항)과 R1 문항 ----

const flaggedIds = (result, rule) => [...new Set(hitsOf(result, rule).map((w) => w.itemId))].sort();

test("예외 목록: 실제 은행에서 두 규칙이 (예외 없이) 잡는 문항은 검사기의 예외 목록과 정확히 같다(고친 문항은 목록에서 지우고, 새 되풀이는 목록에 못 숨긴다)", () => {
  const data = realData();
  const all = lintBank(data, { noLegacy: true });
  assert.deepEqual(all.errors, [], show(all));
  assert.deepEqual(flaggedIds(all, "cost-repeats-head"), [...lintModule.COST_ECHO_LEGACY_ITEMS].sort());
  assert.deepEqual(flaggedIds(all, "split-third-decoy"), [...lintModule.SPLIT_THIRD_LEGACY_ITEMS].sort());
  // 예외를 켠 기본 검사는 경고가 없다
  const normal = lintBank(data);
  assert.deepEqual(normal.errors, [], show(normal));
  assert.deepEqual(normal.warnings, [], show(normal));
});

/** R1 때(2026-09-30) 예외 목록에 있던 문항. 목록은 이 안에서 줄기만 한다: 새로 걸리는 문항의 id 를 목록에 넣어 경고를 감출 수 없다. */
const LEGACY_AT_R1_COST = ["scope.final.1", "scope.circle.1", "scope.form.2", "scope.form.3", "scope.circle.4", "money.worth.2", "process.owner.3", "support.recover.1", "support.give.2", "support.recover.3"];
const LEGACY_AT_R1_SPLIT = ["money.check.3", "process.detail.2", "scope.timing.2", "scope.final.4", "support.vent.1", "support.give.3"];

test("예외 목록: 목록은 R1 때 목록의 부분집합이다(줄일 수만 있고 새 문항을 더해 경고를 감출 수 없다)", () => {
  for (const id of lintModule.COST_ECHO_LEGACY_ITEMS) assert.ok(LEGACY_AT_R1_COST.includes(id), `되풀이 예외 목록에 R1 때 없던 문항이 더해졌다: ${id}`);
  for (const id of lintModule.SPLIT_THIRD_LEGACY_ITEMS) assert.ok(LEGACY_AT_R1_SPLIT.includes(id), `셋째 항목 예외 목록에 R1 때 없던 문항이 더해졌다: ${id}`);
  assert.ok(lintModule.COST_ECHO_LEGACY_ITEMS.length <= 10);
  assert.ok(lintModule.SPLIT_THIRD_LEGACY_ITEMS.length <= 6);
});

test("예외 목록: 목록의 id 는 실제 문항이고 중복이 없으며, 규칙에 맞는 형식이다", () => {
  const data = realData();
  const ids = new Set(data.items.map((it) => it.id));
  for (const [name, list] of [["COST_ECHO_LEGACY_ITEMS", lintModule.COST_ECHO_LEGACY_ITEMS], ["SPLIT_THIRD_LEGACY_ITEMS", lintModule.SPLIT_THIRD_LEGACY_ITEMS]]) {
    assert.ok(list.length > 0, `${name} 이 비었다`);
    assert.equal(new Set(list).size, list.length, `${name} 에 중복이 있다`);
    for (const id of list) assert.ok(ids.has(id), `${name}: 없는 문항 ${id}`);
  }
  for (const id of lintModule.SPLIT_THIRD_LEGACY_ITEMS) assert.equal(byId(data, id).fmt, "split", id);
});

test("R1 문항 열세 개와 되돌린 문항 두 개는 합쳐 명세의 열다섯이고 서로 겹치지 않는다", () => {
  assert.equal(R1_ITEM_IDS.length, 13);
  assert.equal(RESTORED_ITEM_IDS.length, 2);
  const all15 = [...R1_ITEM_IDS, ...RESTORED_ITEM_IDS];
  assert.equal(new Set(all15).size, 15);
  const ids = new Set(realData().items.map((it) => it.id));
  for (const id of all15) assert.ok(ids.has(id), `은행에 ${id} 가 없다`);
});

test("R1 문항 열세 개와 원문으로 되돌린 문항 두 개는 예외 목록에 없고, 예외 없이 검사해도 두 규칙에 걸리지 않는다", () => {
  const all = lintBank(realData(), { noLegacy: true });
  for (const id of [...R1_ITEM_IDS, ...RESTORED_ITEM_IDS]) {
    assert.ok(!lintModule.COST_ECHO_LEGACY_ITEMS.includes(id), `${id} 가 되풀이 예외 목록에 있다`);
    assert.ok(!lintModule.SPLIT_THIRD_LEGACY_ITEMS.includes(id), `${id} 가 셋째 항목 예외 목록에 있다`);
    assert.deepEqual(all.warnings.filter((w) => w.itemId === id), [], `${id}: ${show(all)}`);
  }
});

test("예외 없이 검사(noLegacy)는 오류를 새로 만들지 않고 예외를 켠 검사의 경고를 덜어 내기만 한다", () => {
  const data = realData();
  const normal = lintBank(data);
  const strict = lintBank(data, { noLegacy: true });
  assert.deepEqual(strict.errors, normal.errors);
  const key = (w) => `${w.rule}|${w.itemId}|${w.message}`;
  const strictKeys = new Set(strict.warnings.map(key));
  for (const w of normal.warnings) assert.ok(strictKeys.has(key(w)), `예외 없는 검사에서 사라진 경고: ${w.rule} ${w.itemId}`);
  const normalKeys = new Set(normal.warnings.map(key));
  const extra = strict.warnings.filter((w) => !normalKeys.has(key(w)));
  assert.ok(extra.length > 0, "예외 없는 검사가 더 잡는 것이 없다");
  for (const w of extra) {
    const list = w.rule === "cost-repeats-head" ? lintModule.COST_ECHO_LEGACY_ITEMS : w.rule === "split-third-decoy" ? lintModule.SPLIT_THIRD_LEGACY_ITEMS : null;
    assert.ok(list?.includes(w.itemId), `예외 목록 밖의 문항이 더 잡혔다: ${w.rule} ${w.itemId}`);
  }
});

test("새 경고 규칙: 두 규칙은 경고이고 문구 범주다", () => {
  for (const rule of ["cost-repeats-head", "split-third-decoy"]) {
    assert.equal(RULES[rule].severity, "warning", rule);
    assert.equal(RULES[rule].category, "content", rule);
    assert.ok(RULES[rule].description.length > 10, rule);
  }
});

// ---- R1 문항의 내용 기준(명세 6절)을 실제 은행에서 검사기와 따로 확인한다 ----

const poleWordsOf = { money: ["총액", "한도", "환불", "조건", "견적", "설렘"], process: ["같이", "나눠", "담당", "마감"], scope: ["가족", "어른", "집안", "우리 취향"], support: ["할 일", "원인", "덜어", "들어 주"] };
const EVAL_WORDS = ["든든", "후련", "불안", "아쉬", "설레", "어색", "서운", "흐뭇"];

test("R1 문항: 지난 일 보기는 한 문장짜리 사실이고 평가어와 그 주제의 극 낱말이 없다", () => {
  const data = realData();
  const recalls = ["process.report.4"]; // q10(scope.timing.1)은 원문으로 되돌렸다(RESTORED_ITEM_IDS)
  for (const id of recalls) {
    const item = byId(data, id);
    assert.equal(item.fmt, "recall");
    for (const o of item.options) {
      assert.equal(o.text.split(/(?<=[.?!])\s+/).length, 1, `${id}: 문장이 하나여야 한다: ${o.text}`);
      for (const w of EVAL_WORDS) assert.ok(!o.text.includes(w), `${id}: 평가어 ${w}: ${o.text}`);
      for (const w of poleWordsOf[item.axis]) assert.ok(!o.text.includes(w), `${id}: 극 낱말 ${w}: ${o.text}`);
    }
  }
});

test("R1 문항: 그때 나는·두 카드의 머리 절에는 평가어와 그 주제의 극 낱말이 없다", () => {
  const data = realData();
  for (const id of ["money.limit.1", "process.search.2", "money.moment.4"]) {
    const item = byId(data, id);
    for (const e of listOfItem(item)) {
      const head = e.text.split(/(?<=[.?!])\s+/)[0];
      for (const w of EVAL_WORDS) assert.ok(!head.includes(w), `${id}: 머리 절에 평가어 ${w}: ${head}`);
      for (const w of poleWordsOf[item.axis]) assert.ok(!head.includes(w), `${id}: 머리 절에 극 낱말 ${w}: ${head}`);
    }
  }
});

test("R1 문항: 칸 나누기 셋째 항목은 쉬기·미루기가 아닌 실제 대안이다", () => {
  const data = realData();
  for (const id of ["money.moment.1", "process.owner.4"]) {
    const third = byId(data, id).entries.find((e) => e.pole === "neutral").text;
    for (const phrase of REST_PHRASES) assert.ok(!third.includes(phrase), `${id}: ${phrase}: ${third}`);
    for (const w of ["쉬", "미루", "미뤄", "내려놓", "접고"]) assert.ok(!third.includes(w), `${id}: ${w}: ${third}`);
  }
});

test("R1 문항: 자기 선택 카드는 같은 주제의 다른 문항 문구와 다섯 글자 이음이 겹치지 않는다(앞 문항 카드를 되풀이하지 않는다)", () => {
  const data = realData();
  const grams = (t, n) => {
    const s = t.replace(/[^가-힣]/gu, "");
    const out = new Set();
    for (let i = 0; i + n <= s.length; i += 1) out.add(s.slice(i, i + n));
    return out;
  };
  const textsOfItem = (it) => [...(it.cards ?? []), ...(it.options ?? []), ...(it.entries ?? [])].map((c) => c.text).concat(it.quote ? [it.quote.text, it.recap, it.ends.left, it.ends.right] : []);
  for (const self of itemsWhere(data, { fmt: "self" })) {
    for (const card of self.cards) {
      const mine = grams(card.text, 5);
      for (const other of data.items.filter((it) => it.axis === self.axis && it.fmt !== "self")) {
        for (const t of textsOfItem(other)) {
          const shared = [...grams(t, 5)].filter((g) => mine.has(g));
          assert.deepEqual(shared, [], `${self.id} 카드가 ${other.id} 문구와 겹친다: ${card.text} / ${t}`);
        }
      }
    }
  }
});

test("R1 문항: 다섯 칸 이야기 문항(친구의 앨범)의 두 끝은 좋고 나쁨이 한쪽으로 기울지 않게 사실을 말한다", () => {
  const item = byId(realData(), "money.worth.4");
  assert.equal(item.fmt, "react");
  // 인용문은 두 끝이 말하는 것(생활, 장면)을 같은 무게로 한 번씩 적고, 옛 인용문의 「아쉬워」 같은 평가어가 없다
  for (const w of ["아쉬", "후회", "알뜰", "지키느라"]) assert.ok(!item.quote.text.includes(w), `${w}: ${item.quote.text}`);
  assert.match(item.quote.text, /생활/);
  assert.match(item.quote.text, /장면/);
  for (const end of [item.ends.left, item.ends.right]) assert.match(end, /더 남을 것 같아요$/);
});

// ---- 단계 1(2026-09-30): 다섯 칸 recap 과 끝의 이음 ----

test("다섯 칸 recap: 양끝이 모두 ~고 싶어요인 문항의 recap 은 「~한다면」 「~이라면」 꼴이 아니다(결과 화면 「내가 고른 답」은 recap 과 끝을 이어 읽는다)", () => {
  // present.ts 의 answerText 는 `${recap} ${끝}` 이다. recap 이 「내가 그 방식을 한다면」이면 반대편 끝(예: 혼자여도 각자 집중하고 싶어요)과 이어 읽을 때
  // 「그 방식을 하는데 다른 방식을 하고 싶다」는 자기모순으로 읽힌다. 「~는 얘기를 들으면」 「~하면」 「~할 때」 꼴은 어느 끝과 이어도 자연스럽다.
  // 끝이 「더 남을 것 같아요」(예측)인 문항의 「~한다면」은 자연스러워서 보지 않는다.
  const wishes = realData().items.filter((it) => it.fmt === "react" && [it.ends.left, it.ends.right].every((t) => /고 싶어요$/.test(t)));
  assert.ok(wishes.length >= 14, `바람 꼴 끝의 react 문항 ${wishes.length}개`);
  for (const it of wishes) assert.doesNotMatch(it.recap, /(?:다면|라면)$/, `${it.id}: ${it.recap}`);
});
