import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WC64_BANK, WC64_ITEMS, isWc64CeremonyOff, wc64SectionById } from "@/lib/weddingCode/wc64/bank";
import {
  WC64_NO_CEREMONY_DIM_TEXT, WC64_NO_CEREMONY_KNOWLEDGE_TEXT, WC64_NO_CEREMONY_LEAD, wc64NoCeremonyNotAskedText,
} from "@/lib/weddingCode/wc64/copy";
import { buildWc64Report, wc64NextSteps, wc64TypeCopy } from "@/lib/weddingCode/wc64/model";
import type { Wc64Answer, Wc64Answers, Wc64Dim, Wc64DimId, Wc64Plan, Wc64Rating, Wc64TieRule } from "@/lib/weddingCode/wc64/types";
import { MOBILE_WEB_API_NONCE_PROPERTY } from "@/lib/mobile/mobileAuthenticatedFetch";
import { WC64_CLEAR_ANSWERS_LABEL } from "./Intro64";
import LetterChapter64, { WC64_LOGIN_HREF } from "./LetterChapter64";
import Report64, {
  WC64_CHIP_MEANING, WC64_GLANCE_STRONG_LABEL, WC64_LIMITS_TOPICS, WC64_OUTSIDE_NOTE, WC64_RESULT_NOTICE, wc64ReferenceNotice,
} from "./Report64";
import { WC64_REFERENCE_FOLD_LABEL, WC64_UNDECIDED_TEXT } from "./reportStyles";
import { wc64Notice } from "./styles";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 화면 글에 쓰지 않는 말. 리포트에는 예외가 없다(시작 안내의 고지 문장도 리포트에는 없어야 한다).
const FORBIDDEN = /MBTI|엠비티아이|검증된|정확|과학적|진단|궁합|당신은|예측|확률|속마음|무의식|상위\s*(?:\d+|몇)\s*%/i;
const NOTICE = "아직 실제 사람에게 확인하지 않은 새 질문이에요.";

const mounted: { root: Root; container: HTMLDivElement }[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await act(async () => m.root.unmount());
    m.container.remove();
  }
  vi.restoreAllMocks();
});

async function mount(answers: Wc64Answers, plan: Wc64Plan | null, extra: Partial<Parameters<typeof Report64>[0]> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const report = buildWc64Report(answers, plan, extra.skipped ?? {});
  await act(async () => {
    root.render(<Report64 report={report} answers={answers} plan={plan} onRestart={() => {}} onClearAnswers={() => {}} {...extra} />);
  });
  return { container, report };
}

/** 축마다 원하는 글자 쪽 문장에 5, 반대쪽 문장에 1. 이해도·비용 마련은 fill 값. */
function answersFor(code: string, fill: Wc64Answer = 4): Wc64Answers {
  const out: Wc64Answers = {};
  for (const it of WC64_ITEMS) out[it.id] = fill;
  WC64_BANK.dims.forEach((d, i) => {
    const wantX = code[i] === d.letter_a;
    for (const f of d.facets) {
      for (const it of wc64SectionById(f.axis)!.items) {
        const toX = it.pole === f.a_is;
        out[it.id] = toX === wantX ? 5 : 1;
      }
    }
  });
  return out;
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAnswers(seed: number): Wc64Answers {
  const rnd = seeded(seed);
  const out: Wc64Answers = {};
  for (const it of WC64_ITEMS) out[it.id] = (1 + Math.floor(rnd() * 5)) as Wc64Rating;
  return out;
}

const ALL_CODES = ["D", "O"].flatMap(a => ["W", "L"].flatMap(b => ["C", "U"].flatMap(c => ["M", "R"].map(d => a + b + c + d))));

/**
 * 은행에 적힌 결과 이름(형용사 + 동물, 2026-10-17 파운더 결정)을 띄어 쓴 한 줄. 모델(report.name)을 거치지 않고 은행을 바로 읽는다:
 * 네 글자는 types[코드].name, 식 없이 한 두 글자("D··M" 꼴, 가운뎃점 U+00B7)는 no_ceremony_names.
 */
function nameLabelOf(code: string): string {
  const n = /^[DO]··[MR]$/.test(code) ? WC64_BANK.no_ceremony_names[code] : WC64_BANK.types[code]?.name;
  if (!n) throw new Error(`이름이 없는 코드 ${code}`);
  return `${n.adjective} ${n.animal}`;
}
/** 은행의 이름 20개(16유형 + 식 없이 넷). 동물만으로는 '양'이 '양가'에 걸리므로 형용사까지 붙인 한 줄로 센다. */
const ALL_NAME_LABELS = [...Object.values(WC64_BANK.types).map(t => t.name), ...Object.values(WC64_BANK.no_ceremony_names)]
  .map(n => `${n.adjective} ${n.animal}`);

/** 화면에 읽히는 글: 본문 글자와 aria-label */
function screenText(container: HTMLElement): string {
  const labels = [...container.querySelectorAll("[aria-label]")].map(el => el.getAttribute("aria-label") ?? "");
  return `${container.textContent ?? ""}\n${labels.join("\n")}`;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("wc64 리포트 화면", () => {
  it("16코드 모두 그 코드와 유형 제목, 정한 글자 장 넷이 그려진다", async () => {
    expect(ALL_CODES).toHaveLength(16);
    for (const code of ALL_CODES) {
      const { container, report } = await mount(answersFor(code), "yes");
      expect(report.code).toBe(code);
      const slots = [...container.querySelectorAll("h1 [data-letter-slot]")].map(el => el.textContent);
      expect(slots.join("")).toBe(code);
      const title = `${WC64_BANK.types[code].title}, ${WC64_BANK.types[code].sub}`;
      expect(container.querySelector('[data-testid="wc64-type-title"]')?.textContent).toBe(title);
      // 유형 카드 머리는 이름(2026-10-17 결과 이름 결정)이고 유형 제목은 그 아래 작게
      expect([...container.querySelectorAll("h2")].find(h => h.id === "wc64-type")?.textContent).toBe(nameLabelOf(code));
      expect(container.querySelector('[data-testid="wc64-type-subtitle"]')?.textContent).toBe(title);
      expect(container.querySelectorAll('section[data-dim][data-decided="true"]')).toHaveLength(4);
      for (const tip of wc64TypeCopy(WC64_BANK.types[code], report.hiddenTags).tips) expect(container.textContent).toContain(tip);
      expect(container.querySelectorAll("[data-scene]")).toHaveLength(WC64_BANK.scenes.length);
    }
  });

  it("글자마다 두 %의 합이 100이고, 막대는 role=img 와 읽어 줄 이름을 가진다", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { container, report } = await mount(randomAnswers(seed), "yes");
      const rows = [...container.querySelectorAll('[data-axis][data-decided="true"]')];
      expect(rows.length).toBe(report.dims.filter(r => r.decided).length);
      for (const row of rows) {
        const x = Number(row.querySelector('[data-pct-side="x"] b')?.textContent);
        const y = Number(row.querySelector('[data-pct-side="y"] b')?.textContent);
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
        expect(x + y).toBe(100);
        // 점과 채움은 앞 글자(X) 쪽이 왼쪽 끝이다: X 가 클수록 점이 왼쪽으로 간다
        const bar = row.querySelector<HTMLElement>('[role="img"][data-pct-x]')!;
        expect(Number(bar.dataset.pctX)).toBe(x);
        expect(bar.querySelector<HTMLElement>('[data-dot="true"]')!.style.left).toBe(`${100 - x}%`);
        const fill = bar.querySelector<HTMLElement>('[data-fill="true"]')!;
        const fl = parseFloat(fill.style.left), fw = parseFloat(fill.style.width);
        if (x > 50) expect(fl + fw).toBe(50);
        if (x < 50) expect(fl).toBe(50);
      }
      for (const r of report.dims) if (r.decided) expect(r.pctX + r.pctY).toBe(100);
      if (report.fund.decided) expect(report.fund.pctA + report.fund.pctB).toBe(100);
      const bars = [...container.querySelectorAll('[role="img"]')];
      expect(bars.length).toBeGreaterThan(4);
      for (const bar of bars) expect(bar.getAttribute("aria-label")).toMatch(/\d+%.*\d+%/);
    }
  });

  it("동점이면 반반 문구와 점선 밑줄, 아슬·반반 설명이 나온다", async () => {
    const answers: Wc64Answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, 3 as Wc64Answer]));
    const { container, report } = await mount(answers, "yes");
    for (const r of report.dims) {
      expect(r.decided && r.tie && r.level === "half").toBe(true);
    }
    const slots = [...container.querySelectorAll("h1 [data-letter-slot]")];
    expect(slots).toHaveLength(4);
    for (const s of slots) {
      expect(s.getAttribute("data-tie")).toBe("true");
      expect(s.className).toContain("decoration-dotted");
    }
    for (const d of WC64_BANK.dims) {
      const firm = container.querySelector(`[data-testid="wc64-firm-${d.id}"]`)?.textContent ?? "";
      expect(firm).toContain("양쪽 문장에 동의한 정도가 똑같아서 딱 반반이에요.");
      expect(container.textContent).toContain(d.balanced);
    }
    expect(count(container.textContent ?? "", "반반이에요")).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll("details summary").length).toBeGreaterThanOrEqual(4 + 2);
  });

  it("동점이 아니면 점선 밑줄이 없다", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    for (const s of container.querySelectorAll("h1 [data-letter-slot]")) {
      expect(s.getAttribute("data-tie")).toBe("false");
      expect(s.className).not.toContain("decoration-dotted");
    }
  });

  it("식을 안 올리면 CIRCLE·SPEND 자리는 '·'이고 두 글자만 정했다고 쓴다(DEC-1)", async () => {
    const { container, report } = await mount(answersFor("DWCM"), "none");
    expect(report.code).toBe("D··M");
    for (const dim of ["SPEND", "CIRCLE"]) {
      expect(container.querySelector(`h1 [data-letter-slot="${dim}"]`)?.textContent).toBe("·");
      const row = container.querySelector(`[data-axis="${dim}"]`)!;
      expect(row.getAttribute("data-reason")).toBe("no-ceremony");
      expect(row.textContent).toContain(WC64_UNDECIDED_TEXT["no-ceremony"]);
      expect(container.querySelector(`section[data-dim="${dim}"]`)?.getAttribute("data-reason")).toBe("no-ceremony");
      expect(container.querySelector(`[data-testid="wc64-undecided-${dim}"]`)?.textContent).toContain(WC64_UNDECIDED_TEXT["no-ceremony"]);
    }
    expect(container.querySelector('[data-testid="wc64-code-meta"]')?.textContent).toContain("식 없이 하기로 해서 고른 답을 두 글자로 줄였어요.");
    // 두 글자뿐이라 글자 밖 카드를 '네 글자 밖'이라고 부르지 않는다(2단계 검토). 가리키는 이름과 카드 제목이 같다.
    expect(container.querySelector('[data-testid="wc64-undecided-SPEND"]')?.textContent).toContain("예산을 지키는 정도는 아래 ‘글자 밖에서 본 것’에 따로 적었어요.");
    // 같은 말을 결과 카드에 한 번 더 쓰지 않는다(2026-10-17 점검: 같은 화면에 두 번 나왔다)
    expect(container.querySelector('[data-testid="wc64-code-meta"]')?.textContent).not.toContain("에 따로 적었어요");
    expect(count(container.textContent ?? "", "예산을 지키는 정도는 아래")).toBe(1);
    expect(container.querySelector('[id="wc64-fund"]')?.textContent).toBe("글자 밖에서 본 것");
    expect(container.textContent).not.toContain("네 글자 밖");
    // 비워 둔 까닭은 공용 문구 그대로다
    expect(WC64_UNDECIDED_TEXT["no-ceremony"]).toBe(WC64_NO_CEREMONY_DIM_TEXT);
    expect(WC64_NO_CEREMONY_DIM_TEXT).toBe("식 없이 하기로 해서 이 글자는 비워 뒀어요.");
    const { container: yes } = await mount(answersFor("DWCM"), "yes");
    expect(yes.querySelector('[id="wc64-fund"]')?.textContent).toBe("네 글자 밖에서 본 것");
    expect([...container.querySelectorAll("h2")].some(h => h.id === "wc64-type")).toBe(false);
    expect(container.querySelectorAll("h2").length).toBeGreaterThan(5);
    expect(container.querySelector('[data-testid="wc64-type-title"]')).toBeNull();
  });

  it("이해도 0단계는 '이제 첫걸음이에요'로, 1단계 이상은 '…까지 짚어 볼 수 있다고'로 적는다", async () => {
    const low = answersFor("DWCM");
    for (const it of WC64_ITEMS) if (it.pole === "L") low[it.id] = (it.id.charCodeAt(it.id.length - 1) % 2 ? 1 : 2) as Wc64Answer;
    const { container, report } = await mount(low, "yes");
    expect(report.knowledge.stage).toBe(0);
    const stage = container.querySelector('[data-testid="wc64-knowledge-stage"]')!.textContent;
    expect(stage).toBe(`${WC64_BANK.knowledge.stages[0]}이에요.`);
    expect(container.textContent).toContain("이제 첫걸음이에요.");
    expect(container.textContent).not.toContain("첫걸음 짚어");
    const high = answersFor("DWCM", 4);
    const { container: c2, report: r2 } = await mount(high, "yes");
    expect(r2.knowledge.stage).toBeGreaterThan(0);
    expect(c2.querySelector('[data-testid="wc64-knowledge-stage"]')!.textContent)
      .toBe(`${WC64_BANK.knowledge.stages[r2.knowledge.stage]} 짚어 볼 수 있다고 고르셨어요.`);
  });

  it("'사람에게 확인하지 않았다'는 말은 고지 한 번뿐이고, 읽는 법에 같은 말을 되풀이하지 않는다", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    expect(container.textContent).not.toContain("사람 응답으로 아직 확인하지 않은 초안이에요.");
    expect(container.textContent).toContain(WC64_GLANCE_STRONG_LABEL);
    expect(container.textContent).not.toContain("뚜렷");
  });

  it("고지 문장이 결과 화면에 딱 한 번 나온다", async () => {
    expect(WC64_RESULT_NOTICE).toBe(NOTICE);
    for (const [answers, plan] of [[answersFor("OLUR"), "yes"], [answersFor("DWCM"), "none"], [{}, null]] as const) {
      const { container } = await mount(answers, plan);
      expect(count(container.textContent ?? "", NOTICE)).toBe(1);
    }
  });

  it("화면 글과 읽어 주는 이름에 금지어가 없다(시작 안내의 고지 문장도 없다)", async () => {
    const cases: [Wc64Answers, Wc64Plan | null][] = [
      ...ALL_CODES.map(c => [answersFor(c, 2), "yes"] as [Wc64Answers, Wc64Plan]),
      [Object.fromEntries(WC64_ITEMS.map(it => [it.id, 3 as Wc64Answer])), "maybe"],
      [answersFor("DWCM"), "none"],
      [{}, null],
      ...[11, 12, 13, 14, 15, 16].map(s => [randomAnswers(s), "yes"] as [Wc64Answers, Wc64Plan]),
    ];
    for (const [answers, plan] of cases) {
      const { container } = await mount(answers, plan);
      // '달라요'를 눌러 펼쳐지는 글까지 본다
      for (const b of [...container.querySelectorAll("button")].filter(b => b.textContent === "달라요")) {
        await act(async () => (b as HTMLButtonElement).click());
      }
      const text = screenText(container);
      const hit = text.match(FORBIDDEN);
      expect(hit?.[0] ?? null).toBeNull();
      // 성향 문항 전체 안내(2026-10-16 감사 FIX-21 로 PLAN 묶음 안내로 옮김)는 리포트에 없다
      expect(text).not.toContain(wc64SectionById("PLAN")!.intro);
      expect(text).not.toContain("검증된 심리검사는 아니고");
    }
  });

  it("출처 링크는 새 창(target=_blank)과 rel=noreferrer 로 연다", async () => {
    const { container, report } = await mount(answersFor("DWCM", 2), "yes");
    expect(report.knowledge.recheck.length).toBe(3);
    expect(container.textContent).toContain("알아 두면 좋은 것");
    expect(container.textContent).toContain(WC64_BANK.meta.recheck_note);
    expect(container.textContent).toContain(`확인 ${WC64_BANK.meta.checked_on}`);
    // 로그인 링크를 뺀 링크는 모두 바깥 출처다. 그 밖에 앱 안 주소(/…)로 가는 링크는 없고, 바로 가기는 링크가 아니다(PRIV-4).
    const all = [...container.querySelectorAll("a[href]")];
    expect(all.filter(a => (a.getAttribute("href") ?? "").startsWith("#"))).toHaveLength(0);
    // 앱 안 주소는 공개 결과의 로그인 링크 하나만 예외다(DEC-3). 이것도 새 창으로 연다.
    const login = all.filter(a => a.getAttribute("href") === WC64_LOGIN_HREF);
    expect(login).toHaveLength(1);
    expect(login[0].getAttribute("target")).toBe("_blank");
    const links = all.filter(a => !(a.getAttribute("href") ?? "").startsWith("#") && a.getAttribute("href") !== WC64_LOGIN_HREF);
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(/^https?:\/\//);
      expect(a.getAttribute("target")).toBe("_blank");
      expect((a.getAttribute("rel") ?? "").split(/\s+/)).toContain("noreferrer");
    }
  });

  it("'맞아요/달라요'는 화면 state 에만 두고 저장하지 않으며, 다시 하기와 답 지우기는 부모 콜백을 부른다", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const hashBefore = window.location.hash;
    const onRestart = vi.fn();
    const onClearAnswers = vi.fn();
    const { container } = await mount(answersFor("DLCR"), "yes", { onRestart, onClearAnswers });
    const pace = container.querySelector('section[data-dim="PACE"]') as HTMLElement;
    const [yes, no] = ["맞아요", "달라요"].map(t => [...pace.querySelectorAll("button")].find(b => b.textContent === t) as HTMLButtonElement);
    expect(yes.getAttribute("aria-pressed")).toBe("false");
    await act(async () => no.click());
    expect(no.getAttribute("aria-pressed")).toBe("true");
    expect(pace.querySelector('[role="status"]')?.textContent).toContain("2~3주 뒤 다시 해 보세요");
    await act(async () => yes.click());
    expect(yes.getAttribute("aria-pressed")).toBe("true");
    // '맞아요'에도 짧게 답하고, 저장하지 않는다는 사실만 적는다(UX-8)
    const status = [...pace.querySelectorAll('[role="status"]')];
    expect(status).toHaveLength(1);
    expect(status[0].textContent).toBe("맞다고 표시했어요. 이 표시는 이 화면에만 남고 저장하지 않아요.");
    const buttons = [...container.querySelectorAll("button")];
    await act(async () => buttons.find(b => b.textContent === "처음부터 다시 하기")!.click());
    // 지우기 버튼 이름은 시작·문항 화면과 같다(M3, Intro64 의 공용 이름)
    await act(async () => buttons.find(b => b.textContent === WC64_CLEAR_ANSWERS_LABEL)!.click());
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onClearAnswers).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(hashBefore);
    vi.unstubAllGlobals();
  });

  it("리포트 순서가 원본과 같고, 비교 자리는 비용 마련 뒤·다음에 해 볼 것 앞에 온다", async () => {
    const { container } = await mount(answersFor("OWUM"), "yes", { compareSlot: <section id="slot-test">비교 자리</section> });
    const headings = [...container.querySelectorAll("h1, h2, #slot-test")].map(el => el.id || el.textContent);
    const order = [
      "wc64-code", "wc64-glance", "wc64-readhow", "wc64-knowledge",
      "wc64-ch-PACE", "wc64-ch-SPEND", "wc64-ch-CIRCLE", "wc64-ch-BOND",
      "wc64-type", "wc64-scenes", "wc64-fund", "slot-test", "wc64-next", "wc64-answers", "wc64-limits",
    ];
    expect(headings).toEqual(order);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent).toContain("고른 답을 네 글자로 줄였어요. 다른 사람과 비교한 점수가 아니에요.");
    expect(container.textContent).toContain("스스로 안다고 고른 정도예요. 맞히는 시험이 아니에요.");
    expect(container.textContent).toContain(WC64_BANK.fund.why_outside);
  });

  it("내 답 전체 보기는 문장마다 어느 글자 쪽인지와 고른 칸을 보여 준다", async () => {
    const answers = answersFor("DWCM");
    answers.K1 = 0;
    delete answers.K2;
    const { container } = await mount(answers, "yes");
    const rows = container.querySelectorAll("[data-answer-item]");
    expect(rows).toHaveLength(64);
    expect(container.querySelector('[data-answer-item="K1"]')?.textContent).toContain("해당 없음");
    expect(container.querySelector('[data-answer-item="K2"]')?.textContent).toContain("답 없음");
    expect(container.textContent).not.toContain("건너뜀");
    const plan = WC64_BANK.dims[0].facets[0];
    const first = wc64SectionById(plan.axis)!.items[0];
    const side = first.pole === plan.a_is ? "D" : "O";
    expect(container.querySelector(`[data-answer-item="${first.id}"]`)?.textContent).toContain(`${side} 쪽`);
  });
});

