"use client";

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

// 토스트 타입 정의
type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (type, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }],
    }));
    // 3초 후 자동 제거
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 3000);
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

// 토스트 호출 훅
type ToastFn = {
  (opts: { type: ToastType; message: string }): void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
};

export function useToast() {
  const addToast = useToastStore((s) => s.addToast);

  const toast: ToastFn = Object.assign(
    ({ type, message }: { type: ToastType; message: string }) => {
      addToast(type, message);
    },
    {
      success: (message: string) => addToast("success", message),
      error: (message: string) => addToast("error", message),
      info: (message: string) => addToast("info", message),
      warning: (message: string) => addToast("warning", message),
    }
  );

  return { toast };
}

// 타입별 스타일 매핑
const typeConfig: Record<
  ToastType,
  { border: string; iconBg: string; Icon: typeof CheckCircle }
> = {
  success: {
    border: "border-l-[#C4967E]",
    iconBg: "text-[#C4967E]",
    Icon: CheckCircle,
  },
  error: {
    border: "border-l-[#EF4444]",
    iconBg: "text-[#EF4444]",
    Icon: AlertCircle,
  },
  info: {
    border: "border-l-[#1A1A1F]",
    iconBg: "text-[#1A1A1F]",
    Icon: Info,
  },
  warning: {
    border: "border-l-[#B89785]",
    iconBg: "text-[#B89785]",
    Icon: AlertTriangle,
  },
};

// 개별 토스트 아이템
function ToastItemComponent({ toast }: { toast: ToastItem }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const { border, iconBg, Icon } = typeConfig[toast.type];

  return (
    <div
      className={`flex w-80 items-center gap-3 rounded-2xl border-l-4 bg-white px-4 py-3 shadow-md animate-slide-in-right ${border}`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${iconBg}`} />
      <p className="flex-1 text-sm text-[#1A1A1F]">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="shrink-0 rounded p-0.5 text-[#B5ADA3] transition-colors hover:text-[#878680]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// 토스트 컨테이너 - 레이아웃에 한 번만 배치
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] flex flex-col items-end gap-2 p-4">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItemComponent toast={t} />
        </div>
      ))}
    </div>
  );
}
