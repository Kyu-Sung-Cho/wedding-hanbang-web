import { describe, expect, it } from "vitest";
import WC36_DESIGN from "../../weddingCode36/data/design-contract.json";
import { CHARACTERS as LIKERT30_CHARACTERS } from "../likert/characters";
import { V31_CHARACTERS } from "../v31CharacterGuide";
import {
  WC64_BANK, WC64_ITEMS, WC64_ORDER, isWc64CeremonyOff, isWc64ItemAsked, visibleWc64Items, wc64ItemById, wc64NoCeremonyName,
  wc64SectionAskedCount, wc64SectionById, wc64TypeCard,
} from "./bank";
import { buildWc64Report, wc64DimPossible } from "./model";
import { WC64_NO_CEREMONY_LEAD } from "./copy";
import { WC64_NO_CEREMONY_ONLY_TAG, WC64_VERSION, type Wc64Plan, type Wc64Skipped } from "./types";

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

  it("글자는 D O W L C U M R 만 쓰고, PACE·CIRCLE·BOND 는 묶음 셋, SPEND 는 DAY·WEIGHT 둘(FUND·BUDGET·KNOW 는 글자 밖)", () => {
    const letters = WC64_BANK.dims.flatMap(d => [d.letter_a, d.letter_b]);
    expect(letters.join("")).toBe("DOWLCUMR");
    for (const d of WC64_BANK.dims) {
      expect(Object.keys(d.letters).sort()).toEqual([d.letter_a, d.letter_b].sort());
      expect([d.id, d.facets.length]).toEqual([d.id, d.id === "SPEND" ? 2 : 3]);
      for (const f of d.facets) expect(wc64SectionById(f.axis)?.kind).toBe("bipolar");
    }
    // 2026-10-17 파운더 결정(DEC-7 뒤집기): 예산 지키기(BUDGET)는 식 계획과 상관없이 늘 글자 밖 막대다.
    expect(WC64_BANK.dims.find(d => d.id === "SPEND")!.facets).toEqual([{ axis: "DAY", a_is: "A" }, { axis: "WEIGHT", a_is: "A" }]);
    const used = WC64_BANK.dims.flatMap(d => d.facets.map(f => f.axis));
    expect(new Set(used).size).toBe(11);
    expect(used).not.toContain("FUND");
    expect(used).not.toContain("BUDGET");
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

  it("식 없이 하면 '예식' 문항이 모두 빠지고, 옛 '다른 자리로 답하기'(false)는 아무것도 되살리지 않는다(DEC-1)", () => {
    const ceremony = WC64_ITEMS.filter(it => it.skip_tag === "예식").map(it => it.id);
    expect(ceremony.length).toBeGreaterThan(0);
    expect(visibleWc64Items("yes")).toHaveLength(64);
    expect(visibleWc64Items("maybe")).toHaveLength(64);
    expect(visibleWc64Items(null)).toHaveLength(64);
    const none = visibleWc64Items("none").map(it => it.id);
    expect(none).toHaveLength(64 - ceremony.length);
    for (const id of ceremony) expect(none).not.toContain(id);
    // GUESTS 의 다른 자리 갈래는 없앴다: 은행에 안내 문구가 없고, 옛 기록의 false 가 남아도 GUESTS 문항은 빠진다.
    expect(WC64_BANK.sections.filter(s => s.noceremony_alt !== undefined).map(s => s.id)).toEqual([]);
    expect(visibleWc64Items("none", { GUESTS: false }).map(it => it.id)).toEqual(none);
    expect(isWc64CeremonyOff("GUESTS-A1", "none")).toBe(true);
    const famSkipped = visibleWc64Items("yes", { FAMILY: true }).map(it => it.id);
    expect(famSkipped).toHaveLength(60);
    expect(famSkipped.some(id => id.startsWith("FAMILY-"))).toBe(false);
  });

  it("식 안 올림에도 나오는 문장에는 결혼식을 전제한 낱말이 없다(FIX-5)", () => {
    // '예식' 태그가 없으면 식을 안 올리는 사람에게도 나온다. 그런 문장이 식을 깔면 '해당 없음'도 없이 억지로 답하게 된다.
    const CEREMONY = /결혼식|식장|하객|청첩|스드메|본식|예식|식순|웨딩/;
    const shownToNone = visibleWc64Items("none").map(it => [it.id, it.text]);
    expect(shownToNone.length).toBeGreaterThan(0);
    expect(shownToNone.filter(([, text]) => CEREMONY.test(text))).toEqual([]);
  });

  it("식 없이 하면 CIRCLE·SPEND 는 남은 문장을 다 답해도 정할 수 없고, PACE·BOND 는 정할 수 있다(DEC-1)", () => {
    const possible = (plan: "yes" | "none") => Object.fromEntries(WC64_BANK.dims.map(d => [d.id, wc64DimPossible(d, plan)]));
    expect(possible("none")).toEqual({ PACE: true, SPEND: false, CIRCLE: false, BOND: true });
    expect(possible("yes")).toEqual({ PACE: true, SPEND: true, CIRCLE: true, BOND: true });
    // 식 없이 하면 SPEND 문장(DAY·WEIGHT)은 하나도 묻지 않는다. 예산(BUDGET) 넷은 글자 밖 막대라 그대로 묻는다.
    const none = new Set(visibleWc64Items("none").map(it => it.id));
    const spend = WC64_BANK.dims.find(d => d.id === "SPEND")!;
    expect(spend.facets.flatMap(f => wc64SectionById(f.axis)!.items).filter(it => none.has(it.id)).map(it => it.id)).toEqual([]);
    expect(wc64SectionById("BUDGET")!.items.filter(it => none.has(it.id))).toHaveLength(4);
    // CIRCLE 문장(EYES-B1·B2 포함)은 식 없이 하면 하나도 묻지 않는다. 남겨 두면 어느 글자·막대에도 안 쓰이는 답이 된다(2단계 검토).
    const circle = WC64_BANK.dims.find(d => d.id === "CIRCLE")!;
    expect(circle.facets.flatMap(f => wc64SectionById(f.axis)!.items).filter(it => none.has(it.id)).map(it => it.id)).toEqual([]);
    // 다 답해도 두 글자만
    const answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, it.pole === "A" ? 5 : 1] as const));
    expect(buildWc64Report(answers, "none").code).toBe("D··M");
  });

  it("식 계획 선택지는 상황으로 쓰고, 도움말은 실제 계산과 같은 말을 한다(DEC-1·FIX-1)", () => {
    const q = WC64_BANK.meta.plan_question;
    expect(q.options.map(o => [o.value, o.label])).toEqual([
      ["yes", "올릴 거예요(작은 식·가족끼리 하는 식 포함)"],
      ["maybe", "아직 정하지 않았어요"],
      ["none", "식 없이 하려고 해요(혼인신고·사진만 등)"],
    ]);
    expect(q.help).not.toMatch(/결과에 안 들어가|23/);
    // maybe 는 식을 올리는 경우로 묻는다 · none 은 결혼식 질문을 빼고 두 글자로 낸다 · 이 선택이 답 코드에 담긴다(CLAUDE.md DEC-1)
    // 재판정: '물어봐요'는 비교 화면에서 사용자에게 권하는 말('이렇게 물어봐요')로 쓰여 앱이 묻는다는 '물을게요'로 바꿨다
    expect(q.help).not.toContain("물어봐요");
    for (const must of ["식을 올린다고 보고 물을게요", "결혼식 질문은 빼고", "네 글자 대신 두 글자", "식 계획도 그 코드에 들어가요"]) {
      expect([must, q.help.includes(must)]).toEqual([must, true]);
    }
    // 실제 계산과 같다: 식 없이 하면 정해지는 글자는 둘이다(아래 '두 글자만' 시험과 같은 계산)
    const answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, it.pole === "A" ? 5 : 1] as const));
    expect(buildWc64Report(answers, "none").code.replace(/·/g, "")).toHaveLength(2);
    // 식 없이 하는 사람의 예산 막대 이름은 BUDGET 두 극 이름과 같다
    const budget = wc64SectionById("BUDGET")!;
    expect([WC64_BANK.budget_bar.a_name, WC64_BANK.budget_bar.b_name]).toEqual([budget.pole_a.name, budget.pole_b.name]);
  });

  it("양가 문장은 신랑·신부 누가 읽어도 같은 무게다: 상대 부모님·상대 쪽 가족·단톡방 같은 한쪽 말이 없다(DEC-8)", () => {
    const ONE_SIDED = /상대\s*(?:쪽\s*)?(?:부모님|가족|집안)|단톡|시댁|시부모|처가|며느리|사위|장인어른|장모님|시어머니|시아버지/;
    expect(strings(WC64_BANK, "bank", []).filter(({ text }) => ONE_SIDED.test(text))).toEqual([]);
    const fam = wc64SectionById("FAMILY")!.items;
    for (const it of fam) expect([it.id, it.text]).toEqual([it.id, expect.not.stringMatching(/제가|내가/)]);
  });

  it("아모라에게 건넬 말은 앱이 하는 일만 부탁한다: 맡은 사람 나눠 저장·날짜 골라 일정 넣기를 시키지 않는다", () => {
    // add_amora_action 에는 맡은 사람 칸이 없고, 아모라는 둘이 되는 날을 모른다(1단계 검토).
    const CANT = /각자 할 일|일정에 (?:넣어|올려|잡아) 줘|날을 (?:골라|정해) 줘|담당/;
    const lines = WC64_BANK.dims.flatMap(d => Object.values(d.letters).map(L => `${d.id}.${L.letter}: ${L.amora_line}`));
    expect(lines.filter(l => CANT.test(l))).toEqual([]);
  });

  it("공개 의무 문장은 '안 올라와 있을 수 있으니 물어보라'까지 쓰고, 보금자리론은 공사 자료를 출처로 단다", () => {
    const all = strings(WC64_BANK, "bank", []);
    const duty = all.filter(({ text }) => /2025년 11월 12일/.test(text));
    expect(duty.length).toBeGreaterThan(0);
    for (const d of duty) expect([d.path, /의무가 생겼/.test(d.text) && /물어보|달라고/.test(d.text)]).toEqual([d.path, true]);
    expect(all.filter(({ text }) => /소득으로 심사받/.test(text))).toEqual([]);
    const loan = all.filter(({ text }) => /보금자리론은/.test(text)).map(h => h.path);
    expect(loan.length).toBeGreaterThan(0);
    expect(wc64ItemById("K11")!.source_url).toMatch(/^https:\/\/www\.hf\.go\.kr\//);
    for (const w of WC64_BANK.dims.find(d => d.id === "SPEND")!.letters.L.watch.filter(x => /보금자리론/.test(x.text))) {
      expect(w.source).toContain("한국주택금융공사 보도자료");
    }
  });

  it("시작 화면 한눈 정보에 둘이 같이 보는 방법이 있다", () => {
    expect(WC64_BANK.meta.facts.some(f => /답 코드/.test(f.value) && /둘/.test(f.label + f.value))).toBe(true);
  });

  it("예식 150일 위약금 기준은 은행에 한 번만 쓴다(이해도 K7 설명, FIX-15)", () => {
    const hits = strings(WC64_BANK, "bank", []).filter(({ text }) => /150일/.test(text)).map(h => h.path);
    expect(hits).toEqual([expect.stringMatching(/check_note$/)]);
    expect(wc64ItemById("K7")!.check_note).toMatch(/150일/);
  });

  it("'최근 2년' 같은 상대 시점 대신 날짜를 쓴다(FIX-15)", () => {
    const RELATIVE = /최근\s*\d+\s*(?:년|개월|달)|그\s*전\s*\d+\s*(?:년|개월|달)|지난해|작년|올해|요즘/;
    expect(strings(WC64_BANK, "bank", []).filter(({ text }) => RELATIVE.test(text))).toEqual([]);
  });

  it("묶음 꼬리표는 짧은 이름이고 '~나'로 묻지 않는다(FIX-15)", () => {
    for (const s of WC64_BANK.sections) expect([s.id, s.group_label]).toEqual([s.id, expect.not.stringMatching(/나$|\?$/)]);
  });

  it("TALK 의 '의견이 갈리면/갈린' 두 문장은 붙어 나오지 않는다(거울 쌍 떼기, FIX-22)", () => {
    const talk = wc64SectionById("TALK")!.items;
    const idx = talk.map((it, i) => (/의견이 갈/.test(it.text) ? i : -1)).filter(i => i >= 0);
    expect(idx).toHaveLength(2);
    expect(idx[1] - idx[0]).toBeGreaterThan(1);
  });

  it("성향 문항 전체 안내는 첫 성향 묶음(PLAN) 안내에 있고 이해도(KNOW) 안내에는 없다(FIX-21·DEC-6)", () => {
    const firstTendency = WC64_ORDER.map(id => wc64SectionById(id)!).find(s => s.kind === "bipolar")!;
    expect(firstTendency.id).toBe("PLAN");
    expect(firstTendency.intro).toContain("마음이 가는 쪽");
    expect(firstTendency.intro).toContain("준비 전");
    // 이해도 다음에 오는 첫 성향 안내라 '여기부터는'으로 바뀐 것을 알리고, '고르'를 거듭 쓰지 않는다
    expect(firstTendency.intro.startsWith("여기부터는")).toBe(true);
    expect(firstTendency.intro.match(/고르|골라|고른/g) ?? []).toHaveLength(1);
    const know = wc64SectionById("KNOW")!.intro;
    expect(know).not.toContain("마음이 가는 쪽");
    expect(know).not.toMatch(/어려워지/);
  });

  it("장면 묶음·줄 표식·큰돈 표식이 은행 구조와 맞는다(FIX-6·12·13, DEC-1 '예식' 표식)", () => {
    for (const sc of WC64_BANK.scenes) {
      const dim = WC64_BANK.dims.find(d => d.id === sc.axis)!;
      expect([sc.id, dim.facets.map(f => f.axis)]).toEqual([sc.id, expect.arrayContaining([sc.section])]);
    }
    const bipolar = WC64_BANK.sections.filter(s => s.kind === "bipolar").map(s => s.id);
    // 문항 id 표식(그 문항에 1·2를 고르면 그 줄을 뺀다, 2026-10-17 UX-1)은 그 줄이 단정하는 글자 쪽 문항만 가리킨다.
    const letterOfItem = new Map<string, string>();
    for (const d of WC64_BANK.dims) for (const f of d.facets) for (const it of wc64SectionById(f.axis)!.items) {
      letterOfItem.set(it.id, it.pole === f.a_is ? d.letter_a : d.letter_b);
    }
    const split = (tag: string) => tag.split(",").filter(Boolean);
    for (const [code, t] of Object.entries(WC64_BANK.types)) {
      const ls = t.line_sections;
      if (!ls) continue;
      if (ls.meets) expect([code, ls.meets.length]).toEqual([code, t.meets.length]);
      if (ls.tips) expect([code, ls.tips.length]).toEqual([code, t.tips.length]);
      for (const tag of [...(ls.meets ?? []), ...(ls.tips ?? []), ls.first ?? "", ls.later ?? ""]) for (const one of split(tag)) {
        const itemLetter = letterOfItem.get(one);
        if (itemLetter) expect([code, one, code.includes(itemLetter)]).toEqual([code, one, true]);
        else expect([code, one, [...bipolar, "예식"].includes(one)]).toEqual([code, one, true]);
      }
    }
    for (const d of WC64_BANK.dims) {
      const own = [...d.facets.map(f => f.axis), "예식", WC64_NO_CEREMONY_ONLY_TAG];
      const check = (tags: string[] | undefined, len: number, letter?: string) => {
        if (!tags) return;
        expect(tags).toHaveLength(len);
        for (const t of tags) for (const one of split(t)) {
          if (letterOfItem.has(one)) expect([d.id, letter, one, letterOfItem.get(one)]).toEqual([d.id, letter, one, letter]);
          else expect(own).toContain(one);
        }
      };
      check(d.decisions_sections, d.decisions.length);
      for (const s of Object.keys(d.skip_copy ?? {})) expect(own).toContain(s);
      for (const L of Object.values(d.letters)) {
        check(L.line_sections?.comfy, L.comfy.length, L.letter);
        check(L.line_sections?.watch, L.watch.length, L.letter);
        check(L.line_sections?.app_actions, L.app_actions.length, L.letter);
      }
    }
    const big = WC64_ITEMS.filter(it => it.big_money).map(it => it.id).sort();
    expect(big).toEqual(["K10", "K12", "K7", "K8"]);
  });

  it("다섯 칸 이름과 식 계획 선택지가 있다", () => {
    expect(WC64_BANK.meta.scale).toHaveLength(5);
    expect(WC64_BANK.meta.plan_question.options.map(o => o.value)).toEqual(["yes", "maybe", "none"]);
    expect(WC64_BANK.knowledge.levels).toHaveLength(4);
    expect(WC64_BANK.knowledge.stages).toHaveLength(5);
  });
});

