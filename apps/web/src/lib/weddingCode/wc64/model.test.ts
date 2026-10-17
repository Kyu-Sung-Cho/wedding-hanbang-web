import { describe, expect, it } from "vitest";
import { WC64_BANK, WC64_ITEMS, isWc64CeremonyOff, wc64DimById, wc64SectionById } from "./bank";
import {
  axis, buildWc64Report, displayPct, firmness, knowledge, level, patterns, scoreDim, wc64ConsideredAnswers, wc64DimCopy,
  wc64AnswerSide, wc64DimPossible, wc64DimSkipReason, wc64FacetSkipReason, wc64LetterCopy, wc64NextSteps, wc64TypeCopy,
} from "./model";
import type { Wc64Answer, Wc64Answers, Wc64DimId, Wc64Firmness, Wc64Plan, Wc64Skipped } from "./types";

/* ------------------------------------------------------------------
 * 참조 구현: 원본 engine.js 와 page6-shell.html 의 compute/facetView/quotes 를
 * 손대지 않고 옮겨 둔 것(대조 전용). 원본 파일을 읽지 않는다.
 * ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-explicit-any */
const REF = (() => {
  function axis(xs: any[], ys: any[]): any {
    const nX = xs.length, nY = ys.length
    if (!nX || !nY) return null
    const SX = xs.reduce((a, x) => a + (x - 1), 0), SY = ys.reduce((a, y) => a + (y - 1), 0)
    const N = nY * SX - nX * SY
    const D = nX * nY
    const exact = 50 + 12.5 * N / D
    const winner = N > 0 ? 'X' : N < 0 ? 'Y' : 'T'
    const shown = displayPct(Math.abs(N), D)
    return { nX, nY, SX, SY, N, exact, winner, shown, agreeX: Math.round(SX / (4 * nX) * 100), agreeY: Math.round(SY / (4 * nY) * 100) }
  }
  function displayPct(absN: number, D: number) {
    if (absN === 0) return 50
    const num = 100 * D + 25 * absN, den = 2 * D
    let f = Math.floor(num / den)
    const rem = num - f * den
    if (2 * rem > den) f += 1
    if (f === 50) f = 51
    return f
  }
  function combos(n: number, k: number) {
    const out: number[][] = []
    const pick = (start: number, acc: number[]) => { if (acc.length === k) { out.push(acc.slice()); return } for (let i = start; i < n; i++) { acc.push(i); pick(i + 1, acc); acc.pop() } }
    pick(0, [])
    return out
  }
  function firmness(xs: any[], ys: any[], N: number): any {
    const kX = Math.ceil(xs.length / 2), kY = Math.ceil(ys.length / 2)
    const cx = combos(xs.length, kX), cy = combos(ys.length, kY)
    const sx = cx.map(c => c.reduce((a, i) => a + xs[i] - 1, 0)), sy = cy.map(c => c.reduce((a, i) => a + ys[i] - 1, 0))
    let score = 0, total = 0
    const pcts: number[] = []
    for (const a of sx) for (const b of sy) {
      const n2 = kY * a - kX * b
      total++
      if (N === 0) score += n2 === 0 ? 1 : 0.5
      else if (Math.sign(n2) === Math.sign(N)) score += 1
      else if (n2 === 0) score += 0.5
      pcts.push(50 + 12.5 * n2 / (kX * kY))
    }
    pcts.sort((p, q) => p - q)
    const q = (f: number) => pcts[Math.min(pcts.length - 1, Math.max(0, Math.floor(f * (pcts.length - 1))))]
    let dist = 0
    if (N !== 0) {
      const nX = xs.length, nY = ys.length
      const toward = N > 0
      const capX = toward ? xs.reduce((a, x) => a + (x - 1), 0) : xs.reduce((a, x) => a + (5 - x), 0)
      const capY = toward ? ys.reduce((a, y) => a + (5 - y), 0) : ys.reduce((a, y) => a + (y - 1), 0)
      let need = Math.abs(N)
      const steps = [{ v: nY, cap: capX }, { v: nX, cap: capY }].sort((p, q2) => q2.v - p.v)
      for (const st of steps) { if (need <= 0) break; const use = Math.min(st.cap, Math.ceil(need / st.v)); dist += use; need -= use * st.v }
      if (need > 0) dist = Infinity
    }
    return { agree: Math.round(score), total, R: score / total, dist, band: [q(0.1), q(0.9)] }
  }
  function level(N: number, f: any, n: number) {
    if (N === 0) return 'half'
    if (f.R >= 0.9 && f.dist >= 5 && n >= 8) return 'clear'
    if (f.R >= 0.7 && f.dist >= 3) return 'lean'
    return 'slight'
  }
  function tieBreak(xs: any[], ys: any[], facetLeans: any) {
    const cmp = (a: number, na: number, b: number, nb: number) => a * nb - b * na
    const c5 = cmp(xs.filter(x => x === 5).length, xs.length, ys.filter(y => y === 5).length, ys.length)
    if (c5) return c5 > 0 ? 'X' : 'Y'
    const c4 = cmp(xs.filter(x => x >= 4).length, xs.length, ys.filter(y => y >= 4).length, ys.length)
    if (c4) return c4 > 0 ? 'X' : 'Y'
    const c2 = cmp(xs.filter(x => x <= 2).length, xs.length, ys.filter(y => y <= 2).length, ys.length)
    if (c2) return c2 < 0 ? 'X' : 'Y'
    if (facetLeans && facetLeans.X !== facetLeans.Y) return facetLeans.X > facetLeans.Y ? 'X' : 'Y'
    return 'X'
  }
  function scoreDim(dim: any, sections: any[], answers: any): any {
    const xs: any[] = [], ys: any[] = [], facetRows: any[] = []
    for (const f of dim.facets) {
      const sec = sections.find(s => s.id === f.axis)
      const fx: any[] = [], fy: any[] = []
      for (const it of sec.items) {
        const v = answers[it.id]
        if (!(v >= 1 && v <= 5)) continue
        const toX = it.pole === f.a_is
        ;(toX ? fx : fy).push(v)
        ;(toX ? xs : ys).push(v)
      }
      const fr = fx.length && fy.length ? axis(fx, fy) : null
      facetRows.push({ axis: f.axis, a_is: f.a_is, fx, fy, r: fr })
    }
    const n = xs.length + ys.length
    const facetsWithBoth = facetRows.filter(r => r.r).length
    if (n < 6 || xs.length < 2 || ys.length < 2 || facetsWithBoth < 2) return { decided: false, n, facetRows }
    const r = axis(xs, ys)
    const f = firmness(xs, ys, r.N)
    let letterSide = r.winner
    let tie = false
    if (letterSide === 'T') {
      tie = true
      const leans = { X: facetRows.filter(fr => fr.r && fr.r.N > 0).length, Y: facetRows.filter(fr => fr.r && fr.r.N < 0).length }
      letterSide = tieBreak(xs, ys, leans)
    }
    const letter = letterSide === 'X' ? dim.letter_a : dim.letter_b
    const pctX = r.N >= 0 ? r.shown : 100 - r.shown
    return { decided: true, letter, letterSide, tie, n, total: dim.facets.length * 4, pctX, pctY: 100 - pctX, exact: r.exact, agreeX: r.agreeX, agreeY: r.agreeY, firm: f, level: level(r.N, f, n), facetRows }
  }
  function knowledge(items: any[], answers: any): any {
    const got = items.filter(it => answers[it.id] >= 1 && answers[it.id] <= 5)
    const sum = got.reduce((a, it) => a + answers[it.id] - 1, 0)
    const total = got.length ? Math.floor((sum * 100 * 2 + 4 * got.length) / (8 * got.length)) : null
    const levels = ['L1', 'L2', 'L3', 'L4'].map(L => {
      const li = got.filter(it => it.level === L)
      if (!li.length) return { L, state: 'skip' }
      const s = li.reduce((a, it) => a + answers[it.id] - 1, 0)
      const p = Math.floor((s * 200 + 4 * li.length) / (8 * li.length))
      const mean4 = li.reduce((a, it) => a + answers[it.id], 0) >= 4 * li.length
      return { L, state: mean4 ? 'pass' : 'no', pct: p }
    })
    // 원본과 일부러 다른 곳(2026-10-16 감사 FIX-2, 계약 §3.6): 원본은 통과한 '수'를 stage 로 써서 skip 단계가 있으면
    // 이름이 밀렸다. 지금은 이어서 통과한 마지막 단계의 '번호'다(skip 은 끊지 않음, 처음 no 에서 멈춤).
    let stage = 0, stopped = false
    const passedLater: string[] = []
    levels.forEach((l: any, i: number) => {
      if (l.state === 'skip') return
      if (stopped) { if (l.state === 'pass') passedLater.push(l.L); return }
      if (l.state === 'pass') stage = i + 1; else stopped = true
    })
    return { pct: total, levels, stage, n: got.length, passedLater }
  }
  function patterns(tendencyItems: any[], answers: any) {
    const vals = tendencyItems.map(it => answers[it.id]).filter(v => v >= 1 && v <= 5)
    if (!vals.length) return []
    const out: string[] = []
    const counts = [1, 2, 3, 4, 5].map(k => vals.filter(v => v === k).length)
    if (Math.max(...counts) / vals.length >= 0.9) out.push('same')
    if (vals.filter(v => v >= 4).length / vals.length >= 0.8) out.push('agree')
    return out
  }
  return { axis, displayPct, firmness, level, tieBreak, scoreDim, knowledge, patterns }
})()

