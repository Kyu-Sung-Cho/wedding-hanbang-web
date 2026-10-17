import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WC64_ITEMS, WC64_ORDER, wc64SectionById } from "./bank";
import { buildWc64Report, wc64ConsideredAnswers } from "./model";
import {
  WC64_PAIR_EDITION, WC64_PAIR_LENGTH, WC64_PAIR_PREFIX, decodeWc64PairCode, encodeWc64PairCode, normalizeWc64PairCode,
  wc64PairShareMessage,
} from "./pairCode";
import { WC64_VERSION, type Wc64Answer, type Wc64Answers, type Wc64Plan, type Wc64Skipped } from "./types";

/**
 * 답 코드가 기대는 은행 모양의 지문: 묶음 순서, 문항마다 id·극·식 표시(skip_tag)·문장.
 * 답 글자는 자리로만 문항에 붙으므로 이 중 하나라도 바뀌면 옛 코드가 오류 없이 다른 뜻으로 읽힌다.
 * (묶음마다 '다른 자리' 안내 유무도 넣었으나 2026-10-16 DEC-1 로 그 갈래가 없어져 뺐다.)
 */
function bankFingerprint(): string {
  const rows = WC64_ORDER.flatMap(sid => {
    const sec = wc64SectionById(sid)!;
    return [sid, ...sec.items.map(it => [it.id, it.pole, it.skip_tag, it.text].join("|"))];
  });
  return createHash("sha256").update(rows.join("\n"), "utf8").digest("hex");
}

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
  if (r() < 0.2) { skipped.FAMILY = true; for (const it of wc64SectionById("FAMILY")!.items) answers[it.id] = 0; }
  return { answers, plan, skipped };
}

const strip = (code: string) => normalizeWc64PairCode(code);

