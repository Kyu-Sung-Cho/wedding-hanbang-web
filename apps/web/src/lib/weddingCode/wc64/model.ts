// wc64 계산 엔진. 원본(Claude outputs/wedding-code-v6-report-20261016/engine.js)을 그대로 옮겼다.
// 같은 답이면 늘 같은 결과다(무작위·시각 없음). 숫자는 원본과 한 자리도 다르지 않아야 한다(model.test.ts 가 대조).
import {
  WC64_BANK, WC64_ITEMS, isWc64CeremonyOff, wc64SectionById, wc64TypeCard,
} from "./bank";
import {
  WC64_VERSION,
  type Wc64Answers, type Wc64AxisStat, type Wc64Dim, type Wc64DimResult,
  type Wc64FacetPos, type Wc64FacetResult, type Wc64Firmness, type Wc64Fund, type Wc64Glance,
  type Wc64Item, type Wc64Knowledge, type Wc64KnowledgeLevel, type Wc64Letter, type Wc64Level,
  type Wc64Pattern, type Wc64Plan, type Wc64Quote, type Wc64Rating, type Wc64Report,
  type Wc64SceneResult, type Wc64Section, type Wc64Skipped,
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

/** 글자 단단함: 문장 절반 다시 계산(모든 조합) + 반반까지 칸 수 */
export function firmness(xs: readonly number[], ys: readonly number[], N: number): Wc64Firmness {
  const kX = Math.ceil(xs.length / 2), kY = Math.ceil(ys.length / 2);
  const cx = combos(xs.length, kX), cy = combos(ys.length, kY);
  const sx = cx.map(c => c.reduce((a, i) => a + xs[i] - 1, 0)), sy = cy.map(c => c.reduce((a, i) => a + ys[i] - 1, 0));
  let score = 0, total = 0;
  const pcts: number[] = [];
  for (const a of sx) for (const b of sy) {
    const n2 = kY * a - kX * b;
    total++;
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
  return { agree: Math.round(score), total, R: score / total, dist, band: [q(0.1), q(0.9)] };
}

export function level(N: number, f: Pick<Wc64Firmness, "R" | "dist">, n: number): Wc64Level {
  if (N === 0) return "half";
  if (f.R >= 0.9 && f.dist >= 5 && n >= 8) return "clear";
  if (f.R >= 0.7 && f.dist >= 3) return "lean";
  return "slight";
}

/** 동점일 때 글자 정하기(정수 교차곱 비교) */
export function tieBreak(xs: readonly number[], ys: readonly number[], facetLeans?: { X: number; Y: number }): Side {
  const cmp = (a: number, na: number, b: number, nb: number) => a * nb - b * na;
  const c5 = cmp(xs.filter(x => x === 5).length, xs.length, ys.filter(y => y === 5).length, ys.length);
  if (c5) return c5 > 0 ? "X" : "Y";
  const c4 = cmp(xs.filter(x => x >= 4).length, xs.length, ys.filter(y => y >= 4).length, ys.length);
  if (c4) return c4 > 0 ? "X" : "Y";
  const c2 = cmp(xs.filter(x => x <= 2).length, xs.length, ys.filter(y => y <= 2).length, ys.length);
  if (c2) return c2 < 0 ? "X" : "Y";
  if (facetLeans && facetLeans.X !== facetLeans.Y) return facetLeans.X > facetLeans.Y ? "X" : "Y";
  return "X";
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
    const leans = {
      X: facetRows.filter(fr => fr.r && fr.r.N > 0).length,
      Y: facetRows.filter(fr => fr.r && fr.r.N < 0).length,
    };
    letterSide = tieBreak(xs, ys, leans);
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
  levels: { L: "L1" | "L2" | "L3" | "L4"; state: "pass" | "no" | "skip"; pct?: number }[];
  stage: number;
  n: number;
}

/** 이해도(원본 knowledge). 단계는 앞에서부터 이어서 통과한 수(건너뛴 단계는 끊지 않는다). */
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
  let stage = 0;
  for (const l of levels) { if (l.state === "skip") continue; if (l.state === "pass") stage++; else break }
  return { pct: total, levels, stage, n: got.length };
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

/** 계산에 넣을 답만 남긴다: 모르는 id 와 식을 안 올려 빠진 문항은 버린다. */
export function wc64ConsideredAnswers(answers: Wc64Answers, plan: Wc64Plan | null, skipped: Wc64Skipped = {}): Wc64Answers {
  const out: Wc64Answers = {};
  for (const it of WC64_ITEMS) {
    if (!Object.prototype.hasOwnProperty.call(answers, it.id)) continue;
    if (isWc64CeremonyOff(it.id, plan, skipped)) continue;
    const v = answers[it.id];
    if (v === 0 || isWc64Rating(v)) out[it.id] = v;
  }
  return out;
}

function facetView(row: Wc64FacetRow, letterSide: Side): Wc64FacetResult {
  const sec = wc64SectionById(row.axis) as Wc64Section;
  const xName = row.a_is === "A" ? sec.pole_a.name : sec.pole_b.name;
  const yName = row.a_is === "A" ? sec.pole_b.name : sec.pole_a.name;
  const base = { section: row.axis, title: sec.title, a_is: row.a_is, xName, yName, fx: row.fx, fy: row.fy };
  if (!row.r) return { ...base, decided: false };
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

function dimResult(dim: Wc64Dim, plan: Wc64Plan | null, answers: Wc64Answers): Wc64DimResult {
  const s = scoreDim(dim, WC64_BANK.sections, answers);
  const total = dim.facets.length * 4;
  if (!s.decided) {
    return {
      dim: dim.id, decided: false, reason: plan === "none" && dim.id === "CIRCLE" ? "no-ceremony" : "too-few",
      n: s.n, total, facets: [],
    };
  }
  return {
    dim: dim.id, decided: true, letter: s.letter, letterSide: s.letterSide, tie: s.tie, n: s.n, total: s.total,
    pctX: s.pctX, pctY: s.pctY, letterPct: s.letterSide === "X" ? s.pctX : s.pctY, exact: s.exact,
    agreeX: s.agreeX, agreeY: s.agreeY, firm: s.firm, level: s.level, band: s.firm.band,
    facets: s.facetRows.map(row => facetView(row, s.letterSide)),
    quotes: quotes(dim, s.letterSide, answers),
  };
}

function knowledgeResult(answers: Wc64Answers): Wc64Knowledge {
  const sec = wc64SectionById("KNOW") as Wc64Section;
  const k = knowledge(sec.items, answers);
  const names = WC64_BANK.knowledge.levels;
  const levels: Wc64KnowledgeLevel[] = k.levels.map((l, i) => ({ ...l, name: names[i] }));
  const recheck = sec.items.filter(it => { const v = answers[it.id]; return isWc64Rating(v) && v <= 3 }).slice(0, 3);
  return { pct: k.pct, stage: k.stage, stageName: WC64_BANK.knowledge.stages[k.stage], n: k.n, levels, recheck };
}

function fundResult(answers: Wc64Answers): Wc64Fund {
  const sec = wc64SectionById("FUND") as Wc64Section;
  const xs: number[] = [], ys: number[] = [];
  for (const it of sec.items) { const v = answers[it.id]; if (isWc64Rating(v)) (it.pole === "A" ? xs : ys).push(v) }
  const n = xs.length + ys.length;
  const a = axis(xs, ys);
  if (!a) return { decided: false, n };
  const pctA = a.N >= 0 ? a.shown : 100 - a.shown;
  return { decided: true, N: a.N, n, pctA, pctB: 100 - pctA };
}

type DecidedDim = Extract<Wc64DimResult, { decided: true }>;

function sceneResults(dims: readonly Wc64DimResult[]): Wc64SceneResult[] {
  const out: Wc64SceneResult[] = [];
  for (const sc of WC64_BANK.scenes) {
    const r = dims.find(x => x.dim === sc.axis);
    if (!r || !r.decided) continue;
    const key = r.level === "slight" || r.level === "half" ? "half" : r.letterSide === "X" ? "a" : "b";
    out.push({
      id: sc.id, title: sc.title, dim: r.dim, letter: r.letter, letterPct: r.letterPct, level: r.level,
      key, here: sc[key].here, tip: sc[key].tip,
    });
  }
  return out;
}

function glanceOf(dims: readonly Wc64DimResult[]): Wc64Glance {
  const decided = dims.filter((r): r is DecidedDim => r.decided);
  const strong = decided.filter(r => r.level === "clear" || r.level === "lean")
    .sort((a, b) => Math.abs(b.pctX - 50) - Math.abs(a.pctX - 50)).slice(0, 2).map(r => r.dim);
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
 * 답으로 리포트 전체를 만든다. plan 이 "none" 이면 "예식" 문항은 계산에서 뺀다
 * (skipped[sid] === false 로 다른 자리를 고른 묶음은 남긴다. 원본과 같다).
 */
export function buildWc64Report(answers: Wc64Answers, plan: Wc64Plan | null, skipped: Wc64Skipped = {}): Wc64Report {
  const ans = wc64ConsideredAnswers(answers, plan, skipped);
  const dims = WC64_BANK.dims.map(d => dimResult(d, plan, ans));
  const code = dims.map(r => r.decided ? r.letter : "·").join("");
  const complete = dims.every(r => r.decided);
  const tendencyItems = WC64_BANK.sections.filter(s => s.kind === "bipolar").flatMap(s => s.items);
  let answered = 0, notApplicable = 0;
  for (const it of WC64_ITEMS) {
    if (isWc64CeremonyOff(it.id, plan, skipped)) continue;
    const v = ans[it.id];
    if (v === 0) notApplicable++;
    else if (isWc64Rating(v)) answered++;
  }
  return {
    version: WC64_VERSION,
    plan,
    code,
    complete,
    type: complete ? wc64TypeCard(code) : null,
    dims,
    knowledge: knowledgeResult(ans),
    fund: fundResult(ans),
    scenes: sceneResults(dims),
    glance: glanceOf(dims),
    patterns: patterns(tendencyItems, ans),
    answered,
    notApplicable,
  };
}