/**
 * page6-shell.html 의 결과 계산(compute + facetView + quotes) 그대로.
 * 일부러 다른 곳 하나(2026-10-16 파운더 결정 DEC-1): 원본은 noceremony_alt 가 있는 묶음에서 skipped[sid] === false 면
 * '예식' 문항을 남겼는데, 그 갈래를 없앴으므로 식 없이 하면 '예식' 문항은 늘 빠진다. skipped 는 이제 계산에 쓰지 않는다.
 */
function refCompute(WC: any, rawAnswers: any, plan: any) {
  const E = REF
  const secById = Object.fromEntries(WC.sections.map((s: any) => [s.id, s]))
  const ceremonyOff = (it: any) => plan === 'none' && it.skip_tag === '예식'
  const answers = Object.assign({}, rawAnswers)
  WC.sections.forEach((s: any) => s.items.forEach((it: any) => { if (ceremonyOff(Object.assign({ sid: s.id }, it))) delete answers[it.id] }))
  const dims = WC.dims.map((d: any) => Object.assign({ dim: d }, E.scoreDim(d, WC.sections, answers)))
  const code = dims.map((r: any) => r.decided ? r.letter : '·').join('')
  const fund = (() => {
    const s = secById.FUND
    const xs: any[] = [], ys: any[] = []
    s.items.forEach((it: any) => { const v = answers[it.id]; if (v >= 1 && v <= 5) (it.pole === 'A' ? xs : ys).push(v) })
    if (!xs.length || !ys.length) return { decided: false, xs, ys }
    const a = E.axis(xs, ys)
    return { decided: true, pctA: a.N >= 0 ? a.shown : 100 - a.shown, N: a.N, n: xs.length + ys.length }
  })()
  const know = E.knowledge(secById.KNOW.items, answers)
  const tendencyItems = WC.sections.filter((s: any) => s.kind === 'bipolar').flatMap((s: any) => s.items)
  const pats = E.patterns(tendencyItems, answers)
  function facetView(dimRes: any, fr: any) {
    const sec = secById[fr.axis]
    if (!fr.r) return { decided: false }
    const pctX = fr.r.N >= 0 ? fr.r.shown : 100 - fr.r.shown
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    const mx = mean(fr.fx), my = mean(fr.fy)
    let pos
    if (Math.abs(fr.r.exact - 50) <= 6.25) pos = mx >= 4 && my >= 4 ? 'both-high' : mx <= 2 && my <= 2 ? 'both-low' : 'mid'
    else pos = (fr.r.N > 0) === (dimRes.letterSide === 'X') ? 'same' : 'opp'
    return { sec: sec.id, decided: true, pctX, pos }
  }
  function quotes(dimRes: any) {
    const d = dimRes.dim
    const rows: any[] = []
    d.facets.forEach((f: any) => secById[f.axis].items.forEach((it: any) => {
      const v = answers[it.id]; if (!(v >= 1 && v <= 5)) return
      const toX = it.pole === f.a_is
      const towardX = toX ? v : 6 - v
      rows.push({ it, v, towardX })
    }))
    const want = dimRes.letterSide
    const score = (r: any) => want === 'X' ? r.towardX : 6 - r.towardX
    const sorted = rows.slice().sort((a, b) => score(b) - score(a) || b.v - a.v)
    const pro = sorted.filter(r => score(r) >= 4).slice(0, 2)
    const con = sorted.slice().reverse().filter(r => score(r) <= 2).slice(0, 1)
    return { pro: pro.map(r => r.it.id), con: con.map(r => r.it.id) }
  }
  const dimViews = dims.map((r: any) => r.decided
    ? { ...r, facets: r.facetRows.map((fr: any) => facetView(r, fr)), quotes: quotes(r) }
    : r)
  return { dims: dimViews, code, fund, know, pats }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------------- engine.test.js 사례 9개 ---------------- */
describe("wc64 엔진: 원본 engine.test.js 사례", () => {
  it("설계 검산 예 1: 68.75 → 69, 또렷", () => {
    const xs = [4, 4, 5, 4, 3, 4], ys = [2, 3, 2, 3, 2, 3];
    const r = axis(xs, ys)!;
    expect(r.N).toBe(54); expect(r.exact).toBe(68.75); expect(r.shown).toBe(69);
    const f = firmness(xs, ys, r.N);
    expect(f.R).toBe(1); expect(f.dist).toBe(9);
    expect(level(r.N, f, 12)).toBe("clear");
  });
  it("설계 검산 예 2: 56, 기울어 있어요", () => {
    const xs = [5, 4, 4, 3, 4, 5], ys = [4, 4, 3, 4, 3, 4];
    const r = axis(xs, ys)!;
    expect(r.shown).toBe(56);
    const f = firmness(xs, ys, r.N);
    expect(Math.abs(f.R - 0.89)).toBeLessThan(0.02);
    expect(f.dist).toBe(3);
    expect(level(r.N, f, 12)).toBe("lean");
  });
  it("설계 검산 예 3: 54, 아슬해요", () => {
    const xs = [4, 2, 5, 3, 2, 4], ys = [4, 3, 2, 4, 3, 2];
    const r = axis(xs, ys)!;
    expect(r.shown).toBe(54);
    const f = firmness(xs, ys, r.N);
    expect(Math.abs(f.R - 0.70)).toBeLessThan(0.03);
    expect(f.dist).toBe(2);
    expect(level(r.N, f, 12)).toBe("slight");
  });
  it("모두 같은 칸이면 정확히 50, 동점", () => {
    const r = axis([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3])!;
    expect(r.N).toBe(0); expect(r.shown).toBe(50);
    expect(level(r.N, firmness([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3], 0), 12)).toBe("half");
    const r2 = axis([5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5])!;
    expect(r2.N).toBe(0);
  });
  it("끝값 100", () => {
    const r = axis([5, 5, 5, 5, 5, 5], [1, 1, 1, 1, 1, 1])!;
    expect(r.shown).toBe(100); expect(r.exact).toBe(100);
  });
  it(".5 는 50 쪽으로 내림, N≠0 인데 50 이면 51", () => {
    expect(displayPct(1, 36)).toBe(51);
    expect(displayPct(1, 4)).toBe(53); expect(displayPct(2, 4)).toBe(56); expect(displayPct(4, 4)).toBe(62);
    expect(displayPct(0, 36)).toBe(50);
  });
  it("양쪽 균형이라 그래요 버릇이 상쇄: 전부 +1 해도 % 같음", () => {
    const a = axis([3, 4, 3, 4, 2, 3], [2, 2, 3, 2, 3, 2])!, b = axis([4, 5, 4, 5, 3, 4], [3, 3, 4, 3, 4, 3])!;
    expect(a.exact).toBe(b.exact);
  });
  it("이해도 %: 설계 예 19/48 → 40, 단계 1", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => ({ id: "K" + i, level: ("L" + Math.ceil(i / 3)) as "L1" }));
    const ans: Wc64Answers = { K1: 4, K2: 5, K3: 4, K4: 3, K5: 2, K6: 4, K7: 2, K8: 1, K9: 3, K10: 1, K11: 1, K12: 1 };
    const k = knowledge(items, ans);
    expect(k.pct).toBe(40); expect(k.stage).toBe(1);
  });
  it("같은 답이면 같은 결과(결정적)", () => {
    const xs = [4, 2, 5, 3, 2, 4], ys = [4, 3, 2, 4, 3, 2];
    expect(firmness(xs, ys, axis(xs, ys)!.N)).toEqual(firmness(xs, ys, axis(xs, ys)!.N));
  });
});

/* ---------------- 은행 구조와 리포트 ---------------- */
const fill = (v: Wc64Answer, ids = WC64_ITEMS.map(it => it.id)): Wc64Answers => Object.fromEntries(ids.map(id => [id, v]));

