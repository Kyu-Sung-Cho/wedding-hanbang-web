import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import BudgetContent from "../BudgetContent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("BudgetContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAuthStore.setState({ journey: null, isDemo: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderBudget(): string {
    act(() => root.render(<BudgetContent />));
    return container.innerHTML;
  }

  it("shows an undecided total instead of inventing a 2,000만원 budget", () => {
    const html = renderBudget();

    expect(html).toContain("미입력");
    expect(html).not.toContain(">2,000<");
  });

  it("does not present legacy spending as remaining budget or an overrun", () => {
    useAuthStore.setState({
      journey: {
        id: "journey-1",
        couple_id: "couple-1",
        wedding_date: null,
        venue: null,
        total_budget: 30_000_000,
        progress: {
          venue: { category: "venue", status: "in_progress", spent: 35_000_000 },
        },
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z",
      },
    });

    const html = renderBudget();
    expect(html).toContain("합계에서 제외");
    expect(html).not.toMatch(/남은 예산|초과 금액|117%/);
  });

  it("presents public prices as references and Amora as an organizer, not an adequacy judge", () => {
    const html = renderBudget();

    expect(html).toContain("공식 조사 자료의 범위 확인");
    expect(html).toContain("견적을 평가하거나 계약을 중개하지 않습니다");
    expect(html).not.toMatch(/시세 대비 내 예산 확인|카테고리별 시세 배지 표시 중|AI 예산 분석|이 예산, 적정한가요/);
  });
});
