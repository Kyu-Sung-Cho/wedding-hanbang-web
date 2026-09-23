import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import { useAmoraPreparationActions } from "./useAmoraPreparationActions";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let USER = "11111111-1111-4111-8111-111111111111";
let actorSequence = 0;
const COUPLE = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-09-20T00:00:00.000Z";
const saved = { id: "act_saved", title: "합성 준비 할 일", source: "manual", priority: "medium", status: "open", createdAt: timestamp, updatedAt: timestamp };
const empty = () => Response.json({ actions: [], count: 0, open_count: 0 });
let root: Root;
let host: HTMLDivElement;
let latest: ReturnType<typeof useAmoraPreparationActions>;
const fetchMock = vi.fn();
function Harness() {
  const value = useAmoraPreparationActions();
  useEffect(() => { latest = value; }, [value]);
  return null;
}
beforeEach(() => {
  // 미해결 변경은 인증 복귀에도 유지한다. 독립 예제는 서로 다른 합성 계정을 쓴다.
  USER = `11111111-1111-4111-8111-${String(++actorSequence).padStart(12, "0")}`;
  vi.useFakeTimers(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  useAuthStore.getState().reset();
  useAuthStore.setState({ user: { id: USER, email: "synthetic@example.invalid" }, profile: { id: USER, name: "합성", role: "bride", couple_id: COUPLE, avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: timestamp, updated_at: timestamp }, isInitialized: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["fetch", "body"])("finishes a verified creation after a stalled final %s and keeps its canonical card", async (phase) => {
  fetchMock.mockResolvedValueOnce(empty());
  await act(async () => root.render(<Harness />));
  fetchMock.mockImplementationOnce((_url: unknown, init: RequestInit) => Response.json({ action: saved, requestId: JSON.parse(String(init.body)).requestId, replayed: false }, { status: 201 }));
  if (phase === "fetch") fetchMock.mockImplementationOnce(() => new Promise<never>(() => undefined));
  else fetchMock.mockResolvedValueOnce({ ok: true, json: () => new Promise<never>(() => undefined) });
  let result: boolean | undefined;
  await act(async () => { void latest.create({ title: saved.title }).then(value => { result = value; }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
  expect(result).toBe(true);
  expect(latest.creating).toBe(false); expect(latest.createLocked).toBe(false);
  expect(latest.actions).toEqual([saved]); expect(latest.count).toBe(1);
  expect(latest.updateError).toBeNull(); expect(latest.error).toContain("불러오지 못했어요");
  fetchMock.mockResolvedValueOnce(Response.json({ actions: [saved], count: 1, open_count: 1 }));
  await act(async () => latest.refresh());
  expect(latest.actions).toEqual([saved]); expect(latest.error).toBeNull();
});

it("does not install a late post-write read in a new owner's list", async () => {
  fetchMock.mockResolvedValueOnce(empty());
  await act(async () => root.render(<Harness />));
  fetchMock.mockImplementationOnce((_url: unknown, init: RequestInit) => Response.json({ action: saved, requestId: JSON.parse(String(init.body)).requestId, replayed: false }));
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = latest.create({ title: saved.title }); });
  fetchMock.mockResolvedValueOnce(empty());
  await act(async () => useAuthStore.setState({ profile: { ...useAuthStore.getState().profile!, couple_id: "33333333-3333-4333-8333-333333333333" } }));
  await act(async () => { finish(Response.json({ actions: [saved], count: 1, open_count: 1 })); expect(await pending).toBe(false); });
  expect(latest.actions).toEqual([]);
});

it("does not count a replay outside the visible page as a new creation", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ actions: [], count: 81, open_count: 81, truncated: true }));
  await act(async () => root.render(<Harness />));
  fetchMock.mockRejectedValueOnce(new TypeError("lost response"));
  await act(async () => { expect(await latest.create({ title: saved.title })).toBe(false); });
  fetchMock.mockResolvedValueOnce(Response.json({ actions: [], count: 81, open_count: 81, truncated: true }));
  await act(async () => latest.refresh());
  fetchMock.mockImplementationOnce((_url: unknown, init: RequestInit) => Response.json({ action: saved, requestId: JSON.parse(String(init.body)).requestId, replayed: true }));
  fetchMock.mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }));
  await act(async () => { expect(await latest.create({ title: saved.title })).toBe(true); });
  expect(latest.actions).toEqual([saved]);
  expect(latest.count).toBe(81); expect(latest.open_count).toBe(81);
});