describe("wc64 리포트", () => {
  it("축마다 양쪽 문장 수가 같다: PACE·CIRCLE·BOND 는 12개(6:6), SPEND 는 DAY·WEIGHT 8개(4:4, 2026-10-17)", () => {
    const half: Record<Wc64DimId, number> = { PACE: 6, SPEND: 4, CIRCLE: 6, BOND: 6 };
    for (const dim of WC64_BANK.dims) {
      let x = 0, y = 0;
      for (const f of dim.facets) for (const it of wc64SectionById(f.axis)!.items) { if (it.pole === f.a_is) x++; else y++ }
      expect([dim.id, x, y]).toEqual([dim.id, half[dim.id], half[dim.id]]);
    }
  });

  it("16코드가 모두 유형 설명에 있다", () => {
    const codes: string[] = [];
    for (const a of "DO") for (const b of "WL") for (const c of "CU") for (const d of "MR") codes.push(a + b + c + d);
    expect(Object.keys(WC64_BANK.types).sort()).toEqual(codes.slice().sort());
  });

  it("앞 글자 쪽만 끝까지 고르면 DWCM, 100%·또렷", () => {
    const ans: Wc64Answers = {};
    for (const dim of WC64_BANK.dims) for (const f of dim.facets) for (const it of wc64SectionById(f.axis)!.items) ans[it.id] = it.pole === f.a_is ? 5 : 1;
    const r = buildWc64Report(ans, "yes");
    expect(r.code).toBe("DWCM");
    expect(r.complete).toBe(true);
    expect(r.type?.title).toBe(WC64_BANK.types.DWCM.title);
    for (const d of r.dims) {
      expect(d.decided).toBe(true);
      if (d.decided) { expect([d.pctX, d.pctY, d.level, d.letterPct]).toEqual([100, 0, "clear", 100]) }
    }
    expect(r.answered).toBe(44); // 네 축의 11묶음 × 4 (FUND·BUDGET·KNOW 는 안 답함)
    expect(r.knowledge.pct).toBeNull();
    expect(r.fund.decided).toBe(false);
    expect(r.budget.decided).toBe(false);
  });

  it("모두 '반반이에요'면 네 글자 모두 반반(50:50)이고 '같은 칸' 알림", () => {
    const r = buildWc64Report(fill(3), "yes");
    for (const d of r.dims) {
      expect(d.decided).toBe(true);
      if (d.decided) { expect([d.pctX, d.pctY, d.level, d.tie]).toEqual([50, 50, "half", true]); expect(d.pctX + d.pctY).toBe(100) }
    }
    expect(r.patterns).toContain("same");
    expect(r.code).toBe("DWCM"); // 동점 깨기 마지막 규칙은 앞 글자
  });

  it("식 없이 하면 CIRCLE·SPEND 가 decided:false(사유 no-ceremony)이고 예식 문항은 셈에서 빠진다(DEC-1)", () => {
    const r = buildWc64Report(fill(4), "none");
    for (const id of ["CIRCLE", "SPEND"] as const) {
      const d = r.dims.find(x => x.dim === id)!;
      expect([id, d.decided, d.decided ? null : d.reason]).toEqual([id, false, "no-ceremony"]);
    }
    expect(r.code[1]).toBe("·");
    expect(r.code[2]).toBe("·");
    expect(r.complete).toBe(false);
    expect(r.type).toBeNull();
    const ceremony = WC64_ITEMS.filter(it => it.skip_tag === "예식").length;
    expect(r.answered).toBe(64 - ceremony);
    // 같은 답에 식을 올리면 그대로 64개를 센다
    expect(buildWc64Report(fill(4), "yes").answered).toBe(64);
  });

  it("해당 없음(0)과 안 답함은 % 에 들지 않고 해당 없음 수로만 센다", () => {
    const ans = fill(4);
    ans["FAMILY-A1"] = 0; ans["FAMILY-B1"] = 0;
    delete ans["TALK-A1"];
    const r = buildWc64Report(ans, "yes");
    expect(r.notApplicable).toBe(2);
    expect(r.answered).toBe(61);
  });

  it("근거 인용: 글자 쪽으로 가장 세게 고른 문장 2개, 반대쪽 1개", () => {
    const ans: Wc64Answers = {};
    const pace = WC64_BANK.dims.find(d => d.id === "PACE")!;
    for (const f of pace.facets) for (const it of wc64SectionById(f.axis)!.items) ans[it.id] = it.pole === f.a_is ? 4 : 2;
    ans["PLAN-A1"] = 5; // 가장 센 D 쪽 문장
    ans["TALK-B1"] = 5; // O 쪽 문장에 완전히 그래요 = 반대쪽
    const d = buildWc64Report(ans, "yes").dims.find(x => x.dim === "PACE")!;
    expect(d.decided && d.letter).toBe("D");
    if (!d.decided) return;
    expect(d.quotes.pro).toHaveLength(2);
    expect(d.quotes.pro[0].itemId).toBe("PLAN-A1");
    expect(d.quotes.pro[0].label).toBe(WC64_BANK.meta.scale[4]);
    expect(d.quotes.con.map(q => q.itemId)).toEqual(["TALK-B1"]);
  });

  it("비용 마련 막대는 글자 밖이고 양쪽 합 100", () => {
    const ans = fill(3);
    for (const it of wc64SectionById("FUND")!.items) ans[it.id] = it.pole === "A" ? 5 : 2;
    const r = buildWc64Report(ans, "yes");
    expect(r.fund.decided).toBe(true);
    if (r.fund.decided) { expect(r.fund.pctA).toBeGreaterThan(50); expect(r.fund.pctA + r.fund.pctB).toBe(100) }
    expect(r.code).toBe(buildWc64Report(fill(3), "yes").code);
  });

  it("아무 답이 없으면 네 자리 모두 '·', 이해도 null", () => {
    const r = buildWc64Report({}, null);
    expect(r.code).toBe("····");
    expect(r.knowledge.pct).toBeNull();
    expect(r.knowledge.stageName).toBe(WC64_BANK.knowledge.stages[0]);
    expect(r.patterns).toEqual([]);
    expect(r.scenes).toEqual([]);
  });

  it("같은 답이면 리포트 전체가 같다", () => {
    const ans = fill(4); ans["PLAN-A1"] = 2; ans["DAY-B1"] = 5;
    expect(buildWc64Report(ans, "maybe")).toEqual(buildWc64Report({ ...ans }, "maybe"));
  });
});

/* ---------------- 원본과 무작위 500세트 대조 ---------------- */
/** 원본 firmness 가 돌려주던 값만(same·tie 는 2026-10-17 HON-1 로 더한 값) */
const refFirm = ({ agree, total, R, dist, band }: Wc64Firmness) => ({ agree, total, R, dist, band });

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("wc64 엔진: 원본 로직과 무작위 500세트 대조", () => {
  it("축 %·단계·코드·묶음·인용·이해도·비용 막대·답 모양이 모두 같다", () => {
    const rand = mulberry32(20261016);
    const plans: (Wc64Plan | null)[] = ["yes", "maybe", "none", null];
    let decidedCount = 0, tieCount = 0;
    const levels = new Set<string>();
    for (let n = 0; n < 500; n++) {
      // 답 모양을 섞는다: 한쪽으로 기운 사람, 가운데 사람, 무작위, 빈칸·해당 없음 섞기
      const style = n % 5;
      const bias = rand();
      const ans: Wc64Answers = {};
      for (const it of WC64_ITEMS) {
        const r = rand();
        if (style === 4 && r < 0.25) continue; // 안 답함
        if (it.skip_tag && r > 0.93) { ans[it.id] = 0; continue }
        let v: number;
        if (style === 0) v = 1 + Math.floor(rand() * 5);
        else if (style === 1) v = 2 + Math.floor(rand() * 3);
        else if (style === 2) v = it.pole === "A" ? (rand() < bias ? 4 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3)) : 1 + Math.floor(rand() * 5);
        else v = rand() < 0.6 ? 3 : 1 + Math.floor(rand() * 5);
        ans[it.id] = v as Wc64Answer;
      }
      const plan = plans[n % 4];
      const skipped: Wc64Skipped = n % 7 === 0 ? { GUESTS: false } : n % 11 === 0 ? { FAMILY: true } : {};
      const ref = refCompute(WC64_BANK, ans, plan); // 옛 GUESTS:false 가 섞여도 결과가 같아야 한다(DEC-1)
      const got = buildWc64Report(ans, plan, skipped);

      expect(got.code).toBe(ref.code);
      ref.dims.forEach((rd: { decided: boolean; [k: string]: unknown }, i: number) => {
        const gd = got.dims[i];
        expect(gd.decided).toBe(rd.decided);
        expect(gd.n).toBe(rd.n);
        if (!gd.decided || !rd.decided) return;
        decidedCount++; if (gd.tie) tieCount++; levels.add(gd.level);
        expect(gd.tieRule === null).toBe(!gd.tie); // 동점일 때만 규칙이 붙는다
        // same·tie 는 원본에 없는 값(HON-1)이라 따로 본다: R 은 그 둘로 다시 맞아야 한다.
        if (!gd.tie) expect(gd.firm.same + gd.firm.tie / 2).toBeCloseTo(gd.firm.R * gd.firm.total, 9);
        expect(gd.firm.same + gd.firm.tie).toBeLessThanOrEqual(gd.firm.total);
        expect({
          letter: gd.letter, letterSide: gd.letterSide, tie: gd.tie, pctX: gd.pctX, pctY: gd.pctY, exact: gd.exact,
          agreeX: gd.agreeX, agreeY: gd.agreeY, level: gd.level, firm: refFirm(gd.firm),
          facets: gd.facets.map(f => f.decided ? { sec: f.section, decided: true, pctX: f.pctX, pos: f.pos } : { decided: false }),
          quotes: { pro: gd.quotes.pro.map(q => q.itemId), con: gd.quotes.con.map(q => q.itemId) },
        }).toEqual({
          letter: rd.letter, letterSide: rd.letterSide, tie: rd.tie, pctX: rd.pctX, pctY: rd.pctY, exact: rd.exact,
          agreeX: rd.agreeX, agreeY: rd.agreeY, level: rd.level, firm: rd.firm,
          facets: rd.facets, quotes: rd.quotes,
        });
      });
      expect({ pct: got.knowledge.pct, stage: got.knowledge.stage, n: got.knowledge.n, levels: got.knowledge.levels.map(({ L, state, pct }) => (pct === undefined ? { L, state } : { L, state, pct })) })
        .toEqual({ pct: ref.know.pct, stage: ref.know.stage, n: ref.know.n, levels: ref.know.levels });
      if (ref.fund.decided) expect(got.fund).toMatchObject({ decided: true, pctA: ref.fund.pctA, N: ref.fund.N, n: ref.fund.n });
      else expect(got.fund.decided).toBe(false);
      expect(got.patterns).toEqual(ref.pats);
    }
    // 대조가 여러 경우를 실제로 지나갔는지
    expect(decidedCount).toBeGreaterThan(1000);
    expect(tieCount).toBeGreaterThan(0);
    expect([...levels].sort()).toEqual(["clear", "half", "lean", "slight"]);
  });

  it("내부 함수도 원본과 같다(scoreDim·knowledge·patterns)", () => {
    const rand = mulberry32(7);
    for (let n = 0; n < 100; n++) {
      const ans: Wc64Answers = {};
      for (const it of WC64_ITEMS) if (rand() < 0.85) ans[it.id] = (1 + Math.floor(rand() * 5)) as Wc64Answer;
      for (const dim of WC64_BANK.dims) {
        const got = scoreDim(dim, WC64_BANK.sections, ans);
        expect(got.decided ? { ...got, firm: refFirm(got.firm) } : got).toEqual(REF.scoreDim(dim, WC64_BANK.sections, ans));
      }
      const know = wc64SectionById("KNOW")!.items;
      expect(knowledge(know, ans)).toEqual(REF.knowledge(know, ans));
      const tend = WC64_BANK.sections.filter(s => s.kind === "bipolar").flatMap(s => s.items);
      expect(patterns(tend, ans)).toEqual(REF.patterns(tend, ans));
    }
  });
});

