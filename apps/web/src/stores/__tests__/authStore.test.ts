import { describe, it, expect, beforeEach, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  getSession: vi.fn(),
}));

// Mock Supabase client before importing the store
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: supabaseMocks.signOut,
      getSession: supabaseMocks.getSession,
    },
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
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

const mockFetch = vi.fn();
global.fetch = mockFetch;
const PLAN_CHANGE_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

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
    supabaseMocks.getSession.mockReset().mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockFetch.mockReset();
    setDemoCookie(false);
  });

  // ─── initialize() ───

  describe("initialize()", () => {
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
    beforeEach(() => {
      useAuthStore.setState({ user: { id: "u1", email: "test@example.com" } });
    });

    it("fails closed when an untyped legacy caller omits the initiating owner", async () => {
      useAuthStore.setState({
        isDemo: false,
        journey: { id: "j1", couple_id: "c1" } as never,
      });
      const unsafeLegacyCall = useAuthStore.getState().updateJourney as unknown as (
        updates: { wedding_date: string },
      ) => Promise<unknown>;

      await expect(
        unsafeLegacyCall({ wedding_date: "2027-01-01" }),
      ).rejects.toThrow(/계정/u);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("updates local state only in demo mode", async () => {
      useAuthStore.setState({
        isDemo: true,
        user: { id: "demo", email: "demo@hanbang.ai" },
        journey: { id: "j1", couple_id: "c1", wedding_date: "2026-10-01", total_budget: 10_000_000, venue: null, progress: {}, created_at: "", updated_at: "" },
      });

      const result = await useAuthStore.getState().updateJourney({
        wedding_date: "2026-12-01",
      }, "demo");
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
      await useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" }, "u1");

      expect(mockFetch).toHaveBeenCalledWith("/api/journey", expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
          [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: "u1",
        }),
      }));
      expect(useAuthStore.getState().journey?.wedding_date).toBe("2026-12-01");
    });

    it("does not send an account A plan change after the active store switches to B", async () => {
      useAuthStore.setState({
        isDemo: false,
        user: { id: "u2", email: "b@example.com" },
        journey: { id: "j2", couple_id: "c2", state_revision: 3 } as never,
      });

      await expect(
        useAuthStore.getState().updateJourney(
          { wedding_date: "2027-01-01" },
          "u1",
        ),
      ).rejects.toThrow(/계정/u);
      expect(mockFetch).not.toHaveBeenCalled();
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
      }, "u1");

      expect(result).toEqual({
        status: "pending_partner",
        requestId: PLAN_CHANGE_REQUEST_ID,
        summary: "총예산을 3,000만원으로 변경",
      });
      expect(useAuthStore.getState().journey).toEqual(originalJourney);
      expect(lastFetchBody()).toMatchObject({
        expected_couple_id: "c1",
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
        }, "u1"),
      ).rejects.toThrow("저장 결과를 안전하게 확인하지 못했습니다.");
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
      }, "u1");
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
        useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" }, "u1"),
      ).rejects.toThrow("Network error");
    });

    it("fails explicitly when journey is null in demo mode", async () => {
      useAuthStore.setState({
        isDemo: true,
        user: { id: "demo", email: "demo@hanbang.ai" },
        journey: null,
      });
      await expect(
        useAuthStore.getState().updateJourney({ wedding_date: "2026-12-01" }, "demo"),
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
      }, "u1");

      const body = lastFetchBody();
      expect(body.progress).toBeUndefined();
      expect(body.progress_patch).toEqual({ venue: { category: "venue", status: "in_progress", budget: 200 } });
      expect(body.progress_remove_keys).toEqual([]);
      expect(body.expected_revision).toBe(0);
      expect(body.expected_couple_id).toBe("c1");
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
      await useAuthStore.getState().updateJourney({ progress: next as never }, "u1");

      const body = lastFetchBody();
      expect(body.progress_patch).toEqual({});
      expect(body.progress_remove_keys).toEqual(["custom_123"]);
    });

    it("progress 변경이 전혀 없고 다른 필드도 없으면 네트워크 호출을 생략한다", async () => {
      setJourneyWithProgress({ venue: { category: "venue", status: "in_progress" } });
      const prev = useAuthStore.getState().journey!.progress as Record<string, unknown>;

      await useAuthStore.getState().updateJourney({ progress: { ...prev } as never }, "u1");
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
      }, "u1");

      const body = lastFetchBody();
      expect(body.total_budget).toBe(50_000_000);
      expect(body.progress_patch).toEqual({ ring: { category: "ring", status: "completed" } });
      expect(body.progress).toBeUndefined();
    });
  });

  // ─── updateJourneyLocal() ───

  describe("refreshJourney()", () => {
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
    it("fails closed when an untyped legacy caller omits the initiating owner", async () => {
      useAuthStore.setState({
        isDemo: false,
        user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", name: "Account A" } as never,
      });
      const unsafeLegacyCall = useAuthStore.getState().updateProfile as unknown as (
        updates: { name: string },
      ) => Promise<void>;

      await expect(unsafeLegacyCall({ name: "Stale form" })).rejects.toThrow(/계정/u);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("updates name locally in demo mode", async () => {
      useAuthStore.setState({
        isDemo: true,
        user: { id: "demo", email: "demo@hanbang.ai" },
        profile: { id: "demo", name: "김지은", email: "demo@hanbang.ai" } as never,
      });

      await useAuthStore.getState().updateProfile({ name: "이지은" }, "demo");
      expect(useAuthStore.getState().profile?.name).toBe("이지은");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls /api/profile PATCH in non-demo mode", async () => {
      const updatedProfile = { id: "u1", name: "이지은", email: "test@example.com" };
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ profile: updatedProfile }) });

      useAuthStore.setState({
        isDemo: false,
        user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", name: "김지은" } as never,
      });
      await useAuthStore.getState().updateProfile({ name: "이지은" }, "u1");

      expect(mockFetch).toHaveBeenCalledWith("/api/profile", expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
          [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: "u1",
        }),
      }));
      expect(useAuthStore.getState().profile?.name).toBe("이지은");
    });

    it("does not send a profile mutation when the loaded profile belongs to another account", async () => {
      useAuthStore.setState({
        isDemo: false,
        user: { id: "u2", email: "new@example.com" },
        profile: { id: "u1", name: "Old Account" } as never,
      });

      await expect(
        useAuthStore.getState().updateProfile({ name: "Stale Intent" }, "u2"),
      ).rejects.toThrow(/계정/u);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useAuthStore.getState().profile?.name).toBe("Old Account");
    });

    it("does not reinterpret account A's profile form as a B mutation after a complete store switch", async () => {
      useAuthStore.setState({
        isDemo: false,
        user: { id: "u2", email: "b@example.com" },
        profile: { id: "u2", name: "Account B" } as never,
      });

      await expect(
        useAuthStore.getState().updateProfile({ name: "A's Stale Input" }, "u1"),
      ).rejects.toThrow(/계정/u);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useAuthStore.getState().profile?.name).toBe("Account B");
    });

    it("does not apply account A's late profile response after the store switches to B", async () => {
      let resolveResponse!: (value: {
        ok: boolean;
        json: () => Promise<{ profile: { id: string; name: string } }>;
      }) => void;
      mockFetch.mockReturnValueOnce(new Promise((resolve) => {
        resolveResponse = resolve;
      }));
      useAuthStore.setState({
        isDemo: false,
        user: { id: "u1", email: "a@example.com" },
        profile: { id: "u1", name: "Account A" } as never,
      });

      const pending = useAuthStore.getState().updateProfile({ name: "A's New Name" }, "u1");
      useAuthStore.setState({
        user: { id: "u2", email: "b@example.com" },
        profile: { id: "u2", name: "Account B" } as never,
      });
      resolveResponse({
        ok: true,
        json: async () => ({ profile: { id: "u1", name: "A's New Name" } }),
      });

      await expect(pending).rejects.toThrow(/계정/u);
      expect(useAuthStore.getState().profile).toMatchObject({
        id: "u2",
        name: "Account B",
      });
    });

    it("updates cached community nickname when profile sync is requested", async () => {
      const updatedProfile = { id: "u1", name: "new-name", email: "test@example.com" };
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ profile: updatedProfile }) });
      useAuthStore.setState({
        isDemo: false,
        user: { id: "u1", email: "test@example.com" },
        profile: { id: "u1", name: "old-name" } as never,
      });
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
      }, "u1");

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

  it("does not let an A-owned deletion completion sign out a newly active B session", async () => {
    useAuthStore.setState({
      user: { id: "user-b", email: "b@example.com" },
      isInitialized: true,
    });
    supabaseMocks.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: "user-b" } } },
      error: null,
    });

    await expect(useAuthStore.getState().signOut("user-a"))
      .rejects.toThrow("AUTH_SIGN_OUT_OWNER_CHANGED");

    expect(useAuthStore.getState().user?.id).toBe("user-b");
    expect(supabaseMocks.signOut).not.toHaveBeenCalled();
  });

  it("can locally finish an A-owned deletion after server auth has disappeared", async () => {
    useAuthStore.setState({
      user: { id: "user-a", email: "a@example.com" },
      isInitialized: true,
    });
    supabaseMocks.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    await useAuthStore.getState().signOut("user-a");

    expect(useAuthStore.getState().user).toBeNull();
    expect(supabaseMocks.signOut).toHaveBeenCalledTimes(1);
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
