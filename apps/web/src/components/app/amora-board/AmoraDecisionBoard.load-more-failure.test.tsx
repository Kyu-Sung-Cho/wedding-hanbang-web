import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 이어서 불러오기가 실패해도 이미 화면에 있는 기록은 그대로 있어야 한다. 실패한 것은 다음
// 페이지 하나이고 커플 연결은 멀쩡한데, 목록을 비우고 "커플 연결을 확인" 하라고 말하면
// 사용자는 있던 기록을 잃고 엉뚱한 곳을 확인하게 된다.
const mocks = vi.hoisted(() => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  return {
    ownerId, coupleId,
    auth: { user: { id: ownerId } as { id: string } | null, profile: { id: ownerId, couple_id: coupleId, role: "bride" }, couple: { id: coupleId, bride_id: ownerId, groom_id: null as string | null }, isInitialized: true, isDemo: false },
    listeners: new Set<(state: unknown) => void>(),
    nodeRead: vi.fn(),
    actions: { actions: [], loading: false, loadingMore: false, error: null, count: 0, truncated: false, nextCursor: null, isDemo: false,
      updatingIds: new Set<string>(), creating: false, createLocked: false, canCreate: false, ownerScope: "owner-a",
      refresh: vi.fn(), update: vi.fn(), loadMore: vi.fn(), create: vi.fn(), cancelCreate: vi.fn() },
  };
});
vi.mock("@/stores/authStore", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: (state: typeof mocks.auth) => void) => {
    mocks.listeners.add(listener as (state: unknown) => void);
    return () => mocks.listeners.delete(listener as (state: unknown) => void);
  };
  return { useAuthStore: Object.assign((select: (state: typeof mocks.auth) => unknown) => useSyncExternalStore(subscribe, () => select(mocks.auth)), { getState: () => mocks.auth, subscribe }) };
});
function query(table: string) {
  const read = async () => table === "profiles" ? { data: { ...mocks.auth.profile }, error: null }
    : table === "couples" ? { data: { ...mocks.auth.couple }, error: null }
      : mocks.nodeRead();
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain, order: () => chain, limit: () => chain, or: () => chain,
    abortSignal: () => chain, single: read,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => read().then(resolve, reject),
  };
  return chain;
}
const client = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mocks.auth.user }, error: null })),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: query,
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
vi.mock("@/hooks/useAmoraPreparationActions", () => ({ useAmoraPreparationActions: () => mocks.actions }));
import AmoraDecisionBoard from "./AmoraDecisionBoard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 같은 시각이라 순서는 id 내림차순이다. index가 커질수록 더 오래된 기록이다. */
const olderId = (prefix: string, index: number) => `${prefix}-${(4000 - index).toString(16).padStart(12, "0")}`;
function decisionRow(index: number) {
  return { id: olderId("33333333-3333-4333-8333", index), couple_id: mocks.coupleId, visibility: "shared", category: "venue",
    title: `예식장 결정 ${index}`, reasoning: "직접 저장한 이유", decision_type: "decided", source: "manual",
    created_at: "2026-09-07T00:00:00.123900Z", superseded_at: null, memory_key: null, metadata: {}, chosen_value: null };
}
function routineRow(index: number) {
  return { id: olderId("44444444-4444-4444-8444", index), couple_id: mocks.coupleId, visibility: "shared", category: "schedule",
    title: "진행 상황: 1개 수정", reasoning: null, decision_type: "scheduled", source: "schedule",
    created_at: "2026-09-02T05:53:44Z", superseded_at: null, memory_key: null, metadata: { origin: "couple_plan_change_request" },
    chosen_value: { schemaVersion: 1, changes: { progress_patch: { greeting: { category: "greeting", status: "in_progress", checklist: [] } }, progress_remove_keys: [] } } };
}
const page = (build: (index: number) => unknown) => ({ data: Array.from({ length: 31 }, (_, index) => build(index)), error: null });

describe("이전 결정 더 불러오기 실패", () => {
  let root: Root; let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(mocks.auth, { user: { id: mocks.ownerId }, profile: { id: mocks.ownerId, couple_id: mocks.coupleId, role: "bride" }, couple: { id: mocks.coupleId, bride_id: mocks.ownerId, groom_id: null }, isInitialized: true, isDemo: false });
    mocks.nodeRead.mockReset(); client.auth.getUser.mockClear();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  const board = () => container.querySelector('[aria-label="준비 결정 기록"]')!;
  const loadMore = () => Array.from(board().querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === "이전 결정 더 보기");

  it("keeps the loaded decision cards and offers a retry when only the next page fails", async () => {
    mocks.nodeRead.mockResolvedValue(page(decisionRow));
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(board().querySelectorAll("article")).toHaveLength(30);

    mocks.nodeRead.mockRejectedValueOnce(new Error("NETWORK_DOWN"));
    await act(async () => loadMore()!.click());

    expect(board().querySelectorAll("article")).toHaveLength(30);
    expect(board().textContent).toContain("예식장 결정 0");
    expect(board().textContent).toContain("이전 결정을 더 불러오지 못했어요");
    expect(board().textContent).not.toContain("커플 연결을 확인한 뒤");
    expect(loadMore()?.disabled).toBe(false);

    // 커서를 지키고 있으므로 다시 누르면 이어서 불러온다.
    mocks.nodeRead.mockResolvedValueOnce({ data: [decisionRow(30)], error: null });
    await act(async () => loadMore()!.click());
    expect(board().querySelectorAll("article")).toHaveLength(31);
    expect(board().textContent).not.toContain("이전 결정을 더 불러오지 못했어요");
    expect(mocks.nodeRead).toHaveBeenCalledTimes(3);
  });

  it("stops the automatic follow-up load at its failure without emptying the board", async () => {
    mocks.nodeRead.mockResolvedValueOnce(page(routineRow)).mockResolvedValue({ data: null, error: { code: "503" } });
    await act(async () => root.render(<AmoraDecisionBoard />));
    await act(async () => { await Promise.resolve(); });

    expect(mocks.nodeRead).toHaveBeenCalledTimes(2);
    expect(board().textContent).toContain("진행 상황 저장 30건은 날짜별로 접어 두었어요");
    expect(board().textContent).toContain("이전 결정을 더 불러오지 못했어요");
    expect(board().textContent).not.toContain("커플 연결을 확인한 뒤");
    expect(loadMore()).toBeDefined();

    await act(async () => { await Promise.resolve(); });
    expect(mocks.nodeRead).toHaveBeenCalledTimes(2);
  });

  it("still empties the board and points at the couple connection when the first page fails", async () => {
    mocks.nodeRead.mockResolvedValue({ data: null, error: { code: "42501" } });
    await act(async () => root.render(<AmoraDecisionBoard />));

    expect(board().querySelectorAll("article")).toHaveLength(0);
    expect(board().textContent).toContain("커플 연결을 확인한 뒤");
    expect(board().textContent).not.toContain("이전 결정을 더 불러오지 못했어요");
  });
});