describe("wc64 문항 은행: 2단계 검토(2026-10-16)", () => {
  const tendency = WC64_BANK.sections.filter(s => s.kind === "bipolar").flatMap(s => s.items);

  it("'~기보다'·'~보다'·'~한 다음' 틀은 성향 문장 셋 이하이고, TALK 두 B 문장은 그 틀을 쓰지 않는다", () => {
    // '~한 다음'은 받침 ㄴ 관형형 뒤의 '다음'만 센다('끝내고 다음 일로'의 '다음'은 틀이 아니다)
    const afterN = (text: string) => [...text.matchAll(/([가-힣])\s*다음/g)].some(m => (m[1].charCodeAt(0) - 0xac00) % 28 === 4);
    const frame = (text: string) => /보다/.test(text) || afterN(text);
    expect(frame("며칠 두고 생각한 다음 다시 얘기해요")).toBe(true);
    expect(frame("빨리 끝내고 다음 일로 넘어가요")).toBe(false);
    const hits = tendency.filter(it => frame(it.text)).map(it => it.id);
    expect(hits.length, hits.join(", ")).toBeLessThanOrEqual(3);
    for (const id of ["TALK-B1", "TALK-B2"]) expect([id, frame(wc64ItemById(id)!.text)]).toEqual([id, false]);
  });

  it("FUND-A1 은 대출 하나만 묻고, FUND-A2 는 양가 도움을 되도록 받지 않는지로 측면이 다르다", () => {
    const a1 = wc64ItemById("FUND-A1")!.text, a2 = wc64ItemById("FUND-A2")!.text;
    // 2026-10-17 심사 ITEM-6: '빌리지 않고'만으로는 양가 도움까지 빼는지 알 수 없었다. 그 뒤 '빌리거나 받을 돈은 빼고'는
    // 대출과 부모님 도움을 한 문장에 물어(처음 읽는 사람 판정) '지금 둘이 모은 돈 안에서만'으로 좁혔는데, 그 문장은
    // 양가 도움을 받지 않는 경우(A2)를 이미 품어 같은 판단을 두 번 물었다(2026-10-17 점검). 그래서 A1 은 빚 하나만 묻는다.
    // 재판정: '신용대출이나 할부'는 두 가지를 한꺼번에 물었다(가전 무이자 할부는 돈이 모자라지 않아도 흔히 쓴다). 대출 하나로 좁혔다.
    expect(a1).toMatch(/대출/);
    expect(a1).not.toMatch(/할부|이나|양가|부모님|모은 돈 안에서만|받을 돈/);
    expect(a2).toMatch(/양가/);
    expect(a2).not.toMatch(/빌리|대출|할부/);
    // 재판정: '사양하고'는 너무 센 행동이라 거의 모두 '아니다' 쪽으로 몰릴 문장이었다
    expect(a2).not.toMatch(/사양/);
  });

  it("비용 마련 막대의 끝 이름과 질문이 그 막대를 움직이는 답과 맞는다: A1(대출)에 동의하지 않으면 미는 B 쪽 이름이 빌리는 쪽을 담는다(재판정)", () => {
    // FUND-A1 에 '아니다'(빌릴 생각이 있다)를 고르면 B 쪽 %가 오른다. 옛 B 이름 '받을 돈도 보태는 쪽'과 질문 '받을 돈을 얼마나 넣을까'에는
    // 빌리는 쪽이 들어갈 자리가 없어 결과를 거꾸로 읽게 했다.
    const r = buildWc64Report({ "FUND-A1": 1, "FUND-B2": 3, "FUND-A2": 3 }, "none").fund;
    expect(r.decided && r.pctB > r.pctA).toBe(true);
    expect(WC64_BANK.fund.b_name).toMatch(/빌리/);
    expect(WC64_BANK.fund.couple_question).toMatch(/대출/);
    expect(WC64_BANK.fund.a_name).toMatch(/빚 없이/);
    const fund = wc64SectionById("FUND")!;
    expect(fund.pole_b.name).toBe(WC64_BANK.fund.b_name);
    expect(fund.pole_b.desc).toMatch(/대출/);
    expect(fund.definition).toMatch(/대출/);
    // 막대와 질문은 식 없이 하는 사람에게도 보여 축의금(식 전제 말)을 쓰지 않는다
    for (const t of [WC64_BANK.fund.a_name, WC64_BANK.fund.b_name, WC64_BANK.fund.couple_question, WC64_BANK.fund.why_outside]) {
      expect(t).not.toMatch(/축의금|하객|식장|예식/);
    }
  });

  it("BUDGET-B1 과 BUDGET-B2 는 같은 판단을 두 번 묻지 않는다: B2 는 물건·할부가 아니라 아끼다 남는 아쉬움 앞에서 고르는 쪽을 묻는다(2026-10-17 점검·재판정)", () => {
    const b1 = wc64ItemById("BUDGET-B1")!.text, b2 = wc64ItemById("BUDGET-B2")!.text;
    expect(b1).toMatch(/오래 간직할 물건/);
    // 옛 B2 '결혼 기념으로 꼭 갖고 싶은 게 있으면 목돈이 모자라도 할부로 해서 사요'는 대상(기념 물건)과 돈이 모자란 방식만 바뀐 B1 이었다
    expect(b2).not.toMatch(/물건|기념|반지|시계|할부|목돈/);
    expect(b2).toMatch(/아끼느라 아쉬움이/);
    // 재판정: '아쉬울 것 같아요'는 돈을 아끼는 사람도 똑같이 느끼는 감정이라 거의 모두 '그렇다'였다. 실제로 어느 쪽을 고르는지 묻는다.
    expect(b2).not.toMatch(/것 같아요\.$/);
    expect(b2).toMatch(/돈이 더 들어도 마음에 드는 쪽을 골라요/);
    // 극 설명도 묻지 않는 할부를 말하지 않는다
    expect(wc64SectionById("BUDGET")!.pole_b.desc).not.toMatch(/할부/);
  });

  it("앱이 못 하는 일을 약속하지 않는다: 일정의 '담당' 칸(모바일에 없다)을 쓰라고 하지 않는다", () => {
    expect(strings(WC64_BANK, "bank", []).filter(({ text }) => /담당/.test(text)).map(h => h.path)).toEqual([]);
  });

  it("식 계획 도움말은 아직 보지 못한 결과 화면 말(축 이름·막대·글자 밖)을 미리 쓰지 않는다(2026-10-17 점검)", () => {
    // 식 계획은 맨 처음 묻는다. 그 화면에서 「결혼식을 맞추는 기준」·'따로 막대로' 같은 결과 화면 말은 읽히지 않았다.
    const help = WC64_BANK.meta.plan_question.help;
    for (const d of WC64_BANK.dims) expect([d.id, help.includes(d.name)]).toEqual([d.id, false]);
    expect(help).not.toMatch(/글자 밖|막대|「|」/);
    // 처음 보는 '답 코드'는 무엇에 쓰는지 같은 문장에서 풀어 쓴다(재판정: 꾸밈말이 겹친 '…볼 때 주고받는 답 코드에도'를 풀었다)
    expect(help).toMatch(/둘이 결과를 견줘 보려고 답 코드를 주고받으면/);
    expect(help).not.toMatch(/볼 때 주고받는 답 코드/);
  });

  it("PLAN 안내는 두 문장 이하(한 줄)다", () => {
    const intro = wc64SectionById("PLAN")!.intro;
    expect(intro.split(/(?<=[.?!])\s+/).filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it("같은 선택은 '식 없이 하기로 해서'로 부른다: 은행에 '식을 안 올려'·'식을 올리지 않'이 없다", () => {
    expect(strings(WC64_BANK, "bank", []).filter(({ text }) => /식을 안 올|식을 올리지 않/.test(text)).map(h => h.path)).toEqual([]);
  });

  it("예산 막대 까닭은 모든 식 계획에 맞는 말이다: 식 없이 할 때만 쓰던 머리말로 시작하지 않는다(2026-10-17)", () => {
    const why = WC64_BANK.budget_bar.why_outside;
    expect(why.startsWith(WC64_NO_CEREMONY_LEAD)).toBe(false);
    expect(why).not.toMatch(/식 없이|비워/);
    // 식 없이 하는 사람에게 없는 글자(SPEND 의 그날·그 뒤)를 근거로 들지 않는다
    expect(why).not.toMatch(/그날과 그 뒤|어디에 더 쓰는지/);
  });

  it("두 막대 까닭은 식 없이 하는 사람에게도 보이므로 '네 글자'를 단정하지 않고, '글자에 넣지 않는다'는 말은 까닭마다 되풀이하지 않는다(재판정)", () => {
    // 그 말은 카드 머리(Report64 의 WC64_OUTSIDE_NOTE)에 한 번만 둔다. 두 줄이 모두 같은 꼬리로 끝나 한 카드에서 되풀이됐다.
    for (const [bar, why] of [["fund", WC64_BANK.fund.why_outside], ["budget_bar", WC64_BANK.budget_bar.why_outside]]) {
      expect([bar, /네 글자/.test(why), /글자에는 넣지 않|막대로만/.test(why)]).toEqual([bar, false, false]);
    }
  });

  it("'알아 두면 좋은 것' 카드의 식 전제 표식(check_tag)은 식 없이도 묻는 문항에만 단다(지금 K1 하나)", () => {
    const tagged = WC64_ITEMS.filter(it => it.check_tag).map(it => [it.id, it.check_tag, it.skip_tag]);
    expect(tagged).toEqual([["K1", "예식", ""]]);
  });

  it("'식없이' 줄은 글자 카드에만 있고, 식을 전제한 낱말이 없다", () => {
    const CEREMONY = /결혼식|식장|하객|청첩|스드메|본식|예식|식순|웨딩|박람회|드레스|스튜디오/;
    const lines: string[] = [];
    for (const d of WC64_BANK.dims) {
      expect([d.id, (d.decisions_sections ?? []).includes(WC64_NO_CEREMONY_ONLY_TAG)]).toEqual([d.id, false]);
      for (const L of Object.values(d.letters)) {
        const ls = L.line_sections ?? {};
        L.comfy.forEach((t, i) => { if (ls.comfy?.[i] === WC64_NO_CEREMONY_ONLY_TAG) lines.push(t) });
        L.watch.forEach((w, i) => { if (ls.watch?.[i] === WC64_NO_CEREMONY_ONLY_TAG) lines.push(w.text) });
        L.app_actions.forEach((t, i) => { if (ls.app_actions?.[i] === WC64_NO_CEREMONY_ONLY_TAG) lines.push(t) });
      }
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter(t => CEREMONY.test(t))).toEqual([]);
    for (const t of Object.values(WC64_BANK.types)) {
      const ls = t.line_sections ?? {};
      expect([...(ls.meets ?? []), ...(ls.tips ?? []), ls.first, ls.later]).not.toContain(WC64_NO_CEREMONY_ONLY_TAG);
    }
  });
});

describe("wc64 문항 은행: 2026-10-17 상품 심사", () => {
  /** 두 음절 이상 한글 낱말의 앞 두 음절(조사·어미가 달라도 같은 말로 센다) */
  const contentWords = (text: string) => {
    const STOP = new Set(["아모", "다음", "이걸", "그리", "해요", "해서", "하고", "같이", "두세", "보세"]);
    return new Set([...text.matchAll(/[가-힣]{2,}/g)].map(m => m[0].slice(0, 2)).filter(w => !STOP.has(w)));
  };

  it("같은 글자 장의 할 일 줄과 '아모라에게' 줄이 같은 말을 하지 않는다: 내용어가 3개 이상 겹치지 않는다(COPY-4)", () => {
    const hits: string[] = [];
    for (const d of WC64_BANK.dims) for (const L of Object.values(d.letters)) {
      const amora = contentWords(L.amora_line);
      L.app_actions.forEach((a, i) => {
        const shared = [...contentWords(a)].filter(w => amora.has(w));
        if (shared.length >= 3) hits.push(`${d.id}.${L.letter} app_actions[${i}]: ${shared.join(",")}`);
      });
    }
    expect(hits).toEqual([]);
    // 이 검사가 실제로 잡는 옛 문장(심사가 찾은 W 장)
    const oldW = "아모라에게 그리고 싶은 장면을 말하고 업체 상담 때 물어볼 것을 정리받아 두세요.";
    const w = WC64_BANK.dims.find(d => d.id === "SPEND")!.letters.W.amora_line;
    expect([...contentWords(oldW)].filter(x => contentWords(w).has(x)).length).toBeGreaterThanOrEqual(3);
  });

  it("SPEND(W/L)는 그날과 그 뒤를 말하고, 예산을 지키는지는 글자 장·유형 한 줄에서 말하지 않는다(ITEM-1, DEC-7 뒤집기)", () => {
    const BUDGET_KEEP = /정한 (?:선|금액|예산)|정해 둔 (?:금액|예산)|처음 그은 선|선을 그어|예산을 (?:넘|지키)|총예산을 먼저|총액부터 정해/;
    const spend = WC64_BANK.dims.find(d => d.id === "SPEND")!;
    const texts = [spend.question, spend.desc_a, spend.desc_b, spend.balanced, ...spend.decisions, ...spend.couple_questions];
    for (const L of Object.values(spend.letters)) texts.push(...L.comfy, ...L.app_actions, L.amora_line);
    for (const sc of WC64_BANK.scenes.filter(s => s.axis === "SPEND")) for (const k of ["a", "b", "half"] as const) texts.push(sc[k].here, sc[k].tip);
    for (const t of Object.values(WC64_BANK.types)) texts.push(t.one_liner);
    expect(texts.filter(t => BUDGET_KEEP.test(t))).toEqual([]);
    expect(WC64_BANK.scenes.find(s => s.id === "budget")!.section).toBe("WEIGHT");
  });

  it("고친 문항: FAMILY-A1·LIFE-B2·FORM-A1·ROLES-A2(COPY-7·ITEM-3·7·9)", () => {
    const text = (id: string) => wc64ItemById(id)!.text;
    // FAMILY-A1 은 2026-10-17 처음 읽는 사람 판정으로 한 번 더 고쳤고, 같은 날 점검에서 '꺼낼 얘기는…꺼내요' 되풀이를 걷었다
    expect(text("FAMILY-A1")).toMatch(/둘이 먼저 정하고 나서 말씀드려요/);
    expect(text("FAMILY-A1")).not.toMatch(/꺼낼 얘기는[^.]*꺼내요/);
    // LIFE-B2 는 LIFE-A1(한 통장)의 반대 극이 되게 수입을 나누는 문장이고, 극 B 설명도 같은 말이다
    expect(text("LIFE-B2")).toMatch(/각자 번 돈은 각자 통장/);
    expect(text("LIFE-B2")).not.toMatch(/용돈/);
    expect(wc64SectionById("LIFE")!.pole_b.desc).toMatch(/각자 통장/);
    expect(wc64SectionById("LIFE")!.pole_b.desc).not.toMatch(/용돈/);
    // FORM-A1 은 식순 하나(화촉 점화)만 묻는다
    expect(text("FORM-A1")).toMatch(/화촉 점화/);
    expect(text("FORM-A1")).not.toMatch(/주례|나 |처럼|같은/);
    // ROLES-A2 는 업체가 없는 사람(식 없이)도 답할 수 있다. '중요한 상담'은 원래 둘이 같이 가는 일이라 거의 모두 그렇다고 해서
    // (2026-10-17 점검) 한 사람만 가도 되는 일로 문턱을 올렸다. 그 예로 든 가구·가전은 대부분 둘이 같이 보러 가는 일이라
    // 예시에 답하게 됐다(재판정). 정말 한 사람이면 되는 심부름(서류 떼기·맡긴 물건 찾기)을 예로 든다.
    expect(text("ROLES-A2").startsWith("업체")).toBe(false);
    expect(text("ROLES-A2")).toMatch(/한 사람만 가도 되는 일도/);
    expect(text("ROLES-A2")).not.toMatch(/중요한|가구|가전/);
    expect(text("ROLES-A2")).toMatch(/서류/);
  });

  it("재판정으로 고친 문항: K4·FAMILY-A2·EYES-B2(거의 모두 같은 칸·뜻이 갈림·눈가림 두 판정자 모두 L 로 읽음)", () => {
    const text = (id: string) => wc64ItemById(id)!.text;
    // K4: 대관료와 인당 식대 곱하기는 누구나 '그렇다'를 고를 단순 셈이었다. 보증인원과 장식비 같은 추가 항목(카드 설명과 같은 말)까지 묻는다.
    expect(text("K4")).toMatch(/보증인원/);
    expect(text("K4")).toMatch(/장식비/);
    expect(wc64ItemById("K4")!.check_note).toMatch(/보증인원을 곱한 금액과 장식비/);
    // FAMILY-A2: 어떤 일로 병원에 가시는지가 없어(수술이면 누구나, 정기 검진이면 거의 아무도) 사람마다 떠올리는 장면이 달랐고,
    // '어느 집 어른'은 조부모님까지 드는지 흐렸다. 양가 대칭(DEC-8)은 '어느 쪽 부모님'으로 지킨다.
    expect(text("FAMILY-A2")).toMatch(/어느 쪽 부모님/);
    expect(text("FAMILY-A2")).toMatch(/검사나 시술/);
    expect(text("FAMILY-A2")).not.toMatch(/어느 집 어른|휴가/);
    // FAMILY 문장은 '해당 없음'을 고를 수 있다(가족 표식). 부모님이 안 계신 사람도 답할 자리가 있다.
    expect(wc64ItemById("FAMILY-A2")!.skip_tag).toBe("가족");
    // EYES-B2: '브랜드 제품이 아니어도'는 돈을 아끼는 말로 읽혀 눈가림 두 판정자가 모두 L(그 뒤에 싣는 쪽)로 골랐다.
    // 남들 눈과 둘의 마음을 견주는 C/U 의 말로 쓰고, 값·브랜드 말을 걷었다.
    expect(text("EYES-B2")).toMatch(/남들 눈/);
    expect(text("EYES-B2")).not.toMatch(/브랜드|비싸|싼|돈|아끼/);
  });

  it("FAMILY-A2 는 부담이 큰 일 하나(병원 모시기)만 묻고, FAMILY-B1 은 미리 맞춘 뒤 각자 전하는 사람도 고를 칸이 있다(2026-10-17 점검)", () => {
    const a2 = wc64ItemById("FAMILY-A2")!.text, b1 = wc64ItemById("FAMILY-B1")!.text;
    // 옛 A2 '생신이나 병원 가실 일은…둘이 함께 챙길래요'는 가벼운 일과 무거운 일을 한 문장에 묶어 거의 모두 그렇다고 했다
    expect(a2).toMatch(/병원/);
    expect(a2).not.toMatch(/생신|이나 병원/);
    // 옛 B1 '둘이 따로 맞추지 않고 각자…알아서 전해요'는 상의하지 않는 커플로 읽혔고 '안 맞춘다'와 '각자 전한다'를 한꺼번에 물었다
    expect(b1).not.toMatch(/맞추지 않고|알아서/);
    expect(b1).toMatch(/자기 부모님께/);
  });

  it("안쪽 말과 흐린 주어를 걷었다: '실측 전'·'가정이에요'가 없고 K7 계약추진비는 업체가 알린 것이다(COPY-12·13)", () => {
    expect(strings(WC64_BANK, "bank", []).filter(({ text }) => /실측|가정이에요|가정이다/.test(text)).map(h => h.path)).toEqual([]);
    const k7 = wc64ItemById("K7")!.check_note;
    expect(k7).toContain("업체가 계약 때 항목과 금액을 서면으로 알리고 동의를 받은 계약추진비");
    expect(k7).not.toContain("업체에서 이미 받은 것");
  });

  it("묻는 문항 규칙은 한 벌이다: visibleWc64Items·isWc64ItemAsked·wc64SectionAskedCount 가 같은 답을 낸다(CQ-4)", () => {
    const cases: [Wc64Plan | null, Wc64Skipped][] = [
      ["yes", {}], ["maybe", { FAMILY: true }], [null, {}], ["none", {}], ["none", { FAMILY: true, GUESTS: false }],
    ];
    for (const [plan, skipped] of cases) {
      const visible = visibleWc64Items(plan, skipped).map(it => it.id);
      expect(visible).toEqual(WC64_ITEMS.filter(it => isWc64ItemAsked(it.id, plan, skipped)).map(it => it.id));
      for (const s of WC64_BANK.sections) {
        const asked = s.items.filter(it => !isWc64CeremonyOff(it.id, plan)).length;
        expect([s.id, wc64SectionAskedCount(s.id, plan)]).toEqual([s.id, asked]);
        // 넘기지 않은 묶음이면 묻는 문장 수와 보이는 문장 수가 같다
        if (skipped[s.id] !== true) expect([s.id, s.items.filter(it => visible.includes(it.id)).length]).toEqual([s.id, asked]);
      }
    }
    expect(isWc64ItemAsked("NOPE", "yes")).toBe(false);
    expect(wc64SectionAskedCount("NOPE", "yes")).toBe(0);
    // 식 없이 하면 GUESTS·EYES·DAY·WEIGHT 는 안내 카드도 내지 않는다(묻는 문장 0)
    expect(["GUESTS", "EYES", "DAY", "WEIGHT"].map(id => wc64SectionAskedCount(id, "none"))).toEqual([0, 0, 0, 0]);
  });

  it("예산 화면에 없는 일을 시키지 않는다: 항목 이름 입력·새 칸 만들기·줄 더하기가 없다(COPY-15, 모바일 예산은 정해진 칸에 금액만)", () => {
    const CANT = /항목 이름|칸을 (?:따로 )?만들|항목(?:으로| 칸)?(?:을|를)? (?:따로 )?(?:만들|넣고)|항목으로 넣|한 줄 따로|나란히 적어/;
    expect(strings(WC64_BANK, "bank", []).filter(({ text }) => CANT.test(text)).map(h => `${h.path}: ${h.text}`)).toEqual([]);
  });
});

describe("wc64 문항 은행: 처음 읽는 사람 판정으로 고친 문항 여섯(2026-10-17)", () => {
  const item = (id: string) => wc64ItemById(id)!;

  it("FUND-A1·K4·K8·DAY-B2·FAMILY-A1·PLAN-A2 문장이 판정 결과 그대로다(2026-10-17 점검으로 FUND-A1·K4·FAMILY-A1·PLAN-A2 를, 재판정으로 FUND-A1·K4 를 다시 고쳤다)", () => {
    expect(Object.fromEntries(["FUND-A1", "K4", "K8", "DAY-B2", "FAMILY-A1", "PLAN-A2"].map(id => [id, item(id).text]))).toEqual({
      "FUND-A1": "결혼 비용이 모자라면 대출은 받지 않고 규모를 줄일래요.",
      K4: "식장 견적서를 받으면 식대에 보증인원을 곱하고 장식비 같은 추가 항목까지 더해 총비용을 계산할 수 있어요.",
      K8: "박람회에서 한 계약을 어떤 경우에 취소할 수 있는지 알아요.",
      "DAY-B2": "본식은 축가나 영상 같은 순서 없이 기본 식순만으로 짧게 끝내면 좋겠어요.",
      "FAMILY-A1": "양가에 할 얘기는 며칠 늦어지더라도 둘이 먼저 정하고 나서 말씀드려요.",
      // '나중에 바뀔 수 있는 일까지'는 일찍 움직이는 쪽을 헛수고처럼 써서 거의 모두 '아니다'를 골랐다(2026-10-17 점검)
      "PLAN-A2": "결혼까지 한참 남았어도 미리 할 수 있는 일은 당겨서 해 둬요.",
    });
  });

  it("고친 문항의 측면(facet) 설명이 옛 문장의 말을 끌고 다니지 않는다", () => {
    expect(item("FUND-A1").facet).not.toMatch(/빌리|받을 돈|모은 돈 안에서만/);
    expect(item("K8").facet).not.toMatch(/물릴/);
    expect(item("K8").facet).toMatch(/어떤 경우에 취소할 수 있는지/);
    expect(item("K4").facet).toMatch(/총비용/);
    expect(item("PLAN-A2").facet).not.toMatch(/바뀔 수 있는/);
    expect(item("PLAN-A2").facet).toMatch(/당겨서/);
    expect(item("FAMILY-A1").facet).toMatch(/먼저 정하는지/);
    for (const id of ["ROLES-A2", "FAMILY-B1", "FAMILY-A2", "BUDGET-B2", "WEIGHT-B2"]) {
      expect([id, item(id).facet]).toEqual([id, expect.not.stringMatching(/중요한 상담|맞추지 않고|생신|결혼 기념으로|그날을 남기는/)]);
    }
    // 재판정으로 고친 문항의 측면 설명도 옛 말(할부·사양·휴가·어느 집 어른·브랜드·오래 아쉬워할지)을 끌고 다니지 않는다
    for (const id of ["FUND-A1", "FUND-A2", "FAMILY-A2", "EYES-B2", "BUDGET-B2", "K4"]) {
      expect([id, item(id).facet]).toEqual([id, expect.not.stringMatching(/할부|사양|휴가|어느 집 어른|브랜드|오래 아쉬워할지|대관료와 인당 식대로/)]);
    }
  });

  it("K8 카드는 '어떤 경우에 취소할 수 있는지'에 답한다: 물음과 같은 말(취소)로, 되는 경우와 안 될 수 있는 경우를 함께 적는다", () => {
    const k8 = item("K8");
    expect(k8.check_title).toMatch(/취소할 수 있다/);
    expect(k8.check_title + k8.check_note).not.toMatch(/물릴/);
    // 되는 경우: 상설 영업소가 아닌 박람회장 계약, 14일 안(청약 철회) · 안 될 수 있는 경우: 업체 자기 영업장 박람회
    expect(k8.check_note).toMatch(/상설 영업소가 아니라서[^.]*14일 안이면 계약을 취소할 수 있다\(청약 철회\)/);
    expect(k8.check_note).toMatch(/자기 영업장에서 연 박람회라면 이 권리가 인정되지 않을 수 있어요/);
  });
});

describe("wc64 결과 이름: 형용사 + 동물(2026-10-17 파운더 결정)", () => {
  const typeNames = Object.entries(WC64_BANK.types).map(([code, t]) => ({ code, ...t.name }));
  const noneNames = Object.entries(WC64_BANK.no_ceremony_names).map(([code, n]) => ({ code, ...n }));
  const all = [...typeNames, ...noneNames];

  it("16유형과 식 없이 넷 모두 이름이 있고, 식 없이 키는 리포트 code 모양(가운뎃점 U+00B7) 그대로다", () => {
    expect(typeNames).toHaveLength(16);
    expect(Object.keys(WC64_BANK.no_ceremony_names).sort()).toEqual(["D··M", "D··R", "O··M", "O··R"]);
    for (const n of all) {
      expect([n.code, typeof n.adjective === "string" && n.adjective.trim() !== "", typeof n.animal === "string" && n.animal.trim() !== ""])
        .toEqual([n.code, true, true]);
    }
    for (const code of Object.keys(WC64_BANK.no_ceremony_names)) expect(wc64NoCeremonyName(code)).toEqual(WC64_BANK.no_ceremony_names[code]);
    // 글자를 못 정한 자리·다른 모양·물려받은 키는 이름이 없다
    for (const bad of ["···M", "D···", "D..M", "DWCM", "DM", "toString", ""]) expect([bad, wc64NoCeremonyName(bad)]).toEqual([bad, null]);
  });

  it("동물 20개가 서로 다르고, 형용사 20개도 서로 다르다", () => {
    expect(all).toHaveLength(20);
    expect(new Set(all.map(n => n.animal)).size).toBe(20);
    expect(new Set(all.map(n => n.adjective)).size).toBe(20);
  });

  it("30문항 판(likert/characters)의 동물·형용사와 겹치지 않는다", () => {
    expect(LIKERT30_CHARACTERS.length).toBe(16);
    const animals = new Set(LIKERT30_CHARACTERS.map(c => c.animal));
    const adjectives = new Set(LIKERT30_CHARACTERS.map(c => c.adjective));
    expect(all.filter(n => animals.has(n.animal)).map(n => `${n.code}:${n.animal}`)).toEqual([]);
    expect(all.filter(n => adjectives.has(n.adjective)).map(n => `${n.code}:${n.adjective}`)).toEqual([]);
  });

  it("36문항 판 그림 동물(비버·펭귄·고양이·공작, 정하지 못했을 때의 수달)과 형용사와 겹치지 않는다", () => {
    // 36문항 판 설계 자료를 그대로 읽는다: 동물 후보 넷 + 이름을 정하지 못했을 때의 이름('형용사 동물' 꼴)
    const fallback = WC36_DESIGN.presentation_rules.fallback_name.split(" ");
    const animals = new Set([...Object.values(WC36_DESIGN.animal_candidates), fallback[fallback.length - 1]]);
    const adjectives = new Set([...Object.values(WC36_DESIGN.adjective_candidates), fallback.slice(0, -1).join(" ")]);
    expect(animals.size).toBe(5);
    expect(all.filter(n => animals.has(n.animal)).map(n => `${n.code}:${n.animal}`)).toEqual([]);
    expect(all.filter(n => adjectives.has(n.adjective)).map(n => `${n.code}:${n.adjective}`)).toEqual([]);
  });

  it("v3.1 판(V31_CHARACTERS, 결과 화면에 그려진다)의 동물·형용사와도 겹치지 않는다(2026-10-17 점검으로 OLCM 코끼리 겹침을 걷었다)", () => {
    expect(V31_CHARACTERS.length).toBe(16);
    // v3.1 은 '거북이'처럼 이 판과 다른 꼴로 적은 동물이 있어 '이'를 뗀 꼴로도 견준다
    const stem = (a: string) => a.replace(/이$/, "");
    const animals = new Set<string>(V31_CHARACTERS.flatMap(([, , animal]) => [animal, stem(animal)]));
    const adjectives = new Set<string>(V31_CHARACTERS.map(([, adjective]) => adjective));
    expect(all.filter(n => animals.has(n.animal) || animals.has(stem(n.animal))).map(n => `${n.code}:${n.animal}`)).toEqual([]);
    expect(all.filter(n => adjectives.has(n.adjective)).map(n => `${n.code}:${n.adjective}`)).toEqual([]);
  });

  it("형용사가 글자 단단함 칩 말(또렷해요·기울어 있어요·아슬해요·반반이에요)과 겹치지 않는다(2026-10-17 점검: '또렷한 벌새' 아래 '아슬해요'가 함께 뜬다)", () => {
    expect(all.filter(n => /또렷|기울|아슬|반반/.test(n.adjective)).map(n => `${n.code}:${n.adjective}`)).toEqual([]);
  });

  it("재판정으로 바꾼 이름: '벌레'가 든 동물과 '느림보'로 읽히는 달팽이가 없고, OWUM·OLUR 은 새 이름이다", () => {
    // 이름 심사 셋이 모두 major 로 짚었다: 무당벌레는 '벌레' 놀림과 무속, 달팽이는 O 를 '준비가 늦는 사람'으로 읽게 했다.
    expect(all.filter(n => /벌레/.test(n.animal) || /달팽이|나무늘보/.test(n.animal)).map(n => `${n.code}:${n.animal}`)).toEqual([]);
    expect([WC64_BANK.types.OWUM.name, WC64_BANK.types.OLUR.name]).toEqual([
      { adjective: "청량한", animal: "휘파람새" },
      { adjective: "고요한", animal: "파랑새" },
    ]);
  });

  it("형용사끼리 초성만 예사소리·거센소리·된소리로 바뀐 쌍이 없다(재판정: OLUR '잔잔한'과 OLCR '찬찬한'이 오타처럼 보였다)", () => {
    // 한글 음절을 초성·중성·종성으로 나눠, 같은 길이의 두 형용사가 초성만 같은 소리 무리(ㄱㄲㅋ·ㄷㄸㅌ·ㅂㅃㅍ·ㅅㅆ·ㅈㅉㅊ) 안에서 다른지 본다.
    const FAMILY = ["ㄱㄲㅋ", "ㄷㄸㅌ", "ㅂㅃㅍ", "ㅅㅆ", "ㅈㅉㅊ"];
    const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
    const split = (ch: string) => {
      const c = ch.charCodeAt(0) - 0xac00;
      return { cho: CHO[Math.floor(c / 588)], rest: c % 588 };
    };
    const typoLike = (a: string, b: string) => {
      if (a === b || a.length !== b.length) return false;
      let diff = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        const x = split(a[i]), y = split(b[i]);
        if (x.rest !== y.rest || !FAMILY.some(f => f.includes(x.cho) && f.includes(y.cho))) return false;
        diff++;
      }
      return diff > 0;
    };
    // 이 검사가 실제로 잡는 옛 쌍
    expect(typoLike("잔잔한", "찬찬한")).toBe(true);
    expect(typoLike("가지런한", "부지런한")).toBe(false);
    const pairs: string[] = [];
    for (const p of all) for (const q of all) if (p.code < q.code && typoLike(p.adjective, q.adjective)) pairs.push(`${p.code}:${p.adjective}/${q.code}:${q.adjective}`);
    expect(pairs).toEqual([]);
  });

  it("이름에 금지어가 없고, 이름은 낱말 두 개(형용사 한 낱말 + 동물 한 낱말)다", () => {
    for (const n of all) {
      const label = `${n.adjective} ${n.animal}`;
      expect([n.code, FORBIDDEN.test(label), /^[가-힣]+ [가-힣]+$/.test(label)]).toEqual([n.code, false, true]);
    }
  });
});
