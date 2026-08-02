// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

vi.mock("@/components/app/ServiceDashboardTutorial", () => ({
  default: () => null,
}));
vi.mock("@/components/app/ServiceGuide", () => ({ default: () => null }));
vi.mock("@/components/app/WeeklyCard", () => ({ default: () => null }));
vi.mock("@/components/common/GuideOpenButton", () => ({ default: () => null }));
vi.mock("@/lib/care/requestProactiveCare", () => ({
  requestProactiveCare: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const JOURNEY_WITHOUT_TOTAL_BUDGET: WeddingJourney = {
  id: "10000000-0000-4000-8000-000000000001",
  couple_id: "20000000-0000-4000-8000-000000000001",
  wedding_date: null,
  venue: null,
  total_budget: 0,
  progress: {
    venue: {
      status: "in_progress",
      spent: 1_000_000,
    },
  },
  state_revision: 0,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

describe("Dashboard total-budget trust boundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: Pick<
    ReturnType<typeof useAuthStore.getState>,
    "journey" | "isDemo" | "partner" | "couple"
  >;

  beforeEach(() => {
    const state = useAuthStore.getState();
    originalState = {
      journey: state.journey,
      isDemo: state.isDemo,
      partner: state.partner,
      couple: state.couple,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({
      journey: JOURNEY_WITHOUT_TOTAL_BUDGET,
      isDemo: true,
      partner: null,
      couple: null,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(originalState);
    document.body.replaceChildren();
  });

  it("shows an unset total honestly even when recorded spending exists", async () => {
    await act(async () => {
      root.render(<DashboardPage />);
    });

    expect(container.textContent).toContain("기록 지출 비율미입력");
    expect(container.textContent).toContain(
      "기록 지출 100만원 · 총 예산 입력 전",
    );
    expect(container.textContent).toContain("계산 전");
    expect(container.textContent).toContain("총 예산 미입력");
    expect(container.textContent).not.toContain("총 예산 0만원");
  });
});
