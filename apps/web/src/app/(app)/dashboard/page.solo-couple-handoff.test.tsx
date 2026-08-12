// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Couple, Profile, WeddingJourney } from "@/types/database.types";

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

const COUPLE: Couple = {
  id: "20000000-0000-4000-8000-000000000001",
  invite_code: "WH-ABC123",
  bride_id: "10000000-0000-4000-8000-000000000001",
  groom_id: null,
  membership_sealed_at: null,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

const PARTNER: Pick<Profile, "id" | "name" | "role" | "couple_id"> = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "민서",
  role: "groom",
  couple_id: COUPLE.id,
};

const JOURNEY: WeddingJourney = {
  id: "40000000-0000-4000-8000-000000000001",
  couple_id: COUPLE.id,
  wedding_date: "2026-12-20",
  venue: "라온제나 강남",
  total_budget: 30_000_000,
  progress: {
    venue: {
      category: "venue",
      status: "completed",
      spent: 10_000_000,
    },
  },
  state_revision: 0,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
};

function findLink(container: HTMLElement, label: string) {
  const link = Array.from(container.querySelectorAll("a")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error(`${label} 링크를 찾지 못했습니다.`);
  }
  return link;
}

describe("Dashboard solo, couple, and joined handoff", () => {
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
    window.history.replaceState(null, "", "/wedding/lounge");
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({
      journey: JOURNEY,
      isDemo: true,
      partner: null,
      couple: COUPLE,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(originalState);
    document.body.replaceChildren();
    sessionStorage.clear();
  });

  it("welcomes a solo planner and prefills one manageable next action", async () => {
    await act(async () => {
      root.render(<DashboardPage />);
    });

    expect(container.textContent).toContain("나의 웨딩 라운지");
    expect(container.textContent).toContain("혼자 준비 중");
    expect(container.textContent).toContain("파트너 초대는 나중에 해도 괜찮아요");

    const link = findLink(container, "아모라에게 다음 할 일 묻기");
    const destination = new URL(link.href);
    expect(destination.pathname).toBe("/wedding/chat");
    expect(destination.searchParams.get("prefill")).toContain(
      "오늘 혼자 할 수 있는 다음 행동 한 가지만",
    );
  });

  it("keeps a legacy status-only completed category in the next-work list", async () => {
    await act(async () => {
      root.render(<DashboardPage />);
    });

    const venue = container.querySelector('[data-testid="next-category-venue"]');
    expect(venue).not.toBeNull();
    expect(venue?.textContent).toContain("0/");
    expect(venue?.textContent).toContain("직접 체크");
    expect(venue?.textContent).toContain("예정");
  });

  it("welcomes connected partners and leaves owner selection to them", async () => {
    useAuthStore.setState({ partner: PARTNER });

    await act(async () => {
      root.render(<DashboardPage />);
    });

    expect(container.textContent).toContain("우리 둘의 웨딩 라운지");
    expect(container.textContent).toContain("함께 준비 중");

    const link = findLink(container, "아모라와 같이 점검하기");
    const prompt = new URL(link.href).searchParams.get("prefill");
    expect(prompt).toContain("같이 확인할 한 가지");
    expect(prompt).toContain("나눠 할 수 있는 일 한 가지");
    expect(prompt).toContain("담당자는 정하지 말고");
  });

  it("shows the joined partner the existing shared plan without writing it again", async () => {
    window.history.replaceState(null, "", "/wedding/lounge?joined=1");
    useAuthStore.setState({ partner: PARTNER });

    await act(async () => {
      root.render(<DashboardPage />);
    });

    const handoff = container.querySelector('[data-testid="joined-plan-handoff"]');
    expect(handoff?.textContent).toContain("이제 이 계획을 함께 봐요");
    expect(handoff?.textContent).toContain("2026년 12월 20일");
    expect(handoff?.textContent).toContain("라온제나 강남");
    expect(handoff?.textContent).toContain("3,000만원");
    expect(handoff?.textContent).toMatch(/준비 진행\d+%/);
    expect(handoff?.textContent).toContain(
      "새로 저장하거나 변경한 내용은 없어요",
    );

    const amoraLink = findLink(handoff as HTMLElement, "함께 확인할 내용 찾기");
    const prompt = new URL(amoraLink.href).searchParams.get("prefill");
    expect(prompt).toContain("둘이 먼저 확인할 부분");
    expect(prompt).toContain("변경하거나 담당자를 정하지 말고");

    const dismiss = Array.from(handoff?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("이 내용 확인했어요"),
    );
    if (!(dismiss instanceof HTMLButtonElement)) {
      throw new Error("인계 카드 닫기 버튼을 찾지 못했습니다.");
    }
    await act(async () => {
      dismiss.click();
    });

    expect(container.querySelector('[data-testid="joined-plan-handoff"]')).toBeNull();
    expect(window.location.search).toBe("");
  });
});
