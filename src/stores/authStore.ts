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
