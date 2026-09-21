import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "../authStore";
import { useCommunityStore } from "../communityStore";
import type { Profile } from "@/types/database.types";
import { profileUpdateErrorMessage } from "@/lib/profileUpdateError";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
const fetchMock = vi.fn();
let owner = 0;
let profile: Profile;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useAuthStore.getState().reset();
  const id = `profile-recovery-${++owner}`;
  profile = { id, name: "이전 이름", role: "bride", couple_id: null, avatar_url: null,
    onboarding_completed: true, onboarding_step: 5, is_admin: false,
    created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z",
    care_notifications_enabled: true, care_notifications_consented_at: "2026-09-20T00:00:00Z" };
  useAuthStore.setState({ user: { id, email: "synthetic@example.invalid" }, profile, isDemo: false, isInitialized: true });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("ends a stalled profile fetch after 30 seconds as outcome unknown without another write", async () => {
  fetchMock.mockImplementation(() => new Promise<never>(() => undefined));
  let failure: unknown;
  void useAuthStore.getState().updateProfile({ name: "새 이름" }).catch(error => { failure = error; });
  await vi.advanceTimersByTimeAsync(30_001);
  expect(failure).toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  expect(useAuthStore.getState().profile?.name).toBe("이전 이름");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function seedCommunityNickname(nickname: string) {
  useCommunityStore.setState({ communityProfile: { user_id: profile.id, nickname, avatar_url: null,
    rank: "sprout", wedding_year: null, wedding_month: null, wedding_completed: false, progress_percent: 0,
    region: null, post_count: 0, comment_count: 0, total_upvotes_received: 0, warning_count: 0,
    is_suspended: false, created_at: "2026-09-20T00:00:00Z" } });
}

it("includes profile response-body parsing in the same 30-second deadline", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: () => new Promise<never>(() => undefined) });
  const result = useAuthStore.getState().updateProfile({ care_notifications_enabled: false }).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await result).toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  expect(useAuthStore.getState().profile?.care_notifications_enabled).toBe(true);
});

it("blocks a concurrent change both before and after timeout while the raw request remains pending", async () => {
  fetchMock.mockImplementation(() => new Promise<never>(() => undefined));
  const first = useAuthStore.getState().updateProfile({ care_notifications_enabled: false }).catch(error => error);
  let concurrent: unknown;
  void useAuthStore.getState().updateProfile({ name: "반대 변경" }).catch(error => { concurrent = error; });
  await vi.advanceTimersByTimeAsync(0);
  expect(concurrent).toMatchObject({ code: "PROFILE_UPDATE_IN_FLIGHT" });
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await first).toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  await expect(useAuthStore.getState().updateProfile({ care_notifications_enabled: true }))
    .rejects.toMatchObject({ code: "PROFILE_UPDATE_IN_FLIGHT" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reviews canonical profile and nickname after settlement, preserves newer avatar/role, and writes only on a later explicit call", async () => {
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const first = useAuthStore.getState().updateProfile({ name: "새 이름", sync_community_nickname: true }).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await first).toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  pending.resolve(Response.json({ profile: { ...profile, name: "늦은 응답" } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(useAuthStore.getState().profile?.name).toBe("이전 이름");
  useAuthStore.setState({ profile: { ...profile, avatar_url: "🌸", confirmed_role: "bride", confirmed_role_revision: "revision-5" } });
  seedCommunityNickname("기존 별명");
  fetchMock.mockResolvedValueOnce(Response.json({ profile: { ...profile, name: "서버 이름", avatar_url: "옛 사진", confirmed_role: "groom", confirmed_role_revision: "revision-1" } }))
    .mockResolvedValueOnce(Response.json({ profile: { user_id: profile.id, nickname: "서버 별명" } }));
  await expect(useAuthStore.getState().updateProfile({ name: "또 다른 이름" }))
    .rejects.toMatchObject({ code: "PROFILE_UPDATE_REVIEW_REQUIRED" });
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["PATCH", "GET", "GET"]);
  expect(useAuthStore.getState().profile).toMatchObject({ name: "서버 이름", avatar_url: "🌸", confirmed_role: "bride", confirmed_role_revision: "revision-5" });
  expect(useCommunityStore.getState().communityProfile?.nickname).toBe("서버 별명");
  fetchMock.mockResolvedValueOnce(Response.json({ profile: { ...profile, name: "검토한 이름" } }));
  await useAuthStore.getState().updateProfile({ name: "검토한 이름" });
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["PATCH", "GET", "GET", "PATCH"]);
});

it.each(["network", "server", "malformed", "body-error"])("treats %s as unknown and reviews before any further PATCH", async mode => {
  if (mode === "network") fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  else if (mode === "server") fetchMock.mockResolvedValueOnce(Response.json({ error: "server" }, { status: 500 }));
  else if (mode === "body-error") fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("invalid json"); } });
  else fetchMock.mockResolvedValueOnce(Response.json({ profile: { id: "another-owner" } }));
  await expect(useAuthStore.getState().updateProfile({ name: "불명확한 이름" }))
    .rejects.toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  fetchMock.mockResolvedValueOnce(Response.json({ profile }));
  await expect(useAuthStore.getState().updateProfile({ name: "후속 이름" }))
    .rejects.toMatchObject({ code: "PROFILE_UPDATE_REVIEW_REQUIRED" });
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["PATCH", "GET"]);
});

