// wc64 계산 엔진. 원본(Claude outputs/wedding-code-v6-report-20261016/engine.js)을 그대로 옮겼다.
// 같은 답이면 늘 같은 결과다(무작위·시각 없음). 숫자는 원본과 한 자리도 다르지 않아야 한다(model.test.ts 가 대조).
// 원본과 일부러 다르게 한 곳은 둘이다: 이해도 단계 위치(knowledge 의 stage, 2026-10-16 감사 FIX-2)와
// 식 없이 한 사람의 GUESTS '다른 자리' 갈래를 없앤 것(2026-10-16 파운더 결정 DEC-1, bank.ts isWc64CeremonyOff).
// 축이 어느 묶음으로 계산되는지는 은행 dims.facets 가 정한다(2026-10-17 파운더 결정으로 SPEND 는 DAY·WEIGHT 둘, 문장 8개).
import {
  WC64_BANK, WC64_ITEMS, isWc64CeremonyOff, wc64DimById, wc64ItemById, wc64NoCeremonyName, wc64SectionById, wc64SectionIdOfItem,
  wc64TypeCard,
} from "./bank";
import {
  WC64_CEREMONY_TAG, WC64_NO_CEREMONY_ONLY_TAG, WC64_VERSION,
  type Wc64AnswerSide, type Wc64Answers, type Wc64AxisStat, type Wc64Dim, type Wc64DimId, type Wc64DimResult, type Wc64DimSkipReason,
  type Wc64FacetPos, type Wc64FacetResult, type Wc64FacetSkipReason, type Wc64Firmness, type Wc64Fund,
  type Wc64Glance, type Wc64Item, type Wc64Knowledge, type Wc64KnowledgeLevel, type Wc64KnowledgeLevelId,
  type Wc64KnowledgeSkipReason, type Wc64Letter, type Wc64LetterCard, type Wc64Level, type Wc64NextStep,
  type Wc64Pattern, type Wc64Plan, type Wc64Quote, type Wc64Rating, type Wc64Report, type Wc64ReportName,
  type Wc64SceneResult, type Wc64Section, type Wc64Skipped, type Wc64TieRule, type Wc64TypeCard,
} from "./types";

type Side = "X" | "Y";

export function isWc64Rating(v: unknown): v is Wc64Rating {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

const sum = (arr: readonly number[]) => arr.reduce((a, x) => a + x, 0);

/** 축 % : X쪽(앞 글자) 답과 Y쪽(뒷 글자) 답(1~5, 답한 것만). 한쪽이라도 비면 null. */
export function axis(xs: readonly number[], ys: readonly number[]): Wc64AxisStat | null {
  const nX = xs.length, nY = ys.length;
  if (!nX || !nY) return null;
  const SX = xs.reduce((a, x) => a + (x - 1), 0), SY = ys.reduce((a, y) => a + (y - 1), 0);
  const N = nY * SX - nX * SY;
  const D = nX * nY;
  const exact = 50 + 12.5 * N / D;
  const winner = N > 0 ? "X" : N < 0 ? "Y" : "T";
  const shown = displayPct(Math.abs(N), D);
  return {
    nX, nY, SX, SY, N, exact, winner, shown,
    agreeX: Math.round(SX / (4 * nX) * 100), agreeY: Math.round(SY / (4 * nY) * 100),
  };
}

/** 이긴 쪽 값 = 50 + 25|N|/(2D). 가장 가까운 정수, 딱 .5면 50 쪽, N≠0인데 50이면 51. */
export function displayPct(absN: number, D: number): number {
  if (absN === 0) return 50;
  const num = 100 * D + 25 * absN, den = 2 * D;
  let f = Math.floor(num / den);
  const rem = num - f * den;
  if (2 * rem > den) f += 1;
  if (f === 50) f = 51;
  return f;
}

function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) { out.push(acc.slice()); return }
    for (let i = start; i < n; i++) { acc.push(i); pick(i + 1, acc); acc.pop() }
  };
  pick(0, []);
  return out;
}

/**
 * 글자 단단함: 문장 절반 다시 계산(모든 조합) + 반반이 되거나 반대 글자로 넘어가기까지 옮길 칸 수.
 * R 은 원본 그대로(같은 글자 1, 반반 0.5 로 센 합 ÷ 경우 수)이고, 화면 문장에 쓸 수는 same·tie 로 따로 센다
 * (2026-10-17 심사 HON-1: 반반을 0.5 로 센 agree 를 '~가지에서 나와요'로 보이면 수가 부풀었다).
 */
