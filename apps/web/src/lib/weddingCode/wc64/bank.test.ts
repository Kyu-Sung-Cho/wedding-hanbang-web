import { describe, expect, it } from "vitest";
import {
  WC64_BANK, WC64_ITEMS, WC64_ORDER, isWc64CeremonyOff, visibleWc64Items, wc64ItemById, wc64SectionById,
  wc64TypeCard,
} from "./bank";
import { WC64_VERSION } from "./types";

// 화면 글에 쓰지 않는 말. %는 '고른 답의 비율'로만 쓰므로 "상위 N%" 꼴도 막는다.
const FORBIDDEN = /MBTI|엠비티아이|검증된|정확|과학적|진단|궁합|당신은|예측|확률|속마음|무의식|상위\s*(?:\d+|몇)\s*%/i;

function strings(value: unknown, path: string, out: { path: string; text: string }[]) {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

describe("wc64 문항 은행", () => {
  it("판 태그가 wc64-r1-2026-10-16 이다", () => {
    expect(WC64_BANK.meta.version).toBe(WC64_VERSION);
    expect(WC64_VERSION).toBe("wc64-r1-2026-10-16");
  });

  it("64문항 = 이해도 12 + 성향 52(13묶음 × 4)", () => {
    expect(WC64_ITEMS).toHaveLength(64);
    const know = WC64_BANK.sections.filter(s => s.kind === "knowledge");
    const bip = WC64_BANK.sections.filter(s => s.kind === "bipolar");
    expect(know.map(s => s.id)).toEqual(["KNOW"]);
    expect(know[0].items).toHaveLength(12);
    expect(bip).toHaveLength(13);
    for (const s of bip) expect([s.id, s.items.length]).toEqual([s.id, 4]);
    expect(bip.reduce((a, s) => a + s.items.length, 0)).toBe(52);
    expect([...WC64_ORDER].sort()).toEqual(WC64_BANK.sections.map(s => s.id).sort());
  });

  it("문항 id 가 겹치지 않고 모두 찾을 수 있다", () => {
    const ids = WC64_ITEMS.map(it => it.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(wc64ItemById(id)?.id).toBe(id);
    expect(new Set(WC64_BANK.sections.map(s => s.id)).size).toBe(WC64_BANK.sections.length);
  });

  it("성향 문항은 A/B 두 쪽이 2개씩, 이해도 문항은 L1~L4 가 3개씩", () => {
    for (const s of WC64_BANK.sections) {
      if (s.kind === "bipolar") {
        expect(s.items.filter(it => it.pole === "A")).toHaveLength(2);
        expect(s.items.filter(it => it.pole === "B")).toHaveLength(2);
      } else {
        for (const L of ["L1", "L2", "L3", "L4"]) expect(s.items.filter(it => it.level === L)).toHaveLength(3);
      }
    }
  });

  it("글자는 D O W L C U M R 만 쓰고, 축 넷이 묶음 셋씩 나눠 가진다(FUND·KNOW 는 글자 밖)", () => {
    const letters = WC64_BANK.dims.flatMap(d => [d.letter_a, d.letter_b]);
    expect(letters.join("")).toBe("DOWLCUMR");
    for (const d of WC64_BANK.dims) {
      expect(Object.keys(d.letters).sort()).toEqual([d.letter_a, d.letter_b].sort());
      expect(d.facets).toHaveLength(3);
      for (const f of d.facets) expect(wc64SectionById(f.axis)?.kind).toBe("bipolar");
    }
    const used = WC64_BANK.dims.flatMap(d => d.facets.map(f => f.axis));
    expect(new Set(used).size).toBe(12);
    expect(used).not.toContain("FUND");
    expect(used).not.toContain("KNOW");
    for (const code of Object.keys(WC64_BANK.types)) expect(code).toMatch(/^[DO][WL][CU][MR]$/);
    for (const sc of WC64_BANK.scenes) expect(WC64_BANK.dims.map(d => d.id)).toContain(sc.axis);
  });

  it("16코드 모두 유형 설명이 있고, '·' 가 든 코드는 null", () => {
    expect(Object.keys(WC64_BANK.types)).toHaveLength(16);
    for (const a of "DO") for (const b of "WL") for (const c of "CU") for (const d of "MR") {
      const t = wc64TypeCard(a + b + c + d);
      expect(t?.title).toBeTruthy();
      expect(t?.tips.length).toBeGreaterThan(0);
    }
    expect(wc64TypeCard("DW·M")).toBeNull();
    expect(wc64TypeCard("toString")).toBeNull();
  });

  it("축 이름에 영어 괄호('(D: Decide)' 같은)가 없다", () => {
    for (const d of WC64_BANK.dims) for (const name of [d.name_a, d.name_b, d.name]) expect(name).not.toMatch(/\(|[A-Za-z]/);
  });

  it("은행·유형·장면·안내 문구에 금지어가 없다(예외 없음)", () => {
    const all = strings(WC64_BANK, "bank", []);
    expect(all.length).toBeGreaterThan(500);
    const hits = all.filter(({ text }) => FORBIDDEN.test(text));
    expect(hits).toEqual([]);
  });

  it("식 안 올림이면 '예식' 문항만 빠지고, 다른 자리로 답하기로 한 묶음은 남는다", () => {
    const ceremony = WC64_ITEMS.filter(it => it.skip_tag === "예식").map(it => it.id);
    expect(ceremony.length).toBeGreaterThan(0);
    expect(visibleWc64Items("yes")).toHaveLength(64);
    expect(visibleWc64Items("maybe")).toHaveLength(64);
    expect(visibleWc64Items(null)).toHaveLength(64);
    const none = visibleWc64Items("none").map(it => it.id);
    expect(none).toHaveLength(64 - ceremony.length);
    for (const id of ceremony) expect(none).not.toContain(id);
    const guests = wc64SectionById("GUESTS")!;
    expect(guests.noceremony_alt).not.toBe("");
    const alt = visibleWc64Items("none", { GUESTS: false }).map(it => it.id);
    for (const it of guests.items) expect(alt).toContain(it.id);
    expect(isWc64CeremonyOff("FORM-A1", "none", { FORM: false })).toBe(true); // 다른 자리 안내가 없는 묶음
    const famSkipped = visibleWc64Items("yes", { FAMILY: true }).map(it => it.id);
    expect(famSkipped).toHaveLength(60);
    expect(famSkipped.some(id => id.startsWith("FAMILY-"))).toBe(false);
  });

  it("다섯 칸 이름과 식 계획 선택지가 있다", () => {
    expect(WC64_BANK.meta.scale).toHaveLength(5);
    expect(WC64_BANK.meta.plan_question.options.map(o => o.value)).toEqual(["yes", "maybe", "none"]);
    expect(WC64_BANK.knowledge.levels).toHaveLength(4);
    expect(WC64_BANK.knowledge.stages).toHaveLength(5);
  });
});
