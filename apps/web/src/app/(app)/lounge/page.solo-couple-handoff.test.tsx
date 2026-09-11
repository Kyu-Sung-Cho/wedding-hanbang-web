// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoungePage, { getUpcomingEvents } from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Couple, Profile, ProgressItem, WeddingJourney } from "@/types/database.types";

vi.mock("@/components/app/WeeklyCard", () => ({ default: () => null }));
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

describe("Live lounge solo, couple, and joined handoff", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: Pick<
    ReturnType<typeof useAuthStore.getState>,
    "user" | "profile" | "journey" | "isDemo" | "partner" | "couple"
  >;

  beforeEach(() => {
    const state = useAuthStore.getState();
    originalState = {
      user: state.user,
      profile: state.profile,
      journey: state.journey,
      isDemo: state.isDemo,
      partner: state.partner,
      couple: state.couple,
    };
    window.history.replaceState(null, "", "/wedding/lounge");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({
      user: { id: "10000000-0000-4000-8000-000000000001", email: "me@example.com" },
      profile: {
        id: COUPLE.bride_id!, name: "준비자", role: "bride", couple_id: COUPLE.id,
        avatar_url: null, onboarding_completed: false, onboarding_step: 0, is_admin: false,
        created_at: COUPLE.created_at, updated_at: COUPLE.updated_at,
      },
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
  });

  it("treats solo preparation as a complete way to use the lounge", async () => {
    await act(async () => {
      root.render(<LoungePage />);
    });

    expect(container.textContent).toContain("나의 웨딩 라운지");
    expect(container.textContent).toContain("혼자 준비 중");
    expect(container.textContent).toContain("파트너 초대는 나중에 해도 괜찮아요");
    expect(container.textContent).not.toContain("커플 연결 대기 중");

    const link = findLink(container, "오늘 한 가지 시작하기");
    expect(new URL(link.href).searchParams.get("prefill")).toContain(
      "오늘 제가 먼저 해야 할 일 한 가지만",
    );
  });

  it("gives connected partners a joint prompt without deciding owners", async () => {
    useAuthStore.setState({ partner: PARTNER });

    await act(async () => {
      root.render(<LoungePage />);
    });

    expect(container.textContent).toContain("우리 둘의 웨딩 라운지");
    expect(container.textContent).toContain("함께 준비 중");

    const link = findLink(container, "오늘 할 일 같이 나누기");
    const prompt = new URL(link.href).searchParams.get("prefill");
    expect(prompt).toContain("같이 볼 것과 나눠 맡아도 되는 일");
    expect(prompt).toContain("담당자는 정하지 말고");
  });

  it("shows and dismisses a read-only handoff for a newly joined partner", async () => {
    window.history.replaceState(null, "", "/wedding/lounge?joined=1");
    useAuthStore.setState({ partner: PARTNER });

    await act(async () => {
      root.render(<LoungePage />);
    });

    const handoff = container.querySelector<HTMLElement>(
      '[data-testid="joined-plan-handoff"]',
    );
    expect(handoff?.textContent).toContain("이제 이 계획을 함께 봐요");
    expect(handoff?.textContent).toContain("2026년 12월 20일");
    expect(handoff?.textContent).toContain("라온제나 강남");
    expect(handoff?.textContent).toContain("3,000만원");
    expect(handoff?.textContent).toContain("새로 저장하거나 변경한 내용은 없어요");

    const amoraLink = findLink(handoff as HTMLElement, "함께 확인할 내용 찾기");
    expect(new URL(amoraLink.href).searchParams.get("prefill")).toContain(
      "변경하거나 담당자를 정하지 말고",
    );

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

describe("lounge upcoming schedule truth", () => {
  it("excludes cancelled events even when their date is the nearest", () => {
    const result = getUpcomingEvents({
      __events: [
        {
          id: "evt_cancelled",
          date: "2099-01-01",
          title: "취소된 상담",
          status: "cancelled",
          cancellation: {
            cancelledAt: "2026-08-02T01:00:00.000Z",
            cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
          },
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-02T01:00:00.000Z",
        },
        {
          id: "evt_planned",
          date: "2099-01-02",
          title: "진행할 상담",
          status: "planned",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    } as unknown as Record<string, ProgressItem>);

    expect(result.map((event) => event.id)).toEqual(["evt_planned"]);
  });
});
