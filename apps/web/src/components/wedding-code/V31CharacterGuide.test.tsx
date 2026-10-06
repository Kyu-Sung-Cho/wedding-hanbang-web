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
    expect(container.textContent).toContain("아직 한 별칭으로 묶지 않아요");
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
