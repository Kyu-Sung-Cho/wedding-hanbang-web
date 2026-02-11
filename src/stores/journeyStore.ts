import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CategoryId, CategoryStatus, UserRole } from "@/types";
import { CATEGORIES } from "@/constants/categories";
import * as journeyService from "@/lib/services/journeyService";

interface JourneyState {
  weddingDate: string | null;
  role: UserRole | null;
  categoryStatuses: Record<string, CategoryStatus>;
  checklistProgress: Record<string, boolean>;
  priorityCategory: CategoryId | null;
  isOnboardingComplete: boolean;
  journeyId: string | null;
  coupleId: string | null;
  isSyncing: boolean;
}

interface JourneyActions {
  setWeddingDate: (date: string | null) => void;
  setRole: (role: UserRole) => void;
  setCategoryStatus: (categoryId: CategoryId, status: CategoryStatus) => void;
  setBulkCategoryStatuses: (statuses: Partial<Record<CategoryId, CategoryStatus>>) => void;
  toggleChecklistItem: (categoryId: CategoryId, itemId: string) => void;
  setPriorityCategory: (categoryId: CategoryId | null) => void;
  completeOnboarding: () => void;
  setJourneyId: (id: string | null) => void;
  setCoupleId: (id: string | null) => void;
  resetAll: () => void;
  getDaysUntilWedding: () => number | null;
  getCategoryProgress: (categoryId: CategoryId) => number;
  getOverallProgress: () => number;
  // Supabase 동기화
  loadFromServer: (coupleId: string) => Promise<void>;
  syncToServer: () => Promise<void>;
}

const initialState: JourneyState = {
  weddingDate: null,
  role: null,
  categoryStatuses: {},
  checklistProgress: {},
  priorityCategory: null,
  isOnboardingComplete: false,
  journeyId: null,
  coupleId: null,
  isSyncing: false,
};

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

// 디바운스된 서버 동기화
function debouncedSync(syncFn: () => Promise<void>) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncFn();
  }, 2000);
}

export const useJourneyStore = create<JourneyState & JourneyActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setWeddingDate: (date) => {
        set({ weddingDate: date });
        debouncedSync(() => get().syncToServer());
      },
      setRole: (role) => {
        set({ role });
        debouncedSync(() => get().syncToServer());
      },
      setCategoryStatus: (categoryId, status) => {
        set((state) => ({
          categoryStatuses: { ...state.categoryStatuses, [categoryId]: status },
        }));
        debouncedSync(() => get().syncToServer());
      },
      setBulkCategoryStatuses: (statuses) => {
        set((state) => ({
          categoryStatuses: { ...state.categoryStatuses, ...statuses },
        }));
        debouncedSync(() => get().syncToServer());
      },
      toggleChecklistItem: (categoryId, itemId) => {
        const key = `${categoryId}_${itemId}`;
        set((state) => ({
          checklistProgress: {
            ...state.checklistProgress,
            [key]: !state.checklistProgress[key],
          },
        }));
        debouncedSync(() => get().syncToServer());
      },
      setPriorityCategory: (categoryId) => {
        set({ priorityCategory: categoryId });
        debouncedSync(() => get().syncToServer());
      },
      completeOnboarding: () => {
        set({ isOnboardingComplete: true });
        debouncedSync(() => get().syncToServer());
      },
      setJourneyId: (journeyId) => set({ journeyId }),
      setCoupleId: (coupleId) => set({ coupleId }),
      resetAll: () => set(initialState),

      getDaysUntilWedding: () => {
        const { weddingDate } = get();
        if (!weddingDate) return null;
        const diff = new Date(weddingDate).getTime() - new Date().getTime();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
      },

      getCategoryProgress: (categoryId) => {
        const { checklistProgress } = get();
        const category = CATEGORIES.find((c) => c.id === categoryId);
        if (!category) return 0;
        const total = category.checklistItems.length;
        if (total === 0) return 0;
        const completed = category.checklistItems.filter(
          (item) => checklistProgress[`${categoryId}_${item.id}`]
        ).length;
        return Math.round((completed / total) * 100);
      },

      getOverallProgress: () => {
        const { categoryStatuses } = get();
        const statuses = categoryStatuses || {};
        const total = CATEGORIES.length;
        const completed = Object.values(statuses).filter(
          (s) => s === "completed" || s === "skipped"
        ).length;
        return Math.round((completed / total) * 100);
      },

      // Supabase에서 여정 데이터 로드
      loadFromServer: async (coupleId: string) => {
        try {
          const journey = await journeyService.getOrCreateJourney(coupleId);
          if (journey) {
            set({
              journeyId: journey.id,
              coupleId: journey.couple_id,
              weddingDate: journey.wedding_date,
              categoryStatuses: journey.category_statuses || {},
              checklistProgress: journey.checklist_progress || {},
              priorityCategory: journey.priority_category,
              isOnboardingComplete: journey.is_onboarding_complete,
            });
          }
        } catch (error) {
          console.error("서버에서 여정 로드 실패:", error);
        }
      },

      // 로컬 상태를 서버에 동기화
      syncToServer: async () => {
        const state = get();
        if (!state.coupleId || state.isSyncing) return;

        set({ isSyncing: true });
        try {
          await journeyService.syncJourney(state.coupleId, {
            wedding_date: state.weddingDate,
            category_statuses: state.categoryStatuses,
            checklist_progress: state.checklistProgress,
            priority_category: state.priorityCategory,
            is_onboarding_complete: state.isOnboardingComplete,
          });
        } catch (error) {
          console.error("서버 동기화 실패:", error);
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    { name: "journey-store" }
  )
);
