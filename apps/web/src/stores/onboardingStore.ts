"use client";

import { create } from "zustand";
import type { UserRole } from "@/types/database.types";
import {
  type WeddingPreferences,
  type WeddingStyle,
  type PriorityItem,
  type BudgetTendency,
  type GuestCount,
} from "@/types/onboarding.types";

interface OnboardingStoreState {
  currentStep: number;
  role: UserRole | null;
  coupleAction: "create" | "join" | null;
  inviteCode: string;
  partnerInviteCode: string;
  weddingDate: string | null;
  weddingDateUndecided: boolean;
  venue: string | null;
  venueUndecided: boolean;
  approximateBudget: number;
  preferences: WeddingPreferences;

  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setRole: (role: UserRole) => void;
  setCoupleAction: (action: "create" | "join") => void;
  setInviteCode: (code: string) => void;
  setPartnerInviteCode: (code: string) => void;
  setWeddingDate: (date: string | null) => void;
  setWeddingDateUndecided: (value: boolean) => void;
  setVenue: (venue: string | null) => void;
  setVenueUndecided: (value: boolean) => void;
  setBudget: (budget: number) => void;
  setWeddingStyle: (style: WeddingStyle) => void;
  togglePriority: (item: PriorityItem) => void;
  setBudgetTendency: (tendency: BudgetTendency) => void;
  setGuestCount: (count: GuestCount) => void;
  reset: () => void;
}

const initialPreferences: WeddingPreferences = {
  weddingStyle: null,
  priorities: [],
  budgetTendency: null,
  guestCount: null,
};

const initialState = {
  currentStep: 1,
  role: null as UserRole | null,
  coupleAction: null as "create" | "join" | null,
  inviteCode: "",
  partnerInviteCode: "",
  weddingDate: null as string | null,
  weddingDateUndecided: false,
  venue: null as string | null,
  venueUndecided: false,
  approximateBudget: 0,
  preferences: { ...initialPreferences },
};

export const useOnboardingStore = create<OnboardingStoreState>((set) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),
  nextStep: () => set((s) => ({ currentStep: Math.min(s.currentStep + 1, 4) })),
  prevStep: () => set((s) => ({ currentStep: Math.max(s.currentStep - 1, 1) })),
  setRole: (role) => set({ role }),
  setCoupleAction: (action) => set({ coupleAction: action }),
  setInviteCode: (code) => set({ inviteCode: code }),
  setPartnerInviteCode: (code) => set({ partnerInviteCode: code }),
  setWeddingDate: (date) => set({ weddingDate: date }),
  setWeddingDateUndecided: (value) =>
    set({ weddingDateUndecided: value, weddingDate: value ? null : undefined }),
  setVenue: (venue) => set({ venue }),
  setVenueUndecided: (value) =>
    set({ venueUndecided: value, venue: value ? null : undefined }),
  setBudget: (budget) => set({ approximateBudget: budget }),
  setWeddingStyle: (style) =>
    set((s) => ({ preferences: { ...s.preferences, weddingStyle: style } })),
  togglePriority: (item) =>
    set((s) => {
      const current = s.preferences.priorities;
      const exists = current.includes(item);
      const updated = exists
        ? current.filter((p) => p !== item)
        : current.length < 3
          ? [...current, item]
          : current;
      return { preferences: { ...s.preferences, priorities: updated } };
    }),
  setBudgetTendency: (tendency) =>
    set((s) => ({ preferences: { ...s.preferences, budgetTendency: tendency } })),
  setGuestCount: (count) =>
    set((s) => ({ preferences: { ...s.preferences, guestCount: count } })),
  reset: () => set({ ...initialState, preferences: { ...initialPreferences } }),
}));
