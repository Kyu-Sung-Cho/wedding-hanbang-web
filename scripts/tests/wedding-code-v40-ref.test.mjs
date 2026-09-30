// 웨딩코드 4.0 기준 계산기(scripts/lib/wedding-code-v40-ref.mjs) 시험.
//
// 이 계산기는 TypeScript 구현의 정답표 노릇을 하므로 시험이 세 가지를 지킨다.
//   1. 상수와 배치가 동결된 계약(constants/weddingCodeV40.ts, v40/layout.ts, v40/contract.ts)과 어긋나지 않는다.
//   2. 설계 문서 5절의 계산과 손으로 푼 예시가 그대로 나온다(정수 경계 포함).
//   3. 링크 코덱이 시드 응답자 2000명에서 왕복하고, 깨진 링크는 하나도 통과하지 못한다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as ref from "../lib/wedding-code-v40-ref.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const CONSTANTS_TS = read("apps/web/src/constants/weddingCodeV40.ts");
const LAYOUT_TS = read("apps/web/src/lib/weddingCode/v40/layout.ts");
const CONTRACT_TS = read("apps/web/src/lib/weddingCode/v40/contract.ts");

const data = ref.loadBankData();
const bank = ref.makeBank(data);
const layout = ref.loadLayout();

// ---------------------------------------------------------------------------
// 도우미: 원하는 문항 값을 내는 저장 상태 찾기, 주제 응답 만들기
// ---------------------------------------------------------------------------

const stateCount = (item) => ref.STATE_COUNTS[item.fmt];
const valueSetOf = (item) => [...new Set(Array.from({ length: stateCount(item) }, (_, s) => ref.stateValue(item, s)))].sort((a, b) => a - b);
function stateOfValue(item, value) {
  for (let s = 0; s < stateCount(item); s += 1) if (ref.stateValue(item, s) === value) return ref.stateChar(s);
  throw new Error(`${item.id} 에 값 ${value} 를 내는 상태가 없다`);
}

/** 측면 하나의 앞 n 문항이 합 target 이 되는 모든 값 조합. */
function facetOptions(items, target) {
  const sets = items.map(valueSetOf);
  const out = [];
  const rec = (i, acc, sum) => {
    if (i === items.length) {
      if (sum === target) out.push(acc.slice());
      return;
    }
    for (const v of sets[i]) {
      acc.push(v);
      rec(i + 1, acc, sum + v);
      acc.pop();
    }
  };
  rec(0, [], 0);
  return out;
}

/**
 * 한 주제의 응답을 값으로 지정해 만든다.
 * plan: { facetSums: [4개], counts?: [4개, 측면마다 답할 문항 수(기본 4)], chooseSum?, reactSum? }
 * 답하지 않는 문항은 skip 으로 둔다. chooseSum 은 recall+instant 값의 합, reactSum 은 react 값의 합에 거는 조건이다.
 */
function axisResponses(axis, plan) {
  const facets = ref.FACETS_OF[axis];
  const perFacet = facets.map((facet, f) => {
    const items = bank.scoredByAxis[axis].filter((it) => it.facet === facet);
    const n = plan.counts?.[f] ?? 4;
    const used = items.slice(0, n);
    const options = facetOptions(used, plan.facetSums[f]).map((values) => ({
      values,
      items: used,
      choose: used.reduce((s, it, i) => s + (it.fmt === "recall" || it.fmt === "instant" ? values[i] : 0), 0),
      react: used.reduce((s, it, i) => s + (it.fmt === "react" ? values[i] : 0), 0),
    }));
    assert.ok(options.length > 0, `${axis}.${facet} 에 합 ${plan.facetSums[f]} (문항 ${n}개)을 내는 조합이 없다`);
    return { items, used, options };
  });
  // 측면을 이어 가며 (choose, react) 합의 도달 가능 집합을 쌓는다.
  let layer = new Map([["0,0", { prev: null, option: null }]]);
  const layers = [layer];
  for (const pf of perFacet) {
    const next = new Map();
    for (const [key, node] of layer) {
      const [c, r] = key.split(",").map(Number);
      void node;
      for (const option of pf.options) {
        const k = `${c + option.choose},${r + option.react}`;
        if (!next.has(k)) next.set(k, { prev: key, option });
      }
    }
    layer = next;
    layers.push(layer);
  }
  const candidates = [...layer.keys()].filter((key) => {
    const [c, r] = key.split(",").map(Number);
    return (plan.chooseSum === undefined || c === plan.chooseSum) && (plan.reactSum === undefined || r === plan.reactSum);
  });
  assert.ok(candidates.length > 0, `${axis} 에 조건(choose ${plan.chooseSum}, react ${plan.reactSum})을 만족하는 조합이 없다`);
  let key = candidates[0];
  const chosen = [];
  for (let i = perFacet.length; i >= 1; i -= 1) {
    const node = layers[i].get(key);
    chosen[i - 1] = node.option;
    key = node.prev;
  }
  const responses = {};
  perFacet.forEach((pf, f) => {
    for (const item of pf.items) responses[item.id] = "skip";
    pf.used.forEach((item, i) => {
      responses[item.id] = stateOfValue(item, chosen[f].values[i]);
    });
  });
  return responses;
}

/** 여러 주제를 합치고 자기 선택은 self 인자로(없으면 건너뜀). 계획에 없는 주제는 해당 없음으로 채운다(건너뜀 힌트에 세지 않게). */
function fullResponses(axisPlans, selfCells = {}) {
  const responses = {};
  for (const item of bank.scored) responses[item.id] = "na";
  for (const [axis, plan] of Object.entries(axisPlans)) Object.assign(responses, axisResponses(axis, plan));
  for (const item of bank.self) responses[item.id] = selfCells[item.axis] !== undefined ? ref.stateChar(selfCells[item.axis]) : "skip";
  return responses;
}

// ---------------------------------------------------------------------------
// 1. 계약과의 일치
// ---------------------------------------------------------------------------

test("상수가 constants/weddingCodeV40.ts 와 같다", () => {
  assert.equal(CONSTANTS_TS.match(/WEDDING_CODE_V40_VERSION = "([^"]+)"/)[1], ref.VERSION);
  assert.equal(CONSTANTS_TS.match(/V40_STATE_ALPHABET = "([^"]+)"/)[1], ref.ALPHABET);
  assert.equal(CONSTANTS_TS.match(/V40_SKIP_CHAR = "(.)"/)[1], ref.SKIP_CHAR);
  assert.equal(CONSTANTS_TS.match(/V40_NA_CHAR = "(.)"/)[1], ref.NA_CHAR);
  assert.equal(CONSTANTS_TS.match(/V40_UNSET_LETTER_MARK = "(.)"/)[1], ref.UNSET_LETTER_MARK);
  const counts = CONSTANTS_TS.slice(CONSTANTS_TS.indexOf("V40_COUNTS = {"));
  const num = (name) => Number(counts.match(new RegExp(`${name}: (\\d+)`))[1]);
  assert.equal(num("codeLength"), ref.CODE_LENGTH);
  assert.equal(num("minValidAnswers"), ref.MIN_VALID_ANSWERS);
  assert.equal(num("minCountedFacets"), ref.MIN_COUNTED_FACETS);
  assert.equal(num("skipHintOver"), ref.SKIP_HINT_OVER);
  assert.equal(num("items"), 68);
  const stateBlock = CONSTANTS_TS.slice(CONSTANTS_TS.indexOf("V40_STATE_COUNTS"));
  for (const [fmt, n] of Object.entries(ref.STATE_COUNTS)) assert.equal(Number(stateBlock.match(new RegExp(`${fmt}: (\\d+)`))[1]), n, `상태 수 ${fmt}`);
});

test("글자와 측면이 constants/weddingCodeV40.ts 와 같다", () => {
  const letters = [...CONSTANTS_TS.matchAll(/letter: "([A-Z])", axis: "(\w+)", side: "(front|back)"/g)];
  assert.equal(letters.length, 8);
  for (const [, letter, axis, side] of letters) assert.equal(ref.LETTER_OF[axis][side], letter);
  const facets = [...CONSTANTS_TS.matchAll(/key: "(\w+)", axis: "(\w+)", order: (\d),/g)];
  assert.equal(facets.length, 16);
  for (const [, key, axis, order] of facets) assert.equal(ref.FACETS_OF[axis][Number(order)], key);
});

