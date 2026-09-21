import { describe, it, expect, beforeEach, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

// Mock Supabase client before importing the store
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: supabaseMocks.signOut },
  }),
}));

// Mock window.location
Object.defineProperty(window, "location", {
  value: { href: "" },
  writable: true,
});

import { useAuthStore } from "../authStore";
import { useCommunityStore } from "../communityStore";
import type { Profile } from "@/types/database.types";

const mockFetch = vi.fn();
global.fetch = mockFetch;
const PLAN_CHANGE_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setCurrentAuthOwner(id: string, coupleId = "current-couple") {
  const profile: Profile = {
    id, name: id, role: "bride", couple_id: coupleId, avatar_url: null,
    onboarding_completed: true, onboarding_step: 5, is_admin: false,
    created_at: "2026-09-21T00:00:00.000Z", updated_at: "2026-09-21T00:00:00.000Z",
  };
  useCommunityStore.getState().bindViewer(id);
  useAuthStore.setState({
    user: { id, email: `${id}@example.invalid` }, profile,
    isDemo: false, isLoading: true, isInitialized: true,
  });
}

// Helper to set demo cookie
function setDemoCookie(value: boolean) {
  Object.defineProperty(document, "cookie", {
    writable: true,
    value: value ? "demo_mode=true" : "",
  });
}

// Reset store state between tests
function resetStore() {
  useAuthStore.setState({
    user: null,
    profile: null,
    partner: null,
    couple: null,
    journey: null,
    isLoading: false,
    isInitialized: false,
    isDemo: false,
  });
  useCommunityStore.getState().reset();
}