/* ---------------- 2026-10-16 감사 수정(FIX-2·4·6·12·13·15) ---------------- */

const KNOW_IDS = wc64SectionById("KNOW")!.items.map(it => it.id);
const knowAns = (byId: Record<string, Wc64Answer>, rest: Wc64Answer): Wc64Answers =>
  Object.fromEntries(KNOW_IDS.map(id => [id, id in byId ? byId[id] : rest]));

/** 한 축의 앞 글자 쪽 문장에 xs, 뒷 글자 쪽 문장에 ys 를 묶음 순서대로 넣는다(PACE·CIRCLE·BOND 6:6, SPEND 4:4). */
function setDim(ans: Wc64Answers, dimId: Wc64DimId, xs: Wc64Answer[], ys: Wc64Answer[]) {
  const dim = wc64DimById(dimId)!;
  let i = 0, j = 0;
  for (const f of dim.facets) for (const it of wc64SectionById(f.axis)!.items) {
    if (it.pole === f.a_is) ans[it.id] = xs[i++]; else ans[it.id] = ys[j++];
  }
  expect([i, j]).toEqual([xs.length, ys.length]);
}

describe("이해도 단계 이름: 이어서 통과한 마지막 단계의 위치(FIX-2)", () => {
  it("식 안 올림·이해도 전부 5 → L2 는 식 때문에 빠졌어도 '제도와 큰돈까지'", () => {
    const k = buildWc64Report(knowAns({}, 5), "none").knowledge;
    expect(k.levels.map(l => l.state)).toEqual(["pass", "skip", "pass", "pass"]);
    expect(k.stage).toBe(4);
    expect(k.stageName).toBe("제도와 큰돈까지");
    expect(k.levels[1].skipReason).toBe("no-ceremony");
    expect(k.passedLater).toEqual([]);
  });

  it("식 안 올림·L1 과 L3 만 통과 → '계약과 분쟁까지'(받지 않은 '견적 읽기'가 이름에 오지 않는다)", () => {
    const k = buildWc64Report(knowAns({ K10: 1, K11: 1, K12: 1 }, 5), "none").knowledge;
    expect(k.levels.map(l => l.state)).toEqual(["pass", "skip", "pass", "no"]);
    expect(k.stageName).toBe("계약과 분쟁까지");
    expect(k.stageName).not.toContain("견적 읽기");
  });

  it("식 올림·L2 를 모두 '해당 없음' → '제도와 큰돈까지', L2 는 해당 없음으로 뺐다고 적는다", () => {
    const k = buildWc64Report(knowAns({ K4: 0, K5: 0, K6: 0 }, 5), "yes").knowledge;
    expect(k.stageName).toBe("제도와 큰돈까지");
    expect(k.levels[1]).toMatchObject({ state: "skip", skipReason: "not-applicable" });
  });

  it("L1 만 '반반'이고 뒤는 모두 5 → 88%·0단계, 뒤에서 통과한 단계를 따로 준다", () => {
    const k = buildWc64Report(knowAns({ K1: 3, K2: 3, K3: 3 }, 5), "yes").knowledge;
    expect(k.pct).toBe(88);
    expect(k.stage).toBe(0);
    expect(k.stageName).toBe("이제 첫걸음");
    expect(k.passedLater).toEqual(["L2", "L3", "L4"]);
  });

  it("L1 통과, L2 아직, L3·L4 통과 → '순서와 용어까지'와 뒤 통과 L3·L4", () => {
    const k = buildWc64Report(knowAns({ K4: 1, K5: 1, K6: 1 }, 5), "yes").knowledge;
    expect(k.stageName).toBe("순서와 용어까지");
    expect(k.passedLater).toEqual(["L3", "L4"]);
  });
});

describe("알아 두면 좋은 것: 큰돈 문항부터(FIX-6)", () => {
  it("이해도를 모두 낮게 고르면 위약금·박람회·전세(K7·K8·K10)가 앞에 온다", () => {
    expect(buildWc64Report(knowAns({}, 1), "yes").knowledge.recheck.map(it => it.id)).toEqual(["K7", "K8", "K10"]);
  });
  it("식 안 올림이면 빠진 K7·K8 대신 전세·증여(K10·K12) 다음에, 식을 전제한 K1 카드는 건너뛰고 K3", () => {
    expect(buildWc64Report(knowAns({}, 1), "none").knowledge.recheck.map(it => it.id)).toEqual(["K10", "K12", "K3"]);
    // 식을 올리거나 아직이면 K1 카드도 나온다
    expect(buildWc64Report(knowAns({ K7: 5, K8: 5, K10: 5, K12: 5 }, 1), "maybe").knowledge.recheck[0].id).toBe("K1");
  });
  it("식 안 올림이면 어떤 답이든 '알아 두면 좋은 것' 카드에 식을 전제한 낱말이 없다(KNOWN_BANK_GAPS 없이)", () => {
    const shown = WC64_ITEMS.filter(it => it.level && !isWc64CeremonyOff(it.id, "none"));
    expect(shown.length).toBeGreaterThan(0);
    // 이해도를 하나씩만 낮게 고르면 그 카드가 반드시 나오거나(식 전제가 아니면) 안 나온다(식 전제면)
    for (const it of shown) {
      const r = buildWc64Report(knowAns({ [it.id]: 1 }, 5), "none");
      for (const c of r.knowledge.recheck) expect([c.id, CEREMONY_COPY.test(c.check_title + c.check_note)]).toEqual([c.id, false]);
      expect([it.id, r.knowledge.recheck.length]).toEqual([it.id, it.check_tag === "예식" ? 0 : 1]);
    }
  });
  it("큰돈 문항을 높게 고르면 남은 낮은 문항을 은행 순서로", () => {
    const r = buildWc64Report(knowAns({ K7: 5, K8: 5, K10: 5, K12: 5 }, 1), "yes");
    expect(r.knowledge.recheck.map(it => it.id)).toEqual(["K1", "K2", "K3"]);
  });
});

describe("동점 규칙을 결과에 담는다(FIX-4 가 문장을 고를 근거)", () => {
  const ruleOf = (ans: Wc64Answers, id: Wc64DimId) => {
    const d = buildWc64Report(ans, "yes").dims.find(x => x.dim === id)!;
    return d.decided ? { tie: d.tie, rule: d.tieRule, letter: d.letter } : null;
  };
  it("모두 '반반이에요'면 네 축 모두 마지막 규칙(앞 글자)", () => {
    for (const d of buildWc64Report(fill(3), "yes").dims) expect(d.decided && d.tieRule).toBe("default");
  });
  it("'완전히 그래요' 비율 → five", () => {
    const ans = fill(3); setDim(ans, "PACE", [1, 5, 3, 3, 3, 3], [4, 4, 3, 3, 2, 2]);
    expect(ruleOf(ans, "PACE")).toEqual({ tie: true, rule: "five", letter: "D" });
  });
  it("4·5 비율 → agree", () => {
    const ans = fill(3); setDim(ans, "PACE", [3, 3, 3, 3, 3, 3], [2, 4, 3, 3, 3, 3]);
    expect(ruleOf(ans, "PACE")).toEqual({ tie: true, rule: "agree", letter: "O" });
  });
  it("1·2 비율(적은 쪽) → disagree", () => {
    const ans = fill(3); setDim(ans, "PACE", [4, 4, 1, 3, 3, 3], [4, 4, 2, 2, 3, 3]);
    expect(ruleOf(ans, "PACE")).toEqual({ tie: true, rule: "disagree", letter: "D" });
  });
  it("동점이 아니면 null", () => {
    const ans = fill(3); setDim(ans, "PACE", [5, 5, 5, 5, 5, 5], [1, 1, 1, 1, 1, 1]);
    expect(ruleOf(ans, "PACE")).toEqual({ tie: false, rule: null, letter: "D" });
  });
});