export function firmness(xs: readonly number[], ys: readonly number[], N: number): Wc64Firmness {
  const kX = Math.ceil(xs.length / 2), kY = Math.ceil(ys.length / 2);
  const cx = combos(xs.length, kX), cy = combos(ys.length, kY);
  const sx = cx.map(c => c.reduce((a, i) => a + xs[i] - 1, 0)), sy = cy.map(c => c.reduce((a, i) => a + ys[i] - 1, 0));
  let score = 0, total = 0, same = 0, tie = 0;
  const pcts: number[] = [];
  for (const a of sx) for (const b of sy) {
    const n2 = kY * a - kX * b;
    total++;
    if (n2 === 0) tie++;
    else if (N !== 0 && Math.sign(n2) === Math.sign(N)) same++;
    if (N === 0) score += n2 === 0 ? 1 : 0.5;
    else if (Math.sign(n2) === Math.sign(N)) score += 1;
    else if (n2 === 0) score += 0.5;
    pcts.push(50 + 12.5 * n2 / (kX * kY));
  }
  pcts.sort((p, q) => p - q);
  const q = (f: number) => pcts[Math.min(pcts.length - 1, Math.max(0, Math.floor(f * (pcts.length - 1))))];
  let dist = 0;
  if (N !== 0) {
    const nX = xs.length, nY = ys.length;
    const toward = N > 0;
    // N>0: X 답 내리기(칸당 nY 감소, 여유 = x-1), Y 답 올리기(칸당 nX 감소, 여유 = 5-y)
    const capX = toward ? xs.reduce((a, x) => a + (x - 1), 0) : xs.reduce((a, x) => a + (5 - x), 0);
    const capY = toward ? ys.reduce((a, y) => a + (5 - y), 0) : ys.reduce((a, y) => a + (y - 1), 0);
    let need = Math.abs(N);
    const steps = [{ v: nY, cap: capX }, { v: nX, cap: capY }].sort((p, q2) => q2.v - p.v);
    for (const st of steps) {
      if (need <= 0) break;
      const use = Math.min(st.cap, Math.ceil(need / st.v));
      dist += use; need -= use * st.v;
    }
    if (need > 0) dist = Infinity;
  }
  return { agree: Math.round(score), same, tie, total, R: score / total, dist, band: [q(0.1), q(0.9)] };
}

export function level(N: number, f: Pick<Wc64Firmness, "R" | "dist">, n: number): Wc64Level {
  if (N === 0) return "half";
  if (f.R >= 0.9 && f.dist >= 5 && n >= 8) return "clear";
  if (f.R >= 0.7 && f.dist >= 3) return "lean";
  return "slight";
}

/** 동점일 때 글자와 그 글자를 정한 규칙(정수 교차곱 비교, 계약 §3.3 순서) */
export function tieBreakRule(
  xs: readonly number[], ys: readonly number[], facetLeans?: { X: number; Y: number },
): { side: Side; rule: Wc64TieRule } {
  const cmp = (a: number, na: number, b: number, nb: number) => a * nb - b * na;
  const c5 = cmp(xs.filter(x => x === 5).length, xs.length, ys.filter(y => y === 5).length, ys.length);
  if (c5) return { side: c5 > 0 ? "X" : "Y", rule: "five" };
  const c4 = cmp(xs.filter(x => x >= 4).length, xs.length, ys.filter(y => y >= 4).length, ys.length);
  if (c4) return { side: c4 > 0 ? "X" : "Y", rule: "agree" };
  const c2 = cmp(xs.filter(x => x <= 2).length, xs.length, ys.filter(y => y <= 2).length, ys.length);
  if (c2) return { side: c2 < 0 ? "X" : "Y", rule: "disagree" };
  if (facetLeans && facetLeans.X !== facetLeans.Y) return { side: facetLeans.X > facetLeans.Y ? "X" : "Y", rule: "facet" };
  return { side: "X", rule: "default" };
}

/** 동점일 때 글자 정하기(원본 tieBreak). 규칙까지 필요하면 tieBreakRule 을 쓴다. */
export function tieBreak(xs: readonly number[], ys: readonly number[], facetLeans?: { X: number; Y: number }): Side {
  return tieBreakRule(xs, ys, facetLeans).side;
}

function facetLeansOf(facetRows: readonly Wc64FacetRow[]): { X: number; Y: number } {
  return {
    X: facetRows.filter(fr => fr.r && fr.r.N > 0).length,
    Y: facetRows.filter(fr => fr.r && fr.r.N < 0).length,
  };
}

export interface Wc64FacetRow { axis: string; a_is: "A" | "B"; fx: number[]; fy: number[]; r: Wc64AxisStat | null }
export type Wc64DimScore =
  | { decided: false; n: number; facetRows: Wc64FacetRow[] }
  | {
      decided: true; letter: Wc64Letter; letterSide: Side; tie: boolean; n: number; total: number;
      pctX: number; pctY: number; exact: number; agreeX: number; agreeY: number;
      firm: Wc64Firmness; level: Wc64Level; facetRows: Wc64FacetRow[];
    };

/** 한 축 전체 결과(원본 scoreDim). answers 는 계산에 넣을 답만 담아 넘긴다. */
export function scoreDim(dim: Wc64Dim, sections: readonly Wc64Section[], answers: Wc64Answers): Wc64DimScore {
  const xs: number[] = [], ys: number[] = [], facetRows: Wc64FacetRow[] = [];
  for (const f of dim.facets) {
    const sec = sections.find(s => s.id === f.axis);
    const fx: number[] = [], fy: number[] = [];
    for (const it of sec ? sec.items : []) {
      const v = answers[it.id];
      if (!isWc64Rating(v)) continue;
      const toX = it.pole === f.a_is;
      (toX ? fx : fy).push(v);
      (toX ? xs : ys).push(v);
    }
    const fr = fx.length && fy.length ? axis(fx, fy) : null;
    facetRows.push({ axis: f.axis, a_is: f.a_is, fx, fy, r: fr });
  }
  const n = xs.length + ys.length;
  const facetsWithBoth = facetRows.filter(r => r.r).length;
  if (n < 6 || xs.length < 2 || ys.length < 2 || facetsWithBoth < 2) return { decided: false, n, facetRows };
  const r = axis(xs, ys) as Wc64AxisStat;
  const f = firmness(xs, ys, r.N);
  let letterSide: Side;
  let tie = false;
  if (r.winner === "T") {
    tie = true;
    letterSide = tieBreak(xs, ys, facetLeansOf(facetRows));
  } else letterSide = r.winner;
  const letter = letterSide === "X" ? dim.letter_a : dim.letter_b;
  const pctX = r.N >= 0 ? r.shown : 100 - r.shown;
  return {
    decided: true, letter, letterSide, tie, n, total: dim.facets.length * 4, pctX, pctY: 100 - pctX,
    exact: r.exact, agreeX: r.agreeX, agreeY: r.agreeY, firm: f, level: level(r.N, f, n), facetRows,
  };
}