it("retains the owner lock across A-to-B-to-A while allowing B and rejects A's late result", async () => {
  const pending = deferred<Response>();
  const original = useAuthStore.getState();
  fetchMock.mockReturnValueOnce(pending.promise);
  const first = original.updateProfile({ name: "A 늦은 이름", sync_community_nickname: true }).catch(error => error);
  useAuthStore.getState().reset();
  const other = { ...profile, id: `${profile.id}-B`, name: "B" };
  useAuthStore.setState({ user: { id: other.id, email: "b@example.invalid" }, profile: other, isDemo: false });
  fetchMock.mockResolvedValueOnce(Response.json({ profile: { ...other, name: "B 새 이름" } }));
  await useAuthStore.getState().updateProfile({ name: "B 새 이름" });
  useAuthStore.setState(original);
  await expect(useAuthStore.getState().updateProfile({ name: "A 반대 이름" })).rejects.toMatchObject({ code: "PROFILE_UPDATE_IN_FLIGHT" });
  seedCommunityNickname("현재 별명");
  pending.resolve(Response.json({ profile: { ...profile, name: "A 늦은 이름" } }));
  expect(await first).toMatchObject({ message: expect.stringContaining("계정 상태가 바뀌었어요") });
  expect(useAuthStore.getState().profile?.name).toBe("이전 이름");
  expect(useCommunityStore.getState().communityProfile?.nickname).toBe("현재 별명");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockResolvedValueOnce(Response.json({ profile }))
    .mockResolvedValueOnce(Response.json({ profile: { user_id: profile.id, nickname: "현재 별명" } }));
  await expect(useAuthStore.getState().updateProfile({ name: "A 검토 전 변경" }))
    .rejects.toMatchObject({ code: "PROFILE_UPDATE_REVIEW_REQUIRED" });
});

it("bounds recovery body reads, preserves review state, and discards their late response", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(useAuthStore.getState().updateProfile({ name: "새 이름" })).rejects.toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  const staleBody = deferred<unknown>();
  fetchMock.mockResolvedValueOnce({ ok: true, json: () => staleBody.promise });
  const recovery = useAuthStore.getState().updateProfile({ name: "반대 이름" }).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await recovery).toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  fetchMock.mockResolvedValueOnce(Response.json({ profile: { ...profile, name: "정본" } }));
  await expect(useAuthStore.getState().updateProfile({ name: "반대 이름" })).rejects.toMatchObject({ code: "PROFILE_UPDATE_REVIEW_REQUIRED" });
  staleBody.resolve({ profile: { ...profile, name: "늦은 GET" } });
  await vi.advanceTimersByTimeAsync(0);
  expect(useAuthStore.getState().profile?.name).toBe("정본");
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["PATCH", "GET", "GET"]);
});

