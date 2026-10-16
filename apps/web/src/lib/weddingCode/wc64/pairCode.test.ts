import { describe, expect, it } from "vitest";
import { WC64_ITEMS, WC64_ORDER, wc64SectionById } from "./bank";
import { buildWc64Report, wc64ConsideredAnswers } from "./model";
import {
  WC64_PAIR_LENGTH, WC64_PAIR_PREFIX, decodeWc64PairCode, encodeWc64PairCode, normalizeWc64PairCode,
} from "./pairCode";
import type { Wc64Answer, Wc64Answers, Wc64Plan, Wc64Skipped } from "./types";

// 시드 고정 난수(mulberry32): 실패하면 같은 세트로 다시 볼 수 있다.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLANS: Wc64Plan[] = ["yes", "maybe", "none"];

function randomCase(r: () => number): { answers: Wc64Answers; plan: Wc64Plan; skipped: Wc64Skipped } {
  const answers: Wc64Answers = {};
  for (const it of WC64_ITEMS) {
    const x = r();
    if (x < 0.1) continue; // 안 답함
    if (x < 0.2) { answers[it.id] = 0; continue; } // 해당 없음
    answers[it.id] = (1 + Math.floor(r() * 5)) as Wc64Answer;
  }
  const plan = PLANS[Math.floor(r() * 3)];
  const skipped: Wc64Skipped = {};
  if (plan === "none" && r() < 0.5) skipped.GUESTS = false; // 식 대신 다른 자리로 답하기
  if (r() < 0.2) { skipped.FAMILY = true; for (const it of wc64SectionById("FAMILY")!.items) answers[it.id] = 0; }
  return { answers, plan, skipped };
}

const strip = (code: string) => normalizeWc64PairCode(code);

