import { create } from "zustand";
import { FittingRequest, FittingUsage } from "@/types/fitting";
import * as fittingService from "@/lib/services/fittingService";

type FittingStep = "upload" | "style" | "processing" | "result";

interface FittingState {
  step: FittingStep;
  selectedPhotoFile: File | null;
  selectedPhotoPreview: string | null;
  selectedDressStyle: string | null;
  currentRequest: FittingRequest | null;
  history: FittingRequest[];
  usage: FittingUsage | null;
  isLoading: boolean;
  error: string | null;
  pollingInterval: ReturnType<typeof setInterval> | null;
}

interface FittingActions {
  setStep: (step: FittingStep) => void;
  setSelectedPhoto: (file: File | null, preview: string | null) => void;
  setSelectedDressStyle: (style: string | null) => void;
  startFitting: (userId: string, coupleId: string) => Promise<void>;
  pollResult: (requestId: string) => void;
  stopPolling: () => void;
  loadHistory: (coupleId: string) => Promise<void>;
  loadUsage: (userId: string, coupleId: string) => Promise<void>;
  toggleSave: (requestId: string) => Promise<void>;
  deleteFitting: (requestId: string) => Promise<void>;
  reset: () => void;
  getRemainingFree: () => number;
}

const initialState: FittingState = {
  step: "upload",
  selectedPhotoFile: null,
  selectedPhotoPreview: null,
  selectedDressStyle: null,
  currentRequest: null,
  history: [],
  usage: null,
  isLoading: false,
  error: null,
  pollingInterval: null,
};

export const useFittingStore = create<FittingState & FittingActions>()((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),
  setSelectedPhoto: (file, preview) => set({ selectedPhotoFile: file, selectedPhotoPreview: preview }),
  setSelectedDressStyle: (style) => set({ selectedDressStyle: style }),

  startFitting: async (userId, coupleId) => {
    const { selectedPhotoFile, selectedDressStyle } = get();
    if (!selectedPhotoFile || !selectedDressStyle) return;

    set({ isLoading: true, error: null, step: "processing" });

    try {
      // 1. 사진 업로드
      const photoUrl = await fittingService.uploadUserPhoto(userId, selectedPhotoFile);
      if (!photoUrl) {
        set({ error: "사진 업로드에 실패했습니다.", isLoading: false, step: "upload" });
        return;
      }

      // 2. 피팅 요청 생성
      const request = await fittingService.createFittingRequest(
        userId,
        coupleId,
        photoUrl,
        selectedDressStyle
      );
      if (!request) {
        set({ error: "피팅 요청 생성에 실패했습니다.", isLoading: false, step: "upload" });
        return;
      }

      set({ currentRequest: request });

      // 3. Edge Function 호출
      const started = await fittingService.startAIFitting(request.id);
      if (!started) {
        set({ error: "AI 피팅 시작에 실패했습니다.", isLoading: false, step: "upload" });
        return;
      }

      // 4. 사용량 증가
      await fittingService.incrementFittingUsage(userId, coupleId);

      // 5. 결과 폴링 시작
      get().pollResult(request.id);
    } catch (error) {
      console.error("피팅 프로세스 오류:", error);
      set({ error: "피팅 처리 중 오류가 발생했습니다.", isLoading: false, step: "upload" });
    }
  },

  pollResult: (requestId) => {
    const { pollingInterval } = get();
    if (pollingInterval) clearInterval(pollingInterval);

    const interval = setInterval(async () => {
      try {
        const request = await fittingService.getFittingRequest(requestId);
        if (!request) return;

        set({ currentRequest: request });

        if (request.status === "completed") {
          get().stopPolling();
          set({ step: "result", isLoading: false });
        } else if (request.status === "failed") {
          get().stopPolling();
          set({
            error: "AI 피팅 생성에 실패했습니다. 다시 시도해주세요.",
            isLoading: false,
            step: "upload",
          });
        }
      } catch (error) {
        console.error("폴링 오류:", error);
      }
    }, 3000);

    set({ pollingInterval: interval });
  },

  stopPolling: () => {
    const { pollingInterval } = get();
    if (pollingInterval) {
      clearInterval(pollingInterval);
      set({ pollingInterval: null });
    }
  },

  loadHistory: async (coupleId) => {
    try {
      const history = await fittingService.getFittingHistory(coupleId);
      set({ history });
    } catch (error) {
      console.error("피팅 히스토리 로드 실패:", error);
    }
  },

  loadUsage: async (userId, coupleId) => {
    try {
      const usage = await fittingService.getFittingUsage(userId, coupleId);
      set({ usage });
    } catch (error) {
      console.error("피팅 사용량 로드 실패:", error);
    }
  },

  toggleSave: async (requestId) => {
    const { history, currentRequest } = get();
    const target = history.find((h) => h.id === requestId) || (currentRequest?.id === requestId ? currentRequest : null);
    if (!target) return;

    const newSaved = !target.is_saved;
    await fittingService.toggleFittingSave(requestId, newSaved);

    // 로컬 상태 업데이트
    set({
      history: history.map((h) => h.id === requestId ? { ...h, is_saved: newSaved } : h),
      currentRequest: currentRequest?.id === requestId ? { ...currentRequest, is_saved: newSaved } : currentRequest,
    });
  },

  deleteFitting: async (requestId) => {
    await fittingService.deleteFitting(requestId);
    set((state) => ({
      history: state.history.filter((h) => h.id !== requestId),
    }));
  },

  reset: () => {
    get().stopPolling();
    set({
      step: "upload",
      selectedPhotoFile: null,
      selectedPhotoPreview: null,
      selectedDressStyle: null,
      currentRequest: null,
      isLoading: false,
      error: null,
    });
  },

  getRemainingFree: () => {
    const { usage } = get();
    if (!usage) return 5;
    return Math.max(0, usage.free_limit - usage.free_used);
  },
}));
