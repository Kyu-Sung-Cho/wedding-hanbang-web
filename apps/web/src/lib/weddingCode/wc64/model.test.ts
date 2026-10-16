import { describe, expect, it } from "vitest";
import { WC64_BANK, WC64_ITEMS, wc64SectionById } from "./bank";
import {
  axis, buildWc64Report, displayPct, firmness, knowledge, level, patterns, scoreDim,
} from "./model";
import type { Wc64Answer, Wc64Answers, Wc64Plan, Wc64Skipped } from "./types";

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
    let stage = 0
    for (const l of levels) { if (l.state === 'skip') continue; if (l.state === 'pass') stage++; else break }
    return { pct: total, levels, stage, n: got.length }
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

/** page6-shell.html 의 결과 계산(compute + facetView + quotes) 그대로 */
function refCompute(WC: any, rawAnswers: any, plan: any, skipped: any) {
  const E = REF
  const secById = Object.fromEntries(WC.sections.map((s: any) => [s.id, s]))
  const ceremonyOff = (it: any) => plan === 'none' && it.skip_tag === '예식' && !(secById[it.sid].noceremony_alt && skipped[it.sid] === false)
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
  it("축마다 문항 12개, 양쪽 6개씩", () => {
    for (const dim of WC64_BANK.dims) {
      let x = 0, y = 0;
      for (const f of dim.facets) for (const it of wc64SectionById(f.axis)!.items) { if (it.pole === f.a_is) x++; else y++ }
      expect([dim.id, x, y]).toEqual([dim.id, 6, 6]);
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
    expect(r.answered).toBe(48); // 네 축의 12묶음 × 4 (FUND·KNOW 는 안 답함)
    expect(r.knowledge.pct).toBeNull();
    expect(r.fund.decided).toBe(false);
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

  it("식 안 올림이면 CIRCLE 이 decided:false(사유 no-ceremony)이고 예식 문항은 셈에서 빠진다", () => {
    const r = buildWc64Report(fill(4), "none");
    const circle = r.dims.find(d => d.dim === "CIRCLE")!;
    expect(circle.decided).toBe(false);
    if (!circle.decided) expect(circle.reason).toBe("no-ceremony");
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
      const ref = refCompute(WC64_BANK, ans, plan, skipped);
      const got = buildWc64Report(ans, plan, skipped);

      expect(got.code).toBe(ref.code);
      ref.dims.forEach((rd: { decided: boolean; [k: string]: unknown }, i: number) => {
        const gd = got.dims[i];
        expect(gd.decided).toBe(rd.decided);
        expect(gd.n).toBe(rd.n);
        if (!gd.decided || !rd.decided) return;
        decidedCount++; if (gd.tie) tieCount++; levels.add(gd.level);
        expect({
          letter: gd.letter, letterSide: gd.letterSide, tie: gd.tie, pctX: gd.pctX, pctY: gd.pctY, exact: gd.exact,
          agreeX: gd.agreeX, agreeY: gd.agreeY, level: gd.level, firm: gd.firm,
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
      for (const dim of WC64_BANK.dims) expect(scoreDim(dim, WC64_BANK.sections, ans)).toEqual(REF.scoreDim(dim, WC64_BANK.sections, ans));
      const know = wc64SectionById("KNOW")!.items;
      expect(knowledge(know, ans)).toEqual(REF.knowledge(know, ans));
      const tend = WC64_BANK.sections.filter(s => s.kind === "bipolar").flatMap(s => s.items);
      expect(patterns(tend, ans)).toEqual(REF.patterns(tend, ans));
    }
  });
});
