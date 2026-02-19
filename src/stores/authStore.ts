"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Couple, WeddingJourney } from "@/types/database.types";

interface AuthState {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  partner: Profile | null;
  couple: Couple | null;
  journey: WeddingJourney | null;
  isLoading: boolean;
  isInitialized: boolean;

  initialize: () => Promise<void>;
  fetchProfile: () => Promise<Profile | null>;
  fetchCoupleAndJourney: () => Promise<void>;
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

  initialize: async () => {
    if (get().isInitialized) return;
    set({ isLoading: true });

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        set({ isLoading: false, isInitialized: true });
        return;
      }

      set({ user: { id: user.id, email: user.email ?? "" } });

      const profile = await get().fetchProfile();
      if (profile?.couple_id) {
        await get().fetchCoupleAndJourney();
      }
    } catch (err) {
      console.error("Auth store init error:", err);
    } finally {
      set({ isLoading: false, isInitialized: true });
    }
  },

  fetchProfile: async () => {
    const { user } = get();
    if (!user) return null;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      // 프로필이 없으면 기본 생성
      const { data: newProfile } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          name: user.email.split("@")[0],
          email: user.email,
          onboarding_completed: false,
          onboarding_step: 0,
        })
        .select()
        .single();

      if (newProfile) {
        set({ profile: newProfile as Profile });
        return newProfile as Profile;
      }
      return null;
    }

    set({ profile: data as Profile });
    return data as Profile;
  },

  fetchCoupleAndJourney: async () => {
    const { profile } = get();
    if (!profile?.couple_id) return;

    const supabase = createClient();

    // 커플 정보 조회
    const { data: couple } = await supabase
      .from("couples")
      .select("*")
      .eq("id", profile.couple_id)
      .single();

    if (couple) {
      set({ couple: couple as Couple });

      // 파트너 정보 조회
      const partnerId =
        couple.bride_id === profile.id ? couple.groom_id : couple.bride_id;
      if (partnerId) {
        const { data: partner } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", partnerId)
          .single();
        if (partner) set({ partner: partner as Profile });
      }
    }

    // 웨딩 여정 조회
    const { data: journey } = await supabase
      .from("wedding_journeys")
      .select("*")
      .eq("couple_id", profile.couple_id)
      .single();

    if (journey) {
      set({ journey: journey as WeddingJourney });
    }
  },

  signOut: async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    document.cookie =
      "onboarding_complete=; path=/; max-age=0";
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
    });
  },
}));