/** 화면이 만들지 않는 코드(손으로 만든 코드)를 시험하려고 pairCode.ts 머리 주석의 검사 문자 규칙을 그대로 옮겼다 */
function encodeRaw(planChar: "Y" | "M" | "N", digits: string): string {
  const ALPH = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = { Y: 1, M: 2, N: 3 }[planChar];
  for (let i = 0; i < digits.length; i++) s += (i + 2) * Number(digits[i]);
  const v = s % 887;
  return `${WC64_PAIR_PREFIX}${WC64_PAIR_EDITION}${planChar}${digits}${ALPH[Math.floor(v / 30)]}${ALPH[v % 30]}`;
}

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
    let sawNone = 0, sawNa = 0, sawMissing = 0;
    for (let n = 0; n < 300; n++) {
      const { answers, plan, skipped } = randomCase(r);
      const code = encodeWc64PairCode(answers, plan);
      const d = decodeWc64PairCode(code);
      expect(d.ok, code).toBe(true);
      if (!d.ok) continue;
      expect(d.plan).toBe(plan);
      const considered = wc64ConsideredAnswers(answers, plan);
      expect(d.answers).toEqual(considered);
      expect(buildWc64Report(d.answers, d.plan, d.skipped)).toEqual(buildWc64Report(answers, plan, skipped));
      if (plan !== "none") expect(d.answers).toEqual(wc64ConsideredAnswers(answers, plan));
      if (plan === "none") sawNone++;
      sawNa += Object.values(d.answers).filter(v => v === 0).length;
      sawMissing += WC64_ITEMS.filter(it => !(it.id in d.answers)).length;
    }
    expect(sawNone).toBeGreaterThan(50);
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

  it("식 없이 하는 사람의 '예식' 문항은 답이 있어도 안 답함으로 적는다(DEC-1)", () => {
    const answers: Wc64Answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, 5]));
    const ceremony = WC64_ITEMS.filter(it => it.skip_tag === "예식");
    expect(ceremony.length).toBeGreaterThan(0);
    // 묶음 넘기기 상태는 코드에 싣지 않는다: 옛 '다른 자리' 갈래 기록(GUESTS: false)을 넘길 인자부터 없다(2026-10-17 CQ-5)
    const plain = encodeWc64PairCode(answers, "none");
    const d = decodeWc64PairCode(plain);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.skipped).toEqual({});
    for (const it of ceremony) expect(it.id in d.answers, it.id).toBe(false);
    // GUESTS 는 모두 '예식' 문항이라 식 없이 하면 통째로 빠진다
    for (const it of wc64SectionById("GUESTS")!.items) expect(it.id in d.answers, it.id).toBe(false);
    expect(Object.keys(d.answers)).toHaveLength(WC64_ITEMS.length - ceremony.length);
    // 손으로 만든 N 코드에 '예식' 답이 실려 와도 계산처럼 버린다
    const flat = strip(encodeWc64PairCode(answers, "yes"));
    const digits = flat.slice(6, 70);
    const forged = decodeWc64PairCode(encodeRaw("N", digits));
    expect(forged.ok).toBe(true);
    if (forged.ok) for (const it of ceremony) expect(it.id in forged.answers, it.id).toBe(false);
  });

  it("하이픈·공백·줄바꿈·소문자를 무시한다", () => {
    const r = rng(7);
    const { answers, plan } = randomCase(r);
    const code = encodeWc64PairCode(answers, plan);
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
      if (d.ok) expect(d.answers).toEqual(wc64ConsideredAnswers(answers, plan));
    }
  });

  it("어느 한 글자를 바꿔도 거절한다(판 문자는 '다른 판', 나머지는 '틀린 글자가 있어요')", () => {
    const r = rng(99);
    const ALPH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let n = 0; n < 20; n++) {
      const { answers, plan } = randomCase(r);
      const flat = strip(encodeWc64PairCode(answers, plan));
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
    const { answers, plan } = randomCase(r);
    const flat = strip(encodeWc64PairCode(answers, plan));
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
    // 코드 가운데에 글자 하나가 끼면 자리가 밀려 거절한다(끝에 붙은 글자는 아래 붙여넣기 시험처럼 버린다)
    expect(decodeWc64PairCode(`${flat.slice(0, 30)}3${flat.slice(30)}`)).toMatchObject({ ok: false, kind: "typo" });
    expect(decodeWc64PairCode("")).toMatchObject({ ok: false, kind: "empty" });
    expect(decodeWc64PairCode("  - \n")).toMatchObject({ ok: false, kind: "empty" });
    expect(decodeWc64PairCode("아무 말이나 적었어요")).toMatchObject({ ok: false, kind: "not-wc64" });
    expect(decodeWc64PairCode(undefined as unknown as string)).toMatchObject({ ok: false, kind: "empty" });
  });

  it("붙여넣기 다섯 경우(앞에 붙은 말·따옴표·끝 마침표·두 번 붙임·전각 하이픈)와 복사한 안내 글 통째를 읽는다", () => {
    const r = rng(31);
    const { answers, plan } = randomCase(r);
    const code = encodeWc64PairCode(answers, plan);
    const want = wc64ConsideredAnswers(answers, plan);
    const cases: [string, string][] = [
      ["앞에 붙은 말", `내 웨딩코드 답 코드야 ${code}`],
      ["따옴표", `“${code}”`],
      ["끝 마침표", `${code}.`],
      ["두 번 붙임", `${code}\n${code}`],
      ["전각 하이픈", code.replace(/-/g, "－")],
      ["안내 글 통째", wc64PairShareMessage(code, "https://hanbang.ai/wedding-code")],
    ];
    for (const [name, text] of cases) {
      const d = decodeWc64PairCode(text);
      expect(d.ok, name).toBe(true);
      if (!d.ok) continue;
      expect(d.answers, name).toEqual(want);
      expect(d.plan, name).toBe(plan);
      expect(d.code, name).toBe(strip(code));
    }
    // 앞에 말이 붙은 잘린 코드·틀린 코드는 모양이 아니라 실제 까닭으로 거절한다
    const flat = strip(code);
    expect(decodeWc64PairCode(`내 코드야 ${flat.slice(0, 40)}`)).toMatchObject({ ok: false, kind: "length" });
    const typo = flat.slice(0, 20) + (flat[20] === "5" ? "4" : "5") + flat.slice(21);
    expect(decodeWc64PairCode(`내 코드야 ${typo}.`)).toMatchObject({ ok: false, kind: "typo" });
    // 틀린 코드 뒤에 다시 보낸 맞는 코드가 있으면 맞는 쪽을 읽는다
    expect(decodeWc64PairCode(`${typo}\n아까 건 잘못 보냈어 ${code}`)).toMatchObject({ ok: true, code: flat });
    // 안내 글은 코드 말고는 'WC64' 를 쓰지 않는다(잘린 코드를 찾을 때 헷갈리지 않게)
    expect(normalizeWc64PairCode(wc64PairShareMessage("", "https://hanbang.ai/wedding-code"))).not.toContain(WC64_PAIR_PREFIX);
  });

  it("폭 없는 글자(U+200B~U+200D, U+FEFF)가 코드 사이에 끼어도 잘린 코드로 보지 않고 읽는다", () => {
    const r = rng(43);
    const { answers, plan } = randomCase(r);
    const flat = strip(encodeWc64PairCode(answers, plan));
    for (const cp of [0x200b, 0x200c, 0x200d, 0xfeff]) {
      const zw = String.fromCharCode(cp);
      const text = `${zw}${flat.slice(0, 20)}${zw}${flat.slice(20, 50)}${zw}${zw}${flat.slice(50)}${zw}`;
      const d = decodeWc64PairCode(text);
      expect(d.ok, cp.toString(16)).toBe(true);
      if (d.ok) expect(d.code, cp.toString(16)).toBe(flat);
    }
  });

  it("서로 다른 코드가 여럿이면 내 코드를 빼고 남은 하나를 읽고, 그래도 둘 이상이면 고르지 않고 되묻는다", () => {
    const mine = encodeWc64PairCode(Object.fromEntries(WC64_ITEMS.map(it => [it.id, 5])), "yes");
    const theirs = encodeWc64PairCode(Object.fromEntries(WC64_ITEMS.map(it => [it.id, 1])), "yes");
    const again = encodeWc64PairCode(Object.fromEntries(WC64_ITEMS.map(it => [it.id, 2])), "none");
    const address = "https://hanbang.ai/wedding-code";
    // 대화방을 통째로 복사: 내가 보낸 안내 글이 먼저, 상대 답장이 뒤에
    const chat = `${wc64PairShareMessage(mine, address)}\n[상대] 나도 했어 ${theirs}`;
    expect(decodeWc64PairCode(chat, { mine })).toMatchObject({ ok: true, code: strip(theirs) });
    // 순서가 거꾸로여도, 내 코드를 하이픈 없이 넘겨도 같다
    expect(decodeWc64PairCode(`${theirs}\n${mine}`, { mine: strip(mine) })).toMatchObject({ ok: true, code: strip(theirs) });
    // 내 코드만 있으면 내 코드를 읽는다(화면이 '내 코드와 같아요'를 알린다)
    expect(decodeWc64PairCode(`${mine}\n${mine}`, { mine })).toMatchObject({ ok: true, code: strip(mine) });
    // 상대가 다시 해서 코드를 두 번 보냈으면 오래된 쪽을 말없이 쓰지 않고 되묻는다
    const several = decodeWc64PairCode(`${theirs}\n다시 했어 ${again}`, { mine });
    expect(several).toMatchObject({ ok: false, kind: "several" });
    if (!several.ok) expect(several.reason).toBe("서로 다른 코드가 둘 이상 들어 있어요. 어느 코드로 볼지 하나만 남기고 다시 붙여 넣어 주세요.");
    expect(decodeWc64PairCode(`${mine}\n${theirs}\n${again}`, { mine })).toMatchObject({ ok: false, kind: "several" });
    // 내 코드를 모르면 서로 다른 두 코드는 되묻는다
    expect(decodeWc64PairCode(`${mine}\n${theirs}`)).toMatchObject({ ok: false, kind: "several" });
  });

  it("안내 글은 화면 칸 이름 ‘둘이 같이 보기’를 화면과 같은 따옴표로 적는다", () => {
    const msg = wc64PairShareMessage("CODE", "https://hanbang.ai/wedding-code");
    expect(msg).toContain("결과 화면 ‘둘이 같이 보기’의 상대 코드 칸에");
    expect(msg).not.toMatch(/[「」]/);
  });

  it("코드 없이 옛 링크를 붙이면 'legacy-link', 주소만 붙이면 'address-only' 로 알린다", () => {
    for (const link of [
      "https://hanbang.ai/wedding-code#v=3.1&a=12345",
      "https://hanbang.ai/wedding-code?ct=ABCD1234",
      "hanbang.ai/wedding-code?v=36",
      "https://hanbang.ai/wedding-code?v=likert-preferences-alpha.1#wc-likert=xyz",
    ]) {
      const d = decodeWc64PairCode(link);
      expect(d, link).toMatchObject({ ok: false, kind: "legacy-link" });
      if (!d.ok) expect(d.reason).toBe("예전 웨딩코드 링크예요. 64문항과는 질문이 달라 나란히 볼 수 없어요. 상대에게 64문항을 끝낸 뒤 나오는 WC64 코드를 보내 달라고 해 주세요.");
    }
    for (const address of ["https://hanbang.ai/wedding-code", "hanbang.ai/wedding-code?v=64", "www.hanbang.ai"]) {
      expect(decodeWc64PairCode(address), address).toMatchObject({ ok: false, kind: "address-only" });
    }
    // 주소와 코드가 같이 있으면 코드를 읽는다
    const code = encodeWc64PairCode({}, "yes");
    expect(decodeWc64PairCode(`https://hanbang.ai/wedding-code#v=3.1 ${code}`)).toMatchObject({ ok: true });
  });

  it("판 문자는 판 태그와 은행 지문(문항 순서·id·극·식 표시·문장)에 묶여 있다", () => {
    // 은행을 고치면 이 시험이 빨개진다. 바깥에 코드가 나간 뒤라면 WC64_PAIR_EDITION 을 새 문자로 올리고
    // 새 판 태그와 새 지문을 아래 두 표에 더한다(있던 줄은 고치지 않는다). 출시 전에는 지문만 바꿔 넣어도 된다.
    const EDITION_OF_VERSION: Record<string, string> = { "wc64-r1-2026-10-16": "A" };
    const FINGERPRINT_OF_EDITION: Record<string, string> = {
      // 2026-10-17 재판정으로 K4·ROLES-A2·FUND-A1·FUND-A2·BUDGET-B2·FAMILY-A2·EYES-B2 문장을 고친 은행(문항 순서·id·극·식 표시는 그대로).
      // 아직 공개 전이라(나간 코드 없음) 판 문자 A 를 그대로 두고 지문만 바꿨다(계약 §7). 그 전 지문 f18c36e2… 는 같은 날 점검 판
      // (PLAN-A2·CHOOSE-A1·ROLES-A2·FAMILY-A1·FAMILY-B1·FAMILY-A2·BUDGET-B2·FUND-A1·FUND-A2·FUND-B2·WEIGHT-B2·EYES-B2·FORM-A1·K4·K5·K12),
      // 550612f8… 는 처음 읽는 사람 판정 판(FUND-A1·K4·K8·DAY-B2·FAMILY-A1·PLAN-A2), e1ab1b9f… 는 상품 심사 판
      // (FAMILY-A1·LIFE-B2·FUND-A1·FORM-A1·ROLES-A2), 7ff70dd5… 는 2026-10-16 2단계 검토 판.
      A: "80c0b0ccc019273a90e3122b7e9550c7d47f9261565affc84193a7f4b0e5da0c",
    };
    expect(EDITION_OF_VERSION[WC64_VERSION], `판 태그 ${WC64_VERSION} 에 판 문자가 없다`).toBe(WC64_PAIR_EDITION);
    expect(bankFingerprint(), `은행이 바뀌었다. 판 문자 ${WC64_PAIR_EDITION} 의 지문과 다르다`).toBe(FINGERPRINT_OF_EDITION[WC64_PAIR_EDITION]);
  });

  it("식 계획이 없으면(null) 계산이 같은 'M' 으로 적는다", () => {
    const s = strip(encodeWc64PairCode({}, null));
    expect(s[5]).toBe("M");
    const d = decodeWc64PairCode(s);
    expect(d).toMatchObject({ ok: true, plan: "maybe" });
  });
});
