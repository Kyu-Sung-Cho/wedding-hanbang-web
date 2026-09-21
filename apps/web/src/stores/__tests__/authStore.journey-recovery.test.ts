import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "../authStore";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
const USER = "11111111-1111-4111-8111-111111111111";
const COUPLE = "22222222-2222-4222-8222-222222222222";
const time = "2026-09-20T00:00:00.000Z";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useAuthStore.getState().reset();
  useAuthStore.setState({ user: { id: USER, email: "synthetic@example.invalid" }, profile: { id: USER, name: "합성", role: "bride", couple_id: COUPLE, avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: time, updated_at: time }, couple: { id: COUPLE, bride_id: USER, groom_id: null, invite_code: null, membership_sealed_at: null, created_at: time, updated_at: time }, partner: null, isDemo: false, isLoading: false, isInitialized: true, journey: { id: COUPLE, couple_id: COUPLE, wedding_date: null, venue: null, total_budget: 10000000, progress: {}, state_revision: 0, created_at: time, updated_at: time } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("ends a stalled manual save with an explicit outcome-unknown result", async () => {
  fetchMock.mockImplementation(() => new Promise<never>(() => undefined));
  let failure: unknown;
  void useAuthStore.getState().updateJourney({ total_budget: 12000000 }).catch(error => { failure = error; });
  await vi.advanceTimersByTimeAsync(30001);
  expect(failure).toMatchObject({ code: "PLAN_CHANGE_OUTCOME_UNKNOWN" });
  expect(useAuthStore.getState().journey?.total_budget).toBe(10000000);
});

const REQUEST = "44444444-4444-4444-8444-444444444444";
function applied(total = 12000000) {
  return Response.json({ status: "applied", requestId: REQUEST, journey: {
    ...useAuthStore.getState().journey!, total_budget: total, state_revision: 1,
  } });
}
async function loseResponse() {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(useAuthStore.getState().updateJourney({ total_budget: 12000000 }))
    .rejects.toMatchObject({ code: "PLAN_CHANGE_OUTCOME_UNKNOWN" });
}
it("includes stalled response-body parsing in the same deadline", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: () => new Promise<never>(() => undefined) });
  const result = useAuthStore.getState().updateJourney({ total_budget: 12000000 }).catch(error => error);
  await vi.advanceTimersByTimeAsync(30001);
  expect(await result).toMatchObject({ code: "PLAN_CHANGE_OUTCOME_UNKNOWN" });
});
it("replays the original envelope after canonical revision advances without rebasing", async () => {
  await loseResponse();
  const firstBody = fetchMock.mock.calls[0][1].body;
  useAuthStore.setState({ journey: { ...useAuthStore.getState().journey!, total_budget: 12000000, state_revision: 3 } });
  fetchMock.mockResolvedValueOnce(applied());
  await expect(useAuthStore.getState().updateJourney({ total_budget: 12000000 })).resolves.toMatchObject({ status: "applied" });
  expect(fetchMock.mock.calls[1][1].body).toBe(firstBody);
  expect(useAuthStore.getState().journey?.state_revision).toBe(3);
});
it("resolves an unknown old mutation before accepting a different input", async () => {
  await loseResponse();
  const firstBody = fetchMock.mock.calls[0][1].body;
  fetchMock.mockResolvedValueOnce(applied());
  await expect(useAuthStore.getState().updateJourney({ venue: "합성 장소" }))
    .rejects.toMatchObject({ code: "PLAN_CHANGE_PREVIOUS_RESOLVED" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].body).toBe(firstBody);
  expect(useAuthStore.getState().journey?.venue).toBeNull();
  expect(useAuthStore.getState().journey?.total_budget).toBe(12000000);
});
it("refuses a concurrent different-field mutation without overwriting the active request", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  const first = useAuthStore.getState().updateJourney({ total_budget: 12000000 });
  await expect(useAuthStore.getState().updateJourney({ venue: "두 번째" }))
    .rejects.toMatchObject({ code: "PLAN_CHANGE_IN_FLIGHT" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  resolve(applied());
  await first;
});
it("does not revive an old owner envelope after reset and A-to-B-to-A", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  const original = useAuthStore.getState();
  const first = original.updateJourney({ total_budget: 12000000 }).catch(error => error);
  useAuthStore.getState().reset();
  useAuthStore.setState(original);
  resolve(applied());
  expect(await first).toMatchObject({ code: "PLAN_CHANGE_IDENTITY_CHANGED" });
  expect(useAuthStore.getState().journey?.total_budget).toBe(10000000);
  fetchMock.mockResolvedValueOnce(applied(14000000));
  await useAuthStore.getState().updateJourney({ total_budget: 14000000 });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).total_budget).toBe(14000000);
});
it("ignores a late timed-out response while the identical retry is in progress", async () => {
  let oldResolve!: (value: Response) => void;
  let retryResolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { oldResolve = done; }))
    .mockImplementationOnce(() => new Promise<Response>(done => { retryResolve = done; }));
  const first = useAuthStore.getState().updateJourney({ total_budget: 12000000 }).catch(error => error);
  await vi.advanceTimersByTimeAsync(30001);
  expect(await first).toMatchObject({ code: "PLAN_CHANGE_OUTCOME_UNKNOWN" });
  const retry = useAuthStore.getState().updateJourney({ total_budget: 12000000 });
  oldResolve(applied(999));
  await vi.advanceTimersByTimeAsync(1);
  expect(useAuthStore.getState().journey?.total_budget).toBe(10000000);
  retryResolve(applied());
  await retry;
  expect(useAuthStore.getState().journey?.total_budget).toBe(12000000);
});

