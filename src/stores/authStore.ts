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
    venue: { category: "venue", status: "completed" },
    studio: { category: "studio", status: "completed" },
    dress: { category: "dress", status: "in_progress" },
    makeup: { category: "makeup", status: "not_started" },
    ring: { category: "ring", status: "in_progress" },
    hanbok: { category: "hanbok", status: "not_started" },
    honeymoon: { category: "honeymoon", status: "not_started" },
    houseware: { category: "houseware", status: "not_started" },
    invitation: { category: "invitation", status: "not_started" },
    gift: { category: "gift", status: "not_started" },
  },
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

    // 데모 모드 체크
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

    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        set({ isLoading: false, isInitialized: true });
        return;
      }

      const data = await res.json();

      set({
        user: data.user ?? null,
        profile: data.profile ?? null,
        couple: data.couple ?? null,
        partner: data.partner ?? null,
        journey: data.journey ?? null,
      });
    } catch (err) {
      console.error("Auth store init error:", err);
    } finally {
      set({ isLoading: false, isInitialized: true });
    }
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
