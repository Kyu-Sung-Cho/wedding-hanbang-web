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
  created_at: "2026-09-09T00:00:00.000Z", updated_at: "2026-09-09T00:00:00.000Z",
  progress: {
    custom_photo: { category: "custom_photo", label: "포토부스", status: "not_started",
      budget: 700_000, spent: 100_000, payer: "couple" },
    venue: { category: "venue", status: "not_started", budget: 9_000_000,
      spent: 100_000, payer: "couple", checklist: [{ id: "v1", label: "방문", done: false }] },
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
describe("BudgetContent two-stage custom deletion concurrency", () => {
  const original = useAuthStore.getState();
  let container: HTMLDivElement;
  let root: Root;
  let canonical: WeddingJourney;
  let firstApplied: WeddingJourney;
  let resolveFirst: (response: Response) => void;
  let finished: Promise<void>;
  let resolveFinished: () => void;
  const patches: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    patches.length = 0;
    canonical = clone(initial);
    firstApplied = clone(initial);
    firstApplied.state_revision = 1;
    firstApplied.progress.custom_photo = {
      category: "custom_photo", label: "포토부스", status: "not_started",
    };
    useAuthStore.setState(scope(canonical));
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    finished = new Promise(resolve => { resolveFinished = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me" && !init?.method) return response(scope(canonical));
      if (url !== "/api/journey" || init?.method !== "PATCH") {
        throw new Error("Unexpected network request");
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patches.push(body);
      if (patches.length === 1) return new Promise<Response>(resolve => { resolveFirst = resolve; });
      const applied = clone(canonical);
      applied.state_revision = (applied.state_revision ?? 0) + 1;
      delete applied.progress.custom_photo;
      resolveFinished();
      return response({ status: "applied", requestId: REQUEST, journey: applied });
    }));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    useAuthStore.setState(original); vi.unstubAllGlobals();
  });
  async function startDelete() {
    await act(async () => root.render(<BudgetContent />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="포토부스 삭제"]')!.click());
    const confirm = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.trim() === "삭제")!;
    await act(async () => confirm.click());
    expect(patches).toHaveLength(1);
    expect(patches[0].progress_patch).toEqual({ custom_photo: firstApplied.progress.custom_photo });
  }
  async function refreshThenFinish() {
    await act(async () => useAuthStore.getState().refreshJourney(ACTOR));
    expect(useAuthStore.getState().journey?.state_revision).toBe(2);
    await act(async () => resolveFirst(response({ status: "applied", requestId: REQUEST, journey: firstApplied })));
  }
  it.each(["spent", "payer", "checklist", "memo", "added_key"] as const)(
    "removes only the selected key after a newer %s edit reaches the actual store",
    async field => {
      await startDelete();
      canonical = clone(firstApplied); canonical.state_revision = 2;
      if (field === "spent") canonical.progress.venue.spent = 250_000;
      if (field === "payer") canonical.progress.venue.payer = "both_parents";
      if (field === "checklist") {
        canonical.progress.venue.checklist![0].done = true;
        canonical.progress.venue.status = "completed";
      }
      if (field === "memo") canonical.progress.greeting.notes = "최신 메모";
      if (field === "added_key") canonical.progress.custom_new = {
        category: "custom_new", label: "새 항목", status: "not_started",
      };
      await refreshThenFinish();
      await finished;
      expect(patches).toHaveLength(2);
      expect(patches[1]).toMatchObject({
        expected_revision: 2, expected_couple_id: COUPLE,
      });
      expect(patches[1].progress_patch).toEqual({});
      expect(patches[1].progress_remove_keys).toEqual(["custom_photo"]);
    },
  );
  it.each(["new_budget", "new_checklist", "new_memo"] as const)(
    "does not delete the selected item after it gains %s between saves",
    async change => {
      await startDelete();
      canonical = clone(firstApplied); canonical.state_revision = 2;
      if (change === "new_budget") canonical.progress.custom_photo.budget = 900_000;
      if (change === "new_checklist") canonical.progress.custom_photo.checklist = [
        { id: "photo1", label: "새 체크", done: false },
      ];
      if (change === "new_memo") canonical.progress.custom_photo.notes = "보존할 새 내용";
      await refreshThenFinish();
      expect(patches).toHaveLength(1);
      expect(useAuthStore.getState().journey?.progress.custom_photo).toEqual(canonical.progress.custom_photo);
      expect(container.textContent).toContain("항목이 바뀌었어요");
      expect(container.textContent).not.toContain("변경 내용을 저장했어요");
    },
  );
  it("accepts an unchanged selected item whose JSON keys arrive in a different order", async () => {
    await startDelete();
    canonical = clone(firstApplied); canonical.state_revision = 2;
    canonical.progress.custom_photo = {
      status: "not_started", label: "포토부스", category: "custom_photo",
    };
    await refreshThenFinish();
    await finished;
    expect(patches).toHaveLength(2);
    expect(patches[1].progress_patch).toEqual({});
    expect(patches[1].progress_remove_keys).toEqual(["custom_photo"]);
  });
  it("does not proceed before a first-step pending confirmation has applied", async () => {
    await startDelete();
    await act(async () => resolveFirst(response({
      status: "pending_partner", requestId: REQUEST, summary: "예산 변경",
    })));
    expect(patches).toHaveLength(1);
    expect(container.textContent).toContain("상대방에게 확인 요청");
  });
});