/* ---------------- 2026-10-16 감사 고침(결과 화면 갈래) ---------------- */

/** 이해도 단계별로 같은 값을 넣는다 */
function withKnowledge(base: Wc64Answers, byLevel: Record<string, Wc64Answer>): Wc64Answers {
  const out = { ...base };
  for (const it of wc64SectionById("KNOW")!.items) out[it.id] = byLevel[it.level];
  return out;
}

/** 규칙마다 그 규칙으로 동점을 푼 축이 하나 있는 답(무작위 답에서 찾는다) */
function tieFixtures(): Map<Wc64TieRule, { answers: Wc64Answers; dim: Wc64DimId }> {
  const found = new Map<Wc64TieRule, { answers: Wc64Answers; dim: Wc64DimId }>();
  const pools: Wc64Rating[][] = [[1, 2, 3, 4, 5], [3, 4, 5], [4, 5], [2, 3, 4]];
  for (let seed = 1; seed < 20000 && found.size < 5; seed++) {
    const rnd = seeded(seed * 7919);
    const pool = pools[seed % pools.length];
    const a: Wc64Answers = {};
    for (const it of WC64_ITEMS) a[it.id] = pool[Math.floor(rnd() * pool.length)];
    for (const r of buildWc64Report(a, "yes").dims) {
      if (r.decided && r.tieRule && !found.has(r.tieRule)) found.set(r.tieRule, { answers: a, dim: r.dim });
    }
  }
  return found;
}

const S = WC64_BANK.meta.scale;
/** 규칙마다 화면에 나와야 하는 까닭(다른 규칙의 까닭은 나오면 안 된다) */
const TIE_PHRASE: Record<Wc64TieRule, (letterA: string) => string> = {
  five: () => `그래서 ‘${S[4]}’를 고른 비율이 더 높은 쪽 글자`,
  agree: () => `‘${S[3]}’나 ‘${S[4]}’를 고른 비율이 더 높은 쪽 글자`,
  disagree: () => `‘${S[0]}’나 ‘${S[1]}’를 고른 비율이 더 낮은 쪽 글자`,
  facet: () => "더 많은 묶음이 기운 쪽 글자",
  default: a => `정해 둔 순서대로 앞 글자 ${a}`,
};