export interface Wc64KnowledgeScore {
  pct: number | null;
  levels: { L: Wc64KnowledgeLevelId; state: "pass" | "no" | "skip"; pct?: number }[];
  /** 이어서 통과한 마지막 단계의 번호(0~4) */
  stage: number;
  n: number;
  /** 멈춘 뒤에 통과한 단계 */
  passedLater: Wc64KnowledgeLevelId[];
}

/**
 * 이해도(원본 knowledge). pct 와 단계별 상태는 원본 그대로다.
 * 단계 위치만 원본과 다르다(2026-10-16 감사 FIX-2): 원본은 '통과한 단계 수'로 이름을 골라, 건너뛴(skip) 단계가 있으면
 * 이름이 한 칸씩 밀렸다(식을 안 올리면 L2 가 늘 skip 이라 L4 를 통과해도 '계약과 분쟁까지'). 지금은 L1부터 차례로 보며
 * skip 은 끊지 않고 건너뛰고, 처음 만난 '아직'(no)에서 멈추고, 그때까지 통과한 마지막 단계의 번호를 stage 로 쓴다.
 */
export function knowledge(items: readonly Pick<Wc64Item, "id" | "level">[], answers: Wc64Answers): Wc64KnowledgeScore {
  const got = items.filter(it => isWc64Rating(answers[it.id]));
  const val = (it: Pick<Wc64Item, "id">) => answers[it.id] as number;
  const s0 = got.reduce((a, it) => a + val(it) - 1, 0);
  // 가장 가까운 정수, .5 올림
  const total = got.length ? Math.floor((s0 * 100 * 2 + 4 * got.length) / (8 * got.length)) : null;
  const levels = (["L1", "L2", "L3", "L4"] as const).map(L => {
    const li = got.filter(it => it.level === L);
    if (!li.length) return { L, state: "skip" as const };
    const s = li.reduce((a, it) => a + val(it) - 1, 0);
    const p = Math.floor((s * 200 + 4 * li.length) / (8 * li.length));
    const mean4 = li.reduce((a, it) => a + val(it), 0) >= 4 * li.length;
    return { L, state: mean4 ? "pass" as const : "no" as const, pct: p };
  });
  let stage = 0, stopped = false;
  const passedLater: Wc64KnowledgeLevelId[] = [];
  levels.forEach((l, i) => {
    if (l.state === "skip") return;
    if (stopped) { if (l.state === "pass") passedLater.push(l.L); return }
    if (l.state === "pass") stage = i + 1; else stopped = true;
  });
  return { pct: total, levels, stage, n: got.length, passedLater };
}

/** 답 모양 알림: same = 같은 칸을 90% 이상, agree = 4·5 를 80% 이상 */
export function patterns(tendencyItems: readonly Pick<Wc64Item, "id">[], answers: Wc64Answers): Wc64Pattern[] {
  const vals = tendencyItems.map(it => answers[it.id]).filter(isWc64Rating);
  if (!vals.length) return [];
  const out: Wc64Pattern[] = [];
  const counts = [1, 2, 3, 4, 5].map(k => vals.filter(v => v === k).length);
  if (Math.max(...counts) / vals.length >= 0.9) out.push("same");
  if (vals.filter(v => v >= 4).length / vals.length >= 0.8) out.push("agree");
  return out;
}

/* ---------------- 리포트 조립(원본 HTML 의 compute·facetView·quotes 규칙) ---------------- */

/**
 * 계산에 넣을 답만 남긴다: 모르는 id 와 식 없이 해서 빠진 문항은 버린다.
 * 묶음 넘기기 상태는 받지 않는다(옛 '다른 자리' 갈래 때문에 받던 셋째 인자를 2026-10-17 심사 CQ-5로 지웠다, DEC-1).
 */
export function wc64ConsideredAnswers(answers: Wc64Answers, plan: Wc64Plan | null): Wc64Answers {
  const out: Wc64Answers = {};
  for (const it of WC64_ITEMS) {
    if (!Object.prototype.hasOwnProperty.call(answers, it.id)) continue;
    if (isWc64CeremonyOff(it.id, plan)) continue;
    const v = answers[it.id];
    if (v === 0 || isWc64Rating(v)) out[it.id] = v;
  }
  return out;
}

/** 식 계획 때문에 빠지지 않고 화면에 나오는 문항(묶음 넘기기는 보지 않는다) */
function keptItems(sec: Wc64Section, plan: Wc64Plan | null): Wc64Item[] {
  return sec.items.filter(it => !isWc64CeremonyOff(it.id, plan));
}

