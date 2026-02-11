import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";

interface EtiquetteState {
  // 체크리스트 완료 상태: checkItemId -> boolean
  completedItems: Record<string, boolean>;
  // 북마크: targetId -> true
  bookmarks: Record<string, boolean>;
  // 현재 선택된 파트
  selectedPartId: string | null;
  // 현재 선택된 섹션
  selectedSectionId: string | null;
  // 검색어
  searchQuery: string;
}

interface EtiquetteActions {
  toggleCheckItem: (itemId: string) => void;
  toggleBookmark: (targetId: string) => void;
  setSelectedPart: (partId: string | null) => void;
  setSelectedSection: (sectionId: string | null) => void;
  setSearchQuery: (query: string) => void;
  getPartProgress: (partId: string) => { completed: number; total: number; percentage: number };
  getTotalProgress: () => { completed: number; total: number; percentage: number };
  isItemCompleted: (itemId: string) => boolean;
  isBookmarked: (targetId: string) => boolean;
  resetAll: () => void;
}

const initialState: EtiquetteState = {
  completedItems: {},
  bookmarks: {},
  selectedPartId: null,
  selectedSectionId: null,
  searchQuery: "",
};

export const useEtiquetteStore = create<EtiquetteState & EtiquetteActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      toggleCheckItem: (itemId) => {
        set((state) => ({
          completedItems: {
            ...state.completedItems,
            [itemId]: !state.completedItems[itemId],
          },
        }));
      },

      toggleBookmark: (targetId) => {
        set((state) => {
          const next = { ...state.bookmarks };
          if (next[targetId]) {
            delete next[targetId];
          } else {
            next[targetId] = true;
          }
          return { bookmarks: next };
        });
      },

      setSelectedPart: (partId) => set({ selectedPartId: partId, selectedSectionId: null }),
      setSelectedSection: (sectionId) => set({ selectedSectionId: sectionId }),
      setSearchQuery: (query) => set({ searchQuery: query }),

      getPartProgress: (partId) => {
        const { completedItems } = get();
        const part = ETIQUETTE_PARTS.find((p) => p.id === partId);
        if (!part) return { completed: 0, total: 0, percentage: 0 };

        let total = 0;
        let completed = 0;
        for (const section of part.sections) {
          for (const group of section.checklists) {
            for (const item of group.items) {
              total++;
              if (completedItems[item.id]) completed++;
            }
          }
        }
        return {
          completed,
          total,
          percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        };
      },

      getTotalProgress: () => {
        const { completedItems } = get();
        let total = 0;
        let completed = 0;
        for (const part of ETIQUETTE_PARTS) {
          for (const section of part.sections) {
            for (const group of section.checklists) {
              for (const item of group.items) {
                total++;
                if (completedItems[item.id]) completed++;
              }
            }
          }
        }
        return {
          completed,
          total,
          percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        };
      },

      isItemCompleted: (itemId) => !!get().completedItems[itemId],
      isBookmarked: (targetId) => !!get().bookmarks[targetId],

      resetAll: () => set(initialState),
    }),
    { name: "etiquette-store" }
  )
);
