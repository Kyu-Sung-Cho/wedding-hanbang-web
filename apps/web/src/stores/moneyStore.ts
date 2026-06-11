"use client";

// 축의금 관리 스토어 (구 invitationStore에서 분리 — 청첩장 기능 제거 후 독립)
import { create } from "zustand";
import type { CongratulatoryMoney } from "@/types/money.types";

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
    set({ moneyLoading: true });
    try {
      if (coupleId === DEMO_COUPLE_ID) {
        set({ moneyList: [], moneyLocalMode: true });
        return;
      }

      const res = await fetch(`/api/money?coupleId=${coupleId}`);
      if (isAuthFailure(res)) {
        set({ moneyList: [], moneyLocalMode: true });
        return;
      }
      if (!res.ok) throw new Error("축의금 로딩 실패");
      const data = await res.json();
      set({ moneyList: data.moneyList, moneyLocalMode: false });
    } catch (err) {
      console.error("축의금 로딩 에러:", err);
      set({ error: "축의금을 불러오지 못했습니다." });
    } finally {
      set({ moneyLoading: false });
    }
  },

  addMoney: async (data) => {
    if (get().moneyLocalMode) {
      const localMoney = createLocalMoney(data);
      set((s) => ({ moneyList: [localMoney, ...s.moneyList] }));
      return;
    }

    try {
      const res = await fetch("/api/money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (isAuthFailure(res)) {
        const localMoney = createLocalMoney(data);
        set((s) => ({ moneyList: [localMoney, ...s.moneyList], moneyLocalMode: true }));
        return;
      }
      if (!res.ok) throw new Error("축의금 추가 실패");
      const result = await res.json();
      set((s) => ({ moneyList: [result.money, ...s.moneyList] }));
    } catch (err) {
      console.error("축의금 추가 에러:", err);
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

    try {
      const res = await fetch(`/api/money/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (isAuthFailure(res)) {
        set((s) => ({
          moneyList: s.moneyList.map((m) =>
            m.id === id ? { ...m, ...data, updated_at: new Date().toISOString() } : m
          ),
          moneyLocalMode: true,
        }));
        return;
      }
      if (!res.ok) throw new Error("축의금 수정 실패");
      const result = await res.json();
      set((s) => ({
        moneyList: s.moneyList.map((m) => (m.id === id ? result.money : m)),
      }));
    } catch (err) {
      console.error("축의금 수정 에러:", err);
    }
  },

  deleteMoney: async (id) => {
    if (get().moneyLocalMode) {
      set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id) }));
      return;
    }

    try {
      const res = await fetch(`/api/money/${id}`, { method: "DELETE" });
      if (isAuthFailure(res)) {
        set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id), moneyLocalMode: true }));
        return;
      }
      if (!res.ok) throw new Error("축의금 삭제 실패");
      set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id) }));
    } catch (err) {
      console.error("축의금 삭제 에러:", err);
    }
  },

  reset: () => {
    set({
      moneyList: [],
      moneyLoading: false,
      moneyLocalMode: false,
      error: null,
    });
  },
}));