/**
 * 묶음 %를 내지 못한 까닭(계산에 넣을 답 answers 기준). 답과 식 계획만 보므로 답 코드로 받은 결과에서도 같다.
 * 본인이 고른 것을 먼저 본다(1단계 검토 지적: 식 없이 하는 사람이 남은 문장을 모두 '해당 없음'으로 골랐는데
 * '식을 안 올려서'라고 적던 것).
 * 1. skipped: 1~5 답이 하나도 없고, 묶음을 넘겼거나(skipped[sid] === true) 남은 문장을 모두 '해당 없음'(0)으로 골랐다.
 * 2. no-ceremony: 식 없이 해서 '예식' 문항이 빠지는 바람에 남은 문장이 한쪽 극뿐이거나 없다(다 답해도 %를 못 낸다).
 * 3. too-few: 그 밖.
 */
export function wc64FacetSkipReason(
  sectionId: string, plan: Wc64Plan | null, answers: Wc64Answers, skipped: Wc64Skipped = {},
): Wc64FacetSkipReason {
  const sec = wc64SectionById(sectionId);
  if (!sec) return "too-few";
  const kept = keptItems(sec, plan);
  if (!sec.items.some(it => isWc64Rating(answers[it.id]))) {
    if (skipped[sectionId] === true) return "skipped";
    if (kept.length > 0 && kept.every(it => answers[it.id] === 0)) return "skipped";
  }
  const bothPoles = kept.some(it => it.pole === "A") && kept.some(it => it.pole === "B");
  if (kept.length < sec.items.length && !bothPoles) return "no-ceremony";
  return "too-few";
}

/**
 * 식 계획만 보고, 남은 문장을 모두 답하면 이 축의 글자를 정할 수 있는가(§3.2 조건을 문항 수로 본다).
 * 식 없이 하면 CIRCLE(FORM·GUESTS 전부, EYES 전부가 '예식')과 SPEND(DAY·WEIGHT 전부가 '예식')가 false 다.
 */
export function wc64DimPossible(dim: Wc64Dim, plan: Wc64Plan | null): boolean {
  let x = 0, y = 0, both = 0;
  for (const f of dim.facets) {
    const sec = wc64SectionById(f.axis);
    const kept = sec ? keptItems(sec, plan) : [];
    const fx = kept.filter(it => it.pole === f.a_is).length, fy = kept.length - fx;
    x += fx; y += fy;
    if (fx && fy) both++;
  }
  return x + y >= 6 && x >= 2 && y >= 2 && both >= 2;
}

/**
 * 글자를 정하지 못한 까닭. 한눈에 보기·글자 장·비교 화면이 이 함수 하나를 같이 쓴다(답 코드로 받은 상대도 같은 값).
 * 1. no-ceremony: 식 없이 해서 남은 문장을 다 답해도 정할 수 없다(`wc64DimPossible` false). 앱이 뺀 것이라 먼저 본다.
 * 2. skipped: 이 축의 묶음 중 넘겼거나 모두 '해당 없음'으로 고른 것이 있다.
 * 3. too-few: 그 밖(답한 문장이 적다).
 * 글자가 정해진 축에 불러도 값은 돌려주지만 뜻이 없다.
 */
export function wc64DimSkipReason(
  dimId: Wc64DimId, plan: Wc64Plan | null, answers: Wc64Answers, skipped: Wc64Skipped = {},
): Wc64DimSkipReason {
  const dim = wc64DimById(dimId);
  if (!dim) return "too-few";
  if (!wc64DimPossible(dim, plan)) return "no-ceremony";
  if (dim.facets.some(f => wc64FacetSkipReason(f.axis, plan, answers, skipped) === "skipped")) return "skipped";
  return "too-few";
}

function facetView(row: Wc64FacetRow, letterSide: Side, reason: Wc64FacetSkipReason): Wc64FacetResult {
  const sec = wc64SectionById(row.axis) as Wc64Section;
  const xName = row.a_is === "A" ? sec.pole_a.name : sec.pole_b.name;
  const yName = row.a_is === "A" ? sec.pole_b.name : sec.pole_a.name;
  const base = { section: row.axis, title: sec.title, a_is: row.a_is, xName, yName, fx: row.fx, fy: row.fy };
  if (!row.r) return { ...base, decided: false, reason };
  const pctX = row.r.N >= 0 ? row.r.shown : 100 - row.r.shown;
  // 평균 4 이상 / 2 이하를 정수로 비교(원본은 평균을 소수로 비교, 결과는 같다)
  const sx = sum(row.fx), sy = sum(row.fy);
  let pos: Wc64FacetPos;
  if (Math.abs(row.r.exact - 50) <= 6.25) {
    pos = sx >= 4 * row.fx.length && sy >= 4 * row.fy.length ? "both-high"
      : sx <= 2 * row.fx.length && sy <= 2 * row.fy.length ? "both-low" : "mid";
  } else pos = (row.r.N > 0) === (letterSide === "X") ? "same" : "opp";
  return { ...base, decided: true, N: row.r.N, exact: row.r.exact, pctX, pctY: 100 - pctX, pos };
}