it("does not apply a recovery GET after account or same-owner couple changes", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(useAuthStore.getState().updateProfile({ name: "새 이름" })).rejects.toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const recovering = useAuthStore.getState().updateProfile({ name: "반대 이름" }).catch(error => error);
  useAuthStore.setState({ profile: { ...profile, couple_id: "new-couple", name: "현재" } });
  pending.resolve(Response.json({ profile: { ...profile, name: "옛 커플 응답" } }));
  expect(await recovering).toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  expect(useAuthStore.getState().profile).toMatchObject({ couple_id: "new-couple", name: "현재" });
});

it.each([400, 401, 403, 409, 429])("releases a definitively rejected HTTP %s request for a fresh explicit save", async status => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "거절" }, { status }));
  await expect(useAuthStore.getState().updateProfile({ name: "거절된 이름" })).rejects.toThrow("거절");
  fetchMock.mockResolvedValueOnce(Response.json({ profile: { ...profile, name: "새 이름" } }));
  await useAuthStore.getState().updateProfile({ name: "새 이름" });
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["PATCH", "PATCH"]);
});

it("does not release recovery when community readback stalls or belongs to another owner", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(useAuthStore.getState().updateProfile({ name: "새 이름", sync_community_nickname: true })).rejects.toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  seedCommunityNickname("기존 별명");
  fetchMock.mockResolvedValueOnce(Response.json({ profile: { ...profile, name: "서버 이름" } }))
    .mockResolvedValueOnce(Response.json({ profile: { user_id: "another-owner", nickname: "다른 사용자" } }));
  await expect(useAuthStore.getState().updateProfile({ name: "후속" })).rejects.toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  expect(useAuthStore.getState().profile?.name).toBe("이전 이름");
  expect(useCommunityStore.getState().communityProfile?.nickname).toBe("기존 별명");
  fetchMock.mockResolvedValueOnce(Response.json({ profile }))
    .mockImplementationOnce(() => new Promise<never>(() => undefined));
  const recovery = useAuthStore.getState().updateProfile({ name: "후속" }).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await recovery).toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  expect(fetchMock.mock.calls.filter(([, options]) => options.method === "PATCH")).toHaveLength(1);
});

it("maps only known profile codes to safe fixed copy", () => {
  const raw = "secret-provider-detail";
  expect(profileUpdateErrorMessage({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN", message: raw })).toBe("저장 결과를 아직 확인하지 못했어요. 잠시 후 다시 확인해 주세요. 확인 전에는 추가 저장하지 않아요.");
  expect(profileUpdateErrorMessage(new Error(raw))).toBeNull();
  expect(profileUpdateErrorMessage({ code: "unrecognized", message: raw })).toBeNull();
});

it("can review a nameless canonical profile after an uncertain care update", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(useAuthStore.getState().updateProfile({ care_notifications_enabled: false })).rejects.toMatchObject({ code: "PROFILE_UPDATE_OUTCOME_UNKNOWN" });
  fetchMock.mockResolvedValueOnce(Response.json({ profile: { ...profile, name: null, care_notifications_enabled: false, care_notifications_consented_at: null } }));
  await expect(useAuthStore.getState().updateProfile({ care_notifications_enabled: false })).rejects.toMatchObject({ code: "PROFILE_UPDATE_REVIEW_REQUIRED" });
  expect(useAuthStore.getState().profile).toMatchObject({ name: "", care_notifications_enabled: false, care_notifications_consented_at: null });
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["PATCH", "GET"]);
});