describe("장면은 그 장면 묶음과 부딪히지 않는다(FIX-13)", () => {
  it("PACE 는 D 로 또렷한데 대화(TALK) 묶음만 반대쪽 → '의견이 갈릴 때'는 가운데 문장", () => {
    const ans = fill(3);
    for (const it of wc64SectionById("PLAN")!.items) ans[it.id] = it.pole === "A" ? 5 : 1;
    for (const it of wc64SectionById("CHOOSE")!.items) ans[it.id] = it.pole === "B" ? 5 : 1;
    for (const it of wc64SectionById("TALK")!.items) ans[it.id] = it.pole === "A" ? 2 : 4;
    const r = buildWc64Report(ans, "yes");
    const pace = r.dims.find(d => d.dim === "PACE")!;
    expect(pace.decided && [pace.letter, pace.level]).toEqual(["D", "clear"]);
    const disagree = r.scenes.find(s => s.id === "disagree")!;
    expect([disagree.section, disagree.facetPos, disagree.key]).toEqual(["TALK", "opp", "half"]);
    const vendor = r.scenes.find(s => s.id === "vendor")!;
    expect([vendor.section, vendor.facetPos, vendor.key]).toEqual(["CHOOSE", "same", "a"]);
  });

  it("무작위 답 300세트: 장면 묶음이 같은 쪽(same)이 아니면 단정 문장(a/b)이 나오지 않는다", () => {
    const rand = mulberry32(1013);
    let halfByFacet = 0;
    for (let n = 0; n < 300; n++) {
      const ans: Wc64Answers = {};
      for (const it of WC64_ITEMS) ans[it.id] = (1 + Math.floor(rand() * 5)) as Wc64Answer;
      for (const sc of buildWc64Report(ans, n % 2 ? "yes" : "none").scenes) {
        if (sc.facetPos !== null && sc.facetPos !== "same") { expect(sc.key, `${sc.id} ${sc.facetPos}`).toBe("half"); halfByFacet++ }
      }
    }
    expect(halfByFacet).toBeGreaterThan(0);
  });
});

describe("가족 묶음을 넘기면 가족 장면과 가족 줄을 뺀다(FIX-12)", () => {
  const FAMILY_WORDS = /부모님|양가|어른|상견례|자기 집|우리 집|상대 집|집안|생신|호칭/;
  const skipFamily = (ans: Wc64Answers) => { for (const it of wc64SectionById("FAMILY")!.items) ans[it.id] = 0; return ans };

  it("넘기면: 가족 장면 없음, skippedSections 에 FAMILY, BOND 묶음 줄은 '넘김'", () => {
    const ans = skipFamily(fill(4));
    for (const it of [...wc64SectionById("ROLES")!.items, ...wc64SectionById("LIFE")!.items]) ans[it.id] = it.pole === "A" ? 5 : 1;
    const r = buildWc64Report(ans, "yes", { FAMILY: true });
    const bond = r.dims.find(d => d.dim === "BOND")!;
    expect(bond.decided && bond.letter).toBe("M");
    expect(r.scenes.map(s => s.id)).not.toContain("family");
    expect(r.skippedSections).toEqual(["FAMILY"]);
    const fam = bond.decided ? bond.facets.find(f => f.section === "FAMILY") : undefined;
    expect(fam && !fam.decided && fam.reason).toBe("skipped");
    // 답 코드로 받은 상대 결과처럼 skipped 없이 0 만 있어도 같다
    expect(buildWc64Report(ans, "yes")).toEqual(r);
  });

  it("넘기면 BOND 장 문구(묻는 것·두 쪽 설명·닿는 결정·두 글자 카드)에 가족 낱말이 없다", () => {
    const bond = wc64DimById("BOND")!;
    const copy = wc64DimCopy(bond, ["FAMILY"]);
    const texts = [copy.question, copy.desc_a, copy.desc_b, ...copy.decisions];
    for (const L of [bond.letter_a, bond.letter_b]) {
      const c = wc64LetterCopy(bond, L, ["FAMILY"]);
      texts.push(...c.comfy, ...c.watch.map(w => w.text), ...c.app_actions, c.amora_line);
    }
    expect(texts.filter(t => FAMILY_WORDS.test(t))).toEqual([]);
    expect(copy.decisions.length).toBeGreaterThan(0);
  });

  it("넘기지 않으면 은행 문구 그대로(줄 표식은 같은 길이)", () => {
    const bond = wc64DimById("BOND")!;
    expect(wc64DimCopy(bond)).toEqual({ question: bond.question, desc_a: bond.desc_a, desc_b: bond.desc_b, decisions: bond.decisions });
    for (const L of [bond.letter_a, bond.letter_b]) {
      const card = bond.letters[L];
      expect(wc64LetterCopy(bond, L)).toEqual({ comfy: card.comfy, watch: card.watch, app_actions: card.app_actions, amora_line: card.amora_line });
    }
  });
});

describe("한눈에 보기와 단계 상한(FIX-15)", () => {
  it("67% 기울어 있어요 둘과 62% 또렷해요 하나면 또렷해요 글자가 먼저 온다", () => {
    const ans = fill(3);
    setDim(ans, "PACE", [4, 4, 4, 4, 4, 4], [3, 3, 3, 3, 3, 3]);
    setDim(ans, "CIRCLE", [5, 5, 5, 5, 1, 1], [1, 1, 1, 1, 5, 5]);
    setDim(ans, "BOND", [5, 5, 5, 5, 1, 1], [1, 1, 1, 1, 5, 5]);
    const r = buildWc64Report(ans, "yes");
    const lv = Object.fromEntries(r.dims.map(d => [d.dim, d.decided ? [d.letterPct, d.level] : null]));
    expect(lv).toMatchObject({ PACE: [62, "clear"], CIRCLE: [67, "lean"], BOND: [67, "lean"] });
    expect(r.glance.strong[0]).toBe("PACE");
  });

  it("같은 '기울어 있어요' 안에서는 % 크기가 아니라 단단함 순이다: 56%라도 더 한쪽으로 모인 글자가 67%보다 먼저 온다(2026-10-17 점검)", () => {
    // 화면 줄 이름이 '답이 가장 한쪽으로 모인 글자'다. % 순으로 세우면 R 이 더 큰 글자가 %가 낮다는 이유로 밀렸다.
    const ans = fill(3);
    setDim(ans, "PACE", [5, 5, 5, 5, 1, 1], [1, 1, 1, 1, 5, 5]);
    setDim(ans, "BOND", [4, 4, 4, 3, 3, 3], [3, 3, 3, 3, 3, 3]);
    const r = buildWc64Report(ans, "yes");
    const by = Object.fromEntries(r.dims.map(d => [d.dim, d]));
    const pace = by.PACE, bond = by.BOND;
    expect(pace.decided && [pace.letterPct, pace.level]).toEqual([67, "lean"]);
    expect(bond.decided && [bond.letterPct, bond.level]).toEqual([56, "lean"]);
    expect(pace.decided && bond.decided && pace.firm.R < bond.firm.R).toBe(true);
    expect(r.glance.strong).toEqual(["BOND", "PACE"]);
  });

  it("답한 문장이 8개보다 적어 또렷해요가 못 되면 cappedByN", () => {
    // PACE 를 묶음 둘에서 문장 6개만(앞 글자 쪽 3개는 5, 뒷 글자 쪽 3개는 1) 답한다
    const ans: Wc64Answers = { "PLAN-A1": 5, "PLAN-A2": 5, "PLAN-B1": 1, "CHOOSE-B1": 5, "CHOOSE-A1": 1, "CHOOSE-A2": 1 };
    const six = buildWc64Report(ans, "yes").dims.find(d => d.dim === "PACE")!;
    expect(six.decided && [six.letter, six.letterPct, six.n, six.level, six.cappedByN]).toEqual(["D", 100, 6, "lean", true]);
    const full: Wc64Answers = {};
    setDim(full, "PACE", [5, 5, 5, 5, 5, 5], [1, 1, 1, 1, 1, 1]);
    const twelve = buildWc64Report(full, "yes").dims.find(d => d.dim === "PACE")!;
    expect(twelve.decided && [twelve.level, twelve.cappedByN]).toEqual(["clear", false]);
  });
});

/* ---------------- 2026-10-16 파운더 결정 DEC-1·DEC-8, 1단계 검토 ---------------- */

const CEREMONY_COPY = /결혼식|식장|하객|청첩|스드메|본식|예식|식순|식대|보증인원|입장|드레스|스튜디오|웨딩|폐백|부케|메이크업|투어|피팅/;
const onePole = (pole: "A" | "B") => Object.fromEntries(WC64_ITEMS.map(it => [it.id, (it.pole === pole ? 5 : 1) as Wc64Answer]));

