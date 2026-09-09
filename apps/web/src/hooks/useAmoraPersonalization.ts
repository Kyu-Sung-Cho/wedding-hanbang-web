"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import {
  isAmoraPersonalizationChanges, mergeAmoraPersonalization, parseAmoraPersonalizationProfile,
  type AmoraPersonalizationChanges, type AmoraPersonalizationProfile,
} from "@/lib/amora/personalization";

type PersonalizationStatus = "idle" | "loading" | "ready" | "error";
type PersonalizationPayload = { profile?: unknown; current?: unknown; error?: string; code?: string; deleted?: unknown };
async function readPayload(response: Response): Promise<PersonalizationPayload> {
  try { return await response.json() as PersonalizationPayload; } catch { return {}; }
}
type OwnedState = {
  ownerId: string | null; profile: AmoraPersonalizationProfile | null;
  status: PersonalizationStatus; saving: boolean; error: string | null;
};

export function useAmoraPersonalization(enabled = true) {
  const ownerId = useAuthStore((state) => state.user?.id ?? null);
  const [state, setState] = useState<OwnedState>(() => ({
    ownerId, profile: null, status: enabled && ownerId ? "loading" : "idle", saving: false, error: null,
  }));
  const sequence = useRef(0);
  const mutation = useRef<number | null>(null);
  const profile = state.ownerId === ownerId ? state.profile : null;
  const status = state.ownerId === ownerId ? state.status : enabled && ownerId ? "loading" : "idle";
  const saving = state.ownerId === ownerId && state.saving;
  const error = state.ownerId === ownerId ? state.error : null;

  const isCurrent = useCallback((token: number) =>
    token === sequence.current && enabled && !!ownerId
      && (useAuthStore.getState().user?.id ?? null) === ownerId, [enabled, ownerId]);

  const load = useCallback(async () => {
    if (mutation.current !== null) return null;
    const token = ++sequence.current;
    if (!enabled || !ownerId) {
      setState({ ownerId, profile: null, status: "idle", saving: false, error: null });
      return null;
    }
    setState({ ownerId, profile: null, status: "loading", saving: false, error: null });
    try {
      const response = await fetch("/api/amora/personalization", {
        cache: "no-store", headers: { "X-Amora-Expected-Owner": ownerId },
      });
      const payload = await readPayload(response);
      if (!isCurrent(token)) return null;
      if (!response.ok) throw new Error(payload.error ?? "도움 방식을 불러오지 못했어요.");
      const next = payload.profile === null ? null : parseAmoraPersonalizationProfile(payload.profile);
      if (payload.profile !== null && !next) throw new Error("저장된 도움 방식을 안전하게 읽지 못했어요.");
      setState({ ownerId, profile: next, status: "ready", saving: false, error: null });
      return next;
    } catch (failure) {
      if (isCurrent(token)) setState({ ownerId, profile: null, status: "error", saving: false,
        error: failure instanceof Error ? failure.message : "도움 방식을 불러오지 못했어요." });
      return null;
    }
  }, [enabled, ownerId, isCurrent]);

  useEffect(() => {
    mutation.current = null;
    void load();
    return () => { sequence.current += 1; mutation.current = null; };
  }, [load]);

  const save = useCallback(async (changes: AmoraPersonalizationChanges) => {
    if (!enabled || !ownerId || status !== "ready" || mutation.current !== null
      || !isAmoraPersonalizationChanges(changes)
      || (useAuthStore.getState().user?.id ?? null) !== ownerId) return null;
    const token = ++sequence.current;
    mutation.current = token;
    setState(previous => ({ ...previous, saving: true, error: null }));
    try {
      const preferences = mergeAmoraPersonalization(profile?.preferences ?? null, changes);
      const response = await fetch("/api/amora/personalization", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedOwnerUserId: ownerId, expectedRevision: profile?.revision ?? null, preferences }),
      });
      const payload = await readPayload(response);
      if (!isCurrent(token)) return null;
      if (!response.ok) {
        if (payload.code === "PERSONALIZATION_OWNER_MISMATCH") {
          setState(previous => ({ ...previous, profile: null, status: "error" }));
        } else if (response.status === 409) {
          const current = payload.current === null ? null : parseAmoraPersonalizationProfile(payload.current);
          setState(previous => ({ ...previous, profile: current,
            status: payload.current === null || current ? "ready" : "error" }));
        } else if (response.status === 401) {
          setState(previous => ({ ...previous, profile: null, status: "error" }));
        }
        throw new Error(payload.error ?? "도움 방식을 저장하지 못했어요.");
      }
      const next = parseAmoraPersonalizationProfile(payload.profile);
      if (!next || Object.entries(changes).some(([key, value]) =>
        next.preferences[key as keyof typeof next.preferences] !== value)) {
        setState(previous => ({ ...previous, status: "error" }));
        throw new Error("저장 결과를 안전하게 확인하지 못했어요.");
      }
      setState({ ownerId, profile: next, status: "ready", saving: false, error: null });
      return next;
    } catch (failure) {
      if (isCurrent(token)) setState(previous => ({ ...previous,
        error: failure instanceof Error ? failure.message : "도움 방식을 저장하지 못했어요." }));
      return null;
    } finally {
      if (mutation.current === token) mutation.current = null;
      if (isCurrent(token)) setState(previous => ({ ...previous, saving: false }));
    }
  }, [enabled, ownerId, status, profile, isCurrent]);

  const reset = useCallback(async () => {
    if (!enabled || !ownerId || status !== "ready" || mutation.current !== null
      || (useAuthStore.getState().user?.id ?? null) !== ownerId) return false;
    if (!profile) return true;
    const token = ++sequence.current;
    mutation.current = token;
    setState(previous => ({ ...previous, saving: true, error: null }));
    try {
      const response = await fetch("/api/amora/personalization", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedOwnerUserId: ownerId, expectedRevision: profile.revision }),
      });
      const payload = await readPayload(response);
      if (!isCurrent(token)) return false;
      if (!response.ok) {
        if (payload.code === "PERSONALIZATION_OWNER_MISMATCH") {
          setState(previous => ({ ...previous, profile: null, status: "error" }));
        } else if (response.status === 409) {
          const current = payload.current === null ? null : parseAmoraPersonalizationProfile(payload.current);
          setState(previous => ({ ...previous, profile: current,
            status: payload.current === null || current ? "ready" : "error" }));
        } else if (response.status === 401) setState(previous => ({ ...previous, profile: null, status: "error" }));
        throw new Error(payload.error ?? "도움 방식을 초기화하지 못했어요.");
      }
      if (payload.deleted !== true || payload.profile !== null) throw new Error("초기화 결과를 확인하지 못했어요.");
      setState({ ownerId, profile: null, status: "ready", saving: false, error: null });
      return true;
    } catch (failure) {
      if (isCurrent(token)) setState(previous => ({ ...previous,
        error: failure instanceof Error ? failure.message : "도움 방식을 초기화하지 못했어요." }));
      return false;
    } finally {
      if (mutation.current === token) mutation.current = null;
      if (isCurrent(token)) setState(previous => ({ ...previous, saving: false }));
    }
  }, [enabled, ownerId, status, profile, isCurrent]);

  return { profile, status, saving, error, load, save, reset,
    clearError: () => setState(previous => ({ ...previous, error: null })) };
}