describe("wc64 답 코드", () => {
  it("문항 64개를 WC64_ORDER 의 묶음·문항 순서로 한 글자씩 적는다", () => {
    const order = WC64_ORDER.flatMap(sid => wc64SectionById(sid)!.items.map(it => it.id));
    expect(order).toHaveLength(64);
    expect(WC64_ITEMS.map(it => it.id)).toEqual(order);
    const answers: Wc64Answers = {};
    order.forEach((id, i) => { if (i % 7 === 3) answers[id] = 0; else if (i % 7 !== 5) answers[id] = ((i % 5) + 1) as Wc64Answer; });
    const s = strip(encodeWc64PairCode(answers, "yes"));
    const digits = s.slice(6, 70);
    order.forEach((id, i) => {
      const want = !(id in answers) ? "0" : answers[id] === 0 ? "9" : String(answers[id]);
      expect(digits[i], id).toBe(want);
    });
  });

  it("길이는 하이픈을 빼고 늘 72자, 답 자리는 늘 64자다", () => {
    expect(WC64_PAIR_LENGTH).toBe(72);
    for (const c of [encodeWc64PairCode({}, null), encodeWc64PairCode({ [WC64_ITEMS[0].id]: 5 }, "none")]) {
      const s = strip(c);
      expect(s).toHaveLength(72);
      expect(s.startsWith(WC64_PAIR_PREFIX)).toBe(true);
      expect(s.slice(6, 70)).toMatch(/^[0-59]{64}$/);
      // 사람이 읽게 4~8자마다 하이픈
      for (const g of c.split("-")) { expect(g.length).toBeGreaterThanOrEqual(4); expect(g.length).toBeLessThanOrEqual(8); }
    }
  });

  it("무작위 답 300세트 왕복: 답·해당 없음·안 답함·식 계획이 그대로 돌아오고 결과도 같다", () => {
    const r = rng(20261016);
    let sawNone = 0, sawAlt = 0, sawNa = 0, sawMissing = 0;
    for (let n = 0; n < 300; n++) {
      const { answers, plan, skipped } = randomCase(r);
      const code = encodeWc64PairCode(answers, plan, skipped);
      const d = decodeWc64PairCode(code);
      expect(d.ok, code).toBe(true);
      if (!d.ok) continue;
      expect(d.plan).toBe(plan);
      const considered = wc64ConsideredAnswers(answers, plan, skipped);
      expect(d.answers).toEqual(considered);
      expect(buildWc64Report(d.answers, d.plan, d.skipped)).toEqual(buildWc64Report(answers, plan, skipped));
      if (plan !== "none") expect(d.answers).toEqual(wc64ConsideredAnswers(answers, plan));
      if (plan === "none") sawNone++;
      if (skipped.GUESTS === false) sawAlt++;
      sawNa += Object.values(d.answers).filter(v => v === 0).length;
      sawMissing += WC64_ITEMS.filter(it => !(it.id in d.answers)).length;
    }
    expect(sawNone).toBeGreaterThan(50);
    expect(sawAlt).toBeGreaterThan(20);
    expect(sawNa).toBeGreaterThan(500);
    expect(sawMissing).toBeGreaterThan(500);
  });

  it("해당 없음(0)과 안 답함(키 없음)을 구분해 지킨다", () => {
    const [a, b, c] = WC64_ITEMS;
    const d = decodeWc64PairCode(encodeWc64PairCode({ [a.id]: 0, [c.id]: 4 }, "yes"));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.answers[a.id]).toBe(0);
    expect(b.id in d.answers).toBe(false);
    expect(d.answers[c.id]).toBe(4);
  });

  it("식을 안 올리는 사람이 다른 자리로 답한 묶음은 그대로 살아난다", () => {
    const guests = wc64SectionById("GUESTS")!.items;
    const answers: Wc64Answers = Object.fromEntries(guests.map(it => [it.id, 5]));
    const kept = decodeWc64PairCode(encodeWc64PairCode(answers, "none", { GUESTS: false }));
    const dropped = decodeWc64PairCode(encodeWc64PairCode(answers, "none"));
    expect(kept.ok && dropped.ok).toBe(true);
    if (!kept.ok || !dropped.ok) return;
    expect(kept.skipped).toEqual({ GUESTS: false });
    expect(Object.keys(kept.answers)).toHaveLength(4);
    expect(dropped.skipped).toEqual({});
    // 식 문항은 안 답함으로 적혀 상대에게 가지 않는다
    expect(Object.keys(dropped.answers)).toEqual(guests.filter(it => it.skip_tag !== "예식").map(it => it.id));
  });

  it("하이픈·공백·줄바꿈·소문자를 무시한다", () => {
    const r = rng(7);
    const { answers, plan, skipped } = randomCase(r);
    const code = encodeWc64PairCode(answers, plan, skipped);
    const flat = strip(code);
    const variants = [
      code.toLowerCase(),
      flat,
      flat.replace(/(.{5})/g, "$1 "),
      `  ${code.replace(/-/g, " - ")}\n`,
      code.replace(/-/g, "\n"),
      code.replace(/-/g, "–"),
    ];
    for (const v of variants) {
      const d = decodeWc64PairCode(v);
      expect(d.ok, v).toBe(true);
      if (d.ok) expect(d.answers).toEqual(wc64ConsideredAnswers(answers, plan, skipped));
    }
  });

  it("어느 한 글자를 바꿔도 거절한다(판 문자는 '다른 판', 나머지는 '틀린 글자가 있어요')", () => {
    const r = rng(99);
    const ALPH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let n = 0; n < 20; n++) {
      const { answers, plan, skipped } = randomCase(r);
      const flat = strip(encodeWc64PairCode(answers, plan, skipped));
      for (let i = 0; i < flat.length; i++) {
        for (const ch of ALPH) {
          if (ch === flat[i]) continue;
          const bad = flat.slice(0, i) + ch + flat.slice(i + 1);
          const d = decodeWc64PairCode(bad);
          expect(d.ok, `${i}:${ch}`).toBe(false);
          if (d.ok) continue;
          if (i < 4) expect(d.kind).toBe("not-wc64");
          else if (i === 4) { expect(d.kind).toBe("other-edition"); expect(d.reason).toBe("다른 판 코드예요. 같은 질문에 답한 코드끼리만 나란히 볼 수 있어요."); }
          else { expect(d.kind).toBe("typo"); expect(d.reason).toContain("틀린 글자가 있어요"); }
        }
      }
    }
  });

  it("이웃한 두 답 글자가 뒤바뀌어도 거절한다", () => {
    const r = rng(5);
    const { answers, plan, skipped } = randomCase(r);
    const flat = strip(encodeWc64PairCode(answers, plan, skipped));
    for (let i = 6; i < 69; i++) {
      if (flat[i] === flat[i + 1]) continue;
      const bad = flat.slice(0, i) + flat[i + 1] + flat[i] + flat.slice(i + 2);
      expect(decodeWc64PairCode(bad).ok, String(i)).toBe(false);
    }
  });

  it("다른 판·잘린 코드·빈 칸·남의 글자를 거절하고 이유를 준다", () => {
    const flat = strip(encodeWc64PairCode({}, "yes"));
    const otherEdition = decodeWc64PairCode(`WC64B${flat.slice(5)}`);
    expect(otherEdition).toMatchObject({ ok: false, kind: "other-edition" });
    for (const cut of [flat.slice(0, 71), flat.slice(0, 40), flat.slice(0, 6), "WC6"]) {
      const d = decodeWc64PairCode(cut);
      expect(d, cut).toMatchObject({ ok: false, kind: "length" });
      if (!d.ok) expect(d.reason).toContain("코드가 잘렸어요");
    }
    expect(decodeWc64PairCode(`${flat}2`)).toMatchObject({ ok: false, kind: "typo" });
    expect(decodeWc64PairCode("")).toMatchObject({ ok: false, kind: "empty" });
    expect(decodeWc64PairCode("  - \n")).toMatchObject({ ok: false, kind: "empty" });
    expect(decodeWc64PairCode("https://hanbang.ai/wedding-code")).toMatchObject({ ok: false, kind: "not-wc64" });
    expect(decodeWc64PairCode(undefined as unknown as string)).toMatchObject({ ok: false, kind: "empty" });
  });

  it("식 계획이 없으면(null) 계산이 같은 'M' 으로 적는다", () => {
    const s = strip(encodeWc64PairCode({}, null));
    expect(s[5]).toBe("M");
    const d = decodeWc64PairCode(s);
    expect(d).toMatchObject({ ok: true, plan: "maybe" });
  });
});
