import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WC64_BANK, WC64_DIMS, WC64_ITEMS } from "@/lib/weddingCode/wc64/bank";
import { buildWc64Report } from "@/lib/weddingCode/wc64/model";
import { decodeWc64PairCode, encodeWc64PairCode, wc64PairShareMessage } from "@/lib/weddingCode/wc64/pairCode";
import {
  WC64_NO_CEREMONY_DIM_TEXT, WC64_NO_CEREMONY_FACET_ONE_SIDE_TEXT, WC64_NO_CEREMONY_FACET_TEXT, WC64_NO_CEREMONY_LEAD,
} from "@/lib/weddingCode/wc64/copy";
import type { Wc64Answer, Wc64Answers } from "@/lib/weddingCode/wc64/types";
import Compare64, { WC64_COMPARE_REFERENCE_TEXT } from "./Compare64";
import { wc64ReferenceNotice } from "./Report64";
import { WC64_UNDECIDED_TEXT, summaryClass } from "./reportStyles";

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
    expect(text).toContain("내 답 코드를 상대에게 보내고, 상대 코드를 아래에 붙여 넣으면 둘의 결과를 나란히 볼 수 있어요. 코드는 서버로 가지 않아요.");
    expect(text).not.toContain("보낸 사람에게만");
    // 같은 사실(코드 = 답 전부)을 세 줄 사이에 두 번 쓰지 않는다(1단계 검토 F11): 아래 고지 하나만 남긴다
    expect(text).not.toContain("코드를 받은 사람은 내 답 전체를 볼 수 있어요");
    // 코드가 결과 요약이 아니라 답 전부이고, 받은 사람이 그 답을 전부 보며, 보낸 뒤 되돌릴 수 없다는 고지(처리방침 64문항 문단과 같은 말).
    // 옛 문장 '결과 네 글자가 아니라 64문항에 고른 답…전부예요'는 꼬여 읽혔고 받은 사람이 본다는 말이 빠졌었다(2026-10-17 점검).
    expect(text).toContain("이 코드에는 네 글자 결과만이 아니라 64문항에서 고른 답 하나하나와 식 계획 답이 모두 담겨요. 받은 사람은 그 답을 전부 볼 수 있고, 보낸 코드는 되돌릴 수 없어요. 함께 볼 사람에게만 보내 주세요.");
    expect(text).not.toContain("전부예요");
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
    // 둘 다 식을 올리면 비용 마련 막대는 '네 글자 밖'
    expect(container.querySelector('[data-testid="wc64-compare-section-FUND"] h4')!.textContent).toContain("네 글자 밖");
    const text = container.textContent ?? "";
    expect(text.split("같은 쪽을 골랐다고 합의한 건 아니에요.").length - 1).toBe(1);
    // %는 고른 답의 비율이 아니다(model.ts axis: 앞 글자 쪽 평균과 뒷 글자 쪽 평균의 차이). 각자 자기 답으로 따로 낸 값이라고만 쓴다.
    expect(text).toContain("%는 두 사람이 각자 자기 답으로 따로 계산한 값이에요.");
    expect(text).not.toMatch(/답의 비율|비율이에요/);
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

  it("복사: 안내 글·시작 주소·코드를 함께 넣고, 클립보드가 막히면 execCommand 로 한 번 더, 둘 다 안 되면 칸을 골라 둔다", async () => {
    const writeText = vi.fn((_: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await click(button("내 코드 복사하기"));
    const myCode = encodeWc64PairCode(mine, "yes");
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain(myCode);
    expect(copied).toMatch(/^https?:\/\/[^\s]+\/wedding-code /m);
    expect(copied).toContain("‘둘이 같이 보기’");
    expect(copied).not.toMatch(/[「」]/);
    // 복사한 글을 통째로 붙여도 내 답이 그대로 읽힌다
    expect(decodeWc64PairCode(copied)).toMatchObject({ ok: true, plan: "yes" });
    // 주소에는 답이 실리지 않는다(시작 화면 주소 뒤에 ? 나 # 이 없다)
    expect(copied).not.toMatch(/wedding-code[?#]/);
    expect(container.textContent).toContain("복사했어요. 안내 글과 주소도 함께 담았어요.");

    // 클립보드 API 가 막히면 execCommand("copy") 로 같은 글을 넣는다
    const execCommand = vi.fn((cmd: string) => cmd === "copy");
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    writeText.mockImplementationOnce(() => Promise.reject(new Error("막힘")));
    await click(button("내 코드 복사하기"));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(container.textContent).toContain("복사했어요.");
    expect(document.querySelectorAll("body > textarea")).toHaveLength(0);

    // 둘 다 안 되면 코드만이 아니라 보낼 글 전체(안내 글·주소·코드)를 담은 칸을 보여 주고 골라 둔다
    expect(container.querySelector("#wc64-share-text")).toBeNull();
    execCommand.mockImplementationOnce(() => false);
    writeText.mockImplementationOnce(() => Promise.reject(new Error("막힘")));
    await click(button("내 코드 복사하기"));
    expect(container.textContent).toContain("자동 복사가 되지 않아 보낼 글 전체를 아래 칸에 골라 두었어요. 복사해서 보내 주세요.");
    expect(container.textContent).not.toContain("길게 눌러");
    const shareBox = container.querySelector<HTMLTextAreaElement>("#wc64-share-text")!;
    expect(shareBox.readOnly).toBe(true);
    expect(shareBox.value).toBe(copied);
    expect(shareBox.value).toContain(myCode);
    expect(shareBox.value).toMatch(/^https?:\/\/[^\s]+\/wedding-code /m);
    expect(shareBox.value).toContain("‘둘이 같이 보기’");
    expect(document.activeElement).toBe(shareBox);
    expect(shareBox.selectionEnd - shareBox.selectionStart).toBe(shareBox.value.length);
    expect(document.querySelectorAll("body > textarea")).toHaveLength(0);
    delete (document as unknown as Record<string, unknown>).execCommand;
  });

  it("받은 안내 글을 통째로 붙여도 나란히 보고, 내 안내 글이면 내 코드와 같다고 알린다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), wc64PairShareMessage(theirCode, "https://hanbang.ai/wedding-code"));
    await click(button("나란히 보기"));
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).not.toBeNull();
    expect(container.textContent).not.toContain("내 코드와 같아요.");
    await type(theirBox(), `내 거야 ${wc64PairShareMessage(encodeWc64PairCode(mine, "yes"), "https://hanbang.ai/wedding-code")}`);
    await click(button("나란히 보기"));
    expect(container.textContent).toContain("내 코드와 같아요.");
  });

  it("옛 링크를 붙이면 64문항 코드를 보내 달라고 안내한다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), "https://hanbang.ai/wedding-code#v=3.1&a=12345");
    await click(button("나란히 보기"));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("예전 웨딩코드 링크예요");
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).toBeNull();
  });

  it("식 계획 N 코드와 견주면 빈 묶음에 '답이 적어'를 쓰지 않고, 계획이 다르다는 한 줄과 질문 하나를 결과 제목 바로 아래에 둔다", async () => {
    // 상대는 식을 안 올린다(N). 답은 모두 채웠으므로 빈 칸의 까닭은 '답이 적어'가 아니다.
    const noneCode = encodeWc64PairCode(theirs, "none");
    expect(noneCode.replace(/-/g, "")[5]).toBe("N");
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), noneCode);
    await click(button("나란히 보기"));
    const rows = [...container.querySelectorAll('[data-testid^="wc64-compare-section-"]')];
    expect(rows.length).toBe(13);
    for (const row of rows) expect(row.textContent, row.getAttribute("data-testid")!).not.toContain("답이 적어");
    const ceremonyOnly = rows.filter(r => r.textContent!.includes(`상대: ${WC64_NO_CEREMONY_FACET_TEXT}`));
    // 문장이 모두 '예식'인 묶음은 '묻지 않았어요'. 2단계에서 EYES 네 문장도 모두 '예식'이 되어 EYES 도 여기에 든다.
    expect(ceremonyOnly.map(r => r.getAttribute("data-testid")).sort()).toEqual(
      ["DAY", "EYES", "FORM", "GUESTS", "WEIGHT"].map(id => `wc64-compare-section-${id}`),
    );
    // 지금 은행에는 한쪽 문장만 남는 묶음이 없다(EYES 가 그 자리였다)
    expect(container.textContent).not.toContain(WC64_NO_CEREMONY_FACET_ONE_SIDE_TEXT);
    // 한 사람만 식 없이 하면 그 묶음 줄은 남긴다: 내 점은 있고 상대 점은 없다
    for (const row of ceremonyOnly) {
      expect(row.querySelector('[data-dot="me"]'), row.getAttribute("data-testid")!).not.toBeNull();
      expect(row.querySelector('[data-dot="them"]'), row.getAttribute("data-testid")!).toBeNull();
    }
    // 묻지 않은 EYES 문장은 문장 목록(2칸 차이·같은 칸)에도 오지 않는다
    const eyesTexts = WC64_BANK.sections.find(s => s.id === "EYES")!.items.map(it => it.text);
    const lists = [...container.querySelectorAll('[data-testid="wc64-compare-apart"],[data-testid="wc64-compare-same"]')]
      .map(el => el.textContent ?? "").join(" ");
    expect(lists.length).toBeGreaterThan(0);
    for (const t of eyesTexts) expect(lists).not.toContain(t);
    // 읽어 주는 이름에도 같은 까닭
    expect(ceremonyOnly[0].querySelector('[role="img"]')!.getAttribute("aria-label")).toContain(WC64_NO_CEREMONY_FACET_TEXT);
    const diff = container.querySelector('[data-testid="wc64-compare-plan-diff"]')!;
    expect(diff).not.toBeNull();
    expect(diff.textContent).toContain("식 계획부터 다르게 답했어요.");
    // 비교 줄에서는 보기 이름의 괄호 설명을 뗀다(2026-10-17 점검: 괄호째 실어 한 줄이 너무 길었다)
    expect(diff.textContent).toContain("식 계획부터 다르게 답했어요. 나: 올릴 거예요 · 상대: 식 없이 하려고 해요");
    expect(diff.textContent).not.toMatch(/작은 식·가족끼리|혼인신고·사진만/);
    expect(diff.textContent).toContain("상대는 식 없이 하기로 해서 ‘결혼식을 맞추는 기준’과 ‘돈과 마음을 싣는 곳’ 글자가 비어 있어요.");
    // 머리말 뒤에 지시가 아니라 질문이 온다(1단계 검토)
    expect(diff.textContent).toContain("서로 물어봐요: 식을 올리고 싶어? 올린다면 누구까지 부르고 어떤 모습이면 좋겠어?");
    expect(diff.textContent!.match(/물어봐요/g)).toHaveLength(1);
    expect(diff.textContent).not.toMatch(/\d+\s*%|점수/);
    // 결과 제목 바로 아래, 결과 영역의 맨 앞에 놓인다(제목은 '나란히 보기' 뒤 초점이 가는 곳)
    const first = container.querySelector('[data-testid="wc64-compare-result"]')!.firstElementChild!;
    expect(first.firstElementChild!.id).toBe("wc64-compare-letters");
    expect(first.firstElementChild!.nextElementSibling).toBe(diff);
  });

  it("식 계획이 같으면 계획 줄을 두지 않고, 묶음을 넘긴 상대에게는 '넘겼거나 모두 해당 없음'이라 쓴다", async () => {
    const sectionItems = (id: string) => WC64_BANK.sections.find(s => s.id === id)!.items;
    const skippedFamily: Wc64Answers = { ...theirs };
    for (const it of sectionItems("FAMILY")) skippedFamily[it.id] = 0;
    // LIFE 도 비워 BOND 글자가 정해지지 않게 한다: 그 까닭은 '답이 모자라'가 아니라 넘긴 묶음이다
    for (const it of sectionItems("LIFE")) delete skippedFamily[it.id];
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), encodeWc64PairCode(skippedFamily, "yes"));
    await click(button("나란히 보기"));
    expect(container.querySelector('[data-testid="wc64-compare-plan-diff"]')).toBeNull();
    const family = container.querySelector('[data-testid="wc64-compare-section-FAMILY"]')!;
    expect(family.textContent).toContain("상대: 이 묶음은 넘겼거나 모두 해당 없음으로 골랐어요");
    expect(family.textContent).not.toContain("답이 적어");
    expect(container.querySelector('[data-testid="wc64-compare-section-LIFE"]')!.textContent).toContain("상대: 답이 적어 %를 내지 않았어요");
    // 결과 카드와 같은 문장(따로 적은 표가 없다)
    expect(container.querySelector('[data-testid="wc64-compare-dim-BOND-them"]')!.textContent)
      .toBe(`상대: ${WC64_UNDECIDED_TEXT.skipped}`);
    expect(WC64_UNDECIDED_TEXT.skipped).toBe("넘기거나 모두 해당 없음으로 고른 묶음이 있어 이 글자는 정하지 않았어요.");
  });

  it("식 없이 하는 상대는 두 글자만 나란히 놓고, 비운 두 글자에는 까닭을 쓰고 대화 질문을 띄우지 않는다(DEC-1)", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), encodeWc64PairCode(theirs, "none"));
    await click(button("나란히 보기"));
    const theirReport = buildWc64Report(theirs, "none");
    expect(theirReport.code).toMatch(/^[DO]··[MR]$/);
    // 코드 줄: 비운 두 자리가 무엇인지 함께 적는다. 식을 올리는 나에게는 붙이지 않는다.
    // 남은 두 글자를 모두 정했으니 식 없이 한 결과의 이름이 앞에 오고, 글자와 까닭이 괄호에 든다(2026-10-17 결과 이름 결정).
    const codes = container.querySelector('[data-testid="wc64-compare-codes"]')!.textContent!;
    expect(theirReport.name).not.toBeNull();
    expect(codes).toContain(`상대 ${theirReport.name!.label}(${theirReport.code}, 식 없이 하기로 해서 두 자리는 비워 뒀어요)`);
    expect(codes.split("비워 뒀어요").length - 1).toBe(1);
    expect(container.querySelector("#wc64-compare-letters")!.textContent).toBe("글자 나란히");
    for (const id of ["CIRCLE", "SPEND"]) {
      expect(container.querySelector(`[data-testid="wc64-compare-dim-${id}-them"]`)!.textContent)
        .toBe(`상대: ${WC64_NO_CEREMONY_DIM_TEXT}`);
      expect(WC64_NO_CEREMONY_DIM_TEXT).toBe("식 없이 하기로 해서 이 글자는 비워 뒀어요.");
      expect(container.querySelector(`[data-testid="wc64-compare-questions-${id}"]`), id).toBeNull();
      expect(container.querySelector(`[data-testid="wc64-compare-dim-${id}"] [data-dot="them"]`), id).toBeNull();
      expect(container.querySelector(`[data-testid="wc64-compare-dim-${id}"] [data-dot="me"]`), id).not.toBeNull();
      // 읽어 주는 이름에 마침표가 두 번 붙지 않는다
      expect(container.querySelector(`[data-testid="wc64-compare-dim-${id}"] [role="img"]`)!.getAttribute("aria-label")).not.toContain("..");
    }
    // 정해진 두 글자(PACE·BOND)는 그대로 나란히, 글자가 갈렸으니 질문도 낸다
    for (const id of ["PACE", "BOND"]) {
      const t = theirReport.dims.find(r => r.dim === id)!;
      if (!t.decided) throw new Error("PACE·BOND 는 정해져야 해요");
      expect(container.querySelector(`[data-testid="wc64-compare-dim-${id}-them"]`)!.textContent).toContain(`상대 ${t.letter} ${t.letterPct}%`);
      expect(container.querySelector(`[data-testid="wc64-compare-questions-${id}"]`), id).not.toBeNull();
    }
    // BUDGET: 식 계획과 상관없이 글자 밖 막대다. 식 없이 한 상대 결과는 두 글자라 '네 글자 밖'이라 하지 않는다
    // (결과 화면 wc64OutsideTitle 과 같은 기준). 예전처럼 SPEND 글자에 넣는다는 말은 없다.
    const budget = container.querySelector('[data-testid="wc64-compare-section-BUDGET"]')!;
    expect(budget.querySelector("h4")!.textContent).toBe(`${WC64_BANK.sections.find(s => s.id === "BUDGET")!.title}글자 밖`);
    expect(container.querySelector('[data-testid="wc64-compare-section-FUND"] h4')!.textContent).not.toContain("네 글자");
    expect(budget.textContent).not.toContain("돈과 마음을 싣는 곳");
    expect(budget.querySelector('[data-testid="wc64-compare-outside-question-BUDGET"]')!.textContent)
      .toBe(`이렇게 물어봐요: ${WC64_BANK.budget_bar.couple_question}`);
    // 상대 BUDGET 막대 값은 상대 리포트의 예산 막대(report.budget)와 같다(방향도 결과 화면과 같다)
    const b = theirReport.budget;
    if (!b.decided) throw new Error("예산 막대가 정해져야 해요");
    expect(budget.textContent).toContain(`상대 ${b.pctA}% 대 ${b.pctB}%`);
  });

  it("둘 다 식 없이 하면 계획 줄 없이 두 글자씩 놓고, 예산 막대는 두 사람 리포트처럼 '정한 선을 지키는 쪽'을 왼쪽에 둔다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="none" />);
    await type(theirBox(), encodeWc64PairCode(theirs, "none"));
    await click(button("나란히 보기"));
    expect(container.querySelector('[data-testid="wc64-compare-plan-diff"]')).toBeNull();
    for (const id of ["CIRCLE", "SPEND"]) {
      expect(container.querySelector(`[data-testid="wc64-compare-dim-${id}-me"]`)!.textContent).toBe("나: 식 없이 하기로 해서 이 글자는 비워 뒀어요.");
      expect(container.querySelector(`[data-testid="wc64-compare-dim-${id}-them"]`)!.textContent).toBe("상대: 식 없이 하기로 해서 이 글자는 비워 뒀어요.");
    }
    const budget = container.querySelector('[data-testid="wc64-compare-section-BUDGET"]')!;
    expect(budget.querySelector("h4")!.textContent).toContain("글자 밖");
    expect(budget.querySelector("h4")!.textContent).not.toContain("네 글자");
    expect(budget.querySelector("h4")!.textContent).not.toContain("결과에서는");
    expect(container.querySelector('[data-testid="wc64-compare-section-FUND"] h4')!.textContent).toContain("글자 밖");
    expect(container.querySelector('[data-testid="wc64-compare-section-FUND"] h4')!.textContent).not.toContain("네 글자");
    // 내 코드 고지도 두 글자로 부른다
    // 식 없이 하면 답 코드에는 묻는 37문항의 답만 실리므로 '64문항'이라 하지 않는다(2026-10-17 심사 UX-2). 단위는 '문항' 하나로 쓴다.
    expect(container.querySelector('[data-testid="wc64-compare-my-code-note"]')!.textContent)
      .toBe("이 코드에는 두 글자 결과만이 아니라 37문항에서 고른 답 하나하나와 식 계획 답이 모두 담겨요. 받은 사람은 그 답을 전부 볼 수 있고, 보낸 코드는 되돌릴 수 없어요. 함께 볼 사람에게만 보내 주세요.");
    expect(container.textContent).not.toContain("결과 네 글자");
    expect(container.textContent).not.toContain("64문항");
    const ends = budget.querySelectorAll("h4 + div > span");
    expect(ends[0].textContent).toBe(WC64_BANK.budget_bar.a_name);
    expect(ends[1].textContent).toBe(WC64_BANK.budget_bar.b_name);
    const mb = buildWc64Report(mine, "none").budget, tb = buildWc64Report(theirs, "none").budget;
    if (!mb.decided || !tb.decided) throw new Error("예산 막대가 정해져야 해요");
    expect(budget.textContent).toContain(`나 ${mb.pctA}% 대 ${mb.pctB}%`);
    expect(budget.textContent).toContain(`상대 ${tb.pctA}% 대 ${tb.pctB}%`);
    expect(budget.querySelector('[data-testid="wc64-compare-outside-question-BUDGET"]')!.textContent)
      .toBe(`이렇게 물어봐요: ${WC64_BANK.budget_bar.couple_question}`);
    // 둘 다 묻지 않은 결혼식 묶음(FORM·GUESTS·DAY·EYES·WEIGHT)은 빈 막대 줄을 만들지 않고 한 줄로 적는다
    const rows = [...container.querySelectorAll('[data-testid^="wc64-compare-section-"]')]
      .map(r => r.getAttribute("data-testid")!).filter(id => id !== "wc64-compare-sections-not-asked");
    for (const id of ["FORM", "GUESTS", "DAY", "EYES", "WEIGHT"]) expect(rows, id).not.toContain(`wc64-compare-section-${id}`);
    expect(rows).toHaveLength(8);
    expect(rows).toContain("wc64-compare-section-BUDGET");
    expect(rows).toContain("wc64-compare-section-FUND");
    expect(container.querySelector('[data-testid="wc64-compare-sections-not-asked"]')!.textContent)
      .toBe("둘 다 식 없이 하기로 해서 결혼식만 묻는 묶음 5개는 뺐어요.");
    expect(container.textContent).not.toContain(WC64_NO_CEREMONY_FACET_TEXT);
    // 남은 줄은 모두 두 사람 점이 있다
    for (const id of rows) {
      const row = container.querySelector(`[data-testid="${id}"]`)!;
      expect(row.querySelector('[data-dot="me"]'), id).not.toBeNull();
      expect(row.querySelector('[data-dot="them"]'), id).not.toBeNull();
    }
  });

  it("식 없이 하는 상대가 있으면 그 선택을 늘 '식 없이 하기로 해서'로 부르고, 결과 화면과 다른 말을 섞지 않는다", async () => {
    for (const myPlan of ["yes", "none"] as const) {
      await render(<Compare64 key={myPlan} myAnswers={mine} myPlan={myPlan} />);
      await type(theirBox(), encodeWc64PairCode(theirs, "none"));
      await click(button("나란히 보기"));
      const text = screenText();
      expect(text, myPlan).toContain(WC64_NO_CEREMONY_LEAD);
      expect(text, myPlan).not.toMatch(/식을 안 올|식을 올리지 않|식 없이 해서|식을 안 하/);
      // '식 없이'가 나오는 곳은 모두 공용 머리말(식 없이 하기로 해서)이거나 식 계획 선택지 이름이다.
      // 비교 줄은 선택지 이름의 괄호 설명을 떼어 쓴다(2026-10-17 점검)
      const planLabel = WC64_BANK.meta.plan_question.options.find(o => o.value === "none")!.label.replace(/\([^()]*\)$/, "");
      expect(planLabel).toBe("식 없이 하려고 해요");
      const rest = text.split(planLabel).join("").split(WC64_NO_CEREMONY_LEAD).join("");
      expect(rest, myPlan).not.toContain("식 없이");
    }
  });

  describe("코드 줄의 결과 이름(2026-10-17 파운더 결정: 형용사 + 동물 이름이 메인)", () => {
    const line = (who: "me" | "them") => container.querySelector(`[data-testid="wc64-compare-code-${who}"]`)!.textContent;
    /** 은행에서 직접 찾은 이름(모델의 reportName 을 거치지 않는다) */
    const bankLabel = (code: string, plan: "yes" | "none") => {
      const n = plan === "none" ? WC64_BANK.no_ceremony_names[code] : WC64_BANK.types[code]?.name;
      if (!n) throw new Error(`은행에 ${code} 이름이 없어요`);
      return `${n.adjective} ${n.animal}`;
    };
    const sectionsOf = (dim: string) => WC64_DIMS.find(d => d.id === dim)!.facets.map(f => f.axis);
    const without = (answers: Wc64Answers, sids: string[]): Wc64Answers => {
      const out: Wc64Answers = { ...answers };
      for (const sid of sids) for (const it of WC64_BANK.sections.find(s => s.id === sid)!.items) delete out[it.id];
      return out;
    };

    it("네 글자를 모두 정했으면 이름을 앞에 두고 네 글자를 괄호에 넣는다", async () => {
      await render(<Compare64 myAnswers={mine} myPlan="yes" />);
      await type(theirBox(), theirCode);
      await click(button("나란히 보기"));
      const myCode = buildWc64Report(mine, "yes").code, otherCode = buildWc64Report(theirs, "yes").code;
      expect(myCode).toMatch(/^[DO][WL][CU][MR]$/);
      expect(line("me")).toBe(`나 ${bankLabel(myCode, "yes")}(${myCode})`);
      expect(line("them")).toBe(`상대 ${bankLabel(otherCode, "yes")}(${otherCode})`);
      // 두 줄은 한 문단 안에서 줄을 바꿔 놓는다
      expect(container.querySelector('[data-testid="wc64-compare-codes"]')!.querySelectorAll("br")).toHaveLength(1);
    });

    it("글자가 하나라도 정해지지 않으면 이름 없이 지금처럼 글자만 적는다", async () => {
      // 상대: LIFE·FAMILY 를 비워 BOND 글자가 정해지지 않는다
      const noBond = without(theirs, sectionsOf("BOND"));
      const report = buildWc64Report(noBond, "yes");
      expect(report.code).toMatch(/·/);
      expect(report.name).toBeNull();
      await render(<Compare64 myAnswers={mine} myPlan="yes" />);
      await type(theirBox(), encodeWc64PairCode(noBond, "yes"));
      await click(button("나란히 보기"));
      expect(line("them")).toBe(`상대 ${report.code}`);
    });

    it("식 없이 하면 남은 두 글자를 모두 정했을 때만 식 없이 한 결과의 이름을 붙이고, 두 자리 까닭은 그대로 적는다", async () => {
      // 이름이 붙는 경우: 이름(글자, 까닭)
      await render(<Compare64 key="named" myAnswers={mine} myPlan="none" />);
      await type(theirBox(), encodeWc64PairCode(theirs, "none"));
      await click(button("나란히 보기"));
      const myCode = buildWc64Report(mine, "none").code, otherCode = buildWc64Report(theirs, "none").code;
      expect(myCode).toMatch(/^[DO]··[MR]$/);
      expect(line("me")).toBe(`나 ${bankLabel(myCode, "none")}(${myCode}, 식 없이 하기로 해서 두 자리는 비워 뒀어요)`);
      expect(line("them")).toBe(`상대 ${bankLabel(otherCode, "none")}(${otherCode}, 식 없이 하기로 해서 두 자리는 비워 뒀어요)`);
      // 이름이 붙지 않는 경우: PACE 를 비운 상대는 글자와 까닭만
      const noPace = without(theirs, sectionsOf("PACE"));
      const report = buildWc64Report(noPace, "none");
      expect(report.code).toMatch(/^···[MR]$/);
      expect(report.name).toBeNull();
      await type(theirBox(), encodeWc64PairCode(noPace, "none"));
      await click(button("나란히 보기"));
      expect(line("them")).toBe(`상대 ${report.code} (식 없이 하기로 해서 두 자리는 비워 뒀어요)`);
    });

    it("참고로만 결과에도 이름은 두고, 이름 바로 뒤에 '참고로만 볼 결과예요.'만 붙인다(결과 화면의 까닭 문장은 싣지 않는다, 재판정)", async () => {
      const middle: Wc64Answers = {};
      for (const it of WC64_ITEMS) middle[it.id] = 3;
      const report = buildWc64Report(middle, "yes");
      const notice = wc64ReferenceNotice(report);
      expect(notice).toContain("참고로만 보세요");
      expect(report.name).not.toBeNull();
      await render(<Compare64 myAnswers={middle} myPlan="yes" />);
      await type(theirBox(), theirCode);
      await click(button("나란히 보기"));
      expect(WC64_COMPARE_REFERENCE_TEXT).toBe("참고로만 볼 결과예요.");
      expect(line("me")).toBe(`나 ${bankLabel(report.code, "yes")}(${report.code}). ${WC64_COMPARE_REFERENCE_TEXT}`);
      expect(line("me")).not.toContain(notice!);
      // 또렷한 상대 결과에는 붙이지 않는다
      expect(wc64ReferenceNotice(buildWc64Report(theirs, "yes"))).toBeNull();
      expect(line("them")).not.toContain("참고로만");
    });

    it("상대 결과가 참고로만 결과여도 상대 줄은 같은 꼴이고, 화면을 보는 나에게 하는 높임·권유(고르셔서·다시 해 보시면)를 싣지 않는다(재판정)", async () => {
      // 같은 칸 반복(모든 성향 문장 5)과 가운데 몰림(모두 3) 두 꼴의 상대
      for (const v of [5, 3] as const) {
        const other: Wc64Answers = {};
        for (const it of WC64_ITEMS) other[it.id] = v;
        const report = buildWc64Report(other, "yes");
        expect(wc64ReferenceNotice(report)).not.toBeNull();
        expect(report.name).not.toBeNull();
        await render(<Compare64 key={`ref-${v}`} myAnswers={mine} myPlan="yes" />);
        await type(theirBox(), encodeWc64PairCode(other, "yes"));
        await click(button("나란히 보기"));
        expect(line("them")).toBe(`상대 ${bankLabel(report.code, "yes")}(${report.code}). ${WC64_COMPARE_REFERENCE_TEXT}`);
        expect(line("them")).not.toMatch(/고르셔서|보시면|보세요/);
      }
    });

    it("상대에게 보내는 글에는 이름을 싣지 않는다(답 코드만 싣는 글)", async () => {
      const writeText = vi.fn((_: string) => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      await render(<Compare64 myAnswers={mine} myPlan="yes" />);
      await click(button("내 코드 복사하기"));
      const copied = writeText.mock.calls[0][0];
      const name = buildWc64Report(mine, "yes").name!;
      expect(name).not.toBeNull();
      expect(copied).toContain(encodeWc64PairCode(mine, "yes"));
      expect(copied).not.toContain(name.label);
      expect(copied).not.toContain(name.adjective);
      expect(copied).not.toContain(name.animal);
    });
  });

  it("'나란히 보기' 뒤 초점이 결과 제목으로 가고, 다시 눌러도 다시 간다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), theirCode);
    await click(button("나란히 보기"));
    const heading = container.querySelector<HTMLElement>("#wc64-compare-letters")!;
    expect(heading.tagName).toBe("H3");
    expect(heading.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(heading);
    theirBox().focus();
    await click(button("나란히 보기"));
    expect(document.activeElement).toBe(container.querySelector("#wc64-compare-letters"));
  });

  it("'같은 칸을 고른 문장 보기'는 펼침 표시(꺾쇠)가 있는 공용 summary 모양을 쓴다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    await type(theirBox(), encodeWc64PairCode(mine, "yes"));
    await click(button("나란히 보기"));
    const summary = [...container.querySelectorAll("summary")].find(x => x.textContent === "같은 칸을 고른 문장 보기")!;
    expect(summary.className).toBe(summaryClass);
  });

  it("대화방을 통째로 붙이면 내 코드가 아닌 쪽을 읽고, 서로 다른 상대 코드가 둘이면 어느 것인지 묻는다", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    const myMessage = wc64PairShareMessage(encodeWc64PairCode(mine, "yes"), "https://hanbang.ai/wedding-code");
    await type(theirBox(), `[나] 오후 9:01 ${myMessage} [상대] 오후 9:30 나도 했어 ${theirCode}`);
    await click(button("나란히 보기"));
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).not.toBeNull();
    expect(container.textContent).not.toContain("내 코드와 같아요.");
    const theirReport = buildWc64Report(theirs, "yes");
    expect(container.querySelector('[data-testid="wc64-compare-code-them"]')!.textContent).toContain(`(${theirReport.code})`);
    // 상대가 다시 해서 코드를 또 보냈다: 오래된 쪽을 말없이 쓰지 않는다
    const again = encodeWc64PairCode(leaning("A"), "maybe");
    await type(theirBox(), `${myMessage} ${theirCode} 다시 했어 ${again}`);
    await click(button("나란히 보기"));
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("서로 다른 코드가 둘 이상 들어 있어요. 어느 코드로 볼지 하나만 남기고 다시 붙여 넣어 주세요.");
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).toBeNull();
  });

  it("이해도 문장은 2칸 차이·같은 칸 목록에 넣지 않고 '알아볼 거리 나누기'에 따로 둔다", async () => {
    const know = WC64_BANK.sections.find(s => s.id === "KNOW")!.items;
    const one: Wc64Answers = { ...mine }, two: Wc64Answers = { ...mine };
    know.forEach((it, i) => {
      if (i < 4) { one[it.id] = 5; two[it.id] = 1; } // 한 사람만 안다
      else if (i < 8) { one[it.id] = 1; two[it.id] = 2; } // 둘 다 잘 모른다
      else { one[it.id] = 3; two[it.id] = 3; } // 같은 칸
    });
    // 성향 문장 하나는 2칸 넘게 다르게
    const tendency = WC64_ITEMS.find(it => it.pole !== "L")!;
    two[tendency.id] = one[tendency.id] === 5 ? 1 : 5;
    await render(<Compare64 myAnswers={one} myPlan="yes" />);
    await type(theirBox(), encodeWc64PairCode(two, "yes"));
    await click(button("나란히 보기"));
    const apart = container.querySelector('[data-testid="wc64-compare-apart"]')!.textContent!;
    const same = container.querySelector('[data-testid="wc64-compare-same"]')!.textContent!;
    expect(apart).toContain(tendency.text);
    for (const it of know) {
      expect(apart, it.id).not.toContain(it.text);
      expect(same, it.id).not.toContain(it.text);
    }
    const oneKnows = container.querySelector('[data-testid="wc64-compare-know-one"]')!.textContent!;
    const bothLow = container.querySelector('[data-testid="wc64-compare-know-low"]')!.textContent!;
    know.slice(0, 4).forEach(it => expect(oneKnows).toContain(it.text));
    know.slice(4, 8).forEach(it => expect(bothLow).toContain(it.text));
    know.slice(8).forEach(it => { expect(oneKnows).not.toContain(it.text); expect(bothLow).not.toContain(it.text); });
    expect(container.querySelector('[data-testid="wc64-compare-know"]')!.textContent).toContain("알아볼 거리 나누기");
  });

  it("한쪽이 가운데 근처(동점·반반)면 '갈렸어요'라 하지 않고, 같은 글자라도 크게 벌어지면 질문을 보인다", async () => {
    // 나는 모든 문장에 '반반이에요'(3): 모든 축이 동점이다
    const middle: Wc64Answers = {};
    for (const it of WC64_ITEMS) middle[it.id] = 3;
    const myReport = buildWc64Report(middle, "yes");
    let near = 0, sameGap = 0, small = 0;
    for (const toward of ["A", "B"] as const) {
      await render(<Compare64 key={toward} myAnswers={middle} myPlan="yes" />);
      await type(theirBox(), encodeWc64PairCode(leaning(toward), "yes"));
      await click(button("나란히 보기"));
      const theirReport = buildWc64Report(leaning(toward), "yes");
      for (const d of WC64_DIMS) {
        const m = myReport.dims.find(r => r.dim === d.id)!;
        const t = theirReport.dims.find(r => r.dim === d.id)!;
        if (!m.decided || !t.decided) throw new Error("글자가 정해져야 해요");
        expect(m.tie).toBe(true);
        const box = container.querySelector(`[data-testid="wc64-compare-questions-${d.id}"]`);
        if (m.letter === t.letter && Math.abs(m.pctX - t.pctX) < 20) {
          // 같은 글자이고 20%p 안쪽이면 질문을 띄우지 않는다
          small++;
          expect(box, d.id).toBeNull();
          continue;
        }
        expect(box, d.id).not.toBeNull();
        if (!box) continue;
        expect(box.textContent).not.toContain("글자가 갈렸어요");
        for (const q of d.couple_questions) expect(box.textContent).toContain(q);
        if (m.letter !== t.letter) {
          near++;
          expect(box.getAttribute("data-talk")).toBe("near-middle");
          expect(box.textContent).toContain("글자는 다르게 나왔지만 나는 가운데 근처예요.");
        } else {
          sameGap++;
          expect(box.getAttribute("data-talk")).toBe("same-gap");
          expect(box.textContent).toContain("같은 글자지만 기우는 정도가 꽤 달라요. 어디서 갈리는지 물어봐요");
        }
      }
    }
    expect(near).toBeGreaterThan(0);
    expect(sameGap).toBeGreaterThan(0);
    expect(small).toBeGreaterThan(0);
  });

  it("화면 글에 금지어가 없다(상대 결과까지 펼친 뒤)", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="none" />);
    expect(screenText()).not.toMatch(BANNED);
    await type(theirBox(), theirCode);
    await click(button("나란히 보기"));
    for (const d of container.querySelectorAll("details")) (d as HTMLDetailsElement).open = true;
    expect(container.querySelector('[data-testid="wc64-compare-result"]')).not.toBeNull();
    expect(screenText()).not.toMatch(BANNED);
    // 식 없이 하면 비운 글자의 까닭을 그대로 말한다
    expect(container.textContent).toContain("식 없이 하기로 해서 이 글자는 비워 뒀어요.");
  });

  it("예산·비용 마련 막대는 식 계획과 상관없이 늘 글자 밖이고, 좌우와 %가 결과 화면의 글자 밖 막대와 같다(M5·UX-7)", async () => {
    const outsideTitle = (id: string) => WC64_BANK.sections.find(s => s.id === id)!.title;
    for (const [myPlan, theirPlan] of [["yes", "yes"], ["maybe", "yes"], ["yes", "none"], ["none", "yes"], ["none", "none"]] as const) {
      const label = `${myPlan}/${theirPlan}`;
      await render(<Compare64 key={label} myAnswers={mine} myPlan={myPlan} />);
      await type(theirBox(), encodeWc64PairCode(theirs, theirPlan));
      await click(button("나란히 보기"));
      const myReport = buildWc64Report(mine, myPlan), theirReport = buildWc64Report(theirs, theirPlan);
      const anyNone = myPlan === "none" || theirPlan === "none";
      for (const [id, copy, mr, tr] of [
        ["BUDGET", WC64_BANK.budget_bar, myReport.budget, theirReport.budget],
        ["FUND", WC64_BANK.fund, myReport.fund, theirReport.fund],
      ] as const) {
        const row = container.querySelector(`[data-testid="wc64-compare-section-${id}"]`)!;
        expect(row, `${label} ${id}`).not.toBeNull();
        // 결과 화면(OutsideBar)처럼 왼쪽이 a_name, 오른쪽이 b_name
        const ends = row.querySelectorAll("h4 + div > span");
        expect(ends[0].textContent, `${label} ${id}`).toBe(copy.a_name);
        expect(ends[1].textContent, `${label} ${id}`).toBe(copy.b_name);
        if (!mr.decided || !tr.decided) throw new Error("글자 밖 막대가 정해져야 해요");
        expect(row.textContent, `${label} ${id}`).toContain(`나 ${mr.pctA}% 대 ${mr.pctB}%`);
        expect(row.textContent, `${label} ${id}`).toContain(`상대 ${tr.pctA}% 대 ${tr.pctB}%`);
        // 점 위치도 결과 화면 막대(AxisBar64 pctX = pctA)와 같은 방향: pctA 가 클수록 왼쪽
        expect(row.querySelector<HTMLElement>('[data-dot="me"]')!.style.left, `${label} ${id}`).toBe(`${100 - mr.pctA}%`);
        expect(row.querySelector<HTMLElement>('[data-dot="them"]')!.style.left, `${label} ${id}`).toBe(`${100 - tr.pctA}%`);
        expect(row.querySelector("h4")!.textContent, `${label} ${id}`).toBe(`${outsideTitle(id)}${anyNone ? "글자 밖" : "네 글자 밖"}`);
        expect(row.querySelector(`[data-testid="wc64-compare-outside-question-${id}"]`)!.textContent, `${label} ${id}`)
          .toBe(`이렇게 물어봐요: ${copy.couple_question}`);
      }
      // 글자 밖 표시와 질문은 이 두 묶음에만 붙는다
      expect(container.querySelectorAll('[data-testid^="wc64-compare-outside-question-"]'), label).toHaveLength(2);
      for (const row of container.querySelectorAll('[data-testid^="wc64-compare-section-"]')) {
        const id = row.getAttribute("data-testid")!.replace("wc64-compare-section-", "");
        if (id === "BUDGET" || id === "FUND" || id === "s-not-asked") continue;
        expect(row.querySelector("h4 span"), `${label} ${id}`).toBeNull();
      }
    }
  });

  it("식을 올리는 사람의 코드 고지는 '64문항', 식 없이 하면 '37문항'으로 적는다(UX-2)", async () => {
    for (const [plan, expected] of [
      ["yes", "이 코드에는 네 글자 결과만이 아니라 64문항에서 고른 답 하나하나와 식 계획 답이 모두 담겨요. 받은 사람은 그 답을 전부 볼 수 있고, 보낸 코드는 되돌릴 수 없어요. 함께 볼 사람에게만 보내 주세요."],
      ["maybe", "이 코드에는 네 글자 결과만이 아니라 64문항에서 고른 답 하나하나와 식 계획 답이 모두 담겨요. 받은 사람은 그 답을 전부 볼 수 있고, 보낸 코드는 되돌릴 수 없어요. 함께 볼 사람에게만 보내 주세요."],
      ["none", "이 코드에는 두 글자 결과만이 아니라 37문항에서 고른 답 하나하나와 식 계획 답이 모두 담겨요. 받은 사람은 그 답을 전부 볼 수 있고, 보낸 코드는 되돌릴 수 없어요. 함께 볼 사람에게만 보내 주세요."],
    ] as const) {
      await render(<Compare64 key={plan} myAnswers={mine} myPlan={plan} />);
      expect(container.querySelector('[data-testid="wc64-compare-my-code-note"]')!.textContent, plan).toContain(expected);
    }
    // 37 은 식 없이 할 때 답 코드에 실리는 답의 수와 같다
    const noneAnswers = decodeWc64PairCode(encodeWc64PairCode(mine, "none"));
    if (!noneAnswers.ok) throw new Error("코드를 읽어야 해요");
    expect(Object.keys(noneAnswers.answers)).toHaveLength(37);
  });

  it("'상대 코드 지우기'를 누르면 단추가 사라져도 초점이 상대 코드 칸으로 간다(A11Y-2)", async () => {
    await render(<Compare64 myAnswers={mine} myPlan="yes" />);
    // 결과를 그린 뒤에 지울 때
    await type(theirBox(), theirCode);
    await click(button("나란히 보기"));
    const clear = button("상대 코드 지우기")!;
    clear.focus();
    await click(clear);
    expect(button("상대 코드 지우기")).toBeUndefined();
    expect(document.activeElement).toBe(theirBox());
    // 글만 넣고 결과를 그리기 전에 지울 때
    await type(theirBox(), "WC64");
    button("상대 코드 지우기")!.focus();
    await click(button("상대 코드 지우기"));
    expect(theirBox().value).toBe("");
    expect(document.activeElement).toBe(theirBox());
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
