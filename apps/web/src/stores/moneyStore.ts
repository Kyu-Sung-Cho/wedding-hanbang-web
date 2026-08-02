"use client";

// 축의금 관리 스토어 (구 invitationStore에서 분리 — 청첩장 기능 제거 후 독립)
import { create } from "zustand";
import type { CongratulatoryMoney } from "@/types/money.types";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

interface MoneyStoreState {
  moneyList: CongratulatoryMoney[];
  moneyLoading: boolean;
  moneyLocalMode: boolean;
  error: string | null;

  loadMoney: (coupleId: string) => Promise<void>;
  addMoney: (data: Omit<CongratulatoryMoney, "id" | "couple_id" | "created_at" | "updated_at">) => Promise<void>;
  updateMoney: (id: string, data: Partial<CongratulatoryMoney>) => Promise<void>;
  deleteMoney: (id: string) => Promise<void>;
  reset: () => void;
}

const DEMO_COUPLE_ID = "demo-couple";
let moneyLifecycleEpoch = 0;

function isCurrentMoneyLifecycle(epoch: number): boolean {
  return epoch === moneyLifecycleEpoch;
}

function isAuthFailure(res: Response) {
  return res.status === 401 || res.status === 403;
}

function createLocalMoney(
  data: Omit<CongratulatoryMoney, "id" | "couple_id" | "created_at" | "updated_at">
): CongratulatoryMoney {
  const now = new Date().toISOString();
  return {
    id: `local-money-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    couple_id: DEMO_COUPLE_ID,
    guest_name: data.guest_name,
    amount: data.amount,
    side: data.side,
    relation: data.relation ?? null,
    method: data.method,
    memo: data.memo ?? null,
    received_at: data.received_at,
    created_at: now,
    updated_at: now,
  };
}

export const useMoneyStore = create<MoneyStoreState>((set, get) => ({
  moneyList: [],
  moneyLoading: false,
  moneyLocalMode: false,
  error: null,

  loadMoney: async (coupleId) => {
    const lifecycleEpoch = moneyLifecycleEpoch;
    set({ moneyLoading: true });
    try {
      if (coupleId === DEMO_COUPLE_ID) {
        set({ moneyList: [], moneyLocalMode: true });
        return;
      }

      const res = await fetch(`/api/money?coupleId=${coupleId}`);
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      if (isAuthFailure(res)) {
        set({ moneyList: [], moneyLocalMode: true });
        return;
      }
      if (!res.ok) throw new Error("축의금 로딩 실패");
      const data = await res.json();
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      set({ moneyList: data.moneyList, moneyLocalMode: false });
    } catch (err) {
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      console.error("축의금 로딩 에러:", safeErrorDiagnostic(err));
      set({ error: "축의금을 불러오지 못했습니다." });
    } finally {
      if (isCurrentMoneyLifecycle(lifecycleEpoch)) set({ moneyLoading: false });
    }
  },

  addMoney: async (data) => {
    if (get().moneyLocalMode) {
      const localMoney = createLocalMoney(data);
      set((s) => ({ moneyList: [localMoney, ...s.moneyList] }));
      return;
    }

    const lifecycleEpoch = moneyLifecycleEpoch;

    try {
      const res = await fetch("/api/money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      if (isAuthFailure(res)) {
        const localMoney = createLocalMoney(data);
        set((s) => ({ moneyList: [localMoney, ...s.moneyList], moneyLocalMode: true }));
        return;
      }
      if (!res.ok) {
        // 서버는 "금액을 0~1억원 사이 숫자로 입력해주세요." 같은 한국어 안내를 주는데
        // 예전엔 전부 버려지고 폼만 비워져, 사용자는 저장된 줄 알았다.
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "축의금을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
      }
      const result = await res.json();
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      set((s) => ({ moneyList: [result.money, ...s.moneyList] }));
    } catch (err) {
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      console.error("축의금 추가 에러:", safeErrorDiagnostic(err));
      throw err instanceof Error
        ? err
        : new Error("축의금을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  },

  updateMoney: async (id, data) => {
    if (get().moneyLocalMode) {
      set((s) => ({
        moneyList: s.moneyList.map((m) =>
          m.id === id ? { ...m, ...data, updated_at: new Date().toISOString() } : m
        ),
      }));
      return;
    }

    const lifecycleEpoch = moneyLifecycleEpoch;

    try {
      const res = await fetch(`/api/money/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      if (isAuthFailure(res)) {
        set((s) => ({
          moneyList: s.moneyList.map((m) =>
            m.id === id ? { ...m, ...data, updated_at: new Date().toISOString() } : m
          ),
          moneyLocalMode: true,
        }));
        return;
      }
      if (!res.ok) {
        // 삼키면 화면의 저장 실패 안내가 실행되지 않아, 사용자는 금액을 고치고
        // 저장을 눌렀는데 아무 일도 없는 이유를 모른다(addMoney와 같은 처방).
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "축의금을 수정하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
      }
      const result = await res.json();
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      set((s) => ({
        moneyList: s.moneyList.map((m) => (m.id === id ? result.money : m)),
      }));
    } catch (err) {
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      console.error("축의금 수정 에러:", safeErrorDiagnostic(err));
      throw err instanceof Error
        ? err
        : new Error("축의금을 수정하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  },

  deleteMoney: async (id) => {
    if (get().moneyLocalMode) {
      set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id) }));
      return;
    }

    const lifecycleEpoch = moneyLifecycleEpoch;

    try {
      const res = await fetch(`/api/money/${id}`, { method: "DELETE" });
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      if (isAuthFailure(res)) {
        set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id), moneyLocalMode: true }));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "축의금을 삭제하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
      }
      set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id) }));
    } catch (err) {
      if (!isCurrentMoneyLifecycle(lifecycleEpoch)) return;
      console.error("축의금 삭제 에러:", safeErrorDiagnostic(err));
      throw err instanceof Error
        ? err
        : new Error("축의금을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  },

  reset: () => {
    moneyLifecycleEpoch += 1;
    set({
      moneyList: [],
      moneyLoading: false,
      moneyLocalMode: false,
      error: null,
    });
  },
}));