function quotes(dim: Wc64Dim, letterSide: Side, answers: Wc64Answers): { pro: Wc64Quote[]; con: Wc64Quote[] } {
  const scale = WC64_BANK.meta.scale;
  const rows: Wc64Quote[] = [];
  for (const f of dim.facets) {
    const sec = wc64SectionById(f.axis);
    for (const it of sec ? sec.items : []) {
      const v = answers[it.id];
      if (!isWc64Rating(v)) continue;
      const toX = it.pole === f.a_is;
      rows.push({ itemId: it.id, text: it.text, value: v, label: scale[v - 1], towardX: toX ? v : 6 - v });
    }
  }
  const score = (r: Wc64Quote) => letterSide === "X" ? r.towardX : 6 - r.towardX;
  const sorted = rows.slice().sort((a, b) => score(b) - score(a) || b.value - a.value);
  const pro = sorted.filter(r => score(r) >= 4).slice(0, 2);
  const con = sorted.slice().reverse().filter(r => score(r) <= 2).slice(0, 1);
  return { pro, con };
}

function dimResult(dim: Wc64Dim, plan: Wc64Plan | null, answers: Wc64Answers, skipped: Wc64Skipped): Wc64DimResult {
  const s = scoreDim(dim, WC64_BANK.sections, answers);
  const total = dim.facets.length * 4;
  if (!s.decided) {
    return {
      dim: dim.id, decided: false, reason: wc64DimSkipReason(dim.id, plan, answers, skipped),
      n: s.n, total, facets: [],
    };
  }
  // scoreDim 은 원본과 같은 모양을 지키고, 동점 규칙은 같은 답(묶음 순서로 이은 xs·ys)으로 다시 물어 얻는다.
  const tieRule = s.tie
    ? tieBreakRule(s.facetRows.flatMap(fr => fr.fx), s.facetRows.flatMap(fr => fr.fy), facetLeansOf(s.facetRows)).rule
    : null;
  return {
    dim: dim.id, decided: true, letter: s.letter, letterSide: s.letterSide, tie: s.tie, tieRule, n: s.n, total: s.total,
    pctX: s.pctX, pctY: s.pctY, letterPct: s.letterSide === "X" ? s.pctX : s.pctY, exact: s.exact,
    agreeX: s.agreeX, agreeY: s.agreeY, firm: s.firm, level: s.level,
    cappedByN: s.level === "lean" && s.firm.R >= 0.9 && s.firm.dist >= 5 && s.n < 8,
    band: s.firm.band,
    facets: s.facetRows.map(row => facetView(row, s.letterSide, wc64FacetSkipReason(row.axis, plan, answers, skipped))),
    quotes: quotes(dim, s.letterSide, answers),
  };
}

function knowledgeSkipReason(items: readonly Wc64Item[], plan: Wc64Plan | null, answers: Wc64Answers): Wc64KnowledgeSkipReason {
  const shown = items.filter(it => !isWc64CeremonyOff(it.id, plan));
  if (!shown.length) return "no-ceremony";
  return shown.some(it => answers[it.id] === 0) ? "not-applicable" : "unanswered";
}

function knowledgeResult(answers: Wc64Answers, plan: Wc64Plan | null): Wc64Knowledge {
  const sec = wc64SectionById("KNOW") as Wc64Section;
  const k = knowledge(sec.items, answers);
  const names = WC64_BANK.knowledge.levels;
  const levels: Wc64KnowledgeLevel[] = k.levels.map((l, i) => {
    const out: Wc64KnowledgeLevel = { ...l, name: names[i] };
    if (l.state === "skip") out.skipReason = knowledgeSkipReason(sec.items.filter(it => it.level === l.L), plan, answers);
    return out;
  });
  // 1~3을 고른 문항 중 큰돈이 걸린 것(big_money)을 앞에 세운다. 같은 무리 안에서는 은행 순서.
  // 식 없이 하면 카드가 식을 전제한 문항(check_tag "예식", K1)은 건너뛰고 다음 카드를 쓴다(2026-10-16 2단계 검토).
  const cardOff = (it: Wc64Item) => plan === "none" && it.check_tag === WC64_CEREMONY_TAG;
  const low = sec.items.filter(it => { const v = answers[it.id]; return isWc64Rating(v) && v <= 3 && !cardOff(it) });
  const recheck = [...low.filter(it => it.big_money), ...low.filter(it => !it.big_money)].slice(0, 3);
  return {
    pct: k.pct, stage: k.stage, stageName: WC64_BANK.knowledge.stages[k.stage], n: k.n, levels,
    passedLater: k.passedLater, recheck,
  };
}

/** 글자 밖 막대(묶음 하나의 A/B %). FUND 와 BUDGET 둘 다 식 계획과 상관없이 늘(2026-10-17 파운더 결정, DEC-7 뒤집기). */
function barResult(sectionId: "FUND" | "BUDGET", answers: Wc64Answers): Wc64Fund {
  const sec = wc64SectionById(sectionId) as Wc64Section;
  const xs: number[] = [], ys: number[] = [];
  for (const it of sec.items) { const v = answers[it.id]; if (isWc64Rating(v)) (it.pole === "A" ? xs : ys).push(v) }
  const n = xs.length + ys.length;
  const a = axis(xs, ys);
  if (!a) return { decided: false, n };
  const pctA = a.N >= 0 ? a.shown : 100 - a.shown;
  return { decided: true, N: a.N, n, pctA, pctB: 100 - pctA };
}

type DecidedDim = Extract<Wc64DimResult, { decided: true }>;

