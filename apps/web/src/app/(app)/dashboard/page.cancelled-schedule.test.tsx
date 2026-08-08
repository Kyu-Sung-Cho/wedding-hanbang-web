// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

vi.mock("@/components/app/ServiceDashboardTutorial", () => ({ default: () => null }));
vi.mock("@/components/app/ServiceGuide", () => ({ default: () => null }));
vi.mock("@/components/app/WeeklyCard", () => ({ default: () => null }));
vi.mock("@/components/common/GuideOpenButton", () => ({ default: () => null }));
vi.mock("@/lib/care/requestProactiveCare", () => ({ requestProactiveCare: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const JOURNEY: WeddingJourney = {
  id: "40000000-0000-4000-8000-000000000001",
  couple_id: "20000000-0000-4000-8000-000000000001",
  wedding_date: "2027-06-20",
  venue: null,
  total_budget: 0,
  progress: ({
    __events: [
      {
        id: "cancelled-event",
        date: "2027-01-02",
        title: "취소된 상견례",
        status: "cancelled",
        cancellation: {
          cancelledAt: "2026-08-02T03:00:00.000Z",
          cancelledByProfileId: PROFILE_ID,
          reason: "가족 일정 변경",
        },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T03:00:00.000Z",
      },
      {
        id: "planned-event",
        date: "2027-01-03",
        title: "진행할 드레스 상담",
        status: "planned",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  } as unknown) as WeddingJourney["progress"],
  state_revision: 3,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-02T03:00:00.000Z",
};

describe("Dashboard cancelled schedule boundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  let originalState: ReturnType<typeof useAuthStore.getState>;

  beforeEach(() => {
    originalState = useAuthStore.getState();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({
      journey: JOURNEY,
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

  it("uses only planned events for next and upcoming schedule surfaces", async () => {
    await act(async () => root.render(<DashboardPage />));

    expect(container.textContent).toContain("진행할 드레스 상담");
    expect(container.textContent).not.toContain("취소된 상견례");
  });
});
