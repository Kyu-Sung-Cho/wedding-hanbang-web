"use client";

import { create } from "zustand";
import type { UserRole } from "@/types/database.types";
import {
  PROGRESS_CHECKLIST_ITEMS,
  type ProgressChecklistItem,
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
  progressChecklist: ProgressChecklistItem[];

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
  toggleChecklistItem: (key: string) => void;
  setChecklistItemCost: (key: string, cost: number | undefined) => void;
  setChecklist: (items: ProgressChecklistItem[]) => void;
  reset: () => void;
}

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
  approximateBudget: 20000000,
  progressChecklist: PROGRESS_CHECKLIST_ITEMS.map((item) => ({ ...item })),
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
  toggleChecklistItem: (key) =>
    set((s) => ({
      progressChecklist: s.progressChecklist.map((item) =>
        item.key === key ? { ...item, done: !item.done, cost: !item.done ? item.cost : undefined } : item
      ),
    })),
  setChecklistItemCost: (key, cost) =>
    set((s) => ({
      progressChecklist: s.progressChecklist.map((item) =>
        item.key === key ? { ...item, cost } : item
      ),
    })),
  setChecklist: (items) => set({ progressChecklist: items }),
  reset: () => set({ ...initialState, progressChecklist: PROGRESS_CHECKLIST_ITEMS.map((item) => ({ ...item })) }),
}));
