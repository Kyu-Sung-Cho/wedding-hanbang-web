"use client";

import { create } from "zustand";
import { useAuthStore } from "./authStore";
import { isRecord, isUuid } from "@/utils/requestValidation";

export type SavedNoteIdentity = { id: string; messageId: string; savedByMe: boolean | null };
type Entry = { note: SavedNoteIdentity | null; status: "loading" | "ready" | "error" };
type State = { scope: number; entries: Record<string, Entry> };
export const useSavedNoteStore = create<State>(() => ({ scope: 0, entries: {} }));
const observed = new Map<string, { coupleId: string; count: number }>();
const queued = new Set<string>();
const versions = new Map<string, number>();
let scheduled = false;

function identity() {
  const { user, profile, isDemo } = useAuthStore.getState();
  return user && profile?.id === user.id && isUuid(profile.couple_id) && !isDemo
    ? { userId: user.id, coupleId: profile.couple_id, role: profile.role } : null;
}
let previousIdentity = JSON.stringify(identity());
useAuthStore.subscribe(() => {
  const next = JSON.stringify(identity());
  if (next === previousIdentity) return;
  previousIdentity = next;
  queued.clear(); versions.clear();
  useSavedNoteStore.setState(state => ({ scope: state.scope + 1, entries: {} }));
});

export function isSavedNoteScopeCurrent(scope: number) {
  return scope === useSavedNoteStore.getState().scope;
}

/** 뒤늦은 목록 조회가 성공한 저장·취소를 덮지 않도록 메시지별 버전을 올린다. */
export function setSavedNoteIdentity(scope: number, messageId: string, note: SavedNoteIdentity | null) {
  if (!isSavedNoteScopeCurrent(scope)) return;
  versions.set(messageId, (versions.get(messageId) ?? 0) + 1);
  useSavedNoteStore.setState(state => ({ entries: { ...state.entries, [messageId]: { note, status: "ready" } } }));
}

async function flush() {
  scheduled = false;
  const owner = identity();
  if (!owner) { queued.clear(); return; }
  const scope = useSavedNoteStore.getState().scope;
  const ids = [...queued].filter(id => observed.get(id)?.coupleId === owner.coupleId);
  queued.clear();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const expected = new Map(batch.map(id => {
      const version = (versions.get(id) ?? 0) + 1;
      versions.set(id, version);
      return [id, version];
    }));
    try {
      const response = await fetch(`/api/amora/notes?messageIds=${batch.join(",")}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || body.userId !== owner.userId || body.coupleId !== owner.coupleId
        || !Array.isArray(body.savedNotes) || body.savedNotes.length > batch.length) throw new Error("invalid_saved_index");
      const result = new Map<string, SavedNoteIdentity>();
      for (const item of body.savedNotes) {
        if (!isRecord(item) || !isUuid(item.id) || !isUuid(item.messageId) || !batch.includes(item.messageId)
          || typeof item.savedByMe !== "boolean" || result.has(item.messageId)) throw new Error("invalid_saved_identity");
        result.set(item.messageId, { id: item.id, messageId: item.messageId, savedByMe: item.savedByMe });
      }
      if (!isSavedNoteScopeCurrent(scope)) return;
      useSavedNoteStore.setState(state => {
        const entries = { ...state.entries };
        for (const id of batch) if ((versions.get(id) ?? 0) === expected.get(id)) entries[id] = { note: result.get(id) ?? null, status: "ready" };
        return { entries };
      });
    } catch {
      if (!isSavedNoteScopeCurrent(scope)) return;
      useSavedNoteStore.setState(state => {
        const entries = { ...state.entries };
        for (const id of batch) if ((versions.get(id) ?? 0) === expected.get(id)) entries[id] = { note: entries[id]?.note ?? null, status: "error" };
        return { entries };
      });
    }
  }
}

export function refreshSavedNote(messageId: string) {
  const owner = identity();
  if (!owner || observed.get(messageId)?.coupleId !== owner.coupleId) return;
  const entry = useSavedNoteStore.getState().entries[messageId];
  if (!entry || entry.status === "error") useSavedNoteStore.setState(state => ({
    entries: { ...state.entries, [messageId]: { note: entry?.note ?? null, status: "loading" } },
  }));
  queued.add(messageId);
  if (!scheduled) { scheduled = true; queueMicrotask(() => void flush()); }
}

function refreshObserved() {
  if (document.visibilityState === "hidden") return;
  for (const id of observed.keys()) refreshSavedNote(id);
}

export function observeSavedNote(messageId: string, coupleId: string) {
  if (!isUuid(messageId) || identity()?.coupleId !== coupleId) return () => {};
  const wasEmpty = observed.size === 0;
  const current = observed.get(messageId);
  observed.set(messageId, { coupleId, count: (current?.count ?? 0) + 1 });
  if (wasEmpty) {
    window.addEventListener("focus", refreshObserved);
    document.addEventListener("visibilitychange", refreshObserved);
    window.addEventListener("amora-saved-notes-changed", refreshObserved);
  }
  refreshSavedNote(messageId);
  return () => {
    const item = observed.get(messageId);
    if (item && item.count > 1) observed.set(messageId, { ...item, count: item.count - 1 });
    else { observed.delete(messageId); queued.delete(messageId); }
    if (observed.size === 0) {
      window.removeEventListener("focus", refreshObserved);
      document.removeEventListener("visibilitychange", refreshObserved);
      window.removeEventListener("amora-saved-notes-changed", refreshObserved);
    }
  };
}
