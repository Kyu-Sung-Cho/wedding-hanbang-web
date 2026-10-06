// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import WeddingCodeV31Results from "@/app/wedding-code/WeddingCodeV31Results";
import { createV31Draft } from "@/lib/weddingCode/v31";
import { V31_STYLE_DIMENSIONS } from "@/lib/weddingCode/v31StyleSummary";
import type { V31Draft } from "@/constants/weddingCodeV31";
import { V31_CHARACTERS } from "@/lib/weddingCode/v31CharacterGuide";
function draft(code: string) {
  const result = createV31Draft();
  V31_STYLE_DIMENSIONS.forEach((axis, index) => {
    result.answers[axis.first.id] = code[index] === axis.first.letter ? 5 : 1;
    result.answers[axis.second.id] = code[index] === axis.first.letter ? 1 : 5;
  });
  return result;
}
function view(own: V31Draft, first: V31Draft | null = null) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<WeddingCodeV31Results draft={own} first={first} received={false} shareOrigin="https://hanbang.ai" onEdit={() => {}} onRestart={() => {}} />);
  return container;
}
describe("v3.1 result-character-guide wiring", () => {
  for (const name of ["same", "contrast", "mixed"]) {
    it.each([false, true])(`shows actual speaker and agreed action for ${name}, reversed %s`, reverse => {
      const first = draft("KTFL"); const second = draft(name === "contrast" ? "RDCA" : "KTFL");
      if (name === "same") { second.answers.B1 = 4; second.answers.B3 = 2; }
      if (name === "mixed") Object.assign(first.answers, { B1: 3, B3: 3, T1: 5, T2: 5, F1: "undecided", F2: 5, H1: 1, H2: 1 });
      const container = reverse ? view(first, second) : view(second, first);
      const budget = container.querySelector('[data-v31-coordination="budget"]')!;
      const support = container.querySelector('[data-v31-coordination="support"]')!;
      const expectedBudget = name === "same" ? ["먼저 정한 예산 안의 선택", "먼저 정한 예산 안의 선택"]
        : name === "contrast" ? ["먼저 정한 예산 안의 선택", "더 쓰고 싶은 이유"] : ["상황에 따라 답이 달라질 수", "먼저 정한 예산 안의 선택"];
      const expectedSupport = name === "contrast" ? ["먼저 이야기를 들어줄래", "맡아줄 수 있는 일 하나"]
        : name === "mixed" ? ["둘 중 하나를 고르라고 하지 않아도 돼", "먼저 이야기를 들어줄래"] : ["먼저 이야기를 들어줄래", "먼저 이야기를 들어줄래"];
      for (const [element, expected] of [[budget, expectedBudget], [support, expectedSupport]] as const) {
        expect(element.querySelector('[data-v31-first-say]')?.textContent).toContain(expected[reverse ? 1 : 0]);
        expect(element.querySelector('[data-v31-second-say]')?.textContent).toContain(expected[reverse ? 0 : 1]);
        expect(element.querySelector('[data-v31-agreement]')?.textContent).toBeTruthy();
        expect(element.textContent).toContain("상대의 답을 설명한다면"); expect(element.textContent).toContain("나의 답을 설명한다면");
      }
      expect(container.querySelectorAll('[data-v31-pair-evidence]')).toHaveLength(8);
      if (name === "same") expect(container.querySelector("[data-v31-couple-guide]")?.textContent).toContain("둘 다 처음 정한 전체 예산");
      if (name === "mixed") expect(support.textContent).toContain("어떤 도움도 바로 실행하지 않기로");
    });
  }
  it.each(V31_CHARACTERS.map(row => row[0]))("renders %s with eight native statement evidence items", code => {
    const container = view(draft(code));
    expect(container.querySelector('[data-v31-character-guide]')?.getAttribute("data-character-code")).toBe(code);
    expect(container.querySelectorAll("[data-v31-guide-evidence]")).toHaveLength(8);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
  it.each(V31_CHARACTERS.flatMap(first => V31_CHARACTERS.map(second => [first[0], second[0]] as const)))(
    "renders %s / %s without a compatibility score", (first, second) => {
      const container = view(draft(second), draft(first));
      expect(container.querySelectorAll("[data-v31-pair-evidence]")).toHaveLength(8);
      expect(container.querySelector("[data-v31-couple-guide]")?.textContent).not.toMatch(/\d+%/);
    },
  );
  it.each([true, false])("own-result confirmation describes saved-answer clearing %s, defaults to cancel, and supports Escape", async restartClearsSavedAnswers => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
    const restart = vi.fn();
    try {
      await act(async () => root.render(<WeddingCodeV31Results draft={draft("KTFL")} first={null} received={false} restartClearsSavedAnswers={restartClearsSavedAnswers} shareOrigin="https://hanbang.ai" onEdit={() => {}} onRestart={restart} />));
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "처음부터 다시 답하기")!;
      await act(async () => { button.focus(); button.click(); });
      expect(restart).not.toHaveBeenCalled();
      expect(document.activeElement?.textContent).toBe("그대로 두기");
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(restartClearsSavedAnswers ? "이 브라우저에서 지워져요" : "저장된 본인 답을 지우지 않아요");
      await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await new Promise(resolve => setTimeout(resolve, 1)); });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.activeElement).toBe(button); expect(restart).not.toHaveBeenCalled();
      await act(async () => button.click());
      const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(item => item.textContent === "확인하고 새로 시작")!;
      await act(async () => confirm.click()); expect(restart).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
  it("renders KTFL and its eight original response statements in the default result path", () => {
    const container = view(draft("KTFL"));
    expect(container.querySelector('[data-v31-character-guide]')?.getAttribute("data-character-code")).toBe("KTFL");
    expect(container.textContent).toContain("다정한 사슴");
    expect(container.querySelectorAll("[data-v31-guide-evidence]")).toHaveLength(8);
    expect(container.textContent).toContain("처음 정한 전체 예산");
    expect(container.textContent).toContain("이렇게 말해 보기");
    expect(container.querySelector("[data-character-card]")).toBeNull();
  });
  it("shows uncertainty and concrete exploration for MB?N without a polar animal", () => {
    const mixed = createV31Draft(); mixed.answers = { B1: 3, B3: 3, T1: 5, T2: 5, F1: "undecided", F2: 5, H1: 1, H2: 1 };
    const container = view(mixed);
    expect(container.querySelector("[data-v31-character-guide]")?.hasAttribute("data-character-code")).toBe(false);
    expect(container.querySelectorAll("[data-v31-explore]")).toHaveLength(4);
    expect(container.textContent).toContain("한 유형으로 정하지 않은 답이에요");
    expect(container.textContent).not.toContain("다정한 사슴");
  });
  it("shows native paired evidence and useful negotiation language in the together tab", () => {
    const container = view(draft("RDCA"), draft("KTFL"));
    expect(container.querySelector("[data-v31-couple-guide]")).not.toBeNull();
    expect(container.querySelectorAll("[data-v31-pair-evidence]")).toHaveLength(8);
    expect(container.querySelector("[data-v31-couple-guide]")?.textContent).toContain("같은 문장에서 각자 고른 답");
    expect(container.textContent).toContain("가족의 바람은 언제 듣고");
  });
  it("confirms received-result restart before invoking any clearing handler and restores focus on cancel", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
    const restart = vi.fn();
    try {
      await act(async () => root.render(<WeddingCodeV31Results draft={draft("KTFL")} first={draft("RDCA")} received shareOrigin="https://hanbang.ai" onEdit={() => {}} onRestart={restart} />));
      const button = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
      await act(async () => { button.focus(); button.click(); });
      expect(restart).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("저장된 본인 답");
      const cancel = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(item => item.textContent === "그대로 두기")!;
      await act(async () => { cancel.click(); await new Promise(resolve => setTimeout(resolve, 1)); });
      expect(restart).not.toHaveBeenCalled(); expect(document.activeElement).toBe(button);
      await act(async () => button.click());
      const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(item => item.textContent === "확인하고 새로 시작")!;
      await act(async () => confirm.click()); expect(restart).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});


describe("top character experience preserves response states", () => {
  const cases = [
    ["B", { F1: 5, F2: 5 }, "두 문장 모두에 동의했어요"],
    ["M", { F1: 3, F2: 3 }, "중간으로 답한 문장이 있어요"],
    ["N", { F1: 1, F2: 1 }, "두 문장 모두 낮게 답했어요"],
    ["unknown", { F1: "undecided", F2: 5 }, "아직 모르겠어요"],
    ["not applicable", { F1: "not_applicable", F2: 5 }, "이번 계획에는 없어요"],
    ["skipped", { F1: "skipped", F2: 5 }, "지금 답하지 않을게요"],
    ["borderline", { F1: 4, F2: 3 }, "경계에 가까운 답이에요"],
  ] as const;
  for (const [name, answers, expected] of cases) it(`shows exploration portrait for single ${name}`, () => {
    const value = draft("KTFL"); Object.assign(value.answers, answers);
    const before = JSON.stringify(value); const container = view(value);
    const hero = container.querySelector('[data-v31-character-summary]')!;
    expect(hero).not.toBeNull(); expect(hero.getAttribute("data-character-mode")).toBe("exploration");
    expect(hero.querySelector("[data-v31-portrait]")).not.toBeNull();
    expect(hero.textContent).toContain(expected); expect(hero.textContent).toContain("탐색 캐릭터");
    expect(JSON.stringify(value)).toBe(before);
  });
  it("shows both speakers and unchanged clear aliases in together overview", () => {
    const container = view(draft("RDCA"), draft("KTFL"));
    const heroes = container.querySelectorAll('[data-v31-character-summary]'); expect(heroes).toHaveLength(2);
    expect(heroes[0].textContent).toContain("상대"); expect(heroes[0].textContent).toContain("다정한 사슴");
    expect(heroes[1].textContent).toContain("나"); expect(heroes[1].textContent).toContain("편안한 코끼리");
    for (const hero of heroes) expect(hero.textContent).toContain("8개 답");
  });
});
