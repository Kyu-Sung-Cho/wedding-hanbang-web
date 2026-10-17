"use client";

import { create } from "zustand";
import { useAuthStore } from "@/stores/authStore";
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
let ownerGeneration = 0;
let loadSequence = 0;

function ownerKey() {
  const { user, couple, isDemo } = useAuthStore.getState();
  return JSON.stringify([user?.id ?? null, couple?.id ?? null, isDemo]);
}

function captureOwner(requestedCoupleId?: string) {
  const { user, couple, isDemo } = useAuthStore.getState();
  const demo = isDemo && couple?.id === DEMO_COUPLE_ID;
  if (!couple?.id || (!user && !demo)) {
    throw new Error("로그인과 준비 공간 연결을 확인해 주세요.");
  }
  if ((requestedCoupleId && requestedCoupleId !== couple.id)
    || (couple.id === DEMO_COUPLE_ID && !demo)) {
    throw new Error("현재 계정의 준비 공간에서 다시 시도해 주세요.");
  }
  const key = ownerKey();
  const generation = ownerGeneration;
  return {
    demo, coupleId: couple.id,
    isCurrent: () => generation === ownerGeneration && key === ownerKey(),
  };
}

function requireCurrent(owner: ReturnType<typeof captureOwner>) {
  if (!owner.isCurrent()) {
    throw new Error("계정이나 준비 공간 연결이 바뀌었어요. 현재 계정에서 내역을 다시 확인해 주세요.");
  }
}

async function requestError(res: Response, fallback: string): Promise<Error> {
  if (res.status === 401) return new Error("로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.");
  if (res.status === 403) return new Error("이 준비 공간의 축의금에 접근할 수 없어요. 계정과 연결 상태를 확인해 주세요.");
  const body: unknown = await res.json().catch(() => null);
  const message = body && typeof body === "object" && "error" in body
    && typeof body.error === "string" ? body.error : fallback;
  return new Error(message);
}

function createLocalMoney(
  data: Omit<CongratulatoryMoney, "id" | "couple_id" | "created_at" | "updated_at">
): CongratulatoryMoney {
  const now = new Date().toISOString();
  return {
    ...data, id: `local-money-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    couple_id: DEMO_COUPLE_ID, created_at: now, updated_at: now,
  };
}

export const useMoneyStore = create<MoneyStoreState>((set) => ({
  moneyList: [], moneyLoading: false, moneyLocalMode: false, error: null,

  loadMoney: async (coupleId) => {
    const owner = captureOwner(coupleId);
    const sequence = ++loadSequence;
    const isCurrent = () => owner.isCurrent() && sequence === loadSequence;
    set({ moneyLoading: true, moneyLocalMode: owner.demo, error: null });
    try {
      if (owner.demo) {
        set({ moneyList: [], moneyLocalMode: true });
        return;
      }
      const res = await fetch(`/api/money?coupleId=${encodeURIComponent(coupleId)}`);
      if (!isCurrent()) return;
      if (!res.ok) throw await requestError(res, "축의금을 불러오지 못했어요. 다시 시도해 주세요.");
      const data: { moneyList: CongratulatoryMoney[] } = await res.json();
      if (isCurrent()) set({ moneyList: data.moneyList, moneyLocalMode: false });
    } catch (err) {
      if (!isCurrent()) return;
      const failure = err instanceof Error ? err : new Error("축의금을 불러오지 못했어요.");
      set({ moneyList: [], moneyLocalMode: false, error: failure.message });
      throw failure;
    } finally {
      if (isCurrent()) set({ moneyLoading: false });
    }
  },

  addMoney: async (data) => {
    const owner = captureOwner();
    if (owner.demo) {
      set((state) => ({ moneyList: [createLocalMoney(data), ...state.moneyList], moneyLocalMode: true }));
      return;
    }
    const res = await fetch("/api/money", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    requireCurrent(owner);
    if (!res.ok) throw await requestError(res, "축의금을 저장하지 못했어요. 다시 시도해 주세요.");
    const result: { money: CongratulatoryMoney } = await res.json();
    requireCurrent(owner);
    set((state) => ({ moneyList: [result.money, ...state.moneyList] }));
  },

  updateMoney: async (id, data) => {
    const owner = captureOwner();
    if (owner.demo) {
      set((state) => ({
        moneyList: state.moneyList.map((money) => money.id === id
          ? { ...money, ...data, updated_at: new Date().toISOString() } : money),
      }));
      return;
    }
    const res = await fetch(`/api/money/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    requireCurrent(owner);
    if (!res.ok) throw await requestError(res, "축의금을 수정하지 못했어요. 다시 시도해 주세요.");
    const result: { money: CongratulatoryMoney } = await res.json();
    requireCurrent(owner);
    set((state) => ({ moneyList: state.moneyList.map((money) => money.id === id ? result.money : money) }));
  },

  deleteMoney: async (id) => {
    const owner = captureOwner();
    if (owner.demo) {
      set((state) => ({ moneyList: state.moneyList.filter((money) => money.id !== id) }));
      return;
    }
    const res = await fetch(`/api/money/${encodeURIComponent(id)}`, { method: "DELETE" });
    requireCurrent(owner);
    if (!res.ok) throw await requestError(res, "축의금을 삭제하지 못했어요. 다시 시도해 주세요.");
    set((state) => ({ moneyList: state.moneyList.filter((money) => money.id !== id) }));
  },

  reset: () => {
    // 로그아웃/계정 교체 전에 시작한 요청은 reset 뒤 상태를 되살릴 수 없다.
    ownerGeneration += 1;
    loadSequence += 1;
    set({ moneyList: [], moneyLoading: false, moneyLocalMode: false, error: null });
  },
}));

// 같은 커플의 파트너로 계정을 바꿀 때도 이전 사용자의 상태를 먼저 비운다.
useAuthStore.subscribe((current, previous) => {
  if (current.user?.id !== previous.user?.id
    || current.couple?.id !== previous.couple?.id
    || current.isDemo !== previous.isDemo) {
    useMoneyStore.getState().reset();
  }
});
