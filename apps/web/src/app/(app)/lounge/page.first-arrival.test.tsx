// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoungePage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Couple, Profile, WeddingJourney } from "@/types/database.types";

vi.mock("@/components/app/WeeklyCard", () => ({ default: () => null }));
vi.mock("@/lib/care/requestProactiveCare", () => ({
  requestProactiveCare: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const COUPLE: Couple = {
  id: "20000000-0000-4000-8000-000000000002",
  invite_code: "WH-ABC124",
  bride_id: "10000000-0000-4000-8000-000000000002",
  groom_id: null,
  membership_sealed_at: null,
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

const PROFILE = {
  id: "10000000-0000-4000-8000-000000000002",
  name: "지은",
  role: "bride",
  couple_id: COUPLE.id,
  onboarding_completed: true,
} as unknown as Profile;

/** 온보딩만 끝낸 상태 — 단계와 분위기만 있고 커플이 만든 데이터는 아직 없다. */
const EMPTY_JOURNEY: WeddingJourney = {
  id: "40000000-0000-4000-8000-000000000002",
  couple_id: COUPLE.id,
  wedding_date: "2026-12-20",
  venue: null,
  total_budget: 0,
  progress: {
    __stage: "venue_booked",
    __preferences: { weddingStyle: "natural" },
  } as unknown as WeddingJourney["progress"],
  state_revision: 0,
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

describe("웨딩 라운지 첫 도착", () => {
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
      user: { id: PROFILE.id, email: "me@example.com" },
      profile: PROFILE,
      journey: EMPTY_JOURNEY,
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

  it("데이터가 없으면 방금 말한 것을 되읽고 다음 걸음 하나를 세운다", async () => {
    await act(async () => {
      root.render(<LoungePage />);
    });

    const card = container.querySelector<HTMLElement>(
      '[data-testid="lounge-first-arrival"]',
    );
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("말씀해주신 내용이에요");
    expect(card?.textContent).toContain("12월 20일");
    // ISO 원문을 그대로 되읽지 않는다.
    expect(card?.textContent).not.toContain("2026-12-20");
    expect(card?.textContent).toContain("결혼식장을 계약했어요");
    expect(card?.textContent).toContain("편안한 분위기");
    expect(card?.textContent).toContain("다음 걸음 하나");
    expect(card?.textContent).toContain("체크리스트 열기");

    // 왜 비어 있는지도 빈 위젯 옆에서 말한다.
    expect(
      container.querySelector('[data-testid="lounge-first-arrival-empty-note"]')
        ?.textContent,
    ).toContain("두 분이 확인한 것만 쌓여요");
  });

  it("진척을 지어내거나 판정하지 않는다", async () => {
    await act(async () => {
      root.render(<LoungePage />);
    });

    const card = container.querySelector<HTMLElement>(
      '[data-testid="lounge-first-arrival"]',
    );
    expect(card?.textContent).not.toContain("늦");
    expect(card?.textContent).not.toContain("추천");
    expect(card?.textContent).not.toMatch(/\d+만원/);
  });

  it.each([false, true])("모두 미정이면 중복 카드 없이 허브와 시작 경로를 유지한다 (파트너 연결: %s)", async (linked) => {
    useAuthStore.setState({
      journey: { ...EMPTY_JOURNEY, wedding_date: null, progress: {} },
      partner: linked ? { ...PROFILE, id: "10000000-0000-4000-8000-000000000003", name: "민수" } : null,
    });
    await act(async () => { root.render(<LoungePage />); });

    expect(container.querySelector('[data-testid="lounge-first-arrival"]')).toBeNull();
    expect(container.querySelector('[data-testid="lounge-first-arrival-empty-note"]')).toBeNull();
    expect(container.textContent).not.toMatch(/말씀해주신 내용이에요|다음 걸음 하나|무엇부터 할지 같이 정해요/);
    const hub = container.querySelector('section[aria-label="현재 준비 현황"]');
    expect(hub).not.toBeNull();
    expect(hub?.textContent).toContain("날짜 미정");
    expect(hub?.querySelector('[data-tutorial-target="amora-fab"]')?.getAttribute("href")).toMatch(/^\/wedding\/chat\?prefill=/);
    expect(hub?.querySelector('[data-tutorial-target="lounge-invite"]')?.getAttribute("href") ?? null).toBe(linked ? null : "/wedding/settings");
    expect(container.querySelector('[data-tutorial-target="lounge-tools"] a[href="/wedding/budget"]')).not.toBeNull();
  });

  it("커플이 무언가 남기는 순간 저절로 사라진다", async () => {
    useAuthStore.setState({
      journey: {
        ...EMPTY_JOURNEY,
        total_budget: 30_000_000,
        progress: {
          ...EMPTY_JOURNEY.progress,
          venue: { category: "venue", status: "in_progress" },
        } as unknown as WeddingJourney["progress"],
      },
    });

    await act(async () => {
      root.render(<LoungePage />);
    });

    expect(container.querySelector('[data-testid="lounge-first-arrival"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="lounge-first-arrival-empty-note"]'),
    ).toBeNull();
  });

  it("온보딩이 채워준 제안값을 그대로 저장한 커플도 첫 도착 화면을 본다", async () => {
    // 온보딩의 "저장하고 시작하기"는 고른 단계의 제안값을 그대로 couples.progress에
    // 보낸다(buildOnboardingProgress). 그 값이 있다는 것만으로 "만든 데이터"로 세면
    // just_started가 아닌 단계를 고른 사람 — 5개 중 4개 — 이 이 화면을 한 번도 못 본다.
    useAuthStore.setState({
      journey: {
        ...EMPTY_JOURNEY,
        progress: {
          ...EMPTY_JOURNEY.progress,
          venue: { status: "completed" },
          meeting: { status: "completed" },
        } as unknown as WeddingJourney["progress"],
      },
    });

    await act(async () => {
      root.render(<LoungePage />);
    });

    expect(container.querySelector('[data-testid="lounge-first-arrival"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="lounge-first-arrival-empty-note"]'),
    ).not.toBeNull();
    // 안내의 초대 단계가 짚는 앵커도 그 카드 안에 있으므로 함께 살아난다.
    expect(container.querySelector('[data-tutorial-target="lounge-invite"]')).not.toBeNull();
  });

  it("첫 실행 안내가 짚을 앵커와 실제 아모라 진입 링크가 남아 있다", async () => {
    await act(async () => {
      root.render(<LoungePage />);
    });

    for (const target of ["lounge-focus", "lounge-tools", "lounge-invite", "amora-fab"]) {
      expect(
        container.querySelector(`[data-tutorial-target="${target}"]`),
      ).not.toBeNull();
    }
  });

  it("허브의 단계와 피드를 한 번씩 배치하고 공유 할 일·예산·일정 도구를 유지한다", async () => {
    await act(async () => { root.render(<LoungePage />); });
    const missions = container.querySelectorAll('#today-missions[data-tutorial-target="lounge-focus"]');
    expect(missions).toHaveLength(1);
    expect(missions[0].getAttribute("aria-labelledby")).toBe("lounge-priority-title");
    expect(missions[0].querySelector("#lounge-priority-title")?.textContent).toBe("오늘 먼저 확인할 준비");
    expect(container.querySelectorAll('section[aria-label="결혼 준비 단계"] a')).toHaveLength(5);
    expect(container.querySelectorAll('button[aria-label$="단계 보기"]')).toHaveLength(0);
    expect(container.querySelectorAll('#lounge-shared-missions')).toHaveLength(1);
    expect(container.querySelector('[data-tutorial-target="amora-fab"]')?.getAttribute("href")).toMatch(/^\/wedding\/chat\?prefill=/);
    expect(container.querySelectorAll('#daily-amora-focus-title')).toHaveLength(1);
    expect(container.textContent).not.toMatch(/지금 먼저 볼 것|놓치기 쉬운 항목/);
    expect(container.querySelector('[data-tutorial-target="lounge-tools"] a[href="/wedding/budget"]')).not.toBeNull();
    expect(container.querySelector('[data-tutorial-target="lounge-tools"] a[href="/wedding/schedule"]')).not.toBeNull();
  });
});