describe("식 없이 하면 두 글자로(DEC-1)", () => {
  it("예산 4문장은 식 계획과 상관없이 늘 글자 밖 막대(budget)로 나오고 SPEND 글자를 움직이지 않는다(2026-10-17, DEC-7 뒤집기)", () => {
    const ans = fill(3);
    for (const it of wc64SectionById("BUDGET")!.items) ans[it.id] = it.pole === "A" ? 5 : 2;
    const plans: (Wc64Plan | null)[] = ["none", "yes", "maybe", null];
    const bars = plans.map(p => buildWc64Report(ans, p).budget);
    expect(bars[0]).toMatchObject({ decided: true, n: 4 });
    if (bars[0].decided) { expect(bars[0].pctA).toBeGreaterThan(50); expect(bars[0].pctA + bars[0].pctB).toBe(100) }
    for (const b of bars) expect(b).toEqual(bars[0]);
    // 예산 답을 뒤집어도 SPEND 결과(%·단계·묶음)는 그대로다
    const flipped = { ...ans };
    for (const it of wc64SectionById("BUDGET")!.items) flipped[it.id] = it.pole === "A" ? 1 : 5;
    const spendOf = (a: Wc64Answers) => buildWc64Report(a, "yes").dims.find(d => d.dim === "SPEND");
    expect(spendOf(flipped)).toEqual(spendOf(ans));
    // 예산 답이 한쪽뿐이면 막대를 그리지 않는다
    const half: Wc64Answers = { "BUDGET-A1": 5, "BUDGET-A2": 4 };
    expect(buildWc64Report(half, "none").budget).toEqual({ decided: false, n: 2 });
    expect(buildWc64Report(half, "yes").budget).toEqual({ decided: false, n: 2 });
  });

  it("회귀(심사 ITEM-1): DAY·WEIGHT 가 L 쪽인데 예산을 넘기는 쪽(BUDGET B=5)이어도 SPEND 는 L 이다", () => {
    // 심사 재현: 예전에는 BUDGET 이 SPEND 안이라 이 답이 W 56% '기울어 있어요'로 나왔다.
    const ans = fill(3);
    Object.assign(ans, {
      "DAY-A1": 2, "DAY-A2": 3, "DAY-B1": 4, "DAY-B2": 3,
      "WEIGHT-A1": 2, "WEIGHT-A2": 3, "WEIGHT-B1": 4, "WEIGHT-B2": 4,
      "BUDGET-B1": 5, "BUDGET-B2": 5, "BUDGET-A1": 1, "BUDGET-A2": 1,
    });
    for (const plan of ["yes", "maybe"] as const) {
      const r = buildWc64Report(ans, plan);
      const spend = r.dims.find(d => d.dim === "SPEND")!;
      expect([plan, spend.decided && spend.letter]).toEqual([plan, "L"]);
      expect(r.code[1]).toBe("L");
      // 예산 쪽은 막대에서 따로 '마음에 들면 더 쓰는 쪽'으로 보인다
      expect(r.budget.decided && r.budget.pctB).toBe(100);
    }
    // 거울: 그날 쪽(DAY·WEIGHT 가 W)인데 정한 선을 지키는 사람(BUDGET A=5)은 W
    const mirror = fill(3);
    Object.assign(mirror, {
      "DAY-A1": 4, "DAY-A2": 3, "DAY-B1": 2, "DAY-B2": 3,
      "WEIGHT-A1": 4, "WEIGHT-A2": 3, "WEIGHT-B1": 2, "WEIGHT-B2": 2,
      "BUDGET-B1": 1, "BUDGET-B2": 1, "BUDGET-A1": 5, "BUDGET-A2": 5,
    });
    const m = buildWc64Report(mirror, "yes").dims.find(d => d.dim === "SPEND")!;
    expect(m.decided && m.letter).toBe("W");
  });

  it("식 없이 하면 hiddenTags 에 '예식'이 들고, 넘긴 묶음도 함께 든다", () => {
    const ans = fill(4);
    for (const it of wc64SectionById("FAMILY")!.items) ans[it.id] = 0;
    expect(buildWc64Report(ans, "none").hiddenTags).toEqual(["FAMILY", "예식"]);
    expect(buildWc64Report(ans, "yes").hiddenTags).toEqual(["FAMILY"]);
    expect(buildWc64Report(fill(4), "maybe").hiddenTags).toEqual([]);
  });

  it("식 없이 한 결과에 나올 수 있는 글자 장·장면 문구에는 식장·식대·보증인원·입장·본식·드레스숍 같은 말이 없다", () => {
    const hidden = ["예식"];
    const texts: string[] = [];
    for (const d of WC64_BANK.dims.filter(x => wc64DimPossible(x, "none"))) {
      const copy = wc64DimCopy(d, hidden);
      // balanced(아슬·반반 한 줄)와 couple_questions(다음에 해 볼 것·비교의 둘이 나눌 질문)는 표식 없이 그대로 나온다
      texts.push(copy.question, copy.desc_a, copy.desc_b, ...copy.decisions, d.balanced, ...d.couple_questions);
      for (const L of [d.letter_a, d.letter_b]) {
        const c = wc64LetterCopy(d, L, hidden);
        texts.push(...c.comfy, ...c.watch.map(w => w.text), ...c.app_actions, c.amora_line);
        // '챙겨 볼 것'과 '편하게 여기는 것'이 통째로 비지 않는다(제목만 남는 빈 칸 방지)
        expect([d.id, L, c.watch.length > 0, c.comfy.length > 0]).toEqual([d.id, L, true, true]);
      }
      for (const sc of WC64_BANK.scenes.filter(s => s.axis === d.id)) for (const k of ["a", "b", "half"] as const) texts.push(sc[k].here, sc[k].tip);
    }
    expect(texts.length).toBeGreaterThan(30);
    expect(texts.filter(t => CEREMONY_COPY.test(t))).toEqual([]);
    // 실제 none 리포트의 장면도 같다
    for (const pole of ["A", "B"] as const) {
      const r = buildWc64Report(onePole(pole), "none");
      expect(r.scenes.map(s => s.dim).every(d => d === "PACE" || d === "BOND")).toBe(true);
      expect(r.scenes.filter(s => CEREMONY_COPY.test(s.here + s.tip)).map(s => s.id)).toEqual([]);
    }
  });

  it("식을 올리면 같은 글자 장에서 식 전제 줄을 빼지 않는다(표식은 '예식'일 때만 거른다)", () => {
    const pace = wc64DimById("PACE")!;
    for (const L of ["D", "O"] as const) {
      const card = pace.letters[L];
      const tags = card.line_sections?.watch ?? [];
      const plain = card.watch.filter((_, i) => tags[i] !== "식없이");
      const noneOnly = card.watch.filter((_, i) => tags[i] === "식없이");
      expect(noneOnly.length).toBeGreaterThan(0);
      // 식을 올리면 '예식' 줄은 그대로 있고 '식없이' 줄은 없다
      expect(wc64LetterCopy(pace, L, []).watch).toEqual(plain);
      expect(wc64LetterCopy(pace, L, ["FAMILY"]).watch).toEqual(plain);
      // 식 없이 하면 '예식' 줄은 빠지고 '식없이' 줄이 남는다
      expect(wc64LetterCopy(pace, L, ["예식"]).watch).toEqual(card.watch.filter((_, i) => tags[i] !== "예식"));
      expect(wc64LetterCopy(pace, L, ["예식"]).watch).toEqual(expect.arrayContaining(noneOnly));
    }
    // 박람회 줄은 K8 처럼 식 없이 하면 빠진다
    expect(wc64LetterCopy(pace, "D", ["예식"]).watch.filter(w => /박람회/.test(w.text))).toEqual([]);
    expect(wc64DimCopy(pace, ["예식"]).decisions.length).toBeLessThan(pace.decisions.length);
  });

  it("유형 카드가 없을 때 정해진 글자 축의 '둘이 나눌 질문'에서 '다음에 해 볼 것' 2~3개를 고르고, 글자 장의 할 일을 되풀이하지 않는다", () => {
    for (const pole of ["A", "B"] as const) {
      const r = buildWc64Report(onePole(pole), "none");
      expect(r.type).toBeNull();
      const steps = wc64NextSteps(r);
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps.length).toBeLessThanOrEqual(3);
      for (const s of steps) {
        expect(["PACE", "BOND"]).toContain(s.dim);
        const dim = wc64DimById(s.dim)!;
        expect(dim.couple_questions).toContain(s.text);
        // 같은 결과의 글자 장 '해 볼 것'(app_actions)과 겹치지 않는다
        for (const L of [dim.letter_a, dim.letter_b]) expect(wc64LetterCopy(dim, L, r.hiddenTags).app_actions).not.toContain(s.text);
        expect(s.text).not.toMatch(CEREMONY_COPY);
      }
      expect(new Set(steps.map(s => s.dim)).size).toBe(2); // 두 글자에서 돌아가며 고른다
    }
    // 가족 묶음을 넘겨도 양가 이야기가 끼지 않는다
    const ans = onePole("A");
    for (const it of wc64SectionById("FAMILY")!.items) ans[it.id] = 0;
    const steps = wc64NextSteps(buildWc64Report(ans, "none"), 10);
    expect(steps.filter(s => /양가|상견례|경조사|상대 집안/.test(s.text))).toEqual([]);
    expect(wc64NextSteps(buildWc64Report({}, null))).toEqual([]);
  });

  it("내 답 전체의 자리: BUDGET 은 식 계획과 상관없이 예산 막대 이름, FUND 는 비용 막대 이름, 묻지 않은 문항은 null", () => {
    const budget = wc64SectionById("BUDGET")!;
    for (const it of budget.items) {
      const bar = it.pole === "A" ? WC64_BANK.budget_bar.a_name : WC64_BANK.budget_bar.b_name;
      for (const plan of ["none", "yes", "maybe", null] as const) {
        expect(wc64AnswerSide(it.id, plan)).toEqual({ kind: "bar", bar: "BUDGET", side: it.pole, name: bar });
      }
    }
    // 식을 올려도 SPEND 쪽으로 적히는 문항은 DAY·WEIGHT 여덟뿐이다
    const spendItems = WC64_ITEMS.filter(it => { const s = wc64AnswerSide(it.id, "yes"); return s?.kind === "letter" && s.dim === "SPEND" }).map(it => it.id);
    expect(spendItems.sort()).toEqual([...wc64SectionById("DAY")!.items, ...wc64SectionById("WEIGHT")!.items].map(it => it.id).sort());
    for (const it of wc64SectionById("FUND")!.items) {
      const side = wc64AnswerSide(it.id, "yes");
      expect(side).toEqual({ kind: "bar", bar: "FUND", side: it.pole, name: it.pole === "A" ? WC64_BANK.fund.a_name : WC64_BANK.fund.b_name });
    }
    expect(wc64AnswerSide("FUND-B1", "none")).toBeNull(); // '예식' 문항은 식 없이 하면 묻지 않았다
    expect(wc64AnswerSide("EYES-B1", "none")).toBeNull();
    expect(wc64AnswerSide("EYES-B1", "yes")).toEqual({ kind: "letter", dim: "CIRCLE", letter: "U" });
    expect(wc64AnswerSide("K1", "none")).toEqual({ kind: "knowledge" });
    expect(wc64AnswerSide("TALK-A1", "none")).toEqual({ kind: "letter", dim: "PACE", letter: "D" });
    expect(wc64AnswerSide("NOPE", "yes")).toBeNull();
    // 식 없이 하면 비워 둔 두 글자(SPEND·CIRCLE) 쪽으로 적히는 문항이 하나도 없다
    const blank = WC64_ITEMS.map(it => wc64AnswerSide(it.id, "none"))
      .filter(s => s?.kind === "letter" && (s.dim === "SPEND" || s.dim === "CIRCLE"));
    expect(blank).toEqual([]);
  });
});