describe("wc64 리포트 화면: 2026-10-16 감사 고침", () => {
  it("동점 설명은 글자를 정한 규칙마다 그 규칙을 말하고, 다른 규칙과 옛 거짓 문장은 말하지 않는다(FIX-4)", async () => {
    const fixtures = tieFixtures();
    expect([...fixtures.keys()].sort()).toEqual(["agree", "default", "disagree", "facet", "five"]);
    for (const [rule, { answers, dim }] of fixtures) {
      const { container, report } = await mount(answers, "yes");
      const r = report.dims.find(x => x.dim === dim)!;
      expect(r.decided && r.tie && r.tieRule === rule).toBe(true);
      const d = WC64_BANK.dims.find(x => x.id === dim)!;
      const firm = container.querySelector(`[data-testid="wc64-firm-${dim}"]`)?.textContent ?? "";
      expect(firm, rule).toContain(TIE_PHRASE[rule](d.letter_a));
      for (const other of Object.keys(TIE_PHRASE) as Wc64TieRule[]) {
        if (other !== rule) expect(firm, `${rule} 에 ${other}`).not.toContain(TIE_PHRASE[other](d.letter_a));
      }
      const otherLetter = r.decided && r.letterSide === "X" ? d.letter_b : d.letter_a;
      expect(firm).toContain(`반대 글자 ${otherLetter}`);
      expect(container.textContent).not.toContain("더 많이 고른 쪽 글자를 붙였어요");
    }
    // 모두 '반반이에요'면 네 축 모두 마지막 규칙(앞 글자)이다
    const all3: Wc64Answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, 3 as Wc64Answer]));
    const { container } = await mount(all3, "yes");
    for (const d of WC64_BANK.dims) {
      expect(container.querySelector(`[data-testid="wc64-firm-${d.id}"]`)?.textContent).toContain(TIE_PHRASE.default(d.letter_a));
    }
  });

  it("한 축을 모두 '반반이에요'로 고르면 빈 '이렇게 고르셨어요' 대신 그 사실을 한 줄로 쓴다(FIX-15)", async () => {
    const all3: Wc64Answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, 3 as Wc64Answer]));
    const { container } = await mount(all3, "yes");
    for (const d of WC64_BANK.dims) {
      const sec = container.querySelector(`section[data-dim="${d.id}"]`)!;
      expect(sec.querySelector(`[data-testid="wc64-no-quotes-${d.id}"]`)?.textContent).toContain(`‘${S[2]}’로 골라서`);
      expect([...sec.querySelectorAll("h3")].map(h => h.textContent)).not.toContain("이렇게 고르셨어요");
    }
    const { container: c2 } = await mount(answersFor("DWCM"), "yes");
    expect(c2.querySelector('[data-testid^="wc64-no-quotes-"]')).toBeNull();
    expect([...c2.querySelectorAll("h3")].filter(h => h.textContent === "이렇게 고르셨어요")).toHaveLength(4);
  });

  it("식을 안 올리면 앱이 뺀 문장을 '건너뜀'·'답이 적어'로 쓰지 않는다(FIX-9)", async () => {
    const { container, report } = await mount(answersFor("DWCM"), "none");
    const text = container.textContent ?? "";
    expect(text).not.toContain("건너뜀");
    const off = WC64_ITEMS.filter(it => isWc64CeremonyOff(it.id, "none")).length;
    expect(off).toBeGreaterThan(0);
    const notAsked = container.querySelector("[data-answer-not-asked]");
    expect(notAsked?.getAttribute("data-answer-not-asked")).toBe(String(off));
    expect(notAsked?.textContent).toContain(`식 관련 문장 ${off}개는 묻지 않았어요`);
    for (const it of WC64_ITEMS.filter(x => isWc64CeremonyOff(x.id, "none"))) {
      expect(container.querySelector(`[data-answer-item="${it.id}"]`), it.id).toBeNull();
    }
    expect(container.querySelectorAll("[data-answer-item]")).toHaveLength(WC64_ITEMS.length - off);
    // 이해도: 식 문항만 있는 단계는 '식 없이 하기로 해서 묻지 않았어요'
    const offRungs = report.knowledge.levels.filter(l => l.state === "skip" && l.skipReason === "no-ceremony");
    expect(offRungs.length).toBeGreaterThan(0);
    for (const l of offRungs) {
      const li = [...container.querySelectorAll('li[data-state="skip"]')].find(x => x.textContent?.startsWith(l.L))!;
      expect(li.getAttribute("data-skip-reason")).toBe("no-ceremony");
      expect(li.textContent).toContain(WC64_NO_CEREMONY_KNOWLEDGE_TEXT);
    }
    expect(notAsked?.textContent).toBe(wc64NoCeremonyNotAskedText(off));
    // 같은 선택을 다른 말로 부르지 않는다(2단계 검토): 머리말은 늘 '식 없이 하기로 해서'
    await openAll(container);
    expect(screenText(container)).not.toMatch(/식을 안 올|식을 올리지 않|안 올려서/);
    expect(count(container.textContent ?? "", WC64_NO_CEREMONY_LEAD)).toBeGreaterThanOrEqual(4);
    // 글자 장: 식 없이 해서 정할 수 없는 글자는 '답이 적어'·'모자라'가 아니라 식 때문이라고 쓴다(DEC-1 뒤로 SPEND 도 미정)
    for (const dim of ["SPEND", "CIRCLE"]) {
      const sec = container.querySelector(`section[data-dim="${dim}"]`)!;
      expect(sec.getAttribute("data-decided")).toBe("false");
      expect(sec.textContent).not.toMatch(/답이 적어|모자라/);
    }
    // 같은 답을 식을 올린다고 하면 그 줄들이 없다
    const { container: yes } = await mount(answersFor("DWCM"), "yes");
    expect(yes.querySelector("[data-answer-not-asked]")).toBeNull();
    expect(yes.textContent).not.toContain("식 관련 문장");
  });

  it("문장이 8개보다 적어 '기울어 있어요'로 낮췄으면 그 까닭을 쓰고, 8개 기준은 읽는 법에만 쓴다(FIX-15·1단계 검토)", async () => {
    // 한 축의 첫 묶음을 모두 '해당 없음', 둘째 묶음 한 문장도 '해당 없음'으로 골라 문장이 8개보다 적어진 축을 찾는다
    let found: { answers: Wc64Answers; skipped: Record<string, boolean>; dim: Wc64DimId } | null = null;
    for (const d of WC64_BANK.dims) {
      const answers = answersFor("DWCM");
      for (const it of wc64SectionById(d.facets[0].axis)!.items) answers[it.id] = 0;
      answers[wc64SectionById(d.facets[1].axis)!.items[0].id] = 0;
      const r = buildWc64Report(answers, "yes").dims.find(x => x.dim === d.id && x.decided && x.cappedByN);
      if (r) { found = { answers, skipped: {}, dim: r.dim }; break }
    }
    expect(found).not.toBeNull();
    const { container, report } = await mount(found!.answers, "yes", { skipped: found!.skipped });
    const capped = report.dims.find(r => r.dim === found!.dim)!;
    expect(capped.decided && capped.cappedByN && capped.level === "lean").toBe(true);
    const line = container.querySelector(`[data-testid="wc64-capped-${found!.dim}"]`)?.textContent ?? "";
    expect(line).toBe(`계산에 들어간 문장이 ${capped.n}개뿐이라, 답이 한결같아도 ‘또렷해요’ 대신 ‘기울어 있어요’로 보여 드려요.`);
    expect(line).not.toContain("적었어요");
    expect(line).not.toContain("8개 이상일 때만");
    expect(count(container.textContent ?? "", "8개 이상일 때만")).toBe(1);
    const { container: yes } = await mount(answersFor("DWCM"), "yes");
    expect(yes.querySelector('[data-testid^="wc64-capped-"]')).toBeNull();
    expect(yes.textContent).toContain("‘또렷해요’는 계산에 들어간 문장이 8개 이상일 때만 붙여요.");
  });

  it("이해도 앞 단계가 아직인데 뒤 단계를 통과했으면 그 사실을 쓴다(FIX-2 화면)", async () => {
    const answers = withKnowledge(answersFor("DWCM"), { L1: 1, L2: 1, L3: 5, L4: 5 });
    const { container, report } = await mount(answers, "yes");
    expect(report.knowledge.stage).toBe(0);
    expect(report.knowledge.passedLater).toEqual(["L3", "L4"]);
    const later = container.querySelector('[data-testid="wc64-knowledge-later"]')?.textContent ?? "";
    const [n1, , n3, n4] = WC64_BANK.knowledge.levels;
    expect(later).toBe(`L1 ‘${n1}’ 칸이 아직이라 단계는 그 앞까지로 봤어요. 그 뒤 L3 ‘${n3}’, L4 ‘${n4}’도 안다고 고르셨어요.`);
    // '단계'를 한 문장에 되풀이하지 않는다(2단계 검토)
    expect(count(later, "단계")).toBe(1);
    // '설명할 수 있다'는 통과 기준(평균 4 이상)보다 크게 말한다(1단계 검토)
    expect(container.querySelector('[data-testid="wc64-knowledge-pct"]')!.closest("section")!.textContent).not.toContain("설명할 수 있");
    const { container: c2 } = await mount(withKnowledge(answersFor("DWCM"), { L1: 5, L2: 5, L3: 5, L4: 5 }), "yes");
    expect(c2.querySelector('[data-testid="wc64-knowledge-later"]')).toBeNull();
  });

  it("가족 묶음을 넘기면 가족 장면과 둘이 꾸리는 방식 장의 가족 문장이 없다(FIX-12)", async () => {
    const famIds = wc64SectionById("FAMILY")!.items.map(it => it.id);
    const FAMILY_WORDS = /부모님|양가|어른들/;
    // 넘기지 않으면 같은 장에 가족 문장이 있다(시험이 헛돌지 않는지)
    const { container: kept } = await mount(answersFor("DWCM"), "yes");
    expect(kept.querySelector('section[data-dim="BOND"]')!.textContent).toMatch(FAMILY_WORDS);
    const answers = answersFor("DWCM");
    for (const id of famIds) answers[id] = 0;
    const { container, report } = await mount(answers, "yes", { skipped: { FAMILY: true } });
    expect(report.skippedSections).toContain("FAMILY");
    const bond = container.querySelector('section[data-dim="BOND"]') as HTMLElement;
    expect(bond.getAttribute("data-decided")).toBe("true");
    for (const b of [...bond.querySelectorAll("button")].filter(x => x.textContent === "달라요")) await act(async () => b.click());
    expect(screenText(bond)).not.toMatch(FAMILY_WORDS);
    expect(bond.querySelector('[data-facet="FAMILY"]')).toBeNull();
    expect(bond.querySelector("[data-facet-skipped]")?.textContent).toContain("묶음 1개는 빼고");
    expect(container.querySelector('[data-scene="family"]')).toBeNull();
    // 내 답 전체: 넘긴 묶음은 한 줄
    expect(container.querySelector('[data-answer-skipped="FAMILY"]')?.textContent).toContain("이 묶음은 넘겼어요");
    for (const id of famIds) expect(container.querySelector(`[data-answer-item="${id}"]`)).toBeNull();
  });

  it("장면 묶음을 글자와 반대쪽으로 답했으면 단정 문장 대신 섞은 문장과 그 까닭을 쓴다(FIX-13)", async () => {
    const answers = answersFor("DWCM");
    const pace = WC64_BANK.dims.find(d => d.id === "PACE")!;
    const talk = pace.facets.find(f => f.axis === "TALK")!;
    for (const it of wc64SectionById("TALK")!.items) answers[it.id] = it.pole === talk.a_is ? 2 : 4;
    const { container, report } = await mount(answers, "yes");
    const r = report.dims.find(x => x.dim === "PACE")!;
    expect(r.decided && r.letter === "D" && (r.level === "clear" || r.level === "lean")).toBe(true);
    const sc = report.scenes.find(s => s.id === "disagree")!;
    expect(sc.facetPos).toBe("opp");
    const el = container.querySelector('[data-scene="disagree"]')!;
    expect(el.getAttribute("data-scene-key")).toBe("half");
    expect(el.getAttribute("data-scene-facet-pos")).toBe("opp");
    expect(el.textContent).toContain(WC64_BANK.scenes.find(s => s.id === "disagree")!.half.here);
    expect(el.querySelector('[data-scene-mix="disagree"]')?.textContent).toBe(`‘${wc64SectionById("TALK")!.title}’에서 글자와 반대쪽으로 고르셔서, 이 장면은 두 쪽 모습을 섞어 보여 드려요.`);
    // 질문 화면에 없는 안쪽 말 '묶음'과 '~로 적었어요'를 쓰지 않는다(2026-10-17 점검)
    expect(container.querySelector('[data-testid="wc64-scenes-intro"]')?.textContent).not.toMatch(/묶음|적었어요/);
    // 재판정: 앱이 고른 방법을 말하는 '골랐어요'·뜻 모를 '이어진 글자'·여기만 쓰던 '질문'을 걷었다. 글자는 장면 제목 옆 말에 있다.
    const intro = container.querySelector('[data-testid="wc64-scenes-intro"]')!.textContent!;
    expect(intro).not.toMatch(/골랐어요|이어진 글자|질문/);
    expect(intro).toContain("제목 옆에 적힌 글자");
    expect(el.querySelector("h3")!.nextElementSibling!.textContent).toMatch(/^[DOWLCUMR] \d+% · /);
    // 같은 쪽 장면에는 까닭 줄이 없다
    for (const s of report.scenes.filter(x => x.facetPos === "same")) {
      expect(container.querySelector(`[data-scene-mix="${s.id}"]`)).toBeNull();
    }
  });

  it("결과 제목에 초점 표시가 있고(하나뿐), 라운지 안이면 h2 로 그린다(FIX-14)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    const h1 = container.querySelector("#wc64-code") as HTMLElement;
    expect(h1.tagName).toBe("H1");
    expect(h1.hasAttribute("data-wc64-focus")).toBe(true);
    expect(h1.tabIndex).toBe(-1);
    expect(container.querySelectorAll("[data-wc64-focus]")).toHaveLength(1);
    const { container: lounge } = await mount(answersFor("DWCM"), "yes", { embedded: true });
    expect(lounge.querySelectorAll("h1")).toHaveLength(0);
    // 같은 id 가 앞 시험 화면에도 있어 jsdom 의 #id 찾기가 문서 첫 요소를 고르므로 속성 선택자로 찾는다
    const h2 = lounge.querySelector('[id="wc64-code"]') as HTMLElement;
    expect(h2.tagName).toBe("H2");
    expect(h2.hasAttribute("data-wc64-focus")).toBe(true);
    expect(h2.tabIndex).toBe(-1);
  });

  it("접는 칸 머리에는 제목(h)이 없고 '펼치기'와 꺾쇠가 있다(FIX-14)", async () => {
    const all3: Wc64Answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, 3 as Wc64Answer]));
    const { container } = await mount(all3, "yes");
    const summaries = [...container.querySelectorAll("summary")];
    expect(summaries.length).toBeGreaterThanOrEqual(6);
    expect(container.querySelectorAll("summary h1, summary h2, summary h3")).toHaveLength(0);
    for (const s of summaries) {
      expect(s.className).toContain("list-none");
      expect(s.className).toContain("after:rotate-45");
      expect(s.className).toContain("[details[open]>&]:after:-rotate-135");
    }
    for (const id of ["wc64-readhow", "wc64-answers"]) {
      const sec = container.querySelector(`section[aria-labelledby="${id}"]`)!;
      expect(sec.querySelector(`h2#${id}`)).not.toBeNull();
      // '펼치기'·'접기'는 summary 의 바로 아래 자식이어야 열림 상태 클래스가 듣는다. 앞에는 무엇을 펼치는지 읽어 줄 글이 있다(A11Y-4).
      const kids = [...sec.querySelector("summary")!.children];
      expect(kids.map(k => k.textContent)).toEqual([`${sec.querySelector("h2")!.textContent} `, "펼치기", "접기"]);
      expect(kids[0].className).toBe("sr-only");
    }
  });

  it("옅은 띠의 범위를 글과 막대의 읽어 줄 이름에 숫자로 쓴다(FIX-14)", async () => {
    const { container, report } = await mount(randomAnswers(3), "yes");
    for (const r of report.dims) {
      if (!r.decided) continue;
      // 폭은 이 사람 글자 쪽 %로 쓴다(r.band 는 앞 글자 쪽 %)
      const [lo, hi] = r.letterSide === "X" ? [r.band[0], r.band[1]] : [100 - r.band[1], 100 - r.band[0]];
      const range = `${Math.round(lo)}~${Math.round(hi)}%`;
      const sec = container.querySelector(`section[data-dim="${r.dim}"]`)!;
      expect(sec.querySelector(`[data-testid="wc64-band-${r.dim}"]`)?.textContent)
        .toBe(`문장을 반씩 나눠 여러 번 다시 계산해 보면 대부분 ${r.letter}쪽 ${range} 사이예요. 옅은 띠가 그 폭이에요.`);
      const bar = [...sec.querySelectorAll('[role="img"]')].find(b => b.querySelector('[data-band="true"]'))!;
      expect(bar.getAttribute("aria-label")).toContain(`다시 계산해도 대부분 ${r.letter}쪽 ${range}`);
    }
  });

  it("결과 고지는 시작 화면과 같은 상자로 막대보다 앞에, 단단함 문장은 본문 글씨로 쓴다(FIX-14)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    const notice = container.querySelector('[data-testid="wc64-result-notice"]') as HTMLElement;
    expect(notice.className).toBe(wc64Notice);
    const firstBar = container.querySelector("[data-axis]")!;
    expect(notice.compareDocumentPosition(firstBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const d of WC64_BANK.dims) {
      const firm = container.querySelector(`[data-testid="wc64-firm-${d.id}"]`) as HTMLElement;
      expect(firm.className).toContain("text-sm");
      expect(firm.className).not.toContain("text-xs");
    }
  });

  it("한눈에 보기의 글자는 모델 순서대로이고, % 크기 순이 아니라서 '크게 기운'도 '한쪽으로 모인'(기울기 말)도 아니라 '답이 가장 한결같은'으로 부른다(FIX-15·M8·재판정)", async () => {
    let sawClearOnly = false, sawMixed = false;
    for (let seed = 21; seed < 61; seed++) {
      const { container, report } = await mount(randomAnswers(seed), "yes");
      const li = container.querySelector('[data-testid="wc64-glance-strong"]');
      if (!li) continue;
      expect([...li.querySelectorAll("[data-strong]")].map(x => x.getAttribute("data-strong"))).toEqual(report.glance.strong);
      const levels = report.glance.strong.map(id => { const r = report.dims.find(x => x.dim === id)!; return r.decided ? r.level : null });
      if (levels.every(l => l === "clear")) sawClearOnly = true;
      else sawMixed = true;
      expect(li.textContent!.startsWith(`${WC64_GLANCE_STRONG_LABEL}:`)).toBe(true);
      expect(li.textContent).not.toMatch(/크게 기운|또렷하게 기운|한쪽으로 모인/);
      for (const m of mounted.splice(0)) {
        await act(async () => m.root.unmount());
        m.container.remove();
      }
    }
    expect(sawClearOnly && sawMixed).toBe(true);
  });

  it("문구: 실제 칸 이름, '이 글자와 이어지는 결정', 대충 골라도 또렷해요가 나오기도 한다는 한계, 동점 표시를 쓴다(FIX-15)", async () => {
    const all4: Wc64Answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, 4 as Wc64Answer]));
    const { container, report } = await mount(all4, "yes");
    expect(report.patterns).toContain("agree");
    expect(container.querySelector('[data-testid="wc64-pattern-agree"]')?.textContent).toContain(`‘${S[3]}’나 ‘${S[4]}’를 고르셔서`);
    expect(container.textContent).not.toContain("대부분 문장에 그래요를");
    expect(container.textContent).not.toContain("이 글자가 정하는 것");
    for (const d of WC64_BANK.dims) {
      expect(container.querySelector(`[data-testid="wc64-decisions-${d.id}"]`)?.textContent).toBe(`이 글자와 이어지는 결정: ${d.decisions.join(", ")}`);
    }
    // 대충 골라도 또렷해요가 나온다는 말은 결과 카드의 가운데 말 뜻 줄에 합쳤다(재판정). 한계에는 따로 두지 않는다.
    expect(container.querySelector('[data-testid="wc64-limits-careless"]')).toBeNull();
    expect(container.querySelector('[data-testid="wc64-chip-meaning"]')?.textContent).toContain("문장을 대충 읽고 골라도 ‘또렷해요’가 나올 때도 있어요.");
    const readHow = container.querySelector('section[aria-labelledby="wc64-readhow"]')!.textContent ?? "";
    expect(readHow).toContain("딱 반반이면 정해 둔 순서로 한쪽 글자를 붙이고, 그 글자에 점선 밑줄을 그어요.");
    expect(readHow).not.toMatch(/무엇이든 그래요를/);
  });

  it("바로 가기는 주소(#)를 바꾸지 않고 그 제목으로 초점을 옮기며, 비교 자리가 있으면 '둘이 같이 보기'가 맨 앞에 있다(DEC-12·FIX-7·1단계 검토)", async () => {
    const hashBefore = window.location.hash;
    const slot = <section aria-labelledby="wc64-compare-title"><h2 id="wc64-compare-title">둘이 같이 보기</h2></section>;
    const { container } = await mount(answersFor("DWCM"), "yes", { compareSlot: slot });
    const nav = container.querySelector('[data-testid="wc64-jump"]')!;
    const code = container.querySelector("#wc64-code")!;
    const glance = container.querySelector("#wc64-glance")!;
    // 결과 카드 바로 아래, 한눈에 보기 앞
    expect(code.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(glance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 바로 가기는 href 없는 버튼이라 새 탭으로 열 주소가 없다(PRIV-4/CQ-3)
    expect(nav.querySelectorAll("a")).toHaveLength(0);
    const links = [...nav.querySelectorAll<HTMLButtonElement>("button[data-jump]")];
    for (const b of links) expect(b.getAttribute("type")).toBe("button");
    expect(links[0].getAttribute("data-jump")).toBe("wc64-compare-title");
    // 비교 칸 제목·공유 글과 같은 이름
    expect(links[0].textContent).toBe("둘이 같이 보기");
    expect(container.textContent).not.toContain("상대와 나란히 보기");
    expect(links.map(a => a.getAttribute("data-jump"))).toEqual(expect.arrayContaining(["wc64-glance", "wc64-knowledge", "wc64-ch-PACE", "wc64-type", "wc64-scenes", "wc64-limits"]));
    for (const a of links) {
      const id = a.getAttribute("data-jump")!;
      const target = container.querySelector(`[id="${id}"]`) as HTMLElement;
      expect(target, id).not.toBeNull();
      await act(async () => a.click());
      expect(window.location.hash).toBe(hashBefore);
      expect(document.activeElement).toBe(target);
    }
    const { container: alone } = await mount(answersFor("DWCM"), "yes");
    expect(alone.querySelector('[data-testid="wc64-jump-compare"]')).toBeNull();
  });

  it("다시 하기는 주 버튼이 아니다(FIX-3 결과 쪽)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    const restart = [...container.querySelectorAll("button")].find(b => b.textContent === "처음부터 다시 하기")!;
    expect(restart.className).not.toContain("bg-[var(--hb-primary)]");
    expect(restart.className).toContain("bg-white");
  });
});

