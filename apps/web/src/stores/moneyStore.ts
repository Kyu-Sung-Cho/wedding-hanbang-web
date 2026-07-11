"use client";

// 축의금 관리 스토어 (구 invitationStore에서 분리 — 청첩장 기능 제거 후 독립)
import { create } from "zustand";
import type { CongratulatoryMoney } from "@/types/money.types";

interface MoneyStoreState {
  moneyList: CongratulatoryMoney[];
  moneyLoading: boolean;
  moneyLocalMode: boolean;
  moneyCoupleId: string | null;
  error: string | null;
  errorOperation: "load" | "add" | "update" | "delete" | null;

  loadMoney: (coupleId: string) => Promise<void>;
  addMoney: (data: Omit<CongratulatoryMoney, "id" | "couple_id" | "created_at" | "updated_at">) => Promise<void>;
  updateMoney: (id: string, data: Partial<CongratulatoryMoney>) => Promise<void>;
  deleteMoney: (id: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

const DEMO_COUPLE_ID = "demo-couple";
const LOAD_ERROR = "축의금 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
const SAVE_ERROR = "축의금 내역을 저장하지 못했습니다. 입력한 내용은 그대로 유지됩니다.";
const DELETE_ERROR = "축의금 내역을 삭제하지 못했습니다. 다시 시도해 주세요.";
const AUTH_ERROR = "로그인이 만료되었거나 접근 권한이 없습니다. 다시 로그인한 뒤 시도해 주세요.";

class MoneyRequestError extends Error {}

function isMoney(value: unknown): value is CongratulatoryMoney {
  if (!value || typeof value !== "object") return false;
  const money = value as Record<string, unknown>;
  return (
    typeof money.id === "string" &&
    typeof money.couple_id === "string" &&
    typeof money.guest_name === "string" &&
    typeof money.amount === "number" &&
    Number.isFinite(money.amount) &&
    (money.side === "groom" || money.side === "bride" || money.side === "both") &&
    (money.relation === null || typeof money.relation === "string") &&
    (money.method === "cash" || money.method === "transfer" || money.method === "etc") &&
    (money.memo === null || typeof money.memo === "string") &&
    typeof money.received_at === "string" &&
    typeof money.created_at === "string" &&
    typeof money.updated_at === "string"
  );
}

async function responseError(res: Response, fallback: string): Promise<MoneyRequestError> {
  if (res.status === 401 || res.status === 403) {
    return new MoneyRequestError(AUTH_ERROR);
  }

  // 4xx 검증 메시지는 사용자가 바로 수정할 수 있으므로 표시한다. 서버 내부 오류는 노출하지 않는다.
  if (res.status >= 400 && res.status < 500) {
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object") {
        const message = (body as Record<string, unknown>).error;
        if (typeof message === "string" && message.trim() && message.length <= 160) {
          return new MoneyRequestError(message.trim());
        }
      }
    } catch {
      // 응답 본문이 JSON이 아니어도 아래의 안전한 기본 메시지를 사용한다.
    }
  }

  return new MoneyRequestError(fallback);
}

function failureMessage(error: unknown, fallback: string) {
  return error instanceof MoneyRequestError ? error.message : fallback;
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
  moneyCoupleId: null,
  error: null,
  errorOperation: null,

  loadMoney: async (coupleId) => {
    const isSameCouple = get().moneyCoupleId === coupleId;
    set({
      moneyLoading: true,
      moneyLocalMode: coupleId === DEMO_COUPLE_ID,
      moneyCoupleId: coupleId,
      error: null,
      errorOperation: null,
      ...(!isSameCouple ? { moneyList: [] } : {}),
    });
    try {
      if (coupleId === DEMO_COUPLE_ID) {
        return;
      }

      const res = await fetch(`/api/money?coupleId=${coupleId}`);
      if (!res.ok) {
        throw await responseError(res, LOAD_ERROR);
      }
      const data: unknown = await res.json();
      const moneyList =
        data && typeof data === "object"
          ? (data as Record<string, unknown>).moneyList
          : undefined;
      if (!Array.isArray(moneyList) || !moneyList.every(isMoney)) {
        throw new Error("Invalid money list response");
      }

      // 사용자가 전환된 뒤 늦게 도착한 응답으로 다른 커플의 목록을 덮어쓰지 않는다.
      if (get().moneyCoupleId === coupleId) {
        set({ moneyList, moneyLocalMode: false, error: null, errorOperation: null });
      }
    } catch (err) {
      console.error("축의금 로딩 에러:", err);
      const message = failureMessage(err, LOAD_ERROR);
      if (get().moneyCoupleId === coupleId) {
        set({ error: message, errorOperation: "load", moneyLocalMode: false });
      }
      throw new Error(message);
    } finally {
      if (get().moneyCoupleId === coupleId) {
        set({ moneyLoading: false });
      }
    }
  },

  addMoney: async (data) => {
    set({ error: null, errorOperation: null });
    if (get().moneyLocalMode && get().moneyCoupleId === DEMO_COUPLE_ID) {
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
      if (!res.ok) {
        throw await responseError(res, SAVE_ERROR);
      }
      const result: unknown = await res.json();
      const money =
        result && typeof result === "object"
          ? (result as Record<string, unknown>).money
          : undefined;
      if (!isMoney(money)) throw new Error("Invalid money response");
      set((s) => ({
        moneyList: [money, ...s.moneyList],
        error: null,
        errorOperation: null,
      }));
    } catch (err) {
      console.error("축의금 추가 에러:", err);
      const message = failureMessage(err, SAVE_ERROR);
      set({ error: message, errorOperation: "add", moneyLocalMode: false });
      throw new Error(message);
    }
  },

  updateMoney: async (id, data) => {
    set({ error: null, errorOperation: null });
    if (get().moneyLocalMode && get().moneyCoupleId === DEMO_COUPLE_ID) {
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
      if (!res.ok) {
        throw await responseError(res, SAVE_ERROR);
      }
      const result: unknown = await res.json();
      const money =
        result && typeof result === "object"
          ? (result as Record<string, unknown>).money
          : undefined;
      if (!isMoney(money)) throw new Error("Invalid money response");
      set((s) => ({
        moneyList: s.moneyList.map((m) => (m.id === id ? money : m)),
        error: null,
        errorOperation: null,
      }));
    } catch (err) {
      console.error("축의금 수정 에러:", err);
      const message = failureMessage(err, SAVE_ERROR);
      set({ error: message, errorOperation: "update", moneyLocalMode: false });
      throw new Error(message);
    }
  },

  deleteMoney: async (id) => {
    set({ error: null, errorOperation: null });
    if (get().moneyLocalMode && get().moneyCoupleId === DEMO_COUPLE_ID) {
      set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id) }));
      return;
    }

    try {
      const res = await fetch(`/api/money/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw await responseError(res, DELETE_ERROR);
      }
      set((s) => ({
        moneyList: s.moneyList.filter((m) => m.id !== id),
        error: null,
        errorOperation: null,
      }));
    } catch (err) {
      console.error("축의금 삭제 에러:", err);
      const message = failureMessage(err, DELETE_ERROR);
      set({ error: message, errorOperation: "delete", moneyLocalMode: false });
      throw new Error(message);
    }
  },

  clearError: () => set({ error: null, errorOperation: null }),

  reset: () => {
    set({
      moneyList: [],
      moneyLoading: false,
      moneyLocalMode: false,
      moneyCoupleId: null,
      error: null,
      errorOperation: null,
    });
  },
}));
