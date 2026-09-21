"use client";

import { useAuthStore } from "@/stores/authStore";
import type { AmoraPreparationActionCreate } from "@/hooks/useAmoraPreparationActions";

export type PendingPreparationCreate = {
  scope: string; fieldsKey: string; body: string; requestId: string;
  fields: AmoraPreparationActionCreate; inFlight: boolean;
};

export function preparationCreateScope(state: Pick<ReturnType<typeof useAuthStore.getState>, "user" | "profile" | "isDemo" | "isInitialized">): string {
  if (!state.isInitialized || !state.profile || !state.user || state.profile.id !== state.user.id) return "";
  return JSON.stringify([state.user.id, state.profile.couple_id, state.isDemo]);
}

// 같은 SPA의 화면 이동에서만 원 요청을 유지한다. 인증 전환은 화면이 없어도 원문을 지운다.
const attempts = new Map<string, PendingPreparationCreate>();
const listeners = new Set<() => void>();
let revision = 0;
let ownerEpoch = 0;
const notify = () => { revision += 1; listeners.forEach(listener => listener()); };
useAuthStore.subscribe((state, previous) => {
  if (preparationCreateScope(state) === preparationCreateScope(previous)) return;
  ownerEpoch += 1;
  attempts.clear(); notify();
});

export const preparationCreateRevision = () => revision;
export const preparationOwnerEpoch = () => ownerEpoch;
export const subscribePreparationCreates = (listener: () => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
export const getPreparationCreate = (scope: string) => attempts.get(scope) ?? null;

export function claimPreparationCreate(attempt: PendingPreparationCreate): boolean {
  const current = attempts.get(attempt.scope);
  if (current && (current !== attempt || current.inFlight)) return false;
  attempt.inFlight = true; attempts.set(attempt.scope, attempt); notify(); return true;
}

export function finishPreparationCreate(attempt: PendingPreparationCreate): void {
  if (attempts.get(attempt.scope) !== attempt) return;
  attempt.inFlight = false; notify();
}

export function clearPreparationCreate(scope: string, expected?: PendingPreparationCreate): void {
  if (expected && attempts.get(scope) !== expected) return;
  if (attempts.delete(scope)) notify();
}