/**
 * 결혼 준비 장면. 장면은 축 글자에 이어지지만 그리는 행동은 묶음 하나(sc.section)의 것이다.
 * - 그 묶음을 넘겼으면(skipped) 장면을 뺀다(가족 묶음을 넘긴 사람에게 양가 장면을 보이지 않는다).
 * - 그 묶음이 글자와 같은 쪽(same)이 아니면(opp·mid·both-high·both-low) 단정 문장(a/b) 대신 half 를 쓴다.
 * - 글자가 아슬하거나 반반이면 half(원본 규칙). 묶음 %를 못 낸 그 밖의 경우는 글자로만 고른다.
 */
function sceneResults(dims: readonly Wc64DimResult[]): Wc64SceneResult[] {
  const out: Wc64SceneResult[] = [];
  for (const sc of WC64_BANK.scenes) {
    const r = dims.find(x => x.dim === sc.axis);
    if (!r || !r.decided) continue;
    const facet = r.facets.find(f => f.section === sc.section);
    if (facet && !facet.decided && facet.reason === "skipped") continue;
    const facetPos = facet && facet.decided ? facet.pos : null;
    const key = r.level === "slight" || r.level === "half" || (facetPos !== null && facetPos !== "same")
      ? "half" : r.letterSide === "X" ? "a" : "b";
    out.push({
      id: sc.id, title: sc.title, dim: r.dim, letter: r.letter, letterPct: r.letterPct, level: r.level,
      section: sc.section, facetPos, key, here: sc[key].here, tip: sc[key].tip,
    });
  }
  return out;
}

/**
 * '또렷해요'를 먼저(2026-10-16 감사 FIX-15). 같은 단계 안에서는 단단함 순서다: 다시 계산해 같은 글자가 나온 정도(firm.R)가 큰 것,
 * 같으면 옮겨야 할 칸 수(firm.dist)가 큰 것. 화면 줄 이름이 '답이 가장 한결같은 글자'라 % 크기로 줄 세우면 더 한결같은 글자가
 * %가 낮다는 이유로 밀려났다(2026-10-17 점검). 그래도 같으면 가운데서 먼 순서, 그다음 축 순서다.
 */
function glanceOf(dims: readonly Wc64DimResult[]): Wc64Glance {
  const decided = dims.filter((r): r is DecidedDim => r.decided);
  const rank = (r: DecidedDim) => (r.level === "clear" ? 0 : 1);
  const strong = decided.filter(r => r.level === "clear" || r.level === "lean")
    .sort((a, b) =>
      rank(a) - rank(b)
      || b.firm.R - a.firm.R
      || (a.firm.dist === b.firm.dist ? 0 : b.firm.dist > a.firm.dist ? 1 : -1)
      || Math.abs(b.pctX - 50) - Math.abs(a.pctX - 50))
    .slice(0, 2).map(r => r.dim);
  const shaky = decided.filter(r => r.level === "slight" || r.level === "half").map(r => r.dim);
  const opposite: Wc64Glance["opposite"] = [];
  const both: Wc64Glance["both"] = [];
  for (const r of decided) for (const f of r.facets) {
    if (!f.decided) continue;
    if (f.pos === "opp") opposite.push({ dim: r.dim, section: f.section, title: f.title });
    if (f.pos === "both-high" || f.pos === "both-low") both.push({ dim: r.dim, section: f.section, title: f.title, pos: f.pos });
  }
  return { strong, shaky, opposite, both };
}

/**
 * 1·2(전혀·별로 아니에요)를 고른 성향 문항 id(묶음 순서). 은행 줄 표식에 문항 id 가 붙은 줄은 '그 문항의 행동을 단정하는 줄'이라,
 * 그 문항에 1·2를 고른 사람에게는 빼야 내 답과 반대로 말하지 않는다(2026-10-17 심사 UX-1). 해당 없음(0)·3·안 답함은 넣지 않는다.
 */
export function wc64DisagreedItems(answers: Wc64Answers): string[] {
  const out: string[] = [];
  for (const s of WC64_BANK.sections) {
    if (s.kind !== "bipolar") continue;
    for (const it of s.items) { const v = answers[it.id]; if (isWc64Rating(v) && v <= 2) out.push(it.id) }
  }
  return out;
}

/**
 * 결과 이름(2026-10-17 파운더 결정: 형용사 + 동물, 글로만). 답 묶음에 붙인 이름표이지 성격 설명이 아니다.
 * - 식 없이 하면(none): 남는 두 글자를 모두 정한 code("D··M" 꼴)일 때만 은행 no_ceremony_names 의 이름.
 * - 그 밖(yes·maybe, 계산이 maybe 와 같은 null): 네 글자를 모두 정해 유형 카드가 있을 때만 그 유형 이름.
 * 글자가 하나라도 정해지지 않으면 null. 참고로만 결과인지는 보지 않는다(이름은 두고 화면이 안내를 붙인다).
 */
function reportName(plan: Wc64Plan | null, code: string, type: Wc64TypeCard | null): Wc64ReportName | null {
  const base = plan === "none" ? wc64NoCeremonyName(code) : type?.name ?? null;
  return base ? { adjective: base.adjective, animal: base.animal, label: `${base.adjective} ${base.animal}` } : null;
}

/**
 * 답으로 리포트 전체를 만든다. plan 이 "none" 이면 "예식" 문항은 계산에서 빼고(그래서 CIRCLE·SPEND 는 '·'),
 * BUDGET 4문장은 식 계획과 상관없이 늘 글자 밖 막대(budget)로 따로 낸다(DEC-1, 2026-10-17 DEC-7 뒤집기).
 * 이름(name)은 `reportName` 규칙을 따른다.
 */