describe("useAuthStore", () => {
  beforeEach(() => {
    resetStore();
    sessionStorage.clear();
    localStorage.clear();
    supabaseMocks.signOut.mockReset().mockResolvedValue({});
    mockFetch.mockReset();
    setDemoCookie(false);
  });

  // ─── initialize() ───

  describe("initialize()", () => {
    it.each([503, 403])("공개 화면의 확인 요청은 HTTP %s를 로그아웃으로 확정하지 않는다", async (status) => {
      useAuthStore.setState({ user: { id: "existing", email: "existing@example.com" }, isInitialized: true });
      mockFetch.mockResolvedValue({ ok: false, status });
      await expect(useAuthStore.getState().initialize({ force: true, requireVerifiedSession: true })).rejects.toThrow();
      expect(useAuthStore.getState().user?.id).toBe("existing");
    });

    it("공개 화면의 네트워크 실패는 이전 계정을 확인 완료로 보고하지 않는다", async () => {
      useAuthStore.setState({ user: { id: "existing", email: "existing@example.com" }, isInitialized: true });
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(useAuthStore.getState().initialize({ force: true, requireVerifiedSession: true })).rejects.toThrow();
      expect(useAuthStore.getState().user?.id).toBe("existing");
    });

    it("공개 화면도 실제 401 응답은 비로그인 상태로 확인한다", async () => {
      useAuthStore.setState({ user: { id: "existing", email: "existing@example.com" }, isInitialized: true });
      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      await expect(useAuthStore.getState().initialize({ force: true, requireVerifiedSession: true })).resolves.toBeUndefined();
      expect(useAuthStore.getState().user).toBeNull();
    });

    it("uses a server-verified demo session immediately without waiting for auth/me", async () => {
      await useAuthStore.getState().initialize({ initialDemo: true });

      const state = useAuthStore.getState();
      expect(state.isDemo).toBe(true);
      expect(state.isInitialized).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.user?.id).toBe("demo");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sets isInitialized to true after completion", async () => {
      mockFetch.mockResolvedValue({ ok: false });
      await useAuthStore.getState().initialize();
      expect(useAuthStore.getState().isInitialized).toBe(true);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it("does not re-initialize if already initialized", async () => {
      useAuthStore.setState({ isInitialized: true });
      await useAuthStore.getState().initialize();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("populates user/profile/couple/journey on successful /api/auth/me", async () => {
      const fakeData = {
        user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", name: "테스터", email: "test@example.com" },
        couple: { id: "c1", invite_code: "WH-TEST" },
        partner: null,
        journey: { id: "j1", couple_id: "c1" },
      };
      mockFetch.mockResolvedValue({ ok: true, json: async () => fakeData });

      await useAuthStore.getState().initialize();
      const state = useAuthStore.getState();
      expect(state.user).toEqual(fakeData.user);
      expect(state.profile).toEqual(fakeData.profile);
      expect(state.couple).toEqual(fakeData.couple);
      expect(state.journey).toEqual(fakeData.journey);
      expect(state.isDemo).toBe(false);
    });

    it.each(["/api/profile/avatar/image?userId=u1&version=new", null])("keeps an avatar saved during auth initialization: %s", async (avatarUrl) => {
      const profile = { id: "u1", name: "이전 이름", couple_id: "c1", role: "bride", avatar_url: "🌷", care_notifications_enabled: true };
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" }, profile: profile as never, isInitialized: true });
      let finish!: (value: unknown) => void;
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

      const pending = useAuthStore.getState().initialize({ force: true });
      useAuthStore.setState({ profile: { ...profile, avatar_url: avatarUrl } as never });
      finish({ ok: true, json: async () => ({ user: { id: "u1", email: "test@example.com" },
        profile: { ...profile, name: "서버 이름", care_notifications_enabled: false }, couple: null, partner: null, journey: null }) });
      await pending;

      expect(useAuthStore.getState().profile).toMatchObject({ avatar_url: avatarUrl, name: "서버 이름", care_notifications_enabled: false });
    });

    it("accepts the remote avatar when only another local profile field changed during initialization", async () => {
      const profile = { id: "u1", name: "이전 이름", couple_id: "c1", role: "bride", avatar_url: "🌷" };
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" }, profile: profile as never, isInitialized: true });
      let finish!: (value: unknown) => void;
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = useAuthStore.getState().initialize({ force: true });
      useAuthStore.setState({ profile: { ...profile, name: "변경한 이름" } as never });
      finish({ ok: true, json: async () => ({ user: { id: "u1", email: "test@example.com" },
        profile: { ...profile, name: "변경한 이름", avatar_url: "🌸" }, couple: null, partner: null, journey: null }) });
      await pending;
      expect(useAuthStore.getState().profile?.avatar_url).toBe("🌸");
    });

    it.each(["different user", "new binding with the same user"])("does not apply an old initialization snapshot to %s", async (scenario) => {
      const profile = { id: "u1", name: "이전 계정", couple_id: "c1", role: "bride", avatar_url: "🌷" };
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" }, profile: profile as never, isInitialized: true });
      let finish!: (value: unknown) => void;
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = useAuthStore.getState().initialize({ force: true });
      const nextId = scenario === "different user" ? "u2" : "u1";
      useAuthStore.setState({ user: { id: "u2", email: "other@example.com" }, profile: { ...profile, id: "u2", avatar_url: "💐" } as never });
      if (scenario === "new binding with the same user") {
        useAuthStore.setState({ user: { id: "u1", email: "test@example.com" }, profile: { ...profile, avatar_url: "🌸" } as never });
      }
      const current = useAuthStore.getState();
      const serverProfile = { ...profile, id: nextId, avatar_url: "🤍", care_notifications_enabled: false };
      finish({ ok: true, json: async () => ({ user: { id: nextId, email: "verified@example.com" },
        profile: serverProfile, couple: null, partner: null, journey: null }) });
      await pending;
      expect(useAuthStore.getState()).toEqual(current);
    });

    it("does not let a late initialize response replace a newer journey refresh", async () => {
      useAuthStore.setState({
        user: { id: "u1", email: "test@example.com" },
        journey: { id: "initial", couple_id: "c1" } as never,
        isInitialized: true,
      });

      type AuthMeResponse = {
        ok: boolean;
        json: () => Promise<{
          user: { id: string; email: string };
          profile: null;
          couple: { id: string };
          partner: null;
          journey: { id: string; couple_id: string };
        }>;
      };
      let resolveInitialize!: (value: AuthMeResponse) => void;
      const initializeResponse = new Promise<AuthMeResponse>((resolve) => {
        resolveInitialize = resolve;
      });
      mockFetch
        .mockReturnValueOnce(initializeResponse)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            user: { id: "u1" },
            journey: { id: "newer", couple_id: "c1" },
          }),
        });

      const initialize = useAuthStore.getState().initialize({ force: true });
      await expect(
        useAuthStore.getState().refreshJourney("u1"),
      ).resolves.toBe(true);

      resolveInitialize({
        ok: true,
        json: async () => ({
          user: { id: "u1", email: "test@example.com" },
          profile: null,
          couple: { id: "c1" },
          partner: null,
          journey: { id: "older", couple_id: "c1" },
        }),
      });
      await initialize;

      expect(useAuthStore.getState().journey?.id).toBe("newer");
    });

    it.each([200, 401, 503])("does not accept an unsigned demo marker after auth HTTP %s", async (status) => {
      setDemoCookie(true);
      mockFetch.mockResolvedValue({ ok: status === 200, status, json: async () => ({ user: null }) });

      await useAuthStore.getState().initialize();
      const state = useAuthStore.getState();
      expect(state.isDemo).toBe(false);
      expect(state.user).toBeNull();
      expect(state.profile).toBeNull();
      expect(useCommunityStore.getState().viewerId).toBeNull();
    });

    it("does not accept an unsigned demo marker when auth fetch fails", async () => {
      setDemoCookie(true);
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      await useAuthStore.getState().initialize();
      const state = useAuthStore.getState();
      expect(state.isDemo).toBe(false);
      expect(state.user).toBeNull();
      expect(state.profile).toBeNull();
      expect(state.isInitialized).toBe(true);
      expect(useCommunityStore.getState().viewerId).toBeNull();
    });

    it.each([
      { marker: false, requireVerifiedSession: false },
      { marker: true, requireVerifiedSession: false },
      { marker: false, requireVerifiedSession: true },
      { marker: true, requireVerifiedSession: true },
    ])("accepts only a successful server-verified demo response, marker=$marker verified=$requireVerifiedSession", async ({ marker, requireVerifiedSession }) => {
      setDemoCookie(marker);
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ user: null, demo: true }) });

      await useAuthStore.getState().initialize({ requireVerifiedSession });

      expect(useAuthStore.getState()).toMatchObject({
        user: { id: "demo" }, profile: { id: "demo" }, couple: { id: "demo-couple" },
        journey: { id: "demo-journey" }, partner: null,
        isDemo: true, isInitialized: true, isLoading: false,
      });
      expect(useCommunityStore.getState().viewerId).toBe("demo");
    });

    it.each([
      { user: null, demo: false },
      { user: null, demo: "true" },
      { user: null, demo: 1 },
      { demo: true },
      { user: false, demo: true },
    ])("does not treat an ambiguous demo response as verified: %j", async (data) => {
      setDemoCookie(true);
      mockFetch.mockResolvedValue({ ok: true, json: async () => data });

      await useAuthStore.getState().initialize();

      expect(useAuthStore.getState()).toMatchObject({ user: null, profile: null, isDemo: false });
      expect(useCommunityStore.getState().viewerId).toBeNull();
    });

    it("does not accept demo data inside a rejected auth response", async () => {
      setDemoCookie(true);
      mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ user: null, demo: true }) });

      await useAuthStore.getState().initialize({ requireVerifiedSession: true });

      expect(useAuthStore.getState()).toMatchObject({ user: null, profile: null, isDemo: false });
    });

    it.each([
      { kind: "demo fetch", transition: "new owner" },
      { kind: "demo body", transition: "new owner" },
      { kind: "demo body", transition: "A-B-A" },
      { kind: "demo body", transition: "new couple" },
      { kind: "401", transition: "new owner" },
      { kind: "network failure", transition: "new owner" },
      { kind: "body failure", transition: "new owner" },
    ])("ignores stale no-user auth $kind after $transition", async ({ kind, transition }) => {
      setDemoCookie(true);
      setCurrentAuthOwner("owner-a");
      const delayed = deferred<unknown>();
      const readsBody = kind === "demo body" || kind === "body failure";
      mockFetch.mockReturnValueOnce(readsBody
        ? Promise.resolve({ ok: true, json: () => delayed.promise })
        : delayed.promise);
      const pending = useAuthStore.getState().initialize({ force: true });
      await Promise.resolve();

      if (transition === "new couple") setCurrentAuthOwner("owner-a", "new-couple");
      else {
        setCurrentAuthOwner("owner-b");
        if (transition === "A-B-A") setCurrentAuthOwner("owner-a");
      }
      const current = useAuthStore.getState();
      const viewer = useCommunityStore.getState().viewerId;
      if (kind.includes("failure")) delayed.reject(new TypeError("Failed to fetch"));
      else if (readsBody) delayed.resolve({ user: null, demo: true });
      else delayed.resolve({ ok: kind !== "401", status: kind === "401" ? 401 : 200,
        json: async () => ({ user: null, demo: true }) });
      await pending;

      expect(useAuthStore.getState()).toEqual(current);
      expect(useCommunityStore.getState().viewerId).toBe(viewer);
    });

    it.each(["demo", "network failure"])("rejects a stale verified-session %s check without changing the newer owner", async (kind) => {
      setCurrentAuthOwner("owner-a");
      const delayed = deferred<unknown>();
      mockFetch.mockReturnValueOnce(delayed.promise);
      const pending = useAuthStore.getState().initialize({ force: true, requireVerifiedSession: true });
      const rejected = expect(pending).rejects.toThrow();
      setCurrentAuthOwner("owner-b");
      const current = useAuthStore.getState();
      if (kind === "network failure") delayed.reject(new TypeError("Failed to fetch"));
      else delayed.resolve({ ok: true, json: async () => ({ user: null, demo: true }) });
      await rejected;

      expect(useAuthStore.getState()).toEqual(current);
      expect(useCommunityStore.getState().viewerId).toBe("owner-b");
    });

    it.each([
      { stage: "fetch", transition: "new owner", requireVerifiedSession: false },
      { stage: "body", transition: "new owner", requireVerifiedSession: false },
      { stage: "body", transition: "A-B-A", requireVerifiedSession: false },
      { stage: "body", transition: "new couple", requireVerifiedSession: false },
      { stage: "body", transition: "new owner", requireVerifiedSession: true },
    ])("ignores stale real-user auth $stage after $transition, verified=$requireVerifiedSession", async ({ stage, transition, requireVerifiedSession }) => {
      setDemoCookie(true);
      setCurrentAuthOwner("owner-a");
      const oldResponse = {
        user: useAuthStore.getState().user, profile: useAuthStore.getState().profile,
        couple: null, partner: null, journey: null,
      };
      const delayed = deferred<unknown>();
      mockFetch.mockReturnValueOnce(stage === "body"
        ? Promise.resolve({ ok: true, json: () => delayed.promise })
        : delayed.promise);
      const pending = useAuthStore.getState().initialize({ force: true, requireVerifiedSession });
      const completion = requireVerifiedSession ? expect(pending).rejects.toThrow() : pending;
      await Promise.resolve();
      if (transition === "new couple") setCurrentAuthOwner("owner-a", "new-couple");
      else {
        setCurrentAuthOwner("owner-b");
        if (transition === "A-B-A") setCurrentAuthOwner("owner-a");
      }
      const current = useAuthStore.getState();
      const viewer = useCommunityStore.getState().viewerId;
      if (stage === "body") delayed.resolve(oldResponse);
      else delayed.resolve({ ok: true, json: async () => oldResponse });
      await completion;

      expect(useAuthStore.getState()).toEqual(current);
      expect(useCommunityStore.getState().viewerId).toBe(viewer);
      expect(document.cookie).toBe("demo_mode=true");
    });

    it.each(["new initialization", "reset"])("does not restore demo after a %s supersedes the request", async (transition) => {
      const delayed = deferred<unknown>();
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => delayed.promise });
      const pending = useAuthStore.getState().initialize();
      await Promise.resolve();
      if (transition === "reset") useAuthStore.getState().reset();
      else {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: "new-owner", email: "new@example.invalid" } }) });
        await useAuthStore.getState().initialize({ force: true });
      }
      const current = useAuthStore.getState();
      const viewer = useCommunityStore.getState().viewerId;
      delayed.resolve({ user: null, demo: true });
      await pending;

      expect(useAuthStore.getState()).toEqual(current);
      expect(useCommunityStore.getState().viewerId).toBe(viewer);
    });

    it("remains unauthenticated when fetch fails and no demo cookie", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await useAuthStore.getState().initialize();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isDemo).toBe(false);
      expect(state.isInitialized).toBe(true);
    });

    it("keeps the current real user when auth fails despite an unsigned demo marker", async () => {
      setCurrentAuthOwner("real-user");
      setDemoCookie(true);
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      await useAuthStore.getState().initialize({ force: true });

      expect(useAuthStore.getState()).toMatchObject({
        user: { id: "real-user" }, profile: { id: "real-user" },
        isDemo: false, isLoading: false, isInitialized: true,
      });
      expect(useCommunityStore.getState().viewerId).toBe("real-user");
    });

    it("prefers real user over demo mode when real user exists", async () => {
      setDemoCookie(true);
      const fakeData = {
        user: { id: "real-user", email: "real@example.com" },
        demo: true,
        profile: null,
        couple: null,
        partner: null,
        journey: null,
      };
      mockFetch.mockResolvedValue({ ok: true, json: async () => fakeData });

      await useAuthStore.getState().initialize();
      const state = useAuthStore.getState();
      expect(state.isDemo).toBe(false);
      expect(state.user?.id).toBe("real-user");
      expect(document.cookie).toBe("demo_mode=; path=/; max-age=0");
    });
  });

  describe.each(["initialize", "refreshJourney"] as const)("%s avatar projection", (operation) => {
    it.each([
      { label: "unavailable lookup", fields: {}, partnerId: "p1", expectedOwn: "🌷", expectedPartner: "💐" },
      { label: "explicit initial reset", fields: { avatar_url: null }, partnerId: "p1", expectedOwn: null, expectedPartner: null },
      { label: "new partner", fields: {}, partnerId: "p2", expectedOwn: "🌷", expectedPartner: undefined },
    ])("handles $label without sharing a former partner's avatar", async ({ fields, partnerId, expectedOwn, expectedPartner }) => {
      const profile = { id: "u1", name: "이전 이름", couple_id: "c1", role: "bride", avatar_url: "🌷" };
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" }, profile: profile as never,
        partner: { id: "p1", name: "상대", couple_id: "c1", role: "groom", avatar_url: "💐" },
        couple: { id: "c1" } as never, journey: { id: "j1", couple_id: "c1" } as never, isInitialized: true });
      let finish!: (value: unknown) => void;
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = operation === "initialize"
        ? useAuthStore.getState().initialize({ force: true })
        : useAuthStore.getState().refreshJourney("u1");
      useAuthStore.setState({ profile: { ...profile, name: "변경한 이름" } as never });
      finish({ ok: true, json: async () => ({ user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", name: "변경한 이름", couple_id: "c1", role: "bride", ...fields },
        partner: { id: partnerId, name: "상대", couple_id: "c1", role: "groom", ...fields },
        couple: { id: "c1" }, journey: { id: "j1", couple_id: "c1" } }) });
      await pending;
      expect(useAuthStore.getState().profile?.avatar_url).toBe(expectedOwn);
      expect(useAuthStore.getState().partner?.id).toBe(partnerId);
      expect(useAuthStore.getState().partner?.avatar_url).toBe(expectedPartner);
    });
  });

  // ─── updateJourney() ───

  describe("updateJourney()", () => {
    beforeEach(() => {
      useAuthStore.setState({
        user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", couple_id: "c1" } as never,
        couple: { id: "c1" } as never,
      });
    });

    it("updates local state only in demo mode", async () => {
      useAuthStore.setState({
        isDemo: true,
        journey: { id: "j1", couple_id: "c1", wedding_date: "2026-10-01", total_budget: 10_000_000, venue: null, progress: {}, created_at: "", updated_at: "" },
      });

      const result = await useAuthStore.getState().updateJourney({
        wedding_date: "2026-12-01",
      });
      expect(useAuthStore.getState().journey?.wedding_date).toBe("2026-12-01");
      expect(result.status).toBe("applied");
      expect(useAuthStore.getState().journey?.state_revision).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls /api/journey PATCH in non-demo mode", async () => {
      const updatedJourney = {
        id: "j1",
        couple_id: "c1",
        wedding_date: "2026-12-01",
        state_revision: 1,
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "applied",
          requestId: PLAN_CHANGE_REQUEST_ID,
          journey: updatedJourney,
        }),
      });

      useAuthStore.setState({ isDemo: false, journey: { id: "j1", couple_id: "c1" } as never });
      await useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" });

      expect(mockFetch).toHaveBeenCalledWith("/api/journey", expect.objectContaining({ method: "PATCH" }));
      expect(lastFetchBody()).toMatchObject({ expected_couple_id: "c1", expected_revision: 0 });
      expect(useAuthStore.getState().journey?.wedding_date).toBe("2026-12-01");
    });

    it("binds an old form to its original couple even when another device has switched to a couple with the same revision", async () => {
      const originalJourney = { id: "j1", couple_id: "c1", state_revision: 7, venue: "원래 예식장" };
      const otherCoupleJourney = { id: "j2", couple_id: "c2", state_revision: 7, venue: "새 커플 예식장" };
      useAuthStore.setState({ journey: originalJourney as never });
      mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        // 다른 기기의 연결 변경은 로컬 store에 아직 오지 않았다.
        const requestedCouple = body.expected_couple_id ?? otherCoupleJourney.couple_id;
        if (requestedCouple !== otherCoupleJourney.couple_id) {
          return { ok: false, json: async () => ({ code: "PLAN_CHANGE_IDENTITY_CHANGED", error: "커플 연결 상태가 바뀌었어요." }) };
        }
        otherCoupleJourney.venue = String(body.venue);
        return { ok: true, json: async () => ({ status: "applied", requestId: PLAN_CHANGE_REQUEST_ID, journey: { ...otherCoupleJourney, state_revision: 8 } }) };
      });

      await expect(useAuthStore.getState().updateJourney({ venue: "이전 화면의 초안" })).rejects.toMatchObject({ code: "PLAN_CHANGE_IDENTITY_CHANGED" });
      expect(lastFetchBody()).toMatchObject({ expected_couple_id: "c1", expected_revision: 7 });
      expect(otherCoupleJourney.venue).toBe("새 커플 예식장");
      expect(useAuthStore.getState().journey).toEqual(originalJourney);
    });

    it.each(["missing journey couple", "changed couple", "changed profile", "missing user"])("does not dispatch a form with %s", async (scenario) => {
      useAuthStore.setState({ journey: { id: "j1", couple_id: "c1", state_revision: 7 } as never });
      if (scenario === "missing journey couple") useAuthStore.setState({ journey: { id: "j1", state_revision: 7 } as never });
      if (scenario === "changed couple") useAuthStore.setState({ couple: { id: "c2" } as never });
      if (scenario === "changed profile") useAuthStore.setState({ profile: { id: "u1", couple_id: "c2" } as never });
      if (scenario === "missing user") useAuthStore.setState({ user: null });
      await expect(useAuthStore.getState().updateJourney({ venue: "이전 화면의 초안" })).rejects.toMatchObject({ code: "PLAN_CHANGE_IDENTITY_CHANGED" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not apply or report a late receipt after the same user changes couples", async () => {
      const originalJourney = { id: "j1", couple_id: "c1", state_revision: 7 };
      const newJourney = { id: "j2", couple_id: "c2", state_revision: 7 };
      useAuthStore.setState({ journey: originalJourney as never });
      let resolvePatch!: (response: unknown) => void;
      mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolvePatch = resolve; }));
      const save = useAuthStore.getState().updateJourney({ venue: "원래 커플 예식장" });
      useAuthStore.setState({ profile: { id: "u1", couple_id: "c2" } as never, couple: { id: "c2" } as never, journey: newJourney as never });
      resolvePatch({ ok: true, json: async () => ({ status: "applied", requestId: PLAN_CHANGE_REQUEST_ID, journey: { ...originalJourney, state_revision: 8 } }) });
      await expect(save).rejects.toMatchObject({ code: "PLAN_CHANGE_IDENTITY_CHANGED" });
      expect(useAuthStore.getState().journey).toEqual(newJourney);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("keeps shared state unchanged while a partner approval is pending", async () => {
      const originalJourney = {
        id: "j1",
        couple_id: "c1",
        wedding_date: "2026-10-01",
        total_budget: 10_000_000,
        venue: null,
        progress: {},
        state_revision: 4,
        created_at: "",
        updated_at: "",
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "pending_partner",
          requestId: PLAN_CHANGE_REQUEST_ID,
          summary: "총예산을 3,000만원으로 변경",
        }),
      });
      useAuthStore.setState({ isDemo: false, journey: originalJourney });

      const result = await useAuthStore.getState().updateJourney({
        total_budget: 30_000_000,
      });

      expect(result).toEqual({
        status: "pending_partner",
        requestId: PLAN_CHANGE_REQUEST_ID,
        summary: "총예산을 3,000만원으로 변경",
      });
      expect(useAuthStore.getState().journey).toEqual(originalJourney);
      expect(lastFetchBody()).toMatchObject({
        total_budget: 30_000_000,
        expected_revision: 4,
      });
    });

    it.each([
      [
        "a malformed pending request id",
        {
          status: "pending_partner",
          requestId: "not-a-request-id",
          summary: "총예산 변경",
        },
      ],
      [
        "an applied journey for another couple",
        {
          status: "applied",
          requestId: PLAN_CHANGE_REQUEST_ID,
          journey: {
            couple_id: "another-couple",
            state_revision: 5,
          },
        },
      ],
      [
        "an applied journey that did not advance the revision",
        {
          status: "applied",
          requestId: PLAN_CHANGE_REQUEST_ID,
          journey: {
            couple_id: "c1",
            state_revision: 4,
          },
        },
      ],
    ])("fails closed on %s", async (_label, payload) => {
      const originalJourney = {
        id: "j1",
        couple_id: "c1",
        wedding_date: "2026-10-01",
        total_budget: 10_000_000,
        venue: null,
        progress: {},
        state_revision: 4,
        created_at: "",
        updated_at: "",
      };
      useAuthStore.setState({ isDemo: false, journey: originalJourney });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => payload,
      });

      await expect(
        useAuthStore.getState().updateJourney({
          total_budget: 30_000_000,
        }),
      ).rejects.toMatchObject({ code: "PLAN_CHANGE_OUTCOME_UNKNOWN" });
      expect(useAuthStore.getState().journey).toEqual(originalJourney);
    });

    it("reconciles instead of applying a late stale PATCH response", async () => {
      useAuthStore.setState({
        user: { id: "u1", email: "test@example.com" },
        isDemo: false,
        journey: {
          id: "initial",
          couple_id: "c1",
          wedding_date: "2026-10-01",
        } as never,
      });

      type JourneyResponse = {
        ok: boolean;
        json: () => Promise<{
          status: "applied";
          requestId: string;
          journey: { id: string; couple_id: string; state_revision: number };
          user?: { id: string };
        }>;
      };
      let resolvePatch!: (value: JourneyResponse) => void;
      const patchResponse = new Promise<JourneyResponse>((resolve) => {
        resolvePatch = resolve;
      });
      mockFetch
        .mockReturnValueOnce(patchResponse)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            user: { id: "u1" },
            journey: { id: "newer-refresh", couple_id: "c1" },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            user: { id: "u1" },
            journey: { id: "reconciled", couple_id: "c1" },
          }),
        });

      const patch = useAuthStore.getState().updateJourney({
        wedding_date: "2026-12-01",
      });
      await expect(
        useAuthStore.getState().refreshJourney("u1"),
      ).resolves.toBe(true);

      resolvePatch({
        ok: true,
        json: async () => ({
          status: "applied",
          requestId: PLAN_CHANGE_REQUEST_ID,
          journey: {
            id: "late-stale-patch",
            couple_id: "c1",
            state_revision: 1,
          },
        }),
      });
      await patch;

      await vi.waitFor(() => {
        expect(useAuthStore.getState().journey?.id).toBe("reconciled");
      });
      expect(useAuthStore.getState().journey?.id).not.toBe(
        "late-stale-patch",
      );
    });

    it("propagates PATCH failure so the editor cannot report false success", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      useAuthStore.setState({ isDemo: false, journey: { id: "j1", couple_id: "c1" } as never });

      await expect(
        useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" }),
      ).rejects.toMatchObject({ code: "PLAN_CHANGE_OUTCOME_UNKNOWN" });
    });

    it("fails explicitly when journey is null in demo mode", async () => {
      useAuthStore.setState({ isDemo: true, journey: null });
      await expect(
        useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" }),
      ).rejects.toThrow("결혼 준비 정보를 찾을 수 없습니다.");
      expect(useAuthStore.getState().journey).toBeNull();
    });

    // ─── progress diff→patch (커플 동시수정 유실 방지 회귀) ───

    function setJourneyWithProgress(progress: Record<string, unknown>) {
      useAuthStore.setState({
        isDemo: false,
        journey: {
          id: "j1", couple_id: "c1", wedding_date: null, total_budget: 0,
          venue: null, progress, created_at: "", updated_at: "",
        } as never,
      });
    }

    function lastFetchBody(): Record<string, unknown> {
      const [, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      return JSON.parse((init as { body: string }).body);
    }

    it("progress 전체가 아니라 변경된 키만 progress_patch로 보낸다", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "applied",
          requestId: PLAN_CHANGE_REQUEST_ID,
          journey: { couple_id: "c1", state_revision: 1 },
        }),
      });
      setJourneyWithProgress({
        venue: { category: "venue", status: "in_progress", budget: 100 },
        studio: { category: "studio", status: "not_started" },
      });

      const prev = useAuthStore.getState().journey!.progress as Record<string, unknown>;
      await useAuthStore.getState().updateJourney({
        progress: { ...prev, venue: { category: "venue", status: "in_progress", budget: 200 } } as never,
      });

      const body = lastFetchBody();
      expect(body.progress).toBeUndefined();
      expect(body.progress_patch).toEqual({ venue: { category: "venue", status: "in_progress", budget: 200 } });
      expect(body.progress_remove_keys).toEqual([]);
      expect(body.expected_revision).toBe(0);
      // 변경 안 된 studio는 patch에 포함되지 않는다 (스테일 롤백 방지의 핵심)
      expect((body.progress_patch as Record<string, unknown>).studio).toBeUndefined();
    });

    it("스냅샷에서 삭제된 키는 progress_remove_keys로 보낸다", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "applied",
          requestId: PLAN_CHANGE_REQUEST_ID,
          journey: { couple_id: "c1", state_revision: 1 },
        }),
      });
      setJourneyWithProgress({
        venue: { category: "venue", status: "in_progress" },
        custom_123: { category: "custom_123", label: "웨딩카" },
      });

      const prev = useAuthStore.getState().journey!.progress as Record<string, unknown>;
      const next = { ...prev } as Record<string, unknown>;
      delete next.custom_123;
      await useAuthStore.getState().updateJourney({ progress: next as never });

      const body = lastFetchBody();
      expect(body.progress_patch).toEqual({});
      expect(body.progress_remove_keys).toEqual(["custom_123"]);
    });

    it("progress 변경이 전혀 없고 다른 필드도 없으면 네트워크 호출을 생략한다", async () => {
      setJourneyWithProgress({ venue: { category: "venue", status: "in_progress" } });
      const prev = useAuthStore.getState().journey!.progress as Record<string, unknown>;

      await useAuthStore.getState().updateJourney({ progress: { ...prev } as never });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("progress와 total_budget을 함께 보내면 patch와 다른 필드가 공존한다", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "applied",
          requestId: PLAN_CHANGE_REQUEST_ID,
          journey: { couple_id: "c1", state_revision: 1 },
        }),
      });
      setJourneyWithProgress({});

      await useAuthStore.getState().updateJourney({
        total_budget: 50_000_000,
        progress: { ring: { category: "ring", status: "completed" } } as never,
      });

      const body = lastFetchBody();
      expect(body.total_budget).toBe(50_000_000);
      expect(body.progress_patch).toEqual({ ring: { category: "ring", status: "completed" } });
      expect(body.progress).toBeUndefined();
    });
  });

  // ─── updateJourneyLocal() ───

  describe("refreshJourney()", () => {
    it.each(["profile PATCH", "settings direct set", "new couple snapshot"])("preserves a later scalar profile save during %s without losing refreshed budget", async (scenario) => {
      const oldProfile = { id: "u1", couple_id: "c1", role: "bride", name: "이전 이름", care_notifications_enabled: true };
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" }, profile: oldProfile as never,
        couple: { id: "c1" } as never, journey: { id: "j1", couple_id: "c1", total_budget: 10_000_000 } as never });
      let finishRefresh!: (value: unknown) => void;
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
      const refreshing = useAuthStore.getState().refreshJourney("u1");
      const savedProfile = { ...oldProfile, name: "저장한 이름", care_notifications_enabled: false };
      if (scenario === "profile PATCH") {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ profile: savedProfile }) });
        await useAuthStore.getState().updateProfile({ name: savedProfile.name, care_notifications_enabled: false });
      } else {
        useAuthStore.setState({ profile: savedProfile as never });
      }
      const coupleId = scenario === "new couple snapshot" ? "c2" : "c1";
      const role = scenario === "new couple snapshot" ? "groom" : "bride";
      finishRefresh({ ok: true, json: async () => ({ user: { id: "u1" }, profile: { ...oldProfile, couple_id: coupleId, role },
        couple: { id: coupleId }, partner: null, journey: { id: "fresh", couple_id: coupleId, total_budget: 35_000_000 } }) });
      await expect(refreshing).resolves.toBe(true);
      expect(useAuthStore.getState().profile).toMatchObject({ name: "저장한 이름", care_notifications_enabled: false, couple_id: coupleId, role });
      expect(useAuthStore.getState().journey).toMatchObject({ id: "fresh", couple_id: coupleId, total_budget: 35_000_000 });
      expect(useAuthStore.getState().couple?.id).toBe(coupleId);
    });

    it("rejects an old refresh after a profile binding changes and returns to the same object", async () => {
      const profile = { id: "u1", couple_id: "c1", role: "bride" };
      const journey = { id: "current", couple_id: "c1" };
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" }, profile: profile as never,
        couple: { id: "c1" } as never, journey: journey as never });
      let finishRefresh!: (value: unknown) => void;
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
      const refreshing = useAuthStore.getState().refreshJourney("u1");
      useAuthStore.setState({ profile: { ...profile, couple_id: "c2" } as never });
      useAuthStore.setState({ profile: profile as never });
      finishRefresh({ ok: true, json: async () => ({ user: { id: "u1" }, profile,
        couple: { id: "c1" }, partner: null, journey: { id: "stale", couple_id: "c1" } }) });
      await expect(refreshing).resolves.toBe(false);
      expect(useAuthStore.getState().journey).toBe(journey);
    });

    it("atomically refreshes the same user's profile with their new couple and journey", async () => {
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", couple_id: "c1", role: "bride" } as never,
        couple: { id: "c1" } as never, journey: { id: "j1", couple_id: "c1" } as never });
      const profile = { id: "u1", couple_id: "c2", role: "groom" };
      const observations: string[] = [];
      const unsubscribe = useAuthStore.subscribe(state => observations.push(`${state.profile?.couple_id}:${state.couple?.id}:${state.journey?.couple_id}`));
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ user: { id: "u1" }, profile,
        couple: { id: "c2" }, partner: null, journey: { id: "j2", couple_id: "c2" } }) });
      try {
        await expect(useAuthStore.getState().refreshJourney("u1")).resolves.toBe(true);
        expect(useAuthStore.getState().profile).toEqual(profile);
        expect(observations).toEqual(["c2:c2:c2"]);
      } finally { unsubscribe(); }
    });

    it.each([
      { id: "u2", couple_id: "c2", role: "bride" },
      { id: "u1", couple_id: "c1", role: "bride" },
      null,
    ])("rejects a mismatched profile without partially replacing the journey: %j", async (profile) => {
      const currentProfile = { id: "u1", couple_id: "c1", role: "bride" };
      const journey = { id: "j1", couple_id: "c1" };
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" }, profile: currentProfile as never, journey: journey as never });
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ user: { id: "u1" }, profile,
        couple: { id: "c2" }, partner: null, journey: { id: "j2", couple_id: "c2" } }) });
      await expect(useAuthStore.getState().refreshJourney("u1")).resolves.toBe(false);
      expect(useAuthStore.getState().profile).toBe(currentProfile);
      expect(useAuthStore.getState().journey).toBe(journey);
    });

    it("does not restore an old profile after a newer couple refresh settles before initialize", async () => {
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", couple_id: "c1", role: "bride" } as never,
        couple: { id: "c1" } as never, journey: { id: "j1", couple_id: "c1" } as never, isInitialized: true });
      let finishInitialize!: (value: unknown) => void;
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { finishInitialize = resolve; }))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: "u1" },
          profile: { id: "u1", couple_id: "c2", role: "bride" }, couple: { id: "c2" }, partner: null,
          journey: { id: "j2", couple_id: "c2" } }) });
      const initialize = useAuthStore.getState().initialize({ force: true });
      await useAuthStore.getState().refreshJourney("u1");
      finishInitialize({ ok: true, json: async () => ({ user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", couple_id: "c1", role: "bride" }, couple: { id: "c1" }, partner: null,
        journey: { id: "j1", couple_id: "c1" } }) });
      await initialize;
      expect(useAuthStore.getState().profile?.couple_id).toBe("c2");
      expect(useAuthStore.getState().couple?.id).toBe("c2");
      expect(useAuthStore.getState().journey?.couple_id).toBe("c2");
    });

    it("clears a verified unlink snapshot atomically without retaining the former partner", async () => {
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", couple_id: "c1", role: "bride" } as never,
        partner: { id: "former-partner" } as never, couple: { id: "c1" } as never,
        journey: { id: "j1", couple_id: "c1" } as never });
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ user: { id: "u1" },
        profile: { id: "u1", couple_id: null, role: "bride" }, couple: null, partner: null, journey: null }) });
      await expect(useAuthStore.getState().refreshJourney("u1")).resolves.toBe(true);
      expect(useAuthStore.getState()).toMatchObject({ profile: { id: "u1", couple_id: null }, partner: null, couple: null, journey: null });
    });

    it.each(["profile", "couple", "partner"])("does not infer a new couple from a partial snapshot missing %s", async (missing) => {
      const previous = { user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", couple_id: "c1", role: "bride" } as never,
        couple: { id: "c1" } as never, partner: { id: "former-partner" } as never,
        journey: { id: "j1", couple_id: "c1" } as never };
      useAuthStore.setState(previous);
      const data: Record<string, unknown> = { user: { id: "u1" }, profile: { id: "u1", couple_id: "c2", role: "bride" },
        couple: { id: "c2" }, partner: null, journey: { id: "j2", couple_id: "c2" } };
      delete data[missing];
      mockFetch.mockResolvedValue({ ok: true, json: async () => data });
      await expect(useAuthStore.getState().refreshJourney("u1")).resolves.toBe(false);
      expect(useAuthStore.getState()).toMatchObject(previous);
    });

    it("keeps a late older response from replacing a newer journey", async () => {
      useAuthStore.setState({
        user: { id: "u1", email: "test@example.com" },
        journey: { id: "initial", couple_id: "c1" } as never,
      });

      type AuthMeResponse = {
        ok: boolean;
        json: () => Promise<{
          user: { id: string };
          journey: { id: string; couple_id: string };
        }>;
      };
      let resolveFirst!: (value: AuthMeResponse) => void;
      let resolveSecond!: (value: AuthMeResponse) => void;
      const firstResponse = new Promise<AuthMeResponse>((resolve) => {
        resolveFirst = resolve;
      });
      const secondResponse = new Promise<AuthMeResponse>((resolve) => {
        resolveSecond = resolve;
      });
      mockFetch
        .mockReturnValueOnce(firstResponse)
        .mockReturnValueOnce(secondResponse);

      const first = useAuthStore.getState().refreshJourney("u1");
      const second = useAuthStore.getState().refreshJourney("u1");

      resolveSecond({
        ok: true,
        json: async () => ({
          user: { id: "u1" },
          journey: { id: "newer", couple_id: "c1" },
        }),
      });
      await expect(second).resolves.toBe(true);

      resolveFirst({
        ok: true,
        json: async () => ({
          user: { id: "u1" },
          journey: { id: "older", couple_id: "c1" },
        }),
      });
      await expect(first).resolves.toBe(false);
      expect(useAuthStore.getState().journey?.id).toBe("newer");
    });

    it("rejects a journey response owned by a different session user", async () => {
      useAuthStore.setState({
        user: { id: "u1", email: "test@example.com" },
        journey: { id: "initial", couple_id: "c1" } as never,
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: "u2" },
          journey: { id: "other-user", couple_id: "c2" },
        }),
      });

      await expect(
        useAuthStore.getState().refreshJourney("u1"),
      ).resolves.toBe(false);
      expect(useAuthStore.getState().journey?.id).toBe("initial");
    });
  });

  describe("updateJourneyLocal()", () => {
    it("updates journey in state without any fetch", () => {
      useAuthStore.setState({
        journey: { id: "j1", couple_id: "c1", wedding_date: "2026-10-01", total_budget: 0, venue: null, progress: {}, created_at: "", updated_at: "" },
      });

      useAuthStore.getState().updateJourneyLocal({ total_budget: 30_000_000 });
      expect(useAuthStore.getState().journey?.total_budget).toBe(30_000_000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does nothing when journey is null", () => {
      useAuthStore.setState({ journey: null });
      expect(() => useAuthStore.getState().updateJourneyLocal({ wedding_date: "2026-12-01" })).not.toThrow();
    });
  });

  // ─── updateProfile() ───

  describe("updateProfile()", () => {
    it("keeps the latest avatar when optional avatar lookup is unavailable", async () => {
      useAuthStore.setState({ user: { id: "u1", email: "a@example.invalid" }, profile: { id: "u1", name: "old", avatar_url: "🌷" } as never });
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ profile: { id: "u1", name: "new" } }) });
      await useAuthStore.getState().updateProfile({ name: "new" });
      expect(useAuthStore.getState().profile).toMatchObject({ name: "new", avatar_url: "🌷" });
    });

    it("does not revert a photo selected while the name PATCH was pending", async () => {
      let finish!: (value: unknown) => void;
      useAuthStore.setState({ user: { id: "u1", email: "test@example.invalid" }, profile: { id: "u1", name: "old", avatar_url: "🌷" } as never });
      mockFetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const pending = useAuthStore.getState().updateProfile({ name: "new" });
      useAuthStore.setState({ profile: { id: "u1", name: "old", avatar_url: "🌸" } as never });
      finish({ ok: true, json: async () => ({ profile: { id: "u1", name: "new", avatar_url: "🌷" } }) });
      await pending;
      expect(useAuthStore.getState().profile).toMatchObject({ name: "new", avatar_url: "🌸" });
    });

    it("rejects a stale profile PATCH after switching accounts", async () => {
      let finish!: (value: unknown) => void;
      // 이 요청은 owner 전환 뒤 결과 불명으로 남으므로 다른 독립 사례의 u1과 분리한다.
      useAuthStore.setState({ user: { id: "stale-profile-owner", email: "a@example.invalid" }, profile: { id: "stale-profile-owner", name: "old", avatar_url: "🌷" } as never });
      mockFetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const pending = useAuthStore.getState().updateProfile({ name: "new", sync_community_nickname: true });
      useAuthStore.setState({ user: { id: "u2", email: "b@example.invalid" }, profile: { id: "u2", name: "other", avatar_url: null } as never });
      finish({ ok: true, json: async () => ({ profile: { id: "stale-profile-owner", name: "new" } }) });
      await expect(pending).rejects.toThrow("계정 상태가 바뀌었어요");
      expect(useAuthStore.getState().profile).toMatchObject({ id: "u2", name: "other", avatar_url: null });
    });

    it("updates name locally in demo mode", async () => {
      useAuthStore.setState({
        isDemo: true,
        profile: { id: "demo", name: "김지은", email: "demo@hanbang.ai" } as never,
      });

      await useAuthStore.getState().updateProfile({ name: "이지은" });
      expect(useAuthStore.getState().profile?.name).toBe("이지은");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls /api/profile PATCH in non-demo mode", async () => {
      const updatedProfile = { id: "u1", name: "이지은", email: "test@example.com" };
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ profile: updatedProfile }) });

      useAuthStore.setState({ isDemo: false, user: { id: "u1", email: "test@example.invalid" }, profile: { id: "u1", name: "김지은" } as never });
      await useAuthStore.getState().updateProfile({ name: "이지은" });

      expect(mockFetch).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "PATCH" }));
      expect(useAuthStore.getState().profile?.name).toBe("이지은");
    });

    it("updates cached community nickname when profile sync is requested", async () => {
      const updatedProfile = { id: "u1", name: "new-name", email: "test@example.com" };
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ profile: updatedProfile }) });
      useAuthStore.setState({ isDemo: false, user: { id: "u1", email: "test@example.invalid" }, profile: { id: "u1", name: "old-name" } as never });
      useCommunityStore.setState({
        communityProfile: {
          user_id: "u1",
          nickname: "old-name",
          avatar_url: null,
          rank: "sprout",
          wedding_year: null,
          wedding_month: null,
          wedding_completed: false,
          progress_percent: 0,
          region: null,
          post_count: 0,
          comment_count: 0,
          total_upvotes_received: 0,
          warning_count: 0,
          is_suspended: false,
          created_at: "2026-06-15T00:00:00.000Z",
        },
      });

      await useAuthStore.getState().updateProfile({
        name: "new-name",
        sync_community_nickname: true,
      });

      expect(useCommunityStore.getState().communityProfile?.nickname).toBe("new-name");
    });
  });

  // ─── reset() ───

  describe("reset()", () => {
    it("clears all state fields", () => {
      useAuthStore.setState({
        user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1" } as never,
        isDemo: true,
        isInitialized: true,
      });

      useAuthStore.getState().reset();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.profile).toBeNull();
      expect(state.isDemo).toBe(false);
      expect(state.isInitialized).toBe(false);
    });

    it("purges the outgoing account's community memory, caches, and draft", () => {
      useAuthStore.setState({
        user: { id: "user-a", email: "a@example.com" },
        isInitialized: true,
      });
      useCommunityStore.getState().bindViewer("user-a");
      useCommunityStore.setState({
        posts: [{ id: "a-private" } as never],
      });
      sessionStorage.setItem("community:viewer:user-a:landing", "A");
      localStorage.setItem("community:post-draft:v2:user-a", "A-draft");

      useAuthStore.getState().reset();

      expect(useCommunityStore.getState()).toMatchObject({
        viewerId: null,
        posts: [],
      });
      expect(sessionStorage.getItem("community:viewer:user-a:landing")).toBeNull();
      expect(localStorage.getItem("community:post-draft:v2:user-a")).toBeNull();
    });
  });

  it("purges auth and community state before sign-out I/O finishes", async () => {
    let resolveSignOut: (() => void) | undefined;
    supabaseMocks.signOut.mockReturnValueOnce(
      new Promise((resolve) => { resolveSignOut = () => resolve({}); }),
    );
    useAuthStore.setState({
      user: { id: "user-a", email: "a@example.com" },
      isInitialized: true,
    });
    useCommunityStore.getState().bindViewer("user-a");
    useCommunityStore.setState({ posts: [{ id: "a-private" } as never] });

    const pending = useAuthStore.getState().signOut();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useCommunityStore.getState()).toMatchObject({
      viewerId: null,
      posts: [],
    });

    resolveSignOut?.();
    await pending;
  });

  it("rebinds and purges community state before committing an account switch", async () => {
    useAuthStore.setState({
      user: { id: "user-a", email: "a@example.com" },
      isInitialized: true,
    });
    useCommunityStore.getState().bindViewer("user-a");
    useCommunityStore.setState({ posts: [{ id: "a-private" } as never] });
    sessionStorage.setItem("community:viewer:user-a:trending", "A");

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { id: "user-b", email: "b@example.com" },
        profile: { id: "user-b", name: "B" },
        couple: null,
        partner: null,
        journey: null,
      }),
    });

    await useAuthStore.getState().initialize({ force: true });

    expect(useAuthStore.getState().user?.id).toBe("user-b");
    expect(useCommunityStore.getState()).toMatchObject({
      viewerId: "user-b",
      posts: [],
    });
    expect(sessionStorage.getItem("community:viewer:user-a:trending")).toBeNull();
  });
});
