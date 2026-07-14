import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Supabase client before importing the store
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({}) },
  }),
}));

// Mock window.location
Object.defineProperty(window, "location", {
  value: { href: "" },
  writable: true,
});

import { useAuthStore } from "../authStore";
import { useCommunityStore } from "../communityStore";
import {
  courtCaseDraftKey,
  courtStatementDraftKey,
  publicCommentDraftKey,
} from "@/lib/coupleCourt/draftStorage";

const mockFetch = vi.fn();
global.fetch = mockFetch;

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
    initError: null,
  });
  useCommunityStore.getState().reset();
}

describe("useAuthStore", () => {
  beforeEach(() => {
    resetStore();
    window.sessionStorage.clear();
    mockFetch.mockReset();
    setDemoCookie(false);
  });

  // ─── initialize() ───

  describe("initialize()", () => {
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

    it("enters a server-verified demo session without touching the auth API", async () => {
      await useAuthStore.getState().initialize({ verifiedDemo: true });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(useAuthStore.getState()).toMatchObject({
        user: { id: "demo" },
        isDemo: true,
        isInitialized: true,
        isLoading: false,
        initError: null,
      });
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

    it("enters demo mode when /api/auth/me returns no user and demo cookie is set", async () => {
      setDemoCookie(true);
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ user: null }) });

      await useAuthStore.getState().initialize();
      const state = useAuthStore.getState();
      expect(state.isDemo).toBe(true);
      expect(state.user?.id).toBe("demo");
    });

    it("enters demo mode when fetch fails and demo cookie is set", async () => {
      setDemoCookie(true);
      mockFetch.mockRejectedValue(new Error("Network error"));

      await useAuthStore.getState().initialize();
      const state = useAuthStore.getState();
      expect(state.isDemo).toBe(true);
      expect(state.isInitialized).toBe(true);
    });

    it("remains unauthenticated when fetch fails and no demo cookie", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await useAuthStore.getState().initialize();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isDemo).toBe(false);
      expect(state.isInitialized).toBe(true);
      expect(state.initError).toMatchObject({ code: "AUTH_UNAVAILABLE" });
    });

    it("preserves PROFILE_UNAVAILABLE as a retryable typed initialization error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ "Retry-After": "3" }),
        json: async () => ({
          code: "PROFILE_UNAVAILABLE",
          error: "프로필 정보를 불러오지 못했습니다.",
        }),
      });

      await useAuthStore.getState().initialize();

      expect(useAuthStore.getState()).toMatchObject({
        user: null,
        isInitialized: true,
        isLoading: false,
        initError: {
          code: "PROFILE_UNAVAILABLE",
          status: 503,
          message: "프로필 정보를 불러오지 못했습니다.",
          retryAfterSeconds: 3,
        },
      });
    });

    it("clears a prior initialization error after a successful retry", async () => {
      useAuthStore.setState({
        isInitialized: true,
        initError: {
          code: "PROFILE_UNAVAILABLE",
          status: 503,
          message: "retry",
          retryAfterSeconds: 3,
        },
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: "u1", email: "test@example.com" },
          profile: { id: "u1", name: "테스트" },
        }),
      });

      await useAuthStore.getState().initialize({ force: true });

      expect(useAuthStore.getState().user?.id).toBe("u1");
      expect(useAuthStore.getState().initError).toBeNull();
    });

    it("ignores a stale failure that finishes after a newer successful retry", async () => {
      let resolveFirst!: (value: unknown) => void;
      const firstResponse = new Promise((resolve) => {
        resolveFirst = resolve;
      });
      mockFetch
        .mockReturnValueOnce(firstResponse)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            user: { id: "u-new", email: "new@example.com" },
            profile: { id: "u-new", name: "최신 사용자" },
          }),
        });

      const staleInitialization = useAuthStore.getState().initialize();
      await useAuthStore.getState().initialize({ force: true });
      resolveFirst({
        ok: false,
        status: 503,
        headers: new Headers({ "Retry-After": "3" }),
        json: async () => ({ code: "PROFILE_UNAVAILABLE", error: "stale" }),
      });
      await staleInitialization;

      expect(useAuthStore.getState().user?.id).toBe("u-new");
      expect(useAuthStore.getState().initError).toBeNull();
    });

    it("prefers real user over demo mode when real user exists", async () => {
      setDemoCookie(true);
      const fakeData = {
        user: { id: "real-user", email: "real@example.com" },
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
    });
  });

  // ─── updateJourney() ───

  describe("updateJourney()", () => {
    it("updates local state only in demo mode", async () => {
      useAuthStore.setState({
        isDemo: true,
        journey: { id: "j1", couple_id: "c1", wedding_date: "2026-10-01", total_budget: 10_000_000, venue: null, progress: {}, created_at: "", updated_at: "" },
      });

      await useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" });
      expect(useAuthStore.getState().journey?.wedding_date).toBe("2026-12-01");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls /api/journey PATCH in non-demo mode", async () => {
      const updatedJourney = { id: "j1", couple_id: "c1", wedding_date: "2026-12-01" };
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ journey: updatedJourney }) });

      useAuthStore.setState({ isDemo: false, journey: { id: "j1", couple_id: "c1" } as never });
      await useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" });

      expect(mockFetch).toHaveBeenCalledWith("/api/journey", expect.objectContaining({ method: "PATCH" }));
      expect(useAuthStore.getState().journey?.wedding_date).toBe("2026-12-01");
    });

    it("reports PATCH failure to the caller without throwing", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      useAuthStore.setState({ isDemo: false, journey: { id: "j1" } as never });

      await expect(useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" })).resolves.toBe(false);
    });

    it("reports a non-2xx PATCH response to the caller", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "unavailable" }) });
      useAuthStore.setState({ isDemo: false, journey: { id: "j1" } as never });

      await expect(useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" })).resolves.toBe(false);
    });

    it("does nothing when journey is null in demo mode", async () => {
      useAuthStore.setState({ isDemo: true, journey: null });
      await useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" });
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
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ journey: {} }) });
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
      // 변경 안 된 studio는 patch에 포함되지 않는다 (스테일 롤백 방지의 핵심)
      expect((body.progress_patch as Record<string, unknown>).studio).toBeUndefined();
    });

    it("스냅샷에서 삭제된 키는 progress_remove_keys로 보낸다", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ journey: {} }) });
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
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ journey: {} }) });
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

      useAuthStore.setState({ isDemo: false, profile: { id: "u1", name: "김지은" } as never });
      await useAuthStore.getState().updateProfile({ name: "이지은" });

      expect(mockFetch).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "PATCH" }));
      expect(useAuthStore.getState().profile?.name).toBe("이지은");
    });

    it("updates cached community nickname when profile sync is requested", async () => {
      const updatedProfile = { id: "u1", name: "new-name", email: "test@example.com" };
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ profile: updatedProfile }) });
      useAuthStore.setState({ isDemo: false, profile: { id: "u1", name: "old-name" } as never });
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
      expect(state.initError).toBeNull();
    });

    it("removes the departing user's private Court drafts only", () => {
      const ownCase = courtCaseDraftKey("u1");
      const ownStatement = courtStatementDraftKey("u1", "case-1", true);
      const ownPublicComment = publicCommentDraftKey("u1", "post-1");
      const otherCase = courtCaseDraftKey("u2");
      const otherPublicComment = publicCommentDraftKey("u2", "post-1");
      window.sessionStorage.setItem(ownCase, "private case");
      window.sessionStorage.setItem(ownStatement, "private statement");
      window.sessionStorage.setItem(ownPublicComment, "private public comment");
      window.sessionStorage.setItem(otherCase, "other account");
      window.sessionStorage.setItem(otherPublicComment, "other public comment");
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" } });

      useAuthStore.getState().reset();

      expect(window.sessionStorage.getItem(ownCase)).toBeNull();
      expect(window.sessionStorage.getItem(ownStatement)).toBeNull();
      expect(window.sessionStorage.getItem(ownPublicComment)).toBeNull();
      expect(window.sessionStorage.getItem(otherCase)).toBe("other account");
      expect(window.sessionStorage.getItem(otherPublicComment)).toBe("other public comment");
    });
  });
});
