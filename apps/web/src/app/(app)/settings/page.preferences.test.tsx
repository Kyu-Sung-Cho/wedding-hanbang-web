// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://hanbang.ai/wedding/settings" }

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";
import { useAuthStore, type JourneyUpdateResult } from "@/stores/authStore";
import type { Profile, WeddingJourney } from "@/types/database.types";

vi.mock("@/components/app/TodayOnePreferenceControl", () => ({ default: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ACTOR = "10000000-0000-4000-8000-000000000001";
const COUPLE = "20000000-0000-4000-8000-000000000001";
const DATE = "2026-10-18T00:00:00Z";
const profile: Profile = {
  id: ACTOR, name: "가상 설정 계정", role: null, confirmed_role: null,
  couple_id: COUPLE, avatar_url: null, onboarding_completed: true,
  onboarding_step: 0, is_admin: false, created_at: DATE, updated_at: DATE,
};
const initialJourney: WeddingJourney = {
  id: "30000000-0000-4000-8000-000000000001", couple_id: COUPLE,
  wedding_date: null, venue: null, total_budget: 33_000_000,
  progress: { studio: { category: "studio", status: "not_started" } },
  state_revision: 1, created_at: DATE, updated_at: DATE,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("settings preference saves", () => {
  let original: ReturnType<typeof useAuthStore.getState>;
  let root: Root;
  let container: HTMLDivElement;
  let serverJourney: WeddingJourney;
  const updateJourney = vi.fn<ReturnType<typeof useAuthStore.getState>["updateJourney"]>();

  beforeEach(() => {
    original = useAuthStore.getState();
    serverJourney = structuredClone(initialJourney);
    updateJourney.mockReset();
    useAuthStore.setState({
      user: { id: ACTOR, email: "synthetic@example.invalid" }, profile,
      couple: null, partner: null, journey: serverJourney, isDemo: false, updateJourney,
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: { id: ACTOR }, capabilities: {} })));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(original);
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render() { await act(async () => root.render(<SettingsPage />)); }
  function button(label: string) {
    const found = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
    expect(found, label).toBeDefined();
    return found!;
  }
  function preferenceButtons() {
    return [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
  }
  function apply(updates: Parameters<typeof updateJourney>[0]): JourneyUpdateResult {
    serverJourney = { ...serverJourney, ...updates, state_revision: (serverJourney.state_revision ?? 0) + 1 };
    useAuthStore.setState({ journey: serverJourney });
    return { status: "applied", journey: serverJourney };
  }

  it("disables every preference group until the in-flight save finishes", async () => {
    const pending = deferred<JourneyUpdateResult>();
    updateJourney.mockReturnValue(pending.promise);
    await render();
    await act(async () => button("간결한 분위기").click());
    expect(container.textContent).toContain("저장 중...");
    expect(preferenceButtons()).toHaveLength(18);
    expect(preferenceButtons().every((node) => node.disabled)).toBe(true);
    await act(async () => {
      button("신혼여행").click(); button("총액 우선").click(); button("50명 미만").click();
    });
    expect(updateJourney).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(apply(updateJourney.mock.calls[0][0])));
    expect(preferenceButtons().every((node) => !node.disabled)).toBe(true);
  });

  it("accepts only one synchronous click before disabled props can render", async () => {
    const pending = deferred<JourneyUpdateResult>();
    updateJourney.mockReturnValue(pending.promise);
    await render();
    await act(async () => {
      button("간결한 분위기").click();
      button("신혼여행").click();
      button("간결한 분위기").click();
    });
    expect(updateJourney).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(apply(updateJourney.mock.calls[0][0])));
  });

  it("accumulates all four choices after each save and restores them on reload", async () => {
    updateJourney.mockImplementation(async (updates) => apply(updates));
    await render();
    for (const label of ["간결한 분위기", "신혼여행", "총액 우선", "50명 미만"]) {
      await act(async () => button(label).click());
    }
    expect(updateJourney).toHaveBeenCalledTimes(4);
    expect(serverJourney.progress).toEqual({
      studio: initialJourney.progress.studio,
      __preferences: {
        weddingStyle: "minimal", priorities: ["honeymoon"],
        budgetTendency: "saving", guestCount: "under50",
      },
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    useAuthStore.setState({ journey: structuredClone(serverJourney) });
    await render();
    for (const label of ["간결한 분위기", "신혼여행", "총액 우선", "50명 미만"]) {
      expect(button(label).getAttribute("aria-pressed")).toBe("true");
    }
    expect(preferenceButtons().filter((node) => node.getAttribute("aria-pressed") === "true")).toHaveLength(4);
  });

  it.each(["간결한 분위기", "신혼여행"])(
    "merges %s into the latest store snapshot before React commits updated handlers",
    async (label) => {
      updateJourney.mockImplementation(async (updates) => apply(updates));
      await render();
      const staleButton = button(label);
      const latestPrefs = {
        weddingStyle: "natural", priorities: ["venue"],
        budgetTendency: "balanced", guestCount: "100to200",
      };
      const newChecklist = { category: "ring", status: "completed", spent: 100_000 };
      await act(async () => {
        // 실제 store는 먼저 바뀌지만, 이 이벤트 묶음의 DOM handler는 이전 렌더 것이다.
        apply({ progress: {
          ...serverJourney.progress, ring: newChecklist, __preferences: latestPrefs,
        } as unknown as WeddingJourney["progress"] });
        staleButton.click();
      });
      expect(updateJourney).toHaveBeenCalledTimes(1);
      expect(serverJourney.progress).toEqual({
        studio: initialJourney.progress.studio, ring: newChecklist,
        __preferences: {
          ...latestPrefs,
          ...(label === "간결한 분위기"
            ? { weddingStyle: "minimal" }
            : { priorities: ["venue", "honeymoon"] }),
        },
      });
    },
  );

  it("restores the confirmed choice after a CAS failure and permits retry", async () => {
    updateJourney.mockImplementation(async (updates) => apply(updates));
    await render();
    await act(async () => button("간결한 분위기").click());
    const pending = deferred<JourneyUpdateResult>();
    updateJourney.mockReturnValueOnce(pending.promise);
    await act(async () => button("정돈된 격식").click());
    expect(button("정돈된 격식").getAttribute("aria-pressed")).toBe("true");
    await act(async () => pending.reject(new Error("다른 변경이 먼저 저장됐어요. 다시 시도해 주세요.")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("다른 변경이 먼저 저장됐어요");
    expect(button("간결한 분위기").getAttribute("aria-pressed")).toBe("true");
    expect(button("정돈된 격식").getAttribute("aria-pressed")).toBe("false");
    expect(preferenceButtons().every((node) => !node.disabled)).toBe(true);
    await act(async () => button("정돈된 격식").click());
    expect(updateJourney).toHaveBeenCalledTimes(3);
    expect(button("정돈된 격식").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).not.toContain("다른 변경이 먼저 저장됐어요");
  });

  it("keeps a partner-pending change unapplied and preserves the confirmation notice", async () => {
    updateJourney.mockImplementation(async (updates) => apply(updates));
    await render();
    await act(async () => button("간결한 분위기").click());
    const pending = deferred<JourneyUpdateResult>();
    updateJourney.mockReturnValueOnce(pending.promise);
    await act(async () => button("신혼여행").click());
    await act(async () => pending.resolve({
      status: "pending_partner", requestId: "40000000-0000-4000-8000-000000000001",
      summary: "웨딩 선호도 변경",
    }));
    expect(button("간결한 분위기").getAttribute("aria-pressed")).toBe("true");
    expect(button("신혼여행").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("두 분 확인 전에는 반영되지 않습니다.");
    expect(preferenceButtons().every((node) => !node.disabled)).toBe(true);
    expect(serverJourney.progress).toEqual({
      studio: initialJourney.progress.studio, __preferences: { weddingStyle: "minimal" },
    });
  });

  it.each(["failure", "pending_partner"] as const)(
    "restores the latest confirmed preferences after an external update and %s",
    async (outcome) => {
      updateJourney.mockImplementation(async (updates) => apply(updates));
      await render();
      await act(async () => button("간결한 분위기").click());
      const pending = deferred<JourneyUpdateResult>();
      updateJourney.mockReturnValueOnce(pending.promise);
      await act(async () => button("정돈된 격식").click());
      await act(async () => {
        apply({ progress: {
          ...serverJourney.progress,
          __preferences: { weddingStyle: "natural", priorities: ["honeymoon"] },
        } as unknown as WeddingJourney["progress"] });
      });
      expect(button("편안한 분위기").getAttribute("aria-pressed")).toBe("true");
      expect(button("신혼여행").getAttribute("aria-pressed")).toBe("true");
      await act(async () => {
        if (outcome === "failure") pending.reject(new Error("공유 준비 정보가 먼저 변경됐어요."));
        else pending.resolve({
          status: "pending_partner", requestId: "40000000-0000-4000-8000-000000000001",
          summary: "웨딩 선호도 변경",
        });
      });
      expect(button("편안한 분위기").getAttribute("aria-pressed")).toBe("true");
      expect(button("신혼여행").getAttribute("aria-pressed")).toBe("true");
      expect(button("간결한 분위기").getAttribute("aria-pressed")).toBe("false");
      expect(button("정돈된 격식").getAttribute("aria-pressed")).toBe("false");
      expect(preferenceButtons().every((node) => !node.disabled)).toBe(true);
      expect(container.textContent).toContain(outcome === "failure"
        ? "공유 준비 정보가 먼저 변경됐어요."
        : "두 분 확인 전에는 반영되지 않습니다.");
    },
  );

  it("ignores the previous actor's late failure without unlocking the new actor's save", async () => {
    const first = deferred<JourneyUpdateResult>();
    const second = deferred<JourneyUpdateResult>();
    updateJourney.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();
    await act(async () => button("간결한 분위기").click());
    await act(async () => useAuthStore.setState({
      user: { id: "other-actor", email: "other@example.invalid" },
      profile: { ...profile, id: "other-actor" },
    }));
    expect(preferenceButtons().every((node) => !node.disabled)).toBe(true);
    expect(button("간결한 분위기").getAttribute("aria-pressed")).toBe("false");
    await act(async () => button("신혼여행").click());
    expect(updateJourney).toHaveBeenCalledTimes(2);
    await act(async () => first.reject(new Error("이전 계정 저장 오류")));
    expect(container.textContent).not.toContain("이전 계정 저장 오류");
    expect(preferenceButtons().every((node) => node.disabled)).toBe(true);
    expect(button("신혼여행").getAttribute("aria-pressed")).toBe("true");
    await act(async () => second.resolve(apply(updateJourney.mock.calls[1][0])));
    expect(preferenceButtons().every((node) => !node.disabled)).toBe(true);
  });

  it("invalidates a request even when logout and the same actor's return are batched", async () => {
    const first = deferred<JourneyUpdateResult>();
    updateJourney.mockReturnValueOnce(first.promise).mockImplementation(async (updates) => apply(updates));
    await render();
    await act(async () => button("간결한 분위기").click());
    await act(async () => {
      useAuthStore.setState({ user: null, profile: null });
      useAuthStore.setState({ user: { id: ACTOR, email: "synthetic@example.invalid" }, profile });
    });
    expect(button("간결한 분위기").getAttribute("aria-pressed")).toBe("false");
    await act(async () => first.resolve({
      status: "pending_partner", requestId: "40000000-0000-4000-8000-000000000001", summary: "이전 세션 확인",
    }));
    expect(container.textContent).not.toContain("이전 세션 확인");
    await act(async () => button("신혼여행").click());
    expect(updateJourney).toHaveBeenCalledTimes(2);
    expect(button("신혼여행").getAttribute("aria-pressed")).toBe("true");
  });

  it("does not apply a late pending result to a remounted settings page", async () => {
    const first = deferred<JourneyUpdateResult>();
    const second = deferred<JourneyUpdateResult>();
    updateJourney.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();
    await act(async () => button("간결한 분위기").click());
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    await act(async () => button("신혼여행").click());
    await act(async () => first.resolve({
      status: "pending_partner", requestId: "40000000-0000-4000-8000-000000000001", summary: "이전 화면 확인",
    }));
    expect(container.textContent).not.toContain("이전 화면 확인");
    expect(preferenceButtons().every((node) => node.disabled)).toBe(true);
    await act(async () => second.resolve(apply(updateJourney.mock.calls[1][0])));
    expect(button("신혼여행").getAttribute("aria-pressed")).toBe("true");
  });
});