export function buildWc64Report(answers: Wc64Answers, plan: Wc64Plan | null, skipped: Wc64Skipped = {}): Wc64Report {
  const ans = wc64ConsideredAnswers(answers, plan);
  const dims = WC64_BANK.dims.map(d => dimResult(d, plan, ans, skipped));
  const skippedSections = WC64_BANK.sections
    .filter(s => s.kind === "bipolar" && wc64FacetSkipReason(s.id, plan, ans, skipped) === "skipped")
    .map(s => s.id);
  const disagreedItems = wc64DisagreedItems(ans);
  const hiddenTags = [...skippedSections, ...(plan === "none" ? [WC64_CEREMONY_TAG] : []), ...disagreedItems];
  const code = dims.map(r => r.decided ? r.letter : "·").join("");
  const complete = dims.every(r => r.decided);
  const type = complete ? wc64TypeCard(code) : null;
  const tendencyItems = WC64_BANK.sections.filter(s => s.kind === "bipolar").flatMap(s => s.items);
  let answered = 0, notApplicable = 0;
  for (const it of WC64_ITEMS) {
    if (isWc64CeremonyOff(it.id, plan)) continue;
    const v = ans[it.id];
    if (v === 0) notApplicable++;
    else if (isWc64Rating(v)) answered++;
  }
  return {
    version: WC64_VERSION,
    plan,
    code,
    complete,
    type,
    name: reportName(plan, code, type),
    dims,
    knowledge: knowledgeResult(ans, plan),
    fund: barResult("FUND", ans),
    scenes: sceneResults(dims),
    glance: glanceOf(dims),
    skippedSections,
    disagreedItems,
    hiddenTags,
    budget: barResult("BUDGET", ans),
    patterns: patterns(tendencyItems, ans),
    answered,
    notApplicable,
  };
}

/* ---------------- 글자 장·유형 카드 문구(넘긴 묶음·식 전제 줄 빼기) ---------------- */

/**
 * 줄 하나의 표식(쉼표로 여럿, 예: "FAMILY,FAMILY-B1")을 보고 남길지 정한다. 표식 하나라도 hidden 에 들면 뺀다.
 * "식없이"(`WC64_NO_CEREMONY_ONLY_TAG`)는 반대로 hidden 에 "예식"이 들 때(식 없이 한 결과)만 남긴다.
 */
function keepTag(tag: string | undefined, hidden: readonly string[]): boolean {
  if (!tag) return true;
  const tags = tag.split(",").map(t => t.trim()).filter(Boolean);
  if (tags.includes(WC64_NO_CEREMONY_ONLY_TAG) && !hidden.includes(WC64_CEREMONY_TAG)) return false;
  return !tags.some(t => t !== WC64_NO_CEREMONY_ONLY_TAG && hidden.includes(t));
}

function keepLines<T>(list: readonly T[], tags: readonly string[] | undefined, hidden: readonly string[]): T[] {
  return list.filter((_, i) => keepTag(tags?.[i], hidden));
}

/**
 * 글자 카드 문구에서 hiddenSections(보통 report.hiddenTags)에 든 표식이 붙은 줄을 뺀다.
 * 은행의 line_sections 가 줄마다 표식을 적어 둔다: 묶음 id(지금은 BOND 의 FAMILY 줄), "예식"(식을 전제한 줄,
 * 식 없이 하면 hiddenTags 에 든다) 또는 문항 id(그 문항의 행동을 단정하는 줄, 그 문항에 1·2를 고르면 hiddenTags 에 든다).
 * 한 줄에 표식이 여럿이면 쉼표로 잇고 하나라도 들면 뺀다. report.skippedSections 만 넘기면 가족 줄만 빠진다.
 * "식없이" 표식 줄은 hiddenSections 에 "예식"이 들 때만 남는다(식 없이 하면 PACE D·O 의 '챙겨 볼 것'이 비지 않게 채운 줄).
 */
export function wc64LetterCopy(
  dim: Wc64Dim, letter: Wc64Letter, hiddenSections: readonly string[] = [],
): Pick<Wc64LetterCard, "comfy" | "watch" | "app_actions" | "amora_line"> {
  const card = dim.letters[letter];
  const tags = card.line_sections ?? {};
  return {
    comfy: keepLines(card.comfy, tags.comfy, hiddenSections),
    watch: keepLines(card.watch, tags.watch, hiddenSections),
    app_actions: keepLines(card.app_actions, tags.app_actions, hiddenSections),
    amora_line: card.amora_line,
  };
}

/**
 * 축 설명(묻는 것·두 쪽 설명·닿는 결정)에서 hiddenSections(보통 report.hiddenTags) 이야기를 뺀 판.
 * 은행 skip_copy 가 있으면 갈아 끼우고, 닿는 결정은 decisions_sections 표식(묶음 id·"예식")으로 거른다.
 */
export function wc64DimCopy(
  dim: Wc64Dim, hiddenSections: readonly string[] = [],
): { question: string; desc_a: string; desc_b: string; decisions: string[] } {
  const alt = hiddenSections.map(s => dim.skip_copy?.[s]).find(c => c !== undefined);
  return {
    question: alt?.question ?? dim.question,
    desc_a: alt?.desc_a ?? dim.desc_a,
    desc_b: alt?.desc_b ?? dim.desc_b,
    decisions: keepLines(dim.decisions, dim.decisions_sections, hiddenSections),
  };
}

