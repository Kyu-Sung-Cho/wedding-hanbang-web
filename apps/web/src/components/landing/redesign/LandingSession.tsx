"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type LandingSessionStatus = "unknown" | "signed_in" | "signed_out";

const LandingSessionContext = createContext<LandingSessionStatus>("unknown");

export function useLandingSession() {
  return useContext(LandingSessionContext);
}

type LandingSessionProps = {
  children: ReactNode;
};

/** 랜딩의 정적 응답을 유지하고 브라우저에서 확인한 로그인 상태만 안내한다. */
export default function LandingSession({ children }: LandingSessionProps) {
  const [status, setStatus] = useState<LandingSessionStatus>("unknown");

  useEffect(() => {
    let active = true;
    let revision = 0;
    let timer: number | undefined;
    let auth: SupabaseClient["auth"] | undefined;
    let unsubscribe: (() => void) | undefined;

    const verify = async (requestedRevision: number) => {
      if (!active || !auth) return;
      try {
        const { data, error } = await auth.getUser();
        if (!active || requestedRevision !== revision) return;
        if (error) {
          setStatus(!data.user && error.name === "AuthSessionMissingError" ? "signed_out" : "unknown");
          return;
        }
        setStatus(data.user ? "signed_in" : "signed_out");
      } catch {
        if (active && requestedRevision === revision) setStatus("unknown");
      }
    };

    const queueVerification = () => {
      if (!active) return;
      // 이벤트가 들어온 순간 이전 요청을 무효화해 늦은 응답의 로그인 표시를 막는다.
      const requestedRevision = ++revision;
      setStatus("unknown");
      if (timer !== undefined) window.clearTimeout(timer);
      if (!auth) return;
      // 인증 콜백이 SDK 잠금을 놓은 뒤에 조회한다. 콜백 자체는 동기 함수로 둔다.
      timer = window.setTimeout(() => {
        timer = undefined;
        void verify(requestedRevision);
      }, 0);
    };

    window.addEventListener("focus", queueVerification);
    window.addEventListener("pageshow", queueVerification);

    void import("@/lib/supabase/client").then(({ createClient }) => {
      if (!active) return;
      auth = createClient().auth;
      const { data } = auth.onAuthStateChange(() => queueVerification());
      unsubscribe = () => data.subscription.unsubscribe();
      queueVerification();
    }).catch(() => {
      if (active) setStatus("unknown");
    });

    return () => {
      active = false;
      revision += 1;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe?.();
      window.removeEventListener("focus", queueVerification);
      window.removeEventListener("pageshow", queueVerification);
    };
  }, []);

  return <LandingSessionContext.Provider value={status}>{children}</LandingSessionContext.Provider>;
}