/* ---------------- 2026-10-16 파운더 결정과 1단계 검토(결과 화면 갈래 2차) ---------------- */

/** 모든 접는 칸을 열고 '달라요'를 눌러 숨은 글까지 화면에 꺼낸다 */
async function openAll(container: HTMLElement) {
  for (const d of container.querySelectorAll("details")) d.open = true;
  for (const b of [...container.querySelectorAll("button")].filter(x => x.textContent === "달라요")) {
    await act(async () => (b as HTMLButtonElement).click());
  }
}

async function unmountAll() {
  for (const m of mounted.splice(0)) {
    await act(async () => m.root.unmount());
    m.container.remove();
  }
}

const ALL3: Wc64Answers = Object.fromEntries(WC64_ITEMS.map(it => [it.id, 3 as Wc64Answer]));
/** 결혼식을 전제한 낱말(DEC-1: 식 없이 한 결과에는 없어야 한다). 결과 화면 전체에 예외 없이 센다. */
const CEREMONY_WORDS = /식장|식대|보증인원|입장|본식|드레스|투어|스드메|청첩|하객|폐백|예식|웨딩홀|주례|화촉|식순|박람회|축의금|신부 대기실|부케/;

describe("wc64 리포트 화면: 파운더 결정(DEC-1·2·3·9·10)과 1단계 검토", () => {
  it("식 없이 하면 결혼식을 전제한 낱말이 화면 어디에도 없고, 같은 답을 식을 올린다고 하면 있다(DEC-1)", async () => {
    const cases: Wc64Answers[] = [
      ...ALL_CODES.map(c => answersFor(c)),
      ...ALL_CODES.map(c => answersFor(c, 2)),
      ALL3,
      ...[31, 32, 33, 34, 35, 36].map(randomAnswers),
    ];
    // 예외 목록 없이 화면 전체(접힌 칸·'달라요' 뒤 글·읽어 주는 이름 포함)를 센다. 아슬·반반 한 줄과 '알아 두면 좋은 것'도 든다.
    let sawBalancedPace = false, sawRecheck = false;
    for (const answers of cases) {
      const { container } = await mount(answers, "none");
      await openAll(container);
      sawBalancedPace ||= container.querySelector('[data-testid="wc64-balanced-PACE"]') !== null;
      sawRecheck ||= container.querySelector("[data-recheck]") !== null;
      expect(screenText(container).match(CEREMONY_WORDS)?.[0] ?? null).toBeNull();
      await unmountAll();
    }
    // 예전에 새던 두 자리가 실제로 화면에 나온 경우를 셌는지(헛돌지 않게)
    expect(sawBalancedPace && sawRecheck).toBe(true);
    const { container: yes } = await mount(answersFor("DWCM"), "yes");
    expect(screenText(yes)).toMatch(CEREMONY_WORDS);
  });

  it("예산 4문장은 식 계획과 상관없이 늘 글자 밖 막대로 따로 보인다(2026-10-17 파운더 결정, DEC-7 뒤집기)", async () => {
    const { container, report } = await mount(answersFor("DLCM"), "none");
    expect(report.budget.decided).toBe(true);
    const budget = container.querySelector('[data-testid="wc64-budget"]')!;
    expect(budget.closest('section[aria-labelledby="wc64-fund"]')).not.toBeNull();
    expect(budget.querySelector("h3")?.textContent).toBe(wc64SectionById("BUDGET")!.title);
    expect(budget.textContent).toContain(WC64_BANK.budget_bar.why_outside);
    const bar = budget.querySelector('[role="img"]')!;
    const b = report.budget;
    expect(b.decided && bar.getAttribute("aria-label")).toBe(b.decided ? `${WC64_BANK.budget_bar.a_name} ${b.pctA}%, ${WC64_BANK.budget_bar.b_name} ${b.pctB}%` : false);
    // 결혼 비용 마련 막대는 그대로 있다
    expect(container.querySelector('[data-testid="wc64-fund-bar"]')).not.toBeNull();
    for (const plan of ["yes", "maybe", null] as const) {
      const { container: c, report: r } = await mount(answersFor("DLCM"), plan);
      const el = c.querySelector('[data-testid="wc64-budget"]');
      expect(el, String(plan)).not.toBeNull();
      expect(el!.closest('section[aria-labelledby="wc64-fund"]')).not.toBeNull();
      expect(el!.textContent).toContain(WC64_BANK.budget_bar.why_outside);
      expect(r.budget.decided).toBe(true);
      // 결과 카드가 예산 막대를 가리키는 말도 늘 있다
      expect(c.querySelector('[data-testid="wc64-code-meta"]')?.textContent).toContain("예산을 지키는 정도는 아래 ‘네 글자 밖에서 본 것’에 따로 적었어요.");
    }
  });

  it("예산 막대의 좌우는 비교 화면과 같다: 왼쪽 끝이 BUDGET 의 A 쪽이고, BUDGET 은 어느 글자에도 붙지 않는다(UX-7)", async () => {
    // Compare64 의 leftPole 은 글자에 붙지 않은 묶음을 pole_a 왼쪽으로 둔다. 리포트도 같은 쪽을 왼쪽에 둔다.
    expect(WC64_BANK.dims.flatMap(d => d.facets.map(f => f.axis))).not.toContain("BUDGET");
    const sec = wc64SectionById("BUDGET")!;
    expect(WC64_BANK.budget_bar.a_name).toBe(sec.pole_a.name);
    expect(WC64_BANK.budget_bar.b_name).toBe(sec.pole_b.name);
    // A 쪽 문장에 5, B 쪽에 1이면 점이 왼쪽 끝(pctX 100)에 간다
    const answers = answersFor("DWCM");
    for (const it of sec.items) answers[it.id] = it.pole === "A" ? 5 : 1;
    for (const plan of ["yes", "none"] as const) {
      const { container } = await mount(answers, plan);
      const budget = container.querySelector('[data-testid="wc64-budget-bar"]')!;
      const ends = budget.querySelector(".justify-between")!.children;
      expect(ends[0].textContent).toBe(sec.pole_a.name);
      expect(ends[1].textContent).toBe(sec.pole_b.name);
      expect(budget.querySelector('[role="img"]')!.getAttribute("data-pct-x")).toBe("100");
    }
  });

  it("식 없이 하면 유형 카드 없이 '다음에 해 볼 것'을 정한 글자에서 2~3개 보인다(DEC-1)", async () => {
    for (const code of ALL_CODES) {
      const { container, report } = await mount(answersFor(code), "none");
      expect(report.type).toBeNull();
      expect(container.querySelector('[id="wc64-type"]')).toBeNull();
      const steps = [...container.querySelectorAll('[data-testid="wc64-next-steps"] li')].map(li => li.textContent);
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps.length).toBeLessThanOrEqual(3);
      expect(steps).toEqual(wc64NextSteps(report, 3).map(s => s.text));
      await unmountAll();
    }
  });

  it("가운데 가까운 글자가 많으면 유형 이름은 두고 한 줄 설명과 '다음에 해 볼 것'은 접고 안내를 먼저 보인다(DEC-2·FIX-11)", async () => {
    const { container, report } = await mount(ALL3, "yes");
    const notice = wc64ReferenceNotice(report);
    expect(notice).toBe("네 글자 모두 가운데 가까이 나와 참고로만 보세요.");
    const shown = container.querySelector('[data-testid="wc64-reference-only"]')!;
    expect(shown.textContent).toBe(notice);
    expect(count(container.textContent ?? "", notice!)).toBe(1);
    // 이름과 유형 제목은 결과 카드와 유형 카드에 그대로 있다
    const title = `${report.type!.title}, ${report.type!.sub}`;
    expect(container.querySelector('[data-testid="wc64-type-title"]')?.textContent).toBe(title);
    expect(container.querySelector('[id="wc64-code"] [data-wc64-name]')?.textContent).toBe(nameLabelOf(report.code));
    expect(container.querySelector('[id="wc64-type"]')?.textContent).toBe(nameLabelOf(report.code));
    expect(container.querySelector('[data-testid="wc64-type-subtitle"]')?.textContent).toBe(title);
    // 안내가 한 줄 설명과 막대보다 앞에 온다. 한 줄 설명은 유형 카드에만 있다(COPY-3).
    expect(container.querySelector('[data-testid="wc64-glance-one-liner"]')).toBeNull();
    const typeLine = container.querySelector('[data-testid="wc64-type-one-liner"]')!;
    expect(shown.compareDocumentPosition(typeLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shown.compareDocumentPosition(container.querySelector("[data-axis]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 한 줄 설명(유형 카드)과 다음에 해 볼 것은 닫힌 접는 칸 안에 있다
    for (const el of [typeLine, container.querySelector('[data-testid="wc64-next-steps"]')!]) {
      const fold = el.closest("details");
      expect(fold).not.toBeNull();
      expect(fold!.open).toBe(false);
    }
    // 같은 칸 반복 알림은 네 글자 바로 아래(결과 카드 안)에 있다
    expect(report.patterns).toContain("same");
    expect(container.querySelector('[data-testid="wc64-pattern-same"]')!.closest('section[aria-labelledby="wc64-code"]')).not.toBeNull();
    // 재판정: 다시 하기 줄과 겹치던 '다시 해 보시면 더 또렷해질 수 있어요'를 빼고, 같은 칸을 고르면 %가 어떻게 되는지만 적는다
    expect(container.querySelector('[data-testid="wc64-pattern-same"]')!.textContent).toBe("같은 칸을 많이 고르셔서 %가 50 가까이 모였을 수 있어요.");
    expect(container.textContent).not.toContain("다시 해 보시면");
  });

  it("답 모양 알림만 있어도 참고로만 보이고, 또렷한 답이면 안내 없이 펼쳐 둔다(DEC-2)", async () => {
    // 글자 쪽 문장에 5, 반대쪽에 4: 글자는 또렷하거나 기울었는데 동의 쪽으로 몰린 답 모양(agree)만 있다
    const agreeOnly: Wc64Answers = Object.fromEntries(Object.entries(answersFor("DWCM", 4)).map(([id, v]) => [id, v === 1 ? 4 : v]));
    const { container: c4, report: r4 } = await mount(agreeOnly, "yes");
    expect(r4.patterns).toContain("agree");
    expect(r4.dims.filter(r => r.decided && (r.level === "slight" || r.level === "half")).length).toBeLessThan(2);
    // 안내가 알림 문장을 그대로 담고, 아래 알림 줄은 같은 말을 되풀이하지 않는다(2026-10-17 점검)
    expect(c4.querySelector('[data-testid="wc64-reference-only"]')?.textContent)
      .toBe(`대부분 문장에 ‘${S[3]}’나 ‘${S[4]}’를 고르셔서 %가 50 가까이 모일 수 있어요. 참고로만 보세요.`);
    expect(c4.querySelector('[data-testid="wc64-pattern-agree"]')).toBeNull();
    expect(c4.querySelector('[data-testid="wc64-type-one-liner"]')!.closest("details")).not.toBeNull();
    for (const code of ["DWCM", "OLUR"]) {
      const { container, report } = await mount(answersFor(code), "yes");
      expect(wc64ReferenceNotice(report)).toBeNull();
      expect(container.querySelector('[data-testid="wc64-reference-only"]')).toBeNull();
      expect(container.querySelector('[data-testid="wc64-type-one-liner"]')!.closest("details")).toBeNull();
      expect(container.querySelector('[data-testid="wc64-next-steps"]')!.closest("details")).toBeNull();
    }
  });

  it("가운데 가까운 글자는 한눈에 보기에서 한 줄로 모아 같은 꼬리를 되풀이하지 않는다(1단계 검토)", async () => {
    const { container } = await mount(ALL3, "yes");
    const glance = container.querySelector('section[aria-labelledby="wc64-glance"]')!;
    expect(count(glance.textContent ?? "", "두 쪽 설명을 같이 읽어 보세요")).toBe(1);
    expect(glance.querySelectorAll("[data-shaky]")).toHaveLength(4);
  });

  it("공개 결과는 할 일 제목을 '웨딩한방에서 이어 해 볼 것'으로 쓰고 아모라 소개와 로그인 링크를 한 번만 두며, 라운지는 그대로다(DEC-3)", async () => {
    for (const plan of ["yes", "none"] as const) {
      const { container, report } = await mount(answersFor("DWCM"), plan);
      const decided = report.dims.filter(r => r.decided);
      const titles = [...container.querySelectorAll('[data-testid^="wc64-actions-title-"]')].map(h => h.textContent);
      expect(titles).toEqual(decided.map(() => "웨딩한방에서 이어 해 볼 것"));
      expect(container.textContent).not.toContain("앱에서 바로 해 볼 것");
      const intro = container.querySelectorAll('[data-testid="wc64-app-intro"]');
      expect(intro).toHaveLength(1);
      expect(intro[0].textContent).toContain("결혼 준비 동반자");
      expect(intro[0].closest(`section[data-dim="${decided[0].dim}"]`)).not.toBeNull();
      expect(container.querySelectorAll(`a[href="${WC64_LOGIN_HREF}"]`)).toHaveLength(1);
      expect(container.querySelector(`a[href="${WC64_LOGIN_HREF}"]`)!.closest('[data-testid="wc64-app-intro"]')).not.toBeNull();
    }
    const { container: lounge, report } = await mount(answersFor("DWCM"), "yes", { embedded: true });
    const titles = [...lounge.querySelectorAll('[data-testid^="wc64-actions-title-"]')].map(h => h.textContent);
    expect(titles).toEqual(report.dims.map(() => "앱에서 바로 해 볼 것"));
    expect(lounge.querySelector('[data-testid="wc64-app-intro"]')).toBeNull();
    expect(lounge.querySelector(`a[href="${WC64_LOGIN_HREF}"]`)).toBeNull();
    expect(lounge.textContent).not.toContain("웨딩한방에서 이어 해 볼 것");
  });

  it("한계에 다루지 않는 주제를 한 줄로 쓴다(DEC-9)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    const line = container.querySelector('[data-testid="wc64-limits-topics"]')!;
    expect(line.closest('section[aria-labelledby="wc64-limits"]')).not.toBeNull();
    expect(line.textContent).toBe(WC64_LIMITS_TOPICS);
    for (const topic of ["예단·예물 규모", "신혼집 비용 분담", "명절", "종교", "아이 계획"]) expect(line.textContent).toContain(topic);
    // 유형 카드가 예단 이야기를 꺼내는 법을 말하기도 하므로 '결과에 들어 있지 않다'고 하지 않고, 생각을 묻지 않았다고 쓴다(2단계 검토)
    expect(line.textContent).toContain("어떻게 생각하는지는 묻지 않았어요");
    expect(line.textContent).not.toContain("들어 있지 않아요");
  });

  it("16유형 제목은 제목과 부제를 한 줄로 묶어 16개가 모두 다르고, 유형 카드 머리 이름도 16개가 모두 다르다(DEC-10·2026-10-17 결과 이름)", async () => {
    const titles = new Set<string>();
    const names = new Set<string>();
    for (const code of ALL_CODES) {
      const { container } = await mount(answersFor(code), "yes");
      const h2 = container.querySelector('[id="wc64-type"]')!;
      expect(h2.querySelectorAll("*")).toHaveLength(0);
      names.add(h2.textContent ?? "");
      const subtitle = container.querySelector('[data-testid="wc64-type-subtitle"]')!;
      titles.add(subtitle.textContent ?? "");
      expect(container.querySelector('[data-testid="wc64-type-title"]')?.textContent).toBe(subtitle.textContent);
      await unmountAll();
    }
    expect(titles.size).toBe(16);
    expect(names.size).toBe(16);
  });

  it("'다른 사람과 비교한 점수가 아니다'는 한 번만 쓴다(1단계 검토)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    await openAll(container);
    expect(count(container.textContent ?? "", "다른 사람과 비교한")).toBe(1);
  });

  it("글자를 정하지 못한 까닭은 결과 카드와 글자 장이 같은 문장으로 쓴다(넘긴 묶음, 1단계 검토)", async () => {
    // 식을 올리는 사람이 결혼식 형식·하객 묶음을 모두 '해당 없음'으로 고르면 CIRCLE 은 '넘긴 묶음' 까닭이다
    const answers = answersFor("DWCM");
    for (const sid of ["FORM", "GUESTS"]) for (const it of wc64SectionById(sid)!.items) answers[it.id] = 0;
    const { container, report } = await mount(answers, "yes");
    const r = report.dims.find(x => x.dim === "CIRCLE")!;
    expect(r.decided === false && r.reason).toBe("skipped");
    const row = container.querySelector('[data-axis="CIRCLE"]')!;
    expect(row.getAttribute("data-reason")).toBe("skipped");
    expect(row.textContent).toContain(WC64_UNDECIDED_TEXT.skipped);
    expect(container.querySelector('[data-testid="wc64-undecided-CIRCLE"]')?.textContent).toBe(WC64_UNDECIDED_TEXT.skipped);
    expect(container.textContent).not.toContain("답한 문장이 적어서예요");
  });

  it("가족 묶음을 넘기면 유형 카드와 다음에 해 볼 것에서도 가족 줄이 빠진다(1단계 검토)", async () => {
    let checked = 0;
    for (const code of ALL_CODES) {
      const card = WC64_BANK.types[code];
      const tags = card.line_sections ?? {};
      const familyLines = [
        ...card.meets.filter((_, i) => tags.meets?.[i] === "FAMILY"),
        ...card.tips.filter((_, i) => tags.tips?.[i] === "FAMILY"),
        ...(tags.first === "FAMILY" ? [card.first] : []),
        ...(tags.later === "FAMILY" ? [card.later] : []),
      ];
      if (familyLines.length === 0) continue;
      const answers = answersFor(code);
      for (const it of wc64SectionById("FAMILY")!.items) answers[it.id] = 0;
      const { container: kept } = await mount(answersFor(code), "yes");
      await openAll(kept);
      for (const line of familyLines) expect(kept.textContent).toContain(line);
      const { container } = await mount(answers, "yes", { skipped: { FAMILY: true } });
      await openAll(container);
      for (const line of familyLines) expect(container.textContent, `${code}: ${line}`).not.toContain(line);
      checked++;
      await unmountAll();
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("칸 이름·글자 이름을 감싸는 따옴표는 ‘’ 하나로 쓴다(1단계 검토)", async () => {
    const { container } = await mount(ALL3, "yes");
    await openAll(container);
    const readHow = container.querySelector('section[aria-labelledby="wc64-readhow"]')!.textContent ?? "";
    const limits = container.querySelector('section[aria-labelledby="wc64-limits"]')!.textContent ?? "";
    for (const text of [readHow, limits]) expect(text).not.toContain("'");
    for (const d of WC64_BANK.dims) {
      expect(container.querySelector(`[data-testid="wc64-firm-${d.id}"]`)!.textContent).not.toContain("'");
      expect(container.querySelector(`[data-testid="wc64-no-quotes-${d.id}"]`)!.textContent).not.toContain("'");
    }
  });
});

/* ---------------- 2026-10-16 2단계 검토(결과 화면 갈래 3차) ---------------- */

/** 글자 장 하나만 그린다(은행을 바꾸지 않고 표식만 바꾼 축으로 빈 목록을 만들 때 쓴다) */
async function mountChapter(dim: Wc64Dim, answers: Wc64Answers, plan: Wc64Plan, embedded = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const report = buildWc64Report(answers, plan);
  const result = report.dims.find(r => r.dim === dim.id)!;
  await act(async () => {
    root.render(<LetterChapter64 dim={dim} result={result} index={1} plan={plan} hiddenSections={report.hiddenTags} embedded={embedded} appIntro />);
  });
  return { container, result };
}

describe("wc64 리포트 화면: 2단계 검토", () => {
  it("표식으로 줄이 모두 빠진 목록은 제목도 그리지 않고, 줄이 남으면 제목과 함께 그린다", async () => {
    const pace = WC64_BANK.dims.find(d => d.id === "PACE")!;
    const answers = answersFor("OWCM");
    // 은행 그대로: 식 없이 해도 O 의 세 목록에 줄이 남아 제목이 있다
    const { container: kept } = await mountChapter(pace, answers, "none");
    const keptHeads = [...kept.querySelectorAll("h3")].map(h => h.textContent);
    expect(keptHeads).toEqual(expect.arrayContaining(["O 쪽이 편하게 여기는 것", "챙겨 볼 것", "웨딩한방에서 이어 해 볼 것"]));
    // 세 목록의 줄을 모두 '예식'으로 표시한 축: 식 없이 하면 세 목록이 비고, 제목도 빈 목록도 없다
    const allTagged = (n: number) => Array.from({ length: n }, () => "예식");
    const O = pace.letters.O;
    const emptied: Wc64Dim = {
      ...pace,
      letters: {
        ...pace.letters,
        O: { ...O, line_sections: { comfy: allTagged(O.comfy.length), watch: allTagged(O.watch.length), app_actions: allTagged(O.app_actions.length) } },
      },
    };
    const { container, result } = await mountChapter(emptied, answers, "none");
    expect(result.decided && result.letter).toBe("O");
    const heads = [...container.querySelectorAll("h3")].map(h => h.textContent);
    for (const title of ["O 쪽이 편하게 여기는 것", "챙겨 볼 것", "웨딩한방에서 이어 해 볼 것", "앱에서 바로 해 볼 것"]) expect(heads).not.toContain(title);
    expect(container.querySelector('[data-testid^="wc64-actions-title-"]')).toBeNull();
    for (const ul of container.querySelectorAll("ul")) expect(ul.children.length, ul.outerHTML.slice(0, 80)).toBeGreaterThan(0);
    // 아모라 소개와 로그인 링크는 목록과 따로 남는다(DEC-3)
    expect(container.querySelector('[data-testid="wc64-app-intro"]')).not.toBeNull();
    // 한 목록만 비어도 그 목록의 제목만 빠지고 다른 목록 제목은 남는다
    for (const [key, gone, stays] of [["watch", "챙겨 볼 것", "O 쪽이 편하게 여기는 것"], ["comfy", "O 쪽이 편하게 여기는 것", "챙겨 볼 것"]] as const) {
      const one: Wc64Dim = {
        ...pace,
        letters: { ...pace.letters, O: { ...O, line_sections: { [key]: allTagged(O[key].length) } } },
      };
      const { container: c1 } = await mountChapter(one, answers, "none");
      const h = [...c1.querySelectorAll("h3")].map(x => x.textContent);
      expect(h, key).not.toContain(gone);
      expect(h, key).toContain(stays);
      for (const ul of c1.querySelectorAll("ul")) expect(ul.children.length).toBeGreaterThan(0);
    }
    // 같은 축을 식을 올린다고 하면 표식 줄이 그대로라 제목이 있다
    const { container: yes } = await mountChapter(emptied, answers, "yes");
    expect([...yes.querySelectorAll("h3")].map(h => h.textContent)).toEqual(expect.arrayContaining(["O 쪽이 편하게 여기는 것", "챙겨 볼 것", "웨딩한방에서 이어 해 볼 것"]));
  });

  it("같은 칸 반복(same)은 가운데 칸이 몰려도 걸리므로 '한쪽으로 몰려'가 아니라 '같은 칸을 많이 골라'로 안내한다", async () => {
    const base = buildWc64Report(answersFor("DWCM"), "yes");
    expect(wc64ReferenceNotice({ ...base, patterns: [] })).toBeNull();
    // 높임은 아래 알림 줄과 같은 '고르셔서'다(2026-10-17 점검: '골라'와 '고르셨어요'로 갈렸다)
    // 재판정: 옛 뒷문장 '다시 해 보시면 더 또렷해질 수 있어요'는 다시 하기 줄과 겹쳤고 '또렷해요'가 나온다는 약속처럼 읽혀 뺐다
    expect(wc64ReferenceNotice({ ...base, patterns: ["same"] })).toBe("같은 칸을 많이 고르셔서 참고로만 보세요.");
    expect(wc64ReferenceNotice({ ...base, patterns: ["same", "agree"] })).toBe("같은 칸을 많이 고르셔서 참고로만 보세요.");
    expect(wc64ReferenceNotice({ ...base, patterns: ["agree"] }))
      .toBe(`대부분 문장에 ‘${S[3]}’나 ‘${S[4]}’를 고르셔서 %가 50 가까이 모일 수 있어요. 참고로만 보세요.`);
  });

  it("참고로만 안내가 담은 답 모양 알림은 결과 카드에 한 번만 나온다(2026-10-17 점검)", async () => {
    // 같은 칸 반복만 있는 답(글자는 또렷한데 같은 칸을 많이 고른 모양): 모든 성향 문장에 5, 글자 반대쪽만 1 이 아니라 같은 칸 위주
    for (const [patterns, testId] of [[["same"], "wc64-pattern-same"], [["agree"], "wc64-pattern-agree"], [["same", "agree"], "wc64-pattern-same"]] as const) {
      const base = buildWc64Report(answersFor("DWCM"), "yes");
      const report = { ...base, patterns: [...patterns] };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      mounted.push({ root, container });
      await act(async () => {
        root.render(<Report64 report={report} answers={answersFor("DWCM")} plan="yes" onRestart={() => {}} onClearAnswers={() => {}} />);
      });
      const notice = container.querySelector('[data-testid="wc64-reference-only"]')!.textContent!;
      expect(notice, patterns.join(",")).toBe(wc64ReferenceNotice(report));
      // 안내가 담은 알림의 줄은 없다
      expect(container.querySelector(`[data-testid="${testId}"]`), patterns.join(",")).toBeNull();
      // 같은 칸 반복과 동의 쪽 몰림이 함께면 동의 쪽 몰림은 알림 줄로 따로 말한다
      expect(container.querySelector('[data-testid="wc64-pattern-agree"]') !== null, patterns.join(",")).toBe(patterns.length === 2);
      expect(count(container.textContent ?? "", "같은 칸을 많이"), patterns.join(",")).toBe((patterns as readonly string[]).includes("same") ? 1 : 0);
      await unmountAll();
    }
  });

  it("다시 계산한 폭이 한 점이면(모두 '반반이에요') '50~50%'로 쓰지 않고 띠도 그리지 않는다", async () => {
    const { container, report } = await mount(ALL3, "yes");
    for (const r of report.dims) {
      if (!r.decided) continue;
      const b0 = Math.round(r.band[0]);
      expect(b0).toBe(Math.round(r.band[1]));
      const sec = container.querySelector(`section[data-dim="${r.dim}"]`)!;
      const band = sec.querySelector(`[data-testid="wc64-band-${r.dim}"]`)!.textContent ?? "";
      expect(band).not.toMatch(/(\d+)~\1%/);
      // 글자 쪽 %로 쓴다(모두 '반반이에요'면 50이라 쪽이 달라도 같은 수)
      const L = r.letterSide === "X" ? b0 : 100 - b0;
      expect(band).toBe(`문장을 반씩 나눠 여러 번 다시 계산해 봐도 대부분 ${r.letter}쪽 ${L}%라서 옅은 띠는 없어요.`);
      expect(band).not.toContain("오간 폭");
      expect(sec.querySelector('[data-band="true"]')).toBeNull();
      const bar = [...sec.querySelectorAll('[role="img"]')].find(x => (x.getAttribute("aria-label") ?? "").includes("다시 계산"))!;
      expect(bar.getAttribute("aria-label")).toContain(`다시 계산해도 대부분 ${r.letter}쪽 ${L}%`);
      expect(bar.getAttribute("aria-label")).not.toMatch(/(\d+)~\1%/);
    }
  });

  it("내 답 전체는 결과와 같은 자리를 적는다: 예산 문장은 식 계획과 상관없이 예산 막대 쪽 이름이고, 비워 둔 글자 쪽으로 적지 않는다", async () => {
    const budgetIds = wc64SectionById("BUDGET")!.items.map(it => it.id);
    const sideName = (pole: string) => (pole === "A" ? WC64_BANK.budget_bar.a_name : WC64_BANK.budget_bar.b_name);
    const { container } = await mount(answersFor("DWCM"), "none");
    for (const it of wc64SectionById("BUDGET")!.items) {
      const row = container.querySelector(`[data-answer-item="${it.id}"]`)!;
      expect(row.querySelector("span")!.textContent, it.id).toBe(sideName(it.pole));
    }
    const spend = WC64_BANK.dims.find(d => d.id === "SPEND")!, circle = WC64_BANK.dims.find(d => d.id === "CIRCLE")!;
    const emptyLetters = [spend.letter_a, spend.letter_b, circle.letter_a, circle.letter_b];
    for (const row of container.querySelectorAll("[data-answer-item]")) {
      const where = row.querySelector("span")!.textContent ?? "";
      for (const L of emptyLetters) expect(where, row.getAttribute("data-answer-item") ?? "").not.toBe(`${L} 쪽`);
    }
    // 식을 올려도 예산 문장은 SPEND 글자 쪽이 아니라 예산 막대 쪽 이름이다(2026-10-17 파운더 결정, DEC-7 뒤집기)
    const { container: yes } = await mount(answersFor("DWCM"), "yes");
    for (const id of budgetIds) {
      const it = wc64SectionById("BUDGET")!.items.find(x => x.id === id)!;
      const where = yes.querySelector(`[data-answer-item="${id}"] span`)!.textContent;
      expect(where, id).toBe(sideName(it.pole));
      expect(where).not.toMatch(new RegExp(`^[${spend.letter_a}${spend.letter_b}] 쪽$`));
    }
  });

  it("유형 카드가 없으면 '다음에 해 볼 것'의 질문 앞에 둘이 서로 묻는 질문이라는 한 줄을 두고, 유형 카드가 있으면 두지 않는다", async () => {
    const { container, report } = await mount(answersFor("DWCM"), "none");
    expect(report.type).toBeNull();
    const lead = container.querySelector('[data-testid="wc64-next-questions-lead"]')!;
    expect(lead.textContent).toBe("둘이 서로 물어볼 질문이에요.");
    expect(lead.compareDocumentPosition(container.querySelector('[data-testid="wc64-next-steps"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const { container: yes } = await mount(answersFor("DWCM"), "yes");
    expect(yes.querySelector('[data-testid="wc64-next-questions-lead"]')).toBeNull();
  });
});

/* ---------------- 2026-10-17 상품 심사(결과 화면 갈래) ---------------- */

/** 앱이 문서보다 먼저 심는 웹뷰 다리와 nonce(hooks/useInsideMobileApp) */
function markInsideApp() {
  (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: () => undefined };
  (window as unknown as Record<string, unknown>)[MOBILE_WEB_API_NONCE_PROPERTY] = "5b0c9d8e-7f6a-4b5c-9d8e-7f6a5b4c3d2e";
}
function clearInsideApp() {
  delete (window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  delete (window as unknown as Record<string, unknown>)[MOBILE_WEB_API_NONCE_PROPERTY];
}

describe("wc64 리포트 화면: 2026-10-17 상품 심사", () => {
  afterEach(clearInsideApp);

  it("앱 웹뷰 안에서는 공개 결과라도 로그인 링크와 아모라 소개를 두지 않고, 브라우저에서는 둔다(M2)", async () => {
    const { container: web } = await mount(answersFor("DWCM"), "yes");
    expect(web.querySelector("[data-wc64-login]")).not.toBeNull();
    expect(web.querySelector('[data-testid="wc64-app-intro"]')).not.toBeNull();
    await unmountAll();
    markInsideApp();
    for (const plan of ["yes", "none"] as const) {
      const { container } = await mount(answersFor("DWCM"), plan);
      expect(container.querySelector("[data-wc64-login]"), plan).toBeNull();
      expect(container.querySelector(`a[href="${WC64_LOGIN_HREF}"]`)).toBeNull();
      expect(container.querySelector('[data-testid="wc64-app-intro"]')).toBeNull();
      // 할 일 제목은 공개 결과 그대로다
      expect(container.querySelector('[data-testid^="wc64-actions-title-"]')?.textContent).toBe("웨딩한방에서 이어 해 볼 것");
    }
    await unmountAll();
    // 다리만 있고 앱이 심은 표식이 없으면 브라우저로 본다
    delete (window as unknown as Record<string, unknown>)[MOBILE_WEB_API_NONCE_PROPERTY];
    const { container: other } = await mount(answersFor("DWCM"), "yes");
    expect(other.querySelector("[data-wc64-login]")).not.toBeNull();
  });

  it("아모라 소개는 '함께 정리'라고 쓴다(COPY-11)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    const intro = container.querySelector('[data-testid="wc64-app-intro"]')!.textContent ?? "";
    expect(intro).toContain("예산·일정·할 일을 함께 정리할 수 있어요.");
    expect(intro).not.toContain("이어서 정리");
  });

  it("단단함 문장은 같은 글자 수와 반반 수를 따로 쓰고, 반반을 절반으로 쳐서 더하지 않는다(M6·HON-1·HON-6)", async () => {
    // 모두 '반반이에요'에 PLAN-A1 만 '대체로 그래요': 400가지 중 D 200, 반반 200(예전 화면은 300가지에서 D)
    const answers: Wc64Answers = { ...ALL3, "PLAN-A1": 4 };
    const { container, report } = await mount(answers, "yes");
    const pace = report.dims.find(r => r.dim === "PACE")!;
    expect(pace.decided && pace.letter === "D" && !pace.tie).toBe(true);
    const fr = pace.decided ? pace.firm : null;
    expect([fr?.total, fr?.same, fr?.tie, fr?.agree, fr?.dist]).toEqual([400, 200, 200, 300, 1]);
    const firm = container.querySelector('[data-testid="wc64-firm-PACE"]')!.textContent;
    // 띠 줄이 먼저 '반씩 나눠 여러 번 다시 계산'을 말하므로 '그렇게 계산한 n번'으로 받는다('가지'가 무엇인지 몰랐다, 2026-10-17 점검)
    expect(firm).toBe("그렇게 계산한 400번 중 200번은 D가, 200번은 반반이 나왔어요. 답을 1칸 옮기면 반반이 되거나 반대 글자로 넘어가요.");
    expect(firm).not.toContain("300번");
    expect(firm).not.toContain("가지");
    // 반반이 0이면 뒷부분이 없다
    const { container: c2, report: r2 } = await mount(answersFor("DWCM"), "yes");
    let sawNoTie = false;
    for (const r of r2.dims) {
      if (!r.decided || r.tie) continue;
      const text = c2.querySelector(`[data-testid="wc64-firm-${r.dim}"]`)!.textContent ?? "";
      expect(text.startsWith(`그렇게 계산한 ${r.firm.total}번 중 ${r.firm.same}번은 ${r.letter}`)).toBe(true);
      if (r.firm.tie === 0) {
        sawNoTie = true;
        expect(text).not.toContain("번은 반반이");
      } else {
        expect(text).toContain(`, ${r.firm.tie}번은 반반이 나왔어요.`);
      }
      expect(text).not.toContain("반반이 돼요");
    }
    expect(sawNoTie).toBe(true);
  });

  it("글자 장에는 동의 정도 %와 '양 끝 10%' 말이 없다(M7·COPY-2)", async () => {
    for (const answers of [randomAnswers(3), randomAnswers(4), ALL3, answersFor("OLUR")]) {
      const { container } = await mount(answers, "yes");
      await openAll(container);
      const text = screenText(container);
      expect(text).not.toMatch(/동의한 정도 \d+%/);
      expect(text).not.toContain("양 끝 10%");
      await unmountAll();
    }
  });

  it("칩 뜻 한 줄을 결과 카드 막대 앞에 두고, 정한 글자가 없으면 두지 않는다(M8·COPY-5)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    const chip = container.querySelector('[data-testid="wc64-chip-meaning"]')!;
    expect(chip.textContent).toBe(WC64_CHIP_MEANING);
    expect(chip.closest('section[aria-labelledby="wc64-code"]')).not.toBeNull();
    expect(chip.compareDocumentPosition(container.querySelector("[data-axis]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(count(container.textContent ?? "", WC64_CHIP_MEANING)).toBe(1);
    const { container: empty, report } = await mount({}, null);
    expect(report.dims.some(r => r.decided)).toBe(false);
    expect(empty.querySelector('[data-testid="wc64-chip-meaning"]')).toBeNull();
  });

  it("다시 하면 기울어 있는 글자도 바뀔 수 있다는 줄을 참고로만 안내가 없어도 결과 카드에 늘 두고, 유형 카드에는 되풀이하지 않는다(M9·HON-2, 2026-10-17 점검)", async () => {
    // [답, 식 계획, 유형 카드가 있는지, 이름이 있는지]. 식 없이 두 글자를 정하면 유형 카드는 없어도 이름은 있다(2026-10-17 결과 이름).
    const cases: [Wc64Answers, Wc64Plan | null, boolean, boolean][] = [
      [answersFor("DWCM"), "yes", true, true], [ALL3, "yes", true, true], [answersFor("DWCM"), "none", false, true], [{}, null, false, false],
    ];
    for (const [answers, plan, hasType, hasName] of cases) {
      const { container, report } = await mount(answers, plan);
      expect(report.type !== null).toBe(hasType);
      expect(report.name !== null).toBe(hasName);
      const line = container.querySelector('[data-testid="wc64-retake"]')!;
      expect(line.closest('section[aria-labelledby="wc64-code"]')).not.toBeNull();
      // 재판정: 이 줄은 가운데 말 뜻 줄과 막대보다 위라 아직 읽지 않은 '아슬한 글자'·'기울어 있는 글자'로 가르지 않는다
      expect(line.textContent!.startsWith("다시 하면 어느 글자든 바뀔 수 있")).toBe(true);
      expect(line.textContent).not.toMatch(/아슬한 글자|기울어 있는 글자/);
      // 이름이 없는 결과에는 이름 말을 하지 않는다. '유형 이름'은 이제 동물 이름과 헷갈려 쓰지 않는다.
      expect(line.textContent!.includes("글자 하나만 바뀌어도 이름이 달라져요")).toBe(hasName);
      expect(line.textContent).not.toContain("유형 이름");
      // 이름이 바뀔 수 있다는 말은 결과 카드 한 곳에만 있다(옛 유형 카드의 '다시 하면 다른 이름이 나올 수 있어요'와 겹쳤다)
      expect(container.querySelector('[data-testid="wc64-type-retake"]')).toBeNull();
      await openAll(container);
      expect(count(screenText(container), "다른 이름이 나올 수")).toBe(0);
      expect(count(screenText(container), "이름이 달라져요")).toBe(hasName ? 1 : 0);
      await unmountAll();
    }
    // 참고로만 안내가 없는 결과에서도 나온다(예전에는 한계의 '아슬한 글자는' 한 줄뿐이었다)
    const { container, report } = await mount(answersFor("DWCM"), "yes");
    expect(wc64ReferenceNotice(report)).toBeNull();
    expect(container.querySelector('[data-testid="wc64-retake"]')).not.toBeNull();
    expect(container.textContent).not.toContain("아슬한 글자는 다시 하면 바뀔 수 있어요.");
  });

  it("대충 골라도 또렷해요가 나온다는 말은 가운데 말 뜻 줄 끝에 한 번만 있다: 참고로만 안내가 있든 없든 결과 카드 안이고 한계에는 없다(HON-3·재판정)", async () => {
    const LINE = "문장을 대충 읽고 골라도 ‘또렷해요’가 나올 때도 있어요.";
    expect(WC64_CHIP_MEANING.endsWith(LINE)).toBe(true);
    for (const [answers, hasNotice] of [[answersFor("DWCM"), false], [ALL3, true]] as const) {
      const { container, report } = await mount(answers, "yes");
      expect(wc64ReferenceNotice(report) !== null).toBe(hasNotice);
      const chip = container.querySelector('[data-testid="wc64-chip-meaning"]')!;
      expect(chip.closest('section[aria-labelledby="wc64-code"]')).not.toBeNull();
      // 옛 따로 줄(다시 하기 줄 끝·한계)은 없다. 이웃한 두 줄이 같은 '또렷해요가 ~기도 해요' 꼬리로 끝나 면책문처럼 읽혔다.
      expect(container.querySelector('[data-testid="wc64-code-careless"]')).toBeNull();
      expect(container.querySelector('[data-testid="wc64-limits-careless"]')).toBeNull();
      expect(container.querySelector('[data-testid="wc64-retake"]')!.textContent).not.toContain("또렷");
      await openAll(container);
      expect(count(screenText(container), "대충 읽고 골라도")).toBe(1);
      await unmountAll();
    }
  });

  it("가운데 말 뜻 줄은 개발 말 '칩'을 쓰지 않고 네 말을 그대로 부르며, %가 '기울었는지'를 보여 준다고 하지 않는다(재판정)", async () => {
    // 옛 줄은 %가 '기울었는지'를 보여 준다면서 바로 아래 말이 '기울어 있어요'라 앞뒤가 안 맞았다
    expect(WC64_CHIP_MEANING).not.toMatch(/칩|기울었는지|%가 낮은/);
    for (const level of ["또렷해요", "기울어 있어요", "아슬해요", "반반이에요"]) expect(WC64_CHIP_MEANING).toContain(level);
    expect(WC64_CHIP_MEANING).toContain("어느 쪽 문장에 얼마나 더 동의했는지");
    // 이 리포트 읽는 법도 같은 말로 부른다
    const { container } = await mount(answersFor("DWCM"), "yes");
    const readHow = container.querySelector('section[aria-labelledby="wc64-readhow"]')!.textContent ?? "";
    expect(readHow).toContain("글자 단단함(막대 아래 가운데 말)은");
    expect(screenText(container)).not.toContain("칩");
  });

  it("60%처럼 50에 가까운 글자에 '또렷해요'가 붙는 답이 실제로 있다(가운데 말 뜻 줄의 예가 계산과 맞는다)", () => {
    // PACE 12문장: D 쪽 6문장 모두 4, O 쪽 6문장 중 5문장 3·1문장 4. 다시 계산해도 늘 D, 반반까지 5칸.
    const answers: Wc64Answers = {};
    const pace = WC64_BANK.dims.find(d => d.id === "PACE")!;
    let oSeen = 0;
    for (const f of pace.facets) for (const it of wc64SectionById(f.axis)!.items) {
      if (it.pole === f.a_is) answers[it.id] = 4;
      else answers[it.id] = oSeen++ === 0 ? 4 : 3;
    }
    const r = buildWc64Report(answers, "yes").dims.find(x => x.dim === "PACE")!;
    expect(r.decided && [r.letter, r.letterPct, r.level]).toEqual(["D", 60, "clear"]);
  });

  it("네 글자 밖 카드는 '글자에는 넣지 않고 막대로만 따로 봐요'를 머리에 한 번만 두고, 두 막대 까닭 줄은 그 말을 되풀이하지 않는다(재판정)", async () => {
    for (const plan of ["yes", "none"] as const) {
      const { container } = await mount(answersFor("DLCM"), plan);
      const card = container.querySelector('section[aria-labelledby="wc64-fund"]')!;
      const note = card.querySelector('[data-testid="wc64-outside-note"]')!;
      expect(note.textContent).toBe(WC64_OUTSIDE_NOTE);
      // 카드 제목 바로 다음, 두 막대보다 앞이다
      expect(card.querySelector("h2")!.nextElementSibling).toBe(note);
      expect(count(card.textContent ?? "", "글자에는 넣지 않고")).toBe(1);
      expect(count(card.textContent ?? "", "막대로만 따로 봐요")).toBe(1);
      await unmountAll();
    }
  });

  it("유형 한 줄은 화면에 한 번만 나오고, 바로 가기에 유형 카드 칸이 있다(COPY-3)", async () => {
    for (const code of ["DWCM", "OLUR"]) {
      const { container, report } = await mount(answersFor(code), "yes");
      await openAll(container);
      const line = wc64TypeCopy(report.type!, report.hiddenTags).one_liner;
      expect(count(container.textContent ?? "", line)).toBe(1);
      expect(container.querySelector('[data-testid="wc64-jump"] [data-jump="wc64-type"]')?.textContent).toBe("네 글자가 함께 보이는 모습");
      await unmountAll();
    }
    const { container: none } = await mount(answersFor("DWCM"), "none");
    expect(none.querySelector('[data-jump="wc64-type"]')).toBeNull();
  });

  it("안쪽 말('가정이에요'·'실측')과 되풀이한 '2~3주 뒤 다시 해 보세요'가 없다(COPY-13·COPY-17)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    for (const d of container.querySelectorAll("details")) d.open = true;
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/가정이에요|실측/);
    // '달라요'를 누르기 전에는 다시 해 보라는 말이 없다(누르면 그 장에 한 번)
    expect(count(text, "2~3주 뒤 다시 해 보세요")).toBe(0);
    const no = [...container.querySelectorAll('section[data-dim="PACE"] button')].find(b => b.textContent === "달라요") as HTMLButtonElement;
    await act(async () => no.click());
    expect(count(container.textContent ?? "", "2~3주 뒤 다시 해 보세요")).toBe(1);
    expect(container.querySelector('[data-testid="wc64-limits-draft"]')?.textContent).toBe("아직 사람들에게 답을 받아 보지 않아서, 여러 묶음을 한 글자로 묶은 방식이 맞는지 확인하지 못했어요. %는 그날 고른 답으로 계산한 값이에요.");
    // 이 도구를 '검사'라 부르지 않고(금지어 '검증된'과 같은 뿌리), 결과 카드의 다시 하기 줄을 한계에서 되풀이하지 않는다(2026-10-17 점검)
    const limits = container.querySelector('section[aria-labelledby="wc64-limits"]')!.textContent ?? "";
    expect(limits).not.toMatch(/검증|검사/);
    expect(container.querySelector('[data-testid="wc64-limits-retake"]')).toBeNull();
  });

  it("이해도 칸 아래에 '안다고 고르셨어요'의 기준을 한 줄로 쓴다(UX-6)", async () => {
    const { container } = await mount(answersFor("DWCM"), "yes");
    const rule = container.querySelector('[data-testid="wc64-knowledge-pass-rule"]')!;
    expect(rule.closest('section[aria-labelledby="wc64-knowledge"]')).not.toBeNull();
    // 보기 이름과 %를 같은 것처럼 나란히 놓지 않는다. 칸에 보이는 %와 평균 기준을 잇는다(2026-10-17 점검)
    expect(rule.textContent).toBe(`칸의 %가 75 이상(고른 답의 평균이 ‘${S[3]}’ 이상)이면 ‘안다고 고르셨어요’가 붙어요.`);
    // 기준 그대로: 한 칸을 모두 '대체로 그래요'로 고르면 75%이고 통과, '반반이에요'를 하나 섞으면 아직
    const pass = withKnowledge(answersFor("DWCM"), { L1: 4, L2: 4, L3: 4, L4: 4 });
    const { report } = await mount(pass, "yes");
    for (const l of report.knowledge.levels) expect(l.state === "pass" && l.pct === 75, l.L).toBe(true);
    const L1 = wc64SectionById("KNOW")!.items.filter(it => it.level === "L1");
    const below = { ...pass, [L1[0].id]: 3 as Wc64Answer };
    const { report: r2 } = await mount(below, "yes");
    expect(r2.knowledge.levels.find(l => l.L === "L1")!.state).toBe("no");
  });

  it("식 없이 한 결과 코드의 빈칸은 가운뎃점을 읽지 않고 '빈칸'으로 읽힌다(A11Y-3)", async () => {
    const { container } = await mount(answersFor("DWCM"), "none");
    const h1 = container.querySelector("h1#wc64-code, h1[id='wc64-code']")!;
    for (const dim of ["SPEND", "CIRCLE"]) {
      const dot = h1.querySelector(`[data-letter-slot="${dim}"]`)!;
      expect(dot.textContent).toBe("·");
      expect(dot.getAttribute("aria-hidden")).toBe("true");
      const blank = h1.querySelector(`[data-letter-blank="${dim}"]`)!;
      expect(blank.className).toBe("sr-only");
      expect(blank.textContent!.trim()).toBe("빈칸");
    }
    // 정한 글자에는 빈칸 글이 없다
    for (const dim of ["PACE", "BOND"]) expect(h1.querySelector(`[data-letter-blank="${dim}"]`)).toBeNull();
    const { container: yes } = await mount(answersFor("DWCM"), "yes");
    expect(yes.querySelector("[data-letter-blank]")).toBeNull();
  });

  it("접는 칸 머리마다 무엇을 펼치는지 읽어 줄 글이 있다(A11Y-4)", async () => {
    for (const answers of [ALL3, answersFor("DWCM")]) {
      const { container } = await mount(answers, "yes");
      const summaries = [...container.querySelectorAll("summary")];
      expect(summaries.length).toBeGreaterThan(1);
      for (const sm of summaries) {
        // 보이는 글이 '펼치기'·'접기'뿐이면, 화면 읽기 글(sr-only)에 무엇을 펼치는지가 있어야 한다
        const visible = [...sm.children].filter(k => k.className !== "sr-only").map(k => k.textContent).join("") || sm.textContent;
        // 참고로만 유형 카드의 접는 칸은 '펼쳐 보기(참고용)'라 그 이름도 '펼치기·접기만 보이는 칸'으로 센다
        const foldOnly = (visible ?? "").replace(WC64_REFERENCE_FOLD_LABEL, "펼치기");
        if (/^(?:참고로 )?펼치기접기$/.test(foldOnly)) {
          const sr = sm.querySelector(".sr-only");
          expect(sr, sm.outerHTML.slice(0, 120)).not.toBeNull();
          expect((sr!.textContent ?? "").trim().length).toBeGreaterThan(1);
        }
      }
      await unmountAll();
    }
  });
});

/* ---------------- 2026-10-17 파운더 결정: 결과 이름(형용사 + 동물)이 메인(결과 화면 갈래) ---------------- */

/** 결과 카드 제목(공개는 h1, 라운지는 h2). 같은 id 가 앞 시험 화면에도 있을 수 있어 속성 선택자로 찾는다. */
function codeTitle(container: HTMLElement): HTMLElement {
  return container.querySelector('[id="wc64-code"]') as HTMLElement;
}

/** 이 축의 묶음 문장을 모두 '해당 없음'으로 골라 그 글자를 정하지 못하게 한다 */
function withDimSkipped(base: Wc64Answers, dim: Wc64DimId): Wc64Answers {
  const out = { ...base };
  for (const f of WC64_BANK.dims.find(d => d.id === dim)!.facets) for (const it of wc64SectionById(f.axis)!.items) out[it.id] = 0;
  return out;
}

/** 이름이 붙은 결과 카드 제목의 모양: 이름이 첫 자식이고 크게, 네 글자는 그 아래 작은 고정폭 줄, 읽어 주는 글은 이름과 웨딩코드 글자를 함께 */
function expectNamedTitle(title: HTMLElement, label: string, code: string) {
  expect(title.getAttribute("data-wc64-named")).toBe("true");
  const name = title.querySelector("[data-wc64-name]")!;
  expect(name).not.toBeNull();
  expect(title.firstElementChild).toBe(name);
  expect(name.textContent).toBe(label);
  expect(name.className).toContain("text-[34px]");
  expect(name.className).toContain("sm:text-[40px]");
  expect(name.className).not.toContain("font-mono");
  const letters = title.querySelector("[data-wc64-letters]")!;
  expect(name.compareDocumentPosition(letters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(letters.className).toContain("font-mono");
  expect(letters.className).toContain("text-lg");
  expect(letters.className).toContain("text-[var(--hb-text-muted)]");
  expect(title.className).not.toContain("text-[46px]");
  // 글자 자리는 모두 네 글자 줄 안에 있다(동점 밑줄·빈칸 표시도 그 줄에 그대로)
  const slots = [...title.querySelectorAll("[data-letter-slot]")];
  expect(slots).toHaveLength(4);
  for (const s of slots) expect(letters.contains(s)).toBe(true);
  expect(slots.map(s => s.textContent).join("")).toBe(code);
  // 화면 읽기 프로그램에는 제목 하나로 '이름, 웨딩코드 글자'가 읽힌다
  expect(letters.querySelector(".sr-only")?.textContent).toBe(", 웨딩코드 ");
  expect(title.textContent!.startsWith(`${label}, 웨딩코드 `)).toBe(true);
}

describe("wc64 리포트 화면: 2026-10-17 결과 이름", () => {
  it("16가지 순수 답 묶음마다 결과 카드 메인 제목이 그 유형 이름이고, 네 글자는 그 아래 작게 보인다", async () => {
    const seen = new Set<string>();
    for (const code of ALL_CODES) {
      const { container, report } = await mount(answersFor(code), "yes");
      expect(report.code).toBe(code);
      const label = nameLabelOf(code);
      seen.add(label);
      const title = codeTitle(container);
      expect(title.tagName).toBe("H1");
      expectNamedTitle(title, label, code);
      expect(title.textContent).toBe(`${label}, 웨딩코드 ${code}`);
      // 유형 제목 줄은 이름 묶음 바로 뒤에 이름보다 작게 남는다
      const typeTitle = container.querySelector('[data-testid="wc64-type-title"]')!;
      expect(title.nextElementSibling).toBe(typeTitle);
      expect(typeTitle.className).toContain("text-base");
      expect(typeTitle.className).not.toMatch(/text-xl|text-2xl|text-\[\d+px\]/);
      // 다른 유형의 이름은 화면에 없다
      const text = container.textContent ?? "";
      for (const other of ALL_NAME_LABELS) if (other !== label) expect(text, `${code}: ${other}`).not.toContain(other);
      await unmountAll();
    }
    expect(seen.size).toBe(16);
  });

  it("식 없이 두 글자를 정하면 그 넷의 따로 둔 이름이 메인이고, 이름 아래에 가운뎃점 자리를 둔 두 글자가 작게 보인다", async () => {
    const seen = new Set<string>();
    for (const code of ["DWCM", "DWCR", "OWCM", "OWCR"]) {
      const { container, report } = await mount(answersFor(code), "none");
      expect(report.code).toBe(`${code[0]}··${code[3]}`);
      expect(report.type).toBeNull();
      const label = nameLabelOf(report.code);
      seen.add(label);
      const title = codeTitle(container);
      expectNamedTitle(title, label, report.code);
      const letters = title.querySelector("[data-wc64-letters]")!;
      for (const dim of ["SPEND", "CIRCLE"]) {
        expect(letters.querySelector(`[data-letter-slot="${dim}"]`)?.getAttribute("aria-hidden")).toBe("true");
        expect(letters.querySelector(`[data-letter-blank="${dim}"]`)?.className).toBe("sr-only");
      }
      // 유형 카드와 유형 제목 줄은 없다
      expect(container.querySelector('[data-testid="wc64-type-title"]')).toBeNull();
      expect(container.querySelector('[id="wc64-type"]')).toBeNull();
      expect(count(container.textContent ?? "", label)).toBe(1);
      await unmountAll();
    }
    expect(seen.size).toBe(4);
  });

  it("글자를 하나라도 정하지 못하면 이름 없이 네 글자가 메인이다(식을 올릴 때와 식 없이 할 때 모두)", async () => {
    // 식을 올리는데 결혼식 형식·하객 묶음을 모두 '해당 없음'으로 골라 CIRCLE 을 정하지 못한 답, 식 없이 하는데 PACE 를 정하지 못한 답, 빈 답
    const circleSkipped = answersFor("DWCM");
    for (const sid of ["FORM", "GUESTS"]) for (const it of wc64SectionById(sid)!.items) circleSkipped[it.id] = 0;
    const cases: [Wc64Answers, Wc64Plan | null, string][] = [
      [circleSkipped, "yes", "DW·M"],
      [circleSkipped, "maybe", "DW·M"],
      [withDimSkipped(answersFor("DWCM"), "PACE"), "none", "···M"],
      [withDimSkipped(answersFor("OWCR"), "BOND"), "none", "O···"],
      [{}, null, "····"],
    ];
    for (const [answers, plan, code] of cases) {
      const { container, report } = await mount(answers, plan);
      expect([plan, report.code, report.name]).toEqual([plan, code, null]);
      const title = codeTitle(container);
      expect(title.getAttribute("data-wc64-named")).toBe("false");
      expect(title.querySelector("[data-wc64-name]")).toBeNull();
      expect(title.querySelector("[data-wc64-letters]")).toBeNull();
      // 글자가 제목의 큰 글씨다
      expect(title.className).toContain("font-mono");
      expect(title.className).toContain("text-[46px]");
      expect([...title.querySelectorAll("[data-letter-slot]")].map(s => s.textContent).join("")).toBe(code);
      expect(title.textContent!.startsWith("웨딩코드 ")).toBe(true);
      // 이름은 화면 어디에도 없고, 다시 하기 줄도 이름 말을 하지 않는다
      await openAll(container);
      const text = screenText(container);
      for (const label of ALL_NAME_LABELS) expect(text, `${code}: ${label}`).not.toContain(label);
      expect(container.querySelector('[data-testid="wc64-retake"]')!.textContent).not.toContain("이름");
      await unmountAll();
    }
  });

  it("참고로만 결과에도 이름은 메인으로 두고, 참고로만 안내를 이름 묶음 바로 뒤에 붙인다", async () => {
    const agreeOnly: Wc64Answers = Object.fromEntries(Object.entries(answersFor("DWCM", 4)).map(([id, v]) => [id, v === 1 ? 4 : v]));
    // [답, 식 계획]: 네 글자 모두 반반, 답 모양 알림만, 식 없이 두 글자 모두 반반
    const cases: [Wc64Answers, Wc64Plan][] = [[ALL3, "yes"], [agreeOnly, "yes"], [ALL3, "none"]];
    for (const [answers, plan] of cases) {
      const { container, report } = await mount(answers, plan);
      const notice = wc64ReferenceNotice(report);
      expect(notice, `${plan} ${report.code}`).not.toBeNull();
      const label = nameLabelOf(report.code);
      expect(report.name?.label).toBe(label);
      const title = codeTitle(container);
      expectNamedTitle(title, label, report.code);
      const shown = container.querySelector('[data-testid="wc64-reference-only"]')!;
      expect(shown.textContent).toBe(notice);
      // 제목 바로 뒤(유형 제목 줄이 있으면 그 뒤)가 참고로만 안내다. 사이에 다른 글이 없다.
      const typeTitle = container.querySelector('[data-testid="wc64-type-title"]');
      expect(typeTitle !== null).toBe(report.type !== null);
      expect((typeTitle ?? title).nextElementSibling).toBe(shown);
      if (typeTitle) expect(title.nextElementSibling).toBe(typeTitle);
      await unmountAll();
    }
  });

  it("라운지 안(embedded)에서도 같은 규칙이고 제목 레벨만 h2 다", async () => {
    const circleSkipped = answersFor("DWCM");
    for (const sid of ["FORM", "GUESTS"]) for (const it of wc64SectionById(sid)!.items) circleSkipped[it.id] = 0;
    const cases: [Wc64Answers, Wc64Plan, string | null][] = [
      [answersFor("OLUR"), "yes", nameLabelOf("OLUR")],
      [answersFor("OWCM"), "none", nameLabelOf("O··M")],
      [ALL3, "yes", nameLabelOf(buildWc64Report(ALL3, "yes").code)],
      [circleSkipped, "yes", null],
    ];
    for (const [answers, plan, label] of cases) {
      const { container, report } = await mount(answers, plan, { embedded: true });
      expect(container.querySelectorAll("h1")).toHaveLength(0);
      const title = codeTitle(container);
      expect(title.tagName).toBe("H2");
      expect(title.hasAttribute("data-wc64-focus")).toBe(true);
      if (label) {
        expectNamedTitle(title, label, report.code);
      } else {
        expect(report.name).toBeNull();
        expect(title.getAttribute("data-wc64-named")).toBe("false");
        expect(title.querySelector("[data-wc64-name]")).toBeNull();
        expect(title.className).toContain("text-[46px]");
      }
      // 참고로만 안내도 공개 결과와 같은 자리에 붙는다
      const shown = container.querySelector('[data-testid="wc64-reference-only"]');
      expect(shown !== null).toBe(wc64ReferenceNotice(report) !== null);
      await unmountAll();
    }
  });

  it("유형 카드 머리 제목은 이름이고, 그 아래 네 글자와 유형 제목이 작게 온다", async () => {
    for (const code of ALL_CODES) {
      const { container, report } = await mount(answersFor(code), "yes");
      const label = nameLabelOf(code);
      const section = container.querySelector('section[aria-labelledby="wc64-type"]')!;
      const h2 = section.querySelector('[id="wc64-type"]')!;
      expect(h2.tagName).toBe("H2");
      expect(h2.textContent).toBe(label);
      // 결과 카드의 이름과 같은 이름이다
      expect(h2.textContent).toBe(report.name?.label);
      const codeLine = section.querySelector('[data-testid="wc64-type-code"]')!;
      expect(codeLine.textContent).toBe(`웨딩코드 ${code}`);
      expect(codeLine.querySelector(".sr-only")?.textContent).toBe("웨딩코드 ");
      expect(codeLine.className).toContain("font-mono");
      expect(codeLine.className).toContain("text-sm");
      const subtitle = section.querySelector('[data-testid="wc64-type-subtitle"]')!;
      expect(subtitle.textContent).toBe(`${WC64_BANK.types[code].title}, ${WC64_BANK.types[code].sub}`);
      expect(subtitle.className).toContain("text-sm");
      // 순서: 이름 → 네 글자 → 유형 제목. 다시 하면 이름이 바뀔 수 있다는 말은 결과 카드에만 있다(2026-10-17 점검)
      for (const [a, b] of [[h2, codeLine], [codeLine, subtitle]] as const) {
        expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect(section.querySelector('[data-testid="wc64-type-retake"]')).toBeNull();
      await unmountAll();
    }
  });

  it("'유형 이름'이라는 말은 화면에 없다(이제 '이름'은 형용사 + 동물 이름표를 가리킨다)", async () => {
    for (const [answers, plan] of [[answersFor("DWCM"), "yes"], [ALL3, "yes"], [answersFor("DWCM"), "none"], [{}, null]] as const) {
      const { container } = await mount(answers, plan);
      await openAll(container);
      expect(screenText(container)).not.toContain("유형 이름");
      await unmountAll();
    }
  });
});
