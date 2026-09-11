// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { useAuthStore } from "@/stores/authStore";
import type { Profile, ProgressItem, WeddingJourney } from "@/types/database.types";
import LoungePage from "./page";

vi.mock("@/components/app/amora-missions/AmoraMissions", () => ({ default: () => <h2 id="today-missions-title">오늘의 미션</h2> }));
vi.mock("@/components/app/FirstRunLoungeTutorial", () => ({ default: () => null }));
vi.mock("@/components/app/DailyAmoraFocusBridge", () => ({ default: () => null }));
vi.mock("@/lib/care/requestProactiveCare", () => ({ requestProactiveCare: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile = { id: "10000000-0000-4000-8000-000000000002", couple_id: "20000000-0000-4000-8000-000000000002", name: "준비자", role: "bride", onboarding_completed: true } as Profile;

function progressExceptVenue(status: ProgressItem["status"] = "in_progress"): Record<string, ProgressItem> {
  return Object.fromEntries(CATEGORY_CHECKLISTS.map(category => [category.key, {
    category: category.key, status: category.key === "venue" ? status : "completed",
  }]));
}

describe("라운지 미션 위 기본 확인 시점 안내", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: ReturnType<typeof useAuthStore.getState>;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T03:00:00Z"));
    vi.stubGlobal("fetch", fetchMock);
    originalState = useAuthStore.getState();
    useAuthStore.setState({ user: { id: profile.id, email: "qa@example.invalid" }, profile, isDemo: true, partner: null, couple: null });
    window.history.replaceState(null, "", "/wedding/lounge");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(originalState);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fetchMock.mockReset();
  });

  async function render(weddingDate: string | null, progress = progressExceptVenue()) {
    const journey: WeddingJourney = {
      id: "40000000-0000-4000-8000-000000000002", couple_id: profile.couple_id!,
      wedding_date: weddingDate, venue: null, total_budget: 30_000_000, progress, state_revision: 7,
      created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
    };
    await act(async () => { useAuthStore.setState({ journey }); root.render(<LoungePage />); });
    return journey;
  }

  it("기본 확인 시점 10일 전인 분야를 미션 위에 한 번만 안내하고 해당 체크리스트로 연결한다", async () => {
    const journey = await render("2027-06-17");
    const note = container.querySelector<HTMLElement>('[aria-label="기본 확인 시점 안내"]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("기본 확인 시점까지 10일");
    expect(note?.textContent).toContain("실제 일정·완료 여부를 확인해 주세요");
    expect(note?.textContent).not.toMatch(/계약 마감|미완료 확정/);
    const link = note?.closest("article")?.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("href")).toBe("/wedding/checklist?category=venue");
    expect(container.querySelectorAll('[aria-label="기본 확인 시점 안내"]')).toHaveLength(1);
    const missionHeading = container.querySelector("#lounge-priority-title");
    expect(note && missionHeading && (missionHeading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link?.addEventListener("click", event => event.preventDefault(), { once: true });
    await act(async () => { link?.dispatchEvent(click); });
    expect(useAuthStore.getState().journey).toEqual(journey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("기본 확인 시점이 지난 경우에도 실제 계약 지연이나 미완료를 단정하지 않는다", async () => {
    await render("2027-06-04");
    const note = container.querySelector('[aria-label="기본 확인 시점 안내"]');
    expect(note?.textContent).toContain("기본 확인 시점에서 3일 지남");
    expect(note?.textContent).toContain("실제 일정·완료 여부를 확인해 주세요");
    expect(note?.textContent).not.toMatch(/계약 마감|지연됐|늦었|일 초과/);
  });

  it.each(["completed", "not_applicable"] as const)("%s로 표시한 분야는 임박해도 안내하지 않는다", async status => {
    await render("2027-06-17", progressExceptVenue(status));
    expect(container.querySelector('[aria-label="기본 확인 시점 안내"]')).toBeNull();
  });

  it.each([null, "invalid", "2028-01-01"])("날짜가 미정·무효이거나 기본 확인 시점이 멀면 안내를 만들지 않는다: %s", async date => {
    await render(date);
    expect(container.querySelector('[aria-label="기본 확인 시점 안내"]')).toBeNull();
  });

  it("완료 상태를 직접 바꾸면 이전 안내를 제거한다", async () => {
    await render("2027-06-17");
    expect(container.querySelector('[aria-label="기본 확인 시점 안내"]')).not.toBeNull();
    await render("2027-06-17", progressExceptVenue("completed"));
    expect(container.querySelector('[aria-label="기본 확인 시점 안내"]')).toBeNull();
  });
});