describe("까닭: 본인이 고른 것을 먼저, 글자 까닭은 한 함수로(1단계 검토)", () => {
  it("식 없이 하는 사람이 남은 FUND 문장을 모두 '해당 없음'으로 고르면 묶음 까닭은 skipped, 문장이 다 빠진 묶음은 no-ceremony", () => {
    const ans = fill(4);
    ans["FUND-A1"] = 0; ans["FUND-B2"] = 0; ans["FUND-A2"] = 0; // FUND-B1 은 '예식'이라 빠진다
    const considered = wc64ConsideredAnswers(ans, "none");
    expect(wc64FacetSkipReason("FUND", "none", considered)).toBe("skipped");
    // EYES 는 2단계 검토로 네 문장 모두 '예식'이라 남은 문장이 없다
    expect(wc64FacetSkipReason("EYES", "none", wc64ConsideredAnswers(fill(4), "none"))).toBe("no-ceremony");
    expect(wc64FacetSkipReason("GUESTS", "none", considered)).toBe("no-ceremony"); // 남은 문장이 없다
    // 그래도 CIRCLE 글자의 까닭은 앱이 뺀 것(no-ceremony)이 먼저다
    expect(wc64DimSkipReason("CIRCLE", "none", considered)).toBe("no-ceremony");
  });

  it("식을 올리는 사람이 FORM·GUESTS·EYES 를 모두 '해당 없음'으로 고르면 CIRCLE 까닭은 skipped(답이 적어서가 아니다)", () => {
    const ans = fill(4);
    for (const s of ["FORM", "GUESTS", "EYES"]) for (const it of wc64SectionById(s)!.items) ans[it.id] = 0;
    const r = buildWc64Report(ans, "yes");
    const circle = r.dims.find(d => d.dim === "CIRCLE")!;
    expect(circle.decided ? null : circle.reason).toBe("skipped");
    expect(wc64DimSkipReason("CIRCLE", "yes", wc64ConsideredAnswers(ans, "yes"))).toBe("skipped");
    // 답을 그냥 안 한 것은 too-few
    const blank = fill(4);
    for (const s of ["FORM", "GUESTS", "EYES"]) for (const it of wc64SectionById(s)!.items) delete blank[it.id];
    const c2 = buildWc64Report(blank, "yes").dims.find(d => d.dim === "CIRCLE")!;
    expect(c2.decided ? null : c2.reason).toBe("too-few");
  });
});

describe("가족 묶음을 넘기면 유형 카드의 가족 줄도 뺀다(1단계 검토, FIX-12 이어서)", () => {
  const FAMILY_TALK = /양가|상견례|자기 집|각자 집|두 집|집안|여쭤|여쭐|자기 부모님|부모님께|부모님이/;
  it("16유형 모두 FAMILY 를 넘기면 meets·tips·first·later 에 양가에 여쭙거나 전하는 줄이 없다", () => {
    const left: string[] = [];
    for (const [code, card] of Object.entries(WC64_BANK.types)) {
      const c = wc64TypeCopy(card, ["FAMILY"]);
      for (const t of [...c.meets, ...c.tips, c.first, c.later]) if (FAMILY_TALK.test(t)) left.push(`${code}: ${t}`);
      expect([code, c.meets.length > 0 && c.tips.length > 0]).toEqual([code, true]);
    }
    expect(left).toEqual([]);
  });
  it("넘기지 않으면 은행 문구 그대로", () => {
    for (const card of Object.values(WC64_BANK.types)) {
      expect(wc64TypeCopy(card)).toEqual({ one_liner: card.one_liner, meets: card.meets, first: card.first, later: card.later, tips: card.tips });
    }
  });
});

/* ---------------- 2026-10-17 상품 심사(HON-1·HON-6·UX-1) ---------------- */

describe("단단함 수: 같은 글자와 반반을 따로 센다(심사 HON-1)", () => {
  it("성향 문장을 모두 3으로 두고 PLAN-A1 만 4 → 400가지 중 D 200, 반반 200(옛 agree 는 300)", () => {
    const f = firmness([4, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3], 6);
    expect([f.total, f.same, f.tie, f.agree]).toEqual([400, 200, 200, 300]);
    const ans = fill(3); ans["PLAN-A1"] = 4;
    const pace = buildWc64Report(ans, "yes").dims.find(d => d.dim === "PACE")!;
    expect(pace.decided && [pace.letter, pace.firm.total, pace.firm.same, pace.firm.tie]).toEqual(["D", 400, 200, 200]);
  });
  it("[4,4,3,3,3,3] 대 [3,3,3,3,3,2] → 같은 글자 360, 반반 40(옛 agree 380)", () => {
    const xs = [4, 4, 3, 3, 3, 3], ys = [3, 3, 3, 3, 3, 2];
    const f = firmness(xs, ys, axis(xs, ys)!.N);
    expect([f.total, f.same, f.tie, f.agree]).toEqual([400, 360, 40, 380]);
    // R 과 단계 기준은 그대로다(반반을 0.5 로 센 값)
    expect(f.R).toBe((f.same + f.tie / 2) / f.total);
  });
  it("동점(N = 0)이면 same 은 0 이고 tie 는 반반이 나온 수다", () => {
    const f = firmness([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3], 0);
    expect([f.same, f.tie, f.total]).toEqual([0, 400, 400]);
  });
});

describe("반반까지 칸 수는 반반을 지나칠 수 있다(심사 HON-6, 계산 쪽)", () => {
  it("5:6(해당 없음 하나)에서 N = -19, dist 4: 네 칸을 어떻게 옮겨도 N 이 0 에 서지 않고 반대 글자로 넘어간다", () => {
    const xs = [2, 1, 1, 1, 1], ys = [2, 2, 2, 2, 2, 1];
    const N = axis(xs, ys)!.N;
    expect(N).toBe(-19);
    const f = firmness(xs, ys, N);
    expect(f.dist).toBe(4);
    // 앞 글자 쪽 답을 한 칸 올리면 N 이 nY(6)만큼, 뒷 글자 쪽 답을 한 칸 내리면 nX(5)만큼 오른다.
    const landings = [0, 1, 2, 3, 4].map(a => N + 6 * a + 5 * (4 - a));
    expect(landings).not.toContain(0);
    expect(Math.min(...landings)).toBeGreaterThan(0);
    // 세 칸으로는 아직 원래 글자다
    expect(Math.max(...[0, 1, 2, 3].map(a => N + 6 * a + 5 * (3 - a)))).toBeLessThan(0);
  });
});

/** 그 유형(네 글자) 쪽으로만 끝까지 답한 답(이해도·FUND·BUDGET 은 안 답함) */
function pureAnswers(code: string): Wc64Answers {
  const ans: Wc64Answers = {};
  WC64_BANK.dims.forEach((dim, i) => {
    const toA = code[i] === dim.letter_a;
    for (const f of dim.facets) for (const it of wc64SectionById(f.axis)!.items) ans[it.id] = (it.pole === f.a_is) === toA ? 5 : 1;
  });
  return ans;
}
const TYPE_CODES = Object.keys(WC64_BANK.types);
/** 유형 카드와 네 글자 장(편한 것·챙겨 볼 것·할 일·아모라 한 줄)에서 이 사람에게 보이는 문장 전부 */
function shownCopy(r: ReturnType<typeof buildWc64Report>): string[] {
  const out: string[] = [];
  if (r.type) { const t = wc64TypeCopy(r.type, r.hiddenTags); out.push(t.one_liner, ...t.meets, t.first, t.later, ...t.tips) }
  for (const d of r.dims) {
    if (!d.decided) continue;
    const c = wc64LetterCopy(wc64DimById(d.dim)!, d.letter, r.hiddenTags);
    out.push(...c.comfy, ...c.watch.map(w => w.text), ...c.app_actions, c.amora_line);
  }
  return out.filter(Boolean);
}