/**
 * 16유형 카드 문구에서 hiddenSections(보통 report.hiddenTags)에 든 표식이 붙은 줄을 뺀다.
 * 은행 types 의 line_sections 는 가족 묶음(FAMILY)에 기댄 줄(양가에 여쭙기·상견례·자기 집에 전하기 같은 줄)과,
 * 문항 하나의 행동을 단정하는 줄(그 문항 id, 예: 서약문을 같이 쓴다 → "FORM-B2")에 단다. 표식이 여럿이면 쉼표로 잇는다.
 * meets·tips 는 줄째 빼고, first·later 는 표식이 맞으면 빈 글자로 돌려준다(화면은 빈 글자를 그리지 않는다).
 * one_liner 는 거르지 않으므로 은행에서 문항 하나의 행동을 단정하지 않게 쓴다(model.test 가 지킨다).
 */
export function wc64TypeCopy(
  card: Wc64TypeCard, hiddenSections: readonly string[] = [],
): Pick<Wc64TypeCard, "one_liner" | "meets" | "first" | "later" | "tips"> {
  const tags = card.line_sections ?? {};
  const keepText = (text: string, tag: string | undefined) => (keepTag(tag, hiddenSections) ? text : "");
  return {
    one_liner: card.one_liner,
    meets: keepLines(card.meets, tags.meets, hiddenSections),
    first: keepText(card.first, tags.first),
    later: keepText(card.later, tags.later),
    tips: keepLines(card.tips, tags.tips, hiddenSections),
  };
}

/**
 * 유형 카드가 없을 때(식 없이 해서 두 글자만 정했거나, 글자가 덜 정해졌을 때) 보여 줄 '다음에 해 볼 것'.
 * 정해진 글자 축의 '둘이 나눌 질문'(dims.couple_questions)을, 한눈에 보기의 또렷한 글자 순서(그다음 나머지 정해진 글자를
 * 축 순서로)로 한 줄씩 돌아가며 max 개(기본 3)까지 고른다. 정해진 글자가 없으면 빈 배열.
 * 글자 장의 할 일(app_actions)은 그 장에 이미 나오므로 되풀이하지 않는다(2026-10-16 2단계 검토). 식 없이 해도 정해지는
 * PACE·BOND 의 질문은 식을 전제하지 않게 은행에서 맞춰 둔다(model.test 가 지킨다).
 */
export function wc64NextSteps(report: Wc64Report, max = 3): Wc64NextStep[] {
  const decided = report.dims.filter((r): r is DecidedDim => r.decided);
  const order = [
    ...report.glance.strong,
    ...decided.map(r => r.dim).filter(d => !report.glance.strong.includes(d)),
  ];
  const pools = order.map(id => {
    const r = decided.find(x => x.dim === id) as DecidedDim;
    const dim = wc64DimById(id) as Wc64Dim;
    return dim.couple_questions.map(text => ({ dim: id, letter: r.letter, text }));
  });
  const out: Wc64NextStep[] = [];
  for (let i = 0; out.length < max && pools.some(p => i < p.length); i++) {
    for (const p of pools) if (i < p.length && out.length < max) out.push(p[i]);
  }
  return out;
}


/**
 * '내 답 전체'에서 문항 옆에 적을 자리. 결과와 같은 계산 기준으로 정한다.
 * - 이해도(KNOW) 문항은 knowledge.
 * - FUND 는 늘 글자 밖 막대(이름은 은행 fund.a_name·b_name).
 * - BUDGET 도 식 계획과 상관없이 늘 글자 밖 예산 막대라 그 쪽 이름(budget_bar.a_name·b_name)을 준다(2026-10-17 DEC-7 뒤집기).
 *   식 없이 하면 SPEND 는 비워 둔 글자라 'W 쪽'·'L 쪽'으로 적히는 문항이 없다.
 * - 그 밖의 성향 문항은 그 문항이 미는 글자.
 * 식 없이 해서 묻지 않은 문항('예식')과 모르는 id 는 null(화면은 묻지 않은 문장 수로 한 줄에 모은다).
 */
export function wc64AnswerSide(itemId: string, plan: Wc64Plan | null): Wc64AnswerSide | null {
  const it = wc64ItemById(itemId);
  const sid = wc64SectionIdOfItem(itemId);
  if (!it || !sid || isWc64CeremonyOff(itemId, plan)) return null;
  if (it.pole === "L") return { kind: "knowledge" };
  const side = it.pole;
  if (sid === "FUND") return { kind: "bar", bar: "FUND", side, name: side === "A" ? WC64_BANK.fund.a_name : WC64_BANK.fund.b_name };
  if (sid === "BUDGET") {
    return { kind: "bar", bar: "BUDGET", side, name: side === "A" ? WC64_BANK.budget_bar.a_name : WC64_BANK.budget_bar.b_name };
  }
  const dim = WC64_BANK.dims.find(d => d.facets.some(f => f.axis === sid));
  const facet = dim?.facets.find(f => f.axis === sid);
  if (!dim || !facet) return null;
  return { kind: "letter", dim: dim.id, letter: side === facet.a_is ? dim.letter_a : dim.letter_b };
}
