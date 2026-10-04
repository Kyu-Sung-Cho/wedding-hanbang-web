"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  LOCAL_KEY, clearV31LocalProgress, readV31LocalProgress, writeV31LocalProgress,
  type V31LocalProgressSnapshot,
} from "@/lib/weddingCode/v31LocalProgress";
import { clearSavedPairSessionLink } from "@/lib/weddingCode/pairSessionClient";
import { requireRealLocalStorage } from "@/lib/weddingCode/browserStorageHandle";

export const V31_SAVE_PREFERENCE_KEY = "hanbang.wedding-code.v31.autosave";
type SaveStatus = "idle" | "saved" | "off" | "unavailable" | "conflict" | "invalid" | "expired";
type LocalState = {
  ready: boolean;
  enabled: boolean;
  status: SaveStatus;
  saved: V31LocalProgressSnapshot | null;
  /** status 가 invalid 일 때만 뜻이 있다. 저장 시각이 지금보다 하루를 넘는 미래라서 읽지 못한 경우(폰 날짜와 시간을 확인하라는 안내의 근거). */
  clockAhead: boolean;
};
const initialState: LocalState = { ready: false, enabled: true, status: "idle", saved: null, clockAhead: false };

function createProgressStore(active: boolean) {
  let state = initialState;
  let expectedRaw: string | null = null;
  let storage: Storage | null = null;
  let owned = false;
  const listeners = new Set<() => void>();
  function publish(next: LocalState) {
    state = next;
    for (const listener of listeners) listener();
  }
  function load() {
    if (!active) { publish({ ...initialState, ready: true }); return; }
    try {
      // 저장소가 막혀 루트 스니펫이 메모리 객체로 갈아 끼운 브라우저는 진짜 저장소가 아니라서 던진다(아래 catch 가 unavailable 로 둔다).
      storage = requireRealLocalStorage();
      const enabled = storage.getItem(V31_SAVE_PREFERENCE_KEY) !== "off";
      const read = readV31LocalProgress(storage);
      expectedRaw = read.raw;
      publish({
        ready: true, enabled,
        status: read.status === "unavailable" ? "unavailable" : !enabled ? "off"
          : read.status === "ready" || read.status === "empty" ? "idle" : read.status,
        saved: enabled && read.status === "ready" ? read.snapshot : null,
        clockAhead: enabled && read.status === "invalid" && read.clockAhead === true,
      });
    } catch {
      storage = null;
      publish({ ready: true, enabled: true, status: "unavailable", saved: null, clockAhead: false });
    }
  }
  function onStorage(event: StorageEvent) {
    if (!active || (event.key !== null && event.key !== LOCAL_KEY && event.key !== V31_SAVE_PREFERENCE_KEY)) return;
    if (!owned) { load(); return; }
    // 다른 탭의 변경·삭제를 현재 화면의 오래된 답으로 되살리지 않는다.
    publish({ ...state, status: "conflict", saved: null });
  }
  function save(snapshot: V31LocalProgressSnapshot) {
    if (!active) return;
    owned = true;
    if (!state.ready) load();
    if (!state.enabled || state.status === "conflict") return;
    if (!storage) { publish({ ...state, status: "unavailable" }); return; }
    try {
      if (storage.getItem(V31_SAVE_PREFERENCE_KEY) === "off") {
        publish({ ...state, enabled: false, status: "conflict", saved: null });
        return;
      }
      const result = writeV31LocalProgress(storage, snapshot, expectedRaw);
      if (result.status === "saved") {
        expectedRaw = result.raw;
        publish({ ...state, status: "saved", saved: snapshot });
      } else publish({ ...state, status: result.status === "invalid" ? "unavailable" : result.status });
    } catch { publish({ ...state, status: "unavailable" }); }
  }
  function clear() {
    if (!active) return true;
    if (!state.ready) load();
    // 저장소가 처음부터 없는 브라우저(막힘, 메모리 대체 저장소)는 저장된 답이 있을 수 없다. 지울 것이 없으니 지우지 못했다고 알릴 일도 없다(저장 줄은 계속 「저장할 수 없어요」).
    if (!storage) { owned = false; publish({ ...state, status: "unavailable", saved: null }); return true; }
    if (clearV31LocalProgress(storage).status !== "cleared") {
      owned = false;
      publish({ ...state, status: "unavailable", saved: null }); return false;
    }
    expectedRaw = null; owned = false;
    publish({ ...state, status: state.enabled ? "idle" : "off", saved: null });
    return true;
  }
  function setEnabled(enabled: boolean) {
    if (!active) return false;
    try {
      storage = requireRealLocalStorage();
      if (enabled) storage.removeItem(V31_SAVE_PREFERENCE_KEY);
      else storage.setItem(V31_SAVE_PREFERENCE_KEY, "off");
      if (!enabled && clearV31LocalProgress(storage).status !== "cleared") throw new Error("clear failed");
      if (!enabled && !clearSavedPairSessionLink()) throw new Error("comparison address clear failed");
      expectedRaw = storage.getItem(LOCAL_KEY);
      publish({ ...state, ready: true, enabled, status: enabled ? "idle" : "off", saved: enabled ? state.saved : null });
      return true;
    } catch { publish({ ...state, status: "unavailable" }); return false; }
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        if (!state.ready) load();
        if (active) window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && active) window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initialState,
    save, clear, setEnabled,
    restore() {
      // 소개 화면을 오래 열어 두었거나 다른 탭에서 끈 뒤에도 캐시만으로 복원하지 않는다.
      owned = false;
      load();
      if (!state.saved) return null;
      owned = true;
      return state.saved;
    },
    reload() {
      const wasOwned = owned;
      owned = false; load();
      if (state.saved) { owned = true; return state.saved; }
      if (wasOwned) {
        owned = true;
        publish({ ...state, status: "conflict" });
      }
      return null;
    },
    takeOver(snapshot: V31LocalProgressSnapshot) {
      load();
      if (setEnabled(true)) save(snapshot);
    },
  };
}

export function useV31LocalProgress(active: boolean) {
  const store = useMemo(() => createProgressStore(active), [active]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { ...state, store };
}
