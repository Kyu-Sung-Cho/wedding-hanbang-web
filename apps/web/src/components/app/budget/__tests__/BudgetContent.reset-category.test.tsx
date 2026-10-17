// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BudgetContent from "../BudgetContent";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const ACTOR = "10000000-0000-4000-8000-000000000001";
const COUPLE = "20000000-0000-4000-8000-000000000001";
const REQUEST = "30000000-0000-4000-8000-000000000001";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const initial: WeddingJourney = {
  id: "40000000-0000-4000-8000-000000000001", couple_id: COUPLE,
  total_budget: 35_000_000, state_revision: 0, wedding_date: null, venue: null,
  created_at: "2026-10-17T00:00:00.000Z", updated_at: "2026-10-17T00:00:00.000Z",
  progress: {
    venue: {
      category: "venue", status: "in_progress", budget: 9_000_000, spent: 100_000,
      payer: "couple", vendor: "예시 홀", notes: "메모",
      checklist: [{ id: "v1", label: "방문", done: true }],
    },
    makeup: { category: "makeup", status: "not_started", budget: 700_000 },
    greeting: { category: "greeting", status: "not_started", notes: "이전 메모" },
  },
};

function scope(journey: WeddingJourney) {
  return {
    user: { id: ACTOR, email: "synthetic@example.invalid" },
    profile: { id: ACTOR, couple_id: COUPLE, role: "bride" } as NonNullable<ReturnType<typeof useAuthStore.getState>["profile"]>,
    couple: { id: COUPLE } as NonNullable<ReturnType<typeof useAuthStore.getState>["couple"]>,
    partner: null, journey, isDemo: false, isInitialized: true, isLoading: false,
  };
}

const response = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200, headers: { "content-type": "application/json" },
});

describe("BudgetContent 항목 초기화는 금액만 비운다", () => {
  const original = useAuthStore.getState();
  let container: HTMLDivElement;
  let root: Root;
  let canonical: WeddingJourney;
  const patches: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    patches.length = 0;
    canonical = clone(initial);
    useAuthStore.setState(scope(canonical));
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me" && !init?.method) return response(scope(canonical));
      if (url !== "/api/journey" || init?.method !== "PATCH") {
        throw new Error("Unexpected network request");
      }
      const body = JSON.parse(String(init.body)) as {
        progress_patch?: Record<string, unknown>; progress_remove_keys?: string[];
      };
      patches.push(body);
      const applied = clone(canonical);
      applied.state_revision = (applied.state_revision ?? 0) + 1;
      Object.assign(applied.progress, body.progress_patch ?? {});
      for (const key of body.progress_remove_keys ?? []) delete applied.progress[key];
      return response({ status: "applied", requestId: REQUEST, journey: applied });
    }));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    useAuthStore.setState(original); vi.unstubAllGlobals();
  });

  const byTitle = (title: string) => container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
  const resetButton = () => Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === "데이터 초기화")!;
  const flush = async () => {
    for (let round = 0; round < 3; round += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
  };

  async function openManageModal(label: string) {
    await act(async () => root.render(<BudgetContent />));
    await act(async () => byTitle(`${label} 삭제`).click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  }

  it("keeps the checklist, status, vendor and memo and only strips the money fields", async () => {
    await openManageModal("결혼식장");
    await act(async () => resetButton().click());
    await flush();

    expect(patches).toHaveLength(1);
    // 키를 지우면 체크 기록까지 사라지고 서버도 금액 밖 변경이 섞였다며 거절한다.
    expect(patches[0].progress_remove_keys).toEqual([]);
    expect(patches[0].progress_patch).toEqual({
      venue: {
        category: "venue", status: "in_progress", vendor: "예시 홀", notes: "메모",
        checklist: [{ id: "v1", label: "방문", done: true }],
      },
    });
    const venue = useAuthStore.getState().journey?.progress.venue;
    expect(venue?.checklist).toEqual([{ id: "v1", label: "방문", done: true }]);
    expect(venue?.budget).toBeUndefined();
    expect(venue?.spent).toBeUndefined();
    expect(venue?.payer).toBeUndefined();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("leaves a money-only item as its bare category and status shell instead of deleting the key", async () => {
    await openManageModal("헤어·메이크업");
    await act(async () => resetButton().click());
    await flush();

    expect(patches).toHaveLength(1);
    expect(patches[0].progress_remove_keys).toEqual([]);
    expect(patches[0].progress_patch).toEqual({
      makeup: { category: "makeup", status: "not_started" },
    });
    expect(Object.keys(useAuthStore.getState().journey?.progress ?? {})).toContain("makeup");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("only closes the modal without a request when the item has no saved record", async () => {
    canonical = clone(initial);
    delete canonical.progress.venue;
    useAuthStore.setState(scope(canonical));
    await act(async () => root.render(<BudgetContent />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="결혼식장 예산 입력하기"]')!.click());
    await act(async () => byTitle("결혼식장 삭제").click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => resetButton().click());
    await flush();

    expect(patches).toHaveLength(0);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(useAuthStore.getState().journey?.progress.venue).toBeUndefined();
  });
});
