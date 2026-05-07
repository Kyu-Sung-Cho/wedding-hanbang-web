import { create } from "zustand";

/**
 * 커뮤니티 등 다른 페이지에서 도구(아모라/예산/일정)를 인플레이스로 띄우기 위한 전역 상태.
 * 라우트 이동 없이 오버레이 형태로 활성화. 한 번에 하나만 열림.
 */
export type ToolPanelKey = "chat" | "budget" | "schedule" | null;

interface ToolPanelState {
  open: ToolPanelKey;
  openTool: (key: Exclude<ToolPanelKey, null>) => void;
  close: () => void;
}

export const useToolPanelStore = create<ToolPanelState>((set) => ({
  open: null,
  openTool: (key) => set({ open: key }),
  close: () => set({ open: null }),
}));
