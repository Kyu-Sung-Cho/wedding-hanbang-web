import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WC64_BANK, WC64_DIMS, WC64_ITEMS } from "@/lib/weddingCode/wc64/bank";
import { buildWc64Report } from "@/lib/weddingCode/wc64/model";
import { encodeWc64PairCode } from "@/lib/weddingCode/wc64/pairCode";
import type { Wc64Answer, Wc64Answers } from "@/lib/weddingCode/wc64/types";
import Compare64 from "./Compare64";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BANNED = /MBTI|엠비티아이|검증된|정확|과학적|진단|궁합|당신은|예측|확률|속마음|무의식|상위\s*\d+\s*%|일치율|잘 맞아요|안 맞아요/i;

let container: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode) {
  await act(async () => { root.render(node); await Promise.resolve(); });
}
async function click(el: Element | null | undefined) {
  if (!el) throw new Error("누를 요소가 없어요");
  await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
}
async function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const button = (text: string) => [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const myCodeBox = () => container.querySelector<HTMLTextAreaElement>("#wc64-my-code")!;
const theirBox = () => container.querySelector<HTMLTextAreaElement>("#wc64-their-code")!;

/** 성향 문장을 한쪽(A) 끝으로: A 문장 5, B 문장 1. 이해도는 4. */
function leaning(toward: "A" | "B"): Wc64Answers {
  const out: Wc64Answers = {};
  for (const it of WC64_ITEMS) {
    if (it.pole === "L") { out[it.id] = 4; continue; }
    out[it.id] = (it.pole === toward ? 5 : 1) as Wc64Answer;
  }
  return out;
}

/** 화면 글 전부: 보이는 글, 읽어 주는 이름, 안내 글 */
function screenText(): string {
  const attrs = [...container.querySelectorAll("[aria-label],[placeholder]")]
    .map(el => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("placeholder") ?? ""}`);
  return `${container.textContent ?? ""} ${attrs.join(" ")}`;
}

let fetchSpy: ReturnType<typeof vi.fn>;
let beaconSpy: ReturnType<typeof vi.fn>;
let setItemSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/wedding-code");
  fetchSpy = vi.fn(() => Promise.reject(new Error("fetch 를 부르면 안 돼요")));
  vi.stubGlobal("fetch", fetchSpy);
  beaconSpy = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconSpy });
  setItemSpy = vi.spyOn(Storage.prototype, "setItem");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  delete (navigator as unknown as Record<string, unknown>).sendBeacon;
  window.localStorage.clear();
});

describe("둘이 같이 보기(Compare64)", () => {
  const mine = leaning("A");
  const theirs = leaning("B");
  const theirCode = encodeWc64PairCode(theirs, "yes");

  it("제목·설명·경고를 보여 주고 내 코드를 읽기 전용 칸에 둔다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    const text = container.textContent ?? "";
    expect(text).toContain("둘이 같이 보기");
    expect(text).toContain("내 답 코드를 상대에게 보내고, 상대 코드를 아래에 붙여 넣으면 둘의 결과를 나란히 볼 수 있어요. 코드는 서버로 가지 않아요. 코드를 받은 사람은 내 답 전체를 볼 수 있어요.");
    expect(text).not.toContain("보낸 사람에게만");
    expect(text).toContain("코드에는 내 답이 담겨요. 보낼 사람에게만 보내 주세요.");
    expect(myCodeBox().readOnly).toBe(true);
    expect(myCodeBox().value).toBe(encodeWc64PairCode(mine, "yes"));
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).toBeNull();
  });

  it("상대 코드를 넣으면 네 축마다 두 사람의 글자와 %가 한 막대에 보인다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), theirCode);
    await click(button("나란히 보기"));
    const myReport = buildWc64Report(mine, "yes");
    const theirReport = buildWc64Report(theirs, "yes");
    for (const d of WC64_DIMS) {
      const m = myReport.dims.find(r => r.dim === d.id)!;
      const t = theirReport.dims.find(r => r.dim === d.id)!;
      expect(m.decided && t.decided).toBe(true);
      if (!m.decided || !t.decided) continue;
      const row = container.querySelector(`[data-testid="wc64-compare-dim-${d.id}"]`)!;
      expect(row.querySelector(`[data-testid="wc64-compare-dim-${d.id}-me"]`)!.textContent).toContain(`나 ${m.letter} ${m.letterPct}%`);
      expect(row.querySelector(`[data-testid="wc64-compare-dim-${d.id}-them"]`)!.textContent).toContain(`상대 ${t.letter} ${t.letterPct}%`);
      // 점 위치: 왼쪽 끝이 앞 글자(X)라 X % 가 클수록 왼쪽
      expect(row.querySelector<HTMLElement>('[data-dot="me"]')!.style.left).toBe(`${100 - m.pctX}%`);
      expect(row.querySelector<HTMLElement>('[data-dot="them"]')!.style.left).toBe(`${100 - t.pctX}%`);
      // 갈린 축에는 그 축의 대화 질문 두 개
      expect(m.letter).not.toBe(t.letter);
      const qs = row.querySelector(`[data-testid="wc64-compare-questions-${d.id}"]`)!;
      for (const q of d.couple_questions) expect(qs.textContent).toContain(q);
    }
    // 묶음 13개, 비용 마련 질문
    expect(container.querySelectorAll('[data-testid^="wc64-compare-section-"]')).toHaveLength(13);
    expect(container.querySelector('[data-testid="wc64-compare-section-FUND"]')!.textContent).toContain(WC64_BANK.fund.couple_question);
    const text = container.textContent ?? "";
    expect(text.split("같은 쪽을 골랐다고 합의한 건 아니에요.").length - 1).toBe(1);
  });

  it("글자가 같은 축에는 갈렸다는 질문을 내지 않는다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), encodeWc64PairCode(mine, "yes"));
    await click(button("나란히 보기"));
    expect(container.querySelectorAll('[data-testid^="wc64-compare-questions-"]')).toHaveLength(0);
    expect(container.textContent).toContain("내 코드와 같아요.");
  });

  it("묶음은 둘의 차이가 큰 순서로 놓는다", async () => {
    // 상대는 PLAN 묶음만 반대로, 나머지는 나와 같게
    const partial: Wc64Answers = { ...mine };
    for (const it of WC64_BANK.sections.find(s => s.id === "PLAN")!.items) partial[it.id] = (it.pole === "A" ? 1 : 5) as Wc64Answer;
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), encodeWc64PairCode(partial, "yes"));
    await click(button("나란히 보기"));
    const first = container.querySelector('[data-testid^="wc64-compare-section-"]')!;
    expect(first.getAttribute("data-testid")).toBe("wc64-compare-section-PLAN");
  });

  it("묶음 막대의 왼쪽 끝과 %는 리포트 글자 장의 묶음 막대와 같은 쪽을 가리킨다(a_is B 묶음 포함)", async () => {
    // 나는 모든 묶음에서 pole A 쪽, 상대는 pole B 쪽
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), theirCode);
    await click(button("나란히 보기"));
    const myReport = buildWc64Report(mine, "yes");
    const theirReport = buildWc64Report(theirs, "yes");
    let flipped = 0;
    for (const d of WC64_DIMS) {
      for (const f of d.facets) {
        const row = container.querySelector(`[data-testid="wc64-compare-section-${f.axis}"]`)!;
        const sec = WC64_BANK.sections.find(s => s.id === f.axis)!;
        const leftName = f.a_is === "A" ? sec.pole_a.name : sec.pole_b.name;
        const rightName = f.a_is === "A" ? sec.pole_b.name : sec.pole_a.name;
        const ends = row.querySelectorAll("h4 + div > span");
        expect(ends[0].textContent).toBe(leftName);
        expect(ends[1].textContent).toBe(rightName);
        const mf = myReport.dims.find(r => r.dim === d.id)!;
        const tf = theirReport.dims.find(r => r.dim === d.id)!;
        if (!mf.decided || !tf.decided) throw new Error("글자가 정해져야 해요");
        const m = mf.facets.find(x => x.section === f.axis)!;
        const t = tf.facets.find(x => x.section === f.axis)!;
        if (!m.decided || !t.decided) throw new Error("묶음 %가 있어야 해요");
        expect(row.textContent).toContain(`나 ${m.pctX}% 대 ${m.pctY}%`);
        expect(row.textContent).toContain(`상대 ${t.pctX}% 대 ${t.pctY}%`);
        expect(row.querySelector<HTMLElement>('[data-dot="me"]')!.style.left).toBe(`${100 - m.pctX}%`);
        expect(row.querySelector<HTMLElement>('[data-dot="them"]')!.style.left).toBe(`${100 - t.pctX}%`);
        if (f.a_is === "B") {
          flipped++;
          // 나는 pole A 쪽이므로 글자 앞쪽(왼쪽)이 아니라 오른쪽에 점이 있다
          expect(m.pctX).toBeLessThan(50);
        }
      }
    }
    expect(flipped).toBeGreaterThan(0);
  });

  it("2칸 이상 다르게 고른 문장을 둘이 고른 칸 이름과 함께 나란히 놓는다", async () => {
    const one: Wc64Answers = {}, two: Wc64Answers = {};
    const [a, b, c] = WC64_ITEMS.filter(it => it.pole !== "L");
    one[a.id] = 5; two[a.id] = 2; // 3칸
    one[b.id] = 4; two[b.id] = 3; // 1칸: 빠진다
    one[c.id] = 1; two[c.id] = 3; // 2칸
    await render(<Compare64 myAnswers={one} myPlan="yes" />);
    await type(theirBox(), encodeWc64PairCode(two, "yes"));
    await click(button("나란히 보기"));
    const list = container.querySelector('[data-testid="wc64-compare-apart"]')!;
    const rows = [...list.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    const scale = WC64_BANK.meta.scale;
    expect(rows[0].textContent).toContain(a.text);
    expect(rows[0].textContent).toContain(`나${scale[4]}`);
    expect(rows[0].textContent).toContain(`상대${scale[1]}`);
    expect(rows[1].textContent).toContain(c.text);
    expect(rows[1].textContent).toContain(`나${scale[0]}`);
    expect(rows[1].textContent).toContain(`상대${scale[2]}`);
    expect(list.textContent).not.toContain(b.text);
  });

  it("틀린 코드는 거절하고 이유를 보여 준다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    const flat = theirCode.replace(/-/g, "");
    await type(theirBox(), flat.slice(0, 50));
    await click(button("나란히 보기"));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("코드가 잘렸어요");
    const typo = flat.slice(0, 20) + (flat[20] === "5" ? "4" : "5") + flat.slice(21);
    await type(theirBox(), typo);
    await click(button("나란히 보기"));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("틀린 글자가 있어요");
    await type(theirBox(), `WC64Z${flat.slice(5)}`);
    await click(button("나란히 보기"));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("다른 판 코드예요");
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).toBeNull();
  });

  it("복사: 클립보드가 되면 '복사했어요', 안 되면 칸을 골라 주고 길게 눌러 복사하라고 한다", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await click(button("내 코드 복사하기"));
    expect(writeText).toHaveBeenCalledWith(encodeWc64PairCode(mine, "yes"));
    expect(container.textContent).toContain("복사했어요.");

    writeText.mockImplementationOnce(() => Promise.reject(new Error("막힘")));
    await click(button("내 코드 복사하기"));
    expect(container.textContent).toContain("길게 눌러 복사해 주세요");
    expect(document.activeElement).toBe(myCodeBox());
    expect(myCodeBox().selectionEnd - myCodeBox().selectionStart).toBe(myCodeBox().value.length);
  });

  it("화면 글에 금지어가 없다(상대 결과까지 펼친 뒤)", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="none" />);
    expect(screenText()).not.toMatch(BANNED);
    await type(theirBox(), theirCode);
    await click(button("나란히 보기"));
    for (const d of container.querySelectorAll("details")) (d as HTMLDetailsElement).open = true;
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).not.toBeNull();
    expect(screenText()).not.toMatch(BANNED);
    // 식을 안 올리면 원본 문구로 글자를 정하지 않았다고 말한다
    expect(container.textContent).toContain("식을 올리지 않기로 해서 이 글자는 정하지 않았어요.");
  });

  it("fetch·sendBeacon 0회, 저장소에 쓰지 않고 주소도 바꾸지 않는다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), theirCode);
    await click(button("나란히 보기"));
    await click(button("내 코드 복사하기"));
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    // 상대 코드를 지우면 상대 결과도 사라진다
    await click(button("상대 코드 지우기"));
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).toBeNull();
    expect(theirBox().value).toBe("");
  });
});
