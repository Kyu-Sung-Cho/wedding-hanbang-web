/**
 * AI 실시간 드레스 피팅 Zustand 스토어
 * 실시간 카메라 기반 피팅 세션 관리
 * 앱과 동일한 구조 사용
 */

import { create } from "zustand";
import {
  FittingRequest,
  FittingSessionInput,
} from "@/types/fitting";
import * as fittingService from "@/lib/services/fittingService";

type FittingStep = "select" | "confirm" | "connecting" | "streaming" | "result";

interface FittingState {
  // 단계
  step: FittingStep;

  // 실시간 스트리밍 상태
  isStreaming: boolean;
  sessionId: string | null;
  streamUrl: string | null;
  currentRequestId: string | null;
  currentFitting: FittingRequest | null;
  error: string | null;
  isLoading: boolean;

  // 피팅 기록
  fittingHistory: FittingRequest[];

  // 선택된 드레스 이미지
  selectedDressImageUrl: string | null;
  selectedVendorId: string | null;

  // 드레스 이미지 업로드
  uploadedDressPreview: string | null;
}

interface FittingActions {
  setStep: (step: FittingStep) => void;

  // 드레스 선택
  selectDress: (imageUrl: string, vendorId?: string) => void;
  setUploadedDressPreview: (preview: string | null) => void;
  uploadDressImage: (file: File) => Promise<string | null>;

  // 실시간 피팅 세션
  startSession: (coupleId: string) => Promise<boolean>;
  endSession: () => void;

  // 영상 캡처/저장
  captureVideo: (videoBlob: Blob) => Promise<boolean>;
  saveFitting: (requestId: string) => Promise<boolean>;
  deleteFitting: (requestId: string) => Promise<boolean>;

  // 피팅 기록
  loadFittingHistory: (coupleId: string) => Promise<void>;

  // 상태 관리
  reset: () => void;
  setError: (error: string | null) => void;
}

const initialState: FittingState = {
  step: "select",
  isStreaming: false,
  sessionId: null,
  streamUrl: null,
  currentRequestId: null,
  currentFitting: null,
  error: null,
  isLoading: false,
  fittingHistory: [],
  selectedDressImageUrl: null,
  selectedVendorId: null,
  uploadedDressPreview: null,
};

export const useFittingStore = create<FittingState & FittingActions>()((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  // ========== 드레스 선택 ==========

  selectDress: (imageUrl, vendorId) => {
    set({
      selectedDressImageUrl: imageUrl,
      selectedVendorId: vendorId || null,
      step: "confirm",
    });
  },

  setUploadedDressPreview: (preview) => set({ uploadedDressPreview: preview }),

  uploadDressImage: async (file) => {
    set({ isLoading: true, error: null });
    const result = await fittingService.uploadDressImage(file);
    set({ isLoading: false });

    if (result.success && result.data) {
      return result.data;
    }
    set({ error: result.error || "이미지 업로드 실패" });
    return null;
  },

  // ========== 실시간 피팅 세션 ==========

  startSession: async (coupleId) => {
    const { selectedDressImageUrl, selectedVendorId } = get();
    if (!selectedDressImageUrl) {
      set({ error: "드레스 이미지를 선택해주세요." });
      return false;
    }

    set({ step: "connecting", isLoading: true, error: null });

    try {
      const input: FittingSessionInput = {
        vendorId: selectedVendorId || undefined,
        dressImageUrl: selectedDressImageUrl,
      };

      const result = await fittingService.createFittingSession(input, coupleId);

      if (result.success && result.data) {
        set({
          isStreaming: true,
          sessionId: result.data.sessionId,
          streamUrl: result.data.streamUrl,
          currentRequestId: result.data.requestId,
          step: "streaming",
          isLoading: false,
        });
        return true;
      } else {
        set({
          error: result.error || "세션 생성 실패",
          step: "confirm",
          isLoading: false,
        });
        return false;
      }
    } catch (error) {
      console.error("[FittingStore] startSession error:", error);
      set({
        error: "피팅 세션 시작 중 오류가 발생했습니다.",
        step: "confirm",
        isLoading: false,
      });
      return false;
    }
  },

  endSession: () => {
    const { currentRequestId } = get();
    if (currentRequestId) {
      fittingService.endFittingSession(currentRequestId);
    }
    set({
      isStreaming: false,
      sessionId: null,
      streamUrl: null,
      step: "result",
    });
  },

  // ========== 영상 캡처/저장 ==========

  captureVideo: async (videoBlob) => {
    try {
      const { currentRequestId } = get();
      if (!currentRequestId) {
        set({ error: "활성 세션이 없습니다." });
        return false;
      }

      const result = await fittingService.saveVideoCapture(currentRequestId, videoBlob);

      if (result.success) {
        return true;
      } else {
        set({ error: result.error || "영상 저장 실패" });
        return false;
      }
    } catch (error) {
      console.error("[FittingStore] captureVideo error:", error);
      set({ error: "영상 캡처 중 오류가 발생했습니다." });
      return false;
    }
  },

  saveFitting: async (requestId) => {
    const result = await fittingService.saveFitting(requestId);
    if (result.success) {
      set((state) => ({
        fittingHistory: state.fittingHistory.map((f) =>
          f.id === requestId ? { ...f, is_saved: true, expires_at: null } : f
        ),
        currentFitting: state.currentFitting?.id === requestId
          ? { ...state.currentFitting, is_saved: true, expires_at: null }
          : state.currentFitting,
      }));
      return true;
    }
    set({ error: result.error || "저장 실패" });
    return false;
  },

  deleteFitting: async (requestId) => {
    const result = await fittingService.deleteFitting(requestId);
    if (result.success) {
      set((state) => ({
        fittingHistory: state.fittingHistory.filter((f) => f.id !== requestId),
      }));
      return true;
    }
    set({ error: result.error || "삭제 실패" });
    return false;
  },

  // ========== 피팅 기록 ==========

  loadFittingHistory: async (coupleId) => {
    const result = await fittingService.getMyFittings(coupleId);
    if (result.success && result.data) {
      set({ fittingHistory: result.data });
    }
  },

  // ========== 상태 관리 ==========

  reset: () => {
    const { isStreaming } = get();
    if (isStreaming) {
      get().endSession();
    }
    set({
      ...initialState,
      fittingHistory: get().fittingHistory,
    });
  },

  setError: (error) => set({ error }),
}));
