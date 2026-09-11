// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BudgetContent from "../BudgetContent";
import BudgetShareChart from "../BudgetShareChart";
import BudgetSideSplit from "../BudgetSideSplit";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

function journey(total = 35_000_000, spent = 123_000): WeddingJourney {
  return {
    id: "display-journey", couple_id: "display-couple", wedding_date: null, venue: null,
    total_budget: total, progress: { venue: { status: "in_progress", budget: 35_000_000, spent, payer: "couple" } },
    state_revision: 4, created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
  };
}

describe("예산 화면의 금액과 표시 비율 정확성", () => {
  let root: Root;
  let container: HTMLDivElement;
  let original: ReturnType<typeof useAuthStore.getState>;
  const updateJourney = vi.fn<ReturnType<typeof useAuthStore.getState>["updateJourney"]>();
  const fetchMock = vi.fn(() => { throw new Error("Display-only rendering must not request a write or read"); });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    original = useAuthStore.getState();
    useAuthStore.setState({ journey: journey(), isDemo: true, updateJourney });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    expect(updateJourney).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    useAuthStore.setState(original); vi.unstubAllGlobals(); vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });
  async function render(node: ReactNode = <BudgetContent />) {
    await act(async () => root.render(node));
  }
  function summary(label: string) {
    const heading = [...container.querySelectorAll("p")].find(element => element.textContent?.trim() === label);
    if (!heading?.parentElement) throw new Error(`Missing summary: ${label}`);
    return heading.parentElement;
  }

  it("123,000원의 실제 지출 비율을 0%로 숨기지 않고 차액을 여유로 단정하지 않는다", async () => {
    const before = useAuthStore.getState().journey;
    await render();
    expect(summary("RECORDED SPEND").textContent).toContain("12.3만원");
    expect(summary("RECORDED SPEND").textContent).toContain("기록 지출 (약 0.4%)");
    expect(summary("REMAINING").textContent).toContain("3,487.7만원");
    expect(summary("REMAINING").textContent).toContain("지출 기록을 뺀 금액");
    expect(summary("REMAINING").textContent).not.toMatch(/여유|100%/);
    expect(useAuthStore.getState().journey).toEqual(before);
  });

  it.each([
    { total: 35_000_000, allocated: 34_000_001, allocatedText: "34,000,001원", label: "미배정액", amount: "999,999원" },
    { total: 35_000_000, allocated: 35_000_000, allocatedText: "3,500만원", label: "미배정액", amount: "0원" },
    { total: 35_000_000, allocated: 35_001_000, allocatedText: "35,001,000원", label: "초과배정", amount: "1,000원" },
    { total: 35_000_000, allocated: 0, allocatedText: "0원", label: "미배정액", amount: "3,500만원" },
    { total: 0, allocated: 34_000_001, allocatedText: "34,000,001원", label: "미배정액", amount: "총 예산 입력 전" },
  ])("상단에서 배정액 $allocated 원과 총예산 $total 원의 차이를 기록 지출과 구분한다", async ({ total, allocated, allocatedText, label, amount }) => {
    const saved = journey(total);
    saved.progress = {
      venue: { status: "in_progress", budget: allocated, spent: 123_000 },
    };
    useAuthStore.setState({ journey: saved });
    await render();
    const allocation = container.querySelector('dl[aria-label="항목별 예산 배정"]');
    expect(allocation).not.toBeNull();
    expect(container.querySelector("[data-budget-summary]")?.nextElementSibling).toBe(allocation);
    expect(allocation?.querySelector("dt")?.textContent).toBe("항목별 배정 합계");
    expect(allocation?.querySelector("dd")?.textContent).toBe(allocatedText);
    expect(allocation?.textContent).toContain(`${label}${amount}`);
    expect(allocation?.textContent?.includes("총 예산과 일치")).toBe(total > 0 && allocated === total);
    expect(summary("RECORDED SPEND").textContent).toContain("12.3만원");
    expect(useAuthStore.getState().journey).toEqual(saved);
  });

  it("상단 배정 합계는 숨긴 항목을 제외하고 사용자 항목의 원 단위 금액을 포함한다", async () => {
    const saved = journey();
    saved.progress = {
      venue: { status: "in_progress", budget: 20_000_000, spent: 123_000 },
      honeymoon: { status: "not_started", budget: 5_000_000, spent: 0 },
      custom_invitation: { category: "custom_invitation", label: "초대장·꽃", status: "not_started", budget: 1_501_001, spent: 0 },
    };
    Object.assign(saved.progress, { __hidden: ["honeymoon"] });
    useAuthStore.setState({ journey: saved });
    await render();
    const allocation = container.querySelector('dl[aria-label="항목별 예산 배정"]');
    expect(allocation?.textContent).toContain("항목별 배정 합계21,501,001원");
    expect(allocation?.textContent).toContain("미배정액13,498,999원");
    expect(useAuthStore.getState().journey).toEqual(saved);
  });

  it("저장된 준비 정보가 없어도 미배정액을 0원이나 초과로 확정하지 않는다", async () => {
    useAuthStore.setState({ journey: null });
    await render();
    const allocation = container.querySelector('dl[aria-label="항목별 예산 배정"]');
    expect(allocation?.textContent).toContain("항목별 배정 합계0원");
    expect(allocation?.textContent).toContain("미배정액총 예산 입력 전");
    expect(allocation?.textContent).not.toMatch(/초과배정|총 예산과 일치/);
    expect(useAuthStore.getState().journey).toBeNull();
  });

  it.each([
    { spent: 1, expected: "0.1% 미만" },
    { spent: 0, expected: "0%" },
  ])("지출 $spent 원은 $expected 로 구분한다", async ({ spent, expected }) => {
    useAuthStore.setState({ journey: journey(35_000_000, spent) });
    await render();
    expect(summary("RECORDED SPEND").textContent).toContain(`기록 지출 (${expected})`);
  });

  it("총 예산 미입력은 비율·여유·초과로 해석하지 않는다", async () => {
    useAuthStore.setState({ journey: journey(0) });
    await render();
    expect(summary("RECORDED SPEND").textContent).toContain("총 예산 입력 전");
    expect(summary("REMAINING").textContent).toContain("계산 전");
    expect(summary("REMAINING").textContent).not.toMatch(/여유|%|예산 초과/);
  });

  it("초과 지출은 비율과 음수 차액을 그대로 보존한다", async () => {
    const saved = journey(100_000, 123_000);
    useAuthStore.setState({ journey: saved });
    await render();
    expect(summary("RECORDED SPEND").textContent).toContain("기록 지출 (123%)");
    expect(summary("REMAINING").textContent).toContain("-2.3만원");
    expect(summary("REMAINING").textContent).toContain("예산 초과");
    expect(useAuthStore.getState().journey).toEqual(saved);
  });

  it("고정 행과 커스텀 카드의 초소액 지출·배정 비중도 표시한다", async () => {
    const saved = journey();
    saved.progress = {
      studio: { category: "studio", status: "in_progress", budget: 5_000, spent: 1, payer: "bride_parents" },
      custom_small: { category: "custom_small", label: "작은 준비 기록", status: "in_progress", budget: 5_000, spent: 1, payer: "groom_parents" },
    };
    useAuthStore.setState({ journey: saved });
    await render();
    for (const label of ["웨딩 사진 촬영", "작은 준비 기록"]) {
      const row = container.querySelector(`button[title="${label} 예산 수정"]`)?.closest("div.group");
      expect(row, label).not.toBeNull();
      expect(row?.textContent).toContain("0.1% 미만");
      expect(row?.textContent).toContain("총예산의 0.1% 미만");
    }
    expect(container.textContent).toContain("0.1% 미만 기록");
    expect(useAuthStore.getState().journey).toEqual(saved);
  });

  it("개별 분담의 소액을 0%로 표시하지 않는다", async () => {
    const saved = journey();
    saved.progress = {
      venue: { category: "venue", status: "in_progress", spent: 10_000_000, payer: "couple" },
      studio: { category: "studio", status: "in_progress", spent: 1, payer: "bride_parents" },
    };
    useAuthStore.setState({ journey: saved });
    await render();
    const payer = [...container.querySelectorAll("span")].find(element => element.textContent === "예비 신부 가족")?.parentElement?.parentElement;
    expect(payer?.textContent).toContain("1원");
    expect(payer?.textContent).toContain("0.1% 미만");
  });

  it("분담 상세 네 칸은 긴 금액과 서로 다른 분담 이름을 각각 보존한다", async () => {
    const saved = journey(2_000_000_000);
    saved.progress = {
      venue: { category: "venue", status: "in_progress", spent: 987_654_321, payer: "couple" },
      studio: { category: "studio", status: "in_progress", spent: 22_170_001, payer: "bride_parents" },
      dress: { category: "dress", status: "in_progress", spent: 9_400_999, payer: "groom_parents" },
      makeup: { category: "makeup", status: "in_progress", spent: 123_001, payer: "both_parents" },
    };
    useAuthStore.setState({ journey: saved });
    await render();
    const rows = [
      { label: "두 사람", amount: "987,654,321원" },
      { label: "예비 신부 가족", amount: "22,170,001원" },
      { label: "예비 신랑 가족", amount: "9,400,999원" },
      { label: "두 가족", amount: "123,001원" },
    ];
    for (const { label, amount } of rows) {
      const payer = [...container.querySelectorAll("span")].find(element => element.textContent === label)?.parentElement?.parentElement;
      expect(payer?.textContent).toContain(amount);
      expect(rows.filter(other => other.amount !== amount).some(other => payer?.textContent?.includes(other.amount))).toBe(false);
    }
    expect(useAuthStore.getState().journey).toEqual(saved);
  });

  it("도넛의 총액·목록은 123,000원을 보존하고 내부 비중의 분모는 지출 합계다", async () => {
    const slices = [{ key: "a", label: "직접 입력한 지출", amount: 123_000 }];
    await render(<BudgetShareChart slices={slices} basis="spent" />);
    expect(container.textContent?.match(/123,000원/g)).toHaveLength(3);
    expect(container.querySelector("li")?.textContent).toContain("100%");
    expect(container.textContent).not.toContain("12만원");
    expect(slices).toEqual([{ key: "a", label: "직접 입력한 지출", amount: 123_000 }]);
  });

  it("묶인 기타 금액도 원 단위 합계를 그대로 표시한다", async () => {
    const slices = [...Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, label: `항목${i}`, amount: 1_000_000 })),
      { key: "rest1", label: "기타 원본1", amount: 123_001 }, { key: "rest2", label: "기타 원본2", amount: 50_000 }];
    await render(<BudgetShareChart slices={slices} basis="budget" />);
    const rows = [...container.querySelectorAll("li")];
    expect(rows).toHaveLength(8);
    expect(rows[7].textContent).toContain("기타 2개");
    expect(rows[7].textContent).toContain("173,001원");
    expect(container.textContent).toContain("배정 예산 7,173,001원");
  });

  it("분담 세 금액은 천원·1원까지 보존하고 기존 내부 비중을 유지한다", async () => {
    await render(<BudgetSideSplit brideSide={22_170_001} groomSide={9_400_999} shared={123_000} />);
    const rows = [...container.querySelectorAll("li")];
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining("22,170,001원"), expect.stringContaining("123,000원"), expect.stringContaining("9,400,999원"),
    ]);
    expect(rows[0].textContent).toContain("70%");
    expect(rows[1].textContent).toContain("1% 미만");
    expect(rows[2].textContent).toContain("30%");
    const widths = [...container.querySelectorAll<HTMLElement>("[data-side]")].map(element => Number.parseFloat(element.style.width));
    expect(widths.reduce((sum, number) => sum + number, 0)).toBeCloseTo(100, 8);
  });
});
