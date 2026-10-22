// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BudgetContent from "../BudgetContent";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY_COST_JOURNEY: WeddingJourney = {
  id: "10000000-0000-4000-8000-000000000001",
  couple_id: "20000000-0000-4000-8000-000000000001",
  wedding_date: null,
  venue: null,
  total_budget: 1_000_000,
  progress: {
    venue: {
      status: "in_progress",
      // Historical web data stored small values in 만원 units. The value must
      // remain reviewable but must not become both budget and spend.
      cost: 500,
    },
  },
  state_revision: 0,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

describe("BudgetContent legacy cost boundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalJourney = useAuthStore.getState().journey;
  const originalIsDemo = useAuthStore.getState().isDemo;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({ journey: LEGACY_COST_JOURNEY });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState({ journey: originalJourney, isDemo: originalIsDemo });
    document.body.replaceChildren();
  });

  it("excludes ambiguous legacy cost from totals while keeping it visible for review", async () => {
    await act(async () => root.render(<BudgetContent />));

    expect(container.textContent).toContain("용도 미확인 이전 금액");
    expect(container.textContent).toContain("결혼식장 500만원");
    expect(container.textContent).toContain("예산·기록 지출 합계에서 제외");
    expect(container.textContent).toContain("기록 지출");
    expect(container.textContent).toContain("항목별 배정 예산과 직접 기록한 지출 내역을 한눈에 비교해 보세요.");
    expect(container.textContent).not.toContain("예산 초과");
  });

  it("closes the payer choices with Escape and saves a choice without changing money", async () => {
    useAuthStore.setState({ isDemo: true, journey: { ...LEGACY_COST_JOURNEY, progress: {
      makeup: { category: "makeup", status: "in_progress", budget: 700_000, spent: 100_000, payer: "couple" },
    } } });
    await act(async () => root.render(<BudgetContent />));
    const row = container.querySelector('button[title="헤어·메이크업 예산 수정"]')!.closest("div.group")!;
    const toggle = row.querySelector<HTMLButtonElement>('button[title="분담 변경"]')!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    await act(async () => toggle.click());
    const option = Array.from(row.querySelectorAll<HTMLButtonElement>("button:not([title])")).find(button => button.textContent === "두 가족")!;
    await act(async () => option.click());
    expect(useAuthStore.getState().journey?.progress.makeup).toMatchObject({ payer: "both_parents", budget: 700_000, spent: 100_000, status: "in_progress" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("shows exact allocated and recorded amounts instead of rounding them to ten thousand won", async () => {
    useAuthStore.setState({ journey: { ...LEGACY_COST_JOURNEY, progress: {
      venue: { category: "venue", status: "completed", budget: 5_000, spent: 14_999 },
      reserve: { category: "reserve", status: "not_started", budget: 5_995_000 },
    } } });
    await act(async () => root.render(<BudgetContent />));
    expect(container.querySelector('button[title="결혼식장 예산 수정"]')?.textContent).toContain("5,000원");
    expect(container.querySelector('button[title="결혼식장 기록 지출 수정"]')?.textContent).toContain("14,999원");
    expect(container.querySelector('button[title="예비비·사용처 미정 예산 수정"]')?.textContent).toContain("5,995,000원");
    expect(container.textContent).toContain("1.4999");
  });

  it.each([5_000, 14_999, 1])("keeps an unchanged %i-won category amount exact when opening and saving the manwon editor", async (amount) => {
    useAuthStore.setState({ isDemo: true, journey: { ...LEGACY_COST_JOURNEY, progress: {
      venue: { category: "venue", status: "completed", budget: amount, spent: amount },
    } } });
    await act(async () => root.render(<BudgetContent />));
    for (const [label, field] of [["예산", "budget"], ["기록 지출", "spent"]] as const) {
      await act(async () => container.querySelector<HTMLButtonElement>(`button[title="결혼식장 ${label} 수정"]`)!.click());
      const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(useAuthStore.getState().journey?.progress.venue[field]).toBe(amount);
      expect(useAuthStore.getState().journey?.progress.venue.status).toBe("completed");
    }
  });

  it("keeps a one-won precision total exact in the summary and unchanged total editor", async () => {
    useAuthStore.setState({ isDemo: true, journey: { ...LEGACY_COST_JOURNEY, total_budget: 14_999, progress: {} } });
    await act(async () => root.render(<BudgetContent />));
    expect(container.textContent).toContain("1.4999");
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="총 예산 수정"]')!.click());
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(useAuthStore.getState().journey?.total_budget).toBe(14_999);
  });
});

describe("BudgetContent editor ownership", () => {
  const originalState = useAuthStore.getState();
  let container: HTMLDivElement;
  let root: Root;
  const scope = (owner: string, couple: string) => ({
    user: { id: owner, email: `${owner}@test.invalid` },
    profile: { id: owner, couple_id: couple, role: "bride" } as NonNullable<typeof originalState.profile>,
    couple: { id: couple } as NonNullable<typeof originalState.couple>,
    journey: { ...LEGACY_COST_JOURNEY, id: `journey-${couple}`, couple_id: couple, total_budget: 35_000_000,
      progress: { makeup: { category: "makeup", status: "in_progress" as const, budget: 700_000, spent: 100_000 } } },
    isDemo: false, isInitialized: true, isLoading: false,
  });
  const byTitle = (title: string) => container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
  const byText = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === text)!;
  const switchScope = async (owner = "owner-a", couple = "couple-b") => {
    await act(async () => useAuthStore.setState(scope(owner, couple)));
  };
  beforeEach(() => {
    useAuthStore.setState(scope("owner-a", "couple-a"));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    useAuthStore.setState(originalState); vi.unstubAllGlobals();
  });

  it.each(["total", "allocation", "spend", "custom", "payer", "delete"] as const)(
    "discards the %s editor when the same user moves to another couple and does not revive it on return",
    async (editor) => {
      await act(async () => root.render(<BudgetContent />));
      await act(async () => {
        if (editor === "total") byTitle("총 예산 수정").click();
        if (editor === "allocation") byTitle("헤어·메이크업 예산 수정").click();
        if (editor === "spend") byTitle("헤어·메이크업 기록 지출 수정").click();
        if (editor === "custom") byText("새 항목 추가").click();
        if (editor === "payer") byTitle("분담 변경").click();
        if (editor === "delete") byTitle("헤어·메이크업 삭제").click();
      });
      const hasEditor = () => editor === "payer"
        ? container.querySelector('button[title="분담 변경"][aria-expanded="true"]') !== null
        : editor === "delete"
          ? Array.from(container.querySelectorAll("h3")).some(title => title.textContent === "항목 관리")
          : container.querySelector("input") !== null;
      expect(hasEditor()).toBe(true);
      await switchScope(); expect(hasEditor()).toBe(false);
      await switchScope("owner-a", "couple-a"); expect(hasEditor()).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("clears an open draft even when an A-B-A owner transition is batched into one React render", async () => {
    await act(async () => root.render(<BudgetContent />));
    await act(async () => byTitle("총 예산 수정").click());
    await act(async () => {
      useAuthStore.setState(scope("owner-b", "couple-b"));
      useAuthStore.setState(scope("owner-a", "couple-a"));
    });
    expect(container.querySelector("input")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalidates a queued payer save before the new couple can receive the old draft", async () => {
    const update = vi.fn().mockResolvedValue({ status: "applied", journey: scope("owner-a", "couple-b").journey });
    useAuthStore.setState({ updateJourney: update });
    await act(async () => root.render(<BudgetContent />));
    await act(async () => byTitle("분담 변경").click());
    await act(async () => {
      byText("두 가족").click();
      useAuthStore.setState(scope("owner-a", "couple-b"));
    });
    expect(update).not.toHaveBeenCalled();
    expect(useAuthStore.getState().journey?.progress.makeup.payer).toBeUndefined();
  });

  it("keeps an active editor during a same-couple revision refresh", async () => {
    await act(async () => root.render(<BudgetContent />));
    await act(async () => byTitle("총 예산 수정").click());
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => useAuthStore.setState({ journey: { ...useAuthStore.getState().journey!, state_revision: 2 } }));
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("3500");
  });

  it("does not continue a two-step custom deletion after leaving the screen and returning to the same owner", async () => {
    const activeScope = scope("owner-a", "couple-a");
    activeScope.journey.progress = { custom_photo: { category: "custom_photo", label: "포토부스", status: "in_progress", budget: 700_000 } } as never;
    let finishFirstSave!: (value: unknown) => void;
    const update = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirstSave = resolve; }))
      .mockResolvedValue({ status: "applied", journey: activeScope.journey });
    useAuthStore.setState({ ...activeScope, updateJourney: update });
    await act(async () => root.render(<BudgetContent />));
    await act(async () => byTitle("포토부스 삭제").click());
    await act(async () => byText("삭제").click());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].progress.custom_photo.budget).toBeUndefined();
    await act(async () => root.render(null));
    useAuthStore.setState(scope("owner-b", "couple-b"));
    useAuthStore.setState(activeScope);
    await act(async () => finishFirstSave({ status: "applied", journey: activeScope.journey }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().journey?.progress.custom_photo.budget).toBe(700_000);
  });
});
