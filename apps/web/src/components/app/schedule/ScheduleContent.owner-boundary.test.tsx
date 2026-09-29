// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScheduleContent from "./ScheduleContent";
import BudgetContent from "../budget/BudgetContent";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ACTOR_A = "10000000-0000-4000-8000-000000000001";
const ACTOR_B = "10000000-0000-4000-8000-000000000002";
const COUPLE_A = "20000000-0000-4000-8000-000000000001";
const COUPLE_B = "20000000-0000-4000-8000-000000000002";
const REQUEST = "30000000-0000-4000-8000-000000000001";

function scope(actor = ACTOR_A, couple = COUPLE_A) {
  const journey: WeddingJourney = {
    id: couple, couple_id: couple, wedding_date: null, total_budget: 30_000_000,
    state_revision: 0, venue: null, progress: {},
    created_at: "2026-09-28T00:00:00.000Z", updated_at: "2026-09-28T00:00:00.000Z",
  };
  return {
    user: { id: actor, email: "synthetic@example.invalid" },
    profile: { id: actor, couple_id: couple, role: "bride", name: "합성 사용자" } as NonNullable<ReturnType<typeof useAuthStore.getState>["profile"]>,
    couple: { id: couple } as NonNullable<ReturnType<typeof useAuthStore.getState>["couple"]>,
    partner: null, journey, isDemo: false, isInitialized: true, isLoading: false,
  };
}

describe("schedule draft ownership with real components and auth store", () => {
  const original = useAuthStore.getState();
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();

  beforeEach(() => {
    useAuthStore.setState(scope());
    fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useAuthStore.setState(original);
    vi.unstubAllGlobals();
  });

  function button(label: string) {
    const found = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }

  async function fill(selector: string, text: string) {
    const input = container.querySelector<HTMLInputElement>(selector);
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function openSchedule(title: string) {
    await act(async () => button("일정 추가").click());
    await fill("#schedule-title", title);
    await fill("#schedule-date", "2027-05-01");
  }

  async function switchOwner(mode: "account" | "couple" | "roundtrip") {
    await act(async () => {
      useAuthStore.setState(mode === "couple" ? scope(ACTOR_A, COUPLE_B) : scope(ACTOR_B, COUPLE_B));
      if (mode === "roundtrip") useAuthStore.setState(scope());
    });
  }

  it.each(["account", "couple", "roundtrip"] as const)("discards a schedule draft across a %s change", async mode => {
    await act(async () => root.render(<ScheduleContent />));
    await openSchedule("이전 계정의 비공개 약속");
    await switchOwner(mode);

    expect(container.querySelector("#schedule-title")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await openSchedule("새 일정");
    expect(container.querySelector<HTMLInputElement>("#schedule-title")?.value).toBe("새 일정");
  });

  it.each(["account", "couple", "roundtrip"] as const)("budget already clears its draft across a %s change", async mode => {
    await act(async () => root.render(<BudgetContent />));
    await act(async () => button("새 항목 추가").click());
    await fill('input[placeholder="예: 웨딩카, 답례떡"]', "이전 계정의 예산");
    await switchOwner(mode);

    expect(container.querySelector('input[placeholder="예: 웨딩카, 답례떡"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not put an old save failure into the new owner's open schedule form", async () => {
    let resolveSave!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { resolveSave = resolve; }));
    await act(async () => root.render(<ScheduleContent />));
    await openSchedule("A의 약속");
    await act(async () => button("추가").click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await switchOwner("account");
    await openSchedule("B의 새 초안");
    await act(async () => resolveSave(new Response(JSON.stringify({
      status: "applied", requestId: REQUEST, journey: { ...scope().journey, state_revision: 1 },
    }), { status: 200 })));

    expect(container.querySelector<HTMLInputElement>("#schedule-title")?.value).toBe("B의 새 초안");
    expect(container.textContent).not.toContain("일정 변경을 저장하지 못했어요");
    expect(container.textContent).not.toContain("일정을 저장하지 못했어요");
    expect(useAuthStore.getState().journey?.couple_id).toBe(COUPLE_B);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
