// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BudgetContent from "../BudgetContent";
import { isUnusedBudgetCategory } from "../isUnusedBudgetCategory";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initial: WeddingJourney = {
  id: "synthetic-journey-a", couple_id: "synthetic-couple-a", total_budget: 35_000_000,
  wedding_date: null, venue: null, state_revision: 0,
  created_at: "2026-09-09T00:00:00.000Z", updated_at: "2026-09-09T00:00:00.000Z",
  progress: {
    studio: { category: "studio", status: "not_started" },
    custom_venue: { status: "not_started", label: "결혼식장·식사", budget: 9_000_000 },
    honeymoon: { status: "not_started", budget: 10_000_000 },
    custom_photo: { status: "not_started", label: "사진", budget: 5_000_000 },
    custom_attire: { status: "not_started", label: "드레스·정장", budget: 3_000_000 },
    makeup: { status: "not_started", budget: 2_000_000 },
    custom_ring: { status: "not_started", label: "반지·선물", budget: 2_500_000 },
    custom_invitation: { status: "not_started", label: "초대장·꽃·하객선물", budget: 1_500_000 },
    reserve: { status: "not_started", budget: 2_000_000 },
  },
};

describe("unused default budget categories", () => {
  it.each([undefined, {}, { category: "venue" }, { status: "not_started" },
    { category: "venue", status: "not_started" }])("only collapses a template shell: %j", (item) => {
    expect(isUnusedBudgetCategory("venue", item)).toBe(true);
  });
  it.each([null, [], 0, { category: "custom_venue" }, { budget: 0 }, { spent: 0 },
    { cost: 0 }, { budget: null }, { spent: -1 }, { payer: "couple" }, { notes: "" },
    { vendor: "" }, { checklist: [] }, { label: "결혼식장" }, { assigned_to: "partner" },
    { status: "completed" }, { status: "in_progress" }, { status: "not_applicable" }])(
    "keeps explicit or historical records visible: %j", (item) => {
      expect(isUnusedBudgetCategory("venue", item)).toBe(false);
    },
  );
});

describe("BudgetContent category disclosure", () => {
  const original = useAuthStore.getState();
  let container: HTMLDivElement;
  let root: Root;
  const byTitle = (title: string) => container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  const inputCategory = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label} 예산 입력하기"]`)!;
  beforeEach(() => {
    useAuthStore.setState({ isDemo: true, journey: structuredClone(initial) });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    useAuthStore.setState(original); vi.unstubAllGlobals();
  });

  it("shows the eight allocations without empty editors or merging custom amounts into the subtotal", async () => {
    await act(async () => root.render(<BudgetContent />));
    expect(container.querySelectorAll('button[title$=" 예산 수정"]')).toHaveLength(9); // total + eight categories
    expect(byTitle("드레스·예식 정장 예산 수정")).toBeNull();
    expect(byTitle("헤어·메이크업 예산 수정")?.textContent).toContain("200만원");
    expect(byTitle("사진 예산 수정")?.textContent).toContain("500만원");
    expect(byTitle("드레스·정장 예산 수정")?.textContent).toContain("300만원");
    expect(container.textContent).toContain("포함 항목: 헤어·메이크업");
    expect(container.textContent).toContain("별도로 만든 항목은 이 소계에 포함되지 않아요.");
    expect(container.querySelector("summary")?.textContent).toContain("19개");
    expect(useAuthStore.getState().journey).toEqual(initial);
  });

  it("disclosure and choosing a default never write, then saves precisely into its original key", async () => {
    await act(async () => root.render(<BudgetContent />));
    const details = container.querySelector("details")!;
    details.open = true; details.open = false; details.open = true;
    await act(async () => inputCategory("결혼식장").click());
    expect(document.activeElement).toBe(byTitle("결혼식장 예산 수정"));
    expect(useAuthStore.getState().journey).toEqual(initial);
    await act(async () => byTitle("결혼식장 예산 수정")!.click());
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0.0001");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(useAuthStore.getState().journey?.progress).toEqual({ ...initial.progress,
      venue: { category: "venue", status: "not_started", budget: 1 } });
    expect(useAuthStore.getState().journey?.total_budget).toBe(35_000_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains an opened editor during same-couple refresh and updates an allocation without duplication", async () => {
    await act(async () => root.render(<BudgetContent />));
    await act(async () => inputCategory("결혼식장").click());
    await act(async () => byTitle("결혼식장 예산 수정")!.click());
    const input = container.querySelector("input");
    await act(async () => useAuthStore.setState({ journey: { ...initial, state_revision: 1, progress: {
      ...initial.progress, venue: { status: "not_started", notes: "상대방이 남긴 메모" },
      custom_invitation: { ...initial.progress.custom_invitation, budget: 1_600_000 },
      reserve: { ...initial.progress.reserve, budget: 1_900_000 },
    } } }));
    expect(container.querySelector("input")).toBe(input);
    expect(byTitle("초대장·꽃·하객선물 예산 수정")?.textContent).toContain("160만원");
    expect(container.querySelectorAll('button[title="초대장·꽃·하객선물 예산 수정"]')).toHaveLength(1);
  });

  it("discards a newly opened default and its draft after an A→B→A owner transition", async () => {
    await act(async () => root.render(<BudgetContent />));
    await act(async () => inputCategory("결혼식장").click());
    await act(async () => byTitle("결혼식장 예산 수정")!.click());
    await act(async () => {
      useAuthStore.setState({ journey: { ...initial, id: "journey-b", couple_id: "couple-b" } });
      useAuthStore.setState({ journey: initial });
    });
    expect(container.querySelector("input")).toBeNull();
    expect(byTitle("결혼식장 예산 수정")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps zero, payer-only, notes, and empty custom rows visible, and respects explicit hiding", async () => {
    const progress: WeddingJourney["progress"] = { ...initial.progress,
      venue: { status: "not_started" as const, budget: 0 },
      dress: { status: "not_started" as const, payer: "couple" as const },
      studio: { status: "not_started" as const, notes: "참고" },
      custom_empty: { status: "not_started" as const, label: "직접 만든 항목" },
    };
    Object.assign(progress, { __hidden: ["honeymoon"] });
    useAuthStore.setState({ journey: { ...initial, progress } });
    await act(async () => root.render(<BudgetContent />));
    for (const label of ["결혼식장", "드레스·예식 정장", "웨딩 사진 촬영", "직접 만든 항목"]) {
      expect(byTitle(`${label} 예산 수정`), label).not.toBeNull();
    }
    expect(byTitle("신혼여행 예산 수정")).toBeNull();
    expect(container.querySelector('button[aria-label="신혼여행 예산 입력하기"]')).toBeNull();
  });
});
