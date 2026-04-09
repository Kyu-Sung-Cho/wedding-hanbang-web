"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Couple, WeddingJourney } from "@/types/database.types";

// 데모 모드 샘플 데이터
const DEMO_PROFILE: Profile = {
  id: "demo",
  name: "김지은",
  email: "demo@hanbang.ai",
  role: "bride",
  couple_id: "demo-couple",
  avatar_url: null,
  onboarding_completed: true,
  onboarding_step: 4,
  is_admin: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const DEMO_COUPLE: Couple = {
  id: "demo-couple",
  invite_code: "WH-DEMO01",
  bride_id: "demo",
  groom_id: null,
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
    meeting: {
      category: "meeting", status: "completed",
      checklist: [
        { id: "meeting_01", label: "상견례 일정 양가 조율", done: true },
        { id: "meeting_02", label: "상견례 장소 선정 및 예약", done: true },
        { id: "meeting_03", label: "복장 준비 (정장/단정한 옷차림)", done: true },
        { id: "meeting_04", label: "양가 선물 준비 (과일바구니, 건강식품 등)", done: true },
        { id: "meeting_05", label: "결혼 일정/예산 대략적 논의", done: true },
        { id: "meeting_06", label: "혼수/예단 분담 방향 논의", done: true },
      ],
    },
    venue: {
      category: "venue", status: "completed",
      checklist: [
        { id: "venue_01", label: "예식장 스타일 결정 (호텔/하우스/채플/야외)", done: true },
        { id: "venue_02", label: "후보 3곳 이상 리스트업", done: true },
        { id: "venue_03", label: "예식장 투어 예약 및 방문", done: true },
        { id: "venue_04", label: "식대 메뉴 비교 및 시식", done: true },
        { id: "venue_05", label: "예식 시간대 확정 (오전/오후/저녁)", done: true },
        { id: "venue_06", label: "계약 조건 확인 (위약금, 변경 가능 여부)", done: true },
        { id: "venue_07", label: "계약금 납부 및 계약서 보관", done: true },
        { id: "venue_08", label: "부대시설 확인 (대기실, 주차, 포토존)", done: true },
      ],
    },
    studio: {
      category: "studio", status: "completed",
      checklist: [
        { id: "studio_01", label: "촬영 스타일 결정 (실내/야외/혼합)", done: true },
        { id: "studio_02", label: "스튜디오 3곳 이상 비교", done: true },
        { id: "studio_03", label: "포트폴리오 확인 및 상담", done: true },
        { id: "studio_04", label: "패키지 비교 (보정본 수, 원본 제공)", done: true },
        { id: "studio_05", label: "촬영 일정 확정", done: true },
        { id: "studio_06", label: "계약 및 계약금 납부", done: true },
        { id: "studio_07", label: "촬영 콘셉트 및 의상 협의", done: true },
        { id: "studio_08", label: "보정본 확인 및 최종 선택", done: true },
      ],
    },
    dress: {
      category: "dress", status: "in_progress",
      checklist: [
        { id: "dress_01", label: "드레스 스타일 결정 (A라인/머메이드/볼가운)", done: true },
        { id: "dress_02", label: "드레스샵 3곳 이상 리스트업", done: true },
        { id: "dress_03", label: "드레스 투어 예약 및 방문", done: true },
        { id: "dress_04", label: "최종 드레스 선정", done: false },
        { id: "dress_05", label: "수선 일정 확정 (2회 이상)", done: false },
        { id: "dress_06", label: "액세서리 매칭 (베일, 티아라, 글러브)", done: false },
        { id: "dress_07", label: "턱시도 스타일 결정 및 대여/맞춤", done: false },
        { id: "dress_08", label: "최종 피팅 및 확인", done: false },
      ],
    },
    makeup: { category: "makeup", status: "not_started" },
    ring: {
      category: "ring", status: "in_progress",
      checklist: [
        { id: "ring_01", label: "예물 예산 양가 합의", done: true },
        { id: "ring_02", label: "예물 종류 결정 (반지, 시계, 목걸이 등)", done: true },
        { id: "ring_03", label: "브랜드 vs 공방 결정", done: false },
        { id: "ring_04", label: "매장 3곳 이상 방문 비교", done: false },
        { id: "ring_05", label: "디자인 및 사이즈 확정", done: false },
        { id: "ring_06", label: "주문 및 계약금 납부", done: false },
        { id: "ring_07", label: "각인 문구 결정 (해당 시)", done: false },
        { id: "ring_08", label: "최종 수령 및 확인", done: false },
      ],
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
    __events: [
      { id: "evt_demo1", date: "2026-03-15", title: "드레스 2차 피팅", memo: "강남 드레스하우스 오후 2시", categoryKey: "dress", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
      { id: "evt_demo2", date: "2026-04-10", title: "메이크업 리허설", memo: "청담 메이크업샵", categoryKey: "makeup", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
      { id: "evt_demo3", date: "2026-05-01", title: "청첩장 시안 확인", categoryKey: "invitation", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
      { id: "evt_demo4", date: "2026-06-20", title: "상견례 식사", memo: "삼성동 한정식", categoryKey: "meeting", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
    ],
  } as unknown as WeddingJourney["progress"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function isDemoMode() {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("demo_mode=true");
}

interface AuthState {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  partner: Profile | null;
  couple: Couple | null;
  journey: WeddingJourney | null;
  isLoading: boolean;
  isInitialized: boolean;
  isDemo: boolean;

  initialize: () => Promise<void>;
  updateJourney: (updates: Partial<Pick<WeddingJourney, "wedding_date" | "total_budget" | "venue" | "progress">>) => Promise<void>;
  updateJourneyLocal: (updates: Partial<Pick<WeddingJourney, "wedding_date" | "total_budget" | "venue" | "progress">>) => void;
  updateProfile: (updates: Partial<Pick<Profile, "name">>) => Promise<void>;
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

  initialize: async () => {
    if (get().isInitialized) return;
    set({ isLoading: true });

    try {
      // 실제 인증 세션 먼저 확인 (데모 모드보다 우선)
      const res = await fetch("/api/auth/me");

      if (res.ok) {
        const data = await res.json();

        if (data.user) {
          // 실제 로그인된 유저가 있으면 데모 쿠키 제거 후 실제 데이터 사용
          if (isDemoMode()) {
            document.cookie = "demo_mode=; path=/; max-age=0";
          }

          set({
            user: data.user,
            profile: data.profile ?? null,
            couple: data.couple ?? null,
            partner: data.partner ?? null,
            journey: data.journey ?? null,
            isDemo: false,
            isLoading: false,
            isInitialized: true,
          });
          return;
        }
      }

      // 실제 유저가 없을 때만 데모 모드 체크
      if (isDemoMode()) {
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
    } catch (err) {
      console.error("Auth store init error:", err);

      // fetch 에러 시에도 데모 모드 폴백
      if (isDemoMode()) {
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
    const { journey } = get();
    if (!journey) return;
    set({ journey: { ...journey, ...updates } });
  },

  updateJourney: async (updates) => {
    const { isDemo, journey } = get();

    // 데모 모드: 로컬만 업데이트
    if (isDemo) {
      set({ journey: journey ? { ...journey, ...updates } : null });
      return;
    }

    try {
      const res = await fetch("/api/journey", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        set({ journey: data.journey });
      }
    } catch (err) {
      console.error("Journey 업데이트 에러:", err);
    }
  },

  updateProfile: async (updates) => {
    const { isDemo, profile } = get();

    if (isDemo) {
      set({ profile: profile ? { ...profile, ...updates } : null });
      return;
    }

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        set({ profile: data.profile });
      }
    } catch (err) {
      console.error("Profile 업데이트 에러:", err);
    }
  },

  signOut: async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    document.cookie = "onboarding_complete=; path=/; max-age=0";
    document.cookie = "demo_mode=; path=/; max-age=0";
    get().reset();
    window.location.href = "/login";
  },

  reset: () => {
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
