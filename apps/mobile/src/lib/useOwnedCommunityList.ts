import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";

export const COMMUNITY_LIST_TIMEOUT_MS = 10_000;
const READ_ERROR = "목록을 불러오지 못했어요. 연결 상태를 확인하고 다시 불러와 주세요.";
const LOGIN_ERROR = "로그인 상태를 확인한 뒤 다시 불러와 주세요.";

/** 현재 계정의 목록만 보존한다. 타임아웃은 인증·조회·마지막 계정 확인 전체를 포함한다. */
export function useOwnedCommunityList<T>(read: (owner: string, signal: AbortSignal) => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const owner = useRef<string | null | undefined>(undefined);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    generation.current += 1;
    active.current?.abort();
    active.current = null;
  }, []);
  const loadData = useCallback(async () => {
    if (active.current) return;
    const operation = ++generation.current;
    const controller = new AbortController(); active.current = controller;
    setRefreshing(true);
    const current = () => operation === generation.current && !controller.signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const task = async () => {
        const { data, error } = await supabase.auth.getUser();
        if (!current()) return;
        if (error) throw error;
        const id = data.user?.id ?? null;
        if (owner.current !== id) { setItems([]); owner.current = id; }
        if (!id) { setLoadError(LOGIN_ERROR); return; }
        const rows = await read(id, controller.signal);
        if (!current()) return;
        const latest = await supabase.auth.getUser();
        if (!current()) return;
        if (latest.error) throw latest.error;
        if (latest.data.user?.id !== id || owner.current !== id) {
          setItems([]); setLoadError(LOGIN_ERROR); return;
        }
        setItems(rows); setLoadError("");
      };
      await Promise.race([task(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("COMMUNITY_LIST_TIMEOUT")), COMMUNITY_LIST_TIMEOUT_MS);
        controller.signal.addEventListener("abort", () => reject(new Error("CANCELLED")), { once: true });
      })]);
    } catch {
      if (current()) setLoadError(READ_ERROR);
    } finally {
      clearTimeout(timer);
      if (operation === generation.current) {
        controller.abort(); active.current = null; setLoading(false); setRefreshing(false);
      }
    }
  }, [read]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && owner.current === undefined) { owner.current = next; return; }
      if (owner.current === next) return;
      cancel(); owner.current = next; setItems([]); setLoading(false); setRefreshing(false);
      setLoadError(LOGIN_ERROR);
    });
    return () => { cancel(); data.subscription.unsubscribe(); };
  }, [cancel]);
  useFocusEffect(useCallback(() => { void loadData(); return cancel; }, [loadData, cancel]));
  return { items, loading, refreshing, loadError, loadData, cancel };
}