it.each([401, 403, 429])("does not forget an uncertain commit when its reconciliation receives HTTP %s", async status => {
  await loseResponse();
  const firstBody = fetchMock.mock.calls[0][1].body;
  fetchMock.mockResolvedValueOnce(Response.json({ error: "일시 차단" }, { status }));
  await expect(useAuthStore.getState().updateJourney({ total_budget: 12000000 }))
    .rejects.toMatchObject({ code: "PLAN_CHANGE_OUTCOME_UNKNOWN" });
  useAuthStore.setState({ journey: { ...useAuthStore.getState().journey!, state_revision: 2 } });
  fetchMock.mockResolvedValueOnce(applied());
  await useAuthStore.getState().updateJourney({ total_budget: 12000000 });
  expect(fetchMock.mock.calls[2][1].body).toBe(firstBody);
});
it("does not call malformed success a definite failure and retains its original body", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ status: "applied" }));
  await expect(useAuthStore.getState().updateJourney({ total_budget: 12000000 }))
    .rejects.toMatchObject({ code: "PLAN_CHANGE_OUTCOME_UNKNOWN" });
  const body = fetchMock.mock.calls[0][1].body;
  fetchMock.mockResolvedValueOnce(applied());
  await useAuthStore.getState().updateJourney({ total_budget: 12000000 });
  expect(fetchMock.mock.calls[1][1].body).toBe(body);
});
it("allows a reviewed new attempt after a definitive stale rejection", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ code: "PLAN_CHANGE_STALE", error: "stale" }, { status: 409 }));
  await expect(useAuthStore.getState().updateJourney({ total_budget: 12000000 }))
    .rejects.toMatchObject({ code: "PLAN_CHANGE_STALE" });
  useAuthStore.setState({ journey: { ...useAuthStore.getState().journey!, state_revision: 2 } });
  fetchMock.mockResolvedValueOnce(Response.json({ status: "applied", requestId: REQUEST, journey: { ...useAuthStore.getState().journey!, total_budget: 14000000, state_revision: 3 } }));
  await useAuthStore.getState().updateJourney({ total_budget: 14000000 });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ expected_revision: 2, total_budget: 14000000 });
});
