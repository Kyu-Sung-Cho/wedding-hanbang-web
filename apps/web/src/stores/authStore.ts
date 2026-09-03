"use client";

import { create } from "zustand";
import { PlanChangeError } from "@/lib/journey/planChangeError";
import { createClient } from "@/lib/supabase/client";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { useCommunityStore } from "@/stores/communityStore";
import type { Profile, Couple, WeddingJourney } from "@/types/database.types";

// 데모 모드 샘플 데이터
function buildDemoChecklist(categoryKey: string, completedItemCount: number) {
  return (CHECKLIST_MAP[categoryKey]?.items ?? []).map((item, index) => ({
    ...item,
    done: index < completedItemCount,
  }));
}

const DEMO_PROFILE: Profile = {
  id: "demo",
  name: "김지은",
  email: "demo@hanbang.ai",
  role: "bride",
  couple_id: "demo-couple",
  avatar_url: null,
  onboarding_completed: true,
  onboarding_step: 5,
  is_admin: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const DEMO_COUPLE: Couple = {
  id: "demo-couple",
  invite_code: "WH-DEMO01",
  bride_id: "demo",
  groom_id: null,
  membership_sealed_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const DEMO_JOURNEY: WeddingJourney = {
  id: "demo-journey",
  couple_id: "demo-couple",
  wedding_date: "2026-10-15",
  venue: null,
  total_budget: 25000000,
  progress: {
    greeting: {
      category: "greeting", status: "completed", spent: 0,
      checklist: buildDemoChecklist("greeting", Number.POSITIVE_INFINITY),
    },
    registration: {
      category: "registration", status: "not_started", spent: 0,
      checklist: buildDemoChecklist("registration", 0),
    },
    meeting: {
      category: "meeting", status: "completed", spent: 420000,
      checklist: buildDemoChecklist("meeting", Number.POSITIVE_INFINITY),
    },
    venue: {
      category: "venue", status: "completed", spent: 11500000,
      checklist: buildDemoChecklist("venue", Number.POSITIVE_INFINITY),
    },
    studio: {
      category: "studio", status: "completed", spent: 1650000,
      checklist: buildDemoChecklist("studio", Number.POSITIVE_INFINITY),
    },
    dress: {
      category: "dress", status: "in_progress", spent: 600000,
      checklist: buildDemoChecklist("dress", 3),
    },
    makeup: { category: "makeup", status: "not_started" },
    ring: {
      category: "ring", status: "in_progress",
      checklist: buildDemoChecklist("ring", 2),
    },
    hanbok: { category: "hanbok", status: "not_started" },
    yedan: { category: "yedan", status: "not_started" },
    honeymoon: { category: "honeymoon", status: "not_started" },
    houseware: { category: "houseware", status: "not_started" },
    housing: { category: "housing", status: "not_started" },
    invitation: { category: "invitation", status: "not_started" },
    snap: { category: "snap", status: "not_started" },
    shoes: { category: "shoes", status: "not_started" },
    bouquet: { category: "bouquet", status: "not_started" },
    gift: { category: "gift", status: "not_started" },
    mc: { category: "mc", status: "not_started" },
    ham: { category: "ham", status: "not_started" },
    pyebaek: { category: "pyebaek", status: "not_started" },
    address: { category: "address", status: "not_started" },
    // 안 하는 집이 더 많아 템플릿이 "안 해요"에서 시작하는 두 분야. 데모도 같은 값을
    // 보여야 둘러보는 사람이 실제 첫 화면과 다른 것을 보지 않는다.
    ibaji: { category: "ibaji", status: "not_applicable" },
    housewarming: { category: "housewarming", status: "not_applicable" },
    // 데모 일정은 결혼식 날짜(10/15) 전에 두어 다가오는 일정 화면을 확인할 수 있게 한다.
    __events: [
      { id: "evt_demo1", date: "2026-08-08", title: "드레스를 몸에 맞게 고치는 날", memo: "강남 드레스 매장 오후 2시", categoryKey: "dress", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
      { id: "evt_demo2", date: "2026-08-22", title: "헤어·메이크업 미리 받아보기", memo: "청담 헤어·메이크업 매장", categoryKey: "makeup", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
      { id: "evt_demo3", date: "2026-09-05", title: "결혼식 날 사진 촬영 담당자 미팅", categoryKey: "snap", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
      { id: "evt_demo4", date: "2026-06-20", title: "양쪽 부모님 첫 식사", memo: "삼성동 한정식", categoryKey: "meeting", createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z" },
    ],
    __amora_actions: [
      {
        id: "act_demo_snap_original",
        title: "결혼식 날 받는 사진 파일 수 확인하기",
        description: "견적서와 계약서에 받는 사진 수와 별도 금액이 같은 내용으로 적혀 있는지 확인해 두세요.",
        dueDate: "2026-06-18",
        categoryKey: "snap",
        priority: "high",
        status: "open",
        source: "chat",
        href: "/chat",
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      },
    ],
  } as unknown as WeddingJourney["progress"],
  state_revision: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function isDemoMode() {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("demo_mode=true");
}

function isTransientAuthFetchError(err: unknown) {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "AbortError" ||
    /failed to fetch|load failed|networkerror|aborted/i.test(err.message)
  );
}

let journeyWriteSequence = 0;
let authInitializeSequence = 0;
const PLAN_CHANGE_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlanChangeSummary(value: unknown): value is string {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && Array.from(value).length <= 240
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export type JourneyUpdateResult =
  | {
      status: "applied";
      journey: WeddingJourney;
    }
  | {
      status: "pending_partner";
      requestId: string;
      summary: string;
    };

interface AuthState {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  partner: Pick<Profile, "id" | "name" | "role" | "couple_id"> | null;
  couple: Couple | null;
  journey: WeddingJourney | null;
  isLoading: boolean;
  isInitialized: boolean;
  isDemo: boolean;

  initialize: (options?: { force?: boolean; initialDemo?: boolean }) => Promise<void>;
  updateJourney: (
    updates: Partial<
      Pick<WeddingJourney, "wedding_date" | "total_budget" | "venue" | "progress">
    >,
  ) => Promise<JourneyUpdateResult>;
  updateJourneyLocal: (updates: Partial<Pick<WeddingJourney, "wedding_date" | "total_budget" | "venue" | "progress">>) => void;
  /** 서버에서 journey 만 다시 fetch (initialize 와 달리 항상 강제 실행).
   *  AI 도구 실행 후 클라이언트 sync 가 누락된 케이스 안전망. */
  refreshJourney: (expectedUserId?: string) => Promise<boolean>;
  updateProfile: (
    updates: Partial<Pick<Profile, "name" | "care_notifications_enabled" | "phone">> & {
      sync_community_nickname?: boolean;
      /** 카톡·문자 케어 수신 동의 — 서버가 동의 시각으로 기록 */
      phone_care_consent?: boolean;
    }
  ) => Promise<void>;
  signOut: () => Promise<void>;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  partner: null,
  couple: null,
  journey: null,
  isLoading: false,
  isInitialized: false,
  isDemo: false,

  initialize: async (options) => {
    if (get().isInitialized && !options?.force) return;
    const initializeSequence = ++authInitializeSequence;
    const initializeJourneySequence = ++journeyWriteSequence;

    // 서버 레이아웃이 HttpOnly 서명까지 검증한 데모 세션은 다시 원격 Auth에
    // 물어보지 않는다. 네트워크가 느리거나 끊겨도 체험 화면은 즉시 열려야 한다.
    if (options?.initialDemo) {
      useCommunityStore.getState().bindViewer("demo");
      set({
        user: { id: "demo", email: "demo@hanbang.ai" },
        profile: DEMO_PROFILE,
        couple: DEMO_COUPLE,
        journey: DEMO_JOURNEY,
        partner: null,
        isDemo: true,
        isLoading: false,
        isInitialized: true,
      });
      return;
    }

    if (!options?.force) set({ isLoading: true });

    try {
      // 실제 인증 세션 먼저 확인 (데모 모드보다 우선)
      const res = await fetch("/api/auth/me");

      if (res.ok) {
        const data = await res.json();
        if (initializeSequence !== authInitializeSequence) return;

        if (data.user) {
          // 실제 로그인된 유저가 있으면 데모 쿠키 제거 후 실제 데이터 사용
          if (isDemoMode()) {
            document.cookie = "demo_mode=; path=/; max-age=0";
          }

          const current = get();
          const sameUser = current.user?.id === data.user.id;
          const nextJourney =
            (
              initializeJourneySequence === journeyWriteSequence
              || !sameUser
            )
              ? data.journey ?? null
              : current.journey;
          if (!sameUser && initializeJourneySequence !== journeyWriteSequence) {
            journeyWriteSequence += 1;
          }

          useCommunityStore.getState().bindViewer(data.user.id);
          set({
            user: data.user,
            profile: data.profile ?? null,
            couple: data.couple ?? null,
            partner: data.partner ?? null,
            journey: nextJourney,
            isDemo: false,
            isLoading: false,
            isInitialized: true,
          });
          return;
        }
      }

      if (initializeSequence !== authInitializeSequence) return;
      // 실제 유저가 없을 때만 데모 모드 체크
      if (isDemoMode()) {
        journeyWriteSequence += 1;
        useCommunityStore.getState().bindViewer("demo");
        set({
          user: { id: "demo", email: "demo@hanbang.ai" },
          profile: DEMO_PROFILE,
          couple: DEMO_COUPLE,
          journey: DEMO_JOURNEY,
          partner: null,
          isDemo: true,
          isLoading: false,
          isInitialized: true,
        });
        return;
      }

      useCommunityStore.getState().bindViewer(null);
      set({
        user: null,
        profile: null,
        partner: null,
        couple: null,
        journey: null,
        isDemo: false,
        isLoading: false,
        isInitialized: true,
      });
    } catch (err) {
      if (initializeSequence !== authInitializeSequence) return;
      if (!isTransientAuthFetchError(err)) {
        console.error("Auth store init error:", err);
      }

      // fetch 에러 시에도 데모 모드 폴백
      if (isDemoMode()) {
        journeyWriteSequence += 1;
        useCommunityStore.getState().bindViewer("demo");
        set({
          user: { id: "demo", email: "demo@hanbang.ai" },
          profile: DEMO_PROFILE,
          couple: DEMO_COUPLE,
          journey: DEMO_JOURNEY,
          partner: null,
          isDemo: true,
          isLoading: false,
          isInitialized: true,
        });
        return;
      }

      set({ isLoading: false, isInitialized: true });
    }
  },

  // AI 도구 실행 후 로컬 상태만 업데이트 (서버가 이미 DB 저장)
  updateJourneyLocal: (updates) => {
    journeyWriteSequence += 1;
    const { journey } = get();
    if (!journey) return;
    set({ journey: { ...journey, ...updates } });
  },

  // 서버에서 journey 만 강제 재fetch — AI 도구 실행 후 클라이언트 sync 안전망
  refreshJourney: async (expectedUserId) => {
    const refreshSequence = ++journeyWriteSequence;
    const { isDemo, user } = get();
    if (isDemo) return true;
    const identityToPreserve = expectedUserId ?? null;
    if (expectedUserId && user?.id !== expectedUserId) return false;
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return false;
      const data = await res.json() as unknown;
      if (
        typeof data !== "object"
        || data === null
        || !("journey" in data)
      ) return false;
      const responseUserId =
        "user" in data
        && typeof data.user === "object"
        && data.user !== null
        && "id" in data.user
        && typeof data.user.id === "string"
          ? data.user.id
          : null;
      const current = get();
      if (
        refreshSequence !== journeyWriteSequence
        || current.isDemo
        || (
          identityToPreserve !== null
          && (
            current.user?.id !== identityToPreserve
            || responseUserId !== identityToPreserve
          )
        )
      ) return false;
      // 파트너·커플도 함께 세운다.
      //
      // 예전에는 journey 만 갱신해서, 상대가 합류해도 먼저 시작한 사람 화면은
      // 계속 "혼자 준비 중" 이었다. 먼저 시작한 쪽은 코드가 안 먹혔다고 오해해
      // 코드를 다시 보내거나 재발급한다(2026-08-24 감사).
      const refreshed = data as {
        journey: WeddingJourney | null;
        partner?: unknown;
        couple?: unknown;
      };
      set({
        journey: refreshed.journey ?? null,
        ...("partner" in refreshed
          ? { partner: (refreshed.partner ?? null) as AuthState["partner"] }
          : {}),
        ...("couple" in refreshed
          ? { couple: (refreshed.couple ?? null) as AuthState["couple"] }
          : {}),
      });
      return true;
    } catch (err) {
      if (!isTransientAuthFetchError(err)) {
        console.error("refreshJourney 실패:", err);
      }
      return false;
    }
  },

  updateJourney: async (updates) => {
    const { isDemo, journey, user, couple } = get();

    // 데모 모드: 로컬만 업데이트
    if (isDemo) {
      journeyWriteSequence += 1;
      const nextJourney = journey
        ? {
            ...journey,
            ...updates,
            state_revision: (journey.state_revision ?? 0) + 1,
            updated_at: new Date().toISOString(),
          }
        : null;
      set({ journey: nextJourney });
      if (!nextJourney) {
        throw new Error("결혼 준비 정보를 찾을 수 없습니다.");
      }
      return { status: "applied", journey: nextJourney };
    }

    // progress는 전체 덮어쓰기 대신 변경된 최상위 키만 원자 patch로 보낸다.
    // 전체 전송은 이 클라이언트의 스테일 스냅샷으로 파트너/AI의 다른 키 변경을
    // 통째로 롤백시킨다(커플 동시수정 유실). 서버 apply_journey_progress_patch가
    // DB row lock으로 병합하므로 서로 다른 키의 동시 수정은 안전하다.
    const body: Record<string, unknown> = { ...updates };
    if (updates.progress !== undefined) {
      const prev = (journey?.progress ?? {}) as Record<string, unknown>;
      const next = updates.progress as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      const removeKeys: string[] = [];
      for (const key of Object.keys(next)) {
        if (JSON.stringify(next[key]) !== JSON.stringify(prev[key])) {
          patch[key] = next[key];
        }
      }
      for (const key of Object.keys(prev)) {
        if (!(key in next)) removeKeys.push(key);
      }
      delete body.progress;
      const otherFieldCount = Object.keys(body).length;
      if (Object.keys(patch).length === 0 && removeKeys.length === 0) {
        // progress 변경이 실제로 없으면 progress 파트는 생략 (no-op 방지)
        if (otherFieldCount === 0) {
          if (!journey) {
            throw new Error("결혼 준비 정보를 찾을 수 없습니다.");
          }
          return { status: "applied", journey };
        }
      } else {
        body.progress_patch = patch;
        body.progress_remove_keys = removeKeys;
      }
    }

    const expectedRevision = journey?.state_revision ?? 0;
    body.expected_revision = expectedRevision;

    const updateSequence = ++journeyWriteSequence;
    const expectedUserId = user?.id ?? null;
    try {
      const res = await fetch("/api/journey", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            status?: unknown;
            journey?: unknown;
            requestId?: unknown;
            summary?: unknown;
            error?: unknown;
          }
        | null;
      if (!res.ok) {
        const message = typeof data?.error === "string"
          ? data.error
          : "결혼 준비 정보를 저장하지 못했습니다.";
        // 코드가 있으면 실어 보낸다. 화면은 **문자열이 아니라 코드**를 보고
        // 사용자에게 보여도 되는 사유인지 판단한다(내부 오류 원문 유출 방지).
        if (typeof (data as { code?: unknown } | null)?.code === "string") {
          throw new PlanChangeError((data as { code: string }).code, message);
        }
        throw new Error(message);
      }

      if (
        data?.status === "pending_partner"
        && typeof data.requestId === "string"
        && PLAN_CHANGE_REQUEST_ID_PATTERN.test(data.requestId)
        && isPlanChangeSummary(data.summary)
      ) {
        return {
          status: "pending_partner",
          requestId: data.requestId,
          summary: data.summary,
        };
      }

      if (
        data?.status !== "applied"
        || typeof data.requestId !== "string"
        || !PLAN_CHANGE_REQUEST_ID_PATTERN.test(data.requestId)
        || typeof data.journey !== "object"
        || data.journey === null
      ) {
        throw new Error("저장 결과를 안전하게 확인하지 못했습니다.");
      }

      const appliedJourney = data.journey as WeddingJourney;
      const expectedCoupleId = couple?.id ?? journey?.couple_id ?? null;
      const appliedRevision = appliedJourney.state_revision;
      if (
        expectedCoupleId === null
        || appliedJourney.couple_id !== expectedCoupleId
        || typeof appliedRevision !== "number"
        || !Number.isSafeInteger(appliedRevision)
        || appliedRevision <= expectedRevision
      ) {
        throw new Error("저장 결과를 안전하게 확인하지 못했습니다.");
      }
      const current = get();
      const sameUser =
        expectedUserId === null
        || current.user?.id === expectedUserId;
      if (
        updateSequence === journeyWriteSequence
        && sameUser
      ) {
        set({ journey: appliedJourney });
      } else if (sameUser) {
        void current.refreshJourney(expectedUserId ?? undefined);
      }
      return { status: "applied", journey: appliedJourney };
    } catch (err) {
      console.error("Journey 업데이트 에러:", err);
      throw err;
    }
  },

  updateProfile: async (updates) => {
    const { isDemo, profile } = get();

    if (isDemo) {
      const nextProfile = profile ? { ...profile, ...updates } : null;
      set({ profile: nextProfile });
      if (updates.sync_community_nickname && nextProfile?.name) {
        useCommunityStore.getState().applyOwnNickname(nextProfile.id, nextProfile.name);
      }
      return;
    }

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = (await res.json().catch(() => ({}))) as {
        profile?: Profile;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "프로필 업데이트에 실패했습니다.");
      }
      if (data.profile) {
        set({ profile: data.profile });
        if (updates.sync_community_nickname) {
          useCommunityStore.getState().applyOwnNickname(data.profile.id, data.profile.name);
        }
      }
    } catch (err) {
      console.error("Profile 업데이트 에러:", err);
      throw err;
    }
  },

  signOut: async () => {
    const supabase = createClient();
    // Purge auth and viewer-owned state before I/O so logout cannot paint or
    // refetch the outgoing account while the network request is pending.
    get().reset();
    await supabase.auth.signOut();
    document.cookie = "onboarding_complete=; path=/; max-age=0";
    document.cookie = "demo_mode=; path=/; max-age=0";
    window.location.href = "/login";
  },

  reset: () => {
    authInitializeSequence += 1;
    journeyWriteSequence += 1;
    useCommunityStore.getState().reset();
    set({
      user: null,
      profile: null,
      partner: null,
      couple: null,
      journey: null,
      isLoading: false,
      isInitialized: false,
      isDemo: false,
    });
  },
}));