describe("결과 문장은 내가 고른 답과 반대로 말하지 않는다(심사 UX-1)", () => {
  it("1·2를 고른 성향 문항만 disagreedItems 에 들고 hiddenTags 에도 든다(해당 없음·3·이해도는 넣지 않는다)", () => {
    const ans = fill(3);
    Object.assign(ans, { "FORM-B2": 2, "PLAN-A1": 1, "TALK-B1": 0, K1: 1, "LIFE-A1": 4 });
    const r = buildWc64Report(ans, "yes");
    expect(r.disagreedItems).toEqual(["PLAN-A1", "FORM-B2"]);
    expect(r.hiddenTags).toEqual(["PLAN-A1", "FORM-B2"]);
    // 식 없이 하면 빠진 '예식' 문항(FORM-B2)은 셈에 없으니 들지 않는다
    expect(buildWc64Report(ans, "none").disagreedItems).toEqual(["PLAN-A1"]);
  });

  it("16유형 모두: 그 유형 쪽으로만 답하면 유형 카드와 글자 장에서 빠지는 줄이 없다(문항 표식이 반대쪽 문항을 가리키지 않는다)", () => {
    for (const code of TYPE_CODES) {
      const r = buildWc64Report(pureAnswers(code), "yes");
      expect(r.code).toBe(code);
      expect([code, wc64TypeCopy(r.type!, r.hiddenTags)]).toEqual([code, wc64TypeCopy(r.type!)]);
      for (const d of r.dims) {
        if (!d.decided) continue;
        const dim = wc64DimById(d.dim)!;
        expect([code, d.dim, wc64LetterCopy(dim, d.letter, r.hiddenTags)]).toEqual([code, d.dim, wc64LetterCopy(dim, d.letter)]);
      }
    }
  });

  it("순수 OLUR(사진을 줄이는 쪽 끝까지)에게 사진·스냅·원본을 남기려 한다고 단정하는 문장이 하나도 없다", () => {
    const r = buildWc64Report(pureAnswers("OLUR"), "yes");
    expect(r.code).toBe("OLUR");
    const spend = r.dims.find(d => d.dim === "SPEND")!;
    expect(spend.decided && [spend.letterPct, spend.level]).toEqual([100, "clear"]);
    const KEEP_PHOTO = /(사진|스냅|원본|촬영)[^.]{0,20}(남기|간직|제대로|공을 들|돈을 더)/;
    expect(shownCopy(r).filter(t => KEEP_PHOTO.test(t))).toEqual([]);
  });

  it("FORM-B2(서약문 직접 쓰기)에 2를 고른 또렷한 U 에게는 서약문을 쓴다고 단정하는 줄과 서약문 할 일이 없다", () => {
    for (const code of TYPE_CODES.filter(c => c[2] === "U")) {
      const ans = pureAnswers(code); ans["FORM-B2"] = 2;
      const r = buildWc64Report(ans, "yes");
      const circle = r.dims.find(d => d.dim === "CIRCLE")!;
      expect([code, circle.decided && circle.letter, circle.decided && circle.level]).toEqual([code, "U", "clear"]);
      const u = wc64LetterCopy(wc64DimById("CIRCLE")!, "U", r.hiddenTags);
      expect([code, u.app_actions.filter(t => /서약/.test(t))]).toEqual([code, []]);
      // 남은 '서약' 문장은 '쓰기로 하면'처럼 조건으로만 말한다
      expect([code, shownCopy(r).filter(t => /서약/.test(t) && !/(하면|했다면)/.test(t))]).toEqual([code, []]);
    }
    // 서약에 4를 고르면 할 일이 나온다
    const yes = buildWc64Report(pureAnswers("DWUM"), "yes");
    expect(wc64LetterCopy(wc64DimById("CIRCLE")!, "U", yes.hiddenTags).app_actions.some(t => /서약/.test(t))).toBe(true);
  });

  it("은행의 문항 표식은 모두 그 문항에 1·2를 고를 때만 빠진다(3·4·5·해당 없음이면 남는다)", () => {
    const tagged: { where: string; tag: string; text: string }[] = [];
    const add = (where: string, tags: readonly string[] | string | undefined, texts: readonly string[] | string) => {
      const ts = Array.isArray(tags) ? tags : [tags ?? ""];
      const xs = Array.isArray(texts) ? texts : [texts];
      ts.forEach((t, i) => { for (const one of (t ?? "").split(",")) if (wc64ItemByIdSafe(one)) tagged.push({ where, tag: one, text: xs[i] }) });
    };
    for (const [code, t] of Object.entries(WC64_BANK.types)) {
      const ls = t.line_sections ?? {};
      add(`${code}.meets`, ls.meets, t.meets); add(`${code}.tips`, ls.tips, t.tips);
      add(`${code}.first`, ls.first, t.first); add(`${code}.later`, ls.later, t.later);
    }
    for (const d of WC64_BANK.dims) for (const L of Object.values(d.letters)) {
      const ls = L.line_sections ?? {};
      add(`${d.id}.${L.letter}.comfy`, ls.comfy, L.comfy); add(`${d.id}.${L.letter}.app_actions`, ls.app_actions, L.app_actions);
      add(`${d.id}.${L.letter}.watch`, ls.watch, L.watch.map(w => w.text));
    }
    expect(tagged.length).toBeGreaterThan(20);
    for (const { where, tag } of tagged) {
      for (const v of [1, 2, 3, 4, 5, 0] as const) {
        const ans = fill(3); ans[tag] = v;
        expect([where, tag, v, buildWc64Report(ans, "yes").hiddenTags.includes(tag)]).toEqual([where, tag, v, v === 1 || v === 2]);
      }
    }
  });

  it("유형 한 줄(one_liner)은 거르지 않으므로 서약·폐백 같은 한 문항의 행동을 말하지 않는다", () => {
    expect(Object.entries(WC64_BANK.types).filter(([, t]) => /서약|폐백/.test(t.one_liner)).map(([c]) => c)).toEqual([]);
  });
});

/** 성향 문항 id 면 그 문항(표식 값이 묶음 id·'예식'·'식없이'이면 undefined) */
function wc64ItemByIdSafe(id: string) {
  return WC64_ITEMS.find(it => it.id === id && it.pole !== "L");
}

/* ---------------- 2026-10-17 파운더 결정: 결과 이름(형용사 + 동물) ---------------- */

describe("결과 이름: 형용사 + 동물(2026-10-17 파운더 결정)", () => {
  const withLabel = (n: { adjective: string; animal: string }) => ({ adjective: n.adjective, animal: n.animal, label: `${n.adjective} ${n.animal}` });
  const DOT = "\u00B7";
  /** 한 축의 답을 모두 지운다(그 글자를 정하지 못하게) */
  const clearDim = (ans: Wc64Answers, dimId: Wc64DimId) => {
    for (const f of wc64DimById(dimId)!.facets) for (const it of wc64SectionById(f.axis)!.items) delete ans[it.id];
    return ans;
  };

  it("16가지 순수 답 묶음마다 report.name 이 그 유형 이름이다(식을 올려도, 아직 정하지 않아도)", () => {
    for (const code of TYPE_CODES) for (const plan of ["yes", "maybe"] as const) {
      const r = buildWc64Report(pureAnswers(code), plan);
      expect([code, plan, r.code, r.name]).toEqual([code, plan, code, withLabel(WC64_BANK.types[code].name)]);
      expect(r.name!.label).toMatch(/^[가-힣]+ [가-힣]+$/);
    }
  });

  it("식 계획이 있는 결과에서 글자 하나라도 못 정하면 이름이 없다(null)", () => {
    for (const code of TYPE_CODES) for (const dim of WC64_BANK.dims) {
      const r = buildWc64Report(clearDim(pureAnswers(code), dim.id), "yes");
      expect([code, dim.id, r.code.includes(DOT), r.type, r.name]).toEqual([code, dim.id, true, null, null]);
    }
    expect(buildWc64Report({}, null).name).toBeNull();
  });

  it("식 없이: 남는 두 글자(D/O·M/R)를 모두 정하면 그 두 글자 이름이고, 하나라도 못 정하면 null", () => {
    for (const code of TYPE_CODES) {
      const r = buildWc64Report(pureAnswers(code), "none");
      const key = `${code[0]}${DOT}${DOT}${code[3]}`;
      expect([code, r.code, r.type, r.name]).toEqual([code, key, null, withLabel(WC64_BANK.no_ceremony_names[key])]);
    }
    for (const dimId of ["PACE", "BOND"] as const) {
      const r = buildWc64Report(clearDim(pureAnswers("DWCM"), dimId), "none");
      expect([dimId, r.code.split("").filter(c => c !== DOT).length, r.name]).toEqual([dimId, 1, null]);
    }
    // 같은 답이라도 식을 올리면 식 없이 이름이 아니라 유형 이름이다
    expect(buildWc64Report(pureAnswers("OLUR"), "yes").name).toEqual(withLabel(WC64_BANK.types.OLUR.name));
  });

  it("참고로만 결과(아슬·반반 글자 둘 이상, 같은 칸 알림)에도 이름이 있다", () => {
    const r = buildWc64Report(fill(3), "yes");
    expect(r.glance.shaky.length).toBeGreaterThanOrEqual(2);
    expect(r.patterns).toContain("same");
    expect(r.name).toEqual(withLabel(WC64_BANK.types[r.code].name));
    const n = buildWc64Report(fill(3), "none");
    expect(n.glance.shaky).toEqual(["PACE", "BOND"]);
    expect(n.name).toEqual(withLabel(WC64_BANK.no_ceremony_names[n.code]));
  });
});