it.each(["fetch", "body"])("ends a stalled create %s as unknown and retries only the original request ID", async phase => {
  fetchMock.mockResolvedValueOnce(empty());
  await act(async () => root.render(<Harness />));
  let finish!: (value: unknown) => void;
  const stalled = new Promise(resolve => { finish = resolve; });
  fetchMock.mockImplementationOnce(() => phase === "fetch" ? stalled : { ok: true, json: () => stalled });
  let result: boolean | undefined;
  await act(async () => { void latest.create({ title: saved.title }).then(value => { result = value; }); });
  const originalBody = String(fetchMock.mock.calls[1][1].body);
  await act(async () => { await vi.advanceTimersByTimeAsync(30001); });
  expect(result).toBe(false); expect(latest.creating).toBe(false); expect(latest.createLocked).toBe(true);
  expect(latest.updateError).toContain("이미 저장됐을 수 있어요");
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
  fetchMock.mockImplementationOnce((_url: unknown, init: RequestInit) => Response.json({ action: saved, requestId: JSON.parse(String(init.body)).requestId, replayed: true }));
  fetchMock.mockResolvedValueOnce(Response.json({ actions: [saved], count: 1, open_count: 1 }));
  await act(async () => { expect(await latest.create({ title: saved.title })).toBe(true); });
  const posts = fetchMock.mock.calls.filter(call => call[1]?.method === "POST");
  expect(posts).toHaveLength(2); expect(posts[1][1].body).toBe(originalBody);
  fetchMock.mockResolvedValueOnce(empty());
  await act(async () => useAuthStore.setState({ profile: { ...useAuthStore.getState().profile!, couple_id: "33333333-3333-4333-8333-333333333333" } }));
  const receipt = { action: saved, requestId: JSON.parse(originalBody).requestId, replayed: false };
  await act(async () => finish(phase === "fetch" ? Response.json(receipt) : receipt));
  expect(latest.actions).toEqual([]);
});

it.each(["fetch", "body"])("ends a stalled update %s without claiming failure or applying its late receipt", async phase => {
  fetchMock.mockResolvedValueOnce(Response.json({ actions: [saved], count: 1, open_count: 1 }));
  await act(async () => root.render(<Harness />));
  let finish!: (value: unknown) => void;
  const stalled = new Promise(resolve => { finish = resolve; });
  fetchMock.mockImplementationOnce(() => phase === "fetch" ? stalled : { ok: true, json: () => stalled });
  let result: boolean | undefined;
  await act(async () => { void latest.update(saved.id, { status: "done" }).then(value => { result = value; }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(30001); });
  expect(result).toBe(false); expect(latest.updatingIds.size).toBe(0);
  expect(latest.updateError).toContain("결과를 확인할 수 없어요");
  expect(latest.actions[0].status).toBe("open");
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
  fetchMock.mockResolvedValueOnce(empty());
  await act(async () => useAuthStore.setState({ profile: { ...useAuthStore.getState().profile!, couple_id: "33333333-3333-4333-8333-333333333333" } }));
  const receipt = { action: { ...saved, status: "done" } };
  await act(async () => finish(phase === "fetch" ? Response.json(receipt) : receipt));
  expect(latest.actions).toEqual([]);
});

it("restores the approved fields and original request after a same-owner route remount", async () => {
  fetchMock.mockResolvedValue(empty());
  await act(async () => root.render(<Harness />));
  fetchMock.mockRejectedValueOnce(new TypeError("lost response"));
  const fields = { title: saved.title, description: "승인한 메모", due_date: "2027-10-01" };
  await act(async () => { expect(await latest.create(fields)).toBe(false); });
  const originalBody = fetchMock.mock.calls.find(call => call[1]?.method === "POST")![1].body;
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<Harness />));
  expect(latest).toMatchObject({ createLocked: true, pendingCreateFields: fields });
  expect(latest.updateError).toContain("이미 저장됐을 수 있어요");
  fetchMock.mockImplementationOnce((_url: unknown, init: RequestInit) => Response.json({ action: { ...saved, description: fields.description, dueDate: fields.due_date }, requestId: JSON.parse(String(init.body)).requestId, replayed: true }));
  await act(async () => { expect(await latest.create(fields)).toBe(true); });
  const posts = fetchMock.mock.calls.filter(call => call[1]?.method === "POST");
  expect(posts).toHaveLength(2); expect(posts[1][1].body).toBe(originalBody);
  expect(latest.createLocked).toBe(false);
});

it("purges approved private fields on an auth transition even with no mounted board", async () => {
  fetchMock.mockResolvedValue(empty());
  await act(async () => root.render(<Harness />));
  fetchMock.mockRejectedValueOnce(new TypeError("lost response"));
  await act(async () => latest.create({ title: saved.title }));
  await act(async () => root.unmount()); root = createRoot(host);
  const original = useAuthStore.getState();
  useAuthStore.getState().reset(); useAuthStore.setState(original);
  await act(async () => root.render(<Harness />));
  expect(latest).toMatchObject({ createLocked: false, pendingCreateFields: null });
});

it("serializes creation between two mounted boards in the same owner scope", async () => {
  let first!: ReturnType<typeof useAmoraPreparationActions>;
  let second!: ReturnType<typeof useAmoraPreparationActions>;
  function Pair() {
    const a = useAmoraPreparationActions(); const b = useAmoraPreparationActions();
    useEffect(() => { first = a; second = b; }, [a, b]); return null;
  }
  fetchMock.mockResolvedValue(empty());
  await act(async () => root.render(<Pair />));
  fetchMock.mockImplementationOnce(() => new Promise<never>(() => undefined));
  await act(async () => { void first.create({ title: saved.title }); });
  await act(async () => { expect(await second.create({ title: saved.title })).toBe(false); });
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(30_001));
  expect(second.createLocked).toBe(true);
});