test("임계값이 contract.ts 의 문서와 같다", () => {
  assert.match(CONTRACT_TS, /임계: pair 15, react 14, choose 14/);
  assert.deepEqual(ref.RHYTHM_THRESHOLD_16THS, { pair: 15, react: 14, choose: 14 });
  assert.match(CONTRACT_TS, /\|N\| >= 36 x m/);
  assert.match(CONTRACT_TS, /\|N\| >= 18 x m/);
  assert.equal(ref.BAND_CLEAR_PER_FACET, 36);
  assert.equal(ref.BAND_LEAN_PER_FACET, 18);
  assert.match(CONTRACT_TS, /T mod 61/);
  assert.match(CONTRACT_TS, /"-" 는 59, "_" 는 60/);
});

test("기준 계산기와 검사기의 머리 주석이 내보내는 이름을 하나도 빠뜨리지 않는다", () => {
  for (const rel of ["scripts/lib/wedding-code-v40-ref.mjs", "scripts/lib/wedding-code-v40-bank-lint.mjs"]) {
    const text = read(rel);
    const header = text.slice(0, text.indexOf("*/"));
    const names = [...text.matchAll(/^export (?:async )?(?:function|const) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
    assert.ok(names.length > 10, `${rel}: 내보내는 이름 ${names.length}개`);
    const missing = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(header));
    assert.deepEqual(missing, [], `${rel} 머리 주석에 없는 내보내기: ${missing.join(", ")}`);
  }
});

test("배치 골격 JSON 이 layout.ts 와 한 행도 다르지 않다", () => {
  const rowRe = /\{ id: "([^"]+)", axis: "([^"]+)", facet: (null|"[^"]+"), section: (\d), screen: (\d+), pos: (\d), fmt: "([^"]+)", kind: (null|"[^"]+"), key: (-?1) \}/g;
  const rows = [...LAYOUT_TS.matchAll(rowRe)].map((m) => ({
    id: m[1], axis: m[2], facet: m[3] === "null" ? null : JSON.parse(m[3]), section: Number(m[4]), screen: Number(m[5]), pos: Number(m[6]),
    fmt: m[7], kind: m[8] === "null" ? null : JSON.parse(m[8]), key: Number(m[9]),
  }));
  assert.equal(rows.length, 68);
  assert.deepEqual(layout, rows);
});

test("배치 골격이 설계 성질을 모두 만족한다", () => {
  assert.deepEqual(ref.verifyLayout(layout), []);
});

test("배치 골격을 하나만 깨도 verifyLayout 이 그 성질을 잡는다", () => {
  const cases = [
    ["layout-key-balance", (l) => { l.find((r) => r.id === "money.limit.1").key = -1; }],
    ["layout-mirror", (l) => { l.find((r) => r.id === "money.worth.3").key = 1; l.find((r) => r.id === "money.limit.1").key = 1; }],
    ["layout-count", (l) => { l.pop(); }],
    ["layout-duplicate-id", (l) => { l[1] = { ...l[1], id: l[0].id }; }],
    ["layout-format-count", (l) => { l.find((r) => r.id === "money.check.4").fmt = "react"; }],
    ["layout-kind", (l) => { l.find((r) => r.id === "money.moment.2").kind = "method"; }],
    ["layout-screens", (l) => { l.find((r) => r.id === "money.limit.1").pos = 3; }],
    ["layout-latin", (l) => { l.find((r) => r.id === "money.check.1").facet = "limit"; }],
    ["layout-adjacent-axis", (l) => { const a = l.findIndex((r) => r.id === "money.limit.1"); const b = l.findIndex((r) => r.id === "process.owner.1"); [l[a], l[b]] = [l[b], l[a]]; }],
    // 마음이 무거운 측면(마지막 선택)이 구간의 맨 앞 화면에 오면 잡는다
    ["layout-heavy-topic", (l) => { l.find((r) => r.id === "money.limit.1").facet = "final"; }],
    // 자기 묘사 문항(방법 카드, 바로 고르기, 가장·아닌 것)이 주제마다 6개를 넘으면 잡는다: 이럴 때 하나를 바로 고르기로 바꾸면 7개
    ["layout-indirect", (l) => { l.find((r) => r.id === "money.worth.4").fmt = "instant"; }],
  ];
  for (const [rule, mutate] of cases) {
    const copy = structuredClone(layout);
    mutate(copy);
    const rules = new Set(ref.verifyLayout(copy).map((p) => p.rule));
    assert.ok(rules.has(rule), `${rule} 을 기대했는데 ${[...rules].join(", ")}`);
  }
});

// ---------------------------------------------------------------------------
// 2. 저장 상태 문자와 화면 답
// ---------------------------------------------------------------------------

test("칸 나누기 28개와 가장·아닌 것 12개 상태가 왕복한다", () => {
  const seen = new Set();
  for (let a = 0; a <= 6; a += 1) {
    for (let b = 0; a + b <= 6; b += 1) {
      const s = ref.splitStateOf(a, b);
      assert.ok(!seen.has(s));
      seen.add(s);
      assert.deepEqual(ref.splitCountsOf(s), [a, b, 6 - a - b]);
    }
  }
  assert.equal(seen.size, 28);
  assert.deepEqual([...seen].sort((x, y) => x - y), Array.from({ length: 28 }, (_, i) => i));
  const bw = new Set();
  for (let best = 0; best < 4; best += 1) {
    for (let worst = 0; worst < 4; worst += 1) {
      if (best === worst) continue;
      const s = ref.bestWorstStateOf(best, worst);
      bw.add(s);
      assert.deepEqual(ref.bestWorstPairOf(s), { best, worst });
    }
  }
  assert.equal(bw.size, 12);
  assert.throws(() => ref.splitStateOf(4, 3), RangeError);
  assert.throws(() => ref.splitCountsOf(28), RangeError);
  assert.throws(() => ref.bestWorstStateOf(1, 1), RangeError);
  assert.throws(() => ref.stateChar(62), RangeError);
});

test("상태 문자는 형식마다 범위가 다르다", () => {
  assert.ok(ref.isStateFor("pair", "5"));
  assert.ok(!ref.isStateFor("pair", "6"));
  assert.ok(ref.isStateFor("react", "4"));
  assert.ok(!ref.isStateFor("react", "5"));
  assert.ok(ref.isStateFor("bestworst", "b"));
  assert.ok(!ref.isStateFor("bestworst", "c"));
  assert.ok(ref.isStateFor("split", "r"));
  assert.ok(!ref.isStateFor("split", "s"));
  for (const bad of ["-", "_", ".", "", "00", "가", "B?"]) assert.equal(ref.stateIndexOf(bad), null);
  assert.equal(ref.fromCodeChar("-"), "skip");
  assert.equal(ref.fromCodeChar("_"), "na");
  assert.equal(ref.fromCodeChar("."), null);
  assert.equal(ref.toCodeChar("skip"), "-");
  assert.equal(ref.toCodeChar("na"), "_");
});

function allViewAnswers(item) {
  const out = [];
  switch (item.fmt) {
    case "pair":
    case "self":
      for (let cell = 0; cell < 6; cell += 1) out.push({ fmt: item.fmt, cell });
      break;
    case "react":
      for (let cell = 0; cell < 5; cell += 1) out.push({ fmt: "react", cell });
      break;
    case "recall":
    case "instant":
      for (let option = 0; option < 4; option += 1) out.push({ fmt: item.fmt, option });
      break;
    case "bestworst":
      for (let best = 0; best < 4; best += 1) for (let worst = 0; worst < 4; worst += 1) if (best !== worst) out.push({ fmt: "bestworst", best, worst });
      break;
    case "split":
      for (let a = 0; a <= 6; a += 1) for (let b = 0; a + b <= 6; b += 1) out.push({ fmt: "split", counts: [a, b, 6 - a - b] });
      break;
    default:
  }
  return out;
}

test("화면 답과 저장값이 모든 상태, 두 폼 비트에서 왕복한다", () => {
  for (const item of bank.items) {
    const views = allViewAnswers(item);
    assert.equal(views.length, ref.STATE_COUNTS[item.fmt]);
    for (const formBit of [0, 1]) {
      const storedSeen = new Set();
      for (const view of views) {
        assert.ok(ref.isViewComplete(item, view));
        const stored = ref.viewToStored(item, formBit, view);
        assert.ok(ref.isStateFor(item.fmt, stored), `${item.id} ${JSON.stringify(view)}`);
        storedSeen.add(stored);
        assert.deepEqual(ref.storedToView(item, formBit, stored), view);
      }
      assert.equal(storedSeen.size, views.length, `${item.id} 폼 비트 ${formBit} 이 전단사가 아니다`);
      assert.deepEqual(ref.storedToView(item, formBit, "skip"), { fmt: "escape", which: "unsure" });
      assert.deepEqual(ref.storedToView(item, formBit, "na"), { fmt: "escape", which: "na" });
      assert.equal(ref.viewToStored(item, formBit, { fmt: "escape", which: "unsure" }), "skip");
      assert.equal(ref.viewToStored(item, formBit, { fmt: "escape", which: "na" }), "na");
    }
  }
});

test("중간 상태와 범위 밖 화면 답은 저장값이 되지 못한다", () => {
  const bw = bank.byId.get("money.limit.4");
  const sp = bank.byId.get("money.moment.1");
  const pair = bank.byId.get("money.limit.1");
  for (const formBit of [0, 1]) {
    assert.equal(ref.viewToStored(bw, formBit, { fmt: "bestworst", best: 1, worst: null }), null);
    assert.equal(ref.viewToStored(bw, formBit, { fmt: "bestworst", best: 2, worst: 2 }), null);
    assert.equal(ref.viewToStored(sp, formBit, { fmt: "split", counts: [2, 2, 1] }), null);
    assert.equal(ref.viewToStored(sp, formBit, { fmt: "split", counts: [7, -1, 0] }), null);
    assert.equal(ref.viewToStored(pair, formBit, { fmt: "pair", cell: 6 }), null);
    assert.equal(ref.viewToStored(pair, formBit, { fmt: "react", cell: 1 }), null);
    assert.equal(ref.viewToStored(pair, formBit, { fmt: "pair", cell: 1.5 }), null);
  }
});

/** 설계 분석 스크립트(design/workF/analyze.js)의 value() 를 그대로 옮긴 독립 계산. r 은 분석 스크립트의 응답 표기. */
function designValue(fam, key, r, flip) {
  const V = [-2, 6, 2, -6];
  const B0 = [1, -1, -1, 1];
  const raw = (() => {
    switch (fam) {
      case "pair": return 2 * r.m * (flip ? -r.pos : r.pos) * key;
      case "react": { const col = flip ? 6 - r.col : r.col; return 3 * (col - 3) * key; }
      case "choose": { const col = flip ? 5 - r.col : r.col; return key * V[col - 1]; }
      case "bestworst": { const b = flip ? 3 - r.b : r.b; const w = flip ? 3 - r.w : r.w; return 4 * key * B0[b] - 2 * key * B0[w]; }
      case "split": { const p = flip ? [r.p[1], r.p[0], r.p[2]] : r.p; return key * (p[0] - p[1]); }
      default: throw new Error(fam);
    }
  })();
  return raw === 0 ? 0 : raw; // -0 을 0 으로
}

test("문항 값이 설계 분석 스크립트의 계산과 모든 화면 답, 두 폼 비트에서 같다", () => {
  let compared = 0;
  const rowOf = new Map(layout.map((r) => [r.id, r]));
  for (const item of bank.scored) {
    const key = rowOf.get(item.id).key;
    for (const formBit of [0, 1]) {
      for (const view of allViewAnswers(item)) {
        let r;
        let fam = ref.familyOf(item.fmt);
        switch (item.fmt) {
          case "pair": r = view.cell <= 2 ? { pos: 1, m: 3 - view.cell } : { pos: -1, m: view.cell - 2 }; break;
          case "react": r = { col: view.cell + 1 }; break;
          case "recall":
          case "instant": r = { col: view.option + 1 }; break;
          case "bestworst": r = { b: view.best, w: view.worst }; break;
          case "split": r = { p: view.counts }; break;
          default: throw new Error(item.fmt);
        }
        assert.equal(ref.viewValue(item, formBit, view), designValue(fam, key, r, formBit === 1), `${item.id} 폼 비트 ${formBit} ${JSON.stringify(view)}`);
        compared += 1;
      }
    }
  }
  // 채점 문항 64개 x 화면 답 (pair 6, react 5, 고르기 4, 가장·아닌 것 12, 칸 나누기 28) x 폼 비트 2 = 1,120건
  assert.equal(compared, 2 * (16 * 6 + 16 * 5 + 16 * 4 + 8 * 12 + 8 * 28));
  assert.equal(compared, 1120);
});

test("문항 값의 집합과 부호 규칙", () => {
  const pair = bank.byId.get("money.limit.1"); // key +1: 위 카드가 앞극
  assert.deepEqual(Array.from({ length: 6 }, (_, s) => ref.stateValue(pair, s)), [6, 4, 2, -2, -4, -6]);
  const pairFlipped = bank.byId.get("process.owner.1"); // key -1
  assert.deepEqual(Array.from({ length: 6 }, (_, s) => ref.stateValue(pairFlipped, s)), [-6, -4, -2, 2, 4, 6]);
  const react = bank.byId.get("process.search.1"); // key +1
  assert.deepEqual(Array.from({ length: 5 }, (_, s) => ref.stateValue(react, s)), [-6, -3, 0, 3, 6]);
  const react2 = bank.byId.get("money.worth.4"); // key -1
  assert.deepEqual(Array.from({ length: 5 }, (_, s) => ref.stateValue(react2, s)), [6, 3, 0, -3, -6]);
  const recall = bank.byId.get("money.limit.3"); // key +1
  assert.deepEqual(Array.from({ length: 4 }, (_, s) => ref.stateValue(recall, s)), [-2, 6, 2, -6]);
  const instant = bank.byId.get("money.worth.1"); // key -1
  assert.deepEqual(Array.from({ length: 4 }, (_, s) => ref.stateValue(instant, s)), [2, -6, -2, 6]);
  const bw = bank.byId.get("money.limit.4"); // key +1: 극 (앞, 뒤, 뒤, 앞)
  assert.equal(ref.stateValue(bw, ref.bestWorstStateOf(0, 1)), 4 + 2);
  assert.equal(ref.stateValue(bw, ref.bestWorstStateOf(0, 3)), 4 - 2);
  assert.equal(ref.stateValue(bw, ref.bestWorstStateOf(1, 0)), -4 - 2);
  assert.equal(ref.stateValue(bw, ref.bestWorstStateOf(1, 2)), -4 + 2);
  const split = bank.byId.get("money.moment.1"); // key +1: (앞, 뒤, 중립)
  assert.equal(ref.stateValue(split, ref.splitStateOf(6, 0)), 6);
  assert.equal(ref.stateValue(split, ref.splitStateOf(0, 6)), -6);
  assert.equal(ref.stateValue(split, ref.splitStateOf(0, 0)), 0);
  assert.equal(ref.stateValue(split, ref.splitStateOf(2, 3)), -1);
  const splitFlipped = bank.byId.get("money.check.3"); // key -1: (뒤, 앞, 중립)
  assert.equal(ref.stateValue(splitFlipped, ref.splitStateOf(6, 0)), -6);
  assert.equal(ref.stateValue(splitFlipped, ref.splitStateOf(1, 4)), 3);
  // 빠진 값은 0 이 아니라 null
  for (const v of ["skip", "na", undefined, "z", "-", "_"]) assert.equal(ref.itemValue(pair, v), null);
  assert.equal(ref.itemValue(pair, "6"), null);
  assert.equal(ref.itemValue(bank.byId.get("self.money"), "0"), null);
});

test("자기 선택은 값이 없고 고른 방향과 세기만 낸다", () => {
  const selfMoney = bank.byId.get("self.money"); // key +1: 위 카드가 앞극
  assert.deepEqual(ref.selfChoice(selfMoney, "0"), { side: "front", level: 3 });
  assert.deepEqual(ref.selfChoice(selfMoney, "2"), { side: "front", level: 1 });
  assert.deepEqual(ref.selfChoice(selfMoney, "3"), { side: "back", level: 1 });
  assert.deepEqual(ref.selfChoice(selfMoney, "5"), { side: "back", level: 3 });
  const selfProcess = bank.byId.get("self.process"); // key -1
  assert.deepEqual(ref.selfChoice(selfProcess, "0"), { side: "back", level: 3 });
  for (const v of ["skip", "na", undefined, "6", "-"]) assert.equal(ref.selfChoice(selfMoney, v), null);
});

test("화면 위치(위치 반복 검사용)는 폼 비트를 반영한 화면 기준이다", () => {
  for (const item of bank.scored.filter((it) => ["pair", "react", "recall", "instant"].includes(it.fmt))) {
    for (const formBit of [0, 1]) {
      for (const view of allViewAnswers(item)) {
        const stored = ref.viewToStored(item, formBit, view);
        const expected = item.fmt === "pair" ? (view.cell <= 2 ? 0 : 1) : item.fmt === "react" ? view.cell : view.option;
        assert.equal(ref.viewPosition(item, formBit, stored), expected, `${item.id} 폼 비트 ${formBit}`);
      }
    }
  }
  assert.equal(ref.viewPosition(bank.byId.get("money.limit.4"), 0, "0"), null);
  assert.equal(ref.viewPosition(bank.byId.get("money.limit.1"), 0, "skip"), null);
});

// ---------------------------------------------------------------------------
// 3. 채점: 문서 5절 예시와 정수 경계
// ---------------------------------------------------------------------------

test("문서 5절 예시: 돈 축 합 -44(측면 -15, +10, -24, -15) -> N -132, 글자 S, 기울어요", () => {
  const responses = fullResponses({ money: { facetSums: [-15, 10, -24, -15] } });
  const money = ref.scoreAxis(bank, responses, "money");
  assert.equal(money.sum, -44);
  assert.deepEqual(money.facets.map((f) => f.sum), [-15, 10, -24, -15]);
  assert.equal(money.countedFacets, 4);
  assert.equal(money.answered, 16);
  assert.equal(money.unusable, false);
  assert.equal(money.weighted, -132);
  assert.equal(Number(money.s.toFixed(3)), -0.458);
  assert.equal(money.side, "back");
  assert.equal(money.letter, "S");
  assert.equal(money.tieLevel, 0);
  assert.equal(money.band, "lean");
  assert.ok(Number.isInteger(money.weighted));
});

test("세기 경계: 완전한 답이면 N = 3 x 합, |N| >= 72 기울어요, >= 144 뚜렷해요", () => {
  const cases = [
    [24, "front", "lean"], [23, "front", "even"], [48, "front", "clear"], [47, "front", "lean"], [49, "front", "clear"], [25, "front", "lean"],
    [-24, "back", "lean"], [-23, "back", "even"], [-48, "back", "clear"], [-47, "back", "lean"], [1, "front", "even"], [-1, "back", "even"],
  ];
  for (const [total, side, band] of cases) {
    // 측면 합을 고르게 나눈다(합이 total 이 되게).
    const base = Math.trunc(total / 4);
    const facetSums = [base, base, base, total - base * 3];
    const money = ref.scoreAxis(bank, fullResponses({ money: { facetSums } }), "money");
    assert.equal(money.weighted, 3 * total, `합 ${total}`);
    assert.equal(money.side, side, `합 ${total} 방향`);
    assert.equal(money.band, band, `합 ${total} 세기`);
    assert.equal(money.tieLevel, 0);
  }
});

test("일부만 답하면 측면 합에 12/n 을 곱한다(n = 2, 3, 4 -> 6, 4, 3)", () => {
  // 답한 문항 수 (4, 3, 2, 4): N = 3 s1 + 4 s2 + 6 s3 + 3 s4
  const plan66 = { facetSums: [8, 6, 4, -2], counts: [4, 3, 2, 4] };
  const a = ref.scoreAxis(bank, fullResponses({ money: plan66 }), "money");
  assert.equal(a.answered, 13);
  assert.equal(a.countedFacets, 4);
  assert.equal(a.weighted, 3 * 8 + 4 * 6 + 6 * 4 + 3 * -2);
  assert.equal(a.weighted, 66);
  assert.equal(a.band, "even"); // 66 < 72
  const plan90 = { facetSums: [8, 6, 8, -2], counts: [4, 3, 2, 4] };
  const b = ref.scoreAxis(bank, fullResponses({ money: plan90 }), "money");
  assert.equal(b.weighted, 24 + 24 + 48 - 6);
  assert.equal(b.weighted, 90);
  assert.equal(b.band, "lean"); // 72 <= 90 < 144
  assert.equal(b.letter, "V");
  // 경계 72 = 18 x 4 와 그 아래 69
  const at72 = ref.scoreAxis(bank, fullResponses({ money: { facetSums: [8, 6, 4, 0], counts: [4, 3, 2, 4] } }), "money");
  assert.equal(at72.weighted, 72);
  assert.equal(at72.band, "lean");
  const at69 = ref.scoreAxis(bank, fullResponses({ money: { facetSums: [8, 6, 4, -1], counts: [4, 3, 2, 4] } }), "money");
  assert.equal(at69.weighted, 69);
  assert.equal(at69.band, "even");
  // 음수 쪽도 대칭
  const neg = ref.scoreAxis(bank, fullResponses({ money: { facetSums: [-8, -6, -8, 2], counts: [4, 3, 2, 4] } }), "money");
  assert.equal(neg.weighted, -90);
  assert.equal(neg.side, "back");
  assert.equal(neg.letter, "S");
  assert.equal(neg.band, "lean");
});

test("답이 1개인 측면은 세지 않고, 세는 측면이 3개면 임계는 54와 108이다", () => {
  // (4, 4, 4, 1): 유효 답 13개, 세는 측면 3개
  const plan = (s) => ({ facetSums: [s, s, s, 2], counts: [4, 4, 4, 1] });
  const at = (s) => ref.scoreAxis(bank, fullResponses({ money: plan(s) }), "money");
  const x = at(6); // N = 3 x 18 = 54 = 18 m
  assert.equal(x.answered, 13);
  assert.equal(x.countedFacets, 3);
  assert.equal(x.facets[3].counted, false);
  assert.equal(x.weighted, 54);
  assert.equal(x.band, "lean");
  assert.equal(at(5).weighted, 45);
  assert.equal(at(5).band, "even");
  assert.equal(at(12).weighted, 108);
  assert.equal(at(12).band, "clear");
  assert.equal(at(11).weighted, 99);
  assert.equal(at(11).band, "lean");
  assert.equal(x.sum, 6 * 3 + 2, "세지 않는 측면의 답도 문항 합에는 들어간다");
});

test("유효 답이 12개 미만이면 글자를 만들지 않는다(건너뜀, 해당 없음은 빠진 값)", () => {
  const twelve = ref.scoreAxis(bank, fullResponses({ money: { facetSums: [4, 4, 4, 0], counts: [4, 4, 4, 0] } }), "money");
  assert.equal(twelve.answered, 12);
  assert.equal(twelve.countedFacets, 3);
  assert.equal(twelve.unusable, false);
  assert.equal(twelve.letter, "V");
  const eleven = ref.scoreAxis(bank, fullResponses({ money: { facetSums: [4, 4, 2, 0], counts: [4, 4, 3, 0] } }), "money");
  assert.equal(eleven.answered, 11);
  assert.equal(eleven.unusable, true);
  for (const k of ["weighted", "s", "side", "letter", "tieLevel", "band"]) assert.equal(eleven[k], null, k);
  // 건너뜀 4개와 해당 없음 1개 -> 유효 답 11개
  const responses = fullResponses({ money: { facetSums: [4, 4, 4, 4] } });
  const ids = bank.scoredByAxis.money.map((it) => it.id);
  for (const id of ids.slice(0, 4)) responses[id] = "skip";
  responses[ids[4]] = "na";
  const m = ref.scoreAxis(bank, responses, "money");
  assert.equal(m.answered, 11);
  assert.equal(m.skipped, 4);
  assert.equal(m.notApplicable, 1);
  assert.equal(m.unusable, true);
  // 답하지 않은 문항(키 없음)은 건너뜀으로 세지 않는다
  const none = ref.scoreAxis(bank, {}, "support");
  assert.equal(none.skipped, 0);
  assert.equal(none.notApplicable, 0);
  assert.equal(none.answered, 0);
  assert.equal(none.unusable, true);
});

test("동점 사슬 1에서 5단계", () => {
  const eq = (plan, selfCell) => ref.scoreAxis(bank, fullResponses({ money: plan }, selfCell === undefined ? {} : { money: selfCell }), "money");
  // 1단계: 고르기 합의 부호. 측면 합 (4, -4, 4, -4) 로 N = 0
  const l1 = eq({ facetSums: [4, -4, 4, -4], chooseSum: 4 });
  assert.equal(l1.weighted, 0);
  assert.equal(l1.tieLevel, 1);
  assert.equal(l1.side, "front");
  assert.equal(l1.band, "even");
  assert.equal(l1.provisional, false);
  const l1b = eq({ facetSums: [4, -4, 4, -4], chooseSum: -4 });
  assert.equal(l1b.tieLevel, 1);
  assert.equal(l1b.side, "back");
  assert.equal(l1b.letter, "S");
  // 2단계: 고르기 합이 0 이면 이럴 때 합의 부호
  const l2 = eq({ facetSums: [4, -4, 4, -4], chooseSum: 0, reactSum: -3 });
  assert.equal(l2.tieLevel, 2);
  assert.equal(l2.side, "back");
  const l2b = eq({ facetSums: [4, -4, 4, -4], chooseSum: 0, reactSum: 6 });
  assert.equal(l2b.tieLevel, 2);
  assert.equal(l2b.side, "front");
  // 3단계: 측면 다수결(합 0 측면은 뺀다). 측면 합 (2, 2, 2, -6) -> 양 3 대 음 1
  const l3 = eq({ facetSums: [2, 2, 2, -6], chooseSum: 0, reactSum: 0 });
  assert.equal(l3.weighted, 0);
  assert.equal(l3.tieLevel, 3);
  assert.equal(l3.side, "front");
  const l3b = eq({ facetSums: [-2, -2, 6, -2], chooseSum: 0, reactSum: 0 });
  assert.equal(l3b.tieLevel, 3);
  assert.equal(l3b.side, "back");
  // 합 0 측면은 다수결에서 뺀다: (2, 0, 0, -2) 는 1 대 1 이라 3단계에서 갈리지 않는다
  const l3c = eq({ facetSums: [2, 0, 0, -2], chooseSum: 0, reactSum: 0 });
  assert.ok(l3c.tieLevel >= 4);
  // 4단계: 측면 부호가 2 대 2 이면 자기 선택. 위 카드(칸 0)는 money 의 앞극 카드다.
  const l4 = eq({ facetSums: [4, -4, 4, -4], chooseSum: 0, reactSum: 0 }, 5);
  assert.equal(l4.tieLevel, 4);
  assert.equal(l4.side, "back");
  assert.equal(l4.letter, "S");
  const l4b = eq({ facetSums: [4, -4, 4, -4], chooseSum: 0, reactSum: 0 }, 0);
  assert.equal(l4b.tieLevel, 4);
  assert.equal(l4b.side, "front");
  // 5단계: 자기 선택도 없으면 앞 글자를 임시로
  const l5 = eq({ facetSums: [4, -4, 4, -4], chooseSum: 0, reactSum: 0 });
  assert.equal(l5.tieLevel, 5);
  assert.equal(l5.side, "front");
  assert.equal(l5.letter, "V");
  assert.equal(l5.provisional, true);
  assert.equal(l5.band, "even");
  // 자기 선택을 건너뛴 것과 안 한 것은 같다
  const responses = fullResponses({ money: { facetSums: [4, -4, 4, -4], chooseSum: 0, reactSum: 0 } });
  responses["self.money"] = "na";
  assert.equal(ref.scoreAxis(bank, responses, "money").tieLevel, 5);
});

test("정확한 동점은 N 이 0 일 때만 사슬을 쓴다(N 이 0 이 아니면 tieLevel 0)", () => {
  for (const total of [1, -1, 2, -2]) {
    const s = ref.scoreAxis(bank, fullResponses({ money: { facetSums: [total, 0, 0, 0], chooseSum: 4 } }), "money");
    assert.equal(s.tieLevel, 0);
    assert.equal(s.side, total > 0 ? "front" : "back");
  }
});

// ---------------------------------------------------------------------------
// 4. 위치 반복 검사, 건너뜀 힌트, 관문
// ---------------------------------------------------------------------------

/** 화면 위치 열을 정해 한 묶음(family)의 모든 문항에 그 위치의 저장값을 넣는다. */
function withViewPositions(base, family, formBit, positionOf) {
  const responses = { ...base };
  let index = 0;
  for (const item of bank.scored) {
    if (ref.familyOf(item.fmt) !== family) continue;
    const pos = positionOf(index);
    index += 1;
    if (pos === "skip" || pos === "na") {
      responses[item.id] = pos;
      continue;
    }
    const view = family === "pair" ? { fmt: "pair", cell: pos === 0 ? 0 : 5 } : family === "react" ? { fmt: "react", cell: pos } : { fmt: item.fmt, option: pos };
    responses[item.id] = ref.viewToStored(item, formBit, view);
  }
  return responses;
}

function baselineResponses() {
  // 세 묶음 모두 위치가 흩어져 있는 응답(무작위 시드 하나)
  const r = ref.randomRespondent(bank, 4242, { mode: "uniform", skipRate: 0, naRate: 0, formBit: 0 });
  return r.responses;
}

test("위치 반복: pair 는 16개 중 15개가 같은 화면 위치면 표시(15/16), 14개면 표시하지 않는다", () => {
  for (const formBit of [0, 1]) {
    const base = baselineResponses();
    const pos15 = withViewPositions(base, "pair", formBit, (i) => (i === 7 ? 1 : 0));
    const rep15 = ref.rhythmReport(bank, formBit, pos15);
    const pair15 = rep15.formats.find((f) => f.family === "pair");
    assert.equal(pair15.considered, 16);
    assert.equal(pair15.agree, 15);
    assert.equal(pair15.flagged, true);
    const pos14 = withViewPositions(base, "pair", formBit, (i) => (i === 3 || i === 9 ? 1 : 0));
    const pair14 = ref.rhythmReport(bank, formBit, pos14).formats.find((f) => f.family === "pair");
    assert.equal(pair14.agree, 14);
    assert.equal(pair14.period, 1);
    assert.equal(pair14.flagged, false);
    // 늘 같은 위치는 폼 비트와 무관하게 표시(저장값은 다르다)
    const all = withViewPositions(base, "pair", formBit, () => 0);
    assert.equal(ref.rhythmReport(bank, formBit, all).formats[0].flagged, true);
  }
  const zeros = withViewPositions(baselineResponses(), "pair", 0, () => 0);
  const ones = withViewPositions(baselineResponses(), "pair", 1, () => 0);
  assert.notDeepEqual(zeros, ones, "같은 화면 위치라도 폼 비트가 다르면 저장값이 다르다");
});

test("위치 반복: react 와 choose 는 14/16 이상이면 표시(정수 비교)", () => {
  const base = baselineResponses();
  // 16개 중 differing 자리만 위치 1, 나머지는 위치 3 (react 는 칸 3, choose 는 보기 3)
  const build = (family, differing) => withViewPositions(base, family, 0, (i) => (differing.includes(i) ? 1 : 3));
  for (const family of ["react", "choose"]) {
    const report = (differing) => ref.rhythmReport(bank, 0, build(family, differing)).formats.find((f) => f.family === family);
    const fourteen = report([2, 11]);
    assert.equal(fourteen.considered, 16);
    assert.equal(fourteen.agree, 14);
    assert.equal(fourteen.flagged, true, `${family} 14/16`);
    const thirteen = report([2, 6, 11]);
    assert.equal(thirteen.agree, 13);
    assert.equal(thirteen.flagged, false, `${family} 13/16`);
  }
  // pair 는 임계가 더 엄격하다: 같은 14/16 이 pair 에서는 표시가 아니다
  const pairFourteen = ref.rhythmReport(bank, 0, withViewPositions(base, "pair", 0, (i) => ([2, 11].includes(i) ? 1 : 0))).formats[0];
  assert.equal(pairFourteen.agree, 14);
  assert.equal(pairFourteen.flagged, false);
});

/** 설계 분석 스크립트(design/workF/analyze.js)의 bestPeriodAgreement 를 그대로 옮긴 독립 계산. */
function designBestPeriodAgreement(seq, maxP = 4) {
  const n = seq.length;
  let best = 0;
  for (let p = 1; p <= maxP; p += 1) {
    let agree = 0;
    for (let c = 0; c < p; c += 1) {
      const cnt = {};
      let m = 0;
      for (let i = c; i < n; i += p) {
        cnt[seq[i]] = (cnt[seq[i]] || 0) + 1;
        m = Math.max(m, cnt[seq[i]]);
      }
      agree += m;
    }
    best = Math.max(best, agree / n);
  }
  return best;
}

test("위치 반복 검사가 설계 분석 스크립트의 일치도와 표시 판정에서 같다(무작위 위치 열 1500개)", () => {
  const rng = ref.mulberry32(20260929);
  const th = { pair: 15 / 16 - 1e-9, react: 14 / 16 - 1e-9, choose: 14 / 16 - 1e-9 };
  const width = { pair: 2, react: 5, choose: 4 };
  const base = baselineResponses();
  let flaggedSeen = 0;
  let notFlaggedSeen = 0;
  for (const family of ["pair", "react", "choose"]) {
    for (let t = 0; t < 500; t += 1) {
      // 기본 주기 패턴 하나에 일정 비율만 다른 값을 섞어 임계 근처를 고르게 훑는다.
      const period = 1 + Math.floor(rng() * 4);
      const pattern = Array.from({ length: period }, () => Math.floor(rng() * width[family]));
      const noise = rng() * 0.45;
      const seq = Array.from({ length: 16 }, (_, i) => (rng() < noise ? Math.floor(rng() * width[family]) : pattern[i % period]));
      const formBit = rng() < 0.5 ? 0 : 1;
      const responses = withViewPositions(base, family, formBit, (i) => seq[i]);
      const report = ref.rhythmReport(bank, formBit, responses).formats.find((f) => f.family === family);
      const expected = designBestPeriodAgreement(seq);
      assert.equal(report.considered, 16);
      assert.ok(Math.abs(report.agree / 16 - expected) < 1e-12, `${family} ${seq.join("")}: ${report.agree}/16 대 ${expected}`);
      assert.equal(report.flagged, expected >= th[family], `${family} ${seq.join("")}`);
      if (report.flagged) flaggedSeen += 1;
      else notFlaggedSeen += 1;
    }
  }
  assert.ok(flaggedSeen > 200 && notFlaggedSeen > 200, `표시 ${flaggedSeen}, 비표시 ${notFlaggedSeen}`);
});

test("위치 반복: 답이 12개 미만이면 검사하지 않고, 건너뜀과 해당 없음은 빼고 순서를 이어 붙인다", () => {
  const base = baselineResponses();
  // pair 16개 중 5개를 건너뛰면 11개 -> 검사 안 함
  const few = withViewPositions(base, "pair", 0, (i) => (i < 5 ? "skip" : 0));
  const pairFew = ref.rhythmReport(bank, 0, few).formats[0];
  assert.equal(pairFew.considered, 11);
  assert.equal(pairFew.period, null);
  assert.equal(pairFew.agree, 0);
  assert.equal(pairFew.flagged, false);
  // 4개를 건너뛰면 12개 -> 검사, 늘 같은 위치라 표시
  const twelve = withViewPositions(base, "pair", 0, (i) => (i < 4 ? "na" : 0));
  const pairTwelve = ref.rhythmReport(bank, 0, twelve).formats[0];
  assert.equal(pairTwelve.considered, 12);
  assert.equal(pairTwelve.flagged, true);
  // 번갈아 누르면 주기 2 로 표시
  const alt = withViewPositions(base, "pair", 0, (i) => i % 2);
  const pairAlt = ref.rhythmReport(bank, 0, alt).formats[0];
  assert.equal(pairAlt.period, 2);
  assert.equal(pairAlt.agree, 16);
  assert.equal(pairAlt.flagged, true);
  // 주기 3 은 검사 범위(1~4) 안이라 표시: 0 0 1 0 0 1 ...
  const three = withViewPositions(base, "pair", 0, (i) => (i % 3 === 2 ? 1 : 0));
  assert.equal(ref.rhythmReport(bank, 0, three).formats[0].flagged, true);
  // 주기 5 는 4 이하 주기로는 못 잡는다
  const five = withViewPositions(base, "pair", 0, (i) => [0, 1, 1, 0, 1][i % 5]);
  assert.equal(ref.rhythmReport(bank, 0, five).formats[0].flagged, false);
});

test("표시 2개 형식이면 세기를 한 단계 낮추고, 3개 형식이면 코드를 만들지 않는다", () => {
  const base = ref.randomRespondent(bank, 777, { mode: "persona", skipRate: 0, naRate: 0, formBit: 0, spread: 3 }).responses;
  const clean = ref.buildResult(bank, 0, base);
  assert.equal(clean.rhythm.flaggedCount, 0);
  assert.equal(clean.notes.demoted, false);
  let two = withViewPositions(base, "pair", 0, () => 0);
  two = withViewPositions(two, "react", 0, () => 2);
  const rTwo = ref.buildResult(bank, 0, two);
  assert.equal(rTwo.rhythm.flaggedCount, 2);
  assert.equal(rTwo.notes.hintRhythm, true);
  assert.equal(rTwo.notes.demoted, true);
  assert.equal(rTwo.gate.closed, false);
  for (const a of rTwo.axes) if (a.band !== null) assert.equal(a.shownBand, ref.demoteBand(a.band));
  let three = withViewPositions(two, "choose", 0, () => 1);
  three = { ...three };
  const rThree = ref.buildResult(bank, 0, three);
  assert.equal(rThree.rhythm.flaggedCount, 3);
  assert.deepEqual(rThree.gate, { closed: true, reason: "rhythm" });
  assert.equal(rThree.code, null);
});

test("건너뜀 힌트: 잘 모르겠어요가 16개를 넘으면(17개부터) 세기를 한 단계 낮춘다, 해당 없음은 세지 않는다", () => {
  const base = ref.randomRespondent(bank, 991, { mode: "persona", skipRate: 0, naRate: 0, formBit: 0, spread: 3 }).responses;
  const ids = bank.scored.map((it) => it.id);
  const withSkips = (n, kind) => {
    const r = { ...base };
    for (const id of ids.slice(0, n)) r[id] = kind;
    return r;
  };
  assert.equal(ref.skippedCount(bank, withSkips(16, "skip")), 16);
  assert.equal(ref.skipHint(bank, withSkips(16, "skip")), false);
  assert.equal(ref.skipHint(bank, withSkips(17, "skip")), true);
  assert.equal(ref.skipHint(bank, withSkips(40, "na")), false);
  assert.equal(ref.buildResult(bank, 0, withSkips(17, "skip")).notes.hintSkip, true);
  // 두 힌트가 겹쳐도 한 단계만 낮춘다
  let both = withViewPositions(withSkips(17, "skip"), "react", 0, () => 2);
  both = withViewPositions(both, "pair", 0, () => 0);
  const r = ref.buildResult(bank, 0, both);
  assert.equal(r.notes.demoted, true);
  for (const a of r.axes) if (a.band !== null) assert.equal(a.shownBand, ref.demoteBand(a.band));
});

test("전체 결과의 건너뜀 힌트는 16개까지 걸리지 않고 17개부터 세기를 한 단계 낮춘다(뚜렷해요 -> 기울어요 -> 반반이에요)", () => {
  // 기준 계산기의 demoteBand 를 정답으로 삼지 않고 낮춘 결과를 손으로 적은 값과 견준다.
  assert.equal(ref.demoteBand("clear"), "lean");
  assert.equal(ref.demoteBand("lean"), "even");
  assert.equal(ref.demoteBand("even"), "even");
  const skipsFrom = (facetSums, n) => {
    const responses = fullResponses({ money: { facetSums } });
    for (const item of bank.scored.filter((it) => it.axis !== "money").slice(0, n)) responses[item.id] = "skip";
    return responses;
  };
  for (const [facetSums, band, lowered] of [[[12, 12, 12, 12], "clear", "lean"], [[6, 6, 6, 6], "lean", "even"]]) {
    const at16 = ref.buildResult(bank, 0, skipsFrom(facetSums, 16));
    assert.equal(at16.notes.skippedCount, 16);
    assert.equal(at16.notes.hintSkip, false, `${band} 16개`);
    assert.equal(at16.notes.demoted, false);
    assert.equal(at16.axes[0].band, band);
    assert.equal(at16.axes[0].shownBand, band);
    const at17 = ref.buildResult(bank, 0, skipsFrom(facetSums, 17));
    assert.equal(at17.notes.skippedCount, 17);
    assert.equal(at17.notes.hintSkip, true, `${band} 17개`);
    assert.equal(at17.notes.demoted, true);
    assert.equal(at17.axes[0].band, band);
    assert.equal(at17.axes[0].shownBand, lowered);
  }
});

test("관문: 확정 글자가 하나도 없으면(모두 임시이거나 못 정함) 코드를 만들지 않는다", () => {
  const tie = { facetSums: [4, -4, 4, -4], chooseSum: 0, reactSum: 0 };
  const allTie = fullResponses({ money: tie, process: tie, scope: tie, support: tie });
  const closed = ref.buildResult(bank, 0, allTie);
  assert.deepEqual(closed.axes.map((a) => a.tieLevel), [5, 5, 5, 5]);
  assert.deepEqual(closed.gate, { closed: true, reason: "noInformation" });
  assert.equal(closed.code, null);
  // 한 주제만 확정이면 열리고, 임시 글자와 못 정한 자리가 코드에 그대로 적힌다
  const one = fullResponses({ money: { facetSums: [8, 8, 8, 8] }, process: tie }, {});
  const open = ref.buildResult(bank, 0, one);
  assert.equal(open.gate.closed, false);
  assert.equal(open.code, "VW··");
  assert.deepEqual(open.notes.unusableAxes, ["scope", "support"]);
  assert.deepEqual(open.notes.provisionalAxes, ["process"]);
  assert.equal(open.axes[1].shownBand, "even");
});

test("직접 고른 쪽 대비: 답이 모인 쪽과 다르고 세기가 뚜렷/기울어요이며 자기 선택이 꽤 이상일 때만", () => {
  const strongFront = { facetSums: [12, 12, 12, 12] }; // 합 48 -> 뚜렷해요, 앞 글자
  const contrast = (cell) => ref.buildResult(bank, 0, fullResponses({ money: strongFront }, { money: cell })).axes[0].contrast;
  // self.money: 칸 0 = 앞극 아주, 칸 5 = 뒤극 아주, 칸 3 = 뒤극 조금, 칸 4 = 뒤극 꽤
  const c5 = contrast(5);
  assert.deepEqual(c5, { axis: "money", selfSide: "back", selfLetter: "S", selfLevel: 3, gatheredSide: "front", gatheredLetter: "V", gatheredBand: "clear" });
  assert.equal(contrast(4).selfLevel, 2);
  assert.equal(contrast(3), null, "조금은 대비로 보이지 않는다");
  assert.equal(contrast(0), null, "같은 쪽이면 대비가 없다");
  assert.equal(ref.buildResult(bank, 0, fullResponses({ money: strongFront })).axes[0].contrast, null, "자기 선택을 건너뛰면 없다");
  const evenFront = ref.buildResult(bank, 0, fullResponses({ money: { facetSums: [1, 1, 1, 1] } }, { money: 5 })).axes[0];
  assert.equal(evenFront.shownBand, "even");
  assert.equal(evenFront.contrast, null, "반반이에요 자리에는 대비가 없다");
});

test("품질 안내: 건너뛴 질문이 있으면 hasOmitted", () => {
  const r = ref.buildResult(bank, 0, fullResponses({ money: { facetSums: [4, 4, 4, 4] } }));
  assert.equal(r.notes.hasOmitted, true);
  assert.equal(r.notes.skippedCount, 0);
  assert.equal(r.notes.notApplicableCount, 48);
  const full = ref.randomRespondent(bank, 3, { mode: "uniform", skipRate: 0, naRate: 0 });
  const rf = ref.buildResult(bank, full.formBit, full.responses);
  assert.equal(rf.notes.hasOmitted, false);
  assert.equal(rf.notes.skippedCount, 0);
});

// ---------------------------------------------------------------------------
// 5. 정적 균형(고정 응답은 정확히 0)
// ---------------------------------------------------------------------------

test("고정 응답과 위치 함수 응답의 형식별 합이 폼 비트 0, 1 모두에서 정확히 0", () => {
  const result = ref.checkStaticBalance({ items: bank.items, layout });
  assert.ok(result.checks > 6000, `시험 ${result.checks}건`);
  assert.deepEqual(result.violations, []);
});

test("한 문항의 극을 뒤집으면 정적 균형 시험이 그 축과 형식에서 0 이 아닌 합을 찾는다", () => {
  const items = structuredClone(bank.items);
  const pair = items.find((it) => it.id === "money.limit.1");
  pair.cards = [pair.cards[1], pair.cards[0]]; // 극 배열이 뒤집힘(키는 그대로)
  const result = ref.checkStaticBalance({ items, layout });
  assert.ok(result.violations.length > 0);
  assert.ok(result.violations.every((v) => v.axis === "money"));
  assert.ok(result.violations.some((v) => v.kind === "fixed" && v.group === "pair" && v.sum !== 0));
  assert.ok(result.violations.some((v) => v.kind === "class"));
});

test("보기 세기 하나를 바꿔도 잡는다(약한 보기를 강한 보기로)", () => {
  const items = structuredClone(bank.items);
  const recall = items.find((it) => it.id === "process.owner.3");
  recall.options[2].strength = "strong";
  const result = ref.checkStaticBalance({ items, layout });
  assert.ok(result.violations.some((v) => v.axis === "process" && v.group === "recall"));
});

test("칸 나누기 항목의 극을 서로 바꾸면 잡는다", () => {
  const items = structuredClone(bank.items);
  const split = items.find((it) => it.id === "support.give.3");
  [split.entries[0].pole, split.entries[1].pole] = [split.entries[1].pole, split.entries[0].pole];
  const result = ref.checkStaticBalance({ items, layout });
  assert.ok(result.violations.some((v) => v.axis === "support" && v.group === "split"));
});

test("극 배열에서 키를 파생한다", () => {
  for (const item of bank.items) assert.equal(ref.derivedKey(item), layout.find((r) => r.id === item.id).key, item.id);
  const item = structuredClone(bank.byId.get("money.limit.3"));
  item.options.reverse();
  assert.equal(ref.derivedKey(item), null);
});

// ---------------------------------------------------------------------------
// 6. 시드 응답자와 코덱
// ---------------------------------------------------------------------------

test("시드 응답자는 결정적이고 68개를 모두 채우며 화면 답이 저장값으로 왕복한다", () => {
  const a = ref.randomRespondent(bank, 12345);
  const b = ref.randomRespondent(bank, 12345);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.responses, ref.randomRespondent(bank, 12346).responses);
  assert.equal(Object.keys(a.responses).length, 68);
  for (const item of bank.items) {
    assert.ok(ref.isResponseValueFor(item.fmt, a.responses[item.id]), item.id);
    assert.equal(ref.viewToStored(item, a.formBit, a.views[item.id]), a.responses[item.id], item.id);
  }
  assert.deepEqual(ref.randomRespondent(bank, 5, { formBit: 1 }).formBit, 1);
  const mt = ref.mulberry32(20260929);
  const first = [mt(), mt(), mt()];
  const again = ref.mulberry32(20260929);
  assert.deepEqual([again(), again(), again()], first);
  assert.ok(first.every((x) => x >= 0 && x < 1));
});

test("링크 코드: 시드 응답자 2000명이 왕복하고, 링크와 결과가 폼 비트로 흔들리지 않는다", () => {
  let withSkip = 0;
  let withNa = 0;
  let forms = [0, 0];
  const seenFmt = new Set();
  for (let seed = 1; seed <= 2000; seed += 1) {
    const respondent = ref.randomRespondent(bank, seed, { mode: seed % 3 === 0 ? "uniform" : "persona", skipRate: seed % 7 === 0 ? 0.3 : 0.04, naRate: 0.03 });
    const code = ref.encodeCode(bank, respondent.formBit, respondent.responses);
    assert.equal(typeof code, "string", `seed ${seed}`);
    assert.equal(code.length, 70);
    assert.equal(code[0], String(respondent.formBit));
    const decoded = ref.decodeCode(bank, code);
    assert.ok(decoded, `seed ${seed}`);
    assert.equal(decoded.formBit, respondent.formBit);
    assert.deepEqual(decoded.responses, respondent.responses, `seed ${seed}`);
    assert.equal(ref.encodeCode(bank, decoded.formBit, decoded.responses), code);
    forms[respondent.formBit] += 1;
    if (Object.values(respondent.responses).includes("skip")) withSkip += 1;
    if (Object.values(respondent.responses).includes("na")) withNa += 1;
    for (const item of bank.items) seenFmt.add(`${item.fmt}:${respondent.responses[item.id]}`);
    // 결과는 저장값에서만 나온다: 코드를 풀어도 같다
    assert.deepEqual(ref.buildResult(bank, decoded.formBit, decoded.responses), ref.buildResult(bank, respondent.formBit, respondent.responses));
  }
  assert.ok(forms[0] > 800 && forms[1] > 800, `폼 비트 분포 ${forms}`);
  assert.ok(withSkip > 300 && withNa > 300, `skip ${withSkip} na ${withNa}`);
  // 모든 형식의 모든 상태가 한 번 이상 나왔다
  for (const [fmt, n] of Object.entries(ref.STATE_COUNTS)) for (let s = 0; s < n; s += 1) assert.ok(seenFmt.has(`${fmt}:${ref.stateChar(s)}`), `${fmt} 상태 ${s}`);
});

test("체크섬 공식: T = 합 ((i mod 60) + 1) x v, 문자 = 알파벳[T mod 61]", () => {
  const respondent = ref.randomRespondent(bank, 99);
  const code = ref.encodeCode(bank, respondent.formBit, respondent.responses);
  const body = code.slice(0, 69);
  const v = (c) => (c === "-" ? 59 : c === "_" ? 60 : ref.ALPHABET.indexOf(c));
  let t = 0;
  for (let i = 0; i < 69; i += 1) t += ((i % 60) + 1) * v(body[i]);
  assert.equal(code[69], ref.ALPHABET[t % 61]);
  assert.equal(ref.checksumChar(body), code[69]);
  assert.throws(() => ref.checksumChar("0000?"), RangeError);
  // 계약 문서 예: 전부 0 인 본문의 체크섬은 0
  assert.equal(ref.checksumChar("0".repeat(69)), "0");
});

test("손상된 링크는 하나도 통과하지 못한다: 문자 한 개 바꾸기 전수, 인접 교환, 길이, 폼 비트, 위치별 범위", () => {
  const symbols = [...ref.ALPHABET, "-", "_", ".", " ", "가", "?", "="];
  let substitutions = 0;
  let checkedCodes = 0;
  for (let seed = 1; seed <= 24; seed += 1) {
    const respondent = ref.randomRespondent(bank, 5000 + seed, { mode: seed % 2 ? "uniform" : "persona", skipRate: 0.1, naRate: 0.05 });
    const code = ref.encodeCode(bank, respondent.formBit, respondent.responses);
    assert.ok(ref.decodeCode(bank, code));
    for (let i = 0; i < 70; i += 1) {
      for (const symbol of symbols) {
        if (symbol === code[i]) continue;
        const damaged = code.slice(0, i) + symbol + code.slice(i + 1);
        substitutions += 1;
        assert.equal(ref.decodeCode(bank, damaged), null, `seed ${seed} 위치 ${i} ${JSON.stringify(symbol)}`);
      }
    }
    // 인접 교환(다른 문자끼리)
    for (let i = 0; i < 69; i += 1) {
      if (code[i] === code[i + 1]) continue;
      const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      assert.equal(ref.decodeCode(bank, swapped), null, `seed ${seed} 교환 ${i}`);
    }
    assert.equal(ref.decodeCode(bank, code.slice(0, 69)), null);
    assert.equal(ref.decodeCode(bank, `${code}0`), null);
    assert.equal(ref.decodeCode(bank, ""), null);
    assert.equal(ref.decodeCode(bank, undefined), null);
    assert.equal(ref.decodeCode(bank, null), null);
    checkedCodes += 1;
  }
  assert.ok(substitutions > 100000, `한 문자 바꾸기 ${substitutions}건`);
  assert.equal(checkedCodes, 24);
});

test("위치별 범위는 체크섬과 따로 거절한다(체크섬을 맞춰도 범위 밖이면 거절)", () => {
  const respondent = ref.randomRespondent(bank, 31, { skipRate: 0, naRate: 0 });
  const code = ref.encodeCode(bank, respondent.formBit, respondent.responses);
  const forge = (index, ch) => {
    const body = code.slice(0, index) + ch + code.slice(index + 1, 69);
    return body + ref.checksumChar(body);
  };
  // 채점 문항 위치의 형식 범위
  const firstOf = (fmt) => bank.items.findIndex((it) => it.fmt === fmt) + 1;
  assert.ok(ref.decodeCode(bank, forge(firstOf("pair"), "5")));
  assert.equal(ref.decodeCode(bank, forge(firstOf("pair"), "6")), null);
  assert.ok(ref.decodeCode(bank, forge(firstOf("react"), "4")));
  assert.equal(ref.decodeCode(bank, forge(firstOf("react"), "5")), null);
  assert.ok(ref.decodeCode(bank, forge(firstOf("recall"), "3")));
  assert.equal(ref.decodeCode(bank, forge(firstOf("recall"), "4")), null);
  assert.ok(ref.decodeCode(bank, forge(firstOf("bestworst"), "b")));
  assert.equal(ref.decodeCode(bank, forge(firstOf("bestworst"), "c")), null);
  assert.ok(ref.decodeCode(bank, forge(firstOf("split"), "r")));
  assert.equal(ref.decodeCode(bank, forge(firstOf("split"), "s")), null);
  assert.equal(ref.decodeCode(bank, forge(firstOf("self"), "6")), null);
  // 폼 비트 문자
  for (const bad of ["2", "a", "-", "_"]) {
    const body = bad + code.slice(1, 69);
    assert.equal(ref.decodeCode(bank, body + ref.checksumChar(body)), null, `폼 비트 ${bad}`);
  }
  // 알파벳 밖 문자(체크섬 계산이 불가능한 문자)
  assert.equal(ref.decodeCode(bank, `${code.slice(0, 5)}.${code.slice(6)}`), null);
});

test("상태 문자가 하나도 없는 코드(전부 건너뜀 또는 해당 없음)는 만들지도 풀지도 않는다", () => {
  const all = (kind) => Object.fromEntries(bank.items.map((it) => [it.id, kind]));
  assert.equal(ref.encodeCode(bank, 0, all("skip")), null);
  assert.equal(ref.encodeCode(bank, 0, all("na")), null);
  const body = `0${"-".repeat(68)}`;
  assert.equal(ref.decodeCode(bank, body + ref.checksumChar(body)), null);
  const mixed = { ...all("skip"), "money.limit.1": "0" };
  const code = ref.encodeCode(bank, 1, mixed);
  assert.equal(typeof code, "string");
  assert.ok(ref.decodeCode(bank, code));
  // 하나라도 답하지 않은 문항이 있으면 만들지 않는다
  const partial = { ...mixed };
  delete partial["money.limit.2"];
  assert.equal(ref.encodeCode(bank, 1, partial), null);
  assert.equal(ref.encodeCode(bank, 2, mixed), null);
  assert.equal(ref.encodeCode(bank, 0, { ...mixed, "money.limit.1": "9" }), null);
});

test("링크 만들기와 읽기: 해시의 v, a, b", () => {
  const first = ref.randomRespondent(bank, 61);
  const second = ref.randomRespondent(bank, 62);
  const a = ref.encodeCode(bank, first.formBit, first.responses);
  const b = ref.encodeCode(bank, second.formBit, second.responses);
  const url1 = ref.buildShareUrl(bank, "https://hanbang.ai/", first);
  assert.equal(url1, `https://hanbang.ai/wedding-code#v=v4.0-tendency&a=${a}`);
  const url2 = ref.buildShareUrl(bank, "https://hanbang.ai", first, second);
  assert.equal(url2, `https://hanbang.ai/wedding-code#v=v4.0-tendency&a=${a}&b=${b}`);
  assert.equal(ref.buildShareUrl(bank, "https://hanbang.ai", { formBit: 0, responses: {} }), null);
  assert.equal(ref.buildShareUrl(bank, "https://hanbang.ai", first, { formBit: 0, responses: {} }), null);
  assert.equal(ref.buildQuestionOnlyUrl("https://hanbang.ai/"), "https://hanbang.ai/wedding-code?v=v4.0-tendency");
  assert.equal(ref.buildQuestionOnlyUrl("https://hanbang.ai", { explicitVersion: false }), "https://hanbang.ai/wedding-code");
  const hashOf = (url) => url.slice(url.indexOf("#"));
  const p1 = ref.parseShareHash(bank, hashOf(url1));
  assert.equal(p1.kind, "partner");
  assert.deepEqual(p1.first.responses, first.responses);
  const p2 = ref.parseShareHash(bank, hashOf(url2));
  assert.equal(p2.kind, "both");
  assert.deepEqual(p2.first.responses, first.responses);
  assert.deepEqual(p2.second.responses, second.responses);
  assert.equal(p2.second.formBit, second.formBit);
  // 없음
  for (const none of [null, undefined, "", "#", "#v=v4.0-tendency"]) assert.equal(ref.parseShareHash(bank, none).kind, "none", String(none));
  // 깨진 것: 한 사람 답만 살리거나 기본값을 채우지 않는다
  const invalid = [
    `#v=v4.0-tendency&b=${b}`, // b 만
    `#v=v4.0-tendency&a=${a}&b=${b.slice(0, 69)}`, // b 손상
    `#v=v4.0-tendency&a=${a.slice(0, 69)}&b=${b}`, // a 손상
    `#v=v4.0-tendency&a=${a}&a=${a}`, // 중복 키
    `#v=v4.0-tendency&a=${a}&c=1`, // 모르는 키
    `#v=v3.1-preferences&a=${a}`, // 다른 판
    `#a=${a}`, // 판 없음
    `#v=v4.0-tendency&a=`, // 빈 값
    `#v=v4.0-tendency&a`, // 값 없음
    "#garbage",
  ];
  for (const hash of invalid) assert.equal(ref.parseShareHash(bank, hash).kind, "invalid", hash);
  assert.deepEqual(ref.decodeShareParams(bank, null, null), { kind: "none" });
  assert.deepEqual(ref.decodeShareParams(bank, null, b), { kind: "invalid" });
  assert.equal(ref.decodeShareParams(bank, a, null).kind, "partner");
  assert.equal(ref.decodeShareParams(bank, a, "x").kind, "invalid");
});

test("여덟 글자는 서로 다르고 상태 글자(B M N ?)나 소문자가 없다", () => {
  const all = ref.AXES.flatMap((axis) => [ref.LETTER_OF[axis].front, ref.LETTER_OF[axis].back]);
  assert.equal(new Set(all).size, 8);
  assert.deepEqual([...all].sort(), ["A", "D", "F", "H", "S", "U", "V", "W"]);
  for (const letter of all) assert.match(letter, /^[A-Z]$/);
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = ref.randomRespondent(bank, seed);
    const result = ref.buildResult(bank, r.formBit, r.responses);
    if (result.code !== null) assert.match(result.code, /^[VS·][WD·][UF·][HA·]$/);
  }
});
