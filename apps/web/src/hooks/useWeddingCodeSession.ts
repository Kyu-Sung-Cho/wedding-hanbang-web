"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";

/** 공개 화면에서도 로그인 왕복 후 본인 계정을 확인한다. */
export function useWeddingCodeSession() {
  const initialize = useAuthStore(state => state.initialize);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const active = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef<number | null>(null);
  const retry = useCallback(() => {
    if (!active.current || inFlight.current !== null) return;
    const attempt = ++sequence.current;
    inFlight.current = attempt;
    setStatus("loading");
    void initialize({ force: true, requireVerifiedSession: true })
      .then(() => { if (active.current && attempt === sequence.current) setStatus("ready"); })
      .catch(() => { if (active.current && attempt === sequence.current) setStatus("error"); })
      .finally(() => { if (inFlight.current === attempt) inFlight.current = null; });
  }, [initialize]);
  useEffect(() => {
    active.current = true;
    // StrictMode의 첫 effect가 취소됐으면 읽기를 중복 시작하지 않는다.
    let current = true;
    queueMicrotask(() => { if (current) retry(); });
    window.addEventListener("focus", retry);
    return () => { current = false; active.current = false; sequence.current += 1; inFlight.current = null; window.removeEventListener("focus", retry); };
  }, [retry]);
  return { status, retry };
}
