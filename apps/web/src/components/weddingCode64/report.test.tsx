import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WC64_BANK, WC64_ITEMS, wc64SectionById } from "@/lib/weddingCode/wc64/bank";
import { buildWc64Report } from "@/lib/weddingCode/wc64/model";
import type { Wc64Answer, Wc64Answers, Wc64Plan, Wc64Rating } from "@/lib/weddingCode/wc64/types";
import Report64, { WC64_RESULT_NOTICE } from "./Report64";

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
  const report = buildWc64Report(answers, plan);
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
      expect(container.querySelector('[data-testid="wc64-type-title"]')?.textContent).toBe(WC64_BANK.types[code].title);
      expect([...container.querySelectorAll("h2")].find(h => h.id === "wc64-type")?.textContent).toBe(WC64_BANK.types[code].title);
      expect(container.querySelectorAll('section[data-dim][data-decided="true"]')).toHaveLength(4);
      for (const tip of WC64_BANK.types[code].tips) expect(container.textContent).toContain(tip);
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

  it("식을 안 올리면 CIRCLE 자리는 '·'이고 그 안내가 나온다", async () => {
    const { container, report } = await mount(answersFor("DWCM"), "none");
    expect(report.code[2]).toBe("·");
    const slot = container.querySelector('h1 [data-letter-slot="CIRCLE"]');
    expect(slot?.textContent).toBe("·");
    expect(container.textContent).toContain("식을 올리지 않기로 해서 이 글자는 정하지 않았어요.");
    expect(container.querySelector('section[data-dim="CIRCLE"]')?.textContent).toContain("식을 올리지 않기로 해서 식 관련 문장이 빠졌어요.");
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
    expect(container.textContent).toContain("가장 또렷하게 기운 글자");
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
      expect(text).not.toContain(WC64_BANK.meta.start_note);
      expect(text).not.toContain("검증된 심리검사는 아니고");
    }
  });

  it("출처 링크는 새 창(target=_blank)과 rel=noreferrer 로 연다", async () => {
    const { container, report } = await mount(answersFor("DWCM", 2), "yes");
    expect(report.knowledge.recheck.length).toBe(3);
    expect(container.textContent).toContain("알아 두면 좋은 것");
    expect(container.textContent).toContain(WC64_BANK.meta.recheck_note);
    expect(container.textContent).toContain(`확인 ${WC64_BANK.meta.checked_on}`);
    const links = [...container.querySelectorAll("a[href]")];
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
    expect(pace.querySelector('[role="status"]')).toBeNull();
    const buttons = [...container.querySelectorAll("button")];
    await act(async () => buttons.find(b => b.textContent === "처음부터 다시 하기")!.click());
    await act(async () => buttons.find(b => b.textContent === "이 브라우저의 답 지우기")!.click());
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
      "wc64-code", "wc64-glance", "이 리포트 읽는 법", "wc64-knowledge",
      "wc64-ch-PACE", "wc64-ch-SPEND", "wc64-ch-CIRCLE", "wc64-ch-BOND",
      "wc64-type", "wc64-scenes", "wc64-fund", "slot-test", "wc64-next", "내 답 전체 보기", "wc64-limits",
    ];
    expect(headings).toEqual(order);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent).toContain("고른 답을 네 글자로 줄였어요. 다른 사람과 비교한 점수가 아니에요.");
    expect(container.textContent).toContain("스스로 설명할 수 있다고 고른 정도예요. 맞히는 시험이 아니에요.");
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
    expect(container.querySelector('[data-answer-item="K2"]')?.textContent).toContain("건너뜀");
    const plan = WC64_BANK.dims[0].facets[0];
    const first = wc64SectionById(plan.axis)!.items[0];
    const side = first.pole === plan.a_is ? "D" : "O";
    expect(container.querySelector(`[data-answer-item="${first.id}"]`)?.textContent).toContain(`${side} 쪽`);
  });
});
