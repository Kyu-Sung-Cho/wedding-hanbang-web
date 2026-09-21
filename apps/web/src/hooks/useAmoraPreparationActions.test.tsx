import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmoraActionItem } from "@/lib/amora/actions";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "user-a" } as { id: string } | null,
    profile: { id: "user-a", couple_id: "couple-a" },
    isDemo: false,
    isInitialized: true,
    journey: { progress: {} as Record<string, unknown> },
  },
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth),
    { getState: () => mocks.auth, subscribe: () => () => undefined },
  ),
}));

import { useAmoraPreparationActions } from "./useAmoraPreparationActions";
import { clearPreparationCreate } from "@/lib/amora/pendingPreparationCreate";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const action: AmoraActionItem = {
  id: "act_test", title: "추가 비용 확인", status: "open", source: "chat", priority: "medium",
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
let latest: ReturnType<typeof useAmoraPreparationActions>;
function Harness() {
  const result = useAmoraPreparationActions();
  useEffect(() => { latest = result; }, [result]);
  return <div>{result.actions.map((item) => <p key={item.id}>{item.title}</p>)}{result.error}</div>;
}

describe("useAmoraPreparationActions", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn();
  beforeEach(() => {
    // 이 옛 fixture의 인증 subscribe는 no-op이다. 독립 사례의 복구 장부만 초기화한다.
    // 실제 인증 전환 삭제는 recovery.test.tsx의 real authStore로 별도 검증한다.
    clearPreparationCreate(JSON.stringify(["user-a", "couple-a", false]));
    clearPreparationCreate(JSON.stringify(["user-a", "couple-b", false]));
    mocks.auth.user = { id: "user-a" };
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    mocks.auth.isDemo = false;
    mocks.auth.isInitialized = true;
    mocks.auth.journey = { progress: {} };
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("normalizes legacy null plan fields on reads and accepts an explicit clear receipt", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [{ ...action, description: null, dueDate: null }], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    expect(latest.error).toBeNull();
    expect(latest.actions[0]).toMatchObject({ description: undefined, dueDate: undefined });
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, description: null, dueDate: null } }));
    await act(async () => { expect(await latest.update(action.id, { description: "", due_date: "" })).toBe(true); });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ description: "", due_date: "" });
  });

  it("validates plan field receipts using the server sanitizer and rejects a stale value", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, description: "전화로 견적 확인", dueDate: "다음 주 중" } }));
    await act(async () => { expect(await latest.update(action.id, { description: " 전화로\n 견적 확인 ", due_date: " 다음 주 중 " })).toBe(true); });
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, description: "옛 설명", dueDate: "다음 주 중" } }));
    await act(async () => { expect(await latest.update(action.id, { description: "새 설명" })).toBe(false); });
    expect(latest.actions[0].description).toBe("전화로 견적 확인");
  });

  it("creates a shared manual task with owner pins only after a matching server receipt", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    const fields = { title: "업체 전화", category_key: "venue", description: " 식사\n 포함 범위 ", due_date: "다음 주" };
    const saved = { ...action, id: "act_created", title: fields.title, categoryKey: "venue", description: "식사 포함 범위", dueDate: "다음 주", source: "manual" };
    fetchMock.mockImplementationOnce((_input: unknown, init: RequestInit) => response({ action: saved, requestId: JSON.parse(String(init.body)).requestId, replayed: false }, 201));
    fetchMock.mockResolvedValueOnce(response({ actions: [saved, action], count: 2, open_count: 2 }));
    await act(async () => { expect(await latest.create(fields)).toBe(true); });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/amora/actions");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ...fields, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), status: "open", priority: "medium", source: "manual", expectedOwnerId: "user-a", expectedCoupleId: "couple-a" });
    expect(latest.actions.map(item => item.id)).toEqual(["act_created", action.id]);
    expect(latest.count).toBe(2); expect(latest.open_count).toBe(2);
  });

  it("blocks duplicate creates and rejects a late create after an owner change", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [], count: 0, open_count: 0 }));
    await act(async () => root.render(<Harness />));
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = latest.create({ title: "업체 전화" }); });
    const requestId = JSON.parse(fetchMock.mock.calls[1][1].body).requestId;
    await act(async () => { expect(await latest.create({ title: "다시 클릭" })).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    mocks.auth.profile = { id: "user-a", couple_id: "couple-b" };
    fetchMock.mockResolvedValueOnce(response({ actions: [], count: 0, open_count: 0 }));
    await act(async () => root.render(<Harness />));
    await act(async () => { finish(response({ action: { ...action, id: "act_created", title: "업체 전화", source: "manual" }, requestId, replayed: false }, 201)); expect(await pending).toBe(false); });
    expect(latest.actions).toEqual([]);
  });

  it("pins the first body and UUID after an unknown outcome and retries it without duplicating a refreshed row", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [], count: 0, open_count: 0 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockRejectedValueOnce(new TypeError("lost response"));
    await act(async () => { expect(await latest.create({ title: "업체 전화", description: "내 설명" })).toBe(false); });
    const firstBody = fetchMock.mock.calls[1][1].body;
    expect(JSON.parse(firstBody).requestId).toMatch(/^[0-9a-f-]{36}$/);
    await act(async () => { expect(await latest.create({ title: "다른 일" })).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const saved = { ...action, id: "act_created", title: "업체 전화", description: "내 설명", source: "manual" };
    fetchMock.mockResolvedValueOnce(response({ actions: [saved], count: 1, open_count: 1 }));
    await act(async () => latest.refresh());
    fetchMock.mockResolvedValueOnce(response({ action: saved, requestId: JSON.parse(firstBody).requestId, replayed: true }));
    fetchMock.mockResolvedValueOnce(response({ actions: [saved], count: 1, open_count: 1 }));
    await act(async () => { expect(await latest.create({ title: "업체 전화", description: "내 설명" })).toBe(true); });
    expect(fetchMock.mock.calls[3][1].body).toBe(firstBody);
    expect(latest.actions).toHaveLength(1); expect(latest.count).toBe(1);
  });

  it("only abandons a pinned unknown create on explicit cancellation and gives a new intent a new ID", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [], count: 0, open_count: 0 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockRejectedValueOnce(new TypeError("lost response"));
    await act(async () => { await latest.create({ title: "첫 의도" }); });
    const first = JSON.parse(fetchMock.mock.calls[1][1].body);
    await act(async () => { expect(latest.cancelCreate()).toBe(true); });
    fetchMock.mockRejectedValueOnce(new TypeError("lost again"));
    await act(async () => { await latest.create({ title: "새 의도" }); });
    const second = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.title).toBe("새 의도");
  });

  it("does not accept a receipt with a different request ID", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [], count: 0, open_count: 0 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "제목", source: "manual" }, requestId: "other", replayed: false }));
    await act(async () => { expect(await latest.create({ title: "제목" })).toBe(false); });
    expect(latest.actions).toEqual([]);
  });

  it("blocks existing-card writes through POST and its final refresh, so creation cannot lose its list update", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    let finishPost!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishPost = resolve; }));
    let createPromise!: Promise<boolean>;
    await act(async () => { createPromise = latest.create({ title: "새 항목" }); });
    await act(async () => { expect(await latest.update(action.id, { title: "동시 수정" })).toBe(false); });
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "POST"]);
    const requestId = JSON.parse(fetchMock.mock.calls[1][1].body).requestId;
    const saved = { ...action, id: "act_created", title: "새 항목", source: "manual" };
    let finishGet!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishGet = resolve; }));
    await act(async () => finishPost(response({ action: saved, requestId, replayed: false }, 201)));
    expect(latest.creating).toBe(true);
    await act(async () => { expect(await latest.update(action.id, { status: "done" })).toBe(false); });
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "POST", "GET"]);
    await act(async () => { finishGet(response({ actions: [saved, action], count: 2, open_count: 2 })); expect(await createPromise).toBe(true); });
    expect(latest.actions.map(item => item.id)).toEqual([saved.id, action.id]);
    expect(latest.count).toBe(2); expect(latest.creating).toBe(false);
  });

  it("keeps a confirmed create distinct from a failed follow-up list read", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [], count: 0, open_count: 0 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockImplementationOnce((_input: unknown, init: RequestInit) => response({ action: { ...action, title: "새 항목", source: "manual" }, requestId: JSON.parse(String(init.body)).requestId, replayed: false }, 201));
    fetchMock.mockResolvedValueOnce(response({ error: "list unavailable" }, 503));
    await act(async () => { expect(await latest.create({ title: "새 항목" })).toBe(true); });
    expect(latest.error).toContain("불러오지 못했어요");
    expect(latest.updateError).toBeNull(); expect(latest.createLocked).toBe(false);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "POST", "GET"]);
  });

  it("distinguishes a failed read from an empty board and recovers on retry", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "준비 상황을 불러오지 못했어요." }, 503));
    await act(async () => root.render(<Harness />));
    expect(latest.loading).toBe(false);
    expect(latest.error).toContain("불러오지 못");
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 100, open_count: 90, truncated: true }));
    await act(async () => latest.refresh());
    expect(latest.error).toBeNull();
    expect(latest.actions).toEqual([action]);
    expect(latest).toMatchObject({ count: 100, open_count: 90, truncated: true });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/amora/actions?status=all&limit=80", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });

  it("waits for canonical PATCH success, blocks duplicate clicks, and supports restoration", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    let resolvePatch!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePatch = resolve; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = latest.update(action.id, { status: "done" }); });
    expect(latest.actions[0].status).toBe("open");
    expect(latest.updatingIds.has(action.id)).toBe(true);
    await act(async () => { expect(await latest.update(action.id, { status: "dismissed" })).toBe(false); });
    const done = { ...action, status: "done" };
    await act(async () => { resolvePatch(response({ action: done })); expect(await pending).toBe(true); });
    expect(latest.actions[0].status).toBe("done");
    expect(fetchMock.mock.calls[1]).toEqual([`/api/amora/actions/${action.id}`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "done" }) })]);
    fetchMock.mockResolvedValueOnce(response({ action }));
    await act(async () => { expect(await latest.update(action.id, { status: "open" })).toBe(true); });
    expect(latest.actions[0].status).toBe("open");
  });

  it("keeps the original category and status when a save fails", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ error: "database detail" }, 500));
    await act(async () => { expect(await latest.update(action.id, { category_key: "makeup" })).toBe(false); });
    expect(latest.actions).toEqual([action]);
    expect(latest.updateError).toContain("저장하지 못");
    expect(latest.updateError).not.toContain("database detail");
    expect(latest.updatingIds.size).toBe(0);
  });

  it("rejects malformed success responses instead of presenting zero cards", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: "invalid", count: 0, open_count: 0 }));
    await act(async () => root.render(<Harness />));
    expect(latest.error).toContain("불러오지 못");
    expect(latest.loading).toBe(false);
  });

  it("hides old cards immediately and ignores a late read after the couple changes", async () => {
    let resolveOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }));
    await act(async () => root.render(<Harness />));
    const coupleBAction = { ...action, id: "act_b", title: "새 커플 준비" };
    mocks.auth.profile = { id: "user-a", couple_id: "couple-b" };
    fetchMock.mockResolvedValueOnce(response({ actions: [coupleBAction], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    await act(async () => resolveOld(response({ actions: [action], count: 1, open_count: 1 })));
    expect(latest.actions).toEqual([coupleBAction]);
    expect(container.textContent).not.toContain(action.title);
    mocks.auth.user = null;
    await act(async () => root.render(<Harness />));
    expect(latest.actions).toEqual([]);
  });

  it("does not accept a late mutation after leaving and returning to the same scope", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    let resolvePatch!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePatch = resolve; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = latest.update(action.id, { status: "done" }); });
    mocks.auth.profile = { id: "user-a", couple_id: "couple-b" };
    fetchMock.mockResolvedValueOnce(response({ actions: [], count: 0, open_count: 0 }));
    await act(async () => root.render(<Harness />));
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    await act(async () => { resolvePatch(response({ action: { ...action, status: "done" } })); expect(await pending).toBe(false); });
    expect(latest.actions).toEqual([action]);
    expect(latest.updatingIds.size).toBe(0);
  });

  it("loads beyond the first page, deduplicates IDs and retains older cards after updating", async () => {
    const older = { ...action, id: "act_old", title: "이전 준비 기록" };
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 2, open_count: 2, next_cursor: "cursor+/=" }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ actions: [action, older], count: 2, open_count: 2, next_cursor: null }));
    await act(async () => latest.loadMore());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/amora/actions?status=all&limit=80&cursor=cursor%2B%2F%3D", expect.anything());
    expect(latest.actions.map(value => value.id)).toEqual([action.id, older.id]);
    expect(latest.nextCursor).toBeNull(); expect(latest.truncated).toBe(false);
    fetchMock.mockResolvedValueOnce(response({ action: { ...older, title: "수정된 이전 준비", categoryKey: "venue" } }));
    await act(async () => { expect(await latest.update(older.id, { title: "수정된 이전 준비", category_key: "venue" })).toBe(true); });
    expect(latest.actions).toHaveLength(2);
    expect(latest.actions[1].title).toBe("수정된 이전 준비");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an unchanged status receipt even when the action ID matches", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ action }));
    await act(async () => { expect(await latest.update(action.id, { status: "done" })).toBe(false); });
    expect(latest.actions[0].status).toBe("open");
    expect(latest.updateError).toContain("결과를 확인할 수 없어요");
  });

  it("keeps the next cursor on a page failure, prevents duplicate loads and recovers", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 2, open_count: 2, next_cursor: "next" }));
    await act(async () => root.render(<Harness />));
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = latest.loadMore(); void latest.loadMore(); });
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(latest.loadingMore).toBe(true);
    await act(async () => { finish(response({ error: "failed" }, 503)); await pending; });
    expect(latest.actions).toEqual([action]); expect(latest.nextCursor).toBe("next");
    expect(latest.error).toContain("불러오지 못");
    fetchMock.mockResolvedValueOnce(response({ actions: [{ ...action, id: "act_old" }], count: 2, open_count: 2, next_cursor: null }));
    await act(async () => latest.loadMore());
    expect(latest.actions).toHaveLength(2); expect(latest.error).toBeNull();
  });

  it("ignores an in-flight old page after refresh and rejects a repeating cursor", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 2, open_count: 2, next_cursor: "next" }));
    await act(async () => root.render(<Harness />));
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = latest.loadMore(); });
    fetchMock.mockResolvedValueOnce(response({ actions: [{ ...action, title: "최신 기록" }], count: 2, open_count: 2, next_cursor: "next" }));
    await act(async () => latest.refresh());
    await act(async () => { finish(response({ actions: [{ ...action, id: "act_old" }], count: 2, open_count: 2 })); await pending; });
    expect(latest.actions.map(value => value.title)).toEqual(["최신 기록"]);
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 2, open_count: 2, next_cursor: "next" }));
    await act(async () => latest.loadMore());
    expect(latest.error).toContain("불러오지 못"); expect(latest.actions[0].title).toBe("최신 기록");
  });

  it("changes labeled demo samples only in memory without reading or mutating the API", async () => {
    mocks.auth.isDemo = true;
    mocks.auth.journey = { progress: { __amora_actions: [action] } };
    await act(async () => root.render(<Harness />));
    expect(latest.actions).toContainEqual(action);
    expect(latest.actions.filter((item) => item.status === "done").length).toBeGreaterThanOrEqual(2);
    expect(latest.actions.filter((item) => item.status === "dismissed").length).toBeGreaterThanOrEqual(2);
    expect(latest.isDemo).toBe(true);
    await act(async () => { expect(await latest.update(action.id, { status: "done" })).toBe(true); await latest.refresh(); });
    expect(latest.actions.find((item) => item.id === action.id)?.status).toBe("done");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
