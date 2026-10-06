// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoungePage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Profile, ScheduleEvent, WeddingJourney } from "@/types/database.types";

const communityExposure = vi.hoisted(() => ({ enabled: undefined as boolean | undefined }));
vi.mock("@/lib/features/signedInCommunity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features/signedInCommunity")>();
  return { get SHOW_SIGNED_IN_COMMUNITY() { return communityExposure.enabled ?? actual.SHOW_SIGNED_IN_COMMUNITY; } };
});

vi.mock("@/components/app/amora-missions/AmoraMissions", () => ({ default: () => <h2 id="today-missions-title">오늘의 미션</h2> }));
vi.mock("@/components/app/FirstRunLoungeTutorial", () => ({ default: () => null }));
vi.mock("@/components/app/DailyAmoraFocusBridge", () => ({ default: () => null }));
vi.mock("@/lib/care/requestProactiveCare", () => ({ requestProactiveCare: vi.fn() }));

const profile: Profile = {
  id: "summary-user", couple_id: "summary-couple", name: "준비자", role: "bride",
  avatar_url: null, onboarding_completed: false, onboarding_step: 0, is_admin: false,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};
function makeJourney(overrides: Partial<WeddingJourney> = {}): WeddingJourney {
  return { id: "summary-journey", couple_id: profile.couple_id!, wedding_date: "2026-12-20", venue: null,
    total_budget: 35_000_000, progress: { venue: { status: "in_progress", spent: 123_000 } },
    state_revision: 3, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", ...overrides };
}

describe("라운지의 저장값 요약과 조회 실패 구분", () => {
  let container: HTMLDivElement;
  let root: Root;
  let original: ReturnType<typeof useAuthStore.getState>;
  const fetchMock = vi.fn();
  beforeEach(() => {
    communityExposure.enabled = undefined;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T03:00:00Z"));
    original = useAuthStore.getState();
    useAuthStore.setState({ user: { id: profile.id, email: "summary@example.invalid" }, profile,
      journey: makeJourney(), isInitialized: true, isLoading: false, isDemo: false, partner: null, couple: null });
    fetchMock.mockImplementation(async (url: string) => Response.json(url.startsWith("/api/community/posts") ? { posts: [] } : { room: null }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/wedding/lounge");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); useAuthStore.setState(original);
    fetchMock.mockReset(); vi.unstubAllGlobals(); vi.useRealTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });
  async function render(journey = makeJourney()) {
    await act(async () => { useAuthStore.setState({ journey }); root.render(<LoungePage />); });
  }

  it("초기 라운지는 커뮤니티를 표시하거나 조회하지 않고 웨딩코드와 견적 도구를 연다", async () => {
    await render();
    expect(container.textContent).not.toContain("참고한 자료와 같은 시기 준비 이야기");
    expect(container.querySelector('a[href="/wedding/community/cohort"]')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/community/"))).toHaveLength(0);
    const weddingCode = container.querySelector('[data-lounge-preparation-style]')!;
    expect(weddingCode.querySelector("h2")?.textContent).toBe("웨딩코드");
    expect(weddingCode.querySelector('a[href="/wedding/preparation-style"]')?.textContent).toBe("웨딩코드 보기");
    // 기본 흐름은 동의·취향 23문항 뒤에 우선순위 한 화면을 더 묻는다(v31Flow V31_CORE_SCREEN_INDEXES).
    expect(weddingCode.textContent).toContain("기본 24문항으로 결과를 보고, 궁금하면 8문항을 더 답할 수 있어요.");
    expect(weddingCode.textContent).toContain("이 브라우저에 저장한 답");
    expect(weddingCode.textContent).toContain("내 답이 담긴 링크");
    expect(container.querySelector('a[href="/wedding/community/quote-check"]')).not.toBeNull();
  });

  it("계정·커플 전환 중 이전 계획의 이름과 체크 내용을 새 허브에 노출하지 않는다", async () => {
    await render(makeJourney({ couple_id: "previous-couple", venue: "이전 커플의 장소", progress: { venue: { status: "in_progress", checklist: [{ id: "private", label: "이전 커플의 확인 내용", done: false }], budget: 990_001 } } }));
    expect(container.textContent).not.toContain("이전 커플의 장소");
    expect(container.textContent).not.toContain("이전 커플의 확인 내용");
    expect(container.textContent).not.toContain("99만1원");
    expect(container.querySelector('#today-missions')?.textContent).toContain("현재 계정의 계획을 확인하면");
  });

  it("만원 아래 지출과 작은 비율을 보존하고 지출만으로 예산이 안정적이라고 판정하지 않는다", async () => {
    const journey = makeJourney(); await render(journey);
    const summary = container.querySelector('section[aria-label="현재 준비 현황"]')!;
    expect(summary.textContent).toContain("12만3,000원");
    expect(summary.textContent).toContain("약 0.4%");
    const budget = [...container.querySelectorAll("section")].find(section => section.querySelector("h2")?.textContent === "기록 지출 현황")!;
    expect(budget.textContent).toContain("3,487만7,000원");
    expect(budget.textContent).toContain("지출 기록을 뺀 금액");
    expect(budget.textContent).not.toMatch(/안정|남은 예산|한도 도달/);
    expect(useAuthStore.getState().journey).toEqual(journey);
  });

  it.each([
    { date: null, budget: 35_000_000, wanted: "결혼식 날짜를 입력", unwanted: "총 예산을 입력", href: "/wedding/settings" },
    { date: "2026-12-20", budget: 0, wanted: "총 예산을 입력", unwanted: "결혼식 날짜를 입력", href: "/wedding/budget" },
  ])("없는 기본 정보만 안내한다: 날짜 $date / 예산 $budget", async ({ date, budget, wanted, unwanted, href }) => {
    await render(makeJourney({ wedding_date: date, total_budget: budget }));
    const summary = container.querySelector('section[aria-label="현재 준비 현황"]')!;
    expect(summary.textContent).toContain(wanted);
    expect(summary.textContent).not.toContain(unwanted);
    expect(summary.querySelector(`a[href="${href}"]`)).not.toBeNull();
  });

  it("날짜와 예산 모두 미정이면 두 입력 경로를 제공하고 값이 채워지면 안내를 접는다", async () => {
    await render(makeJourney({ wedding_date: null, total_budget: 0 }));
    let summary = container.querySelector('section[aria-label="현재 준비 현황"]')!;
    expect(summary.querySelector('a[href="/wedding/settings"]')).not.toBeNull();
    expect(summary.querySelector('a[href="/wedding/budget"]')).not.toBeNull();
    await render();
    summary = container.querySelector('section[aria-label="현재 준비 현황"]')!;
    expect(summary.textContent).not.toMatch(/결혼식 날짜를 입력|총 예산을 입력/);
  });

  it("일반 예정 일정을 예약으로 단정하지 않고 저장 시간과 시간 미정을 구분한다", async () => {
    const event: ScheduleEvent = { id: "schedule-1", title: "둘이 예산 확인", date: "2026-09-14", time: "19:45", categoryKey: "etc", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };
    const withoutTime = { ...event, id: "schedule-2", title: "추가 논의", time: undefined };
    const journey = makeJourney(); Object.assign(journey.progress, { __events: [event, withoutTime] });
    await render(journey);
    const schedule = [...container.querySelectorAll("section")].find(section => section.querySelector("h2")?.textContent === "다가오는 일정");
    expect(schedule).toBeDefined(); expect(schedule?.textContent).toContain("19:45"); expect(schedule?.textContent).toContain("시간 미정");
    expect(schedule?.textContent).not.toContain("예약"); expect(useAuthStore.getState().journey).toEqual(journey);
  });

  it("자료 조회 실패는 접힌 자료 안에서 알리고 재시도 성공 후에만 빈 상태를 표시한다", async () => {
    communityExposure.enabled = true;
    let fail = true;
    fetchMock.mockImplementation(async (url: string) => fail ? new Response(null, { status: 503 }) : Response.json(url.startsWith("/api/community/posts") ? { posts: [] } : { room: null }));
    await render();
    const details = [...container.querySelectorAll("details")].find(item => item.querySelector("summary")?.textContent?.includes("참고한 자료"))!;
    expect(details.open).toBe(false);
    expect(details.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(details.textContent).not.toMatch(/아직 저장한 글이 없어요|동기방이 아직 연결되지 않았어요/);
    fail = false;
    const retries = [...details.querySelectorAll<HTMLButtonElement>("button")];
    expect(retries).toHaveLength(2);
    await act(async () => { retries.forEach(button => button.click()); });
    expect(details.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(details.textContent).toContain("아직 저장한 글이 없어요");
    expect(details.textContent).toContain("동기방이 아직 연결되지 않았어요");
    expect(fetchMock.mock.calls).toHaveLength(4);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("동기방 연결 조회가 성공하고 요약만 실패하면 연결을 지우지 않고 요약 재시도를 제공한다", async () => {
    communityExposure.enabled = true;
    let failDigest = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/community/posts")) return Response.json({ posts: [] });
      if (url.includes("/digest?")) return failDigest ? new Response(null, { status: 503 }) : Response.json({ lead: "요약 확인 완료", topicBreakdown: [], highlights: [] });
      return Response.json({ room: { id: "cohort-1", name: "연결된 동기방", member_count: 2 }, lastMessage: null });
    });
    await render();
    expect(container.textContent).toContain("연결된 동기방");
    expect(container.textContent).not.toContain("동기방이 아직 연결되지 않았어요");
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("요약을 불러오지 못했어요");
    failDigest = false;
    await act(async () => alert?.querySelector<HTMLButtonElement>("button")?.click());
    expect(container.textContent).toContain("요약 확인 완료");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("preserves February 20 in summary and upcoming schedule",async()=>{
    const event:ScheduleEvent={id:"same-date",title:"Calendar date regression",date:"2027-02-20",time:"14:00",createdAt:"2026-09-01T00:00:00Z",updatedAt:"2026-09-01T00:00:00Z"};
    const journey=makeJourney({wedding_date:"2027-02-20"});Object.assign(journey.progress,{__events:[event]});await render(journey);
    const summary=container.querySelector('section[aria-label="현재 준비 현황"]')!;
    const upcoming=[...container.querySelectorAll("section")].find(section=>section.querySelector("h2")?.textContent==="다가오는 일정")!;
    expect(summary.textContent).toContain("2월 20일");expect(summary.textContent).toMatch(/2월 20일.*토/);expect(upcoming.textContent).toContain("2월 20일");expect(upcoming.textContent).toMatch(/2월 20일.*토/);expect(container.textContent).not.toContain("2월 19일");expect(useAuthStore.getState().journey).toEqual(journey);
  });

});
